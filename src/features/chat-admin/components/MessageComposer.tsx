import type { Ref } from 'react';
import { Button, Input, Upload } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { PaperClipOutlined, SendOutlined } from '@ant-design/icons';
import AttachmentThumb from './AttachmentThumb';
import type { AttachmentsApi } from '../hooks/useAttachments';
import type { ChatAttachment } from '../types';

/**
 * 通用消息输入框：以对话页（ChatPanel）输入框为准抽出的通用组件。
 * 含「附件缩略图行 + 卡片式文本框（粘贴图片 / IME 防误发 / Enter 发送）+ 回形针上传 + 发送/停止按钮」。
 * 视觉沿用全局 .chat-input-box / .chat-send-btn / .chat-stop-btn 样式，故对话页保持像素一致；
 * Agent / Skill 生成页复用本组件后输入框能力与对话页对齐。
 *
 * 附件状态由 {@link AttachmentsApi}（useAttachments）持有并由调用方传入——这样调用方可读取
 * attached（如对话页的「文件处理模式」标签）、在多视图（落地页/工作区）间共享同一份附件。
 */
export interface MessageComposerProps {
  value: string;
  onChange: (v: string) => void;
  /** 发送（Enter / 点击）：回传本轮已上传完成的附件；组件随后自动清空输入与附件。 */
  onSubmit: (text: string, attachments: ChatAttachment[]) => void;
  attachments: AttachmentsApi;
  placeholder?: string;
  /** 生成中：禁用发送 + 上传；若同时传了 onStop，则发送位渲染「停止」按钮。 */
  busy?: boolean;
  onStop?: () => void;
  /** 整体禁用（如尚未就绪：无 conversationId）。 */
  disabled?: boolean;
  minRows?: number;
  maxRows?: number;
  uploadTitle?: string;
  /** 仅对话页用：空↔底部布局切换时回拨焦点。 */
  textareaRef?: Ref<TextAreaRef>;
}

export default function MessageComposer({
  value,
  onChange,
  onSubmit,
  attachments,
  placeholder,
  busy = false,
  onStop,
  disabled = false,
  minRows = 1,
  maxRows = 8,
  uploadTitle = '上传文件交给 Agent 处理',
  textareaRef,
}: MessageComposerProps) {
  const { attached, isUploading, uploadFile, handlePaste, removeAt, reset } = attachments;
  const canSend = !!value.trim() && !busy && !isUploading && !disabled;

  const doSubmit = () => {
    if (!canSend) return;
    const ready = attached.filter((a) => !a.uploading);
    onSubmit(value.trim(), ready);
    onChange('');
    reset();
  };

  return (
    <>
      {attached.length > 0 && (
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 10, padding: '0 2px' }}
        >
          {attached.map((a, i) => (
            <AttachmentThumb key={`${a.fileId}-${i}`} item={a} onRemove={() => removeAt(i)} />
          ))}
        </div>
      )}
      <div className="chat-input-box">
        <Input.TextArea
          ref={textareaRef}
          variant="borderless"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoSize={{ minRows, maxRows }}
          style={{ padding: 0, fontSize: 14, resize: 'none' }}
          onPaste={busy ? undefined : handlePaste}
          onKeyDown={(e) => {
            // 中文/日文等输入法组词期间按回车是用来选词/上屏（keyCode 229 / isComposing），不能当成发送。
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              doSubmit();
            }
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
          <Upload
            customRequest={uploadFile}
            showUploadList={false}
            multiple
            disabled={busy || disabled}
          >
            <Button
              type="text"
              icon={<PaperClipOutlined />}
              disabled={busy || disabled}
              title={uploadTitle}
            />
          </Upload>
          <div style={{ flex: 1 }} />
          {busy && onStop ? (
            // 生成中：发送位变「停止」——深色圆 + 白色方块，标准停止语义。
            <Button
              shape="circle"
              className="chat-stop-btn"
              icon={<span className="chat-stop-square" />}
              title="停止生成"
              onClick={onStop}
            />
          ) : (
            <>
              <span className="chat-send-hint">Enter 发送</span>
              <Button
                type="text"
                shape="circle"
                className="chat-send-btn"
                icon={<SendOutlined />}
                title="发送"
                onClick={doSubmit}
                disabled={!canSend}
                loading={busy && !onStop}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}

import { useState, type ClipboardEvent } from 'react';
import { App, type UploadProps } from 'antd';
import { uploadAgentFile } from '@/api/agentFiles';
import type { ChatAttachment } from '@/features/chat-admin/types';

/**
 * 输入框附件逻辑（上传 / 粘贴图片 / 缩略图状态），从 ChatPanel 抽出，供 {@link MessageComposer}
 * 与各构建器（Agent / Skill 生成）复用。
 *
 * 回形针按钮（customRequest）与「粘贴图片」（onPaste）共用同一条上传链路（{@link uploadOne}），
 * 保证两条入口行为一致：临时占位缩略图（loading 态）→ 上传 → 替换真实 fileId / 失败移除。
 */
export interface AttachmentsApi {
  attached: ChatAttachment[];
  /** 有附件仍在上传中：调用方据此禁用发送，避免把临时占位 id 当作 fileId 发出去。 */
  isUploading: boolean;
  uploadFile: NonNullable<UploadProps['customRequest']>;
  handlePaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  removeAt: (index: number) => void;
  reset: () => void;
}

export function useAttachments(): AttachmentsApi {
  const { message } = App.useApp();
  const [attached, setAttached] = useState<ChatAttachment[]>([]);
  const isUploading = attached.some((a) => a.uploading);

  const uploadOne = async (file: File) => {
    // 本地预览 URL（会话内有效）：图片放大、文档新标签预览都用它。
    const localUrl = URL.createObjectURL(file);
    // 临时占位 id：上传一开始就把缩略图（带 loading 态）显示出来，避免上传期间界面无反馈。
    // 上传完成后据此换成真实 fileId，失败则据此移除。
    const tempId = `uploading-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setAttached((prev) => [
      ...prev,
      {
        fileId: tempId,
        filename: file.name,
        contentType: file.type,
        url: localUrl,
        uploading: true,
      },
    ]);
    try {
      const res = await uploadAgentFile(file);
      // 上传成功：把占位项替换为真实 fileId 并清除 loading 态（保留同一个本地预览 url）。
      setAttached((prev) =>
        prev.map((a) =>
          a.fileId === tempId
            ? {
                fileId: res.fileId,
                filename: res.filename,
                contentType: res.contentType ?? file.type,
                url: localUrl,
              }
            : a,
        ),
      );
    } catch (e) {
      setAttached((prev) => prev.filter((a) => a.fileId !== tempId));
      URL.revokeObjectURL(localUrl);
      message.error(`文件上传失败：${(e as Error)?.message ?? '未知错误'}`);
    }
  };

  const uploadFile: NonNullable<UploadProps['customRequest']> = async (options) => {
    try {
      await uploadOne(options.file as File);
      options.onSuccess?.({});
    } catch (e) {
      options.onError?.(e as Error);
    }
  };

  // 粘贴图片：从剪贴板捞出图片项（截图 / 复制的图）直接走上传，纯文本粘贴照常进输入框。
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (images.length === 0) return; // 没有图片：让默认粘贴把文本填进输入框
    e.preventDefault(); // 有图片：阻止把图片 blob 当乱码塞进文本框
    images.forEach((f) => void uploadOne(f));
  };

  const removeAt = (index: number) => setAttached((prev) => prev.filter((_, j) => j !== index));
  const reset = () => setAttached([]);

  return { attached, isUploading, uploadFile, handlePaste, removeAt, reset };
}

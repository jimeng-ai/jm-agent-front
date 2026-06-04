import { useEffect, useRef, useState } from 'react';
import { Button, Input, Modal, Typography } from 'antd';
import { FullscreenExitOutlined, FullscreenOutlined } from '@ant-design/icons';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import Markdown from '@/components/Markdown';

interface Props {
  /** 由外层 Form.Item 注入 */
  value?: string;
  onChange?: (v: string) => void;
}

const PLACEHOLDER = '_开始在左侧编写提示词，这里会实时渲染 Markdown 预览…_';

/** 左编辑 / 右预览的一栏分屏；左右等高、滚动按比例联动。height 由调用方给定。 */
function SplitView({
  value,
  onChange,
  height,
  onToggleFull,
  full,
}: Props & { height: string; onToggleFull?: () => void; full?: boolean }) {
  const taRef = useRef<TextAreaRef>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // 任一侧滚动时，按滚动比例同步另一侧。syncing 标志吃掉被动滚动触发的回声事件，避免抖动。
  useEffect(() => {
    const ta = taRef.current?.resizableTextArea?.textArea;
    const pv = previewRef.current;
    if (!ta || !pv) return;
    let syncing = false;
    const ratioSync = (src: HTMLElement, dst: HTMLElement) => {
      if (syncing) {
        syncing = false;
        return;
      }
      const srcMax = src.scrollHeight - src.clientHeight;
      if (srcMax <= 0) return;
      const dstMax = dst.scrollHeight - dst.clientHeight;
      syncing = true;
      dst.scrollTop = (src.scrollTop / srcMax) * dstMax;
    };
    const onTa = () => ratioSync(ta, pv);
    const onPv = () => ratioSync(pv, ta);
    ta.addEventListener('scroll', onTa);
    pv.addEventListener('scroll', onPv);
    return () => {
      ta.removeEventListener('scroll', onTa);
      pv.removeEventListener('scroll', onPv);
    };
  }, []);

  return (
    <div className="prompt-split" style={{ height }}>
      <div className="prompt-split__col">
        <div className="prompt-split__head">
          <Typography.Text strong>System Prompt</Typography.Text>
          {onToggleFull && (
            <Button
              size="small"
              type="text"
              icon={full ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={onToggleFull}
            >
              {full ? '退出全屏' : '放大'}
            </Button>
          )}
        </div>
        <Input.TextArea
          ref={taRef}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          className="prompt-split__textarea"
          style={{ fontFamily: 'Menlo, monospace', fontSize: 13 }}
        />
        <Typography.Text type="secondary" className="prompt-split__hint">
          定义 Agent 的角色、风格、约束。变量占位：{'{{user_name}}'} 等。
        </Typography.Text>
      </div>
      <div className="prompt-split__col">
        <div className="prompt-split__head">
          <Typography.Text type="secondary">实时预览</Typography.Text>
        </div>
        <div className="prompt-split__preview" ref={previewRef}>
          <Markdown content={value?.trim() ? value : PLACEHOLDER} />
        </div>
      </div>
    </div>
  );
}

export default function PromptSplitEditor({ value, onChange }: Props) {
  const [full, setFull] = useState(false);
  return (
    <>
      <SplitView
        value={value}
        onChange={onChange}
        height="60vh"
        full={false}
        onToggleFull={() => setFull(true)}
      />
      <Modal
        open={full}
        onCancel={() => setFull(false)}
        footer={null}
        width="92vw"
        title="人设 Prompt"
        destroyOnClose
        style={{ top: 24 }}
        styles={{ body: { paddingTop: 12 } }}
      >
        <SplitView
          value={value}
          onChange={onChange}
          height="calc(100vh - 150px)"
          full
          onToggleFull={() => setFull(false)}
        />
      </Modal>
    </>
  );
}

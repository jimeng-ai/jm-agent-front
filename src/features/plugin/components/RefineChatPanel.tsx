import { useState } from 'react';
import { App, Button, Input, Space, Tag, Typography } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { pluginAiApi, type PluginDraft } from '@/features/plugin/api';

interface Props {
  draft: PluginDraft;
  /** 微调后用整份更新后草稿替换 */
  onChange: (d: PluginDraft) => void;
}

/**
 * 对话式微调：每轮把当前草稿 + 指令发给后端，拿回「完整的」更新后草稿替换。
 * 只改内存草稿，不触库——保存仍走批量创建/复核流程，守住「人复核后才落库」。
 */
export default function RefineChatPanel({ draft, onChange }: Props) {
  const { message } = App.useApp();
  const [history, setHistory] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [input, setInput] = useState('');

  const mut = useMutation({
    mutationFn: (instruction: string) => pluginAiApi.refine({ draft, instruction, history }),
    onSuccess: (res, instruction) => {
      onChange(res.draft);
      setHistory((h) => [
        ...h,
        { role: 'user', text: instruction },
        { role: 'assistant', text: res.reply },
      ]);
      setInput('');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const send = () => {
    const instruction = input.trim();
    if (!instruction) {
      message.error('请输入修改指令');
      return;
    }
    mut.mutate(instruction);
  };

  return (
    <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 12 }}>
      <Typography.Text strong>对话微调</Typography.Text>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '4px 0 8px' }}>
        例如「把 scope 改成必填」「加一个 page 参数」「create_moment 改成
        GET」。每轮基于当前草稿整体更新。
      </Typography.Paragraph>
      {history.length > 0 && (
        <div style={{ maxHeight: 180, overflow: 'auto', marginBottom: 8 }}>
          {history.map((m, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <Tag color={m.role === 'user' ? 'blue' : 'green'}>
                {m.role === 'user' ? '你' : 'AI'}
              </Tag>
              <span style={{ fontSize: 13 }}>{m.text}</span>
            </div>
          ))}
        </div>
      )}
      <Space.Compact style={{ width: '100%' }}>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={send}
          placeholder="输入修改指令，回车发送…"
          disabled={mut.isPending}
        />
        <Button type="primary" loading={mut.isPending} onClick={send}>
          发送
        </Button>
      </Space.Compact>
    </div>
  );
}

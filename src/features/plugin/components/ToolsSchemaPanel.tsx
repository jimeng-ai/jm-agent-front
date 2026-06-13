import { useMemo, useState, type ReactNode } from 'react';
import {
  App,
  Button,
  Empty,
  Popconfirm,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { CopyOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { pluginToolApi } from '@/features/plugin/api';
import { jsonSchemaToFields } from '@/features/plugin/utils/schema';
import type { PluginTool } from '@/api/types';

const { Text } = Typography;

interface Props {
  pluginId: string;
  tools: PluginTool[];
  loading: boolean;
  /** 顶部右侧操作区（AI 生成 / AI 改写 / 新增工具）。 */
  headerExtra?: ReactNode;
  onEdit: (tool: PluginTool) => void;
  onDelete: (toolId: string) => void;
  /** 启用开关切换成功后回调（让父级 invalidate 工具列表）。 */
  onChanged: () => void;
}

/** 由 inputSchema 推参数 chip 文案：数组加 []，非必填加 ?。 */
function paramChips(schema?: Record<string, unknown>): string[] {
  return jsonSchemaToFields(schema)
    .filter((f) => f.name)
    .map((f) => `${f.name}${f.type === 'array' ? '[]' : ''}${f.required ? '' : '?'}`);
}

const mono: React.CSSProperties = { fontFamily: 'Menlo, monospace' };

export default function ToolsSchemaPanel({
  pluginId,
  tools,
  loading,
  headerExtra,
  onEdit,
  onDelete,
  onChanged,
}: Props) {
  const { message } = App.useApp();
  const [selectedId, setSelectedId] = useState<string>();
  const selected = tools.find((t) => t.id === selectedId) ?? tools[0];

  // 启用开关：后端 update 需整份 payload（含 mapping），故先取 mapping 再翻转 enabled 提交。
  const toggleMut = useMutation({
    mutationFn: async (tool: PluginTool) => {
      const mapping = await pluginToolApi.mapping(pluginId, tool.id);
      if (!mapping) throw new Error('该工具缺少 HTTP 映射，无法切换启用状态');
      return pluginToolApi.update(pluginId, tool.id, {
        name: tool.name,
        title: tool.title,
        description: tool.description,
        enabled: !tool.enabled,
        inputSchema: tool.inputSchema,
        mapping,
      });
    },
    onSuccess: () => {
      message.success('已更新');
      onChanged();
    },
    onError: (e: unknown) =>
      message.error(e instanceof Error && e.message ? e.message : '切换失败'),
  });

  const detailJson = useMemo(() => {
    if (!selected) return '';
    return JSON.stringify(
      {
        name: selected.name,
        description: selected.description,
        input_schema: selected.inputSchema ?? {},
      },
      null,
      2,
    );
  }, [selected]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 32 }}>
        <Spin />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
        {headerExtra}
      </div>

      {tools.length === 0 ? (
        <Empty description="暂无动作，点「新增工具」或「AI 生成」添加" />
      ) : (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          {tools.map((tool) => {
            const chips = paramChips(tool.inputSchema);
            const active = selected?.id === tool.id;
            return (
              <div
                key={tool.id}
                onClick={() => setSelectedId(tool.id)}
                style={{
                  border: `1px solid ${active ? '#4f46e5' : '#f0f0f0'}`,
                  borderRadius: 10,
                  padding: '14px 16px',
                  cursor: 'pointer',
                  background: active ? '#fafaff' : '#fff',
                  transition: 'border-color .15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Space size={10} align="center" wrap>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>
                        {tool.title || tool.name}
                      </span>
                      {tool.title && (
                        <span style={{ ...mono, fontSize: 12, color: '#999' }}>{tool.name}</span>
                      )}
                      <Text type="secondary">{tool.description}</Text>
                    </Space>
                    {chips.length > 0 && (
                      <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {chips.map((c) => (
                          <span
                            key={c}
                            style={{
                              ...mono,
                              fontSize: 12,
                              color: '#595959',
                              background: '#f5f5f5',
                              borderRadius: 6,
                              padding: '2px 8px',
                            }}
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <Space size={4} onClick={(e) => e.stopPropagation()}>
                    <Tooltip title="编辑">
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => onEdit(tool)}
                      />
                    </Tooltip>
                    <Popconfirm title="确认删除？" onConfirm={() => onDelete(tool.id)}>
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                    <Switch
                      checked={tool.enabled}
                      loading={toggleMut.isPending && toggleMut.variables?.id === tool.id}
                      onChange={() => toggleMut.mutate(tool)}
                    />
                  </Space>
                </div>
              </div>
            );
          })}
        </Space>
      )}

      {selected && (
        <div
          style={{
            marginTop: 20,
            border: '1px solid #f0f0f0',
            borderRadius: 10,
            padding: 16,
            background: '#fafafa',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <Space size={8}>
              <Text type="secondary">当前选中：</Text>
              <span style={{ fontWeight: 600 }}>{selected.title || selected.name}</span>
              {selected.title && (
                <span style={{ ...mono, fontSize: 12, color: '#999' }}>{selected.name}</span>
              )}
              <Tag color={selected.enabled ? 'green' : 'default'}>
                {selected.enabled ? '已启用' : '已停用'}
              </Tag>
            </Space>
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={() => {
                navigator.clipboard?.writeText(detailJson);
                message.success('已复制 Schema');
              }}
            >
              复制
            </Button>
          </div>
          <pre
            style={{
              ...mono,
              fontSize: 12,
              margin: 0,
              maxHeight: 360,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {detailJson}
          </pre>
        </div>
      )}
    </div>
  );
}

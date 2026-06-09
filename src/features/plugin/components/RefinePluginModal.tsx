import { useEffect, useState } from 'react';
import { App, Button, Modal, Space, Spin, Table, Tag, Typography } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { pluginToolApi, type AiToolSpec, type PluginDraft } from '@/features/plugin/api';
import type { Plugin, PluginTool } from '@/api/types';
import { fieldsToJsonSchema, jsonSchemaToFields } from '@/features/plugin/utils/schema';
import {
  applyLocations,
  buildMapping,
  disassembleMapping,
  emptyHttpForm,
} from '@/features/plugin/utils/mapping';
import { editorToToolSpec, toolSpecToEditor } from '@/features/plugin/utils/toolSpec';
import RefineChatPanel from './RefineChatPanel';

interface Props {
  open: boolean;
  pluginId: string;
  plugin: Plugin;
  tools: PluginTool[];
  onClose: () => void;
  /** 应用更改后回调（刷新工具列表） */
  onApplied: () => void;
}

const mono: React.CSSProperties = { fontFamily: 'Menlo, monospace', fontSize: 12 };

/**
 * 对【已保存插件】做对话式微调：开窗时把现有工具(inputSchema + mapping)反推成 PluginDraft，
 * 聊天调整后「应用更改」按工具名 update（已存）/ create（新增）。不会删除工具（删除走列表里的删除按钮）。
 */
export default function RefinePluginModal({
  open,
  pluginId,
  plugin,
  tools,
  onClose,
  onApplied,
}: Props) {
  const { message } = App.useApp();
  const [draft, setDraft] = useState<PluginDraft | null>(null);
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    if (!open) {
      setDraft(null);
      return;
    }
    let cancelled = false;
    setBuilding(true);
    (async () => {
      try {
        const specs: AiToolSpec[] = [];
        for (const t of tools) {
          const fields = jsonSchemaToFields(t.inputSchema);
          const mapping = await pluginToolApi.mapping(pluginId, t.id);
          let httpForm = emptyHttpForm();
          let flds = fields;
          if (mapping) {
            const dis = disassembleMapping(mapping);
            httpForm = dis.form;
            flds = applyLocations(fields, dis.locations);
          }
          specs.push(editorToToolSpec(t.name, t.description, flds, httpForm, t.title));
        }
        if (!cancelled) {
          setDraft({
            plugin: {
              name: plugin.name,
              description: plugin.description,
              auth: { type: plugin.authType },
            },
            tools: specs,
          });
        }
      } catch (e) {
        if (!cancelled) message.error('读取现有工具失败：' + (e as Error).message);
      } finally {
        if (!cancelled) setBuilding(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, pluginId, plugin, tools, message]);

  const applyMut = useMutation({
    mutationFn: async () => {
      const nameToTool = new Map(tools.map((t) => [t.name, t]));
      const results: { name: string; ok: boolean; msg?: string }[] = [];
      for (const spec of draft?.tools ?? []) {
        const existing = nameToTool.get(spec.name);
        const ed = toolSpecToEditor(spec);
        const payload = {
          name: ed.name,
          title: ed.title,
          description: ed.description,
          enabled: existing ? !!existing.enabled : ed.enabled,
          inputSchema: fieldsToJsonSchema(ed.fields),
          mapping: buildMapping(ed.fields, ed.httpForm),
        };
        try {
          if (existing) await pluginToolApi.update(pluginId, existing.id, payload);
          else await pluginToolApi.create(pluginId, payload);
          results.push({ name: spec.name, ok: true });
        } catch (e) {
          results.push({ name: spec.name, ok: false, msg: (e as Error).message });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      const ok = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) message.success(`已应用到 ${ok} 个工具`);
      else
        message.warning(
          `成功 ${ok} 个，失败 ${failed.length}：${failed
            .map((r) => `${r.name}（${r.msg || '未知错误'}）`)
            .join('；')}`,
          8,
        );
      onApplied();
      if (failed.length === 0) onClose();
    },
  });

  const specs = draft?.tools ?? [];
  const isNew = (name: string) => !tools.some((t) => t.name === name);

  return (
    <Modal
      title="AI 改写当前插件"
      open={open}
      onCancel={onClose}
      width={880}
      destroyOnClose
      footer={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          <Button
            type="primary"
            loading={applyMut.isPending}
            disabled={!draft || specs.length === 0}
            onClick={() => applyMut.mutate()}
          >
            应用更改
          </Button>
        </Space>
      }
    >
      {building || !draft ? (
        <Spin />
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            基于当前已保存的 {tools.length} 个工具，用对话调整后点「应用更改」会按工具名{' '}
            <b>更新/新增</b>
            （不会删除工具，删除请用列表里的删除按钮）。
          </Typography.Text>
          <Table<AiToolSpec & { _key: number }>
            size="small"
            rowKey="_key"
            pagination={
              specs.length > 10 ? { pageSize: 10, size: 'small', showSizeChanger: false } : false
            }
            dataSource={specs.map((t, i) => ({ ...t, _key: i }))}
            columns={[
              {
                title: '工具名',
                width: 220,
                ellipsis: true,
                render: (_, t) => (
                  <div>
                    <div>
                      {t.title || t.name}
                      {isNew(t.name) && (
                        <Tag color="blue" style={{ marginLeft: 6 }}>
                          新增
                        </Tag>
                      )}
                    </div>
                    {t.title && (
                      <div style={{ ...mono, color: '#999' }} title={t.name}>
                        {t.name}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                title: '接口',
                render: (_, t) => (
                  <span style={mono}>
                    <Tag>{t.method}</Tag>
                    {t.path}
                  </span>
                ),
              },
              { title: '入参', width: 64, render: (_, t) => t.params?.length ?? 0 },
            ]}
          />
          <RefineChatPanel draft={draft} onChange={setDraft} />
        </Space>
      )}
    </Modal>
  );
}

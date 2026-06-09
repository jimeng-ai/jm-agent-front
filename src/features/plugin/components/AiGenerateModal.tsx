import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Input,
  Modal,
  Popover,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from 'antd';
import { ThunderboltOutlined, UploadOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  pluginAiApi,
  pluginApi,
  pluginToolApi,
  type AiToolSpec,
  type PluginDraft,
} from '@/features/plugin/api';
import type { PluginAuthType } from '@/api/types';
import { fieldsToJsonSchema } from '@/features/plugin/utils/schema';
import { buildMapping } from '@/features/plugin/utils/mapping';
import { toolSpecToEditor } from '@/features/plugin/utils/toolSpec';
import RefineChatPanel from './RefineChatPanel';

interface Props {
  open: boolean;
  pluginId: string;
  onClose: () => void;
  /** 批量创建成功后回调（刷新工具列表） */
  onCreated: () => void;
}

type InputTab = 'text' | 'url' | 'image' | 'file';

interface PickedImage {
  base64: string;
  mime: string;
  preview: string;
}

const mono: React.CSSProperties = { fontFamily: 'Menlo, monospace', fontSize: 12 };
/** 「自动跑完整份文档」每批接口数（受 LLM 单次输出 token 上限约束，约 10 个/批稳妥）。 */
const BATCH_SIZE = 10;
/** 复核表分页阈值：解析出的工具较多时分页，避免一屏塞不下。 */
const REVIEW_PAGE_SIZE = 10;
/** 插件鉴权类型允许集合（与后端 PluginAuthType 对齐）。 */
const AUTH_TYPES = ['NONE', 'BEARER', 'BASIC', 'API_KEY', 'HMAC'];

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** 合并分批草稿：保留首批的插件元信息，工具按名去重累积。 */
function mergeDraft(a: PluginDraft | null, b: PluginDraft): PluginDraft {
  if (!a) return b;
  const names = new Set((a.tools ?? []).map((t) => t.name));
  const fresh = (b.tools ?? []).filter((t) => !names.has(t.name));
  return {
    plugin: a.plugin,
    tools: [...(a.tools ?? []), ...fresh],
    warnings: [...(a.warnings ?? []), ...(b.warnings ?? [])],
  };
}

/** 截图客户端降采样到长边 ≤1568px（Anthropic 建议值），导出 PNG 保留文字清晰度。 */
function readImageDownscaled(file: File): Promise<PickedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片解码失败'));
      img.onload = () => {
        const max = 1568;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('canvas 不可用'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/png');
        resolve({ base64: dataUrl.split(',')[1] ?? '', mime: 'image/png', preview: dataUrl });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function AiGenerateModal({ open, pluginId, onClose, onCreated }: Props) {
  const { message } = App.useApp();
  const [tab, setTab] = useState<InputTab>('text');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [fullDoc, setFullDoc] = useState(false);
  const [image, setImage] = useState<PickedImage | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<PluginDraft | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [progress, setProgress] = useState('');

  const reset = () => {
    setText('');
    setUrl('');
    setFullDoc(false);
    setImage(null);
    setFile(null);
    setDraft(null);
    setSelected([]);
    setProgress('');
    setTab('text');
  };
  const handleClose = () => {
    reset();
    onClose();
  };

  // 微调返回整份新草稿：替换并默认全选（工具数可能变化）
  const applyRefined = (d: PluginDraft) => {
    setDraft(d);
    setSelected((d.tools ?? []).map((_, i) => i));
  };

  // 本插件已有工具名（用于「重名提示」）。仅能看到本人/本租户可见的工具，足够覆盖同插件重名场景。
  const existingToolsQuery = useQuery({
    queryKey: ['plugin', pluginId, 'tools', 'names'],
    queryFn: () => pluginToolApi.list(pluginId),
    enabled: open,
  });
  const existingNames = new Set((existingToolsQuery.data ?? []).map((t) => t.name));

  // 行内编辑：改某个工具的 name / path（接口地址），就地更新 draft。
  const updateTool = (idx: number, patch: Partial<AiToolSpec>) => {
    setDraft((d) => {
      if (!d) return d;
      const tools = (d.tools ?? []).map((t, i) => (i === idx ? { ...t, ...patch } : t));
      return { ...d, tools };
    });
  };

  // 工具名是否合法（作为 LLM 函数名，仅允许 [a-zA-Z0-9_-]）。
  const nameInvalid = (name?: string) => !name || !/^[a-zA-Z0-9_-]+$/.test(name);

  const genMut = useMutation({
    mutationFn: async () => {
      if (tab === 'text') {
        if (!text.trim()) throw new Error('请粘贴 API 文档文本');
        return pluginAiApi.generate({ text: text.trim() });
      }
      if (tab === 'image') {
        if (!image) throw new Error('请选择截图');
        return pluginAiApi.generate({ imageBase64: image.base64, imageMediaType: image.mime });
      }
      if (tab === 'file') {
        if (!file) throw new Error('请选择文件');
        return pluginAiApi.generateUpload(file);
      }
      // url
      if (!url.trim()) throw new Error('请填写文档链接');
      if (!fullDoc) return pluginAiApi.generate({ docUrl: url.trim() });

      // 「自动跑完整份文档」：列出全部接口 → 分批多次解析 → 累积
      const { links } = await pluginAiApi.listEndpoints(url.trim());
      if (!links?.length) return pluginAiApi.generate({ docUrl: url.trim() }); // 非索引，退回普通解析
      const batches = chunk(links, BATCH_SIZE);
      let merged: PluginDraft | null = null;
      let failed = 0;
      for (let i = 0; i < batches.length; i++) {
        setProgress(
          `正在解析 第 ${i + 1}/${batches.length} 批（共 ${links.length} 个接口，已得 ${merged?.tools?.length ?? 0} 个工具）…`,
        );
        try {
          const d = await pluginAiApi.generate({ docUrls: batches[i] });
          merged = mergeDraft(merged, d);
          setDraft(merged); // 实时更新，让工具逐批出现
          setSelected((merged.tools ?? []).map((_, idx) => idx));
        } catch {
          failed += 1;
        }
      }
      setProgress('');
      if (!merged) throw new Error('全部批次解析失败，请稍后重试或改用粘贴/上传');
      if (failed > 0) {
        merged = {
          ...merged,
          warnings: [...(merged.warnings ?? []), `${failed} 批解析失败，已跳过`],
        };
      }
      return merged;
    },
    onSuccess: (d) => {
      setDraft(d);
      setSelected((d.tools ?? []).map((_, i) => i));
      setProgress('');
    },
    onError: (e: Error) => {
      setProgress('');
      message.error(e.message);
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const picked = (draft?.tools ?? []).filter((_, i) => selected.includes(i));
      const results: { name: string; ok: boolean; msg?: string }[] = [];
      for (const spec of picked) {
        try {
          const ed = toolSpecToEditor(spec);
          await pluginToolApi.create(pluginId, {
            name: ed.name,
            title: ed.title,
            description: ed.description,
            enabled: ed.enabled,
            inputSchema: fieldsToJsonSchema(ed.fields),
            mapping: buildMapping(ed.fields, ed.httpForm),
          });
          results.push({ name: spec.name, ok: true });
        } catch (e) {
          // 保留后端原始报错（如校验/网络），不再吞成无信息的「失败」。
          results.push({ name: spec.name, ok: false, msg: (e as Error).message });
        }
      }
      // #4 把文档里解析出的鉴权方式写进插件（密钥仍由人工到凭证页填）。
      // 只在检测到真实鉴权（非 NONE）时设置，避免覆盖成「无鉴权」。
      const detected = (draft?.plugin?.auth?.type ?? '').trim().toUpperCase();
      let authSet: PluginAuthType | null = null;
      if (results.some((r) => r.ok) && AUTH_TYPES.includes(detected) && detected !== 'NONE') {
        try {
          await pluginApi.update(pluginId, { authType: detected as PluginAuthType });
          authSet = detected as PluginAuthType;
        } catch {
          /* 鉴权类型写入失败不阻断工具创建结果 */
        }
      }
      return { results, authSet };
    },
    onSuccess: ({ results, authSet }) => {
      const ok = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      const authNote = authSet ? `，鉴权方式已设为 ${authSet}（请到凭证页填入密钥）` : '';
      if (failed.length === 0) {
        message.success(`已创建 ${ok} 个工具${authNote}`);
        handleClose();
      } else {
        // 带上每个失败工具的具体原因（后端原始报错），不再只给名字。
        const detail = failed.map((r) => `${r.name}（${r.msg || '未知错误'}）`).join('；');
        message.warning(`已创建 ${ok} 个，${failed.length} 个失败：${detail}${authNote}`, 8);
      }
      onCreated();
    },
  });

  const tools = draft?.tools ?? [];
  const auth = draft?.plugin?.auth;
  // 草稿内同名计数（用于「与其它工具重名」提示）。
  const nameCount = new Map<string, number>();
  tools.forEach((t) => nameCount.set(t.name, (nameCount.get(t.name) ?? 0) + 1));
  // 与本插件【已有】工具重名的（勾选范围内）名字。
  const dupExistingNames = tools
    .filter((_, i) => selected.includes(i))
    .map((t) => t.name)
    .filter((n) => existingNames.has(n));
  const banner = [
    'AI 不会填写 Base URL 与密钥——保存后请到「基础信息 / 凭证」页补全。',
    auth?.notes ? `鉴权：${auth.notes}` : '',
    dupExistingNames.length
      ? `本插件已存在同名工具：${[...new Set(dupExistingNames)].join('、')}——可在下方直接改工具名或接口地址后再创建。`
      : '',
    ...(draft?.warnings ?? []),
  ].filter(Boolean);
  const reviewing = !!draft && !genMut.isPending;

  return (
    <Modal
      title={
        <span>
          <ThunderboltOutlined /> AI 生成插件工具
        </span>
      }
      open={open}
      onCancel={handleClose}
      width={960}
      destroyOnClose
      footer={
        reviewing ? (
          <Space>
            <Button onClick={() => setDraft(null)}>重新输入</Button>
            <Button
              type="primary"
              loading={createMut.isPending}
              disabled={selected.length === 0}
              onClick={() => createMut.mutate()}
            >
              批量创建所选（{selected.length}）
            </Button>
          </Space>
        ) : (
          <Space>
            <Button onClick={handleClose} disabled={genMut.isPending}>
              取消
            </Button>
            <Button type="primary" loading={genMut.isPending} onClick={() => genMut.mutate()}>
              解析生成
            </Button>
          </Space>
        )
      }
    >
      {genMut.isPending && progress && (
        <Alert type="info" showIcon message={progress} style={{ marginBottom: 12 }} />
      )}
      {draft ? null : genMut.isPending ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <Spin tip="正在解析…">
            <div style={{ height: 1 }} />
          </Spin>
        </div>
      ) : (
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k as InputTab)}
          items={[
            {
              key: 'text',
              label: '粘贴文本',
              children: (
                <>
                  <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                    粘贴接口的<b>文档片段 / curl / Markdown / OpenAPI</b>
                    ，可一次贴整份文档（含多个接口）。
                  </Typography.Paragraph>
                  <Input.TextArea
                    rows={12}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={
                      'POST /api/v2/wecom/moment/result\nBody:\n  id: string 必填\n  scope: enum<integer> 1=全部可见 2=部分可见 ...'
                    }
                    style={mono}
                  />
                </>
              ),
            },
            {
              key: 'url',
              label: '文档链接',
              children: (
                <>
                  <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                    填可访问的 API 文档链接（优先 Apifox 的 <code>llms.txt</code> / OpenAPI 导出）。
                    <b>本机外网受限时可能抓取失败</b>，可改用「粘贴文本 / 上传文件」。
                  </Typography.Paragraph>
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://xxx.apifox.cn/.../llms.txt"
                  />
                  <Checkbox
                    checked={fullDoc}
                    onChange={(e) => setFullDoc(e.target.checked)}
                    style={{ marginTop: 10 }}
                  >
                    整份文档自动跑完（接口很多时勾选：会列出全部接口并<b>分批多次解析</b>
                    ，耗时较长）
                  </Checkbox>
                </>
              ),
            },
            {
              key: 'image',
              label: '截图',
              children: (
                <>
                  <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                    上传 API 文档<b>截图</b>（多模态识别）。会自动压缩到长边 1568px。
                  </Typography.Paragraph>
                  <Upload
                    accept="image/*"
                    maxCount={1}
                    showUploadList={false}
                    beforeUpload={(f) => {
                      readImageDownscaled(f)
                        .then(setImage)
                        .catch((e) => message.error(e.message));
                      return false;
                    }}
                  >
                    <Button icon={<UploadOutlined />}>选择截图</Button>
                  </Upload>
                  {image && (
                    <img
                      src={image.preview}
                      alt="preview"
                      style={{
                        display: 'block',
                        maxWidth: '100%',
                        maxHeight: 320,
                        marginTop: 8,
                        border: '1px solid #eee',
                        borderRadius: 4,
                      }}
                    />
                  )}
                </>
              ),
            },
            {
              key: 'file',
              label: '上传文件',
              children: (
                <>
                  <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                    上传 <b>PDF / Word / Markdown</b> 文档，服务端解析成文本后识别。
                  </Typography.Paragraph>
                  <Upload
                    accept=".pdf,.doc,.docx,.md,.markdown,.txt"
                    maxCount={1}
                    beforeUpload={(f) => {
                      setFile(f);
                      return false;
                    }}
                    onRemove={() => setFile(null)}
                    fileList={file ? [{ uid: '1', name: file.name }] : []}
                  >
                    <Button icon={<UploadOutlined />}>选择文件</Button>
                  </Upload>
                </>
              ),
            },
          ]}
        />
      )}
      {draft && (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          {banner.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message={
                <div>
                  {banner.map((b, i) => (
                    <div key={i}>{b}</div>
                  ))}
                </div>
              }
            />
          )}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            插件：{draft.plugin?.name || '(未命名)'} · 共解析出 {tools.length}{' '}
            个工具，勾选要创建的：
          </Typography.Text>
          <Table<AiToolSpec & { _key: number }>
            size="small"
            rowKey="_key"
            pagination={
              tools.length > REVIEW_PAGE_SIZE
                ? { pageSize: REVIEW_PAGE_SIZE, size: 'small', showSizeChanger: false }
                : false
            }
            dataSource={tools.map((t, i) => ({ ...t, _key: i }))}
            rowSelection={{
              selectedRowKeys: selected,
              onChange: (keys) => setSelected(keys as number[]),
              preserveSelectedRowKeys: true,
            }}
            expandable={{
              expandedRowRender: (t) => (
                <div style={{ ...mono, whiteSpace: 'pre-wrap' }}>
                  {(t.params ?? [])
                    .map(
                      (p) =>
                        `· ${p.name}: ${p.type}${p.required ? ' *' : ''} (${p.location ?? 'query'})`,
                    )
                    .join('\n') || '（无入参）'}
                </div>
              ),
            }}
            columns={[
              {
                title: '工具名（可编辑）',
                width: 240,
                render: (_, t) => {
                  const dupExisting = existingNames.has(t.name);
                  const dupInDraft = (nameCount.get(t.name) ?? 0) > 1;
                  const invalid = nameInvalid(t.name);
                  const err = invalid
                    ? '工具名只能用英文/数字/_/-'
                    : dupExisting
                      ? '本插件已有同名工具，请改名'
                      : dupInDraft
                        ? '与列表内其它工具重名'
                        : '';
                  return (
                    <div>
                      <Input
                        size="small"
                        value={t.title}
                        placeholder="中文展示名（可选）"
                        onChange={(e) => updateTool(t._key, { title: e.target.value })}
                      />
                      <Input
                        size="small"
                        style={{ marginTop: 4, ...mono }}
                        status={err ? 'error' : undefined}
                        value={t.name}
                        placeholder="英文函数名"
                        onChange={(e) => updateTool(t._key, { name: e.target.value })}
                      />
                      {err && (
                        <div style={{ fontSize: 11, color: '#ff4d4f', marginTop: 2 }}>{err}</div>
                      )}
                    </div>
                  );
                },
              },
              {
                title: '接口地址（可编辑）',
                width: 260,
                render: (_, t) => (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <Tag>{t.method}</Tag>
                    <Input
                      size="small"
                      style={mono}
                      value={t.path}
                      onChange={(e) => updateTool(t._key, { path: e.target.value })}
                    />
                  </div>
                ),
              },
              { title: '入参', width: 56, render: (_, t) => t.params?.length ?? 0 },
              {
                title: '提示',
                width: 80,
                render: (_, t) =>
                  t.warnings?.length ? (
                    <Popover
                      title="需确认"
                      content={
                        <div style={{ maxWidth: 360 }}>
                          {t.warnings.map((w, i) => (
                            <div key={i}>· {w}</div>
                          ))}
                        </div>
                      }
                    >
                      <Tag color="orange" style={{ cursor: 'pointer' }}>
                        {t.warnings.length} 条
                      </Tag>
                    </Popover>
                  ) : (
                    <Tag>无</Tag>
                  ),
              },
            ]}
          />
          {reviewing && <RefineChatPanel draft={draft} onChange={applyRefined} />}
        </Space>
      )}
    </Modal>
  );
}

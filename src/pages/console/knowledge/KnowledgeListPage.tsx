import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Dropdown, Empty, Form, Input, Modal, Spin } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  DatabaseOutlined,
  ShareAltOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { kbApi } from '@/features/knowledge/api';
import { formatBytes } from '@/features/knowledge/utils';
import type { KbIndexStatus, KnowledgeBase } from '@/api/types';
import ShareModal from '@/features/rbac/components/ShareModal';
import './knowledge-list.css';

const toNum = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const fmtInt = (n: number) => n.toLocaleString('en-US');
const fmtCompact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期。 */
function relativeTime(input?: string): string {
  if (!input) return '';
  const t = new Date(input).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const STATUS_META: Record<KbIndexStatus, { label: string; cls: string }> = {
  READY: { label: '就绪', cls: 'kb-badge--ready' },
  INDEXING: { label: '索引中', cls: 'kb-badge--indexing' },
  ERROR: { label: '错误', cls: 'kb-badge--error' },
};

export default function KnowledgeListPage() {
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<{ id: string; name: string } | null>(null);
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({
    queryKey: ['kb', 'list'],
    queryFn: kbApi.list,
  });

  const createMut = useMutation({
    mutationFn: kbApi.create,
    onSuccess: () => {
      message.success('创建成功');
      setOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['kb', 'list'] });
    },
  });

  const delMut = useMutation({
    mutationFn: kbApi.delete,
    onSuccess: () => {
      message.success('已删除');
      qc.invalidateQueries({ queryKey: ['kb', 'list'] });
    },
  });

  const summary = useMemo(() => {
    const kbs = data ?? [];
    const docs = kbs.reduce((s, k) => s + toNum(k.docCount), 0);
    const chunks = kbs.reduce((s, k) => s + toNum(k.chunkCount), 0);
    return { count: kbs.length, docs, chunks };
  }, [data]);

  const confirmDelete = (kb: KnowledgeBase) => {
    modal.confirm({
      title: `删除知识库「${kb.name}」？`,
      content: '该知识库下的文档与索引将一并清理，操作不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => delMut.mutateAsync(kb.id),
    });
  };

  return (
    <div>
      <div className="kb-head">
        <div>
          <h2 className="kb-head__title">知识库</h2>
          {!isLoading && summary.count > 0 && (
            <div className="kb-head__sub">
              {summary.count} 个知识库 · 共 {fmtInt(summary.docs)} 篇文档 ·{' '}
              {fmtCompact(summary.chunks)} 切片
            </div>
          )}
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          新建知识库
        </Button>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
          <Spin />
        </div>
      ) : !data?.length ? (
        <Empty description="暂无知识库" style={{ padding: '64px 0' }} />
      ) : (
        <div className="kb-grid">
          {data.map((kb) => {
            const docCount = toNum(kb.docCount);
            const doneCount = toNum(kb.doneCount);
            const status = STATUS_META[kb.indexStatus ?? 'READY'] ?? STATUS_META.READY;
            const isIndexing = kb.indexStatus === 'INDEXING';
            const pct = docCount > 0 ? Math.round((doneCount / docCount) * 100) : 0;
            const updated = relativeTime(kb.updateTime ?? kb.createTime);
            return (
              <div
                key={kb.id}
                className="kb-card"
                onClick={() => navigate(`/console/knowledge/${kb.id}`)}
              >
                <div className="kb-card__head">
                  <div className="kb-card__icon">
                    <DatabaseOutlined />
                  </div>
                  <div className="kb-card__titlewrap">
                    <div className="kb-card__name" title={kb.name}>
                      {kb.name}
                    </div>
                    {kb.description && (
                      <div className="kb-card__desc" title={kb.description}>
                        {kb.description}
                      </div>
                    )}
                  </div>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        { key: 'share', icon: <ShareAltOutlined />, label: '分享' },
                        { key: 'del', icon: <DeleteOutlined />, label: '删除', danger: true },
                      ],
                      onClick: ({ key, domEvent }) => {
                        domEvent.stopPropagation();
                        if (key === 'share') setShareTarget({ id: kb.id, name: kb.name });
                        else confirmDelete(kb);
                      },
                    }}
                  >
                    <button
                      className="kb-card__more"
                      onClick={(e) => e.stopPropagation()}
                      aria-label="更多操作"
                    >
                      <MoreOutlined />
                    </button>
                  </Dropdown>
                  <span className={`kb-badge ${status.cls}`}>
                    <span className="kb-badge__dot" />
                    {status.label}
                  </span>
                </div>

                <div className="kb-card__stats">
                  <div>
                    <div className="kb-stat__label">文档</div>
                    <div className="kb-stat__value">{fmtInt(docCount)}</div>
                  </div>
                  <div>
                    <div className="kb-stat__label">切片</div>
                    <div className="kb-stat__value">{fmtInt(toNum(kb.chunkCount))}</div>
                  </div>
                  <div>
                    <div className="kb-stat__label">大小</div>
                    <div className="kb-stat__value">{formatBytes(toNum(kb.totalSize))}</div>
                  </div>
                </div>

                {isIndexing && (
                  <div className="kb-card__progress">
                    <div className="kb-card__progress-top">
                      <span className="kb-progress-label">索引中…</span>
                      <span className="kb-progress-pct">{pct}%</span>
                    </div>
                    <div className="kb-progress-track">
                      <div className="kb-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )}

                <div className="kb-card__divider" />
                <div className="kb-card__foot">
                  <span className="kb-card__foot-name">{kb.creatorName ?? ''}</span>
                  <span>{updated}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        title="新建知识库"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          <Form.Item label="名称" name="name" rules={[{ required: true }]}>
            <Input placeholder="知识库名称" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} placeholder="简单描述用途" />
          </Form.Item>
        </Form>
      </Modal>

      <ShareModal
        open={!!shareTarget}
        resourceType="KNOWLEDGE_BASE"
        resourceId={shareTarget?.id}
        resourceName={shareTarget?.name}
        onClose={() => setShareTarget(null)}
      />
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Checkbox,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Spin,
  Tooltip,
  Upload,
} from 'antd';
import type { UploadProps } from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EyeOutlined,
  ReloadOutlined,
  SearchOutlined,
  ProfileOutlined,
  QuestionCircleOutlined,
  UploadOutlined,
  DatabaseOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { docApi, kbApi } from '@/features/knowledge/api';
import {
  DOC_STATUS_PROGRESS,
  DOC_STATUS_TEXT,
  formatBytes,
  isPending,
} from '@/features/knowledge/utils';
import SearchTestDrawer from '@/features/knowledge/components/SearchTestDrawer';
import PreviewModal from '@/features/knowledge/components/PreviewModal';
import ChunksDrawer from '@/features/knowledge/components/ChunksDrawer';
import type { KbDocument, KbIndexStatus } from '@/api/types';
import './knowledge-detail.css';

const toNum = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const fmtInt = (n: number) => n.toLocaleString('en-US');

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

/** 文件名 → 类型角标（标签文字 + 配色类）。 */
function fileType(title: string): { label: string; cls: string } {
  const ext = title.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return { label: 'PDF', cls: 'kbd-ftype--pdf' };
  if (ext === 'md' || ext === 'markdown') return { label: 'MD', cls: 'kbd-ftype--md' };
  if (ext === 'doc' || ext === 'docx') return { label: 'DOCX', cls: 'kbd-ftype--doc' };
  if (ext === 'xls' || ext === 'xlsx' || ext === 'csv')
    return { label: ext.toUpperCase(), cls: 'kbd-ftype--xls' };
  if (ext === 'txt') return { label: 'TXT', cls: 'kbd-ftype--txt' };
  return { label: (ext || 'FILE').slice(0, 4).toUpperCase(), cls: 'kbd-ftype--other' };
}

const KB_STATUS_META: Record<KbIndexStatus, { label: string; cls: string }> = {
  READY: { label: '就绪', cls: 'kbd-badge--ready' },
  INDEXING: { label: '索引中', cls: 'kbd-badge--indexing' },
  ERROR: { label: '错误', cls: 'kbd-badge--error' },
};

const { Dragger } = Upload;

type DocFilter = 'all' | 'indexed' | 'indexing';

export default function KnowledgeDetailPage() {
  const { kbId = '' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<KbDocument | null>(null);
  const [chunksDoc, setChunksDoc] = useState<KbDocument | null>(null);
  const [filter, setFilter] = useState<DocFilter>('all');
  const [keyword, setKeyword] = useState('');
  // 表格逐行切片：勾选后 Excel/CSV 每数据行独立成 chunk（FAQ 表用）。值在点「确认入库」时随 confirm 一并下发。
  const [rowPerChunk, setRowPerChunk] = useState(false);

  const kbQuery = useQuery({
    queryKey: ['kb', 'detail', kbId],
    queryFn: () => kbApi.detail(kbId),
    enabled: !!kbId,
  });

  const docsQuery = useQuery({
    queryKey: ['kb', kbId, 'docs'],
    queryFn: () => docApi.list(kbId),
    enabled: !!kbId,
    refetchInterval: (q) => {
      const list = (q.state.data as KbDocument[] | undefined) ?? [];
      return list.some((d) => isPending(d.status)) ? 3000 : false;
    },
    refetchIntervalInBackground: false,
  });

  const retryMut = useMutation({
    mutationFn: docApi.retry,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb', kbId, 'docs'] }),
  });

  const delMut = useMutation({
    mutationFn: docApi.delete,
    onSuccess: () => {
      message.success('已删除');
      qc.invalidateQueries({ queryKey: ['kb', kbId, 'docs'] });
    },
  });

  const uploadProps: UploadProps = useMemo(
    () => ({
      multiple: true,
      // 关掉 antd 自带上传列表：待确认文件改由下方「待确认文件」区统一展示（来自后端，关窗重开仍在）。
      showUploadList: false,
      customRequest: async ({ file, onSuccess, onError }) => {
        try {
          // 仅上传存储，文档落为「待确认」，不触发入库。需用户随后点「确认入库」。
          // 后端按「kb + 内容 sha256」幂等：同内容文件若旧记录已 DONE 会直接返回、跳过（不新建文档），
          // 此时提示「已在库中」而非「待确认」，否则用户会困惑为何列表不增。
          const doc = await docApi.upload(kbId, file as File);
          if (doc?.status === 'DONE') {
            message.info(`${(file as File).name} 已在库中，内容未变更，已跳过重复入库`);
          } else {
            message.success(`${(file as File).name} 已上传，待确认入库`);
          }
          qc.invalidateQueries({ queryKey: ['kb', kbId, 'docs'] });
          onSuccess?.({}, new XMLHttpRequest());
        } catch (e) {
          message.error(`${(file as File).name} 上传失败`);
          onError?.(e as Error);
        }
      },
    }),
    [kbId, message, qc],
  );

  // 确认入库：把本知识库所有「待确认」文档一并推进流水线，rowPerChunk 随本次勾选下发。
  const confirmMut = useMutation({
    mutationFn: () => docApi.confirm(kbId, rowPerChunk),
    onSuccess: (docs) => {
      if (!docs || docs.length === 0) {
        message.info('没有待确认的文件');
      } else {
        message.success(`已开始处理 ${docs.length} 个文件`);
      }
      qc.invalidateQueries({ queryKey: ['kb', kbId, 'docs'] });
      setUploadOpen(false);
    },
    onError: () => message.error('确认入库失败'),
  });

  const docs = useMemo(() => docsQuery.data ?? [], [docsQuery.data]);

  // 「待确认（STAGED）」文档只是上传暂存、尚未入库，不进主列表/统计——只在上传弹窗里集中展示与确认。
  const stagedDocs = useMemo(() => docs.filter((d) => d.status === 'STAGED'), [docs]);
  const liveDocs = useMemo(() => docs.filter((d) => d.status !== 'STAGED'), [docs]);
  const stagedCount = stagedDocs.length;

  // 统计卡：只算已入库（非待确认）文档（文档数 / 切片数 / 总大小）。
  const stats = useMemo(() => {
    const chunks = liveDocs.reduce((s, d) => s + toNum(d.totalChunks), 0);
    const size = liveDocs.reduce((s, d) => s + toNum(d.fileSize), 0);
    return { docCount: liveDocs.length, chunks, size };
  }, [liveDocs]);

  // 筛选 + 文件名搜索（待确认文档不在主列表展示）。
  const shown = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return liveDocs.filter((d) => {
      if (filter === 'indexed' && d.status !== 'DONE') return false;
      if (filter === 'indexing' && !isPending(d.status)) return false;
      if (kw && !d.title.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [liveDocs, filter, keyword]);

  if (kbQuery.isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin />
      </div>
    );
  }

  const kb = kbQuery.data;
  const kbStatus = KB_STATUS_META[kb?.indexStatus ?? 'READY'] ?? KB_STATUS_META.READY;
  const subtitle =
    kb?.description?.trim() || `共 ${fmtInt(stats.docCount)} 篇文档 · ${fmtInt(stats.chunks)} 切片`;

  const chips: { key: DocFilter; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'indexed', label: '已完成' },
    { key: 'indexing', label: '处理中' },
  ];

  return (
    <div>
      <button className="kbd-back" onClick={() => navigate('/console/knowledge')}>
        <ArrowLeftOutlined />
        <span className="kbd-back__crumb">返回列表</span>
        <span className="kbd-back__sep">/</span>
        <span className="kbd-back__crumb">知识库</span>
        <span className="kbd-back__sep">/</span>
        <span className="kbd-back__name">{kb?.name}</span>
      </button>

      <div className="kbd-head">
        <div className="kbd-head__main">
          <div className="kbd-head__icon">
            <DatabaseOutlined />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="kbd-head__titlerow">
              <h2 className="kbd-head__title">{kb?.name}</h2>
              <span className={`kbd-badge ${kbStatus.cls}`}>
                <span className="kbd-badge__dot" />
                {kbStatus.label}
              </span>
            </div>
            <div className="kbd-head__sub" title={subtitle}>
              {subtitle}
            </div>
          </div>
        </div>
        <div className="kbd-head__actions">
          <Button icon={<SearchOutlined />} onClick={() => setSearchOpen(true)}>
            检索测试
          </Button>
          <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>
            上传文档
          </Button>
        </div>
      </div>

      <div className="kbd-stats">
        <div className="kbd-stat">
          <div className="kbd-stat__label">文档数</div>
          <div className="kbd-stat__value">{fmtInt(stats.docCount)}</div>
        </div>
        <div className="kbd-stat">
          <div className="kbd-stat__label">切片数</div>
          <div className="kbd-stat__value">{fmtInt(stats.chunks)}</div>
        </div>
        <div className="kbd-stat">
          <div className="kbd-stat__label">总大小</div>
          <div className="kbd-stat__value">{formatBytes(stats.size)}</div>
        </div>
      </div>

      <div className="kbd-toolbar">
        <div className="kbd-chips">
          {chips.map((c) => (
            <button
              key={c.key}
              className={`kbd-chip ${filter === c.key ? 'kbd-chip--active' : ''}`}
              onClick={() => setFilter(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="kbd-toolbar__right">
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
            placeholder="搜索文件名…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ width: 220 }}
          />
        </div>
      </div>

      {docsQuery.isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
          <Spin />
        </div>
      ) : shown.length === 0 ? (
        <Empty
          className="kbd-empty"
          description={liveDocs.length === 0 ? '暂无文档，点击「上传文档」开始' : '没有匹配的文档'}
        />
      ) : (
        <div className="kbd-list">
          {shown.map((row) => {
            const ft = fileType(row.title);
            const pending = isPending(row.status);
            const metaBits = [
              row.sourceType || '上传',
              formatBytes(toNum(row.fileSize)),
              row.totalChunks != null ? `${row.totalChunks} 切片` : null,
              row.createTime ? `加入 ${relativeTime(row.createTime)}` : null,
            ].filter(Boolean);
            return (
              <div className="kbd-row" key={row.id}>
                <div className={`kbd-ftype ${ft.cls}`}>{ft.label}</div>
                <div className="kbd-row__body">
                  <div className="kbd-row__name" title={row.title}>
                    {row.title}
                  </div>
                  <div className="kbd-row__meta">
                    {metaBits.join(' · ')}
                    {row.status === 'FAILED' && row.errorMessage && (
                      <span className="kbd-row__err"> · {row.errorMessage}</span>
                    )}
                  </div>
                </div>
                <div className="kbd-row__right">
                  <div className="kbd-row__actions">
                    <Tooltip title="预览">
                      <Button
                        type="text"
                        size="small"
                        icon={<EyeOutlined />}
                        onClick={() => setPreviewDoc(row)}
                      />
                    </Tooltip>
                    <Tooltip title="切片">
                      <Button
                        type="text"
                        size="small"
                        icon={<ProfileOutlined />}
                        disabled={row.status !== 'DONE'}
                        onClick={() => setChunksDoc(row)}
                      />
                    </Tooltip>
                    {row.status === 'FAILED' && (
                      <Tooltip title="重试">
                        <Button
                          type="text"
                          size="small"
                          icon={<ReloadOutlined />}
                          loading={retryMut.isPending}
                          onClick={() => retryMut.mutate(row.id)}
                        />
                      </Tooltip>
                    )}
                    <Popconfirm title="确认删除该文档？" onConfirm={() => delMut.mutate(row.id)}>
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </div>
                  {pending ? (
                    <span className={`kbd-badge kbd-badge--indexing`}>
                      <Progress
                        type="circle"
                        size={14}
                        percent={DOC_STATUS_PROGRESS[row.status]}
                        showInfo={false}
                        strokeColor="#f59e0b"
                      />
                      {DOC_STATUS_TEXT[row.status]}
                    </span>
                  ) : (
                    <span
                      className={`kbd-badge ${
                        row.status === 'FAILED' ? 'kbd-badge--error' : 'kbd-badge--ready'
                      }`}
                    >
                      <span className="kbd-badge__dot" />
                      {DOC_STATUS_TEXT[row.status]}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        title="上传文档"
        open={uploadOpen}
        onCancel={() => setUploadOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setUploadOpen(false)}>
            取消
          </Button>,
          <Button
            key="confirm"
            type="primary"
            loading={confirmMut.isPending}
            disabled={stagedCount === 0}
            onClick={() => confirmMut.mutate()}
          >
            确认入库{stagedCount > 0 ? `（${stagedCount}）` : ''}
          </Button>,
        ]}
        destroyOnClose
      >
        <Dragger {...uploadProps} style={{ marginBottom: 16 }}>
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽文件到此处上传</p>
          <p className="ant-upload-hint" style={{ color: '#94a3b8' }}>
            支持 PDF / DOCX / XLSX / CSV / MD / TXT，可批量
          </p>
        </Dragger>

        <p style={{ margin: '0 0 12px', fontSize: 12.5, color: '#94a3b8' }}>
          文件上传后停在「待确认」，点下方「确认入库」才开始切片与向量化（确认前不进文档列表）。
        </p>

        {/* 待确认文件：来自后端的 STAGED 文档，关窗重开仍在；确认后才进主列表并开始处理。 */}
        {stagedCount > 0 && (
          <div className="kbd-staged">
            <div className="kbd-staged__title">待确认文件（{stagedCount}）</div>
            <div className="kbd-staged__list">
              {stagedDocs.map((d) => {
                const ft = fileType(d.title);
                return (
                  <div className="kbd-staged__row" key={d.id}>
                    <span className={`kbd-ftype ${ft.cls}`}>{ft.label}</span>
                    <span className="kbd-staged__name" title={d.title}>
                      {d.title}
                    </span>
                    <span className="kbd-staged__size">{formatBytes(toNum(d.fileSize))}</span>
                    <Tooltip title="移除">
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        loading={delMut.isPending && delMut.variables === d.id}
                        onClick={() => delMut.mutate(d.id)}
                      />
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 表格逐行切片：仅对 Excel/CSV 生效，勾选后每个数据行单独成 chunk（适合 FAQ 表，一问一答各自可检索）。
            值在点「确认入库」时统一下发给本批文件，对本批的 PDF/DOCX 等无影响。 */}
        <Checkbox checked={rowPerChunk} onChange={(e) => setRowPerChunk(e.target.checked)}>
          表格逐行切片（仅 Excel/CSV 生效）
          <Tooltip title="勾选后，确认入库时 Excel/CSV 会按「每个数据行」独立切片（一行一 chunk），适合 FAQ / 问答表；不勾选则按字数合并多行。仅对表格类文件生效，对 PDF/DOCX 等无影响；本批没有表格文件时勾选也无妨。已入库文档需删除后重新上传才会按新方式切片。">
            <QuestionCircleOutlined
              style={{ color: '#94a3b8', cursor: 'pointer', marginLeft: 6 }}
            />
          </Tooltip>
        </Checkbox>
      </Modal>

      <SearchTestDrawer kbId={kbId} open={searchOpen} onClose={() => setSearchOpen(false)} />

      {previewDoc && (
        <PreviewModal
          docId={previewDoc.id}
          title={previewDoc.title}
          open={!!previewDoc}
          onClose={() => setPreviewDoc(null)}
        />
      )}
      {chunksDoc && (
        <ChunksDrawer
          docId={chunksDoc.id}
          title={chunksDoc.title}
          open={!!chunksDoc}
          onClose={() => setChunksDoc(null)}
        />
      )}
    </div>
  );
}

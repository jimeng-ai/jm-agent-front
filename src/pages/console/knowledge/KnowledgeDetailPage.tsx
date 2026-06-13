import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Checkbox,
  Popconfirm,
  Progress,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import type { UploadProps } from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EyeOutlined,
  ReloadOutlined,
  SearchOutlined,
  InboxOutlined,
  ProfileOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { docApi, kbApi } from '@/features/knowledge/api';
import {
  DOC_STATUS_COLOR,
  DOC_STATUS_PROGRESS,
  DOC_STATUS_TEXT,
  formatBytes,
  isPending,
} from '@/features/knowledge/utils';
import SearchTestDrawer from '@/features/knowledge/components/SearchTestDrawer';
import PreviewModal from '@/features/knowledge/components/PreviewModal';
import ChunksDrawer from '@/features/knowledge/components/ChunksDrawer';
import type { KbDocument } from '@/api/types';

const { Dragger } = Upload;

export default function KnowledgeDetailPage() {
  const { kbId = '' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<KbDocument | null>(null);
  const [chunksDoc, setChunksDoc] = useState<KbDocument | null>(null);
  // 表格逐行切片：勾选后 Excel/CSV 每数据行独立成 chunk（FAQ 表用）。用 ref 让 customRequest 读到最新值。
  const [rowPerChunk, setRowPerChunk] = useState(false);
  const rowPerChunkRef = useRef(rowPerChunk);
  rowPerChunkRef.current = rowPerChunk;

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
      showUploadList: false,
      customRequest: async ({ file, onSuccess, onError }) => {
        try {
          await docApi.upload(kbId, file as File, rowPerChunkRef.current);
          message.success(`${(file as File).name} 已加入入库队列`);
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

  if (kbQuery.isLoading) return <Spin />;

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/console/knowledge')} />
        <Typography.Title level={3} style={{ margin: 0 }}>
          {kbQuery.data?.name}
        </Typography.Title>
        <Button icon={<SearchOutlined />} onClick={() => setSearchOpen(true)}>
          检索测试
        </Button>
      </Space>

      <Dragger {...uploadProps} style={{ marginBottom: 8 }}>
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p>点击或拖拽文件到此处上传（支持 PDF/DOCX/XLSX/MD，可批量）</p>
      </Dragger>

      {/* 表格逐行切片开关：仅对 Excel/CSV 生效，勾选后每个数据行单独成 chunk（适合 FAQ 表，一问一答各自可检索）。 */}
      <div style={{ marginBottom: 16 }} onClick={(e) => e.stopPropagation()}>
        <Tooltip title="勾选后，上传的 Excel/CSV 会按「每个数据行」独立切片（一行一 chunk），适合 FAQ / 问答表；不勾选则按字数合并多行。仅对表格类文件生效，对 PDF/DOCX 等无影响。已入库文档需删除后重新上传才会按新方式切片。">
          <Checkbox checked={rowPerChunk} onChange={(e) => setRowPerChunk(e.target.checked)}>
            表格逐行切片（Excel/CSV，FAQ 表用）
          </Checkbox>
        </Tooltip>
      </div>

      <Table<KbDocument>
        rowKey="id"
        dataSource={docsQuery.data ?? []}
        loading={docsQuery.isLoading}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: '文档', dataIndex: 'title', ellipsis: true },
          {
            title: '大小',
            dataIndex: 'fileSize',
            width: 100,
            render: (v) => formatBytes(v),
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 200,
            render: (_, row) => (
              <Space>
                <Tag color={DOC_STATUS_COLOR[row.status]}>{DOC_STATUS_TEXT[row.status]}</Tag>
                {row.status !== 'FAILED' && row.status !== 'DONE' && (
                  <Progress
                    type="circle"
                    size={20}
                    percent={DOC_STATUS_PROGRESS[row.status]}
                    showInfo={false}
                  />
                )}
                {row.status === 'FAILED' && row.errorMessage && (
                  <Typography.Text type="danger" ellipsis style={{ maxWidth: 200 }}>
                    {row.errorMessage}
                  </Typography.Text>
                )}
              </Space>
            ),
          },
          { title: '切片', dataIndex: 'totalChunks', width: 80, render: (v) => v ?? '-' },
          {
            title: '上传时间',
            dataIndex: 'createTime',
            width: 180,
          },
          {
            title: '操作',
            width: 240,
            render: (_, row) => (
              <Space>
                <Button size="small" icon={<EyeOutlined />} onClick={() => setPreviewDoc(row)}>
                  预览
                </Button>
                <Button
                  size="small"
                  icon={<ProfileOutlined />}
                  disabled={row.status !== 'DONE'}
                  onClick={() => setChunksDoc(row)}
                >
                  切片
                </Button>
                {row.status === 'FAILED' && (
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    onClick={() => retryMut.mutate(row.id)}
                    loading={retryMut.isPending}
                  >
                    重试
                  </Button>
                )}
                <Popconfirm title="确认删除该文档？" onConfirm={() => delMut.mutate(row.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

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

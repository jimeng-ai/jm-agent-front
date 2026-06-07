import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Popconfirm,
  Progress,
  Space,
  Spin,
  Table,
  Tag,
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
          await docApi.upload(kbId, file as File);
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

      <Dragger {...uploadProps} style={{ marginBottom: 16 }}>
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p>点击或拖拽文件到此处上传（支持 PDF/DOCX/XLSX/MD，可批量）</p>
      </Dragger>

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

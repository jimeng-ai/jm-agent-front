import { useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  Empty,
  Image,
  Input,
  Radio,
  Space,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { UploadFile, UploadProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/api/client';
import { feedbackApi } from '@/features/feedback/api';
import type { FeedbackType } from '@/features/feedback/types';

const { Title, Text, Paragraph } = Typography;

const TYPE_LABEL: Record<FeedbackType, string> = { 1: '问题反馈', 2: '功能建议' };

function AuthedImage({ imageId, width = 64 }: { imageId: number; width?: number }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    let objUrl: string | undefined;
    httpClient
      .get(feedbackApi.imageUrl(imageId), { responseType: 'blob' })
      .then((r) => {
        if (cancelled) return;
        objUrl = URL.createObjectURL(r.data as Blob);
        setUrl(objUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [imageId]);
  return <Image width={width} src={url} />;
}

export default function FeedbackPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [type, setType] = useState<FeedbackType>(1);
  const [content, setContent] = useState('');
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const historyQ = useQuery({ queryKey: ['feedback', 'mine'], queryFn: feedbackApi.listMine });

  const uploadedIds = useMemo(
    () =>
      fileList
        .filter((f) => f.status === 'done' && f.response?.imageId)
        .map((f) => f.response.imageId as number),
    [fileList],
  );

  const customRequest: UploadProps['customRequest'] = async (options) => {
    const { file, onProgress, onSuccess, onError } = options;
    try {
      const res = await feedbackApi.uploadImage(file as File, (e) => {
        if (e.total) onProgress?.({ percent: Math.round((e.loaded / e.total) * 100) });
      });
      onSuccess?.(res);
    } catch (err) {
      onError?.(err as Error);
      message.error((err as Error).message || '图片上传失败');
    }
  };

  const submitM = useMutation({
    mutationFn: () =>
      feedbackApi.submit({ feedbackType: type, content: content.trim(), imageIds: uploadedIds }),
    onSuccess: () => {
      message.success('反馈已提交，感谢！');
      setContent('');
      setFileList([]);
      setType(1);
      qc.invalidateQueries({ queryKey: ['feedback', 'mine'] });
    },
    onError: (e: Error) => message.error(e.message || '提交失败'),
  });

  const uploading = fileList.some((f) => f.status === 'uploading');
  const canSubmit = content.trim().length > 0 && !uploading;

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: 24 }}>
      <Title level={4}>产品反馈</Title>
      <Text type="secondary">遇到问题或想要的功能，告诉我们。支持上传多张截图。</Text>

      <Card style={{ marginTop: 16 }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Radio.Group value={type} onChange={(e) => setType(e.target.value)}>
            <Radio.Button value={1}>问题反馈</Radio.Button>
            <Radio.Button value={2}>功能建议</Radio.Button>
          </Radio.Group>

          <Input.TextArea
            rows={5}
            maxLength={2000}
            showCount
            placeholder="请描述你遇到的问题或希望的功能…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />

          <Upload
            listType="picture-card"
            fileList={fileList}
            customRequest={customRequest}
            accept="image/*"
            multiple
            maxCount={9}
            onChange={({ fileList: fl }) => setFileList(fl)}
            beforeUpload={(file) => {
              const ok = file.type.startsWith('image/');
              if (!ok) message.error('仅支持图片');
              const small = file.size <= 10 * 1024 * 1024;
              if (!small) message.error('单张图片不能超过 10MB');
              return ok && small ? true : Upload.LIST_IGNORE;
            }}
          >
            {fileList.length >= 9 ? null : (
              <div>
                <PlusOutlined />
                <div style={{ marginTop: 8 }}>上传</div>
              </div>
            )}
          </Upload>

          <Button
            type="primary"
            loading={submitM.isPending}
            disabled={!canSubmit}
            onClick={() => submitM.mutate()}
          >
            提交反馈
          </Button>
        </Space>
      </Card>

      <Title level={5} style={{ marginTop: 32 }}>
        我的反馈
      </Title>
      <Card>
        {historyQ.data && historyQ.data.length > 0 ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {historyQ.data.map((item) => (
              <FeedbackHistoryRow
                key={item.id}
                id={item.id}
                type={item.feedbackType}
                content={item.content}
                imageCount={item.imageCount}
                createTime={item.createTime}
              />
            ))}
          </Space>
        ) : (
          <Empty description="还没有反馈记录" />
        )}
      </Card>
    </div>
  );
}

function FeedbackHistoryRow({
  id,
  type,
  content,
  imageCount,
  createTime,
}: {
  id: number;
  type: FeedbackType;
  content: string;
  imageCount: number;
  createTime: string;
}) {
  const [open, setOpen] = useState(false);
  const detailQ = useQuery({
    queryKey: ['feedback', 'detail', id],
    queryFn: () => feedbackApi.detail(id),
    enabled: open,
  });
  return (
    <div style={{ borderBottom: '1px solid #f0f0f0', paddingBottom: 12 }}>
      <Space>
        <Tag color={Number(type) === 1 ? 'volcano' : 'blue'}>
          {TYPE_LABEL[Number(type) as FeedbackType]}
        </Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {new Date(createTime).toLocaleString()}
        </Text>
        {imageCount > 0 && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            · {imageCount} 张图
          </Text>
        )}
      </Space>
      <Paragraph style={{ marginTop: 6, marginBottom: 6 }} ellipsis={{ rows: open ? 99 : 2 }}>
        {content}
      </Paragraph>
      {imageCount > 0 && (
        <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setOpen((v) => !v)}>
          {open ? '收起图片' : '查看图片'}
        </Button>
      )}
      {open && detailQ.data && (
        <div style={{ marginTop: 8 }}>
          <Image.PreviewGroup>
            <Space wrap>
              {detailQ.data.images.map((img) => (
                <AuthedImage key={img.imageId} imageId={img.imageId} />
              ))}
            </Space>
          </Image.PreviewGroup>
        </div>
      )}
    </div>
  );
}

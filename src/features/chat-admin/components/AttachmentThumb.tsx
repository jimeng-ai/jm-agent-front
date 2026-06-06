import { useEffect, useState } from 'react';
import { Image, Spin, Tooltip } from 'antd';
import {
  CloseCircleFilled,
  FileExcelOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileTextOutlined,
  FileOutlined,
} from '@ant-design/icons';
import { resolveAttachmentUrl } from '@/api/agentFiles';
import type { ChatAttachment } from '@/features/chat-admin/types';
import FilePreviewModal from './FilePreviewModal';

function isImage(a: ChatAttachment): boolean {
  if (a.contentType?.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(a.filename);
}

function fileIcon(name: string) {
  if (/\.(xlsx?|csv|tsv)$/i.test(name)) return <FileExcelOutlined style={{ color: '#22a06b' }} />;
  if (/\.pdf$/i.test(name)) return <FilePdfOutlined style={{ color: '#e5484d' }} />;
  if (/\.docx?$/i.test(name)) return <FileWordOutlined style={{ color: '#2b7de9' }} />;
  if (/\.(txt|md|json|log|xml|ya?ml)$/i.test(name))
    return <FileTextOutlined style={{ color: '#8c8c8c' }} />;
  return <FileOutlined style={{ color: '#8c8c8c' }} />;
}

const SQUARE = 56;

/**
 * 一个上传附件的缩略展示：
 *  - 图片 → 小正方形缩略图，点击放大预览（AntD Image 自带缩放/旋转）
 *  - 文档/表格/PDF/文本 → 文件图标块，点击打开内联预览弹窗（FilePreviewModal）
 * url 缺失时（刷新/历史会话）按 fileId 经接口取流解析。onRemove 存在时右上角显示删除按钮。
 */
export default function AttachmentThumb({
  item,
  onRemove,
}: {
  item: ChatAttachment;
  onRemove?: () => void;
}) {
  const image = isImage(item);
  const [imgUrl, setImgUrl] = useState<string | null>(item.url ?? null);
  const [preview, setPreview] = useState(false);

  // 图片缩略图：本地 url 直接用；否则按 fileId 取流生成 object URL
  useEffect(() => {
    if (!image || item.url) return;
    let revoke: string | null = null;
    let cancelled = false;
    resolveAttachmentUrl(item)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        revoke = u;
        setImgUrl(u);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [image, item]);

  const removeBtn = onRemove ? (
    <CloseCircleFilled
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      style={{
        position: 'absolute',
        top: -6,
        right: -6,
        color: '#8c8c8c',
        background: '#fff',
        borderRadius: '50%',
        cursor: 'pointer',
        fontSize: 16,
        zIndex: 1,
      }}
    />
  ) : null;

  if (image) {
    return (
      <div style={{ position: 'relative', display: 'inline-block' }}>
        {imgUrl ? (
          <Image
            src={imgUrl}
            width={SQUARE}
            height={SQUARE}
            // 上传中先用本地图占位但不允许放大预览，待上传完成再开放
            preview={!item.uploading}
            style={{
              objectFit: 'cover',
              borderRadius: 8,
              border: '1px solid #eee',
              opacity: item.uploading ? 0.55 : 1,
            }}
          />
        ) : (
          <div
            style={{
              width: SQUARE,
              height: SQUARE,
              borderRadius: 8,
              border: '1px solid #eee',
              display: 'grid',
              placeItems: 'center',
              background: '#fafafa',
            }}
          >
            <Spin size="small" />
          </div>
        )}
        {/* 上传中：在缩略图上盖一层 loading，给「正在上传」的明确反馈 */}
        {item.uploading && imgUrl && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.35)',
            }}
          >
            <Spin size="small" />
          </div>
        )}
        {!item.uploading && removeBtn}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <Tooltip title={item.uploading ? '上传中…' : '点击预览'}>
        <button
          type="button"
          // 上传中禁止打开预览（文件流还没就绪）
          onClick={() => !item.uploading && setPreview(true)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            maxWidth: 220,
            padding: '8px 12px',
            border: '1px solid #eee',
            borderRadius: 8,
            background: '#fafafa',
            cursor: item.uploading ? 'default' : 'pointer',
            font: 'inherit',
            color: 'inherit',
          }}
        >
          <span style={{ fontSize: 18, display: 'inline-flex' }}>
            {item.uploading ? <Spin size="small" /> : fileIcon(item.filename)}
          </span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.filename}
          </span>
        </button>
      </Tooltip>
      {!item.uploading && removeBtn}
      {preview && <FilePreviewModal item={item} onClose={() => setPreview(false)} />}
    </div>
  );
}

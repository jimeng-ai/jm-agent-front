import { useEffect, useState } from 'react';
import { Button, Empty, Modal, Spin, Tabs } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { fetchDocPreviewBlob } from '@/features/knowledge/api';
import { decodeText } from '@/utils/textDecode';

interface Props {
  docId: string;
  title: string;
  open: boolean;
  onClose: () => void;
}

type Kind = 'image' | 'pdf' | 'sheet' | 'docx' | 'text' | 'other';

// 按文件名后缀判类型，与对话端 FilePreviewModal 保持一致的渲染方式。
function kindOf(filename: string): Kind {
  const n = filename.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n)) return 'image';
  if (n.endsWith('.pdf')) return 'pdf';
  if (/\.(xlsx?|xlsm|csv|tsv)$/.test(n)) return 'sheet';
  if (n.endsWith('.docx') || n.endsWith('.doc')) return 'docx';
  if (/\.(txt|md|markdown|json|log|xml|ya?ml)$/.test(n)) return 'text';
  return 'other';
}

/** 知识库文档内联预览：图片 / PDF(iframe) / 表格(xlsx,csv → HTML 表) / Word(docx → HTML) / 文本。 */
export default function PreviewModal({ docId, title, open, onClose }: Props) {
  const kind = kindOf(title);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [sheets, setSheets] = useState<{ name: string; html: string }[] | null>(null);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let revoke: string | null = null;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        setUrl(null);
        setHtml(null);
        setSheets(null);
        setText(null);
        const blob = await fetchDocPreviewBlob(docId);
        if (cancelled) return;
        if (kind === 'image' || kind === 'pdf' || kind === 'other') {
          const u = URL.createObjectURL(blob);
          revoke = u;
          if (!cancelled) setUrl(u);
        } else if (kind === 'sheet') {
          const buf = await blob.arrayBuffer();
          const XLSX = await import('xlsx');
          const isCsv = /\.(csv|tsv)$/.test(title.toLowerCase());
          // CSV/TSV 是裸文本字节，SheetJS 按 array 读会用 Latin-1 解码致中文乱码：
          // 先严格 UTF-8 解码，失败再退 GBK（兼容 Excel 导出的 GBK CSV），再以 string 交给 SheetJS。
          const wb = isCsv
            ? XLSX.read(decodeText(new Uint8Array(buf)), { type: 'string' })
            : XLSX.read(buf, { type: 'array' });
          const list = wb.SheetNames.map((name) => ({
            name,
            html: XLSX.utils.sheet_to_html(wb.Sheets[name]),
          }));
          if (!cancelled) setSheets(list);
        } else if (kind === 'docx') {
          const buf = await blob.arrayBuffer();
          const mammoth = await import('mammoth');
          const res = await mammoth.convertToHtml({ arrayBuffer: buf });
          if (!cancelled) setHtml(res.value);
        } else if (kind === 'text') {
          const t = decodeText(new Uint8Array(await blob.arrayBuffer()));
          if (!cancelled) setText(t);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '预览失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [open, docId, kind, title]);

  const download = async () => {
    const blob = await fetchDocPreviewBlob(docId);
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = title || `document-${docId}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(u);
  };

  return (
    <Modal
      open={open}
      title={title}
      onCancel={onClose}
      width={kind === 'sheet' || kind === 'pdf' ? '90%' : 860}
      style={{ top: 24 }}
      styles={{ body: { maxHeight: '78vh', overflow: 'auto' } }}
      footer={
        <Button icon={<DownloadOutlined />} onClick={download}>
          下载
        </Button>
      }
      destroyOnClose
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin />
        </div>
      ) : error ? (
        <Empty description={`预览失败：${error}`} />
      ) : kind === 'image' && url ? (
        <img
          src={url}
          alt={title}
          style={{ maxWidth: '100%', display: 'block', margin: '0 auto' }}
        />
      ) : kind === 'pdf' && url ? (
        <iframe src={url} title={title} style={{ width: '100%', height: '74vh', border: 'none' }} />
      ) : kind === 'sheet' && sheets ? (
        sheets.length > 1 ? (
          <Tabs
            size="small"
            items={sheets.map((s) => ({
              key: s.name,
              label: s.name,
              children: (
                <div className="file-preview-html" dangerouslySetInnerHTML={{ __html: s.html }} />
              ),
            }))}
          />
        ) : (
          <div
            className="file-preview-html"
            dangerouslySetInnerHTML={{ __html: sheets[0]?.html ?? '' }}
          />
        )
      ) : kind === 'docx' && html != null ? (
        <div className="file-preview-html" dangerouslySetInnerHTML={{ __html: html }} />
      ) : kind === 'text' && text != null ? (
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontSize: 13 }}>
          {text}
        </pre>
      ) : url ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: '#8c8c8c' }}>该文件类型暂不支持内联预览</p>
          <Button type="primary" href={url} target="_blank" rel="noopener">
            在新标签打开 / 下载
          </Button>
        </div>
      ) : (
        <Empty description="无法预览" />
      )}
    </Modal>
  );
}

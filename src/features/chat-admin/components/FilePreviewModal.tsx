import { useEffect, useState } from 'react';
import { Modal, Spin, Empty, Button, Tabs } from 'antd';
import { resolveAttachmentUrl, fetchAgentFileBlob } from '@/api/agentFiles';
import type { ChatAttachment } from '@/features/chat-admin/types';

type Kind = 'image' | 'pdf' | 'sheet' | 'docx' | 'text' | 'other';

function kindOf(a: ChatAttachment): Kind {
  const n = a.filename.toLowerCase();
  const ct = a.contentType || '';
  if (ct.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n)) return 'image';
  if (ct === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (/\.(xlsx?|csv|tsv)$/.test(n)) return 'sheet';
  if (n.endsWith('.docx') || n.endsWith('.doc')) return 'docx';
  if (/\.(txt|md|json|log|xml|ya?ml)$/.test(n)) return 'text';
  return 'other';
}

/** 内联预览：图片 / PDF(iframe) / 表格(xlsx,csv → HTML 表) / Word(docx → HTML) / 文本。 */
export default function FilePreviewModal({ item, onClose }: { item: ChatAttachment; onClose: () => void }) {
  const kind = kindOf(item);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [sheets, setSheets] = useState<{ name: string; html: string }[] | null>(null);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    const getBlob = async () =>
      item.url ? await (await fetch(item.url)).blob() : await fetchAgentFileBlob(item.fileId);

    (async () => {
      try {
        setLoading(true);
        setError(null);
        if (kind === 'image' || kind === 'pdf' || kind === 'other') {
          const u = await resolveAttachmentUrl(item);
          if (!item.url) revoke = u;
          if (!cancelled) setUrl(u);
        } else if (kind === 'sheet') {
          const buf = await (await getBlob()).arrayBuffer();
          const XLSX = await import('xlsx');
          const wb = XLSX.read(buf, { type: 'array' });
          const list = wb.SheetNames.map((name) => ({
            name,
            html: XLSX.utils.sheet_to_html(wb.Sheets[name]),
          }));
          if (!cancelled) setSheets(list);
        } else if (kind === 'docx') {
          const buf = await (await getBlob()).arrayBuffer();
          const mammoth = await import('mammoth');
          const res = await mammoth.convertToHtml({ arrayBuffer: buf });
          if (!cancelled) setHtml(res.value);
        } else if (kind === 'text') {
          const t = await (await getBlob()).text();
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
  }, [item, kind]);

  return (
    <Modal
      open
      title={item.filename}
      footer={null}
      onCancel={onClose}
      width={kind === 'sheet' || kind === 'pdf' ? '90%' : 860}
      style={{ top: 24 }}
      styles={{ body: { maxHeight: '78vh', overflow: 'auto' } }}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin />
        </div>
      ) : error ? (
        <Empty description={`预览失败：${error}`} />
      ) : kind === 'image' && url ? (
        <img src={url} alt={item.filename} style={{ maxWidth: '100%', display: 'block', margin: '0 auto' }} />
      ) : kind === 'pdf' && url ? (
        <iframe src={url} title={item.filename} style={{ width: '100%', height: '74vh', border: 'none' }} />
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
          <div className="file-preview-html" dangerouslySetInnerHTML={{ __html: sheets[0]?.html ?? '' }} />
        )
      ) : kind === 'docx' && html != null ? (
        <div className="file-preview-html" dangerouslySetInnerHTML={{ __html: html }} />
      ) : kind === 'text' && text != null ? (
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontSize: 13 }}>{text}</pre>
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

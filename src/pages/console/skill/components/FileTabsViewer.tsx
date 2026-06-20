import { App, Button, Empty, Tabs, Tooltip, Typography } from 'antd';
import { CopyOutlined, FolderOpenOutlined } from '@ant-design/icons';
import Markdown from '@/components/Markdown';
import type { SkillFileView } from '@/features/skill/types';

// size 后端按字符串下发,展示前 Number() 兜底(见 jm-api-numbers-as-strings 约定)
function fmtSize(size: string | number): string {
  const n = Number(size);
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function FileBody({ file }: { file: SkillFileView }) {
  const { message } = App.useApp();
  if (file.binary) {
    return <Typography.Text type="secondary">（二进制文件,不支持预览）</Typography.Text>;
  }
  const content = file.content ?? '';
  const isMd = file.path.toLowerCase().endsWith('.md');

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {fmtSize(file.size)}
          {file.truncated && ' · 文件较大,仅展示前 512KB'}
        </Typography.Text>
        <Tooltip title="复制">
          <Button
            size="small"
            type="text"
            icon={<CopyOutlined />}
            onClick={() => {
              navigator.clipboard.writeText(content);
              message.success('已复制');
            }}
          />
        </Tooltip>
      </div>
      {isMd ? (
        <div className="skill-file-md">
          <Markdown content={content} />
        </div>
      ) : (
        <pre className="skill-code">{content}</pre>
      )}
    </>
  );
}

export default function FileTabsViewer({ files }: { files: SkillFileView[] }) {
  return (
    <section className="skill-files">
      <div className="skill-files__head">
        <FolderOpenOutlined style={{ fontSize: 15, color: '#475569' }} />
        <span className="skill-files__title">文件</span>
        <span className="skill-files__count">{files.length}</span>
      </div>
      <div className="skill-files__body">
        {files.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无脚本文件" />
        ) : (
          <Tabs
            type="line"
            items={files.map((f) => ({
              key: f.path,
              label: f.path,
              children: <FileBody file={f} />,
            }))}
          />
        )}
      </div>
    </section>
  );
}

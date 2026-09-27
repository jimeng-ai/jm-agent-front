import { useRef } from 'react';
import { App, Button, Drawer, Spin, Tooltip, Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { skillApi } from '@/features/skill/api';
import SkillTheme from '@/features/skill/SkillTheme';
import { SOURCE_LABEL } from '@/features/skill/skillMeta';
import Markdown from '@/components/Markdown';
import SkillEvalPanel from '@/features/skill/components/SkillEvalPanel';
import SkillDetailHeader from './components/SkillDetailHeader';
import FileTabsViewer from './components/FileTabsViewer';
import './skill.css';

interface Props {
  id: string | null;
  onClose: () => void;
}

function SectionTitle({ children, extra }: { children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        margin: '24px 0 12px',
      }}
    >
      <Typography.Text strong style={{ fontSize: 13, color: '#475569' }}>
        {children}
      </Typography.Text>
      {extra}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '6px 0' }}>
      <span style={{ width: 64, flex: 'none', fontSize: 13, color: '#64748B' }}>{label}</span>
      <span style={{ fontSize: 13, color: '#1E293B', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

export default function SkillDetailDrawer({ id, onClose }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const filesRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['skill', 'detail', id],
    queryFn: () => skillApi.get(id!),
    enabled: !!id,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['skill', 'list'] });
    qc.invalidateQueries({ queryKey: ['skill', 'detail', id] });
  }

  // 头部操作:成功后刷新列表与当前详情
  function action(fn: (skillId: string) => Promise<unknown>, ok: string) {
    return () =>
      fn(id!)
        .then(() => {
          message.success(ok);
          refresh();
        })
        .catch((e: { message?: string }) => message.error(e?.message || '操作失败'));
  }

  const removeMut = useMutation({
    mutationFn: () => skillApi.remove(id!),
    onSuccess: () => {
      message.success('已删除');
      qc.invalidateQueries({ queryKey: ['skill', 'list'] });
      onClose();
    },
    onError: (e: { message?: string }) => message.error(e?.message || '删除失败'),
  });

  const files = data?.files ?? [];
  const frontmatter = data
    ? `---\nname: ${data.name}\ndescription: ${data.description || ''}\n---`
    : '';
  const fullSkillMd = data ? `${frontmatter}\n\n${data.body || ''}` : '';

  return (
    <Drawer
      width={840}
      open={!!id}
      onClose={onClose}
      title={
        data ? (
          <SkillTheme>
            <SkillDetailHeader
              skill={data}
              fileCount={files.length}
              onJumpToFiles={() =>
                filesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
              onShare={action(skillApi.share, '已共享给团队')}
              onUnshare={action(skillApi.unshare, '已取消共享')}
              onEnable={action(skillApi.enable, '已启用')}
              onDisable={action(skillApi.disable, '已停用')}
              onRemove={() => removeMut.mutate()}
              onImprove={() => {
                onClose();
                navigate(`/console/skill/builder?skillId=${data.id}`);
              }}
              onContinue={
                data.builderSessionId
                  ? () => {
                      onClose();
                      navigate(`/console/skill/builder?session=${data.builderSessionId}`);
                    }
                  : undefined
              }
            />
          </SkillTheme>
        ) : (
          'Skill 详情'
        )
      }
    >
      <SkillTheme>
        {isLoading ? (
          <Spin />
        ) : data ? (
          <>
            {/* 元数据条 */}
            <div
              style={{
                padding: '4px 16px',
                background: '#F8FAFC',
                border: '1px solid #EEF2F6',
                borderRadius: 8,
              }}
            >
              <MetaRow label="来源" value={SOURCE_LABEL[data.source] ?? data.source} />
              <MetaRow label="创建人" value={data.ownerName || '—'} />
            </div>

            {/* SKILL.md */}
            <SectionTitle
              extra={
                <Tooltip title="复制完整 SKILL.md">
                  <Button
                    size="small"
                    type="text"
                    icon={<CopyOutlined />}
                    onClick={() => {
                      navigator.clipboard.writeText(fullSkillMd);
                      message.success('已复制');
                    }}
                  />
                </Tooltip>
              }
            >
              SKILL.md
            </SectionTitle>
            <pre className="skill-frontmatter">{frontmatter}</pre>
            {data.body ? (
              <div className="skill-md-body">
                <Markdown content={data.body} />
              </div>
            ) : (
              <Typography.Text type="secondary">无正文</Typography.Text>
            )}

            {/* 附带文件（所有类型都展示：PROMPT skill 也可能带 evals/evals.json 等存档文件）。
                根目录 evals/ 是测试用例，只存档、不会下发给运行。 */}
            {files.length > 0 && (
              <div ref={filesRef} style={{ scrollMarginTop: 8 }}>
                <FileTabsViewer files={files} />
              </div>
            )}

            {/* 评测:只对已发布 skill 跑(草稿的测试在构建器里由 skill-creator 自己做)。
                该 skill 无 evals/evals.json 时后端回业务错误,由面板 onError 直接 message.error 展示。 */}
            {data.status !== 'DRAFT' && <SkillEvalPanel skillId={data.id} />}
          </>
        ) : null}
      </SkillTheme>
    </Drawer>
  );
}

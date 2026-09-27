import type { Agent } from '@/api/types';

interface AgentPublishSummaryProps {
  values?: Partial<Agent>;
  knowledgeCount: number;
  skillCount?: number;
  connectionCount?: number;
  skillCountError?: boolean;
  connectionCountError?: boolean;
}

function countLabel(count: number | undefined, failed?: boolean) {
  if (failed) return '读取失败';
  if (count === undefined) return '读取中…';
  return count > 0 ? `${count} 个` : '未绑定';
}

export default function AgentPublishSummary({
  values,
  knowledgeCount,
  skillCount,
  connectionCount,
  skillCountError,
  connectionCountError,
}: AgentPublishSummaryProps) {
  return (
    <section className="agent-publish-summary" data-testid="agent-publish-summary">
      <div className="agent-publish-summary-head">
        <strong>发布检查</strong>
        <span>当前编辑内容与即时授权概览</span>
      </div>
      <dl className="agent-publish-summary-list">
        <div>
          <dt>身份</dt>
          <dd>{values?.name || values?.code || '未命名 Agent'}</dd>
        </div>
        <div>
          <dt>代号</dt>
          <dd>{values?.code || '未填写'}</dd>
        </div>
        <div>
          <dt>模型</dt>
          <dd>{values?.model || '未选择'}</dd>
        </div>
        <div>
          <dt>知识库</dt>
          <dd>{knowledgeCount > 0 ? `${knowledgeCount} 个` : '未绑定'}</dd>
        </div>
        <div>
          <dt>技能授权</dt>
          <dd>{countLabel(skillCount, skillCountError)}</dd>
        </div>
        <div>
          <dt>数据连接</dt>
          <dd>{countLabel(connectionCount, connectionCountError)}</dd>
        </div>
      </dl>
      <div className="agent-publish-summary-foot">
        基础配置和知识库先保存为草稿，再发布到对话端。技能与数据连接授权调用独立接口，修改后立即生效。
      </div>
    </section>
  );
}

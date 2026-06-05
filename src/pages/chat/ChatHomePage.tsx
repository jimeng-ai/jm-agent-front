import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Spin } from 'antd';
import { agentApi } from '@/features/agent/api';
import { conversationApi } from '@/features/chat-admin/conversationApi';
import { SearchIcon } from '@/components/icons/AtlasIcons';
import type { Agent } from '@/api/types';

const GLYPH_COLORS = [
  { bg: '#dbeafe', fg: '#1d4ed8' },
  { bg: '#dcfce7', fg: '#15803d' },
  { bg: '#fef3c7', fg: '#b45309' },
  { bg: '#fce7f3', fg: '#be185d' },
  { bg: '#ede9fe', fg: '#6d28d9' },
  { bg: '#cffafe', fg: '#0e7490' },
];

function AgentCard({ agent, index, onOpen }: { agent: Agent; index: number; onOpen: () => void }) {
  const color = GLYPH_COLORS[index % GLYPH_COLORS.length];
  const glyph = (agent.name || agent.code || 'A').slice(0, 1);
  return (
    <button type="button" className="chat-agent-card" onClick={onOpen}>
      <div className="chat-agent-card-head">
        <div className="chat-agent-glyph" style={{ background: color.bg, color: color.fg }}>
          {glyph}
        </div>
        <div className="chat-agent-card-title">
          <div className="name">
            {agent.name}
            {agent.status === 'PUBLISHED' && agent.hasUnpublishedChanges && (
              <span
                className="chat-agent-draft-badge"
                title="该 Agent 有改动尚未发布，对话端仍使用上次发布的版本"
              >
                有草稿未发布
              </span>
            )}
          </div>
          <div className="model mono">{agent.model || 'claude-sonnet-4.5'}</div>
        </div>
        <span className={'chat-agent-status' + (agent.status === 'PUBLISHED' ? ' published' : '')}>
          {agent.status === 'PUBLISHED' ? '已发布' : '草稿'}
        </span>
      </div>
      <div className="chat-agent-desc">
        {agent.description || '暂无描述，点击开始与该 Agent 对话。'}
      </div>
    </button>
  );
}

export default function ChatHomePage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const agentQ = useQuery({ queryKey: ['chat', 'agents'], queryFn: () => agentApi.list() });
  const conversationsQ = useQuery({
    queryKey: ['chat', 'conversations'],
    queryFn: () => conversationApi.list(),
  });
  const sessions = useMemo(() => conversationsQ.data ?? [], [conversationsQ.data]);

  const agentData = agentQ.data;
  const agents = useMemo(() => agentData ?? [], [agentData]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return agents;
    return agents.filter(
      (a) =>
        a.name?.toLowerCase().includes(kw) ||
        a.code?.toLowerCase().includes(kw) ||
        a.description?.toLowerCase().includes(kw) ||
        a.model?.toLowerCase().includes(kw),
    );
  }, [agents, q]);

  // 最近使用：按会话历史里出现过的 agentId 去重，映射到当前存在的 Agent。
  const recentAgents = useMemo(() => {
    const tsOf = (t: string | null) => (t ? new Date(t).getTime() : 0);
    const seen = new Set<string>();
    const out: Agent[] = [];
    const sorted = [...sessions].sort(
      (a, b) => tsOf(b.lastMessageAt ?? b.createTime) - tsOf(a.lastMessageAt ?? a.createTime),
    );
    for (const s of sorted) {
      if (seen.has(s.agentId)) continue;
      seen.add(s.agentId);
      const a = agents.find((x) => String(x.id) === String(s.agentId));
      if (a) out.push(a);
      if (out.length >= 4) break;
    }
    return out;
  }, [sessions, agents]);

  const published = filtered.filter((a) => a.status === 'PUBLISHED');
  const drafts = filtered.filter((a) => a.status !== 'PUBLISHED');

  const openAgent = (a: Agent) => navigate(`/chat/agent/${a.id}`);

  if (agentQ.isLoading) {
    return (
      <div className="chat-home-loading">
        <Spin />
      </div>
    );
  }

  const renderGrid = (items: Agent[], offset = 0) => (
    <div className="chat-agent-grid">
      {items.map((a, i) => (
        <AgentCard key={a.id} agent={a} index={offset + i} onOpen={() => openAgent(a)} />
      ))}
    </div>
  );

  return (
    <div className="chat-home">
      <div className="chat-home-inner">
        <header className="chat-home-head">
          <h1>选择一个 Agent，开始对话</h1>
          <p>
            你的工作区目前有 {agents.length} 个 Agent
            {published.length > 0 ? ` · ${published.length} 个已发布` : ''}
          </p>
          <div className="chat-home-search">
            <SearchIcon size={15} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="按名称、用途或模型搜索 Agent…"
            />
          </div>
        </header>

        {agents.length === 0 ? (
          <div className="chat-home-empty">
            <p>工作区还没有 Agent。</p>
            <button
              type="button"
              className="atlas-btn primary"
              onClick={() => navigate('/console/agents')}
            >
              去新建 Agent
            </button>
          </div>
        ) : (
          <>
            {!q && recentAgents.length > 0 && (
              <section className="chat-agent-section">
                <div className="chat-agent-section-label">
                  最近使用 <span>{recentAgents.length}</span>
                </div>
                {renderGrid(recentAgents)}
              </section>
            )}

            {published.length > 0 && (
              <section className="chat-agent-section">
                <div className="chat-agent-section-label">
                  已发布 <span>{published.length}</span>
                </div>
                {renderGrid(published)}
              </section>
            )}

            {drafts.length > 0 && (
              <section className="chat-agent-section">
                <div className="chat-agent-section-label">
                  草稿 <span>{drafts.length}</span>
                </div>
                {renderGrid(drafts, published.length)}
              </section>
            )}

            {filtered.length === 0 && (
              <div className="chat-home-empty">
                <p>没有匹配「{q}」的 Agent。</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Spin } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { conversationApi, type ConversationView } from '@/features/chat-admin/conversationApi';
import { agentApi } from '@/features/agent/api';
import { glyphColor } from '@/utils/glyph';
import { PlusIcon, SearchIcon } from '@/components/icons/AtlasIcons';

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function tsOf(c: ConversationView): number {
  const t = c.lastMessageAt ?? c.createTime;
  return t ? new Date(t).getTime() : 0;
}

function bucketOf(ts: number): '今天' | '昨天' | '更早' {
  const today = startOfDay(Date.now());
  const day = startOfDay(ts);
  if (day === today) return '今天';
  if (day === today - 86400000) return '昨天';
  return '更早';
}

function timeLabel(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const bucket = bucketOf(ts);
  if (bucket === '今天' || bucket === '昨天') {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function ConversationsPanel() {
  const navigate = useNavigate();
  const { conversationId: activeId } = useParams();
  const queryClient = useQueryClient();
  const { modal, message } = App.useApp();
  const [q, setQ] = useState('');

  const listQ = useQuery({
    queryKey: ['chat', 'conversations'],
    queryFn: () => conversationApi.list(),
  });
  const sessions = useMemo(() => listQ.data ?? [], [listQ.data]);

  // 会话行只带 agentId/agentName，没带头像：复用对话首页同一份 Agent 列表缓存，
  // 据 agentId 查头像（react-query 同 key 自动去重，不会多发请求）。
  const agentsQ = useQuery({ queryKey: ['chat', 'agents'], queryFn: () => agentApi.list() });
  const avatarOf = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const a of agentsQ.data ?? []) m.set(String(a.id), a.avatarUrl);
    return m;
  }, [agentsQ.data]);

  const onDelete = async (id: string) => {
    try {
      await conversationApi.remove(id);
      queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      if (id === activeId) navigate('/chat');
      message.success('会话已删除');
    } catch {
      message.error('删除失败，请重试');
    }
  };

  // 删除前弹确认框；X 按钮与中键删除都走这里。
  const confirmDelete = (s: ConversationView) => {
    modal.confirm({
      title: '删除会话',
      content: `确定删除「${s.title}」吗？删除后不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => onDelete(s.id),
    });
  };

  const groups = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const filtered = [...sessions]
      .filter(
        (s) => !kw || s.title.toLowerCase().includes(kw) || s.agentName.toLowerCase().includes(kw),
      )
      .sort((a, b) => tsOf(b) - tsOf(a));
    const order: Array<'今天' | '昨天' | '更早'> = ['今天', '昨天', '更早'];
    const map = new Map<string, ConversationView[]>();
    for (const s of filtered) {
      const b = bucketOf(tsOf(s));
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(s);
    }
    return order.filter((o) => map.has(o)).map((o) => ({ label: o, items: map.get(o)! }));
  }, [sessions, q]);

  return (
    <aside className="chat-conv-panel">
      <div className="chat-conv-head">
        <button
          type="button"
          className="atlas-btn primary chat-new-btn"
          onClick={() => navigate('/chat')}
        >
          <PlusIcon size={14} className="icon" />
          新对话
        </button>
        <div className="chat-conv-search">
          <SearchIcon size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索会话…" />
        </div>
      </div>

      <div className="chat-conv-list">
        {listQ.isLoading ? (
          <div className="chat-conv-empty">
            <Spin size="small" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="chat-conv-empty">
            还没有对话记录
            <br />
            选择一个 Agent 开始
          </div>
        ) : groups.length === 0 ? (
          <div className="chat-conv-empty">没有匹配的会话</div>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="chat-conv-group">
              <div className="chat-conv-group-label">{g.label}</div>
              {g.items.map((s) => (
                <div key={s.id} className="chat-conv-item-wrap">
                  <button
                    type="button"
                    className={'chat-conv-item' + (s.id === activeId ? ' active' : '')}
                    onClick={() => navigate(`/chat/c/${s.id}`)}
                    onAuxClick={(e) => {
                      // 中键删除该会话（同样先弹确认框）
                      if (e.button === 1) {
                        e.preventDefault();
                        confirmDelete(s);
                      }
                    }}
                    title={s.title}
                  >
                    {avatarOf.get(String(s.agentId)) ? (
                      <img
                        className="chat-conv-item-avatar"
                        src={avatarOf.get(String(s.agentId))}
                        alt={s.agentName}
                      />
                    ) : (
                      <div
                        className="chat-conv-item-avatar glyph"
                        style={{
                          background: glyphColor(s.agentName).bg,
                          color: glyphColor(s.agentName).fg,
                        }}
                      >
                        {s.agentName?.slice(0, 1) || 'A'}
                      </div>
                    )}
                    <div className="chat-conv-item-main">
                      <div className="chat-conv-item-title">{s.title}</div>
                      <div className="chat-conv-item-meta">
                        <span className="agent">{s.agentName}</span>
                        <span className="time">{timeLabel(tsOf(s))}</span>
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="chat-conv-del"
                    aria-label="删除会话"
                    title="删除会话"
                    onClick={(e) => {
                      e.stopPropagation();
                      confirmDelete(s);
                    }}
                  >
                    <CloseOutlined />
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="chat-conv-foot">对话已加密保存在工作区</div>
    </aside>
  );
}

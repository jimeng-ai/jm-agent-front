import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Input, Spin, Tag } from 'antd';
import type { InputRef } from 'antd';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import {
  AgentIcon,
  BookIcon,
  ListIcon,
  PlugIcon,
  SearchIcon,
  SkillIcon,
} from '@/components/icons/AtlasIcons';
import { useGlobalSearch } from '../hooks/useGlobalSearch';
import type { SearchItem } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
}

const TRACE_STATUS_LABEL: Record<string, string> = {
  SUCCESS: '成功',
  FAILED: '失败',
  ERROR: '失败',
  RUNNING: '进行中',
  CANCELLED: '已取消',
};

// 后端把 createTime 序列化成 "YYYY-MM-DD HH:mm:ss" 字符串（非 epoch），也兼容纯数字时间戳。
function fmtTime(v?: string): string {
  if (!v) return '';
  const n = Number(v);
  const d = Number.isFinite(n) && String(n) === v.trim() ? dayjs(n) : dayjs(v);
  return d.isValid() ? d.format('MM-DD HH:mm') : '';
}

/** ⌘K 命令面板：跨 Agent / 文档 / Trace 的快速搜索与跳转。 */
export default function CommandPalette({ open, onClose }: Props) {
  const navigate = useNavigate();
  const inputRef = useRef<InputRef>(null);
  const [input, setInput] = useState('');
  const [active, setActive] = useState(0);

  const { data, items, loading, empty, idle } = useGlobalSearch(input, open);

  // 打开时聚焦输入框、清空旧状态；关闭后复位查询词。
  useEffect(() => {
    if (open) {
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
    setInput('');
  }, [open]);

  // 结果变化时把高亮收回顶部，避免越界。
  useEffect(() => {
    setActive(0);
  }, [items.length]);

  const go = (item: SearchItem) => {
    if (item.kind === 'agent') navigate(`/console/agents/${item.hit.id}`);
    else if (item.kind === 'document') navigate(`/console/knowledge/${item.hit.kbId}`);
    else if (item.kind === 'plugin') navigate(`/console/plugins/${item.hit.id}`);
    else if (item.kind === 'skill')
      navigate(`/console/skills?skillId=${encodeURIComponent(item.hit.id)}`);
    else navigate(`/console/traces?traceId=${encodeURIComponent(item.hit.traceId)}`);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[active];
      if (item) go(item);
    }
  };

  // 拍平索引 → 用于判断某条是否高亮（与 useGlobalSearch 的拍平顺序一致：Agent→文档→Trace）。
  const indexOf = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((it, i) => {
      const key =
        it.kind === 'agent'
          ? `a:${it.hit.id}`
          : it.kind === 'document'
            ? `d:${it.hit.id}`
            : it.kind === 'plugin'
              ? `p:${it.hit.id}`
              : it.kind === 'skill'
                ? `s:${it.hit.id}`
                : `t:${it.hit.traceId}`;
      map.set(key, i);
    });
    return map;
  }, [items]);

  const renderRow = (
    key: string,
    idx: number,
    icon: React.ReactNode,
    main: React.ReactNode,
    extra?: React.ReactNode,
  ) => (
    <div
      key={key}
      className={'cmd-row' + (idx === active ? ' is-active' : '')}
      onMouseEnter={() => setActive(idx)}
      onMouseDown={(e) => {
        // mousedown 而非 click：避免 Input 失焦带来的闪烁
        e.preventDefault();
        const item = items[idx];
        if (item) go(item);
      }}
    >
      <span className="cmd-row__icon">{icon}</span>
      <span className="cmd-row__main">{main}</span>
      {extra ? <span className="cmd-row__extra">{extra}</span> : null}
    </div>
  );

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      destroyOnHidden
      width={600}
      styles={{ body: { padding: 0 } }}
      className="cmd-palette"
    >
      <div className="cmd-input">
        <SearchIcon size={16} />
        <Input
          ref={inputRef}
          variant="borderless"
          placeholder="搜索 Agent、文档、插件、技能、Trace…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <span className="kbd">ESC</span>
      </div>

      <div className="cmd-body">
        {idle ? (
          <div className="cmd-hint">输入关键词搜索 Agent、文档、插件、技能或调用日志</div>
        ) : loading ? (
          <div className="cmd-hint">
            <Spin size="small" /> <span style={{ marginLeft: 8 }}>搜索中…</span>
          </div>
        ) : empty ? (
          <div className="cmd-hint">未找到相关结果</div>
        ) : (
          <>
            {data.agents.length > 0 && (
              <div className="cmd-group">
                <div className="cmd-group__title">Agent</div>
                {data.agents.map((a) =>
                  renderRow(
                    `a:${a.id}`,
                    indexOf.get(`a:${a.id}`) ?? 0,
                    <AgentIcon size={16} />,
                    <span className="cmd-row__title">{a.name}</span>,
                    <Tag color={a.status === 'PUBLISHED' ? 'green' : 'default'}>
                      {a.status === 'PUBLISHED' ? '已发布' : '草稿'}
                    </Tag>,
                  ),
                )}
              </div>
            )}

            {data.documents.length > 0 && (
              <div className="cmd-group">
                <div className="cmd-group__title">文档</div>
                {data.documents.map((d) =>
                  renderRow(
                    `d:${d.id}`,
                    indexOf.get(`d:${d.id}`) ?? 0,
                    <BookIcon size={16} />,
                    <>
                      <span className="cmd-row__title">{d.title}</span>
                      {d.kbName ? <span className="cmd-row__sub">{d.kbName}</span> : null}
                    </>,
                    d.sourceType ? <Tag>{d.sourceType.toUpperCase()}</Tag> : null,
                  ),
                )}
              </div>
            )}

            {data.plugins.length > 0 && (
              <div className="cmd-group">
                <div className="cmd-group__title">插件</div>
                {data.plugins.map((p) =>
                  renderRow(
                    `p:${p.id}`,
                    indexOf.get(`p:${p.id}`) ?? 0,
                    <PlugIcon size={16} />,
                    <>
                      <span className="cmd-row__title">{p.name}</span>
                      {p.description ? <span className="cmd-row__sub">{p.description}</span> : null}
                    </>,
                    <Tag color={p.status === 'PUBLISHED' ? 'green' : 'default'}>
                      {p.status === 'PUBLISHED' ? '已发布' : '草稿'}
                    </Tag>,
                  ),
                )}
              </div>
            )}

            {data.skills.length > 0 && (
              <div className="cmd-group">
                <div className="cmd-group__title">技能</div>
                {data.skills.map((s) =>
                  renderRow(
                    `s:${s.id}`,
                    indexOf.get(`s:${s.id}`) ?? 0,
                    <SkillIcon size={16} />,
                    <>
                      <span className="cmd-row__title">{s.name}</span>
                      {s.description ? <span className="cmd-row__sub">{s.description}</span> : null}
                    </>,
                    s.skillType ? <Tag>{s.skillType === 'DOER' ? 'DOER' : 'PROMPT'}</Tag> : null,
                  ),
                )}
              </div>
            )}

            {data.traces.length > 0 && (
              <div className="cmd-group">
                <div className="cmd-group__title">Trace</div>
                {data.traces.map((t) =>
                  renderRow(
                    `t:${t.traceId}`,
                    indexOf.get(`t:${t.traceId}`) ?? 0,
                    <ListIcon size={16} />,
                    <span className="cmd-row__title">
                      {[t.agentName, fmtTime(t.createTime)].filter(Boolean).join(' · ') ||
                        t.traceId}
                    </span>,
                    t.status ? (
                      <Tag
                        color={
                          t.status === 'SUCCESS' ? 'green' : t.status === 'RUNNING' ? 'blue' : 'red'
                        }
                      >
                        {TRACE_STATUS_LABEL[t.status] ?? t.status}
                      </Tag>
                    ) : null,
                  ),
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

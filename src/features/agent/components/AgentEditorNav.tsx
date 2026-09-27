import type { AgentEditorSection } from '@/features/agent/types';
import { AGENT_EDITOR_GROUPS } from '@/features/agent/types';

interface AgentEditorNavProps {
  active: AgentEditorSection;
  onChange: (section: AgentEditorSection) => void;
}

export default function AgentEditorNav({ active, onChange }: AgentEditorNavProps) {
  return (
    <nav className="agent-editor-nav" data-testid="agent-editor-nav" aria-label="Agent 编辑区">
      {AGENT_EDITOR_GROUPS.map((group) => (
        <div className="agent-editor-nav-group" key={group.title}>
          <span className="agent-editor-nav-title">{group.title}</span>
          {group.items.map((item) => (
            <button
              className="agent-editor-nav-button"
              type="button"
              key={item.key}
              aria-current={active === item.key ? 'page' : undefined}
              onClick={() => onChange(item.key)}
            >
              {item.label}
            </button>
          ))}
          {group.immediate && (
            <p className="agent-editor-nav-note">更改后立即生效，不随草稿保存或发布。</p>
          )}
        </div>
      ))}
    </nav>
  );
}

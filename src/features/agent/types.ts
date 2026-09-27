export type AgentListFilter = 'all' | 'unpublished' | 'draft';

export type AgentCardAction = 'publish' | 'unpublish' | 'delete' | null;

export type AgentEditorSection =
  | 'base'
  | 'prompt'
  | 'model'
  | 'knowledge'
  | 'skills'
  | 'connectors';

export interface AgentEditorNavItem {
  key: AgentEditorSection;
  label: string;
}

export interface AgentEditorNavGroup {
  title: string;
  items: AgentEditorNavItem[];
  immediate?: boolean;
}

export const AGENT_EDITOR_GROUPS: AgentEditorNavGroup[] = [
  {
    title: 'Agent 配置',
    items: [
      { key: 'base', label: '基础信息' },
      { key: 'prompt', label: '人设 Prompt' },
      { key: 'model', label: '模型参数' },
      { key: 'knowledge', label: '知识库' },
    ],
  },
  {
    title: '即时授权',
    immediate: true,
    items: [
      { key: 'skills', label: '技能' },
      { key: 'connectors', label: '数据连接' },
    ],
  },
];

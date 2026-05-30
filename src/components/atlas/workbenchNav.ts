import {
  DashboardIcon,
  AgentIcon,
  BookIcon,
  PlugIcon,
  PlayIcon,
  SparklesIcon,
} from '@/components/icons/AtlasIcons';

export type NavItem = {
  key: string;
  label: string;
  path: string;
  Icon: (p: { size?: number; className?: string }) => JSX.Element;
  /** 该入口所属模块码；成员需被授权该模块才可见。留空表示不受模块限制（如仪表盘）。 */
  module?: string;
};

// 注意：仪表盘在前、对话在后（按需求调整顺序）。
export const WORKBENCH_NAV: NavItem[] = [
  { key: 'dashboard', label: '仪表盘', path: '/console/dashboard', Icon: DashboardIcon },
  { key: 'chat', label: '对话', path: '/chat', Icon: SparklesIcon, module: 'CHAT_MODULE' },
  { key: 'agents', label: 'Agents', path: '/console/agents', Icon: AgentIcon, module: 'AGENT_MODULE' },
  { key: 'knowledge', label: '知识库', path: '/console/knowledge', Icon: BookIcon, module: 'KB_MODULE' },
  { key: 'plugins', label: '插件', path: '/console/plugins', Icon: PlugIcon, module: 'PLUGIN_MODULE' },
];

export const DEBUG_NAV: NavItem[] = [
  {
    key: 'playground',
    label: '调试 Playground',
    path: '/console/playground',
    Icon: PlayIcon,
    module: 'AGENT_MODULE',
  },
];

export function workbenchCrumbs(pathname: string): string[] {
  const match = [...WORKBENCH_NAV, ...DEBUG_NAV].find((n) => pathname.startsWith(n.path));
  if (!match) return ['控制台'];
  return ['Atlas', match.label];
}

import {
  DashboardIcon,
  AgentIcon,
  BookIcon,
  PlayIcon,
  SparklesIcon,
  ListIcon,
  MessageIcon,
  SkillIcon,
  PlugIcon,
  DatabaseIcon,
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
  {
    key: 'agents',
    label: 'Agents',
    path: '/console/agents',
    Icon: AgentIcon,
    module: 'AGENT_MODULE',
  },
  {
    key: 'knowledge',
    label: '知识库',
    path: '/console/knowledge',
    Icon: BookIcon,
    module: 'KB_MODULE',
  },
  {
    key: 'skills',
    label: '技能',
    path: '/console/skills',
    Icon: SkillIcon,
  },
  // 外部连接：不设 module，侧栏对超管本就可见；非超管点进去是空状态（可接受）。
  {
    key: 'connections',
    label: '外部连接',
    path: '/console/connections',
    Icon: PlugIcon,
  },
  // 数据连接（连接器）：与上面同源——两个入口读写同一张 connection 表，这个是类型感知的新入口。
  // 同样不设 module，理由同上。
  {
    key: 'connectors',
    label: '数据连接',
    path: '/console/connectors',
    Icon: DatabaseIcon,
  },
];

// 顶部栏入口（不在左侧侧边栏渲染）：产品反馈放在上方导航栏。
export const TOPBAR_NAV: NavItem[] = [
  { key: 'feedback', label: '产品反馈', path: '/console/feedback', Icon: MessageIcon },
];

export const DEBUG_NAV: NavItem[] = [
  {
    key: 'playground',
    label: '调试台',
    path: '/console/playground',
    Icon: PlayIcon,
    module: 'AGENT_MODULE',
  },
  { key: 'traces', label: '调用日志 · Trace', path: '/console/traces', Icon: ListIcon },
];

export function workbenchCrumbs(pathname: string): string[] {
  const match = [...WORKBENCH_NAV, ...TOPBAR_NAV, ...DEBUG_NAV].find((n) =>
    pathname.startsWith(n.path),
  );
  if (!match) return ['控制台'];
  return ['Atlas', match.label];
}

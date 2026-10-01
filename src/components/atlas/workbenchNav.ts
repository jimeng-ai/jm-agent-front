import {
  DashboardIcon,
  AgentIcon,
  BookIcon,
  PlayIcon,
  SparklesIcon,
  ListIcon,
  BellIcon,
  MessageIcon,
  SkillIcon,
  PlugIcon,
  DatabaseIcon,
  DataGraphIcon,
} from '@/components/icons/AtlasIcons';

export type NavItem = {
  key: string;
  label: string;
  path: string;
  Icon: (p: { size?: number; className?: string }) => JSX.Element;
  /** 该入口所属模块码；成员需被授权该模块才可见。留空表示不受模块限制（如仪表盘）。 */
  module?: string;
  /** 治理入口仅企业超管可见；权限请求失败时保持 fail-open。 */
  superAdminOnly?: boolean;
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
  // 兼容的 HTTP egress 入口。与新版数据连接同属敏感治理面，只对超管展示。
  {
    key: 'connections',
    label: 'HTTP 出站（兼容）',
    path: '/console/connections',
    Icon: PlugIcon,
    superAdminOnly: true,
  },
  // 数据连接（连接器）：与上面同源，这个是含治理与语义层的主入口。
  {
    key: 'connectors',
    label: '数据连接',
    path: '/console/connectors',
    Icon: DatabaseIcon,
    superAdminOnly: true,
  },
  // 数据星图给业务人员和产品看：按模块授权，企业超管在角色里勾上「数据星图」即可（超管自己始终可见）。
  {
    key: 'data-graph',
    label: '数据星图',
    path: '/console/data-graph',
    Icon: DataGraphIcon,
    module: 'DATA_GRAPH_MODULE',
  },
  // 写操作审批：待办性质的超管入口，和「数据连接」同源但不是管连接。
  {
    key: 'pending-writes',
    label: '写操作审批',
    path: '/console/pending-writes',
    Icon: BellIcon,
    superAdminOnly: true,
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

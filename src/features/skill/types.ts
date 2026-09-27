export interface SkillView {
  id: string;
  name: string;
  description: string;
  scope: 'PRIVATE' | 'TENANT';
  skillType: 'PROMPT' | 'DOER';
  source: 'UPLOAD' | 'MARKET' | 'AI_GEN';
  status: 'DRAFT' | 'ACTIVE' | 'DISABLED';
  ownerUserId: string;
  version: number;
  /** 构建器草稿所属的会话 id（「继续编辑」用）；不是构建器草稿为 null */
  builderSessionId?: string | null;
}

/** DOER bundle 里的单个文件（脚本/依赖/README 等）。size 后端按字符串下发。 */
export interface SkillFileView {
  path: string;
  content: string | null;
  binary: boolean;
  truncated: boolean;
  size: string | number;
}

/** 详情接口返回：元数据 + SKILL.md 正文 + DOER 脚本文件 */
export interface SkillDetailView extends SkillView {
  /** 创建者显示名（后端解析 displayName/username 后下发）；老数据/查不到时可能为空 */
  ownerName?: string | null;
  body: string | null;
  files: SkillFileView[];
}

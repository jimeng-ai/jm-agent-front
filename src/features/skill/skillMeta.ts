import type { SkillView } from './types';

export type SkillType = SkillView['skillType']; // 'PROMPT' | 'DOER'
export type SkillScope = SkillView['scope']; // 'PRIVATE' | 'TENANT'
export type SkillStatus = SkillView['status']; // 'DRAFT' | 'ACTIVE' | 'DISABLED'
export type SkillSource = SkillView['source']; // 'UPLOAD' | 'MARKET' | 'AI_GEN'

export const TYPE_LABEL: Record<SkillType, string> = { PROMPT: 'Prompt', DOER: 'Doer' };
export const SCOPE_LABEL: Record<SkillScope, string> = { PRIVATE: '私有', TENANT: '团队共享' };
export const STATUS_LABEL: Record<SkillStatus, string> = {
  DRAFT: '草稿',
  ACTIVE: '启用',
  DISABLED: '停用',
};
export const SOURCE_LABEL: Record<SkillSource, string> = {
  UPLOAD: '上传',
  MARKET: '市场',
  AI_GEN: 'AI 生成',
};

export const STATUS_DOT: Record<SkillStatus, string> = {
  ACTIVE: '#10B981',
  DISABLED: '#94A3B8',
  DRAFT: '#F59E0B',
};

export const TYPE_STYLE: Record<SkillType, { color: string; bg: string; border: string }> = {
  DOER: { color: '#4338CA', bg: '#EEF2FF', border: '#C7D2FE' },
  PROMPT: { color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' },
};

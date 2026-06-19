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
}

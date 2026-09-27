import { get, post } from '@/api/client';

/** RECALL=不提 skill 名、测模型会不会想到用；CAPABILITY=明确要求用，测用对没用对。 */
export type SkillEvalMode = 'RECALL' | 'CAPABILITY';
export type SkillEvalStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

/**
 * 一轮评测记录。后端 Long/BigDecimal 按字符串下发（passRate 是字符串小数如 "0.8"，
 * counts 可能按字符串下发），故这些字段按 string|number 容错接。
 */
export interface SkillEvalRun {
  id: string;
  status: SkillEvalStatus;
  mode: SkillEvalMode;
  skillName?: string | null;
  totalCases?: string | number | null;
  finishedCases?: string | number | null;
  passedCases?: string | number | null;
  passRate?: string | number | null;
  /** 评委聚合结果的 JSON 字符串（List<用例>），形态见下方 SkillEvalCase。 */
  resultJson?: string | null;
  error?: string | null;
}

/** resultJson 里单个用例的评委结果（防御式，字段皆可选）。 */
export interface SkillEvalCaseGrading {
  summary?: { passed?: number; failed?: number; total?: number; passRate?: number };
  expectations?: { text?: string; passed?: boolean; evidence?: string }[];
  claims?: { claim?: string; type?: string; verified?: boolean; evidence?: string }[];
  evalFeedback?: { overall?: string; suggestions?: { assertion?: string; reason?: string }[] };
  skillInvoked?: boolean;
  skillInvokedEvidence?: string;
}

export interface SkillEvalCase {
  id?: string | number;
  prompt?: string;
  passed?: boolean;
  error?: string;
  grading?: SkillEvalCaseGrading;
  transcript?: string;
  artifacts?: string[];
}

export const skillEvalApi = {
  // 只评已发布的 skill。草稿的测试由构建器里的 skill-creator 自己做（对照运行 + 评审页），
  // 后端也已去掉「按构建器会话评草稿」的入口。
  start: (skillId: string, mode: SkillEvalMode) =>
    post<SkillEvalRun>('/skills/eval/runs', { skillId, mode }),
  get: (runId: string) => get<SkillEvalRun>(`/skills/eval/runs/${runId}`),
};

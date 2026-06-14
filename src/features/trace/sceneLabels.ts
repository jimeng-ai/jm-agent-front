// scene_code（= biz_type）→ 中文标签。新增功能场景时在此补一项。
export const SCENE_LABELS: Record<string, string> = {
  chat: '普通对话',
  rag_answer: '知识库问答',
  agent_exec: '代码执行 Agent',
  agent_gen: '生成 Agent',
  plugin_gen: '插件生成',
  plugin_refine: '插件调优',
};

export const SCENE_OPTIONS = Object.entries(SCENE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export const sceneLabel = (code?: string) => (code ? (SCENE_LABELS[code] ?? code) : '-');

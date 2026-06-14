/**
 * 模型目录的**离线兜底**——正常走 GET /data/admin/models（见 features/agent/api.ts getModelCatalog）。
 * 仅在接口加载中/失败时使用，避免下拉空白。新增模型应改 Nacos ai.model-catalog，不要改这里。
 * `maxTemp` 标注各厂商 temperature 上限：Anthropic(Claude)=1，OpenAI(GPT)=2。
 */
export const FALLBACK_MODELS = [
  { label: 'Claude Opus 4.7', value: 'claude-opus-4-7', provider: 'anthropic', maxTemp: 1 },
  { label: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6', provider: 'anthropic', maxTemp: 1 },
  {
    label: 'Claude Haiku 4.5',
    value: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    maxTemp: 1,
  },
  { label: 'GPT-4o', value: 'gpt-4o', provider: 'openai', maxTemp: 2 },
  { label: 'GPT-4o mini', value: 'gpt-4o-mini', provider: 'openai', maxTemp: 2 },
];

/** temperature 默认上限（未匹配到模型时的兜底，取较宽松的 OpenAI 上限）。 */
export const DEFAULT_MAX_TEMP = 2;

export const DEFAULT_SYSTEM_PROMPT = `你是一个有帮助的智能助手。请用中文回答用户的问题。`;

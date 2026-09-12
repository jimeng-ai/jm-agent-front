import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Collapse,
  Progress,
  Segmented,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { ExperimentOutlined } from '@ant-design/icons';
import {
  skillEvalApi,
  type SkillEvalCase,
  type SkillEvalMode,
  type SkillEvalRun,
} from '@/features/skill/evalApi';

const { Text } = Typography;

/** 计数字段可能按字符串下发，统一 parse 容错。 */
const toInt = (v: unknown): number => {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
};

/** passRate 是字符串小数（如 "0.8"）→ 百分比整数。缺失时按 passed/total 兜底。 */
const toPct = (run: SkillEvalRun): number => {
  const raw = run.passRate;
  const rate = raw == null || raw === '' ? NaN : Number(raw);
  if (Number.isFinite(rate)) return Math.round(rate * 100);
  const total = toInt(run.totalCases);
  return total > 0 ? Math.round((toInt(run.passedCases) / total) * 100) : 0;
};

/** resultJson 解析成用例数组；解析失败或非数组返回 null（走原始 JSON 折叠展示）。 */
function parseCases(resultJson?: string | null): SkillEvalCase[] | null {
  if (!resultJson) return null;
  try {
    const parsed = JSON.parse(resultJson);
    return Array.isArray(parsed) ? (parsed as SkillEvalCase[]) : null;
  } catch {
    return null;
  }
}

function CaseList({ cases }: { cases: SkillEvalCase[] }) {
  return (
    <Collapse
      size="small"
      style={{ marginTop: 12 }}
      items={cases.map((c, i) => {
        const passed = c.passed === true;
        const g = c.grading;
        return {
          key: String(c.id ?? i),
          label: (
            <Space size={8}>
              <Tag color={passed ? 'green' : 'red'}>{passed ? '通过' : '未通过'}</Tag>
              <Text ellipsis style={{ maxWidth: 240 }}>
                {c.prompt || `用例 ${i + 1}`}
              </Text>
            </Space>
          ),
          children: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              {c.prompt && (
                <div>
                  <Text strong>提示词：</Text>
                  <Text>{c.prompt}</Text>
                </div>
              )}
              {g?.skillInvoked !== undefined && (
                <div>
                  <Text strong>是否命中技能：</Text>
                  <Tag color={g.skillInvoked ? 'green' : 'orange'}>
                    {g.skillInvoked ? '已调用' : '未调用'}
                  </Tag>
                  {g.skillInvokedEvidence && (
                    <Text type="secondary"> {g.skillInvokedEvidence}</Text>
                  )}
                </div>
              )}
              {g?.summary && (g.summary.total ?? 0) > 0 && (
                <div>
                  <Text strong>断言：</Text>
                  <Text>
                    {g.summary.passed ?? 0}/{g.summary.total} 通过
                  </Text>
                </div>
              )}
              {g?.expectations?.length ? (
                <div>
                  <Text strong>逐条断言：</Text>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {g.expectations.map((e, j) => (
                      <li key={j}>
                        <Tag color={e.passed ? 'green' : 'red'}>{e.passed ? '过' : '否'}</Tag>
                        <Text>{e.text}</Text>
                        {e.evidence && (
                          <div style={{ color: '#999', fontSize: 12 }}>证据：{e.evidence}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {c.error && <Alert type="error" showIcon message={c.error} />}
            </div>
          ),
        };
      })}
    />
  );
}

export default function SkillEvalPanel({ conversationId }: { conversationId?: string }) {
  const { message } = App.useApp();
  const [mode, setMode] = useState<SkillEvalMode>('RECALL');
  const [runId, setRunId] = useState<string>();

  const startMut = useMutation({
    mutationFn: () => skillEvalApi.start(conversationId!, mode),
    onSuccess: (run) => setRunId(String(run.id)),
    onError: (e: Error) => message.error(e.message),
  });

  const runQuery = useQuery({
    queryKey: ['skillEval', 'run', runId],
    queryFn: () => skillEvalApi.get(runId!),
    enabled: !!runId,
    refetchInterval: (q) => (q.state.data?.status === 'RUNNING' ? 2000 : false),
  });

  const run = runQuery.data;
  const cases = run ? parseCases(run.resultJson) : null;

  return (
    <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 16, paddingTop: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <Text strong>技能评测</Text>
        <Space>
          <Segmented
            size="small"
            value={mode}
            onChange={(v) => setMode(v as SkillEvalMode)}
            options={[
              { label: '召回', value: 'RECALL' },
              { label: '能力', value: 'CAPABILITY' },
            ]}
          />
          <Button
            size="small"
            type="primary"
            icon={<ExperimentOutlined />}
            loading={startMut.isPending}
            disabled={!conversationId}
            onClick={() => startMut.mutate()}
          >
            跑评测
          </Button>
        </Space>
      </div>

      {!conversationId && (
        <Text type="secondary" style={{ fontSize: 13 }}>
          开始构建后可对草稿跑评测。
        </Text>
      )}

      {run?.status === 'RUNNING' && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space>
            <Spin size="small" />
            <Text type="secondary">
              评测进行中… {toInt(run.finishedCases)}/{toInt(run.totalCases)} 用例
            </Text>
          </Space>
          <Progress
            percent={
              toInt(run.totalCases) > 0
                ? Math.round((toInt(run.finishedCases) / toInt(run.totalCases)) * 100)
                : 0
            }
            size="small"
          />
        </Space>
      )}

      {run?.status === 'FAILED' && (
        <Alert type="error" showIcon message="评测失败" description={run.error || '未知错误'} />
      )}

      {run?.status === 'COMPLETED' && (
        <div>
          <Space size={16} wrap>
            <Text strong>通过率 {toPct(run)}%</Text>
            <Text type="secondary">
              {toInt(run.passedCases)}/{toInt(run.totalCases)} 用例通过
            </Text>
          </Space>
          {cases ? (
            <CaseList cases={cases} />
          ) : run.resultJson ? (
            <Collapse
              size="small"
              style={{ marginTop: 12 }}
              items={[
                {
                  key: 'raw',
                  label: '原始结果 JSON',
                  children: (
                    <pre
                      style={{
                        margin: 0,
                        fontSize: 11,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {(() => {
                        try {
                          return JSON.stringify(JSON.parse(run.resultJson), null, 2);
                        } catch {
                          return run.resultJson;
                        }
                      })()}
                    </pre>
                  ),
                },
              ]}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

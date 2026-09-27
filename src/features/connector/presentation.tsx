/* eslint-disable react-refresh/only-export-components -- 本文件刻意集中 connector 的纯展示契约与小型渲染器。 */
import { Badge, Space, Tag, Tooltip } from 'antd';
import { SyncOutlined, WarningOutlined } from '@ant-design/icons';
import {
  SEMANTIC_PARTIAL_CONSEQUENCE,
  formatTime,
  semanticCoverageOf,
  semanticStatusMeta,
} from './semantic';
import type { ConnectorView, SemanticDataTier } from './types';

export const CAPABILITY_LABELS: Record<string, string> = {
  QUERY: '能查',
  DESCRIBE: '能自描述',
  INVOKE: '能调用',
  SYNC: '能同步',
  SUBSCRIBE: '能订阅',
  HEALTH: '能报状态',
};

/** 平台侧写闸；数据库账号权限是另一道独立的闸。 */
export const WRITE_POLICY_OPTIONS = [
  { value: 'FORBIDDEN', label: '只读 —— 平台拒绝一切写操作（推荐）' },
  {
    value: 'REQUIRE_APPROVAL',
    label: '写需审批 —— 模型提交，超管在「写操作审批」页逐条批准后才执行',
  },
  { value: 'AUTO', label: '写自动 —— 模型可直接改数据，仅受护栏与行数上限约束' },
];

export interface SemanticDataTierMeta {
  value: SemanticDataTier;
  label: string;
  alert: 'info' | 'warning' | 'error';
  title: string;
  egress: string;
  extra?: string;
}

/**
 * 数据出库三档。egress 与后端 SemanticDataTier.egressStatement() 保持同文；
 * 详情接口给了 semanticDataTierEgress 时，展示层仍优先使用后端正本。
 */
export const SEMANTIC_DATA_TIERS: SemanticDataTierMeta[] = [
  {
    value: 'METADATA_ONLY',
    label: '第 1 档 · 纯元数据 —— 只有表名、列名、类型、索引和客户自己写的注释出库，不做任何聚合',
    alert: 'warning',
    title: '这一档不是免费的：推出来的表关系里大约一半是错的，而且不报错',
    egress:
      '只有表名、列名、数据类型、可空性、索引和客户自己写在库里的注释会离开数据库。' +
      '不做任何聚合，没有一条业务记录参与运算。代价：仅凭名字推表关系，真实生产库上精确率约 0.49，' +
      '推出来的关系需要人工确认。',
    extra:
      '选这一档就等于同时接受「表关系要人工确认」：错的那一半不会报错，只会让模型 join 出一个看着很正常的错数字。',
  },
  {
    value: 'DERIVED_STATS',
    label: '第 2 档 · 派生统计【默认】 —— 允许在客户库内聚合，只带走统计量，逐行记录不出库',
    alert: 'info',
    title: '第 2 档（默认）会带走什么',
    egress:
      '在纯元数据之上，允许在客户库内做聚合、只把算出来的统计量带走：' +
      'distinct 数、NULL 率、min/max、字符形状、两列之间的包含率、基数、minhash sketch' +
      '（K 个哈希值，不是原始值）。逐行的业务记录不出库。' +
      '但要如实说明：min/max 本身就是两个真实取值，低基数列的 distinct 数也会透露取值空间的大小。',
  },
  {
    value: 'SAMPLE_VALUES',
    label:
      '第 3 档 · 样本值 —— 客户库里的【真实取值】本身出库（某列 top-k 实际值、低基数列的全量维值索引）',
    alert: 'error',
    title: '这一档会把客户库里的真实取值带进我们的库',
    egress:
      '在派生统计之上，允许把【真实取值】本身带出数据库：某列的 top-k 实际值、低基数列的全量维值索引。' +
      '说白了，「地区」列的维值索引意味着贵司所有地区名进入我们的库，' +
      '「客户名称」列的 top-k 意味着最高频的真实客户名进入我们的库。' +
      '这一档默认关闭，只能由企业超管显式开启。取值出库前会过 PII 过滤（按列名与取值形状两道），' +
      '但如实说明：同类实现的 PII 检测召回率约 95%，即大约每 20 个 PII 取值仍可能漏掉 1 个，' +
      '过滤是减损手段，不是保证。',
    extra:
      '开启前请和客户把上面这句话原样说一遍：top-k 天然会把 PII 捞出来——姓名、手机号、地址就躺在高频取值里；' +
      '有过滤不等于过滤得干净，这一档的正当性来自「有人为它做过一次决定」，不来自过滤器。',
  },
];

export const DEFAULT_SEMANTIC_DATA_TIER: SemanticDataTier = 'DERIVED_STATS';

export const semanticDataTierMeta = (
  value?: string | null,
): SemanticDataTierMeta | undefined => SEMANTIC_DATA_TIERS.find((tier) => tier.value === value);

export function CapabilityTags({ capabilities }: { capabilities?: string[] | null }) {
  if (!capabilities?.length) {
    return (
      <Tooltip title="尚未完成接入探测，运行「测试连接」后回填">
        <span className="connector-muted">未探测</span>
      </Tooltip>
    );
  }
  return (
    <Space size={[4, 4]} wrap>
      {capabilities.map((capability) => (
        <Tag key={capability}>{CAPABILITY_LABELS[capability] ?? capability}</Tag>
      ))}
    </Space>
  );
}

export function HealthBadge({ connector }: { connector: ConnectorView }) {
  const status =
    connector.healthState === 'HEALTHY'
      ? 'success'
      : connector.healthState === 'UNHEALTHY'
        ? 'error'
        : 'default';
  const text =
    connector.healthState === 'HEALTHY'
      ? '健康'
      : connector.healthState === 'UNHEALTHY'
        ? '异常'
        : '未探测';
  const badge = <Badge status={status} text={text} />;
  return connector.healthReason ? <Tooltip title={connector.healthReason}>{badge}</Tooltip> : badge;
}

export function SemanticStatusTags({ connector }: { connector: ConnectorView }) {
  const meta = semanticStatusMeta(connector.semanticStatus);
  const running = connector.semanticStatus === 'RUNNING';
  const coverage = semanticCoverageOf(connector);
  const tip = running ? (
    <>
      {connector.semanticClaimAt ? (
        <>
          本次开始于：{formatTime(connector.semanticClaimAt)}
          <br />
        </>
      ) : null}
      正在生成语义层
    </>
  ) : (
    <>
      {meta.hint}
      {connector.semanticSyncedAt ? (
        <>
          <br />
          最近一次成功生成：{formatTime(connector.semanticSyncedAt)}
        </>
      ) : null}
      {connector.semanticNote ? (
        <>
          <br />
          说明：{connector.semanticNote}
        </>
      ) : null}
    </>
  );

  return (
    <Space size={4} wrap>
      <Tooltip title={tip}>
        <Tag color={meta.color} icon={running ? <SyncOutlined spin /> : undefined}>
          {meta.label}
        </Tag>
      </Tooltip>
      {coverage ? (
        <Tooltip
          title={
            <>
              {SEMANTIC_PARTIAL_CONSEQUENCE}
              {coverage.gaps.map((gap) => (
                <div key={gap.label} style={{ marginTop: 6 }}>
                  · <b>{gap.label}</b>：{gap.desc}
                </div>
              ))}
            </>
          }
        >
          <Tag color="warning" icon={<WarningOutlined />}>
            不完整
          </Tag>
        </Tooltip>
      ) : null}
    </Space>
  );
}

export function SemanticTierTag({ connector }: { connector: ConnectorView }) {
  const meta = semanticDataTierMeta(connector.semanticDataTier);
  const label = connector.semanticDataTierLabel || connector.semanticDataTier || '未知档位';
  const explanation =
    connector.semanticDataTierEgress ||
    meta?.egress ||
    '这个后端版本没有返回出库档位说明。后端的默认档是第 2 档 · 派生统计。';
  return (
    <Tooltip title={explanation}>
      <Tag
        color={
          connector.semanticDataTier === 'SAMPLE_VALUES' ? 'red' : meta ? undefined : 'orange'
        }
      >
        {label}
      </Tag>
    </Tooltip>
  );
}

export interface ConnectorAttentionIssue {
  key: string;
  title: string;
  consequence: string;
  nextStep: string;
}

/** 只收真正需要动作的异常；高风险但明确选择过的 AUTO / SAMPLE_VALUES 留在安全轮廓里，不冒充故障。 */
export function connectorAttentionIssues(connector: ConnectorView): ConnectorAttentionIssue[] {
  const issues: ConnectorAttentionIssue[] = [];
  if (connector.status === 'DISABLED') {
    issues.push({
      key: 'disabled',
      title: '连接已停用',
      consequence: '已绑定的 Agent 无法再通过它访问客户系统。',
      nextStep: '确认停用仍符合预期；需要恢复时从更多菜单启用。',
    });
  }
  if (connector.healthState === 'UNHEALTHY') {
    issues.push({
      key: 'unhealthy',
      title: '最近一次探测失败',
      consequence: connector.healthReason || 'Agent 调用这条连接时会直接失败。',
      nextStep: '检查网络、凭据和客户侧权限后，重新测试连接。',
    });
  } else if (connector.healthState === 'UNKNOWN') {
    issues.push({
      key: 'unknown-health',
      title: '连通性尚未验证',
      consequence: '目前不能确认 Agent 真能访问目标系统。',
      nextStep: '运行一次测试连接，留下可复核的探测结果。',
    });
  }
  if (connector.writePolicy === 'FORBIDDEN' && !connector.readonlyVerified) {
    issues.push({
      key: 'readonly',
      title: '数据库账号只读性未验证',
      consequence: '平台虽然拒绝写操作，但凭据本身可能仍有超出需要的权限。',
      nextStep: '换成客户侧只读账号后重新测试。',
    });
  }
  if (connector.writePolicy !== 'FORBIDDEN' && connector.readonlyVerified) {
    issues.push({
      key: 'write-account-mismatch',
      title: '写策略与账号权限不一致',
      consequence: '平台会放行写请求，但客户库账号已验证为只读，实际执行仍会失败。',
      nextStep: '若确实需要写，按当前策略重新授权账号；否则把平台策略收紧为只读。',
    });
  }
  if (connector.semanticStatus === 'FAILED') {
    issues.push({
      key: 'semantic-failed',
      title: '语义说明生成失败',
      consequence: connector.semanticSyncedAt
        ? '本次生成失败；最近一次成功说明仍可能按每条状态、验证结论与当前档位参与模型上下文，不能把它当成本轮新结果。'
        : '本次生成失败，且无法确认是否留有一次成功生成的说明；实际可见内容仍取决于留存行、每条状态与当前档位。',
      nextStep: '打开语义工作台查看失败说明并重跑。',
    });
  }
  const coverage = semanticCoverageOf(connector);
  if (coverage) {
    issues.push({
      key: 'semantic-partial',
      title: '语义说明不完整',
      consequence: SEMANTIC_PARTIAL_CONSEQUENCE,
      nextStep: '打开语义工作台查看缺口，再决定补跑或人工确认。',
    });
  }
  if (!semanticDataTierMeta(connector.semanticDataTier)) {
    issues.push({
      key: 'unknown-egress-tier',
      title: '当前出库档位无法解释',
      consequence: '前端不能确认这一枚举代表什么数据会离开客户库。',
      nextStep: '先升级前端，再修改这条连接；编辑时会原样回填，避免静默改档。',
    });
  }
  return issues;
}

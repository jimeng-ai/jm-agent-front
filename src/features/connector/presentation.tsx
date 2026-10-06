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
  { value: 'FORBIDDEN', label: '只读（推荐）—— 不允许修改数据' },
  { value: 'REQUIRE_APPROVAL', label: '写需审批 —— 超管批准后才执行' },
  { value: 'AUTO', label: '写自动 —— AI 可直接修改数据' },
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
    label: '第 1 档 · 纯元数据',
    alert: 'info',
    title: '最保守的档位',
    egress: '只有表名、列名、类型和注释会离开数据库，不读任何数据。',
  },
  {
    value: 'DERIVED_STATS',
    label: '第 2 档 · 派生统计【默认】',
    alert: 'info',
    title: '默认档位',
    egress: '只带走统计结果（如去重数、空值率、最大最小值），不带走逐行数据。',
  },
  {
    value: 'SAMPLE_VALUES',
    label: '第 3 档 · 样本值',
    alert: 'error',
    title: '最开放的档位',
    egress: '会带走部分真实取值（如高频值）；个人信息会先过滤，但不能保证全部滤掉。',
    extra: '开启前请和客户确认。',
  },
];

export const DEFAULT_SEMANTIC_DATA_TIER: SemanticDataTier = 'DERIVED_STATS';

export const semanticDataTierMeta = (
  value?: string | null,
): SemanticDataTierMeta | undefined => SEMANTIC_DATA_TIERS.find((tier) => tier.value === value);

export function CapabilityTags({ capabilities }: { capabilities?: string[] | null }) {
  if (!capabilities?.length) {
    return (
      <Tooltip title="还没测试过，请点「测试连接」。">
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
  const explanation = connector.semanticDataTierEgress || meta?.egress || '暂无档位说明。';
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
      consequence: '绑定它的 Agent 无法再访问客户系统。',
      nextStep: '需要恢复时，点「启用」。',
    });
  }
  if (connector.healthState === 'UNHEALTHY') {
    issues.push({
      key: 'unhealthy',
      title: '最近一次探测失败',
      consequence: connector.healthReason || 'Agent 调用这个连接会失败。',
      nextStep: '检查网络和账号后，重新测试连接。',
    });
  } else if (connector.healthState === 'UNKNOWN') {
    issues.push({
      key: 'unknown-health',
      title: '尚未测试连接',
      consequence: '不确定 Agent 能否访问这个系统。',
      nextStep: '点「测试连接」确认一次。',
    });
  }
  if (connector.writePolicy === 'FORBIDDEN' && !connector.readonlyVerified) {
    issues.push({
      key: 'readonly',
      title: '只读权限未验证',
      consequence: '账号可能还有多余的写权限。',
      nextStep: '换成只读账号后重新测试。',
    });
  }
  if (connector.writePolicy !== 'FORBIDDEN' && connector.readonlyVerified) {
    issues.push({
      key: 'write-account-mismatch',
      title: '写策略与账号冲突',
      consequence: '平台允许写入，但账号只读，写入会失败。',
      nextStep: '需要写入就给账号授权，否则改回只读。',
    });
  }
  if (connector.semanticStatus === 'FAILED') {
    issues.push({
      key: 'semantic-failed',
      title: '语义说明生成失败',
      consequence: connector.semanticSyncedAt
        ? '本次失败，AI 可能仍在用上一次的说明。'
        : '本次失败，无法确认 AI 是否有可用说明。',
      nextStep: '打开语义工作台，查看原因并重新生成。',
    });
  }
  const coverage = semanticCoverageOf(connector);
  if (coverage) {
    issues.push({
      key: 'semantic-partial',
      title: '语义说明不完整',
      consequence: SEMANTIC_PARTIAL_CONSEQUENCE,
      nextStep: '打开语义工作台，查看缺口后重新生成。',
    });
  }
  if (!semanticDataTierMeta(connector.semanticDataTier)) {
    issues.push({
      key: 'unknown-egress-tier',
      title: '出库档位无法识别',
      consequence: '无法确认哪些数据会离开客户库。',
      nextStep: '请联系平台管理员。',
    });
  }
  return issues;
}

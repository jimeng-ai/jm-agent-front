import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Drawer, Form, Grid, Input, Select, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CompassOutlined, ExperimentOutlined } from '@ant-design/icons';
import { connectorApi } from '../api';
import type { ConnectorKind, ConnectorUpsert, ConnectorView, ProbeOutcome } from '../types';
import {
  CAPABILITY_LABELS,
  DEFAULT_SEMANTIC_DATA_TIER,
  SEMANTIC_DATA_TIERS,
  WRITE_POLICY_OPTIONS,
  semanticDataTierMeta,
} from '../presentation';
import GrantScriptPanel from './GrantScriptPanel';
import SchemaForm from './SchemaForm';

type ParamValues = Record<string, string | number | boolean | string[] | undefined>;

interface FormValues {
  name: string;
  displayName?: string;
  kind: string;
  params: ParamValues;
  writePolicy: string;
  semanticDataTier: string;
}

interface Props {
  open: boolean;
  connector: ConnectorView | null;
  kinds: ConnectorKind[];
  submitting: boolean;
  /** 每次打开 Drawer 都唯一；异步响应只能更新发起它的会话。 */
  sessionToken: string;
  /** URL 深链指定要定位的治理字段；目前 semantic 对应数据出库档位。 */
  initialSection?: string | null;
  onClose: () => void;
  onSubmit: (payload: ConnectorUpsert, sessionToken: string) => void;
}

type ContentsProps = Omit<Props, 'open'>;

interface ProbeSnapshot {
  result: ProbeOutcome;
  fingerprint: string;
  writePolicy: string;
}

interface PendingProbeRequest {
  payload: ConnectorUpsert;
  connectorId?: string;
  fingerprint: string;
  writePolicy: string;
}

interface ProbeMutationVariables {
  requestId: string;
  sessionToken: string;
}

interface ProbeMutationResult {
  outcome: ProbeOutcome;
  fingerprint: string;
  writePolicy: string;
  sessionToken: string;
}

class ProbeRequestError extends Error {
  constructor(
    cause: unknown,
    readonly fingerprint: string,
    readonly writePolicy: string,
    readonly sessionToken: string,
  ) {
    super(cause instanceof Error ? cause.message : '连接测试失败');
    this.name = 'ProbeRequestError';
  }
}

let probeRequestSequence = 0;

function nextProbeRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  probeRequestSequence += 1;
  return `connector-probe:${uuid ?? `${Date.now()}-${probeRequestSequence}`}`;
}

const SECTION_LINKS = [
  { id: 'connector-form-basic', label: '基本信息' },
  { id: 'connector-form-parameters', label: '连接参数' },
  { id: 'connector-form-governance', label: '治理策略' },
  { id: 'connector-form-verify', label: '验证与保存' },
];

/** 用 schema 里的 default 预填；不认识具体 kind，也不认识任何参数名。 */
function defaultsOf(kind?: ConnectorKind): ParamValues {
  const out: ParamValues = {};
  if (!kind) return out;
  for (const field of kind.fields) {
    if (field.default === undefined) continue;
    if (field.type === 'int') out[field.name] = Number(field.default);
    else if (field.type === 'bool') out[field.name] = field.default === 'true';
    else out[field.name] = field.default;
  }
  return out;
}

/** 编辑时敏感字段留空 = 沿用原值，不能把空串当作显式清空发给后端。 */
function stripBlankSecrets(params: ParamValues, kind?: ConnectorKind): ParamValues {
  if (!kind) return params;
  const out: ParamValues = { ...params };
  for (const field of kind.fields) {
    if (!field.secret) continue;
    const value = out[field.name];
    if (value === undefined || value === null || value === '') delete out[field.name];
  }
  return out;
}

function canonicalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalized);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalized(item)]),
    );
  }
  return value;
}

// Web Crypto 只在 secure context 可靠可用。内网 HTTP 环境走这个同步
// SHA-256：指纹只用于判断表单是否改变，但也绝不能把含凭据的序列化原文留在 state。
const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Sync(input: string): string {
  const source = new TextEncoder().encode(input);
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(source);
  padded[source.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = source.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15];
      const right = words[index - 2];
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + SHA256_ROUND_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return hash.map((word) => word.toString(16).padStart(8, '0')).join('');
}

/**
 * 试连结果只绑定会改变真实目标或权限判断的字段。显示名、出库档位变化不让结果失效；
 * kind / 参数 / 写策略变化会立刻提示重新测试。只排序对象键，不改写值本身：尾随空格对
 * 密码、token、路径都可能有真实含义，不能被“规范化”掉。
 */
async function probeFingerprint(values: FormValues, kind?: ConnectorKind): Promise<string> {
  const serialized = JSON.stringify(
    canonicalized({
      kind: values.kind,
      params: stripBlankSecrets(values.params ?? {}, kind),
      writePolicy: values.writePolicy,
    }),
  );
  // 无论走哪条路，React state 都只保留摘要；指纹过程不 trim 任何字符串。
  if (!globalThis.crypto?.subtle) return `v3:${sha256Sync(serialized)}`;
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(serialized),
  );
  return `v3:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function payloadOf(values: FormValues, kind: ConnectorKind | undefined, editing: boolean) {
  const payload: ConnectorUpsert = {
    name: values.name,
    displayName: values.displayName,
    writePolicy: values.writePolicy,
    // PUT 是整体覆盖；必须把详情里的未知新枚举也原样回填，不能把第 3 档静默降回默认档。
    semanticDataTier: values.semanticDataTier,
    params: stripBlankSecrets(values.params ?? {}, kind),
  };
  if (!editing) payload.kind = values.kind;
  return payload;
}

function ProbeResultAlert({ snapshot, stale }: { snapshot: ProbeSnapshot; stale: boolean }) {
  if (stale) {
    return (
      <Alert
        type="warning"
        showIcon
        message="关键连接参数已变化，需要重新测试"
        description="地址、账号密码或写策略已改动，上次的结果不再适用。"
      />
    );
  }

  const { result, writePolicy } = snapshot;
  if (result.ok) {
    const readonly = writePolicy === 'FORBIDDEN';
    const readonlyMismatch = !readonly && result.readonlyVerified;
    return (
      <Alert
        type={readonlyMismatch ? 'warning' : 'success'}
        showIcon
        message={
          readonly
            ? result.readonlyVerified
              ? '连接正常，只读已验证'
              : '连接正常，但只读性仍未确认'
            : readonlyMismatch
              ? '连接正常，但账号仍是只读'
              : '连接正常，写策略验证通过'
        }
        description={
          <>
            <div>
              可用能力：
              <Space size={4} wrap style={{ marginLeft: 4 }}>
                {result.capabilities.map((capability) => (
                  <Tag key={capability}>{CAPABILITY_LABELS[capability] ?? capability}</Tag>
                ))}
              </Space>
            </div>
            {readonlyMismatch ? (
              <div style={{ marginTop: 4 }}>平台允许写，但数据库账号是只读的，写入会失败。</div>
            ) : null}
            {result.readonlyDetail ? (
              <div style={{ marginTop: 4, color: '#64748b' }}>
                {readonly ? '只读依据' : '权限依据'}：{result.readonlyDetail}
              </div>
            ) : null}
          </>
        }
      />
    );
  }

  return (
    <Alert
      type="error"
      showIcon
      message={result.readonlyUndetermined ? '无法确认这个账号的权限' : '连接测试未通过'}
      description={result.failureReason}
    />
  );
}

function ConnectorFormContents({
  connector,
  kinds,
  submitting,
  sessionToken,
  initialSection,
  onClose,
  onSubmit,
}: ContentsProps) {
  const [form] = Form.useForm<FormValues>();
  const activeSessionRef = useRef<string | null>(sessionToken);
  const pendingProbeRequestsRef = useRef(new Map<string, PendingProbeRequest>());
  const probeLaunchLockRef = useRef(false);
  const [probeStarting, setProbeStarting] = useState(false);
  const [selectedKind, setSelectedKind] = useState(connector?.kind ?? kinds[0]?.kind);
  const [probeSnapshot, setProbeSnapshot] = useState<ProbeSnapshot | null>(null);
  const [currentFingerprint, setCurrentFingerprint] = useState<string | null>(null);
  const activeKind = useMemo(
    () => kinds.find((kind) => kind.kind === selectedKind),
    [kinds, selectedKind],
  );

  useEffect(() => {
    activeSessionRef.current = sessionToken;
    const pendingRequests = pendingProbeRequestsRef.current;
    return () => {
      activeSessionRef.current = null;
      pendingRequests.clear();
      probeLaunchLockRef.current = false;
    };
  }, [sessionToken]);

  const initialValues = useMemo<Partial<FormValues>>(() => {
    if (connector) {
      return {
        name: connector.name,
        displayName: connector.displayName ?? undefined,
        kind: connector.kind,
        writePolicy: connector.writePolicy,
        semanticDataTier: connector.semanticDataTier ?? DEFAULT_SEMANTIC_DATA_TIER,
        // 敏感值后端从不回传；SecretField 用自己的局部 state 表达「已保存 / 更换中」。
        params: { ...(connector.params as ParamValues) },
      };
    }
    const first = kinds[0];
    return {
      kind: first?.kind,
      writePolicy: 'FORBIDDEN',
      semanticDataTier: DEFAULT_SEMANTIC_DATA_TIER,
      params: defaultsOf(first),
    };
  }, [connector, kinds]);

  const watchedKind = Form.useWatch('kind', form) as string | undefined;
  const watchedParams = Form.useWatch('params', form) as ParamValues | undefined;
  const watchedPolicy = Form.useWatch('writePolicy', form);
  const watchedTier = Form.useWatch('semanticDataTier', form);
  const watchedDatabase = Form.useWatch(['params', 'database'], form) as string | undefined;

  useEffect(() => {
    if (initialSection !== 'semantic') return;
    const timeout = window.setTimeout(() => {
      const field = document.querySelector<HTMLElement>(
        '[data-testid="connector-form-semantic-tier"]',
      );
      if (!field) return;
      field.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center',
      });
      field.querySelector<HTMLElement>('[role="combobox"]')?.focus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [initialSection]);

  const tierOptions = useMemo(() => {
    const base = SEMANTIC_DATA_TIERS.map((tier) => ({
      label: tier.label,
      value: tier.value as string,
    }));
    const current = connector?.semanticDataTier;
    if (current && !base.some((option) => option.value === current)) {
      base.push({
        label: `${connector.semanticDataTierLabel || current}（无法识别，保存时保持不变）`,
        value: current,
      });
    }
    return base;
  }, [connector]);

  const tierMeta = semanticDataTierMeta(watchedTier);
  const tierEgress =
    connector && watchedTier === connector.semanticDataTier && connector.semanticDataTierEgress
      ? connector.semanticDataTierEgress
      : tierMeta?.egress;

  useEffect(() => {
    let current = true;
    if (!watchedKind || !watchedPolicy) {
      setCurrentFingerprint(null);
      return () => {
        current = false;
      };
    }
    // 值已经变了但新摘要尚未算完时，旧探测结果也不能继续显示为有效。
    setCurrentFingerprint(null);
    void probeFingerprint(
      {
        name: '',
        kind: watchedKind,
        params: watchedParams ?? {},
        writePolicy: watchedPolicy,
        semanticDataTier: '',
      },
      activeKind,
    ).then((fingerprint) => {
      if (current) setCurrentFingerprint(fingerprint);
    });
    return () => {
      current = false;
    };
  }, [activeKind, watchedKind, watchedParams, watchedPolicy]);

  const probeStale = probeSnapshot !== null && currentFingerprint !== probeSnapshot.fingerprint;

  const releaseProbeLaunchLock = () => {
    probeLaunchLockRef.current = false;
    if (activeSessionRef.current === sessionToken) setProbeStarting(false);
  };

  const probeMut = useMutation<ProbeMutationResult, ProbeRequestError, ProbeMutationVariables>({
    mutationKey: ['connector', 'probe'],
    mutationFn: async ({ requestId, sessionToken: requestSession }) => {
      const request = pendingProbeRequestsRef.current.get(requestId);
      // 先从请求仓删除，再让 axios 开始异步网络阶段。此后 payload 只在
      // 这次 mutationFn 的局部变量中存活，不会进 MutationCache variables。
      pendingProbeRequestsRef.current.delete(requestId);
      if (!request) {
        throw new ProbeRequestError(
          new Error('连接测试请求已过期，请重试'),
          '',
          '',
          requestSession,
        );
      }
      try {
        const outcome = await connectorApi.probe(request.payload, request.connectorId);
        return {
          outcome,
          fingerprint: request.fingerprint,
          writePolicy: request.writePolicy,
          sessionToken: requestSession,
        };
      } catch (error) {
        throw new ProbeRequestError(
          error,
          request.fingerprint,
          request.writePolicy,
          requestSession,
        );
      } finally {
        pendingProbeRequestsRef.current.delete(requestId);
      }
    },
    onSuccess: ({ outcome, fingerprint, writePolicy, sessionToken: requestSession }) => {
      if (activeSessionRef.current !== requestSession) return;
      setProbeSnapshot({ result: outcome, fingerprint, writePolicy });
    },
    onError: (error) => {
      if (activeSessionRef.current !== error.sessionToken || !error.fingerprint) return;
      setProbeSnapshot({
        result: {
          ok: false,
          failureReason: error.message,
          capabilities: [],
          readonlyVerified: false,
          readonlyUndetermined: false,
        },
        fingerprint: error.fingerprint,
        writePolicy: error.writePolicy,
      });
    },
    onSettled: releaseProbeLaunchLock,
  });

  const testConnection = async () => {
    // ref 必须在第一个 await 之前同步占位；state/loading 要到本轮事件
    // 结束才渲染，单靠按钮 disabled 挡不住同一竞态窗口里的第二次 click。
    if (probeLaunchLockRef.current) return;
    probeLaunchLockRef.current = true;
    setProbeStarting(true);
    let handedToMutation = false;
    try {
      const values = await form.validateFields();
      if (activeSessionRef.current !== sessionToken) return;
      const fingerprint = await probeFingerprint(values, activeKind);
      // digest 期间 Drawer 可能已关闭或切到另一条连接。只有原会话仍存活
      // 才能继续组装凭据 payload 并发 POST。
      if (activeSessionRef.current !== sessionToken) return;
      const payload = payloadOf(values, activeKind, !!connector);
      // probe 需要 kind 来选择实现；编辑态另带 id，让空白敏感字段沿用原值。
      payload.kind = values.kind;
      setProbeSnapshot(null);
      const requestId = nextProbeRequestId();
      pendingProbeRequestsRef.current.set(requestId, {
        payload,
        connectorId: connector?.id,
        fingerprint,
        writePolicy: values.writePolicy,
      });
      probeMut.mutate({ requestId, sessionToken });
      handedToMutation = true;
    } catch {
      // validateFields 已把错误标在具体字段上。
    } finally {
      // 校验 / digest 失败、或会话已失效时没有 mutation onSettled 可以释放锁。
      if (!handedToMutation) releaseProbeLaunchLock();
    }
  };

  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });

  return (
    <div className="connector-form-drawer__layout">
      <nav className="connector-form-drawer__directory" aria-label="连接表单目录">
        <span>
          <CompassOutlined /> 配置目录
        </span>
        {SECTION_LINKS.map((section) => (
          <Button key={section.id} type="text" size="small" onClick={() => scrollTo(section.id)}>
            {section.label}
          </Button>
        ))}
      </nav>

      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={initialValues}
        onFinish={(values) =>
          onSubmit(payloadOf(values, activeKind, !!connector), sessionToken)
        }
      >
        <section id="connector-form-basic" className="connector-form-section">
          <div className="connector-form-section__heading">
            <span>01</span>
            <div>
              <Typography.Title level={5}>基本信息</Typography.Title>
              <Typography.Text type="secondary">设置连接的类型和名称。</Typography.Text>
            </div>
          </div>
          <Form.Item
            label="类型"
            name="kind"
            rules={[{ required: true, message: '请选择类型' }]}
            extra={connector ? '类型不可修改。需要更换请删除后重新创建' : undefined}
          >
            <Select
              disabled={!!connector}
              options={kinds.map((kind) => ({ label: kind.displayName, value: kind.kind }))}
              onChange={(value: string) => {
                setSelectedKind(value);
                form.setFieldsValue({
                  params: defaultsOf(kinds.find((kind) => kind.kind === value)),
                });
              }}
            />
          </Form.Item>
          <Form.Item
            label="名称"
            name="name"
            rules={[
              { required: true, message: '请填写名称' },
              {
                pattern: /^[A-Za-z0-9_-]{1,64}$/,
                message: '只能是字母、数字、下划线、短横线，最长 64 位',
              },
            ]}
            extra="AI 靠这个名称识别连接，创建后不能修改"
          >
            <Input disabled={!!connector} placeholder="crm-mysql" />
          </Form.Item>
          <Form.Item label="显示名" name="displayName">
            <Input placeholder="CRM 生产库（只读）" />
          </Form.Item>
        </section>

        <section id="connector-form-parameters" className="connector-form-section">
          <div className="connector-form-section__heading">
            <span>02</span>
            <div>
              <Typography.Title level={5}>连接参数</Typography.Title>
              <Typography.Text type="secondary">填写连接客户数据库所需的信息。</Typography.Text>
            </div>
          </div>
          {activeKind ? (
            <SchemaForm
              fields={activeKind.fields}
              editing={!!connector}
              connectorId={connector?.id ?? null}
            />
          ) : (
            <Alert type="warning" showIcon message="没有可用的连接类型" />
          )}
        </section>

        <section id="connector-form-governance" className="connector-form-section">
          <div className="connector-form-section__heading">
            <span>03</span>
            <div>
              <Typography.Title level={5}>治理策略</Typography.Title>
              <Typography.Text type="secondary">
                设置能否修改数据，以及哪些数据可以离开客户库。
              </Typography.Text>
            </div>
          </div>
          <Form.Item
            label="写策略"
            name="writePolicy"
            rules={[{ required: true, message: '请选择写策略' }]}
            extra="平台层面的开关，数据库账号权限需另外设置。"
          >
            <Select options={WRITE_POLICY_OPTIONS} />
          </Form.Item>
          {watchedPolicy && watchedPolicy !== 'FORBIDDEN' ? (
            <Alert
              type="warning"
              showIcon
              message="这条连接将允许修改客户数据"
              description={
                <>
                  {watchedPolicy === 'AUTO'
                    ? 'AI 可直接改数据，无需人工确认。'
                    : 'AI 只能提交，经超管批准后才会执行。'}
                  平台仍会拦截<b>不带条件的修改、删除</b>、超行数上限的写入，以及改表结构。
                </>
              }
            />
          ) : null}
          <div data-testid="connector-form-semantic-tier">
            <Form.Item
              label="数据出库档位"
              name="semanticDataTier"
              rules={[{ required: true, message: '请选择数据出库档位' }]}
              extra="档位越高，表关系越准，离开客户库的数据越具体。"
            >
              <Select options={tierOptions} />
            </Form.Item>
          </div>
          {watchedTier ? (
            <Alert
              type={tierMeta?.alert ?? 'warning'}
              showIcon
              message={tierMeta?.title ?? `无法识别这个档位（${watchedTier}）`}
              description={
                tierMeta ? (
                  <>
                    {tierEgress}
                    {tierMeta.extra ? <div style={{ marginTop: 4 }}>{tierMeta.extra}</div> : null}
                  </>
                ) : (
                  '保存时档位保持不变；如需修改，请联系平台管理员。'
                )
              }
            />
          ) : null}
          {activeKind ? (
            <GrantScriptPanel
              kind={activeKind.kind}
              database={watchedDatabase}
              writePolicy={watchedPolicy ?? 'FORBIDDEN'}
            />
          ) : null}
        </section>

        <section id="connector-form-verify" className="connector-form-section">
          <div className="connector-form-section__heading">
            <span>04</span>
            <div>
              <Typography.Title level={5}>验证与保存</Typography.Title>
              <Typography.Text type="secondary">
                测试不会保存任何内容，确认无误后再保存。
              </Typography.Text>
            </div>
          </div>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Button
              icon={<ExperimentOutlined />}
              loading={probeStarting || probeMut.isPending}
              disabled={submitting}
              onClick={testConnection}
            >
              测试连接
            </Button>
            <div
              data-testid="connector-probe-state"
              data-probe-pending={probeStarting || probeMut.isPending ? 'true' : 'false'}
              data-probe-result={probeSnapshot ? 'ready' : 'empty'}
            >
              {probeSnapshot ? (
                <ProbeResultAlert snapshot={probeSnapshot} stale={probeStale} />
              ) : (
                <Alert
                  type="info"
                  showIcon
                  message="可先测试，再一次性保存"
                  description="提前测试，可发现地址、账号和权限问题。"
                />
              )}
            </div>
          </Space>
        </section>
      </Form>

      <div className="connector-form-drawer__footer">
        <Button disabled={submitting} onClick={onClose}>
          取消
        </Button>
        <Button
          type="primary"
          icon={<CheckCircleOutlined />}
          loading={submitting}
          onClick={() => form.submit()}
        >
          {connector ? '保存' : '创建并验证'}
        </Button>
      </div>
    </div>
  );
}

export default function ConnectorFormDrawer(props: Props) {
  const screens = Grid.useBreakpoint();
  const closeIfIdle = () => {
    if (!props.submitting) props.onClose();
  };
  return (
    <Drawer
      data-testid="connector-form-drawer"
      className="connector-form-drawer"
      title={props.connector ? '编辑连接' : '新建连接'}
      open={props.open}
      onClose={closeIfIdle}
      closable={!props.submitting}
      keyboard={!props.submitting}
      maskClosable={!props.submitting}
      width={screens.md ? 860 : '100%'}
      destroyOnClose
      autoFocus={props.initialSection !== 'semantic'}
      footer={null}
    >
      {props.open ? (
        <ConnectorFormContents
          key={`${props.connector?.id ?? 'create'}:${props.sessionToken}`}
          {...props}
          onClose={closeIfIdle}
        />
      ) : null}
    </Drawer>
  );
}

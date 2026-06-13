import { useState } from 'react';
import { App, Alert, Button, Segmented, Space, Spin, Tag, Typography } from 'antd';
import { CaretRightOutlined } from '@ant-design/icons';
import { pluginAuthApi, type AuthTestFetchResult } from '@/features/plugin/api';
import { jsonPathToDot, segmentsToJsonPath } from '@/features/plugin/utils/authConfig';

interface Props {
  pluginId: string;
  /** 当前认证方式（草稿）；让「改了类型还没保存」也能测 */
  authType: string;
  /** 当前正在编辑、要测试的 auth_config 草稿（序列化后的字符串） */
  authConfig: string;
  /** 提供后，结果树里的叶子可点选回填 token / 过期 路径（TOKEN_FETCH 用；OAUTH2 不传则只读） */
  onPickToken?: (jsonPath: string) => void;
  onPickExpire?: (jsonPath: string) => void;
  /** 当前已选的路径（JSONPath），用于在树上打勾提示 */
  currentTokenPath?: string;
  currentExpirePath?: string;
}

type PickTarget = 'token' | 'expire';

export default function AuthFetchTester({
  pluginId,
  authType,
  authConfig,
  onPickToken,
  onPickExpire,
  currentTokenPath,
  currentExpirePath,
}: Props) {
  const { message } = App.useApp();
  const pickable = !!onPickToken;
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AuthTestFetchResult | null>(null);
  const [target, setTarget] = useState<PickTarget>('token');

  const run = async () => {
    setLoading(true);
    setResult(null);
    try {
      const r = await pluginAuthApi.testFetch(pluginId, authConfig, authType);
      setResult(r);
    } catch (e) {
      setResult({ error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const pick = (segments: (string | number)[]) => {
    if (!pickable) return;
    const jp = segmentsToJsonPath(segments);
    if (target === 'token') {
      onPickToken?.(jp);
      message.success(`已设为 token 字段：${jsonPathToDot(jp)}`);
    } else {
      onPickExpire?.(jp);
      message.success(`已设为过期字段：${jsonPathToDot(jp)}`);
    }
  };

  return (
    <div
      style={{
        border: '1px solid #f0f0f0',
        borderRadius: 8,
        padding: 12,
        background: '#fafafa',
      }}
    >
      <Space style={{ width: '100%', justifyContent: 'space-between' }} align="center">
        <Button
          icon={<CaretRightOutlined />}
          onClick={run}
          loading={loading}
          size="small"
          type="primary"
          ghost
        >
          测试获取
        </Button>
        {pickable && result?.parsedJson != null && (
          <Space size={4}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              点下方字段，设为：
            </Typography.Text>
            <Segmented
              size="small"
              value={target}
              onChange={(v) => setTarget(v as PickTarget)}
              options={[
                { label: 'Token 字段', value: 'token' },
                { label: '过期字段', value: 'expire' },
              ]}
            />
          </Space>
        )}
      </Space>

      {loading && (
        <div style={{ padding: 16, textAlign: 'center' }}>
          <Spin size="small" />
        </div>
      )}

      {!loading && result && (
        <div style={{ marginTop: 10 }}>
          {result.error ? (
            <Alert type="error" showIcon message="测试失败" description={result.error} />
          ) : (
            <>
              <Space size={8} style={{ marginBottom: 8 }}>
                <Tag color={(result.httpStatus ?? 0) < 400 ? 'green' : 'red'}>
                  HTTP {result.httpStatus}
                </Tag>
                {result.durationMs != null && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {result.durationMs}ms
                  </Typography.Text>
                )}
              </Space>
              {result.parsedJson != null ? (
                <div
                  style={{
                    fontFamily: 'Menlo, monospace',
                    fontSize: 12,
                    background: '#fff',
                    border: '1px solid #f0f0f0',
                    borderRadius: 6,
                    padding: 10,
                    maxHeight: 320,
                    overflow: 'auto',
                  }}
                >
                  <JsonNode
                    value={result.parsedJson}
                    segments={[]}
                    pickable={pickable}
                    onPick={pick}
                    currentTokenPath={currentTokenPath}
                    currentExpirePath={currentExpirePath}
                  />
                </div>
              ) : (
                <pre
                  style={{
                    fontFamily: 'Menlo, monospace',
                    fontSize: 12,
                    background: '#fff',
                    border: '1px solid #f0f0f0',
                    borderRadius: 6,
                    padding: 10,
                    maxHeight: 320,
                    overflow: 'auto',
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {result.rawBody || '(空响应)'}
                </pre>
              )}
              {pickable && result.parsedJson != null && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  提示：响应里 token 在哪、过期时间在哪，直接点对应的值即可。
                </Typography.Text>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface NodeProps {
  value: unknown;
  segments: (string | number)[];
  pickable: boolean;
  onPick: (segments: (string | number)[]) => void;
  currentTokenPath?: string;
  currentExpirePath?: string;
}

const INDENT = 14;

function JsonNode({
  value,
  segments,
  pickable,
  onPick,
  currentTokenPath,
  currentExpirePath,
}: NodeProps) {
  if (Array.isArray(value)) {
    return (
      <div>
        {value.map((item, i) => (
          <div key={i} style={{ paddingLeft: INDENT }}>
            <span style={{ color: '#999' }}>[{i}] </span>
            <JsonNode
              value={item}
              segments={[...segments, i]}
              pickable={pickable}
              onPick={onPick}
              currentTokenPath={currentTokenPath}
              currentExpirePath={currentExpirePath}
            />
          </div>
        ))}
      </div>
    );
  }
  if (value !== null && typeof value === 'object') {
    return (
      <div>
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => {
          const childSegs = [...segments, k];
          const isLeaf = v === null || typeof v !== 'object';
          return (
            <div key={k} style={{ paddingLeft: INDENT }}>
              <span style={{ color: '#1677ff' }}>{k}</span>
              <span style={{ color: '#999' }}>: </span>
              {isLeaf ? (
                <Leaf
                  value={v}
                  segments={childSegs}
                  pickable={pickable}
                  onPick={onPick}
                  currentTokenPath={currentTokenPath}
                  currentExpirePath={currentExpirePath}
                />
              ) : (
                <JsonNode
                  value={v}
                  segments={childSegs}
                  pickable={pickable}
                  onPick={onPick}
                  currentTokenPath={currentTokenPath}
                  currentExpirePath={currentExpirePath}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }
  // 顶层就是标量
  return (
    <Leaf
      value={value}
      segments={segments}
      pickable={pickable}
      onPick={onPick}
      currentTokenPath={currentTokenPath}
      currentExpirePath={currentExpirePath}
    />
  );
}

function Leaf({
  value,
  segments,
  pickable,
  onPick,
  currentTokenPath,
  currentExpirePath,
}: NodeProps) {
  const jp = segmentsToJsonPath(segments);
  const isToken = currentTokenPath && jsonPathToDot(currentTokenPath) === jsonPathToDot(jp);
  const isExpire = currentExpirePath && jsonPathToDot(currentExpirePath) === jsonPathToDot(jp);
  const text = typeof value === 'string' ? `"${value}"` : value === null ? 'null' : String(value);
  const tag = isToken ? ' ✓token' : isExpire ? ' ✓过期' : '';

  if (!pickable) {
    return <span style={{ color: '#389e0d' }}>{text}</span>;
  }
  return (
    <span
      onClick={() => onPick(segments)}
      style={{
        color: '#389e0d',
        cursor: 'pointer',
        borderRadius: 3,
        padding: '0 2px',
        background: isToken || isExpire ? '#fffbe6' : undefined,
        textDecoration: 'underline dotted',
      }}
      title="点击设为 token / 过期 字段"
    >
      {text}
      {tag && <span style={{ color: '#d48806', fontWeight: 600 }}>{tag}</span>}
    </span>
  );
}

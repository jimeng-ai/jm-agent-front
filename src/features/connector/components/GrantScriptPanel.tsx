import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Collapse, Input, Radio, Select, Space, Typography } from 'antd';
import { connectorWriteApi } from '@/features/connector/api';
import type { GrantScriptRequest, GrantScriptResult } from '@/features/connector/types';

/**
 * 「不知道怎么建账号？生成授权命令」面板。
 *
 * ★ 它解决的不是技术问题，是**接入现场的卡点**：客户那边真正掌握数据库的人常常不在会议室里，
 * 「请给我一个只读账号」这句话来回一轮要两三天。把命令直接生成出来、能复制走，
 * 接入就从「解释需求」变成「转发一段话」。
 *
 * 三件事必须说清楚，否则这个面板反而危险：
 * 1. 平台**只生成文本，从不执行**。要替客户建账号得先有个能建账号的账号，问题就绕回去了。
 * 2. 生成的命令里没有密码（也不该有）——密码得客户自己换，这句话写在结果上方而不是藏进 notes。
 * 3. 授权范围跟着**当前写策略**走：策略改了必须重新生成，否则会拿着只读授权去配「写自动」。
 *
 * 实现上两个坑：
 * - 这个面板被塞在新建/编辑连接的那个 `<Form>` 里，所以**一个 antd Form.Item 都不能用**：
 *   用了就会把这三个只用于生成命令的输入混进连接参数一起提交，后端的「未知参数」校验会拒。
 *   全部走组件内部的 useState。
 * - 同理，`<Input>` 里回车会触发外层 form 的隐式提交（= 直接创建连接）。所以每个输入框都接
 *   onPressEnter 并 preventDefault，顺手让回车等于点「生成」。
 */

interface Props {
  kind: string;
  /** 连接参数里填的库名。还没填也能生成，只是范围不完整——由后端决定怎么兜。 */
  database?: string;
  /** 当前表单里选的写策略。决定授权里给不给 INSERT/UPDATE/DELETE。 */
  writePolicy: string;
}

type HostMode = 'any' | 'custom';
type ScopeMode = 'database' | 'tables';

interface GrantInputSnapshot {
  /** 真正发送给后端、会改变 SQL 的字段。 */
  request: GrantScriptRequest;
  /** UI 的选择语义也纳入快照；不能把「整库」和「指定表」错误视为同一份结果。 */
  hostMode: HostMode;
  scope: ScopeMode;
  fingerprint: string;
}

interface GeneratedScript {
  result: GrantScriptResult;
  fingerprint: string;
}

/** 默认账号名。取只读的那个名字是因为绝大多数连接就该停在只读上。 */
const DEFAULT_USERNAME = 'jm_readonly';

const CODE_BLOCK: React.CSSProperties = {
  margin: 0,
  padding: 12,
  background: '#f6f6f6',
  borderRadius: 6,
  fontFamily: 'Menlo, Consolas, monospace',
  fontSize: 12,
  lineHeight: 1.7,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};

export default function GrantScriptPanel({ kind, database, writePolicy }: Props) {
  const [username, setUsername] = useState(DEFAULT_USERNAME);
  const [hostMode, setHostMode] = useState<HostMode>('any');
  const [host, setHost] = useState('');
  const [scope, setScope] = useState<ScopeMode>('database');
  const [tables, setTables] = useState<string[]>([]);
  const [generated, setGenerated] = useState<GeneratedScript | null>(null);
  // React Query 的 isPending 要到下一次渲染才更新；同一事件循环里的双击 / 连续 Enter
  // 会在它变成 true 前连续调用 generate。ref 在 mutate 前同步上锁，堵住这段窗口。
  const pendingRef = useRef(false);

  // 生成结果必须绑定【发请求那一刻】的完整非敏感输入。不能只盯 writePolicy：库名、账号、
  // 来源 host、整库/指定表和表名都会改变 SQL；请求在路上时改任一项，迟到响应也只能算过期。
  const request: GrantScriptRequest = {
    kind,
    database,
    username: username.trim(),
    host: hostMode === 'any' ? '%' : host.trim(),
    tables: scope === 'tables' ? [...tables] : [],
    writePolicy,
  };
  const fingerprint = JSON.stringify({
    kind: request.kind,
    database: request.database ?? null,
    writePolicy: request.writePolicy,
    username: request.username,
    hostMode,
    host: request.host,
    scope,
    tables: request.tables,
  });

  const mut = useMutation({
    mutationFn: (input: GrantInputSnapshot) => connectorWriteApi.grantScript(input.request),
    onSuccess: (result, input) => {
      setGenerated({ result, fingerprint: input.fingerprint });
    },
    onSettled: () => {
      pendingRef.current = false;
    },
  });

  const hostMissing = hostMode === 'custom' && !host.trim();
  const tablesMissing = scope === 'tables' && tables.length === 0;
  const canGenerate = !!username.trim() && !hostMissing && !tablesMissing;
  const stale = generated !== null && generated.fingerprint !== fingerprint;

  const generate = () => {
    // 校验不通过时不占锁；请求无论成功还是失败，都由 onSettled 释放。
    if (!canGenerate || pendingRef.current || mut.isPending) return;
    pendingRef.current = true;
    try {
      mut.mutate({ request, hostMode, scope, fingerprint });
    } catch (error) {
      // mutate 通常把错误交给 mutation 状态机；若调用本身同步抛错，也不能永久锁死。
      pendingRef.current = false;
      throw error;
    }
  };

  /** 回车在外层 Form 里等于提交整张表单，必须拦掉；顺手让它等于点「生成」。 */
  const onEnter = (e: React.KeyboardEvent) => {
    e.preventDefault();
    generate();
  };

  const body = (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Typography.Text type="secondary">
        平台只把命令生成出来，不会拿它去客户库上执行。生成后复制给客户的 DBA 即可。
      </Typography.Text>

      <div>
        <div style={{ marginBottom: 4 }}>账号名</div>
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onPressEnter={onEnter}
          placeholder={DEFAULT_USERNAME}
        />
      </div>

      <div>
        <div style={{ marginBottom: 4 }}>允许从哪登录</div>
        <Radio.Group value={hostMode} onChange={(e) => setHostMode(e.target.value as HostMode)}>
          <Radio value="any">任意（%）</Radio>
          <Radio value="custom">指定</Radio>
        </Radio.Group>
        {hostMode === 'custom' && (
          <Input
            style={{ marginTop: 8 }}
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onPressEnter={onEnter}
            placeholder="10.0.0.% 或 gateway.example.com"
          />
        )}
      </div>

      <div>
        <div style={{ marginBottom: 4 }}>授权范围</div>
        <Radio.Group value={scope} onChange={(e) => setScope(e.target.value as ScopeMode)}>
          <Radio value="database">整库</Radio>
          <Radio value="tables">指定表</Radio>
        </Radio.Group>
        {scope === 'tables' && (
          <Select
            style={{ marginTop: 8, width: '100%' }}
            mode="tags"
            value={tables}
            onChange={setTables}
            tokenSeparators={[',', ' ']}
            placeholder="逐个输入表名，回车添加"
          />
        )}
      </div>

      {!database && (
        <Typography.Text type="warning">
          上面的连接参数里还没填库名，生成出来的授权范围会不完整。
        </Typography.Text>
      )}

      <Space>
        <Button type="primary" loading={mut.isPending} disabled={!canGenerate} onClick={generate}>
          {generated ? '重新生成' : '生成'}
        </Button>
        <Typography.Text type="secondary">
          授权按当前写策略生成；改了写策略要重新生成一次。
        </Typography.Text>
      </Space>

      {mut.isError && (
        <Alert
          type="error"
          showIcon
          message="生成失败"
          description={(mut.error as Error).message}
        />
      )}

      {generated && (
        <div data-testid="grant-script-result">
          {stale ? (
            <Alert
              data-testid="grant-script-stale"
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="授权命令已过期"
              description="生成后，连接类型、库名、写策略或授权范围等输入发生了变化。请重新生成；旧命令已禁止一键复制。"
            />
          ) : null}
          <Typography.Text strong>请把这段交给客户的 DBA 执行，密码需自行替换。</Typography.Text>
          <div style={{ marginTop: 8, position: 'relative' }}>
            {/* copyable 显式给 text：结果是多行语句，让它从 children 里推更容易被样式影响。 */}
            <Typography.Paragraph
              style={{ ...CODE_BLOCK, ...(stale ? { opacity: 0.58 } : {}) }}
              copyable={stale ? undefined : { text: generated.result.sql }}
            >
              {generated.result.sql}
            </Typography.Paragraph>
          </div>
          {generated.result.notes.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: '#666' }}>
              {generated.result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Space>
  );

  return (
    <Collapse
      ghost
      size="small"
      // 默认收起：绝大多数情况下客户已经有账号了，这块不该占掉新建表单的视线。
      items={[{ key: 'grant', label: '不知道怎么建账号？生成授权命令', children: body }]}
    />
  );
}

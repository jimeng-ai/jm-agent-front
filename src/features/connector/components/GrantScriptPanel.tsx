import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Collapse, Input, Radio, Select, Space, Typography } from 'antd';
import { connectorWriteApi } from '@/features/connector/api';

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

  const mut = useMutation({
    mutationFn: () =>
      connectorWriteApi.grantScript({
        kind,
        database,
        username: username.trim(),
        host: hostMode === 'any' ? '%' : host.trim(),
        // 空数组 = 整库；后端据此决定 GRANT 的粒度。
        tables: scope === 'tables' ? tables : [],
        writePolicy,
      }),
  });

  const hostMissing = hostMode === 'custom' && !host.trim();
  const tablesMissing = scope === 'tables' && tables.length === 0;
  const canGenerate = !!username.trim() && !hostMissing && !tablesMissing;

  const generate = () => {
    if (canGenerate) mut.mutate();
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
          生成
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

      {mut.data && (
        <div>
          <Typography.Text strong>请把这段交给客户的 DBA 执行，密码需自行替换。</Typography.Text>
          <div style={{ marginTop: 8, position: 'relative' }}>
            {/* copyable 显式给 text：结果是多行语句，让它从 children 里推更容易被样式影响。 */}
            <Typography.Paragraph style={CODE_BLOCK} copyable={{ text: mut.data.sql }}>
              {mut.data.sql}
            </Typography.Paragraph>
          </div>
          {mut.data.notes.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: '#666' }}>
              {mut.data.notes.map((n) => (
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

import { useState } from 'react';
import { App, Button, Input, Space, Tooltip, Typography } from 'antd';
import { EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons';
import { connectorApi } from '../api';
import type { ParamFieldSchema } from '../types';

/**
 * 敏感字段（密码 / 令牌）的输入控件。
 *
 * <h3>为什么编辑态不能是一个空输入框</h3>
 * 后端的「留空 = 沿用原值」是对的，而且有两道保险（`ConnectorService` 里跳过写密文那一段，
 * 以及保存前的 `probeOrThrow`——凭据真断了会**保存失败**，不会静默抹掉）。
 * 但一个空输入框把这份扎实全部抵消了：它旁边的兄弟字段都带红色 `*`，它自己是空的，
 * 视觉上读起来就是「你漏填了」。实测过的后果是——**连写这套系统的人，看着它都会认为
 * 保存一下密码就没了**。把状态编码进一行灰色小字，等于要求每个人每次都读一遍那行字。
 *
 * 所以编辑态渲染成一个**有状态的「已保存」态**，而不是一个需要配注释才能理解的空框。
 * 不点「更换」，这个字段就不往表单里写任何值，`stripBlankSecrets` 会把它剔掉，
 * 后端那条「留空 = 沿用」照旧生效——**语义一个字没变，变的只是它看起来像什么**。
 *
 * <h3>眼睛为什么要单独发一次请求</h3>
 * 这是整个功能唯一容易做错的地方，见 `connectorApi.revealCredential` 的注释：
 * 明文若随弹窗的详情一起下发，界面上照样可以先打码、点眼睛再显示，看起来一模一样——
 * 但泄露发生在传输层，不在视觉层。所以明文只在**真的点了那一下**才去取，
 * 且后端每次取回都写一条 `admin.credential_reveal` 审计。
 *
 * <h3>明文只活在这个组件的 state 里</h3>
 * 不写回表单（否则下次保存会把它当成「用户新填的密码」重新加密一遍，白白多一次明文往返），
 * 不进 react-query 缓存。弹窗有 `destroyOnClose`，组件卸载时它就没了。
 */

interface Props {
  /** 由 antd Form.Item 注入。 */
  value?: string;
  /** 由 antd Form.Item 注入。 */
  onChange?: (v: string | undefined) => void;
  field: ParamFieldSchema;
  /** 编辑态的连接 id；新建态传 null（那时没有「已保存的值」可谈）。 */
  connectorId: string | null;
}

export default function SecretField({ value, onChange, field, connectorId }: Props) {
  const { message } = App.useApp();
  const [replacing, setReplacing] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 新建态：没有「已保存的值」，就是一个普通的密码框。
  // antd 自带的眼睛在这里是对的——它显示的是用户自己刚敲进去的东西，不涉及任何取回。
  //
  // ★ value / onChange 必须自己往下传。Form.Item 注入的是**本组件**，不是本组件 return 出来的东西；
  //   漏传就是一个不受控的输入框：用户能打字，但一个字都进不了表单，新建时表现为
  //   「密码明明填了，提交却报密码不能为空」。typecheck 和 lint 都抓不到这个。
  if (!connectorId) {
    return (
      <Input.Password
        autoComplete="new-password"
        placeholder={field.placeholder ?? ''}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      />
    );
  }

  // 更换态：用户明确要改。这时才是一个真正的输入框。
  if (replacing) {
    return (
      <Space.Compact style={{ width: '100%' }}>
        <Input.Password
          autoFocus
          autoComplete="new-password"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={`输入新的${field.label}`}
        />
        <Button
          onClick={() => {
            setReplacing(false);
            // ★ 必须清空。留着用户刚敲的半截值，保存时会把一条好连接改成连不上的。
            onChange?.(undefined);
          }}
        >
          取消更换
        </Button>
      </Space.Compact>
    );
  }

  const reveal = async () => {
    if (revealed !== null) {
      setRevealed(null);
      return;
    }
    setLoading(true);
    try {
      const secrets = await connectorApi.revealCredential(connectorId);
      const v = secrets[field.name];
      if (v === undefined) {
        // 后端按敏感参数名返回。取不到说明两边的字段名对不上，这是配置问题，不是「密码是空的」。
        message.error(`未取到${field.label}，请联系管理员检查连接配置`);
        return;
      }
      setRevealed(v);
    } catch (e) {
      message.error(e instanceof Error ? e.message : `取回${field.label}失败`);
    } finally {
      setLoading(false);
    }
  };

  // 已保存态：这个字段**不往表单里写值**，于是提交时被 stripBlankSecrets 剔掉，后端沿用原值。
  return (
    <Space.Compact style={{ width: '100%' }}>
      <Input
        readOnly
        // 不用 Input.Password：它自带的眼睛只能显示 value 本身，而这里的 value 是一串占位符，
        // 点开只会露出一串 ● 的明文，反而让人以为密码就是这个。眼睛必须是我们自己的。
        value={revealed ?? '••••••••'}
        style={
          revealed
            ? { fontFamily: 'var(--font-mono, monospace)', color: 'inherit' }
            : { color: 'rgba(0,0,0,0.45)' }
        }
        prefix={
          <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            已保存
          </Typography.Text>
        }
      />
      <Tooltip title={revealed ? '隐藏' : '查看明文（会记一条使用记录）'}>
        <Button
          loading={loading}
          icon={revealed ? <EyeInvisibleOutlined /> : <EyeOutlined />}
          onClick={reveal}
        />
      </Tooltip>
      <Button
        onClick={() => {
          setReplacing(true);
          setRevealed(null);
        }}
      >
        更换
      </Button>
    </Space.Compact>
  );
}

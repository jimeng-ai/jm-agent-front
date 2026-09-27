import { Tag, Typography } from 'antd';
import {
  BookOutlined,
  CloudUploadOutlined,
  KeyOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { ConnectorView } from '../types';
import { SemanticStatusTags, SemanticTierTag } from '../presentation';

interface Props {
  connector: ConnectorView;
  compact?: boolean;
}

function AccountState({ connector }: { connector: ConnectorView }) {
  if (connector.writePolicy === 'FORBIDDEN') {
    return connector.readonlyVerified ? (
      <>
        <Tag color="green">只读已验证</Tag>
        <Typography.Text type="secondary">客户侧账号确认不能写入</Typography.Text>
      </>
    ) : (
      <>
        <Tag color="orange">只读未验证</Tag>
        <Typography.Text type="secondary">凭据可能仍有超出需要的权限</Typography.Text>
      </>
    );
  }
  return (
    <>
      <Tag color={connector.writePolicy === 'AUTO' ? 'red' : 'orange'}>按可写账号验收</Tag>
      <Typography.Text type="secondary">
        {connector.readonlyVerified
          ? '当前账号仍是只读，写请求会在客户库失败'
          : '平台允许按当前写策略使用可写权限'}
      </Typography.Text>
    </>
  );
}

function WritePolicyState({ connector }: { connector: ConnectorView }) {
  const label = connector.writePolicyLabel || connector.writePolicy;
  if (connector.writePolicy === 'FORBIDDEN') {
    return (
      <>
        <Tag>{label || '只读'}</Tag>
        <Typography.Text type="secondary">平台拒绝所有写语句</Typography.Text>
      </>
    );
  }
  if (connector.writePolicy === 'REQUIRE_APPROVAL') {
    return (
      <>
        <Tag color="orange">{label}</Tag>
        <Typography.Text type="secondary">每次写入须由超管批准后执行</Typography.Text>
      </>
    );
  }
  return (
    <>
      <Tag color="red">{label}</Tag>
      <Typography.Text type="secondary">模型可直接修改客户数据，不经过人工确认</Typography.Text>
    </>
  );
}

export default function ConnectorSecurityProfile({ connector, compact = false }: Props) {
  return (
    <div className={`connector-security-profile${compact ? ' is-compact' : ''}`}>
      <section className="connector-security-profile__item" aria-label="账号权限">
        <div className="connector-security-profile__label">
          <KeyOutlined aria-hidden />
          <span>账号权限</span>
        </div>
        <div className="connector-security-profile__value">
          <AccountState connector={connector} />
        </div>
      </section>

      <section className="connector-security-profile__item" aria-label="平台写策略">
        <div className="connector-security-profile__label">
          <SafetyCertificateOutlined aria-hidden />
          <span>平台写策略</span>
        </div>
        <div className="connector-security-profile__value">
          <WritePolicyState connector={connector} />
        </div>
      </section>

      <section className="connector-security-profile__item" aria-label="语义状态">
        <div className="connector-security-profile__label">
          <BookOutlined aria-hidden />
          <span>语义状态</span>
        </div>
        <div className="connector-security-profile__value">
          <SemanticStatusTags connector={connector} />
          <Typography.Text type="secondary">
            {connector.semanticNote || '语义说明的生成状态与完整度'}
          </Typography.Text>
        </div>
      </section>

      <section className="connector-security-profile__item" aria-label="出库档位">
        <div className="connector-security-profile__label">
          <CloudUploadOutlined aria-hidden />
          <span>出库档位</span>
        </div>
        <div className="connector-security-profile__value">
          <SemanticTierTag connector={connector} />
          <Typography.Text type="secondary">
            {connector.semanticDataTierEgress || '后端未返回这一档的出库说明'}
          </Typography.Text>
        </div>
      </section>
    </div>
  );
}

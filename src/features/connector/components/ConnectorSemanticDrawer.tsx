import { Drawer } from 'antd';
import ConnectorSemanticContent from '@/features/connector/components/semantic/ConnectorSemanticContent';
import type { ConnectorView } from '@/features/connector/types';

interface Props {
  connector: ConnectorView | null;
  onClose: () => void;
}

/**
 * 列表页的兼容入口。
 *
 * 查询、轮询、重跑 / 删除 mutation、确认文案与所有展示判断都只存在于
 * ConnectorSemanticContent；这里刻意只保留 Drawer 壳，避免独立工作台与旧入口长出两套语义。
 */
export default function ConnectorSemanticDrawer({ connector, onClose }: Props) {
  return (
    <Drawer
      title="语义层工作台"
      open={!!connector}
      onClose={onClose}
      width="min(1480px, calc(100vw - 20px))"
      destroyOnClose
      styles={{ body: { padding: 0 } }}
    >
      {connector && <ConnectorSemanticContent connector={connector} />}
    </Drawer>
  );
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Collapse, Drawer, Empty, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import { connectorApi } from '@/features/connector/api';
import type {
  ConnectorSchemaObject,
  ConnectorView,
  SchemaObjectDiff,
} from '@/features/connector/types';

/**
 * 连接器的结构快照与**漂移检测**。
 *
 * ★ 这个抽屉的价值不在「看表结构」（`conn_describe` 随时能看实时的），而在
 * **「客户悄悄改了什么」**：语义层（指标口径、业务名、样例问答）都挂在具体的表和列上，
 * 客户加一个字段、改一个类型、删一张表，挂在上面的口径就跟着失效——
 * 而这件事今天没有任何别的机制会发现。
 *
 * 两条展示决策：
 * 1. **刷新结果里的 diffs 用醒目的 Alert 呈现**，而不是混在表格里。看结构是日常，
 *    发现漂移是事件，两者不该长得一样。
 * 2. **首次快照不报警**。第一次刷新时「全是新增」没有信息量，把它渲染成一片红色
 *    只会让人下次直接忽略这个提示。
 */

interface Props {
  connector: ConnectorView | null;
  onClose: () => void;
}

/** 差异不超过这个数就全部展开。再多就只展开「删除」，否则会把下面的结构表推得看不见。 */
const EXPAND_ALL_THRESHOLD = 8;

const CHANGE_META: Record<SchemaObjectDiff['change'], { color: string; label: string }> = {
  ADDED: { color: 'green', label: '新增' },
  // 表被删比加字段严重得多：挂在它上面的口径和样例会直接失效。
  REMOVED: { color: 'red', label: '删除' },
  CHANGED: { color: 'orange', label: '变更' },
};

export default function ConnectorSchemaDrawer({ connector, onClose }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [lastDiffs, setLastDiffs] = useState<SchemaObjectDiff[] | null>(null);

  const query = useQuery({
    queryKey: ['connector', 'schema', connector?.id],
    queryFn: () => connectorApi.schema(connector!.id),
    enabled: !!connector,
  });

  const refreshMut = useMutation({
    mutationFn: () => connectorApi.refreshSchema(connector!.id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['connector', 'schema', connector?.id] });
      setLastDiffs(r.firstSnapshot ? [] : r.diffs);
      if (r.firstSnapshot) {
        message.success(`已建立首次快照，共 ${r.objectCount} 个对象`);
      } else if (r.diffs.length === 0) {
        message.success('结构没有变化');
      } else {
        // 用 warning 而不是 success：结构变了是需要人去看一眼的事件。
        message.warning(`检测到 ${r.diffs.length} 处结构变化`);
      }
      if (r.truncated) {
        message.warning(`对象数超过平台上限，本次只覆盖了前 ${r.objectCount} 个，其余对象的变化不会被发现`);
      }
    },
    onError: (e: Error) => message.error(e.message),
  });

  const objects = query.data ?? [];
  const syncedAt = objects[0]?.syncedAt;

  const columns: ColumnsType<ConnectorSchemaObject> = [
    {
      title: '对象',
      key: 'name',
      width: 220,
      render: (_: unknown, r) => (
        <Space size={4} wrap>
          <Typography.Text code>{r.objectName}</Typography.Text>
          <Tag>{r.objectType}</Tag>
        </Space>
      ),
    },
    { title: '说明', dataIndex: 'objectComment', key: 'comment' },
    {
      title: '列数',
      key: 'fields',
      width: 90,
      render: (_: unknown, r) =>
        r.error ? <Typography.Text type="danger">取不到</Typography.Text> : r.fields.length,
    },
  ];

  return (
    <Drawer
      title={connector ? `结构快照 · ${connector.displayName || connector.name}` : '结构快照'}
      open={!!connector}
      onClose={() => {
        setLastDiffs(null);
        onClose();
      }}
      width={900}
      destroyOnClose
      extra={
        <Button
          icon={<ReloadOutlined />}
          loading={refreshMut.isPending}
          onClick={() => refreshMut.mutate()}
        >
          刷新结构
        </Button>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="这份快照用来发现「客户悄悄改了什么」"
        description={
          <>
            Agent 查询时读的是<b>实时</b>结构，不读这份快照——所以它不会导致答错。
            它的用途是与上次比对：客户加了字段、改了类型、删了表，挂在这些表和列上的业务口径就会失效。
            {syncedAt && (
              <>
                <br />
                上次同步：{String(syncedAt).replace('T', ' ').slice(0, 19)}
              </>
            )}
          </>
        }
      />

      {lastDiffs !== null && lastDiffs.length === 0 && (
        <Alert type="success" showIcon style={{ marginBottom: 12 }} message="与上次快照一致，结构没有变化" />
      )}

      {lastDiffs !== null && lastDiffs.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`检测到 ${lastDiffs.length} 处结构变化`}
          description={
            <Collapse
              ghost
              size="small"
              items={lastDiffs.map((d, i) => ({
                key: String(i),
                label: (
                  <Space size={4}>
                    <Tag color={CHANGE_META[d.change].color}>{CHANGE_META[d.change].label}</Tag>
                    <Typography.Text code>{d.objectName}</Typography.Text>
                  </Space>
                ),
                children: d.details.length ? (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {d.details.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                ) : (
                  <Typography.Text type="secondary">（对象级变化，无列级明细）</Typography.Text>
                ),
              }))}
              // 差异少时【全部展开】：这个功能的全部价值就是「客户改了什么」，
              // 把列级明细藏在一次点击后面等于把最有用的信息收起来。
              // 多到一定程度才收起（否则一屏几十条展开项会把下面的结构表推得看不见），
              // 但「删除」永远展开——表被删比加字段严重得多，挂在它上面的口径会直接失效。
              defaultActiveKey={
                lastDiffs.length <= EXPAND_ALL_THRESHOLD
                  ? lastDiffs.map((_, i) => String(i))
                  : lastDiffs
                      .map((d, i) => (d.change === 'REMOVED' ? String(i) : null))
                      .filter((x): x is string => x !== null)
              }
            />
          }
        />
      )}

      <Table<ConnectorSchemaObject>
        rowKey="objectName"
        size="small"
        columns={columns}
        dataSource={objects}
        loading={query.isLoading}
        pagination={false}
        locale={{
          emptyText: <Empty description="还没有快照，点右上角「刷新结构」拉取一次" />,
        }}
        expandable={{
          rowExpandable: (r) => r.fields.length > 0 || !!r.error,
          expandedRowRender: (r) =>
            r.error ? (
              <Typography.Text type="danger">{r.error}</Typography.Text>
            ) : (
              <Table
                rowKey="name"
                size="small"
                pagination={false}
                dataSource={r.fields}
                columns={[
                  { title: '列', dataIndex: 'name', key: 'name', width: 180 },
                  { title: '类型', dataIndex: 'type', key: 'type', width: 160 },
                  {
                    title: '可空',
                    dataIndex: 'nullable',
                    key: 'nullable',
                    width: 70,
                    render: (v: boolean) => (v ? '是' : '否'),
                  },
                  { title: '注释', dataIndex: 'comment', key: 'comment' },
                  { title: '其它', dataIndex: 'extra', key: 'extra', width: 140 },
                ]}
              />
            ),
        }}
      />
    </Drawer>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Descriptions, Drawer, Empty, Segmented, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { connectorApi } from '@/features/connector/api';
import type { ConnectorAuditRow, ConnectorView } from '@/features/connector/types';

/**
 * 一条连接的使用记录。
 *
 * 回答产品方案第 10 节那块要回答的问题：**这个连接被谁、在什么时候、用来做了什么**。
 * 价值不只是合规——无人值守的东西没人盯着，出问题时「能不能看到发生过什么」
 * 决定了排查是十分钟还是三天。
 *
 * 两条展示决策：
 * 1. **默认按连接筛选**（drawer 是从某一行打开的）。后端那条复合索引是
 *    (tenant_id, connector_id, create_time)，带上连接查最快；全表翻页会退化成 filesort。
 * 2. **执行的语句要能完整看到**，所以放进展开行而不是挤在表格列里——
 *    「查数必须亮出过程」这条在事后回溯时同样成立。
 */

interface Props {
  connector: ConnectorView | null;
  onClose: () => void;
}

const CAP_LABEL: Record<string, string> = {
  QUERY: '能查',
  DESCRIBE: '能自描述',
  INVOKE: '能调用',
};

type SuccessFilter = 'all' | 'ok' | 'fail';

export default function ConnectorAuditDrawer({ connector, onClose }: Props) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [successFilter, setSuccessFilter] = useState<SuccessFilter>('all');

  const query = useQuery({
    queryKey: ['connector', 'audit', connector?.id, page, size, successFilter],
    queryFn: () =>
      connectorApi.audit({
        connectorId: connector!.id,
        page,
        size,
        success: successFilter === 'all' ? undefined : successFilter === 'ok',
      }),
    enabled: !!connector,
  });

  const columns: ColumnsType<ConnectorAuditRow> = [
    {
      title: '时间',
      dataIndex: 'time',
      key: 'time',
      width: 160,
      render: (v: string) => (v ? v.replace('T', ' ').slice(0, 19) : '-'),
    },
    {
      title: 'Agent',
      key: 'agent',
      width: 140,
      render: (_: unknown, r) =>
        r.agentName ?? (
          // Agent 被删了审计记录仍在——它记的是历史事实，不该跟着消失。
          <Typography.Text type="secondary">已删除的 Agent</Typography.Text>
        ),
    },
    {
      title: '操作',
      key: 'operation',
      width: 190,
      render: (_: unknown, r) => (
        <Space size={4} wrap>
          <Typography.Text code>{r.operation}</Typography.Text>
          <Tag>{CAP_LABEL[r.capability] ?? r.capability}</Tag>
        </Space>
      ),
    },
    {
      title: '行数',
      dataIndex: 'rowCount',
      key: 'rowCount',
      width: 70,
      render: (v: unknown) => (v === null || v === undefined ? '-' : String(v)),
    },
    {
      title: '耗时',
      dataIndex: 'elapsedMs',
      key: 'elapsedMs',
      width: 80,
      render: (v: unknown) => (v === null || v === undefined ? '-' : `${v} ms`),
    },
    {
      title: '结果',
      key: 'success',
      width: 150,
      render: (_: unknown, r) =>
        r.success ? (
          <Tag color="green">成功</Tag>
        ) : (
          <Space size={4} wrap>
            <Tag color="red">失败</Tag>
            {r.errorCode && <Tag>{r.errorCode}</Tag>}
          </Space>
        ),
    },
  ];

  const rows = query.data?.records ?? [];

  return (
    <Drawer
      title={connector ? `使用记录 · ${connector.displayName || connector.name}` : '使用记录'}
      open={!!connector}
      onClose={onClose}
      width={960}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="这里记录的是对客户系统的每一次实际访问"
        description="包括查目录、看结构、执行查询与调用接口。展开某一行可以看到平台实际执行的语句——它可能与模型写的原文不同（护栏会注入或收紧 LIMIT）。"
      />

      <Space style={{ marginBottom: 12 }}>
        <Segmented<SuccessFilter>
          value={successFilter}
          onChange={(v) => {
            setSuccessFilter(v);
            setPage(1);
          }}
          options={[
            { label: '全部', value: 'all' },
            { label: '仅成功', value: 'ok' },
            { label: '仅失败', value: 'fail' },
          ]}
        />
      </Space>

      <Table<ConnectorAuditRow>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={rows}
        loading={query.isLoading}
        locale={{ emptyText: <Empty description="还没有使用记录" /> }}
        expandable={{
          // 只有「有东西可展开」的行才给箭头，否则一排点不动的箭头很误导。
          rowExpandable: (r) => !!r.statementText || !!r.errorDetail || !!r.traceId,
          expandedRowRender: (r) => (
            <Descriptions size="small" column={1} bordered>
              {r.statementText && (
                <Descriptions.Item label="平台实际执行的语句">
                  <Typography.Paragraph
                    style={{ marginBottom: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}
                    copyable
                  >
                    {r.statementText}
                  </Typography.Paragraph>
                </Descriptions.Item>
              )}
              {r.errorDetail && <Descriptions.Item label="失败原因">{r.errorDetail}</Descriptions.Item>}
              {r.traceId && (
                <Descriptions.Item label="调用链路">
                  <Typography.Text copyable code>
                    {r.traceId}
                  </Typography.Text>
                </Descriptions.Item>
              )}
            </Descriptions>
          ),
        }}
        pagination={{
          current: page,
          pageSize: size,
          total: Number(query.data?.total ?? 0),
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100],
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, s) => {
            setPage(p);
            setSize(s);
          },
        }}
      />
    </Drawer>
  );
}

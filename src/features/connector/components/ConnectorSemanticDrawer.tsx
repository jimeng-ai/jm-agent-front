import type { CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Collapse,
  Descriptions,
  Drawer,
  Empty,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, UserOutlined } from '@ant-design/icons';
import { connectorApi } from '@/features/connector/api';
import {
  confidenceOf,
  detailEntries,
  evidenceMeta,
  formatTime,
  groupByScope,
  historyEntries,
  isHuman,
  isStale,
  joinTarget,
  rowAnchor,
  rowStatusMeta,
  semanticStatusMeta,
  sourceMeta,
  verifiedMeta,
} from '@/features/connector/semantic';
import type { ConnectorSemanticRow, ConnectorView } from '@/features/connector/types';

/**
 * 一条连接的**语义层（说明书）**。
 *
 * 结构快照回答「有哪些表、哪些列」，这个抽屉回答**「它们是什么意思」**：
 * 客户给的只读账号里全是 `t_ord_mst` 这样的名字，没有这一层，模型只能猜哪张是订单、
 * 怎么 join、销售额减不减退款——而**猜错不报错**，只会返回一个看起来很正常的错数字。
 *
 * 四条展示决策，每一条都对应一种「看起来正常、其实已经错了」的情况：
 *
 * 1. **gloss 永远和 source / evidence / verified / status 一起显示。** 只显示那句话，
 *    会让一条可能已经不成立的推测看起来像事实。
 * 2. **人答的口径（source=HUMAN）必须和机器推断长得不一样。** 平台**刻意没有编辑入口**
 *    （口径的纠正走对话），所以这一眼是任何人唯一一次可能发现「这条口径写错了」的机会；
 *    两者长得一样，就等于谁都不会去核其中任何一条。
 * 3. **STALE 要显眼。** 它锚的结构已经变了，这句话可能已经不成立。
 * 4. **JOIN 的 verified=NONE 要说重话。** 现阶段没有采样验证，每条表关系都只是「名字看着像」；
 *    它和一条真外键在界面上长得一样，就会被当成事实用。
 */

interface Props {
  connector: ConnectorView | null;
  onClose: () => void;
}

/** 超过这个行数就分页。OBJECT / FIELD 动辄上百行，一屏铺开会把别的组挤没。 */
const PAGE_THRESHOLD = 20;

/** 人答的口径给一层底色。★ 这一眼是「这句话谁说的」在列表里唯一的区分手段。 */
const HUMAN_ROW_STYLE: CSSProperties = { background: '#f9f0ff' };

export default function ConnectorSemanticDrawer({ connector, onClose }: Props) {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();

  const status = connector?.semanticStatus;
  const statusMeta = semanticStatusMeta(status);
  const running = status === 'RUNNING';

  const query = useQuery({
    queryKey: ['connector', 'semantic', connector?.id],
    queryFn: () => connectorApi.semantic(connector!.id),
    enabled: !!connector,
    // 推导在后台跑完没有任何推送。生成中时自己转一下，否则人盯着的是一个永远不动的抽屉。
    refetchInterval: running ? 5_000 : false,
  });

  const refreshRow = () => {
    qc.invalidateQueries({ queryKey: ['connector', 'list'] });
    qc.invalidateQueries({ queryKey: ['connector', 'semantic', connector?.id] });
  };

  const deriveMut = useMutation({
    mutationFn: () => connectorApi.deriveSemantic(connector!.id),
    onSuccess: () => {
      // ★ 返回的是「已派发」，不是「已生成」。文案一旦写成「已重新生成」，人就会当场关掉抽屉，
      //   带着一份还没变的说明书走人。
      message.info('已提交。推导在后台异步跑，这次点击只是把任务派发出去——进度看上方的状态。');
      refreshRow();
      // 认领（状态变「生成中」）发生在后台线程里，可能比这次 invalidate 晚几百毫秒。
      // 只刷一次多半刷到的还是旧状态，列表那边也就不会开始轮询。补一次。
      window.setTimeout(refreshRow, 2_000);
    },
    onError: (e: Error) => message.error(e.message),
  });

  /**
   * 重跑前把**代价**和**会动什么**说清楚。
   *
   * 两句话都不是客套：
   * - 「只覆盖机器推断的行」是后端那条 SQL 的物理保证
   *   （`DELETE FROM connector_semantic WHERE connector_id = ? AND source = 'INFERRED'`），
   *   不写出来，业务方就不敢点这个按钮——他会以为自己辛苦确认过的口径要被抹掉。
   * - 代价分两档，两个方向记反了都会误导：记成「永远要打客户库」会让人不敢用一个多数时候
   *   很便宜的口子；记成「永远不打」会让人对着一条没快照的连接连点十次。
   */
  const confirmDerive = () => {
    modal.confirm({
      title: '重新生成语义层？',
      width: 560,
      content: (
        <div style={{ fontSize: 13 }}>
          <p style={{ marginTop: 8 }}>
            <b>只覆盖机器推断的行。</b>
            人在对话里答过的口径（<Tag color="purple">人工确认</Tag>）与直接采信客户库注释的（
            <Tag color="blue">库注释</Tag>）<b>一行不动</b>——后端删的时候带着
            <Typography.Text code>source = &apos;INFERRED&apos;</Typography.Text> 这个条件。
          </p>
          <p>
            <b>代价看结构快照在不在。</b>已经有快照（正常情况）：只读平台自己的库 + 一次模型调用，
            对客户系统零访问。快照是空的：会先去客户库补拉一次结构，那是 1 次目录查询 +
            最多 200 次表结构查询。
          </p>
          <p style={{ marginBottom: 0 }}>
            <b>异步。</b>点完立刻返回，推导在后台跑，首次几十秒起步。这里不会当场变成「已生成」。
          </p>
        </div>
      ),
      okText: '开始生成',
      cancelText: '取消',
      onOk: () => deriveMut.mutateAsync(),
    });
  };

  const rows = query.data ?? [];
  const groups = groupByScope(rows);
  const humanCount = rows.filter(isHuman).length;
  const staleCount = rows.filter(isStale).length;

  const columns: ColumnsType<ConnectorSemanticRow> = [
    {
      title: '挂在哪',
      key: 'anchor',
      width: 200,
      render: (_: unknown, r) => {
        const target = r.scope === 'JOIN' ? joinTarget(r) : null;
        return (
          <div>
            <Typography.Text code>{rowAnchor(r)}</Typography.Text>
            {target && (
              <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>→ {target}</div>
            )}
          </div>
        );
      },
    },
    {
      title: '说明（模型读到的就是这句话）',
      key: 'gloss',
      render: (_: unknown, r) => (
        <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>{r.gloss || '—'}</Typography.Text>
      ),
    },
    {
      title: '来源',
      key: 'source',
      width: 150,
      render: (_: unknown, r) => {
        const meta = sourceMeta(r.source);
        return (
          <div>
            <Tooltip title={meta.hint}>
              <Tag color={meta.color} icon={isHuman(r) ? <UserOutlined /> : undefined}>
                {meta.label}
              </Tag>
            </Tooltip>
            {/* 「谁答的、什么时候答的」和「人答的」是同一件事的两半：只说「人工确认」
                而不说是谁，出了错依然没人找得到该问谁。 */}
            {r.answeredName && (
              <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                {r.answeredName}
                {r.answeredAt ? ` · ${formatTime(r.answeredAt, 'MM-DD HH:mm')}` : ''}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: '依据',
      key: 'evidence',
      width: 110,
      render: (_: unknown, r) => {
        const meta = evidenceMeta(r);
        return (
          <Tooltip title={meta.hint}>
            {meta.color ? <Tag color={meta.color}>{meta.label}</Tag> : <span>{meta.label}</span>}
          </Tooltip>
        );
      },
    },
    {
      title: '验证',
      key: 'verified',
      width: 130,
      render: (_: unknown, r) => {
        const meta = verifiedMeta(r);
        return (
          <Tooltip title={meta.hint}>
            <Tag color={meta.color}>{meta.label}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '状态',
      key: 'status',
      width: 110,
      render: (_: unknown, r) => {
        const meta = rowStatusMeta(r.status);
        return (
          <Tooltip title={meta.hint}>
            <Tag color={meta.color}>{meta.label}</Tag>
          </Tooltip>
        );
      },
    },
  ];

  const renderExpanded = (r: ConnectorSemanticRow) => {
    const details = detailEntries(r);
    const history = historyEntries(r);
    const conf = confidenceOf(r);
    return (
      <Descriptions size="small" column={1} bordered>
        {details.map((d) => (
          <Descriptions.Item key={d.key} label={d.label}>
            {d.value}
          </Descriptions.Item>
        ))}
        {conf !== null && (
          <Descriptions.Item label="置信度">
            {conf} / 100
            <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
              （模型自评，只对机器推断的行有意义）
            </Typography.Text>
          </Descriptions.Item>
        )}
        {r.anchorKind && r.anchorKind !== 'NONE' && (
          <Descriptions.Item label="锚定">
            {r.anchorKind}
            <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
              （结构一变，这条会被标成「结构已变」）
            </Typography.Text>
          </Descriptions.Item>
        )}
        {r.traceId && (
          <Descriptions.Item label="来自哪次对话">
            <Typography.Text copyable code>
              {r.traceId}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
              （到「调用日志 · Trace」按它可以回到现场）
            </Typography.Text>
          </Descriptions.Item>
        )}
        {history.length > 0 && (
          /* 任何能对话的人都能覆盖口径，且不做权限区分。这份留痕是那个已知代价的唯一取证材料，
             藏起来等于这个代价从来没有被记录过。 */
          <Descriptions.Item label={`口径被覆盖过 ${history.length} 次（只存旧值）`}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {history.map((h, i) => (
                <li key={i}>
                  {formatTime(h.at)}
                  {h.byName ? ` · ${h.byName}` : ''} 改前：{h.fromGloss || '（空）'}
                </li>
              ))}
            </ul>
          </Descriptions.Item>
        )}
        {r.updateTime && (
          <Descriptions.Item label="最后更新">{formatTime(r.updateTime)}</Descriptions.Item>
        )}
      </Descriptions>
    );
  };

  const hasExpandable = (r: ConnectorSemanticRow) =>
    detailEntries(r).length > 0 ||
    confidenceOf(r) !== null ||
    historyEntries(r).length > 0 ||
    !!r.traceId ||
    !!r.updateTime;

  return (
    <Drawer
      title={connector ? `语义层 · ${connector.displayName || connector.name}` : '语义层'}
      open={!!connector}
      onClose={onClose}
      width={1120}
      destroyOnClose
      extra={
        <Tooltip
          title={
            status === 'NOT_APPLICABLE'
              ? '这种连接器没有结构自描述，没有结构可推——重跑也不会变。'
              : running
                ? '已经有一次推导在跑了，后端会跳过重复的请求。'
                : undefined
          }
        >
          {/* 套一层 span：disabled 的按钮不派发鼠标事件，Tooltip 挂在它身上永远弹不出来——
              而这里恰恰只有 disabled 时才需要那句解释。 */}
          <span>
            <Button
              icon={<ReloadOutlined />}
              loading={deriveMut.isPending}
              disabled={running || status === 'NOT_APPLICABLE'}
              onClick={confirmDerive}
            >
              重新生成
            </Button>
          </span>
        </Tooltip>
      }
    >
      {/* 连接级状态。★ 生成中显示的是【本次开始时间】（semanticClaimAt），
          不是 semanticSyncedAt —— 后者是「上一次成功」的时间，拿它当开始时间会差出一整轮。 */}
      <Alert
        type={statusMeta.alert}
        showIcon
        style={{ marginBottom: 12 }}
        message={`语义层：${statusMeta.label}${
          status === 'READY' && rows.length ? `（${rows.length} 项）` : ''
        }`}
        description={
          <>
            {statusMeta.hint}
            {running && connector?.semanticClaimAt && (
              <>
                <br />
                本次开始于：{formatTime(connector.semanticClaimAt)}
              </>
            )}
            {connector?.semanticSyncedAt && (
              <>
                <br />
                最近一次<b>成功</b>生成：{formatTime(connector.semanticSyncedAt)}
                {status === 'FAILED' && '（失败不会抹掉这个时间戳——下面的行还是那一次的产物）'}
              </>
            )}
            {connector?.semanticNote && (
              <>
                <br />
                最新说明：{connector.semanticNote}
              </>
            )}
          </>
        }
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="这是给模型看的「说明书」，不是给人填的表单"
        description={
          <>
            客户库里全是 <Typography.Text code>t_ord_mst</Typography.Text>{' '}
            这样的名字，模型靠这些行才知道哪张是订单表、怎么 join、销售额减不减退款——
            <b>猜错不会报错，只会返回一个看起来很正常的错数字</b>。
            <br />
            平台<b>刻意不提供编辑入口</b>：口径的纠正走对话（模型问、业务方答、平台记下来）。
            所以这一页是唯一能看出「某条口径写错了」的地方——重点看
            <Tag color="purple" style={{ marginInline: 4 }}>
              人工确认
            </Tag>
            那些行，它们是被当成准绳用的。
          </>
        }
      />

      {rows.length > 0 && (
        <Space size={8} wrap style={{ marginBottom: 12 }}>
          <Tag>共 {rows.length} 项</Tag>
          <Tooltip title="人在对话里答出来的口径。重新生成不会动它们。">
            <Tag color="purple" icon={<UserOutlined />}>
              人工确认 {humanCount} 项
            </Tag>
          </Tooltip>
          {staleCount > 0 && (
            <Tooltip title="它们锚的表/列结构已经变了，这些说明可能已经不成立。">
              <Tag color="red">结构已变 {staleCount} 项</Tag>
            </Tooltip>
          )}
        </Space>
      )}

      {/* 取不到就说取不到。掉到下面的 Empty 会把一次失败的请求显示成「还没有生成过」——
          那是两件完全不同的事，而后者会让人去点重新生成，点多少次都不会有反应。 */}
      {query.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="没能读到语义层"
          description={(query.error as Error)?.message}
        />
      )}

      {query.isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : query.isError ? null : rows.length === 0 ? (
        <Empty
          description={
            status === 'NOT_APPLICABLE'
              ? '这种连接器没有结构自描述，语义层对它不适用——不需要处理'
              : status === 'RUNNING'
                ? '正在生成，稍等一会儿这里就会有内容'
                : '还没有生成过说明书，点右上角「重新生成」'
          }
        />
      ) : (
        <Collapse
          // 人要看的两组默认展开（口径 / 待澄清），机器批量产出的三组收起——
          // 但只要某一组里有「结构已变」，就必须展开：那正是需要人去看一眼的。
          defaultActiveKey={groups
            .filter(
              (g) =>
                g.scope === 'METRIC' || g.scope === 'CAVEAT' || g.rows.some(isStale),
            )
            .map((g) => g.scope)}
          items={groups.map((g) => ({
            key: g.scope,
            label: (
              <Space size={6} wrap>
                <b>{g.meta.label}</b>
                <Tag>{g.rows.length}</Tag>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {g.meta.desc}
                </Typography.Text>
              </Space>
            ),
            children: (
              <Table<ConnectorSemanticRow>
                rowKey="id"
                size="small"
                columns={columns}
                dataSource={g.rows}
                pagination={
                  g.rows.length > PAGE_THRESHOLD
                    ? {
                        pageSize: PAGE_THRESHOLD,
                        size: 'small',
                        showSizeChanger: true,
                        pageSizeOptions: [20, 50, 100],
                        showTotal: (t) => `共 ${t} 条`,
                      }
                    : false
                }
                onRow={(r) => (isHuman(r) ? { style: HUMAN_ROW_STYLE } : {})}
                expandable={{
                  // 只给「真有东西可展开」的行箭头，否则一排点不动的箭头很误导。
                  rowExpandable: hasExpandable,
                  expandedRowRender: renderExpanded,
                }}
              />
            ),
          }))}
        />
      )}
    </Drawer>
  );
}

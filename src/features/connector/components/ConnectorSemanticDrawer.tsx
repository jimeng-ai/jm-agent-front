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
import { DeleteOutlined, ReloadOutlined, UserOutlined, WarningOutlined } from '@ant-design/icons';
import { connectorApi } from '@/features/connector/api';
import {
  SEMANTIC_PARTIAL_CONSEQUENCE,
  confidenceOf,
  detailEntries,
  evidenceMeta,
  formatTime,
  groupByScope,
  historyEntries,
  isHuman,
  isKeyValueTable,
  isStale,
  joinCare,
  joinTarget,
  rowAnchor,
  rowStatusMeta,
  semanticCoverageOf,
  semanticStatusMeta,
  sourceMeta,
  tableShapeOf,
  verifiedMeta,
} from '@/features/connector/semantic';
import type {
  JoinCare,
  SemanticGroup,
  TableShapeView,
  TagMeta,
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
 * 2. **人答的口径（source=HUMAN）必须和机器推断长得不一样。** 改一条口径走的是对话
 *    （模型问、业务方答、平台记下来覆盖），这一页只能**删**、不能改；而删只有企业超管点得到。
 *    所以这一眼往往是「这条口径写错了」被发现的地方，两者长得一样就等于谁都不会去核其中任何一条。
 * 3. **STALE 要显眼。** 它锚的结构已经变了，这句话可能已经不成立。
 * 4. **JOIN 的 verified=NONE 要说重话。** 没用数据核过的表关系只是「名字看着像」；
 *    它和一条真外键在界面上长得一样，就会被当成事实用。
 * 5. **「多态关联 / 复合键」与「键值对表」要在列表里直接看得见，不能只躺在展开详情里。**
 *    前两者漏了条件，join 出来的数字会串表或放大；后者当成明细表聚合全错——都不报错。
 *    机器产出的几组默认收起，所以数量还要露在分组标题上。
 *    存量行没有这些键，就什么都不画（不画「未知」、不画空白）。
 * 6. **「模型读到的」只画模型此刻真读得到的。** 表形态只有给模型的工具认下的那种（来源恰好 MODEL / MEASURED、
 *    取值恰好四种之一）才画成形态、才有键值对表警示；多态关联上存着的判别值，连接**当前**档位没开放样本值时
 *    工具不给模型，这里单独标「不提供给模型」，不画成 join 条件。画多了，人以为模型被告知过，模型其实什么都没收到。
 */

interface Props {
  connector: ConnectorView | null;
  onClose: () => void;
}

/** 超过这个行数就分页。OBJECT / FIELD 动辄上百行，一屏铺开会把别的组挤没。 */
const PAGE_THRESHOLD = 20;

/** 人答的口径给一层底色。★ 这一眼是「这句话谁说的」在列表里唯一的区分手段。 */
const HUMAN_ROW_STYLE: CSSProperties = { background: '#f9f0ff' };

/**
 * 「join 时要带什么条件 / 聚合前要先筛什么」这类附注。和 gloss 分开画：
 * gloss 是「这是什么」，这块是「怎么用才不出错」的硬条件，混在一句话里就读不出轻重。
 */
const CARE_NOTE_STYLE: CSSProperties = {
  marginTop: 6,
  padding: '4px 8px',
  borderLeft: '3px solid #fa8c16',
  background: '#fff7e6',
  fontSize: 12,
  lineHeight: 1.7,
};

const SUB_STYLE: CSSProperties = { fontSize: 12, color: '#999', marginTop: 2 };

/**
 * 多态关联 / 复合键：为什么要当心 + 做对它必须补上的条件。
 *
 * ★ 只把模型**此刻读得到**的东西画成条件。存着、但被档位挡下的判别值单独一句、标明不提供给模型：
 *   画成「列 = 取值」，人会以为模型知道该加哪个类型条件，而模型收到的只有「有这么一列，取值自己去查」。
 */
function JoinCareNote({ care, tierText }: { care: JoinCare; tierText: string }) {
  const c = care.condition;
  return (
    <div style={CARE_NOTE_STYLE}>
      <div>{care.careReason ?? care.hint}</div>
      {care.careReasonWithheld && (
        <Typography.Text type="secondary" style={{ display: 'block' }}>
          （后端记下的原话里嵌着具体取值，当前档位不提供给模型，模型收到的是上面这类通用说明；原话见展开详情）
        </Typography.Text>
      )}
      {c?.type === 'DISCRIMINATOR' && (
        <div>
          join 时带上类型条件：<Typography.Text code>{c.column}</Typography.Text>
          {c.value !== null ? (
            <>
              {' = '}
              <Typography.Text code>{c.value}</Typography.Text>
            </>
          ) : c.withheldValue !== null ? (
            <div>
              <Typography.Text type="warning">
                库里存着的取值 <Typography.Text code>{c.withheldValue}</Typography.Text>
                <b>不提供给模型</b>：这条连接当前是「{tierText}」，没有开放样本值。模型只知道要带
                <Typography.Text code>{c.column}</Typography.Text>
                的类型条件，会被要求先查出取值、拿不准就问人。
              </Typography.Text>
            </div>
          ) : c.valuesAllowed ? (
            <Typography.Text type="secondary">
              （平台没有记下哪个取值对应目标表：还没探查到、没通过敏感信息筛查，或几个取值分不出来。模型会被要求先查出取值、拿不准就问人）
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary">
              （这条连接当前是「{tierText}」，没有开放样本值，具体取值不会随说明书提供给模型）
            </Typography.Text>
          )}
        </div>
      )}
      {c?.type === 'COMPOSITE' && (
        <div>
          目标表
          {c.target && <Typography.Text code>{c.target}</Typography.Text>}要
          {c.columns.map((col, i) => (
            <span key={`${i}-${col}`}>
              {i > 0 && ' + '}
              <Typography.Text code>{col}</Typography.Text>
            </span>
          ))}
          合起来才唯一，join 时这 {c.columns.length} 列都要对上。
        </div>
      )}
    </div>
  );
}

/** 形态是怎么定的（实测 / 模型判断）。实测给绿色标签，模型判断只给灰字：两者可信度不在一个量级。 */
function ShapeSourceMark({ source }: { source: TagMeta }) {
  return (
    <Tooltip title={source.hint}>
      {source.color ? (
        <Tag color={source.color}>{source.label}</Tag>
      ) : (
        <span style={{ fontSize: 12, color: '#999' }}>{source.label}</span>
      )}
    </Tooltip>
  );
}

/**
 * 表形态 + 怎么定的。键值对表加警示图标：它是唯一「当成明细表处理就全错」的形态。
 *
 * 工具没认下的两种（旧行 / 来源或取值认不出）只画一行灰字，**不画标签**：标签长得像标准分类，
 * 人会把「主表」当成平台的判断去用。★ 悬停说明必须照实说「模型读不到」：给模型的工具对这两种一个字都不出。
 * 从前写成「给模型时同样只当一句旧描述」，是在替工具许一个它没兑现的诺——人会以为模型至少看过这句话。
 */
function TableShapeTags({ shape }: { shape: TableShapeView }) {
  if (shape.kind === 'LEGACY') {
    return (
      <Tooltip title="早期推导写的一句自由描述，不是明细表 / 多指标周期表 / 键值对表 / 其他 这四种形态之一，也没有用数据测过。给模型的工具不提供这句描述，也不按它决定怎么聚合——这张表模型读得到的只有「说明」那一栏的话。重新生成后，机器推断的行会按四种形态重新判断。">
        <div style={SUB_STYLE}>旧版描述：{shape.raw}</div>
      </Tooltip>
    );
  }
  if (shape.kind === 'UNRECOGNIZED') {
    return (
      <Tooltip
        title={
          shape.source
            ? '形态取值不是明细表 / 多指标周期表 / 键值对表 / 其他 之一（后端比本页新，或数据写坏了）。给模型的工具只认这四个值，认不出就把这一行的形态整个丢掉：模型读不到它，也收不到键值对表的聚合告警。'
            : `形态来源（table_shape_source）是「${shape.sourceRaw}」，不是 MODEL（模型判断）/ MEASURED（实测）之一（后端比本页新，或数据写坏了）。给模型的工具只认这两个来源，认不出就把这一行的形态整个丢掉：模型读不到它，也收不到键值对表的聚合告警。`
        }
      >
        <div style={SUB_STYLE}>
          未认出的形态：{shape.raw}（{shape.source ? shape.source.label : `来源 ${shape.sourceRaw}`}，模型读不到）
        </div>
      </Tooltip>
    );
  }
  return (
    <div style={{ marginTop: 4 }}>
      <Tooltip title={shape.shape.hint}>
        <Tag color={shape.shape.color} icon={shape.keyValue ? <WarningOutlined /> : undefined}>
          {shape.shape.label}
        </Tag>
      </Tooltip>
      <ShapeSourceMark source={shape.source} />
      {shape.modelGuess && (
        <div style={SUB_STYLE}>
          模型原判：{shape.modelGuess}
          {shape.measured ? '（已被实测推翻）' : ''}
        </div>
      )}
    </div>
  );
}

/** 键值对表：聚合前必须先按指标名筛。实测过的给出具体列名。 */
function KeyValueNote({ shape }: { shape: Extract<TableShapeView, { kind: 'SHAPE' }> }) {
  return (
    <div style={CARE_NOTE_STYLE}>
      一行是一对「指标名 = 值」，不是一条记录。聚合前先按
      {shape.kvNameColumn ? <Typography.Text code>{shape.kvNameColumn}</Typography.Text> : '指标名那一列'}
      筛出一个指标，再对
      {shape.kvValueColumn ? <Typography.Text code>{shape.kvValueColumn}</Typography.Text> : '值那一列'}
      求和或计数。
    </div>
  );
}

/**
 * 分组标题上的提示数。机器产出的几组默认收起、还分页，一张键值对表藏在第 7 页里等于没标。
 * 只露数、不强制展开：这是「性质」，不是「警报」（强制展开留给 STALE）。
 * 返回 null 而不是渲染一个空组件：Space 会给空组件也留一格间距。
 */
function groupFlags(g: SemanticGroup, tier: string | null | undefined) {
  if (g.scope === 'OBJECT') {
    // 只数新版判定下的键值对表：旧行（没有 table_shape_source）哪怕原文写着「键值对」也不算，那不是平台的判断。
    const n = g.rows.filter(isKeyValueTable).length;
    return n > 0 ? (
      <Tooltip title="一行是一对「指标名 = 值」的表。当成明细表直接求和、计数会全错。">
        <Tag color="volcano" icon={<WarningOutlined />}>
          键值对表 {n} 张
        </Tag>
      </Tooltip>
    ) : null;
  }
  if (g.scope === 'JOIN') {
    // 数据不支持（REJECTED）的不计：那几条本来就不会给模型，谈不上「要带条件」。
    const n = g.rows.filter((r) => joinCare(r, tier) && r.verified !== 'REJECTED').length;
    return n > 0 ? (
      <Tooltip title="多态关联 / 复合键：join 时必须带上各行写明的条件，漏了会串表或把数字放大。">
        <Tag color="orange" icon={<WarningOutlined />}>
          需带条件 {n} 条
        </Tag>
      </Tooltip>
    ) : null;
  }
  return null;
}

export default function ConnectorSemanticDrawer({ connector, onClose }: Props) {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();

  const status = connector?.semanticStatus;
  const statusMeta = semanticStatusMeta(status);
  const running = status === 'RUNNING';
  // 残缺信号。★ 只有 PARTIAL 非 null：空值是「没跑过」（存量连接），不是残缺，见 semanticCoverageOf。
  const partialCoverage = semanticCoverageOf(connector ?? undefined);
  // 连接的当前档位。存着的第 3 档取值此刻给不给模型取决于它（semantic.ts sampleValuesAllowed），
  // 往下每一处读条件、读详情都要带上——joinCare / detailEntries 把它设成必填，就是不让哪一处漏掉。
  const tier = connector?.semanticDataTier;
  const tierText = connector?.semanticDataTierLabel || connector?.semanticDataTier || '未知档位';

  const query = useQuery({
    queryKey: ['connector', 'semantic', connector?.id],
    queryFn: () => connectorApi.semantic(connector!.id),
    enabled: !!connector,
    // 推导在后台跑完没有任何推送。生成中时自己转一下，否则人盯着的是一个永远不动的抽屉。
    refetchInterval: running ? 5_000 : false,
  });

  // ★ 按入参里的连接 id 刷，不读闭包里的 connector：派发返回时抽屉可能已经换成了别的连接，
  //   那时刷的应当仍是【点了重新生成的那条】（与结构快照抽屉同一个坑，那边把 A 的结果画进了 B）。
  const refreshRow = (id: string) => {
    qc.invalidateQueries({ queryKey: ['connector', 'list'] });
    qc.invalidateQueries({ queryKey: ['connector', 'semantic', id] });
  };

  const deriveMut = useMutation({
    mutationFn: (id: string) => connectorApi.deriveSemantic(id),
    onSuccess: (_: unknown, id) => {
      // ★ 返回的是「已派发」，不是「已生成」。文案一旦写成「已重新生成」，人就会当场关掉抽屉，
      //   带着一份还没变的说明书走人。
      message.info('已提交。推导在后台异步跑，这次点击只是把任务派发出去——进度看上方的状态。');
      refreshRow(id);
      // 认领（状态变「生成中」）发生在后台线程里，可能比这次 invalidate 晚几百毫秒。
      // 只刷一次多半刷到的还是旧状态，列表那边也就不会开始轮询。补一次。
      window.setTimeout(() => refreshRow(id), 2_000);
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
    if (!connector) return;
    // 在点按钮这一刻就把 id 定下来：确认框开着的时候抽屉也可能被换掉，点「开始生成」派发的必须是打开确认框的那条。
    const targetId = connector.id;
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
      onOk: () => deriveMut.mutateAsync(targetId),
    });
  };

  const deleteMut = useMutation({
    mutationFn: (v: { connectorId: string; rowId: string }) =>
      connectorApi.deleteSemanticRow(v.connectorId, v.rowId),
    onSuccess: (res, v) => {
      // ★ removed 按字符串下发（本工作区契约：数字字段按字符串出网），比较前必须 Number()。
      if (Number(res?.removed ?? 0) > 0) {
        message.success('已删除。这一行是物理删除，不可恢复。');
      } else {
        // 后端对「这行本来就不在」返回 removed=0 且不报错。当成成功提示会骗人，当成失败也骗人——
        // 如实说它已经不在了，人才知道不用再点第二次。
        message.info('这一行已经不在了（可能刚被别人删掉），本次没有删除任何内容。');
      }
      refreshRow(v.connectorId);
    },
    onError: (e: Error) => message.error(e.message),
  });

  /**
   * 删一行之前，把**三件会让人后悔**的事说全。
   *
   * 少说哪一件都会导致一次谁都没打算做的删除：
   * - **物理删除、不可恢复**：这不是别处那种「停用 / 软删」，库里那一行是真的没了。
   * - **机器推断的行删了会回来**：下一次重新生成又会把它原样推一遍。要它不再出现，
   *   得去改让它被推出来的东西（结构注释、口径），删这一行只是清掉当前这一份。
   * - **人工确认的行删了，覆盖留痕一起消失**：那份留痕是「任何能对话的人都能覆盖口径」
   *   这个已知代价的唯一取证材料，删掉之后再没有任何地方能回答「这条口径被谁改过几次」。
   */
  const confirmDeleteRow = (r: ConnectorSemanticRow) => {
    if (!connector || !r.id) return;
    // ★ 在【点击这一刻】就把两个 id 定下来。确认框开着的时候抽屉可能已经被换成另一条连接
    //   （列表在轮询，外面点一下别的行就换了），那时再读闭包里的 connector，
    //   一次对 A 的确认会落到 B 上——而 rowId 在 B 上多半查无此行，删不掉、也看不出哪里不对。
    const connectorId = connector.id;
    const rowId = r.id;
    const human = isHuman(r);
    modal.confirm({
      title: `删除这一行语义「${rowAnchor(r)}」？`,
      width: 560,
      content: (
        <div style={{ fontSize: 13 }}>
          <p style={{ marginTop: 8 }}>
            <b>物理删除，不可恢复。</b>这不是停用、也不是软删——库里那一行会被真的删掉，
            没有回收站，也没有撤销。
          </p>
          <p>
            <b>机器推断的行（</b>
            <Tag color="default">机器推断</Tag>
            <b>）删掉后，下次重新生成会再推一遍。</b>
            这里删的只是当前这一份；要它不再出现，得去处理让它被推出来的东西。
          </p>
          <p style={{ marginBottom: 0 }}>
            <b>人工确认的行（</b>
            <Tag color="purple">人工确认</Tag>
            <b>）删掉后，连同它的覆盖留痕一起消失。</b>
            那份留痕是「这条口径被谁、在哪次对话里改过」的唯一记录，删了就再也查不到。
            {human && <b>——你正要删的就是这样一行。</b>}
          </p>
        </div>
      ),
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => deleteMut.mutateAsync({ connectorId, rowId }),
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
        const care = joinCare(r, tier);
        const shape = tableShapeOf(r);
        return (
          <div>
            <Typography.Text code>{rowAnchor(r)}</Typography.Text>
            {target && <div style={SUB_STYLE}>→ {target}</div>}
            {care && (
              <div style={{ marginTop: 4 }}>
                <Tooltip title={care.hint}>
                  <Tag color="orange" icon={<WarningOutlined />}>
                    {care.label}
                  </Tag>
                </Tooltip>
              </div>
            )}
            {shape && <TableShapeTags shape={shape} />}
          </div>
        );
      },
    },
    {
      title: '说明（模型读到的就是这句话）',
      key: 'gloss',
      render: (_: unknown, r) => {
        const care = joinCare(r, tier);
        const shape = tableShapeOf(r);
        return (
          <div>
            <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>{r.gloss || '—'}</Typography.Text>
            {care && <JoinCareNote care={care} tierText={tierText} />}
            {shape?.kind === 'SHAPE' && shape.keyValue && <KeyValueNote shape={shape} />}
          </div>
        );
      },
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
        // 带上 scope：「结构已变」的口径整条停止注入，其它 scope 带着标记照样注入——悬停说明必须跟着分开说。
        const meta = rowStatusMeta(r.status, r.scope);
        return (
          <Tooltip title={meta.hint}>
            <Tag color={meta.color}>{meta.label}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '操作',
      key: 'ops',
      width: 88,
      render: (_: unknown, r) => (
        // 只有删，没有改：改一条口径走的是对话（同一个 term 再答一次覆盖，并留痕），
        // 在这里直接编辑 gloss 会绕开「谁在哪次对话里说的」这套追溯，把一句话变成没有出处的断言。
        <Tooltip title="物理删除，不可恢复">
          <Button
            type="link"
            danger
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => confirmDeleteRow(r)}
          >
            删除
          </Button>
        </Tooltip>
      ),
    },
  ];

  const renderExpanded = (r: ConnectorSemanticRow) => {
    const details = detailEntries(r, tier);
    const history = historyEntries(r);
    const conf = confidenceOf(r);
    return (
      <Descriptions size="small" column={1} bordered>
        {details.map((d) => (
          <Descriptions.Item key={d.key} label={d.label}>
            {/* 保留换行：形态实测的留痕是多行（结论 / 测的两列 / 依据），挤成一行就读不出层次。 */}
            <span style={{ whiteSpace: 'pre-wrap' }}>{d.value}</span>
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
    detailEntries(r, tier).length > 0 ||
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

      {/* 说明书不是全本。
          ★ 这条横幅是**加出来的**，上面那条状态横幅里的 semanticNote 全文一个字都没动——
            后端写的那段散文（「本次只覆盖 9/14 张表」「模型输出被 max_tokens 截断」）照旧在那里，
            运维读的还是它。这里只是把**同一件事**从散文里拎出来，给它一个看得见的位置。
          ★ 独立一条 warning 而不是并进上面那条 success：并进去就又变成一段接在成功后面的小字，
            而「生成成功」和「生成出来的东西不全」正是最容易被读成一件事的两件事。
          ★ 文案落点是**后果**，不是现象：模型看不到缺掉的那部分，它不会报错，只会答得不对。 */}
      {partialCoverage && (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          style={{ marginBottom: 12 }}
          message="这份说明书不完整"
          description={
            <>
              {SEMANTIC_PARTIAL_CONSEQUENCE}
              <br />
              下面列出来的行是<b>已经生成的那部分</b>，它们本身照常可用——缺的是没列出来的那些。
              {partialCoverage.gaps.length > 0 && (
                <ul style={{ margin: '8px 0 0', paddingInlineStart: 20 }}>
                  {partialCoverage.gaps.map((g) => (
                    <li key={g.label}>
                      <b>{g.label}</b>：{g.desc}
                    </li>
                  ))}
                </ul>
              )}
              {/* 后端只说了 PARTIAL、没给成因码时也要把话说完整：少了成因不等于少了后果。 */}
              {partialCoverage.gaps.length === 0 && (
                <>
                  <br />
                  后端没有给出具体成因，详情看上面那条「最新说明」的全文。
                </>
              )}
            </>
          }
        />
      )}

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
            这一页<b>只能删、不能改</b>：改一条口径走的是对话（模型问、业务方答，用同一个词条覆盖并留痕），
            在这里直接编辑会让一句话变成没有出处的断言。删除是物理删除、不可恢复，而且只有企业超管点得到——
            发现口径错了的业务方通常要来找超管。所以重点看
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
            <Tooltip title="它们锚的表/列结构已经变了，这些说明可能已经不成立。其中业务口径整条不再提供给模型；表用途、字段含义、表关系仍会提供给模型，只是带着「结构已变」的标记。">
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
                {groupFlags(g, tier)}
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

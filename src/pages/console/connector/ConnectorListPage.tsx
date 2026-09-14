import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Badge,
  Button,
  Empty,
  Form,
  Input,
  Result,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import { Modal } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, SyncOutlined } from '@ant-design/icons';
import { authApi } from '@/features/auth/api';
import { connectorApi } from '@/features/connector/api';
import GrantScriptPanel from '@/features/connector/components/GrantScriptPanel';
import SchemaForm from '@/features/connector/components/SchemaForm';
import ConnectorAuditDrawer from '@/features/connector/components/ConnectorAuditDrawer';
import ConnectorSchemaDrawer from '@/features/connector/components/ConnectorSchemaDrawer';
import ConnectorSemanticDrawer from '@/features/connector/components/ConnectorSemanticDrawer';
import { formatTime, semanticStatusMeta } from '@/features/connector/semantic';
import type {
  ConnectorKind,
  ConnectorUpsert,
  ConnectorView,
  ProbeOutcome,
  SemanticDataTier,
} from '@/features/connector/types';

/**
 * 数据连接（连接器实例）管理。
 *
 * ★ 整页**不认识任何具体的连接器类型**：类型下拉、表单字段、校验规则全部来自
 * `GET /admin/connectors/kinds`。加一种新类型时这个文件一行都不用改——
 * 这是技术架构 §15 那条验收标准在前端的兑现点。
 *
 * 与「外部连接」页（`/console/connections`）的关系：那个页面服务沙箱 egress 那条既有链路，
 * 保持原样；两个页面读写同一张表，那边建的行 kind 默认是 HTTP。
 */

/**
 * 参数值的类型。刻意不用 `Record<string, unknown>`：antd 的 setFieldsValue 要求
 * 值是 `{} | undefined`，unknown 不满足。而 ParamType 能产生的值也只有这几种，
 * 收窄成联合类型比到处 cast 更诚实。
 */
type ParamValues = Record<string, string | number | boolean | string[] | undefined>;

interface FormValues {
  name: string;
  displayName?: string;
  kind: string;
  params: ParamValues;
  /** 写策略。默认 FORBIDDEN（只读）——放开容易收紧难，默认值取最严的那个。 */
  writePolicy: string;
  /**
   * 数据出库档位。
   *
   * ★ 编辑时**必须从 ConnectorView.semanticDataTier 回填**：后端是整体覆盖的 PUT，
   *   这个字段留空等于第 2 档，**不等于「保持原样」**。漏了它，用户只是来改个显示名，
   *   一条第 3 档的连接就被降回第 2 档，而界面上什么都不会说。
   */
  semanticDataTier: string;
}

/**
 * 写策略三档。
 *
 * ★ 这是**平台侧的闸**，不是数据库侧的授权。两者必须一起配：选了「写自动」而数据库账号
 * 只有 SELECT，写操作照样会失败（而且失败在客户库上，排查更绕）。弹窗里的「生成授权命令」
 * 面板跟着这个值走，就是为了让两边在同一个动作里对齐。
 *
 * 措辞上刻意不用「读/写/改」——那是权限的说法，而这里配的是**平台放不放行**：
 * 同一个可写账号，策略调成只读，平台就一条写语句都不会发出去。
 */
const WRITE_POLICY_OPTIONS = [
  { value: 'FORBIDDEN', label: '只读 —— 平台拒绝一切写操作（推荐）' },
  { value: 'REQUIRE_APPROVAL', label: '写需审批 —— 模型提交，超管在「写操作审批」页逐条批准后才执行' },
  { value: 'AUTO', label: '写自动 —— 模型可直接改数据，仅受护栏与行数上限约束' },
];

/**
 * 数据出库档位的一档：下拉框那一行、选中后常驻的那条横幅、以及「什么东西会出库」那句话。
 *
 * ★ `egress` 是**逐字抄自后端 `SemanticDataTier.egressStatement()`** 的。那句话同时出现在
 *   DDL 列注释、接口文档和连接详情接口的响应里，是同一句话的几个落点——
 *   前端这份只是抄本，改这里就要同步改后端那份。安全说明和实现分叉，等于没有安全说明。
 *   连接详情带下来的 `semanticDataTierEgress` 是正本，能拿到时优先显示它。
 */
interface SemanticDataTierMeta {
  value: SemanticDataTier;
  /** 下拉框里的一行。★ 第 3 档这一行自己就要把「真实取值出库」说完，不能只写档位名。 */
  label: string;
  alert: 'info' | 'warning' | 'error';
  /** 选中后那条横幅的标题。 */
  title: string;
  /** 这一档具体什么东西会离开客户的数据库。 */
  egress: string;
  /** 额外要说重的那一句（代价 / 后果）。没有就不显示。 */
  extra?: string;
}

/**
 * 数据出库档位三档：为了看懂客户那个库，我们允许**什么形态的东西**离开它。
 *
 * ★ 它和「写策略」不是一回事，也不能互相替代：那道闸管「能不能改客户的数据」，
 *   这道闸管「能带走客户的**什么**数据」。一条只读连接照样可能在第 3 档上把真实取值带出来。
 *
 * ★ 这里刻意把话写在**下拉框那一行**和**常驻横幅**上，而不是塞进 tooltip：
 *   这是一次由人做的、有安全后果的选择，界面就是他了解自己在选什么的唯一地方。
 *   要人把鼠标悬上去才说的后果，等于没说。
 *
 * ★ **两个方向的代价都要说**。只讲第 3 档的风险、不讲第 1 档的代价，所有人都会一路点到最严那档，
 *   然后这套东西在没人知道的情况下静默变差：真实生产库上，仅凭名字推表关系的精确率约 0.49，
 *   而推错的表关系不会报错，只会让模型 join 出一个看着很正常的错数字——比「查不出来」难发现得多。
 */
const SEMANTIC_DATA_TIERS: SemanticDataTierMeta[] = [
  {
    value: 'METADATA_ONLY',
    label: '第 1 档 · 纯元数据 —— 只有表名、列名、类型、索引和客户自己写的注释出库，不做任何聚合',
    // 不是 info：最严的那一档同样有代价，把它渲染成一条中性提示，就是在替客户隐瞒这件事。
    alert: 'warning',
    title: '这一档不是免费的：推出来的表关系里大约一半是错的，而且不报错',
    egress:
      '只有表名、列名、数据类型、可空性、索引和客户自己写在库里的注释会离开数据库。' +
      '不做任何聚合，没有一条业务记录参与运算。代价：仅凭名字推表关系，真实生产库上精确率约 0.49，' +
      '推出来的关系需要人工确认。',
    extra:
      '选这一档就等于同时接受「表关系要人工确认」：错的那一半不会报错，只会让模型 join 出一个看着很正常的错数字。',
  },
  {
    value: 'DERIVED_STATS',
    label: '第 2 档 · 派生统计【默认】 —— 允许在客户库内聚合，只带走统计量，逐行记录不出库',
    alert: 'info',
    title: '第 2 档（默认）会带走什么',
    egress:
      '在纯元数据之上，允许在客户库内做聚合、只把算出来的统计量带走：' +
      'distinct 数、NULL 率、min/max、字符形状、两列之间的包含率、基数、minhash sketch' +
      '（K 个哈希值，不是原始值）。逐行的业务记录不出库。' +
      '但要如实说明：min/max 本身就是两个真实取值，低基数列的 distinct 数也会透露取值空间的大小。',
  },
  {
    value: 'SAMPLE_VALUES',
    label:
      '第 3 档 · 样本值 —— 客户库里的【真实取值】本身出库（某列 top-k 实际值、低基数列的全量维值索引）',
    alert: 'error',
    title: '这一档会把客户库里的真实取值带进我们的库',
    egress:
      '在派生统计之上，允许把【真实取值】本身带出数据库：某列的 top-k 实际值、低基数列的全量维值索引。' +
      '说白了，「地区」列的维值索引意味着贵司所有地区名进入我们的库，' +
      '「客户名称」列的 top-k 意味着最高频的真实客户名进入我们的库。' +
      '这一档默认关闭，只能由企业超管显式开启。取值出库前会过 PII 过滤（按列名与取值形状两道），' +
      '但如实说明：同类实现的 PII 检测召回率约 95%，即大约每 20 个 PII 取值仍可能漏掉 1 个，' +
      '过滤是减损手段，不是保证。',
    extra:
      '开启前请和客户把上面这句话原样说一遍：top-k 天然会把 PII 捞出来——姓名、手机号、地址就躺在高频取值里；' +
      '有过滤不等于过滤得干净，这一档的正当性来自「有人为它做过一次决定」，不来自过滤器。',
  },
];

/**
 * 新建时的默认档。与后端 `SemanticDataTier.DEFAULT` 一致。
 *
 * ★ 刻意**不是**最严的第 1 档——这一点和写策略的默认值相反，理由也不同：
 *   把「没选过」一律压到第 1 档，等于静默地把表关系推断的精确率打对折（约 1.00 → 约 0.49），
 *   而不会有任何人收到通知。「没选过」不等于「选了最严的」。
 * ★ 它永远不可能是第 3 档：真实取值出库只能是一次显式动作。
 */
const DEFAULT_SEMANTIC_DATA_TIER: SemanticDataTier = 'DERIVED_STATS';

/** 认不出来（含后端比前端新、或库里被手工改过）返回 undefined，调用方必须自己兜底，不能留空白。 */
const semanticDataTierMeta = (v?: string | null): SemanticDataTierMeta | undefined =>
  SEMANTIC_DATA_TIERS.find((t) => t.value === v);

const healthBadge = (row: ConnectorView) => {
  const status =
    row.healthState === 'HEALTHY' ? 'success' : row.healthState === 'UNHEALTHY' ? 'error' : 'default';
  const text =
    row.healthState === 'HEALTHY' ? '健康' : row.healthState === 'UNHEALTHY' ? '异常' : '未探测';
  const badge = <Badge status={status} text={text} />;
  // 不健康的原因后端已脱敏，可以直接展示——用户看不到原因就只能猜。
  return row.healthReason ? <Tooltip title={row.healthReason}>{badge}</Tooltip> : badge;
};

/**
 * 语义层那一格。
 *
 * ★ 后端能产出的状态**一个不能漏**（NONE / RUNNING / READY / FAILED / NOT_APPLICABLE），
 * 还要兜住第六种——前端比后端新、或后端加了新值。漏掉一个，这一格就是**空白**，
 * 而「空白」和「没跑过」在人眼里是一回事：一条根本推不了语义层的 HTTP 连接会被当成卡住了，
 * 有人去点重试，永远点不出结果。映射表和兜底都在 `features/connector/semantic.ts` 里。
 *
 * ★ NOT_APPLICABLE 走**灰色**而不是红色：它不是错误，是「这种连接器没有结构可推」。
 * 把它渲染成红色，等于训练所有人忽略这一列——那样真正 FAILED 的几条也就没人看了。
 *
 * ★ 生成中显示的是 semanticClaimAt（本次开始时间），不是 semanticSyncedAt——
 * 后者是「上一次成功」的时间，拿它当开始时间会差出一整轮。
 */
const semanticTag = (row: ConnectorView) => {
  const meta = semanticStatusMeta(row.semanticStatus);
  const running = row.semanticStatus === 'RUNNING';
  const tip = (
    <>
      {meta.hint}
      {running && row.semanticClaimAt && (
        <>
          <br />
          本次开始于：{formatTime(row.semanticClaimAt)}
        </>
      )}
      {row.semanticSyncedAt && (
        <>
          <br />
          最近一次<b>成功</b>生成：{formatTime(row.semanticSyncedAt)}
        </>
      )}
      {/* semanticNote 是后端写的摘要/失败原因，未统一脱敏（可能带客户主机名、账号）。
          本页限企业超管，可以展示；别把它搬到客户侧的任何界面上。 */}
      {row.semanticNote && (
        <>
          <br />
          说明：{row.semanticNote}
        </>
      )}
    </>
  );
  return (
    <Tooltip title={tip}>
      <Tag color={meta.color} icon={running ? <SyncOutlined spin /> : undefined}>
        {meta.label}
      </Tag>
    </Tooltip>
  );
};

export default function ConnectorListPage() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<FormValues>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectorView | null>(null);
  const [selectedKind, setSelectedKind] = useState<string | undefined>();
  const [probeResult, setProbeResult] = useState<ProbeOutcome | null>(null);
  const [auditOf, setAuditOf] = useState<ConnectorView | null>(null);
  const [schemaOf, setSchemaOf] = useState<ConnectorView | null>(null);
  /**
   * ★ 语义层抽屉存的是 **id**，而不是像 auditOf / schemaOf 那样存整行。
   *
   * 那两个抽屉看的是已经发生过的事，打开那一刻的快照就够了；这个抽屉要显示
   * 「生成中 → 已生成 / 失败」的变化。存整行等于把状态冻在点开的那一刻——
   * 下面的轮询把列表刷新了，抽屉里那条横幅还停在「生成中」，而它永远不会自己变。
   */
  const [semanticOfId, setSemanticOfId] = useState<string | null>(null);

  // 授权命令面板要跟着表单当前值走，所以用 useWatch 而不是读一次初值：
  // 用户把策略从「只读」改成「写自动」之后，生成的命令必须立刻跟着变成带写权限的那版，
  // 否则他会拿着一段只读授权去配一条允许写的连接——两边分叉，且分叉在客户那边才暴露。
  const watchedPolicy = Form.useWatch('writePolicy', form);
  // 出库档位那条横幅同样跟着当前值走：换一档，界面上那句「什么东西会离开客户的库」必须立刻跟着换。
  const watchedTier = Form.useWatch('semanticDataTier', form);
  // 库名是通用参数名，不是类型分支：没有这个参数的类型（如 HTTP）读出来就是 undefined，
  // 而 HTTP 连接器本来也不提供授权脚本，面板会自己说明。这里不出现任何 if (kind === ...)。
  const watchedDatabase = Form.useWatch(['params', 'database'], form) as string | undefined;

  // 超管门控：staleTime 必须与其它用到 ['me','permissions'] 的地方一致（全局默认是 30s，
  // 这里和 ModuleRoute / WorkbenchSidebar 一样显式写 60s），否则同 key 不同 staleTime 会多发请求。
  const { data: perm, isLoading: permLoading } = useQuery({
    queryKey: ['me', 'permissions'],
    queryFn: authApi.mePermissions,
    staleTime: 60_000,
  });

  const enabled = perm?.superAdmin === true;

  const kindsQuery = useQuery({
    queryKey: ['connector', 'kinds'],
    queryFn: connectorApi.kinds,
    enabled,
    // 类型清单只随后端发版变化，不用频繁刷。
    staleTime: 5 * 60_000,
  });

  const listQuery = useQuery({
    queryKey: ['connector', 'list'],
    queryFn: connectorApi.list,
    enabled,
    // 语义层推导是后台异步跑的，跑完**没有任何推送**。有行停在「生成中」时自己转一下，
    // 否则那一格会一直停在生成中，人只能靠手动刷新页面才知道跑完没有。
    // 没有行在跑就完全不轮询——这是一张全量列表，不该为了一个偶发状态一直打后端。
    refetchInterval: (q) =>
      q.state.data?.some((r) => r.semanticStatus === 'RUNNING') ? 5_000 : false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['connector', 'list'] });

  /**
   * 试连。不落库——跑的是和「创建并验证」同一套三步探测，所以这里过了创建就一定过。
   *
   * 结果就地渲染成 Alert 而不是 toast：配错时要边看原因边改表单，
   * 一闪而过的 toast 等于让人凭记忆改。
   */
  const probeMut = useMutation({
    mutationFn: (payload: ConnectorUpsert) => connectorApi.probe(payload, editing?.id),
    onSuccess: (r) => setProbeResult(r),
    // 接口层面的失败（参数没填全、没权限）也要让人看见，不能静默。
    onError: (e: Error) =>
      setProbeResult({ ok: false, failureReason: e.message, capabilities: [], readonlyVerified: false, readonlyUndetermined: false }),
  });

  const createMut = useMutation({
    mutationFn: (payload: ConnectorUpsert) => connectorApi.create(payload),
    onSuccess: () => {
      message.success('已创建（连通性、只读权限与能力均已验证通过）');
      closeModal();
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: (payload: ConnectorUpsert) => connectorApi.update(editing!.id, payload),
    onSuccess: () => {
      message.success('已保存');
      closeModal();
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const testMut = useMutation({
    mutationFn: (id: string) => connectorApi.test(id),
    onSuccess: (row) => {
      // 配错必须当场看得见：成功与失败都给明确反馈，不要只刷新列表让用户自己找。
      if (row.healthState === 'HEALTHY') message.success('连接正常');
      else message.error(row.healthReason || '连接异常');
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const statusMut = useMutation({
    mutationFn: (v: { id: string; status: 'ACTIVE' | 'DISABLED' }) =>
      connectorApi.setStatus(v.id, v.status),
    onSuccess: () => {
      message.success('状态已更新');
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => connectorApi.remove(id),
    onSuccess: () => {
      message.success('已删除');
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const kinds: ConnectorKind[] = useMemo(() => kindsQuery.data ?? [], [kindsQuery.data]);
  const activeKind = useMemo(
    () => kinds.find((k) => k.kind === selectedKind),
    [kinds, selectedKind],
  );

  const closeModal = () => {
    setOpen(false);
    setEditing(null);
    setSelectedKind(undefined);
    setProbeResult(null);
    form.resetFields();
  };

  const openCreate = () => {
    setEditing(null);
    setProbeResult(null);
    // 表单内容由下面的 initialFormValues 给（见 <Form initialValues> 处的注释）。
    // 这里只管状态：selectedKind 决定渲染哪套参数字段。
    setSelectedKind(kinds[0]?.kind);
    setOpen(true);
  };

  const openEdit = (row: ConnectorView) => {
    setEditing(row);
    setProbeResult(null);
    setSelectedKind(row.kind);
    setOpen(true);
  };

  /**
   * 弹窗里表单的初始值。
   *
   * ★ **必须走 initialValues，不能在 openCreate / openEdit 里 setFieldsValue**。
   * Modal 带 `destroyOnClose`，弹窗关着的时候 `<Form>` 是卸载的，此时 `useForm` 拿到的实例
   * 并没有连上任何 Form 元素——在它上面调 setFieldsValue 会被**静默丢弃**
   * （antd 只在 dev 下警告一次，生产什么都不会发生）。而 openCreate / openEdit 恰恰是
   * 在 `setOpen(true)` 之前调用的，于是：新建时默认值不生效、编辑时整张表单是空的，
   * 两种都不报错。表单随弹窗每次重新挂载，所以放在 initialValues 里每次打开都会重新读。
   */
  const initialFormValues = useMemo<Partial<FormValues>>(() => {
    if (editing) {
      return {
        name: editing.name,
        displayName: editing.displayName ?? undefined,
        kind: editing.kind,
        // 后端认不出来的值已经在 WritePolicy.parse 里回落成 FORBIDDEN，这里不用再兜一次。
        writePolicy: editing.writePolicy,
        /**
         * ★★ 出库档位必须**原样回填**，这是这个表单最容易出的那种静默 bug。
         *
         * 提交走的是整体覆盖的 PUT，而后端刻意规定「留空 = 默认档（第 2 档）」而不是「保持原样」——
         * 让省略等于沿用，会造出一个没人审计得到的粘性状态：此后每一次改显示名的保存
         * 都在默默给第 3 档续期，事后谁也说不清当初是谁把真实取值出库打开的。
         *
         * 所以不回填的后果很具体：来改一个显示名，顺手把一条第 3 档的连接降回第 2 档，
         * 不报错、不提示，界面上那一格下次刷新才变。
         *
         * `??` 那一支只在「后端老得还没有这个字段」时才会走到——那种情况下本来也没有档位可沿用，
         * 落到与后端同一个默认值是唯一诚实的选择。后端一旦返回了值（包括本页还不认识的值），
         * 走的永远是原样回填。
         */
        semanticDataTier: editing.semanticDataTier ?? DEFAULT_SEMANTIC_DATA_TIER,
        // 敏感参数后端不回传，所以这里天然是空的 —— 留空即沿用原值。
        params: { ...(editing.params as ParamValues) },
      };
    }
    const first = kinds[0]?.kind;
    return {
      kind: first,
      // ★ 新建默认只读。这是产品上定下的默认值：绝大多数接入就该停在只读，
      //   而「默认放开、由用户去收紧」这种默认值，现实里没人会回头收紧。
      writePolicy: 'FORBIDDEN',
      // ★ 出库档位的默认值**刻意不是最严的那档**（和上面那条相反的取舍，理由见常量注释）：
      //   把「没选过」压到第 1 档，等于静默把表关系推断的精确率打对折，而没有人会被通知。
      semanticDataTier: DEFAULT_SEMANTIC_DATA_TIER,
      params: defaultsOf(kinds.find((k) => k.kind === first)),
    };
  }, [editing, kinds]);

  /**
   * 档位下拉的选项。
   *
   * ★ 编辑一条档位值本页不认识的连接（后端比前端新、或者库里被手工改过）时，要把那个值
   *   **原样留在选项里**：选项里没有它，antd 只会把原始枚举名当标签显示，用户看到一个
   *   没头没尾的 `SOME_TIER`，最可能的反应是随手换成一个看得懂的——而那就是一次
   *   谁都没打算做的改档。给它一行明确的说明，比让人去猜安全。
   */
  const tierOptions = useMemo(() => {
    const base = SEMANTIC_DATA_TIERS.map((t) => ({ label: t.label, value: t.value as string }));
    const current = editing?.semanticDataTier;
    if (current && !base.some((o) => o.value === current)) {
      base.push({
        label: `${editing?.semanticDataTierLabel || current} —— 本页还不认识这个档位，保存将原样提交`,
        value: current,
      });
    }
    return base;
  }, [editing]);

  const onFinish = (v: FormValues) => {
    const payload: ConnectorUpsert = {
      name: v.name,
      displayName: v.displayName,
      writePolicy: v.writePolicy,
      // ★ 一定要带上：后端「留空 = 第 2 档」，不是「保持原样」。这一行就是编辑第 3 档连接时
      //   不被静默降档的全部依靠——它来自 initialFormValues 里从 editing 回填的那个值。
      semanticDataTier: v.semanticDataTier,
      params: stripBlankSecrets(v.params ?? {}, activeKind),
    };
    if (editing) {
      updateMut.mutate(payload);
    } else {
      payload.kind = v.kind;
      createMut.mutate(payload);
    }
  };

  const confirmDelete = (row: ConnectorView) => {
    modal.confirm({
      title: `删除连接「${row.displayName || row.name}」？`,
      content: '将同时摘除所有 Agent 对它的授权、清空已缓存的结构信息，操作不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => delMut.mutateAsync(row.id),
    });
  };

  if (permLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin />
      </div>
    );
  }

  if (perm && !perm.superAdmin) {
    return (
      <Result
        status="403"
        title="仅企业超管可访问"
        subTitle="数据连接涉及客户生产系统的凭据，仅企业超级管理员可管理。"
        icon={<Empty description={false} />}
      />
    );
  }

  const rows = listQuery.data ?? [];
  // 从**最新一次**列表数据里取，而不是存下点开那一刻的行：轮询刷新后抽屉里的状态要跟着变。
  const semanticOf = rows.find((r) => r.id === semanticOfId) ?? null;

  // 当前选中那一档的文案。认不出来的值（后端比前端新）返回 undefined，下面有兜底分支。
  const tierMeta = semanticDataTierMeta(watchedTier);
  // 「什么东西会离开客户的库」这句话：当前档位没被改动时，优先用后端随详情带下来的那一份——
  // 它和 DDL 列注释同源，是正本；前端常量只是抄本，两份分叉时以正本为准。
  const tierEgress =
    watchedTier === editing?.semanticDataTier && editing?.semanticDataTierEgress
      ? editing.semanticDataTierEgress
      : tierMeta?.egress;

  const columns: ColumnsType<ConnectorView> = [
    {
      title: '名称',
      key: 'name',
      width: 170,
      render: (_: unknown, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{row.displayName || row.name}</div>
          <div style={{ fontSize: 12, color: '#999' }}>{row.name}</div>
        </div>
      ),
    },
    {
      title: '类型',
      key: 'kind',
      width: 170,
      // kindLabel 是连接器自己声明的 displayName，可能很长（「MySQL / 兼容 MySQL 协议的库（含
      // Doris、StarRocks）」）。不设宽度 + 不省略的话，这一列会把整张表撑变形，右边的
      // 「健康」「只读验证」被挤到标题竖排。这里截断 + tooltip 给全文——
      // 注意是通用处理，不按 kind 分支，否则就破了「新增类型前端零改动」。
      render: (_: unknown, row) => {
        const label = row.kindLabel || row.kind;
        return (
          <Tooltip title={label}>
            <Tag
              style={{
                maxWidth: 150,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {label}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '能力',
      key: 'capabilities',
      width: 170,
      render: (_: unknown, row) =>
        row.capabilities?.length ? (
          <Space size={4} wrap>
            {row.capabilities.map((c) => (
              <Tag key={c}>{CAP_LABEL[c] ?? c}</Tag>
            ))}
          </Space>
        ) : (
          <Tooltip title="尚未完成接入探测，点「测试连接」后回填">
            <span style={{ color: '#999' }}>未探测</span>
          </Tooltip>
        ),
    },
    {
      title: '健康',
      key: 'health',
      width: 100,
      render: (_: unknown, row) => healthBadge(row),
    },
    {
      // ★ 单列出来而不是塞进「健康」里：未验证只读的连接不该被当成安全的，要显眼。
      title: '只读验证',
      key: 'readonly',
      width: 100,
      render: (_: unknown, row) =>
        row.readonlyVerified ? (
          <Tag color="green">已验证</Tag>
        ) : (
          <Tooltip title="平台未能确认这个账号写不了数据。请在数据库侧改用只读账号后重新测试。">
            <Tag color="orange">未验证</Tag>
          </Tooltip>
        ),
    },
    {
      // ★ 单列出来的理由和「只读验证」同一条：接入时零人工，推导是背着人跑的，
      //   那就必须有一处能回答「它跑了没有、跑成了没有」——否则「零人工」在界面上
      //   等同于「什么都没发生」。点「语义层」按钮看具体生成了什么。
      title: '语义层',
      key: 'semantic',
      width: 110,
      render: (_: unknown, row) => semanticTag(row),
    },
    {
      // 与「只读验证」分开：那一列说的是**账号实际能不能写**（探测出来的事实），
      // 这一列说的是**平台放不放行**（配置）。两者可以不一致，而不一致恰恰是要看见的：
      // 一个能写的账号配成「只读」是安全的；反过来则是配置错误，写操作到了客户库才会失败。
      title: '写策略',
      key: 'writePolicy',
      width: 110,
      render: (_: unknown, row) =>
        row.writePolicy === 'FORBIDDEN' ? (
          <Tag>{row.writePolicyLabel || '只读'}</Tag>
        ) : (
          <Tag color={row.writePolicy === 'AUTO' ? 'red' : 'orange'}>
            {row.writePolicyLabel || row.writePolicy}
          </Tag>
        ),
    },
    {
      // ★ 和「写策略」并排：那一列说「能不能改客户的数据」，这一列说「能带走客户的什么数据」。
      //   两道闸互不替代——一条只读连接照样可能在第 3 档上把真实取值带出来，
      //   所以它必须在列表上有自己的一格，而不是藏在编辑弹窗里等人点进去才看得到。
      title: '出库档位',
      key: 'semanticDataTier',
      width: 150,
      render: (_: unknown, row) => {
        const meta = semanticDataTierMeta(row.semanticDataTier);
        // 后端给了中文短名就用它；没给退到原始枚举值；都没有也要有字——空白和「第 1 档」在人眼里
        // 是两回事，但空白会被当成「没这回事」，而它实际上代表一个正在生效的出库口径。
        const text = row.semanticDataTierLabel || row.semanticDataTier || '未知档位';
        // 这句话优先用后端带下来的那份（与 DDL 列注释同源），前端常量只是它的抄本。
        const tip =
          row.semanticDataTierEgress ||
          meta?.egress ||
          '这个后端版本没有返回出库档位说明。后端的默认档是第 2 档 · 派生统计。';
        return (
          <Tooltip title={tip}>
            {/* 只有第 3 档标红：真实取值出库是这一列里唯一需要被追问的选择。
                第 1 档的代价（表关系精确率约 0.49）说在 tooltip 和编辑表单里，
                它是客户的一个合法选择而不是故障——标红只会训练所有人忽略整列。
                认不出来的值走橙色：那说明前端该补一条映射了，不能装作正常。 */}
            <Tag
              color={row.semanticDataTier === 'SAMPLE_VALUES' ? 'red' : meta ? undefined : 'orange'}
            >
              {text}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (v: string) => (v === 'ACTIVE' ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    {
      title: '操作',
      key: 'action',
      width: 430,
      render: (_: unknown, row) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => setAuditOf(row)}>
            使用记录
          </Button>
          {/* 只有具备自描述能力的连接器才有结构可看，没有的话给个按钮只会点了报错。 */}
          {row.capabilities?.includes('DESCRIBE') && (
            <Button type="link" size="small" onClick={() => setSchemaOf(row)}>
              结构
            </Button>
          )}
          {/* 语义层入口**不按能力过滤**（和「结构」不同）：推不了语义层的连接恰恰最需要
              有个地方说明白「为什么这条没有、而且重跑也不会有」。按能力藏起来，
              那一格的「不适用」就成了死胡同。 */}
          <Button type="link" size="small" onClick={() => setSemanticOfId(row.id)}>
            语义层
          </Button>
          <Button
            type="link"
            size="small"
            loading={testMut.isPending && testMut.variables === row.id}
            onClick={() => testMut.mutate(row.id)}
          >
            测试连接
          </Button>
          <Button type="link" size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            loading={statusMut.isPending}
            onClick={() =>
              statusMut.mutate({
                id: row.id,
                status: row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
              })
            }
          >
            {row.status === 'ACTIVE' ? '停用' : '启用'}
          </Button>
          <Button type="link" size="small" danger onClick={() => confirmDelete(row)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: 0 }}>数据连接</h2>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!kinds.length}
          onClick={openCreate}
        >
          新建连接
        </Button>
      </div>

      <Table<ConnectorView>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        loading={listQuery.isLoading}
        pagination={false}
        // 列宽合计 1590（在 1440 上加了「出库档位」150）。更窄的屏走横向滚动
        // 而不是把每列压扁——压扁的后果实测过：标题会竖排，操作列的按钮被裁掉一半。
        scroll={{ x: 1610 }}
      />

      <Modal
        title={editing ? '编辑连接' : '新建连接'}
        open={open}
        width={640}
        onCancel={closeModal}
        destroyOnClose
        // 自定义 footer 只为把「测试连接」放进来：直接提交才知道对不对，
        // 改一版就得再提交一版——验证该能从提交里拆出来单独跑。
        footer={[
          <Button
            key="probe"
            style={{ float: 'left' }}
            loading={probeMut.isPending}
            onClick={async () => {
              try {
                // 先过一遍前端校验：必填没填就去连，只会拿到一个含糊的后端报错。
                const v = await form.validateFields();
                setProbeResult(null);
                probeMut.mutate({
                  name: v.name,
                  displayName: v.displayName,
                  kind: v.kind,
                  // ★ 写策略必须一起传：探测里的只读校验是**按策略判**的——
                  //   策略是只读时，一个能写的账号会被判为不合格；策略放开了写，同一个账号才算合格。
                  //   漏传这个字段，选了「写自动」的用户会看到一条「这个账号能写，不允许接入」的拒绝，
                  //   而那正是他要的配置。
                  writePolicy: v.writePolicy,
                  // 试连不落库，档位不参与探测；照样原样带上，是为了让「试连发出去的那份载荷」
                  // 和「保存发出去的那份」保持同一个形状——两者分叉过一次，就再也没人敢信试连结果。
                  semanticDataTier: v.semanticDataTier,
                  params: stripBlankSecrets(v.params ?? {}, activeKind),
                });
              } catch {
                // validateFields 自己会把错误标在字段上，这里不用再提示一遍。
              }
            }}
          >
            测试连接
          </Button>,
          <Button key="cancel" onClick={closeModal}>
            取消
          </Button>,
          <Button
            key="ok"
            type="primary"
            loading={createMut.isPending || updateMut.isPending}
            onClick={() => form.submit()}
          >
            {editing ? '保存' : '创建并验证'}
          </Button>,
        ]}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          preserve={false}
          initialValues={initialFormValues}
        >
          <Form.Item
            label="类型"
            name="kind"
            rules={[{ required: true, message: '请选择类型' }]}
            // 类型决定 config_json 的形状，改类型等于把一套参数交给另一个实现去解释，后端也会拒绝。
            extra={editing ? '类型不可修改。需要更换请删除后重新创建' : undefined}
          >
            <Select
              disabled={!!editing}
              options={kinds.map((k) => ({ label: k.displayName, value: k.kind }))}
              onChange={(v: string) => {
                setSelectedKind(v);
                // 换了类型，上一次的试连结果就不是在说这套参数了，留着会误导。
                setProbeResult(null);
                // 换类型时旧类型的参数全部作废——留着会被后端的「未知参数」校验拒掉。
                form.setFieldsValue({ params: defaultsOf(kinds.find((k) => k.kind === v)) });
              }}
            />
          </Form.Item>

          <Form.Item
            label="名称"
            name="name"
            rules={[
              { required: true, message: '请填写名称' },
              {
                pattern: /^[A-Za-z0-9_-]{1,64}$/,
                message: '只能是字母、数字、下划线、短横线，最长 64 位',
              },
            ]}
            extra="模型调用工具时用它寻址，创建后不建议修改"
          >
            <Input disabled={!!editing} placeholder="crm-mysql" />
          </Form.Item>

          <Form.Item label="显示名" name="displayName">
            <Input placeholder="CRM 生产库（只读）" />
          </Form.Item>

          {activeKind && <SchemaForm fields={activeKind.fields} editing={!!editing} />}

          <Form.Item
            label="写策略"
            name="writePolicy"
            rules={[{ required: true, message: '请选择写策略' }]}
            extra="这是平台侧的闸。数据库账号本身的权限是另一回事——两者都要配，下面的「生成授权命令」会按这里选的档生成。"
          >
            <Select options={WRITE_POLICY_OPTIONS} />
          </Form.Item>

          {/* ★ 放开写之后，「只读验证」这道防线就不再成立，必须当场说清楚它换成了什么。
              不写这段的话，用户只会看到一个选项变了，不会意识到防护模型整个换了一套。 */}
          {watchedPolicy && watchedPolicy !== 'FORBIDDEN' && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="这条连接将允许修改客户数据"
              description={
                <>
                  只读校验不再是接入门槛（能写的账号也能通过）。此后拦得住误操作的只剩：
                  单条 DML、<b>UPDATE / DELETE 必须带 WHERE</b>、影响行数超上限整条回滚、
                  以及禁用 DDL / TRUNCATE / REPLACE。
                  {watchedPolicy === 'AUTO'
                    ? ' 选「写自动」意味着模型不经任何人确认即可改数据，请只对确实需要的连接使用。'
                    : ' 选「写需审批」时，模型只能提交，实际执行发生在超管点「批准」之后。'}
                </>
              }
            />
          )}

          <Form.Item
            label="数据出库档位"
            name="semanticDataTier"
            rules={[{ required: true, message: '请选择数据出库档位' }]}
            extra="为了看懂客户那个库，我们允许多少东西离开它。两个方向都有代价：往严里选，表关系只能靠名字猜；往松里选，离开客户库的东西更具体。"
          >
            <Select options={tierOptions} />
          </Form.Item>

          {/* ★ 这条横幅**常驻**，三档都显示，而且不是 tooltip。
              一次有安全后果的选择，界面就是做选择的人了解自己在选什么的地方——
              要人把鼠标悬上去才肯说的后果，等于没说。
              三档都显示，是因为只讲第 3 档的风险会把所有人推到第 1 档，
              然后这套东西在没人知道的情况下静默变差（精确率约 0.49，而推错的表关系不报错）。 */}
          {watchedTier && (
            <Alert
              type={tierMeta?.alert ?? 'warning'}
              showIcon
              style={{ marginBottom: 16 }}
              message={tierMeta?.title ?? `本页还不认识这个档位（${watchedTier}）`}
              description={
                tierMeta ? (
                  <>
                    {tierEgress}
                    {tierMeta.extra && <div style={{ marginTop: 4 }}>{tierMeta.extra}</div>}
                  </>
                ) : (
                  // 认不出来也要原样提交回去（那是用户没打算改的东西），但必须说清楚本页解释不了它。
                  '保存时它会被原样提交回去，档位不变；但本页说不出这一档具体什么东西会出库，请先升级前端再改这条连接。'
                )
              }
            />
          )}

          {/* 折叠面板，默认收起：绝大多数情况下客户已经有账号了，这块不该占版面。
              放在参数之后，是因为它要用到上面填的库名。 */}
          {activeKind && (
            <GrantScriptPanel
              kind={activeKind.kind}
              database={watchedDatabase}
              writePolicy={watchedPolicy ?? 'FORBIDDEN'}
            />
          )}

          {probeResult && <ProbeResultAlert result={probeResult} />}
        </Form>
      </Modal>

      <ConnectorAuditDrawer connector={auditOf} onClose={() => setAuditOf(null)} />
      <ConnectorSchemaDrawer connector={schemaOf} onClose={() => setSchemaOf(null)} />
      <ConnectorSemanticDrawer connector={semanticOf} onClose={() => setSemanticOfId(null)} />
    </div>
  );
}

/**
 * 试连结果。
 *
 * 成功时把【探到的能力】也列出来——它决定这条连接接进来之后 Agent 到底能干什么，
 * 在保存前就该让人看见（比如账号读不了 information_schema 时「能自描述」会缺席）。
 *
 * 失败时把只读判定的三态区分开：「确认可写」要换账号，「判不出来」要去查账号权限，
 * 两者都不予保存但动作不同，压成一句话等于替使用者做了判断。
 */
function ProbeResultAlert({ result }: { result: ProbeOutcome }) {
  if (result.ok) {
    return (
      <Alert
        type="success"
        showIcon
        message="连接正常，只读已验证"
        description={
          <>
            探测到的能力：
            <Space size={4} wrap style={{ marginLeft: 4 }}>
              {result.capabilities.map((c) => (
                <Tag key={c}>{CAP_LABEL[c] ?? c}</Tag>
              ))}
            </Space>
            {result.readonlyDetail && (
              <div style={{ marginTop: 4, color: '#999' }}>只读依据：{result.readonlyDetail}</div>
            )}
          </>
        }
      />
    );
  }
  return (
    <Alert
      type="error"
      showIcon
      message={result.readonlyUndetermined ? '无法确认这个账号是只读的' : '连接测试未通过'}
      description={result.failureReason}
    />
  );
}

const CAP_LABEL: Record<string, string> = {
  QUERY: '能查',
  DESCRIBE: '能自描述',
  INVOKE: '能调用',
  SYNC: '能同步',
  SUBSCRIBE: '能订阅',
  HEALTH: '能报状态',
};

/** 用 schema 里的 default 预填表单。后端也会补默认值，这里只是让用户看得见。 */
function defaultsOf(kind?: ConnectorKind): ParamValues {
  const out: ParamValues = {};
  if (!kind) return out;
  for (const f of kind.fields) {
    if (f.default === undefined) continue;
    if (f.type === 'int') out[f.name] = Number(f.default);
    else if (f.type === 'bool') out[f.name] = f.default === 'true';
    else out[f.name] = f.default;
  }
  return out;
}

/**
 * 敏感字段留空时不要把空串发上去——空串会被后端当成「显式清空」而不是「沿用原值」。
 * 这条语义与旧的连接页一致（那边是在 onFinish 里判 `if (v.credential)`）。
 */
function stripBlankSecrets(params: ParamValues, kind?: ConnectorKind): ParamValues {
  if (!kind) return params;
  const out: ParamValues = { ...params };
  for (const f of kind.fields) {
    if (!f.secret) continue;
    const v = out[f.name];
    if (v === undefined || v === null || v === '') delete out[f.name];
  }
  return out;
}

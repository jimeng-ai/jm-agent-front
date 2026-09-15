import { useEffect, useRef, useState } from 'react';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Collapse, Drawer, Empty, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import { connectorApi } from '@/features/connector/api';
import {
  guardNoteOf,
  refreshImpactWording,
  refreshSemanticImpact,
  removedTableImpact,
  truncationNoteOf,
  unlistedRemovedHits,
} from '@/features/connector/semantic';
import type { RefreshSemanticImpact, RemovedTableImpact } from '@/features/connector/semantic';
import type {
  ConnectorSchemaObject,
  ConnectorView,
  SchemaObjectDiff,
  SchemaSnapshotResult,
} from '@/features/connector/types';

/**
 * 连接器的结构快照与**漂移检测**。
 *
 * ★ 这个抽屉的价值不在「看表结构」（`conn_describe` 随时能看实时的），而在
 * **「客户悄悄改了什么」**：语义层（指标口径、业务名、样例问答）都挂在具体的表和列上，
 * 客户加一个字段、改一个类型、删一张表，挂在上面的口径就跟着失效——
 * 而这件事今天没有任何别的机制会发现。
 *
 * 展示决策：
 * 1. **刷新结果里的 diffs 用醒目的 Alert 呈现**，而不是混在表格里。看结构是日常，
 *    发现漂移是事件，两者不该长得一样。
 * 2. **首次快照不报警**。第一次刷新时「全是新增」没有信息量，把它渲染成一片红色
 *    只会让人下次直接忽略这个提示。
 * 3. **语义影响分三态，三态长得不一样**：有说明失效（红）/ 核对过、确实没有（安静）/
 *    漂移处置没跑成（橙）。第三态最容易被画成第二态——后端用 null 特意保留了它，
 *    画成「没有影响」就等于替后端把一次失败说成了平安无事。
 * 4. **只有「口径随表失效」上顶部红条。** 注入侧对「结构已变」按 scope 分两种处理：业务口径**整条停止提供**，
 *    模型照自己的理解去算、照样出一个正常数字；表用途、字段含义、表关系则**仍会提供**，只多一个「结构已变」的标记。
 *    前者是唯一「悄悄不再生效」的一类，所以只有它上红条；后者在差异列表里标出来就够了。文案里两者绝不能说成一回事。
 *    一次零影响的例行刷新保持安静。
 * 5. **刷新被拒（guardNote）先判、单独画、然后收手。** 那次返回不是一份快照，
 *    落到下面任何一种常规结果里都是在说假话（「没核对成」或「结构没有变化」）。
 * 6. **截断说明紧挨着差异列表。** 快照之外的表两头都判断不了，列表里没有它们不代表它们还在。
 * 7. **结果按「发起刷新的那条连接」归属，不按「返回时抽屉开着谁」。** 刷新要几十秒，
 *    这期间人完全可能关掉抽屉去开另一条——A 的差异和「口径失效」画进 B 的抽屉，是最坏的那种错。
 * 8. **「刷新中」按连接记，不按最近一次点击记。** mutation 自己的状态只跟最新那一次：开 A 点刷新、切到 B 再点、
 *    回到 A，A 的按钮就亮着而 A 的刷新还在跑，再点一下就是同一条连接上第二次刷新，多占一个每实例许可，
 *    Agent 的查询等不到许可就 RATE_LIMITED。所以从 MutationCache 里按连接 id 查所有还在路上的刷新。
 * 9. **影响的措辞只有一个出处（semantic.ts `refreshImpactWording`）。** 差异标题、toast、「结构没变」横幅
 *    和口径红条、各表标记读同一份按表明细——按表的数是「本次新归到这张表上的」，只看总数的标题会在
 *    同一屏上一边说「没有说明受影响」、一边说「口径已停用」。
 */

interface Props {
  connector: ConnectorView | null;
  onClose: () => void;
}

/** 刷新是发给哪条连接的。★ 作为 mutation 的入参传进去，回调里只认它，不去读抽屉「现在」开着谁。 */
interface RefreshTarget {
  id: string;
  /** 结果没法画在抽屉里时（已切走），提示里得说清是哪条连接的。 */
  label: string;
}

/** 刷新结果连同它属于哪条连接一起存：只在抽屉开着的正是那条连接时才画。 */
interface LastRefresh {
  connectorId: string;
  result: SchemaSnapshotResult;
}

/** 结构刷新的 mutationKey。按它从 MutationCache 里找「哪几条连接的刷新还在路上」，见文件头第 8 条。 */
const REFRESH_MUTATION_KEY = ['connector', 'schema', 'refresh'];

/** 一次刷新 mutation 是发给哪条连接的。入参缺失（不该发生）时返回 null，不匹配任何连接。 */
function refreshTargetIdOf(m: { state: { variables: unknown } }): string | null {
  const v = m.state.variables as RefreshTarget | undefined;
  return v?.id ?? null;
}

/** 差异不超过这个数就全部展开。再多就只展开「删除」，否则会把下面的结构表推得看不见。 */
const EXPAND_ALL_THRESHOLD = 8;

const CHANGE_META: Record<SchemaObjectDiff['change'], { color: string; label: string }> = {
  ADDED: { color: 'green', label: '新增' },
  // 表被删比加字段严重得多：挂在它上面的口径和样例会直接失效。
  REMOVED: { color: 'red', label: '删除' },
  CHANGED: { color: 'orange', label: '变更' },
};

function changeMeta(change: string): { color: string; label: string } {
  const hit: { color: string; label: string } | undefined =
    CHANGE_META[change as SchemaObjectDiff['change']];
  return hit ?? { color: 'default', label: change || '未知' };
}

/**
 * 刷新提示（toast）的尾巴。有语义影响或没核对成时，整条提示要从 success 降成 warning。
 * 措辞与抽屉里的标题同出一处（refreshImpactWording），toast 和抽屉不许说两套话。
 */
function toastTail(impact: RefreshSemanticImpact): { tail: string; alarm: boolean } {
  if (impact.failed) return { tail: '；但语义层这次没能跟着核对', alarm: true };
  const { clauses } = refreshImpactWording(impact);
  return clauses.length > 0 ? { tail: `；${clauses.join('，')}`, alarm: true } : { tail: '', alarm: false };
}

/** 一次刷新结果的一句话总结（toast 用）。 */
function refreshSummary(r: SchemaSnapshotResult): { text: string; level: 'success' | 'warning' } {
  if (guardNoteOf(r)) {
    return { text: '刷新被拒绝——客户库这次返回了 0 个对象，这份结果没有保存', level: 'warning' };
  }
  const { tail, alarm } = toastTail(refreshSemanticImpact(r));
  const diffCount = r.firstSnapshot ? 0 : (r.diffs ?? []).length;
  if (diffCount > 0) {
    // 用 warning 而不是 success：结构变了是需要人去看一眼的事件。
    return { text: `检测到 ${diffCount} 处结构变化${tail}`, level: 'warning' };
  }
  const text = r.firstSnapshot
    ? `已建立首次快照，共 ${r.objectCount} 个对象${tail}`
    : // 截断时只能说「覆盖到的没变」：快照之外的表变没变，这次根本看不到。
      `${r.truncated === true ? '快照覆盖到的对象结构没有变化' : '结构没有变化'}${tail}`;
  return { text, level: alarm ? 'warning' : 'success' };
}

function revivedLine(revived: number | null): string | null {
  return revived !== null && revived > 0
    ? `另有 ${revived} 条之前标成「结构已变」的说明重新对上了当前结构，已自动恢复。`
    : null;
}

/** 失效口径的词条。★ 它们是「会悄悄不再生效」的那几条，名字要一眼读得出来。 */
function TermTags({ terms }: { terms: string[] }) {
  return (
    <Space size={[4, 4]} wrap>
      {terms.map((t) => (
        <Tag key={t} color="red" style={{ marginInlineEnd: 0 }}>
          {t}
        </Tag>
      ))}
    </Space>
  );
}

/**
 * 截断说明，紧挨着差异列表放。
 *
 * ★ 快照之外的表**两头都判断不了**：后端不再把「只是没排进快照」的表报成删除，
 * 所以列表里没有它们，既不代表它们还在，也不代表它们没变。说明文字用后端原话（它知道按什么排的序）。
 */
function TruncationNote({ note }: { note: string }) {
  const sentence = /[。.；;！!]$/.test(note) ? note : `${note}。`;
  return (
    <Typography.Text type="warning" style={{ display: 'block', margin: '4px 0' }}>
      {sentence}
      快照之外的表这次两头都判断不了：是删了还是还在、结构变没变都看不到，所以它们不会出现在差异列表里——列表里没有，不代表没变。
    </Typography.Text>
  );
}

/** 删除项标题行上的影响标记：红（有失效）/ 灰字（没有）/ 橙（不知道）。 */
function RemovedImpactTag({ impact }: { impact: RemovedTableImpact }) {
  if (impact.kind === 'NONE') {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        无说明受影响
      </Typography.Text>
    );
  }
  if (impact.kind === 'UNKNOWN') {
    return <Tag color="orange">{impact.reason === 'FAILED' ? '影响未核对' : '影响条数不明'}</Tag>;
  }
  const { rows, metrics, metricTerms } = impact.hit;
  const metricN = Math.max(metrics ?? 0, metricTerms.length);
  // 两个数分开写、不说「其中」「含」：staledRows 算不算上口径由后端定，文案不押这个宝，
  // 押错了就是把 5 条说成 3 条。两个标签的措辞也不同：说明是「带标记继续用」，口径是「停用」。
  return (
    <>
      {rows !== null && rows > 0 && <Tag color="red">{rows} 条说明结构已变</Tag>}
      {metricN > 0 && <Tag color="red">口径 {metricN} 条已停用</Tag>}
    </>
  );
}

/** 删除项展开后的那句话。 */
function RemovedImpactBody({
  impact,
  staled,
}: {
  impact: RemovedTableImpact;
  staled: number | null;
}) {
  if (impact.kind === 'NONE') {
    return <Typography.Text type="secondary">表已消失。本次没有说明因此失效。</Typography.Text>;
  }
  if (impact.kind === 'UNKNOWN') {
    return (
      <Typography.Text type="warning">
        {impact.reason === 'FAILED'
          ? '表已消失。语义层这次没能核对，挂在它上面的说明有没有失效不知道——它们可能仍被当成有效的提供给模型。'
          : staled !== null && staled > 0
            ? `表已消失。本次共有 ${staled} 条说明被标成「结构已变」，但分不清其中几条挂在这张表上。`
            : '表已消失。挂在它上面的说明失效了几条，没能从返回里读出来。'}
      </Typography.Text>
    );
  }
  const { rows, metrics, metricTerms } = impact.hit;
  const metricN = Math.max(metrics ?? 0, metricTerms.length);
  const hasRows = rows !== null && rows > 0;
  // ★ 两类说明的去向不同，必须分开说（见文件头第 4 条）：
  //   表用途 / 字段含义 / 表关系 → 仍提供给模型，带「结构已变」标记；业务口径 → 整条停止提供。
  return (
    <div>
      <Typography.Text type="danger">
        {hasRows
          ? `表已消失，挂在它上面的 ${rows} 条说明已标成「结构已变」`
          : '表已消失，引用它的说明已标成「结构已变」'}
      </Typography.Text>
      {hasRows
        ? '——这类说明（表用途、字段含义、表关系等）仍会提供给模型，只是带着「结构已变」的标记。'
        : '。'}
      {metricN > 0 && (
        <div style={{ marginTop: 4 }}>
          涉及 {metricN} 条业务口径
          {metricTerms.length > 0 && (
            <>
              ：<TermTags terms={metricTerms} />
            </>
          )}
          ——这些口径<b>整条不再提供给模型</b>。
        </div>
      )}
    </div>
  );
}

export default function ConnectorSchemaDrawer({ connector, onClose }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  // 留整个刷新结果，不只留 diffs：语义影响也在上面。只留 diffs 就只能说「表没了」，
  // 说不出「挂在它上面的口径跟着没了」——而后者才是这个抽屉存在的理由。
  const [lastRefresh, setLastRefresh] = useState<LastRefresh | null>(null);

  // 抽屉此刻开着哪条连接。给 mutation 回调读：回调在请求返回时才跑，那时抽屉可能已经关掉或换了人。
  // ★ 用 ref，不读回调闭包里的 connector：闭包里是哪一次渲染的值，取决于 react-query 什么时候替换回调——
  //   从前正是读了闭包里的 connector?.id，才把 A 的结果画进了 B 的抽屉。
  const connectorId = connector?.id ?? null;
  const shownIdRef = useRef<string | null>(connectorId);
  useEffect(() => {
    shownIdRef.current = connectorId;
  }, [connectorId]);
  // 整页被卸掉（离开连接器页）时清掉：还在路上的刷新回来会读到卸载前最后开着的那条，以为结果画出来了，
  // toast 里就不会说「这次的明细没有显示」——而那份明细确实没人看到。
  useEffect(
    () => () => {
      shownIdRef.current = null;
    },
    [],
  );

  const query = useQuery({
    queryKey: ['connector', 'schema', connector?.id],
    queryFn: () => connectorApi.schema(connector!.id),
    enabled: !!connector,
  });

  const refreshMut = useMutation({
    mutationKey: REFRESH_MUTATION_KEY,
    mutationFn: (target: RefreshTarget) => connectorApi.refreshSchema(target.id),
    onSuccess: (r, target) => {
      // 失效的是【发起刷新的那条】连接的缓存，不是抽屉现在开着的那条。
      qc.invalidateQueries({ queryKey: ['connector', 'schema', target.id] });
      // 语义行的状态刚被重挂过（标 STALE / 恢复）。这里说了「N 条说明失效」，
      // 人转头去语义层抽屉看到的却是缓存里的旧状态，两处就对不上了。
      qc.invalidateQueries({ queryKey: ['connector', 'semantic', target.id] });

      const summary = refreshSummary(r);
      if (shownIdRef.current !== target.id) {
        // ★ 抽屉已经关掉或换成了别的连接：这份结果不画，绝不能落进别的连接的抽屉里。
        //   但也不一声不吭——「N 条口径已停止提供给模型」只在这一次返回里有，吞掉了就没人知道。
        //   报一句带连接名的总结，明细不画。
        message.open({
          type: summary.level === 'success' ? 'info' : 'warning',
          content: `「${target.label}」：${summary.text}（抽屉已经关掉或换了连接，这次的明细没有显示）`,
          duration: 6,
        });
        return;
      }
      setLastRefresh({ connectorId: target.id, result: r });
      message.open({ type: summary.level, content: summary.text });
      const truncation = guardNoteOf(r) ? null : truncationNoteOf(r);
      if (truncation) {
        message.warning(truncation);
      }
    },
    onError: (e: Error, target) => {
      message.error(
        shownIdRef.current === target.id ? e.message : `「${target.label}」刷新结构失败：${e.message}`,
      );
    },
  });

  // 哪几条连接的刷新还在路上。★ 读 MutationCache 里所有未结束的刷新，不读 refreshMut.isPending / variables：
  //   后者只跟最近一次 mutate，先点的那条连接还没回来，它的按钮就已经亮了（文件头第 8 条）。
  const pendingRefreshIds = useMutationState({
    filters: { mutationKey: REFRESH_MUTATION_KEY, status: 'pending' },
    select: refreshTargetIdOf,
  });
  const refreshing = connectorId !== null && pendingRefreshIds.includes(connectorId);

  const objects = query.data ?? [];
  const syncedAt = objects[0]?.syncedAt;

  // 双保险：回调里已经按连接丢弃过一次；渲染时再核一次归属，任何一条漏网的路径都画不进别的连接。
  const last = lastRefresh && lastRefresh.connectorId === connector?.id ? lastRefresh.result : null;
  const guardNote = last ? guardNoteOf(last) : null;
  // 被拒的那次不是一份快照：下面这些派生量一律不算（见 types.ts guardNote 的注释）。
  const settled = last && !guardNote ? last : null;
  const impact = settled ? refreshSemanticImpact(settled) : null;
  const lastDiffs = settled ? (settled.firstSnapshot ? [] : (settled.diffs ?? [])) : null;
  const staled = impact?.staled ?? null;
  const revived = revivedLine(impact?.revived ?? null);
  const truncation = settled ? truncationNoteOf(settled) : null;
  const unlisted = impact && lastDiffs ? unlistedRemovedHits(impact, lastDiffs) : [];
  const wording = impact ? refreshImpactWording(impact) : null;

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
        setLastRefresh(null);
        onClose();
      }}
      width={900}
      destroyOnClose
      extra={
        <Button
          icon={<ReloadOutlined />}
          // 这条连接自己有刷新在路上就转圈并禁用；别的连接那次还没回来，不影响这里。
          loading={refreshing}
          disabled={refreshing}
          onClick={() => {
            if (!connector) return;
            const id = connector.id;
            // ★ 点下去这一刻再从缓存核一次：禁用要等下一次渲染才生效，连点两下的第二下会赶在它前面。
            if (
              qc.isMutating({
                mutationKey: REFRESH_MUTATION_KEY,
                predicate: (m) => refreshTargetIdOf(m) === id,
              }) > 0
            ) {
              return;
            }
            refreshMut.mutate({ id, label: connector.displayName || connector.name });
          }}
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

      {/* ⓪ 刷新被拒。★ 必须先判、单独画：那次返回不是一份快照，落进下面任何一条都是假话——
          ①会说「没核对成」，③会说「结构没有变化」。 */}
      {guardNote && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="刷新被拒绝：客户库这次突然返回了 0 个对象"
          description={
            <>
              {guardNote}
              <br />
              一次返回 0 个对象，更可能是「这次没看到」，而不是「整个库的表都删光了」，所以平台<b>没有保存</b>这份结果：
              上一份快照原样保留，挂在上面的说明也不会因为这次的空结果被标成「结构已变」。
              <br />
              常见原因：只读账号的权限被收回或收窄了、连接参数指向的库不对了、客户库这时本身有问题。
              先让客户那边确认，再刷新一次。
            </>
          }
        />
      )}

      {/* ① 漂移处置没跑成。★ 不能画成下面那条绿色的「结构没有变化」：快照是存下来了，
          但说明没有对照新结构核对过，可能已经和现实对不上、却没被标出来。 */}
      {impact?.failed && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="结构快照已保存，但语义层这次没能跟着核对"
          description={
            <>
              挂在表和列上的说明<b>没有</b>对照这次拉回来的结构重新核对。
              {lastDiffs && lastDiffs.length > 0
                ? '下面列出的删除和变更，挂在上面的说明可能仍被当成有效的提供给模型，也没有被标成「结构已变」。'
                : '结构本身没有变，通常影响不大；但之前若也没核对成，积压的过期说明这次同样没被标出来。'}
              <br />
              {/* ★ 承诺只说到后端真做到的那一步，三句各对一件事：
                  1. 差异列表补不回来：快照这次已经存下，下次 diff 比的是这一份，这次的「删除」不会再出现在差异列表里；
                  2. 处置补得回来：这次没处置成的删除后端记下了，【下一次刷新】——手动或定时，谁先跑谁处置——重新应用，
                     标「结构已变」，并在【那一次】的返回里按表列出影响；
                  3. 定时刷新的返回没有任何界面显示。先跑的若是它，按表的列表就不会出现在这个抽屉里——
                     不说这一句，人会一直在自己下一次手动刷新的结果里等那几张表，而它们已经被定时刷新处置掉了。 */}
              {/* 有没有「删除」分两种说：只有新增 / 变更时没有要补处置的表，说「会把这次消失的表重新处置」就是编出来的。 */}
              {lastDiffs && lastDiffs.some((d) => d.change === 'REMOVED')
                ? '这次的删除和变更已经随快照存下，之后不会再出现在差异列表里，但处置不会丢：下一次刷新——你再点「刷新结构」，或平台的定时刷新，哪个先跑算哪个——会把这次消失的表重新处置一遍，挂在上面的说明在那次被标成「结构已变」，消失的表带走了哪些说明和业务口径，在那一次刷新的结果里按表列出。'
                : lastDiffs && lastDiffs.length > 0
                  ? '这次的变更已经随快照存下，之后不会再出现在差异列表里；下一次刷新——你再点「刷新结构」，或平台的定时刷新，哪个先跑算哪个——会对照最新结构重新核对，挂在变了的表和列上的说明在那次被标成「结构已变」。之前没核对成时消失的表（如果有），也会在那一次刷新的结果里按表列出。'
                  : '下一次刷新——你再点「刷新结构」，或平台的定时刷新，哪个先跑算哪个——会重新核对，积压的过期说明在那次被标成「结构已变」；之前没核对成时消失的表（如果有），也会在那一次刷新的结果里按表列出。'}
              <br />
              先跑的若是定时刷新，那份结果不会显示在这里：到「语义层」里看标成「结构已变」的行，失效的业务口径在展开详情里写着是因哪几张表消失而失效的。
              反复失败请联系平台排查。
            </>
          }
        />
      )}

      {/* ② 口径随表失效——本抽屉最响的一条。 */}
      {impact && impact.lostMetricCount > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={`${impact.lostMetricCount} 条业务口径引用的表已不在，已停止提供给模型`}
          description={
            <>
              {impact.lostTerms.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <TermTags terms={impact.lostTerms} />
                </div>
              )}
              它们已被标成「结构已变」，<b>整条不再提供给模型</b>
              ——模型再遇到这些词会按自己的理解去算，不报错，数字看起来照样正常。
              <br />
              只有业务口径是这样：表用途、字段含义、表关系这类说明被标成「结构已变」之后仍会提供给模型，只是带着「结构已变」的标记。
              <br />
              表如果是改名或迁移了，需要业务方在对话里把这些口径重新答一次；表恢复之后再刷新一次，状态会自动撤销。
            </>
          }
        />
      )}

      {/* ②' 按表明细里有、差异列表里没有的表（多见于上一次没核对成之后的这次重试）。
          不单独列出来，它们就只剩一个总数，说不出是哪张表带走的。 */}
      {impact && !impact.failed && unlisted.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`${unlisted.length} 张表不在本次的差异列表里，但核对时发现它们已不在结构中`}
          description={
            <>
              这次拉回来的结构里没有它们，挂在上面的说明现在是「结构已变」。它们多半是之前某次刷新里就已消失、而那次语义层没能跟着核对的表——删除当时随快照存下了，处置补在了这一次：
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {unlisted.map((h) => (
                  <li key={h.objectName}>
                    <Space size={4} wrap>
                      <Typography.Text code>{h.objectName}</Typography.Text>
                      <RemovedImpactTag impact={{ kind: 'HIT', hit: h }} />
                    </Space>
                  </li>
                ))}
              </ul>
            </>
          }
        />
      )}

      {/* ③ 结构没变（或首次快照）。零影响时保持安静——一次例行刷新不该长得像一次事件。
          截断时降成 info 并把截断说明摆出来：「覆盖到的没变」不等于「真的没变」。 */}
      {settled &&
        impact &&
        !impact.failed &&
        lastDiffs &&
        lastDiffs.length === 0 &&
        wording &&
        // 安静与否看 wording.quiet，不看总数：按表明细里有表带走了说明（②' 那条正在列它们）时，这里不许画成绿色的平安无事。
        (!wording.quiet ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={`${
              settled.firstSnapshot
                ? '已建立首次快照'
                : truncation
                  ? '快照覆盖到的对象结构与上次一致'
                  : '结构与上次一致'
            }，但${wording.clauses.join('，')}`}
            description={
              <>
                到「语义层」里看标成「结构已变」的行。
                {revived && (
                  <>
                    <br />
                    {revived}
                  </>
                )}
                {truncation && <TruncationNote note={truncation} />}
              </>
            }
          />
        ) : (
          <Alert
            type={truncation ? 'info' : 'success'}
            showIcon
            style={{ marginBottom: 12 }}
            message={
              settled.firstSnapshot
                ? '已建立首次快照，之后每次刷新都会和它比对'
                : truncation
                  ? '快照覆盖到的对象与上次一致，没有发现变化'
                  : '与上次快照一致，结构没有变化'
            }
            description={
              revived || truncation ? (
                <>
                  {revived}
                  {truncation && <TruncationNote note={truncation} />}
                </>
              ) : undefined
            }
          />
        ))}

      {/* ④ 结构变了。 */}
      {impact && lastDiffs && lastDiffs.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`检测到 ${lastDiffs.length} 处结构变化${
            // 没核对成的事上面那条已经说了，这里再说「没有说明受影响」就是在撒谎。
            // 其余从 refreshImpactWording 取：它和口径红条、各表标记读同一份按表明细，
            // 不会一边说「没有说明受影响」、一边在下面说口径停用了。
            impact.failed || !wording
              ? ''
              : wording.quiet
                ? '，没有说明受影响'
                : `，${wording.clauses.join('，')}`
          }`}
          description={
            <>
              {revived && (
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                  {revived}
                </Typography.Text>
              )}
              {truncation && <TruncationNote note={truncation} />}
              <Collapse
                ghost
                size="small"
                items={lastDiffs.map((d, i) => {
                  const meta = changeMeta(d.change);
                  const removed =
                    d.change === 'REMOVED' ? removedTableImpact(impact, d.objectName) : null;
                  return {
                    key: String(i),
                    label: (
                      <Space size={4} wrap>
                        <Tag color={meta.color}>{meta.label}</Tag>
                        <Typography.Text code>{d.objectName}</Typography.Text>
                        {removed && <RemovedImpactTag impact={removed} />}
                      </Space>
                    ),
                    children: (
                      <>
                        {removed && <RemovedImpactBody impact={removed} staled={staled} />}
                        {d.details?.length ? (
                          <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {d.details.map((x) => (
                              <li key={x}>{x}</li>
                            ))}
                          </ul>
                        ) : removed ? null : (
                          <Typography.Text type="secondary">
                            （对象级变化，无列级明细）
                          </Typography.Text>
                        )}
                      </>
                    ),
                  };
                })}
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
            </>
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

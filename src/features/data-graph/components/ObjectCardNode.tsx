import { memo, type CSSProperties, type FocusEvent, type KeyboardEvent } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ObjectFlowNode } from '../flow';

// 对象卡片：业务名、一句说明（最多两行）、领域色条（设计文档 §8.2）。不列字段、不显示表名，所有卡片一样大。
// 左右各一个不可见的连接点：线从引用方的右边出发，落到被引用方的左边。
function ObjectCardNode({ data }: NodeProps<ObjectFlowNode>) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      data.onSelect(data.name);
    }
  };
  // 键盘聚焦到视野外的卡片时让画布平移过去（v2 审查 #6）。浏览器把焦点元素滚进视野时会去滚 React Flow 那个
  // overflow:hidden 的容器，和 React Flow 自己的平移打架（之后拖动、缩放都错位）；先把滚动复位，再按平移后的位置判断。
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const card = event.currentTarget;
    const pane = card.closest<HTMLElement>('.react-flow');
    if (pane) {
      pane.scrollTop = 0;
      pane.scrollLeft = 0;
    }
    // 只跟随键盘带来的焦点：鼠标按下的那一刻卡片也会拿到焦点，这时把画布挪走，松开时鼠标已经不在这张卡片上，
    // 这一下点击就落空了（React Flow 自己的节点 onFocus 也是先看 :focus-visible）。
    if (!card.matches(':focus-visible')) {
      return;
    }
    const frame = (card.closest('.dg-canvas') ?? pane)?.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    const visible =
      !frame ||
      (box.left >= frame.left && box.right <= frame.right && box.top >= frame.top && box.bottom <= frame.bottom);
    data.onFocusCard(data.name, visible);
  };
  const className = ['dg-card', data.selected ? 'is-selected' : '', data.dimmed ? 'is-dimmed' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={className}
      role="button"
      tabIndex={0}
      aria-pressed={data.selected}
      aria-label={data.title}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      data-testid="dg-card"
      data-table={data.name}
      style={{ '--dg-domain': data.domainColor } as CSSProperties}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="dg-card__handle" />
      <span className="dg-card__domain" title={data.domain} aria-hidden />
      <div className="dg-card__body">
        <div className="dg-card__title-row">
          <span className="dg-card__title" title={data.title}>
            {data.title}
          </span>
          {data.hasSelfReference ? <span className="dg-badge">内部关联</span> : null}
        </div>
        {data.summary ? (
          <p className="dg-card__summary" title={data.summary}>
            {data.summary}
          </p>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} className="dg-card__handle" />
    </div>
  );
}

export default memo(ObjectCardNode);

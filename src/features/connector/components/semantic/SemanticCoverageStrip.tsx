import { CheckCircleOutlined, QuestionCircleOutlined, WarningOutlined } from '@ant-design/icons';
import {
  SEMANTIC_PARTIAL_CONSEQUENCE,
  semanticCoverageDisplayOf,
} from '@/features/connector/semantic';
import type { ConnectorView } from '@/features/connector/types';

export default function SemanticCoverageStrip({ connector }: { connector: ConnectorView }) {
  const coverage = semanticCoverageDisplayOf(connector);
  const partial = coverage.kind === 'PARTIAL';
  const complete = coverage.kind === 'COMPLETE';
  const unknown = coverage.kind === 'UNKNOWN';

  return (
    <section
      className={`semantic-coverage ${
        partial ? 'is-partial' : complete ? 'is-complete' : unknown ? 'is-unrecognized' : 'is-unknown'
      }`}
      data-testid="semantic-coverage"
      aria-label="说明书覆盖度"
    >
      <div className="semantic-coverage-mark" aria-hidden="true">
        {partial ? (
          <WarningOutlined />
        ) : complete ? (
          <CheckCircleOutlined />
        ) : (
          <QuestionCircleOutlined />
        )}
      </div>
      <div className="semantic-coverage-copy">
        <div className="semantic-coverage-title">
          <span>覆盖度</span>
          <b>{coverage.label}</b>
        </div>
        {partial ? (
          <>
            <p>{SEMANTIC_PARTIAL_CONSEQUENCE}</p>
            <div className="semantic-gap-list">
              {coverage.gaps.length > 0 ? (
                coverage.gaps.map((gap, index) => (
                  <article key={`${index}-${gap.label}`}>
                    <b>{gap.label}</b>
                    <span>{gap.desc}</span>
                  </article>
                ))
              ) : (
                <article>
                  <b>成因未提供</b>
                  <span>后端只标记了 PARTIAL；具体上下文请结合上方「最新说明」全文。</span>
                </article>
              )}
            </div>
          </>
        ) : complete ? (
          <p>当前成功版本没有整块表或字段缺失；这不代表每条推断都正确，仍需结合来源与验证结论。</p>
        ) : unknown ? (
          <p>后端返回了本页不认识的 coverage 原值，请先按契约漂移核对，不要将它当成「没跑过」。</p>
        ) : (
          <p>覆盖度为空表示还没成功生成过，不等于残缺；推导状态由上方独立回答。</p>
        )}
      </div>
    </section>
  );
}

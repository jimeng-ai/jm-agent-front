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
                  <b>原因未知</b>
                  <span>详情见上方「最新说明」。</span>
                </article>
              )}
            </div>
          </>
        ) : complete ? (
          <p>没有缺表，也没有缺字段。</p>
        ) : unknown ? (
          <p>覆盖情况无法识别，请联系平台管理员。</p>
        ) : (
          <p>生成后这里会显示覆盖情况。</p>
        )}
      </div>
    </section>
  );
}

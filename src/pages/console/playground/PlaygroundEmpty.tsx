import './playground-empty.css';

/**
 * 调试台「未选择 Agent」空状态。
 * 自绘 SVG（无外链图片，矢量、随主题缩放），配引导文案 + 指向左侧参数面板的箭头胶囊。
 */
export default function PlaygroundEmpty() {
  return (
    <div className="pg-empty">
      <svg
        className="pg-empty__art"
        viewBox="0 0 220 184"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="选择一个 Agent"
      >
        <defs>
          <linearGradient
            id="pgBody"
            x1="55"
            y1="48"
            x2="165"
            y2="132"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#5b9dff" />
            <stop offset="1" stopColor="#2563eb" />
          </linearGradient>
          <linearGradient
            id="pgVisor"
            x1="72"
            y1="66"
            x2="148"
            y2="110"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#1e293b" />
            <stop offset="1" stopColor="#0b1220" />
          </linearGradient>
          <radialGradient id="pgGlow" cx="0.5" cy="0.5" r="0.5">
            <stop stopColor="#93c5fd" stopOpacity="0.5" />
            <stop offset="1" stopColor="#93c5fd" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* 地面投影 */}
        <ellipse className="pg-empty__shadow" cx="110" cy="166" rx="48" ry="8" fill="#1e293b" />

        <g className="pg-empty__float">
          {/* 天线 */}
          <line
            x1="110"
            y1="48"
            x2="110"
            y2="33"
            stroke="#2563eb"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <circle cx="110" cy="28" r="11" fill="url(#pgGlow)" />
          <circle cx="110" cy="28" r="5" fill="#2563eb" />

          {/* 侧耳 */}
          <rect x="46" y="78" width="10" height="26" rx="5" fill="#1e4fd6" />
          <rect x="164" y="78" width="10" height="26" rx="5" fill="#1e4fd6" />

          {/* 头身 */}
          <rect x="55" y="48" width="110" height="84" rx="26" fill="url(#pgBody)" />
          {/* 顶部高光 */}
          <path
            d="M77 56h66a20 20 0 0 1 14 6c-12 9-30 13-47 11-13-1-24-6-33-12a20 20 0 0 1 0 -5z"
            fill="#ffffff"
            opacity="0.16"
          />

          {/* 面罩 */}
          <rect x="72" y="66" width="76" height="44" rx="18" fill="url(#pgVisor)" />
          {/* 眼睛 */}
          <rect x="92" y="80" width="11" height="16" rx="5.5" fill="#7dd3fc" />
          <rect x="117" y="80" width="11" height="16" rx="5.5" fill="#7dd3fc" />
          <circle cx="97.5" cy="84" r="2" fill="#ffffff" />
          <circle cx="122.5" cy="84" r="2" fill="#ffffff" />
          {/* 微笑 */}
          <path
            d="M101 100q9 6 18 0"
            stroke="#7dd3fc"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
          />

          {/* 火花 */}
          <path
            className="pg-empty__spark"
            transform="translate(168 54)"
            d="M0 -7C1 -2 2 -1 7 0C2 1 1 2 0 7C-1 2 -2 1 -7 0C-2 -1 -1 -2 0 -7Z"
            fill="#60a5fa"
          />
          <path
            className="pg-empty__spark pg-empty__spark--b"
            transform="translate(50 92) scale(0.8)"
            d="M0 -7C1 -2 2 -1 7 0C2 1 1 2 0 7C-1 2 -2 1 -7 0C-2 -1 -1 -2 0 -7Z"
            fill="#93c5fd"
          />
        </g>
      </svg>

      <h3 className="pg-empty__title">选择一个 Agent 开始调试</h3>
      <p className="pg-empty__desc">
        在左侧「参数」面板选择要调试的 Agent，即可发起对话，并观察其知识检索与工具调用的完整过程。
      </p>

      <span className="pg-empty__hint">
        <span className="pg-empty__arrow" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M14 6l-6 6 6 6"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        先从左侧选择 Agent
      </span>
    </div>
  );
}

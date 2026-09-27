import { useEffect, useRef } from 'react';

/**
 * 在沙箱 iframe 里展示 skill-creator 的评审页（eval-viewer/generate_review.py --static 的产物），
 * 并把它的反馈接回后端——viewer.html 一个字不改。
 *
 * 评审页自己的协议很简单：GET /api/feedback 读已保存的反馈，POST /api/feedback 自动保存（输入停 800ms）
 * 与最终提交（status=complete）；fetch 失败才退回「下载 feedback.json」。这里在页面最前面注入一小段脚本，
 * 只拦截 /api/feedback：GET 直接回已保存的反馈，POST 经 postMessage 交给宿主，由宿主调后端存成该轮的
 * feedback.json——与 skill-creator 服务器模式写的位置完全一致，下一轮它照常从那里读。
 *
 * 安全：
 * - sandbox 只给 allow-scripts + allow-downloads，没有 allow-same-origin → iframe 是空白独立源，
 *   读不到宿主的 localStorage（登录 token 就在那里）、也带不上宿主的任何凭据。
 * - 页面里嵌着模型生成的测试产出，按不可信内容对待：CSP 禁掉 fetch/XHR（connect-src 'none'），脚本 / 样式 /
 *   字体只放行评审页自己引用的 SheetJS 与 Google Fonts，图片只认 data: / blob:，防止把评审内容外发。
 * - 宿主只认来自这个 iframe 的消息（比对 event.source），并校验反馈的形状后才保存。
 */

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdn.sheetjs.com",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com data:',
  'img-src data: blob:',
  'media-src data: blob:',
  'frame-src data: blob:',
  "connect-src 'none'",
].join('; ');

/** 注入到评审页最前面的桥接脚本。saved 由宿主序列化进来（JSON 字面量）。 */
function bridgeScript(savedJson: string): string {
  return `<script>(function(){
  var saved = ${savedJson};
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  var seq = 0, pending = {};
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.__jmReview !== 1 || d.kind !== 'saved') return;
    var p = pending[d.seq]; if (!p) return; delete pending[d.seq];
    if (d.ok) p.resolve(); else p.reject(new Error(d.error || 'save failed'));
  });
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (/(^|\\/)api\\/feedback$/.test(url)) {
      var method = ((init && init.method) || 'GET').toUpperCase();
      if (method === 'GET') {
        return Promise.resolve(new Response(JSON.stringify(saved || { reviews: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      var s = ++seq;
      return new Promise(function (resolve, reject) {
        pending[s] = { resolve: function () { resolve(new Response('{"ok":true}', { status: 200 })); }, reject: reject };
        parent.postMessage({ __jmReview: 1, kind: 'save', seq: s, body: String((init && init.body) || '') }, '*');
      });
    }
    return realFetch ? realFetch(input, init) : Promise.reject(new Error('fetch unavailable'));
  };
})();</script>`;
}

/** 把 CSP 与桥接脚本放进 <head> 最前面（评审页自己的脚本之前）；没有 <head> 就放在最前。 */
function buildReviewSrcDoc(html: string, saved: unknown): string {
  // </script> 出现在 JSON 里会提前闭合脚本标签：转义 < 即可。
  const savedJson = JSON.stringify(saved ?? null).replace(/</g, '\\u003c');
  const inject = `<meta http-equiv="Content-Security-Policy" content="${CSP}">${bridgeScript(savedJson)}`;
  const m = /<head[^>]*>/i.exec(html);
  return m ? html.slice(0, m.index + m[0].length) + inject + html.slice(m.index + m[0].length) : inject + html;
}

interface FeedbackPayload {
  reviews: { run_id: string; feedback: string; timestamp?: string }[];
  status?: string;
}

function isFeedback(v: unknown): v is FeedbackPayload {
  if (!v || typeof v !== 'object') return false;
  const r = (v as { reviews?: unknown }).reviews;
  return (
    Array.isArray(r) &&
    r.every(
      (x) =>
        x &&
        typeof x === 'object' &&
        typeof (x as { run_id?: unknown }).run_id === 'string' &&
        typeof (x as { feedback?: unknown }).feedback === 'string',
    )
  );
}

interface Props {
  html: string;
  /** 已保存的 feedback.json（没有则 null） */
  saved: unknown;
  /** 保存反馈；reject 时评审页会显示「Will download on submit」 */
  onSave: (feedback: FeedbackPayload) => Promise<void>;
  /** 用户点了 Submit All Reviews（status=complete）且已保存 */
  onSubmitted?: () => void;
  /** 只读（会话已发布 / 构建器正在跑）：不接受保存 */
  readOnly?: boolean;
  title?: string;
}

export default function ReviewFrame({ html, saved, onSave, onSubmitted, readOnly, title }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  // autosave 后父层会更新 saved，但不能因此重载正在编辑的 iframe。同一份 HTML 固定 srcDoc；
  // 切换标签重挂载、或后端生成了新 HTML 时，再用当时最新的 saved 初始化。
  const srcDocCache = useRef<{ html: string; value: string }>();
  if (!srcDocCache.current || srcDocCache.current.html !== html) {
    srcDocCache.current = { html, value: buildReviewSrcDoc(html, saved) };
  }
  const srcDoc = srcDocCache.current.value;
  const handlers = useRef({ onSave, onSubmitted, readOnly });
  handlers.current = { onSave, onSubmitted, readOnly };

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (!ref.current || ev.source !== ref.current.contentWindow) return;
      const d = ev.data as { __jmReview?: number; kind?: string; seq?: number; body?: string };
      if (!d || d.__jmReview !== 1 || d.kind !== 'save' || typeof d.seq !== 'number') return;
      const reply = (ok: boolean, error?: string) =>
        ref.current?.contentWindow?.postMessage({ __jmReview: 1, kind: 'saved', seq: d.seq, ok, error }, '*');
      const h = handlers.current;
      if (h.readOnly) {
        reply(false, 'read only');
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(d.body ?? '');
      } catch {
        reply(false, 'bad json');
        return;
      }
      if (!isFeedback(parsed)) {
        reply(false, 'bad shape');
        return;
      }
      const fb = parsed;
      h.onSave(fb).then(
        () => {
          reply(true);
          if (fb.status === 'complete') h.onSubmitted?.();
        },
        (e: Error) => reply(false, e?.message),
      );
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <iframe
      ref={ref}
      title={title ?? 'skill-creator 评审页'}
      sandbox="allow-scripts allow-downloads"
      srcDoc={srcDoc}
      style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
    />
  );
}

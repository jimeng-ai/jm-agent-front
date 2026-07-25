import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBase = env.VITE_API_TARGET || 'http://localhost:10011';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 5173,
      host: true,
      proxy: {
        '/data': {
          target: apiBase,
          changeOrigin: true,
        },
      },
    },
    build: {
      // 关掉 sourcemap。构建跑在这台单机 prod 的 Docker VM 里（7.75G，常驻容器吃掉 ~6G，
      // available 常年只剩 1.5G 左右），而生成 map 是 rollup 峰值内存的大头——98 个 .map、
      // assets 从 ~8M 撑到 31M。2026-07-25 引入 mermaid 后构建直接被宿主 OOM killer SIGKILL，
      // CI 表现为 `✓ N modules transformed` 之后 `npm error signal SIGKILL`。
      // 代价：线上报错拿不到还原后的堆栈。要恢复请先解决 VM 内存，否则部署会静默不更新
      //（构建失败 → Redeploy step 被跳过 → 旧容器原样跑着，页面正常但没有新功能）。
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-antd': ['antd', '@ant-design/icons'],
            'vendor-markdown': [
              'react-markdown',
              'remark-gfm',
              'rehype-highlight',
              'rehype-raw',
              'highlight.js',
            ],
            'vendor-monaco': ['@monaco-editor/react'],
          },
        },
      },
    },
  };
});

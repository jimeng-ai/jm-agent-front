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
      // 关掉 sourcemap：生成 98 个 .map 会把 assets 从 ~8M 撑到 31M，全部打进 nginx 镜像，
      // 而 'hidden' 模式下 map 的文件名就是 `<js>.map`，等于源码照样能被人猜到路径拉走。
      // 代价是线上报错拿不到还原后的堆栈。构建已搬到宿主机(见 Dockerfile.dist)，内存不再是
      // 约束，所以要恢复成 'hidden' 现在是纯粹的取舍问题，改回来不会再把构建搞挂。
      sourcemap: false,
      // 关掉 gzip 体积报告：vite 默认把每个 chunk 都在内存里压一遍，只为打印那列 gzip 大小。
      reportCompressedSize: false,
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

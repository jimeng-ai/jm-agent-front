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
      sourcemap: 'hidden',
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

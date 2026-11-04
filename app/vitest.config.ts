import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    dedupe: ['three'],
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
      three: path.resolve(__dirname, 'node_modules/three'),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname), path.resolve(__dirname, '../config')],
    },
  },
  test: {
    environment: 'jsdom',
    // 全局环境 shim（ResizeObserver 等 jsdom 缺失 API），与具体测试文件解绑（issue #69）
    setupFiles: ['./test-setup.ts'],
  },
});

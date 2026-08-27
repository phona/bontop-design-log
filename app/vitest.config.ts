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
  },
});

import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      'three': 'three',
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: { input: { main: 'index.html', forest: 'forest/index.html' } }
  },
});

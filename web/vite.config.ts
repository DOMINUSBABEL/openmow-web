import { defineConfig } from 'vite';

// Dev: `npm run dev` serves the client on :5173 and proxies asset routes to the Python server (:8080).
// Prod: `npm run build` -> web/dist, served directly by tools/server/main.py on :8080.
const target = 'http://127.0.0.1:8080';
export default defineConfig({
  server: {
    port: 5173,
    proxy: { '/vfs': target, '/vfs-list': target, '/conv': target, '/api': target },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: { index: 'index.html', viewer: 'viewer.html', map: 'map.html' } },
  },
});

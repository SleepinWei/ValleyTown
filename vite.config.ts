import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode })=>({
  plugins: [react()],
  base: loadEnv(mode,process.cwd()).VITE_BASE_PATH || '/',
  worker: { format: 'es' },
  build: { rollupOptions: { output: { manualChunks: { three: ['three'], react: ['react', 'react-dom'] } } } },
}));

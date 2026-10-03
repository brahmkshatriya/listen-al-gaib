import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};
export default defineConfig({
  plugins: [react()],
  server: { watch: { usePolling: true }, host: "0.0.0.0", headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1800 },
  optimizeDeps: { exclude: ['kokoro-js', '@huggingface/transformers'] },
});

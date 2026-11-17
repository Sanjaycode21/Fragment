import { defineConfig } from 'vite';
import { videoImport } from './server/video-import.ts';

export default defineConfig({
  plugins: [videoImport()],
  optimizeDeps: {
    include: ['mediabunny'],
    exclude: ['@huggingface/transformers', 'onnxruntime-web'],
  },
  worker: { format: 'es' },
});

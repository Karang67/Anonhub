import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@tldraw') || id.includes('tldraw')) {
              return 'tldraw-vendor';
            }
            if (id.includes('xlsx') || id.includes('docx') || id.includes('mammoth')) {
              return 'office-libs';
            }
            if (id.includes('monaco-editor') || id.includes('tinymce') || id.includes('@monaco-editor') || id.includes('@tinymce')) {
              return 'editors';
            }
            if (id.includes('fabric')) {
              return 'canvas';
            }
            if (id.includes('lucide-react')) {
              return 'icons';
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
              return 'vendor';
            }
          }
        }
      }
    }
  },
  server: {
    host: true,
    allowedHosts: true,
    proxy: {
      '/create-project': 'http://localhost:3000',
      '/create-office': 'http://localhost:3000',
      '/join-chat': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
      '/attachments': 'http://localhost:3000',
      '/upload': 'http://localhost:3000',
      '/socket.io': {
        target: 'ws://localhost:3000',
        ws: true
      }
    }
  }
})

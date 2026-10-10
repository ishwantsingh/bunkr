import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/client/',
  build: {outDir: '../imageoverbt/ui/client', emptyOutDir: true},
  server: {proxy: {'/api': 'http://127.0.0.1:8765', '/fonts': 'http://127.0.0.1:8765'}},
})

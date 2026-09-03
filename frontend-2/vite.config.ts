import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  server: {
    host:true,
    // Default 5173 is often blocked on Windows: Hyper-V / WinNAT reserves ranges like 5138–5237 (5173 is inside).
    // Use a port outside those ranges, or free 5173 via OS steps below.
    port: 4000,
    strictPort: false,
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  server: {
    host:true,
    // Default 5173 is often blocked on Windows: Hyper-V / WinNAT reserves ranges like 5138–5237 (5173 is inside).
    // Use a port outside those ranges, or free 5173 via OS steps below.
    port: 4000,
    strictPort: false,
  },
})

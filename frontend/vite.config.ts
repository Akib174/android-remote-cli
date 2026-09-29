import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ফ্রন্টএন্ড শুধুই একটি স্ট্যাটিক SPA — কোথাও ডোমেইন হার্ডকোড নেই।
// এনভায়রনমেন্ট ভ্যারিয়েবল `VITE_API_BASE` দিয়ে ব্যাকএন্ড পয়েন্ট করা হয় (.env দেখুন)।
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'esnext',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          motion: ['framer-motion'],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
})

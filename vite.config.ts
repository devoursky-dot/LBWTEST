import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // 구형 브라우저 호환성을 위해 타겟을 chrome80 또는 es2015로 낮춤
    target: 'chrome80',
    cssTarget: 'chrome80'
  }
})

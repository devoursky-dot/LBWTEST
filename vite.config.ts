import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    // 전자칠판 내장 브라우저(구형 안드로이드 WebView/Chrome) 극대화 호환성 설정
    target: ['es2015', 'chrome60', 'safari11', 'edge18'],
    cssTarget: 'chrome60'
  }
})




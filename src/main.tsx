import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initGlobalModalAutoScroll } from './lib/scrollModule'

// 전역 모달 입력창 가상 키보드 가림 방지 자동 스크롤 시스템 1회 등록
initGlobalModalAutoScroll();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)


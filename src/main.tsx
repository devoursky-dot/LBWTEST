import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initGlobalModalAutoScroll, initGlobalTouchScroll } from './lib/scrollModule'

// 1. 전역 모달 입력창 가상 키보드 가림 방지 자동 스크롤 등록
initGlobalModalAutoScroll();

// 2. 태블릿/터치스크린 전용 다이렉트 터치 제스처 스크롤 엔진 등록 (WebKit 버그 완벽 방어)
initGlobalTouchScroll();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)


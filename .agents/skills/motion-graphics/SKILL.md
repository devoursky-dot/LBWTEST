---
name: motion-graphics
description: Programmatic motion graphics, video generation, and high-performance canvas/CSS animations. Covers Remotion, HyperFrames, Claude Dashboard Motion, Keyframe Gallery 60fps compositor rules, and Awesome Opus 5.5 generative visual coding.
---

# Motion Graphics & Generative Visual Skill

## 1. 개요
웹 프론트엔드와 AI 에이전트의 경계를 넓히는 모션 그래픽 기술 스위트입니다. 리액트 컴포넌트로 비디오를 렌더링하는 Remotion, HTML을 MP4로 전환하는 HyperFrames, 대시보드 데이터 모션(Claude Motion), 60fps GPU 컴포지터(Keyframe Gallery), 그리고 캔버스/Three.js 기반의 생성형 비주얼(Awesome Opus 5.5)을 통합합니다.

## 2. 핵심 프레임워크 및 도구별 원칙

### 1) Remotion & HyperFrames (코드 기반 비디오 렌더링)
- **결정론적 타임라인 (Deterministic Timeline)**:
  - `requestAnimationFrame`의 시간 기반 지연에 의존하지 않고, 정확한 프레임(`frame`) 번호에 따른 상태를 함수로 계산.
  - 수학적 보간(`interpolate(frame, [0, 30], [0, 1])`)과 스프링(`spring({ frame, fps: 30, config: { damping: 12 } })`) 활용.
- **용도**: 제품 소개 비디오, 전자칠판 판서 타임랩스 비디오 자동 내보내기, 소셜 공유 영상 합성.

### 2) Keyframe Gallery & 60fps GPU 컴포지터 원칙
- **절대 애니메이션 금지 속성 (CPU Reflow 유발)**:
  - `width`, `height`, `top`, `left`, `margin`, `padding`
- **반드시 사용해야 할 GPU 가속 속성 (Composite Only)**:
  - `transform` (`translate3d`, `scale`, `rotate`), `opacity`
  - 필요 시 브라우저 힌트 제공: `will-change: transform;`

### 3) Claude Motion (대시보드 & 데이터 모션)
- 시각화 차트, 판서 통계, 접속자 수 카운팅 시 숫자가 덜컥 바뀌지 않고 0.4초간 자연스러운 카운트업 애니메이션(`Intl.NumberFormat`) 적용.
- 데이터 로딩 시 앰비언트 블러(`backdrop-filter: blur(12px)`)와 펄스 링으로 데이터 갱신 생동감 전달.

### 4) Awesome Opus 5.5 생성형 캔버스 비주얼
- HTML5 Canvas 및 SVG를 이용한 유려한 수학적 파형(Sine waves), 파티클 네트워크, 전자칠판 그리드 배경 등을 코드로 생성.

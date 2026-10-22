---
name: design-craft
description: >-
  High-end UI/UX design craft system integrating 8 world-class design frameworks:
  (1) Awesome Opus Multimedia Showcase, (2) Anthropic Frontend Design System,
  (3) Impeccable Tactile Craft (Rauno), (4) Hallmark Signature Interactions,
  (5) Design Taste & Curation, (6) Emil Kowalski Spring Physics & Micro-animations,
  (7) Vercel Geist Guidelines (Deep Dark Monochrome), and (8) UI/UX Pro Max.
  Activate this skill whenever the user requests UI/UX design, frontend beautification,
  animations, tactile micro-interactions, dark mode styling, Vercel/Linear aesthetics,
  or mentions keywords like '디자인 스킬', '버셀 스타일', '에밀 코왈스키', '임페커블', 'UI UX 프로 맥스',
  '테이스트', '홀마크', '앤트로픽 디자인', '/design-craft', '/vercel', '/impeccable', '/emil', '/ui-ux-pro'.
---

# 🎨 Design Craft: 8대 마스터 디자인 스킬 실행 룰북

본 스킬은 Antigravity가 사용자 인터페이스(UI)를 구축, 수정, 리팩토링할 때 세계 최고 수준의 프론트엔드 장인 정신(Craftsmanship)과 심미성을 100% 보장하기 위한 실행 지침입니다.

---

## 💎 8대 핵심 디자인 원칙 및 코드 토큰

### 1. 앤트로픽 프론트엔드 & 테이스트 (Anti-Generic & Curation)
* **절대 금지**: 뻔한 보라-파랑 네온 AI 그라데이션, 브라우저 기본 글꼴, 헐거운 여백.
* **8px 배수 시스템**: `padding: 4px, 8px, 16px, 24px`, `gap: 6px, 8px, 12px, 16px`.
* **타이포그래피 계층 (Opacity 기반)**:
  ```css
  --text-primary: #ffffff;             /* 100% 가독성 */
  --text-secondary: rgba(255, 255, 255, 0.72); /* 72% 보조 */
  --text-muted: rgba(255, 255, 255, 0.45);     /* 45% 캡션/힌트 */
  ```

### 2. 버셀 가이스트 가이드라인 (Vercel Geist Guidelines)
* **3단계 딥 블랙 레이어링**:
  ```css
  --bg-canvas: #000000;    /* 최하단 캔버스 */
  --bg-surface: #0a0a0a;   /* 카드, 사이드바, 패널 */
  --bg-elevated: #141414;  /* 모달, 팝업, 툴팁 */
  --border-subtle: #222222;/* 1px 정밀 테두리 */
  --border-active: #333333;
  ```
* **라디얼 스포트라이트 호버 (Spotlight Effect)**:
  카드를 호버할 때 마우스 주변 120px 반경으로 은은한 `rgba(255, 255, 255, 0.05)` 라디얼 광원 적용.

### 3. 임페커블 크래프트 (Impeccable Tactile Details)
* **1px 내부 하이라이트 (Inset Shadow)**:
  ```css
  /* 플랫한 버튼이 아닌 빛이 맺히는 프리미엄 버튼 */
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 2px 8px rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.08);
  ```
* **손맛 피드백 (Tactile Press Feedback)**:
  ```css
  button:active, .interactive:active {
    transform: scale(0.97);
    transition: transform 0.06s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  ```
* **단축키(Kbd) 배지**: 주요 버튼 우측에 `[ESC]`, `[Enter]` 등 반투명 kbd 배지 제공.

### 4. 에밀 코왈스키 물리 애니메이션 (Emil Kowalski Physics)
* **Linear / Ease-in-out 배제, Spring 물리학 적용**:
  ```css
  /* 찰진 탄성을 가진 스프링 트랜지션 */
  transition: all 0.24s cubic-bezier(0.16, 1, 0.3, 1);
  ```
* **스태거(Stagger) 순차 등장**:
  목록, 그리드 카드 렌더링 시 40ms 단위 지연 (`animation-delay: calc(var(--index) * 40ms)`).
* **FLIP 레이아웃 전환**: 요소의 위치나 크기가 바뀔 때 순간 이동하지 않고 자연스럽게 늘어나며 안착.

### 5. 홀마크 시그니처 인터랙션 (Hallmark)
* 핵심 성공 시점(제출 완료, 모달 오픈, 100% 줌 복귀)에 **화려하지만 과하지 않은 1개의 시그니처 피드백** 부여 (스파클, 마이크로 파티클, 또는 네온 펄스).

### 6. 어썸 오푸스 멀티모달 & 비디오 (Awesome Opus)
* 비디오나 캔버스 주변에 앰비언트 글로우 블러(`backdrop-filter: blur(20px)`, `opacity: 0.3`)를 부여하여 깊이감 조성.
* 미디어 로딩 시 덜컹거림이 전혀 없도록 정확한 종횡비(Aspect Ratio) 사전 유지.

### 7. UI UX 프로 맥스 (UI UX Pro Max)
* **4대 필수 상태 완비**: `Loading (스켈레톤)`, `Empty (친절한 안내/유도)`, `Error (재시도 버튼)`, `Success (즉각 피드백)`.
* **터치 타깃 크기**: 모바일 및 전자칠판에서 오터치가 발생하지 않도록 최소 `40x40px` (권장 `44x44px`) 터치 영역 보장.
* **입력 검증 및 디바운스(Debounce)**: 중복 클릭 방지(`isSubmitting`), 텍스트 말줄임표(`text-overflow: ellipsis`) 및 호버 툴팁.

---

## 🚀 Antigravity 실행 프로토콜

사용자가 UI 작업, 페이지 생성, 컴포넌트 스타일링을 요청하면 아래 3단계를 자동으로 수행한다:

1. **토큰 및 베이스 점검**:
   - 배경 색상이 단색 회색이나 어색한 푸른색이 아닌지 점검 (Vercel Deep Black `#000`/`#0a0a0a`로 보정).
   - 테두리가 투박하지 않은지 점검 (`rgba(255, 255, 255, 0.08)` 1px 정밀 라인 적용).
2. **인터랙션 주입 (Tactile & Spring)**:
   - 모든 버튼과 클릭 가능한 카드에 `scale(0.97)` 액티브 손맛과 스프링 이징 추가.
   - 모달과 드롭다운에 `cubic-bezier(0.16, 1, 0.3, 1)` 등장 애니메이션 적용.
3. **완결성 검증 (Pro Max & Anti-Generic)**:
   - 더미 주석 없이 100% 동작하는 코드로 작성.
   - 데이터가 없을 때의 Empty State와 진행 중 Loading State가 아름답게 디자인되었는지 확인.

---
name: emil-design-eng
description: Emil Kowalski's Design Engineering philosophy on spring physics, micro-interactions, animation frequency framework, and invisible tactile polish from Linear and Vercel.
---

# Emil Kowalski Design Engineering Skill

## 1. 개요
Linear와 Vercel의 디자인 엔지니어 Emil Kowalski의 철학을 집대성한 스킬입니다. 인간의 눈과 손이 '기분 좋음'을 느끼는 물리 법칙과 보이지 않는 세부 디테일을 코드로 구현합니다.

## 2. 애니메이션 발생 빈도 프레임워크 (Animation Frequency Framework)

| 하루 노출 빈도 | 예시 | 실행 원칙 |
| :--- | :--- | :--- |
| **100회 이상/일** | 키보드 단축키, 검색창(Cmd+K), 도구 전환 | **애니메이션 절대 금지 (0ms 즉각 반응)** |
| **수십 회/일** | 마우스 호버, 리스트 탐색 | 100~150ms 극도로 절제된 미세 전환 |
| **가끔 (수회/일)** | 모달 팝업, 서랍(Drawer), 알림 토스트 | 200~250ms 스프링 물리학 기반 등장 |
| **최초/특별한 순간** | 온보딩 완료, 데이터 동기화 성공 축하 | 풍부한 시그니처 마이크로 인터랙션 허용 |

> **핵심 철칙**: 키보드로 트리거되는 동작에는 애니메이션을 절대로 주지 않는다. 사용자가 타이핑할 때 화면이 느리게 움직이면 소프트웨어가 둔탁하게 느껴진다.

## 3. 손맛을 살리는 5대 인터랙션 법칙

### 1) 버튼 누름 손맛 (`scale(0.97)`)
```css
button:active, .interactive:active {
  transform: scale(0.97);
  transition: transform 0.08s cubic-bezier(0.2, 0.8, 0.2, 1);
}
```

### 2) 무(無)에서 유(有)로 나타나지 말 것 (`scale(0.95)` 시작)
```css
/* 나쁜 예: scale(0) - 현실 세계에 0 크기에서 갑자기 커지는 물체는 없음 */
/* 좋은 예: 약간 축소된 95% 크기에서 부드럽게 100%로 안착 */
@keyframes enterModal {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(6px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
```

### 3) 드롭다운 등장엔 반드시 `ease-out` (절대 `ease-in` 금지)
- `ease-in`은 시작이 느려 굼뜨게 느껴집니다.
- `ease-out` 또는 `cubic-bezier(0.16, 1, 0.3, 1)`는 누르자마자 폭발적으로 반응한 후 부드럽게 감속하여 가장 빠르고 민첩하게 체감됩니다.

### 4) `transition: all` 금지
- `transition: all`은 브라우저의 모든 속성(레이아웃 계산 포함)을 감시하므로 버벅거림을 유발합니다.
- 반드시 `transition: transform 0.2s ease-out, opacity 0.2s ease-out;` 처럼 GPU 가속이 되는 컴포지트 속성만을 개별 지정합니다.

### 5) 팝오버의 변형 기준점 (`transform-origin`)
- 모달은 화면 중앙(`center`)에서 확대되지만, 드롭다운/팝오버는 반드시 그것을 열어준 버튼(Trigger)의 방향(`transform-origin: top left` 등)에서 자라나야 공간적 인과관계가 자연스럽습니다.

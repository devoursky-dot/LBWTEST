---
name: ui-ux-pro-max
description: UI UX Pro Max v2.0 intelligent design system skill. Provides 192 reasoning rules, 79 searchable UI styles, the 4-state interface protocol (Loading, Empty, Error, Success), 44px touch targets, and accessibility requirements.
---

# UI UX Pro Max v2.0 Design Skill

## 1. 개요
UI UX Pro Max는 단순한 컴포넌트 복사를 넘어, 제품의 비즈니스 목표와 사용자의 심리적 흐름을 분석하여 최적의 디자인 시스템과 화면을 추론하는 지능형 AI 디자인 스킬입니다.

## 2. 4대 필수 상태 규약 (The 4 States of Every Screen)
어떤 컴포넌트나 페이지를 구현하든 아래 4가지 상태를 누락 없이 100% 코딩해야 합니다:
1. **Loading State (로딩 상태)**:
   - 화면 전체가 덜컹거리지 않도록 실제 컨텐츠의 크기와 동일한 스켈레톤(Skeleton UI) 제공.
   - `shimmer` 애니메이션을 가미하여 시스템이 멈추지 않고 작업 중임을 인지시킴.
2. **Empty State (빈 상태)**:
   - 데이터나 결과가 없을 때 회색 공백만 남기지 않음.
   - 왜 비어 있는지 설명하고, 즉시 다음 행동(예: "새 수업 개설하기", "검색어 초기화")을 유도하는 CTA 버튼 배치.
3. **Error State (오류 상태)**:
   - "오류가 발생했습니다" 같은 무책임한 메시지 금지.
   - 실패 원인을 솔직하고 명확하게 전달하고, 즉시 재시도할 수 있는 `[다시 시도]` 버튼 제공.
4. **Success State (성공 상태)**:
   - 저장, 동기화, 업로드 완료 시 즉각적인 시각 피드백(체크마크 펄스, 토스트 배지) 제공.

## 3. 터치 및 접근성 규약
- **터치 타깃 최소 크기**: 
  - 모바일 및 대형 전자칠판에서 오터치가 발생하지 않도록 모든 클릭/터치 요소는 최소 `44px × 44px` 이상의 히트 영역을 확보해야 함.
- **포커스 링**:
  - 키보드 내비게이션(`Tab`) 사용자를 위한 고대비 포커스 아웃라인(`outline: 2px solid var(--accent-color); outline-offset: 2px`) 필수 적용.
- **텍스트 오버플로우 방지**:
  - 가변 데이터(폴더명, 파일명, 학생 이름)는 반드시 `text-overflow: ellipsis; white-space: nowrap; overflow: hidden;` 처리 및 마우스 호버 시 전체 이름을 볼 수 있는 툴팁(`title`) 제공.

## 4. 디자인 시스템 생성 추론 규칙
1. **도메인 분석**: 교육/전자칠판 -> 눈의 피로를 낮추는 딥 다크 모드, 펜 드로잉과 대비되는 선명한 액센트(시안, 에메랄드, 앰버).
2. **계층 구조**: 8px 그리드 기반 (여백: 8px, 16px, 24px, 32px / 폰트: 12px, 14px, 16px, 20px, 28px, 36px).
3. **안티 패턴 방지**: 한 화면에 3개 이상의 강조색 혼용 금지. 주요 CTA는 1개만 강조(Primary), 나머지는 고스트/서브 버튼(Secondary) 처리.

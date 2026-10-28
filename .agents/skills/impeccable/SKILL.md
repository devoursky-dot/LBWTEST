---
name: impeccable
description: Impeccable frontend craft skill. Features 24 shared design commands (/audit, /critique, /polish, /bolder, /quieter, /distill, /harden, /animate, /typeset, /layout, /delight, /clarify, etc.) and 62 deterministic anti-slop detector rules.
---

# Impeccable Design Skill

## 1. 개요
Impeccable은 AI 에이전트와 개발자 간의 정밀한 디자인 협업을 위한 시스템입니다. 24개 명령어를 통해 디자인의 대담함, 차분함, 타이포그래피, 마이크로 애니메이션을 점진적으로 튜닝할 수 있습니다.

## 2. 24개 주요 명령어 가이드

| 명령어 | 역할 및 동작 원칙 |
| :--- | :--- |
| `/impeccable audit` | 접근성(a11y), 색상 대비비(WCAG AA 4.5:1), 반응형 깨짐, 모바일 터치 영역 기술 점검 |
| `/impeccable critique` | UX 디자인 시각적 위계, 정보 전달 명확성, 사용자 감성적 만족도 검토 |
| `/impeccable polish` | 배포 전 최종 마감: 1px 라인 정리, 여백 불균형 교정, 서체 리듬 일치화 |
| `/impeccable bolder` | 너무 밋밋하거나 지루한 디자인에 강렬한 대비와 시각적 앵커 포인트 부여 |
| `/impeccable quieter` | 시각적 자극이 과도한 디자인을 정돈하여 차분하고 전문적인 느낌으로 정제 |
| `/impeccable distill` | 불필요한 장식, 과도한 컨테이너/카드 중첩을 걷어내고 핵심 정보만 남김 |
| `/impeccable harden` | 엣지 케이스 처리: 빈 데이터, 네트워크 오류, 긴 텍스트 말줄임표, 비동기 디바운스 |
| `/impeccable animate` | 목적 없는 장식용 애니메이션을 배제하고, 상태 변화와 공간 연속성을 돕는 물리 모션 주입 |
| `/impeccable typeset` | 가독성 높은 폰트 스택 적용, 자간 조정, 줄바꿈(word-break), 80ch 이내의 가독 라인폭 설정 |
| `/impeccable layout` | 불규칙한 그리드 교정, 8px 배수 여백 시스템 안착, 요소 간 시각적 리듬 정렬 |
| `/impeccable delight` | 사용자가 성공적인 작업을 마쳤을 때 감탄할 수 있는 1개의 시그니처 마이크로 인터랙션 추가 |
| `/impeccable clarify` | 모호하거나 기계적인 UX 문구를 사용자의 언어로 직관적이고 친절하게 교체 |

## 3. Impeccable 62대 안티 패턴 감지 규칙 (핵심 발췌)
- **절대 순수 검정/순수 회색 쓰지 말 것**: 모든 어두운 배경과 텍스트는 제품의 틴트(청회색 또는 따뜻한 챠콜)를 2~5% 가미한다.
- **카드 안의 카드(Nested Cards) 남발 금지**: 구분이 필요할 때는 테두리 대신 미세한 배경색 단차(`--bg-surface` vs `--bg-elevated`)나 여백만으로 분리한다.
- **모든 헤딩 위의 둥근 아이콘 타일 남발 금지**: 아이콘은 의미 전달이 필요할 때만 선별 배치한다.
- **바운스(Elastic Bounce) 모션 배제**: 2010년대 플래시 스타일의 튀는 효과는 소프트웨어의 신뢰도를 떨어뜨리므로 정제된 스프링(`cubic-bezier(0.16, 1, 0.3, 1)`)을 사용한다.

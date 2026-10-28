---
name: hallmark
description: Hallmark design craftsmanship skill (Together AI). Enforces 3-tier quality gates (Floor, Reflex, Finish) and ruthlessly eliminates AI-generated tells (eyebrows, tracked capitals, fake forms, empty frames).
---

# Hallmark Quality Gates Skill

## 1. 개요
Hallmark(Together AI 개발)는 인공지능이 만든 티(AI Slop)가 전혀 나지 않는 인간 디자이너 수준의 제품 완성도를 달성하기 위해 3단계 게이트웨이(Quality Gates)를 통과시키는 시스템입니다.

## 2. 3단계 품질 게이트 (The Three Quality Gates)

### Gate 1: The Floor (절대 배포 불가 기준)
이 기준 중 하나라도 미달되면 절대로 배포하거나 작업을 종료할 수 없습니다:
1. **대비비 미달**: 배경과 텍스트의 명도 대비가 4.5:1 미만인 경우.
2. **모바일/터치 레이아웃 파손**: 뷰포트가 줄어들 때 가로 스크롤이 발생하거나 요소가 겹치는 경우.
3. **가짜 데이터/허위 시뮬레이션**: 실제 API나 DB와 연결되지 않은 더미 난수 데이터를 실제 동작하는 척 하드코딩하는 행위.
4. **키보드 접근성 결여**: 마우스 없이 `Tab` 키로 모든 주요 상호작용(버튼, 입력창, 링크)에 접근할 수 없는 경우.

### Gate 2: Reflex Gates (모델의 안일한 습관 차단)
AI 모델이 본능적으로 빠지는 상투적인 패턴을 강제로 제어합니다:
- **모든 제목 위의 미니 라벨(Eyebrow Tag)** 금지.
- **모든 제목의 1개 단어만 다른 색으로 하이라이트**하는 흔한 AI 수법 금지.
- **아무런 전송도 하지 않으면서 "감사합니다"**만 띄우는 껍데기 폼 금지.
- **화면 아래마다 무조건 뉴스레터 구독창** 붙이는 습관 금지.

### Gate 3: Finish Checks (장인정신 마감 검증)
- **도메인 특화 인터랙션**: 전자칠판이면 판서 도구 및 학생 상태가 중심이 되고, 관리 포털이면 드라이브 동기화가 중심이 됨.
- **폰트 위계의 절제**: 한 페이지 안에서 폰트 크기 가짓수를 4~5개 이내로 통제하고 투명도(`opacity: 0.72`, `0.45`)로 위계 생성.
- **진짜 컨텐츠**: 자리표시자(Lorem Ipsum) 대신 실제 수업 및 드라이브와 일치하는 맥락적인 문구 사용.

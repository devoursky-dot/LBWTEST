# 14대 AI 디자인 & 인터랙션 스위트 완전 활용 가이드

이 문서는 사용자가 제공한 영상 속 14대 도구 및 스킬의 상세 사용법, 설치 명령, 핵심 코드 패턴을 완벽하게 정리한 통합 가이드입니다.

---

## 📑 목차
1. [CH1. AI 디자인 스킬 (AI Design Skills)](#ch1-ai-디자인-스킬)
2. [CH2. 작업공간 및 프로토타이핑 (Workspace)](#ch2-작업공간-및-프로토타이핑)
3. [CH3. 웹 인터랙션 & 물리학 (Web Interactions)](#ch3-웹-인터랙션--물리학)
4. [CH4. 모션그래픽 & 코드 비디오 (Motion Graphics)](#ch4-모션그래픽--코드-비디오)
5. [프로젝트 적용 및 코딩 치트시트](#프로젝트-적용-및-코딩-치트시트)

---

## CH1. AI 디자인 스킬

### 1. 프론트엔드 디자인 (Anthropic Frontend Design)
* **출처**: [anthropics/skills/skills/frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design)
* **목적**: 전형적인 AI 생성 느낌(AI Tells: 보라-파랑 네온, 일률적 카드 박스, 대문자 라벨)을 완전히 지우고, 제품의 본질에 집중된 개성 있는 인터페이스 구축.
* **핵심 지침**:
  - 브랜드 색상 팔레트는 4~6개로 제한하고 엄격한 위계 부여.
  - 가독 라인 길이는 80자를 넘지 않도록 제한 (`max-width: 70ch`).
  - 더미 텍스트(Lorem Ipsum) 대신 현장 도메인(전자칠판, 수업 교재, 학생 명단)에 맞는 진짜 컨텐츠 사용.

### 2. UI UX 프로 맥스 (UI UX Pro Max v2.0)
* **출처**: [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
* **설치**: `npm i -g ui-ux-pro-max-cli`
* **핵심 지침**:
  - **4대 필수 상태(The 4 States)**:
    1) `Loading`: 스켈레톤 UI + 200% 배경 쉬머 애니메이션
    2) `Empty`: "등록된 수업이 없습니다" + 새 수업 만들기 CTA
    3) `Error`: 구체적 사유 + 재시도(Retry) 버튼
    4) `Success`: 작업 완료 배지
  - **44px 터치 타깃**: 대형 전자칠판 및 모바일 대응 최소 히트박스 보장.

### 3. 테이스트 스킬 (Taste Skill)
* **출처**: [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill)
* **핵심 지침**:
  - 에이전트에게 Vibe(분위기)와 예술적 방향성을 부여하여 평범한 랜딩 페이지를 탈피.
  - 오픈 아카이브의 실제 고해상도 사진과 타이포그래피 여백 리듬(8px 배수) 적용.

### 4. 홀마크 (Hallmark Together AI)
* **출처**: [Nutlope/hallmark](https://github.com/Nutlope/hallmark)
* **핵심 지침**:
  - **3대 품질 게이트(Quality Gates)**:
    - `Floor (차단)`: 색상 명도대비 4.5:1 미달, 모바일 레이아웃 깨짐, 가짜 더미 데이터는 빌드 탈락.
    - `Reflex (교정)`: 제목 위 미니 태그 남발, 한 단어만 다른 색으로 칠하는 상투적 수법 제거.
    - `Finish (마감)`: 1px 세부 인셋 하이라이트 및 정직한 UX 카피.

### 5. 임페커블 (Impeccable)
* **출처**: [pbakaus/impeccable](https://github.com/pbakaus/impeccable) & [impeccable.style](https://impeccable.style)
* **설치**: `npx impeccable install`
* **24대 주요 명령어**:
  - `/impeccable audit`: 접근성, 모바일 터치, 색상 대비비 전수 검사
  - `/impeccable critique`: 사용자 관점의 위계와 감성적 완성도 검토
  - `/impeccable polish`: 출시 직전 1px 정렬 및 시각적 마무리
  - `/impeccable bolder` / `/impeccable quieter`: 디자인의 강약 조절
  - `/impeccable distill`: 불필요한 카드 중첩과 장식 제거

---

## CH2. 작업공간 및 프로토타이핑

### 6. 구글 스티치 (Google Stitch)
* **웹사이트**: [stitch.withgoogle.com](https://stitch.withgoogle.com)
* **역할**: Google Labs에서 개발한 AI 네이티브 UI 프로토타이핑 도구.
* **사용법**: 자연어로 앱 아이디어나 무드("과학 탐구 수업 전자칠판 대시보드")를 입력하면 고충실도(High-fidelity) 다중 화면 UI와 프론트엔드 코드를 즉각 생성하여 브라우저에서 검증.

### 7. 오픈디자인 (OpenDesign)
* **저장소**: [nexu-io/open-design](https://github.com/nexu-io/open-design)
* **역할**: 오픈소스 협업 AI 디자인 에이전트 작업공간.
* **사용법**: 디자인 시스템 토큰(색상, 타이포, 그리드)을 에이전트와 팀원이 실시간 캔버스에서 공유하며 컴포넌트를 점진적으로 발전.

---

## CH3. 웹 인터랙션 & 물리학

### 8. 에밀 코왈스키 물리학 (Emil Kowalski Skills)
* **저장소**: [emilkowalski/skills](https://github.com/emilkowalski/skills)
* **설치**: `npx skills@latest add emilkowalski/skills`
* **실전 코드 패턴**:
  ```css
  /* 1. 버튼 누름 손맛 */
  button:active {
    transform: scale(0.97);
    transition: transform 0.08s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  /* 2. 모달 자연스러운 등장 (0 크기가 아닌 95%에서 출발) */
  @keyframes modalEnter {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }

  /* 3. 드롭다운/팝오버는 반드시 ease-out */
  .popover-menu {
    transform-origin: top left;
    transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease-out;
  }
  ```

### 9. 리액트 비츠 (React Bits)
* **웹사이트**: [reactbits.dev](https://reactbits.dev) & [DavidHDev/react-bits](https://github.com/DavidHDev/react-bits)
* **내용**: 215+ 인터랙티브 컴포넌트(Split Text, Liquid Chrome, Fluid Glass, Light Tunnel, Shader backgrounds)를 리액트/바닐라 CSS로 제공.

### 10. 키프레임 갤러리 (Keyframe Gallery)
* **웹사이트**: [keyframe.gallery](https://keyframe.gallery)
* **60fps GPU 렌더링 수칙**:
  - **절대 애니메이션 금지**: `width`, `height`, `margin`, `padding`, `top`, `left` (CPU 레이아웃 리플로우 유발)
  - **오직 이것만 애니메이션**: `transform: translate3d/scale/rotate`, `opacity` (GPU 컴포지터 즉시 처리)

---

## CH4. 모션그래픽 & 코드 비디오

### 11. 리모션 (Remotion)
* **웹사이트**: [remotion.dev](https://www.remotion.dev) & [remotion-dev/remotion](https://github.com/remotion-dev/remotion)
* **설치**: `npx create-video@latest`
* **코드 예시**:
  ```tsx
  import { useCurrentFrame, interpolate, spring } from 'remotion';

  export const BoardIntro = () => {
    const frame = useCurrentFrame();
    const opacity = interpolate(frame, [0, 20], [0, 1]);
    const scale = spring({ frame, fps: 30, config: { damping: 10 } });

    return (
      <div style={{ opacity, transform: `scale(${scale})` }}>
        <h1>스마트 전자칠판</h1>
      </div>
    );
  };
  ```

### 12. 하이퍼프레임즈 (HyperFrames)
* **저장소**: [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes)
* **역할**: HTML/CSS 및 미디어를 AI 에이전트가 탐색 가능한(Seekable) 무손실 MP4 동영상으로 직접 렌더링.

### 13. 클로드 모션 (Claude Motion Dashboards)
* **출처**: [Claude Dashboards and Motion](https://claude.com/resources/articles/dashboards-and-motion)
* **핵심 지침**:
  - 데이터 갱신 시 숫자의 부드러운 롤링 카운트업 적용.
  - 백드롭 블러(`backdrop-filter: blur(12px)`)와 은은한 앰비언트 글로우로 정보 집중도 강화.

### 14. 어썸 오푸스 5.5 비디오스 (Awesome Opus 5.5 Videos)
* **저장소**: [yihui-dev/awesome-opus5-5-videos](https://github.com/yihui-dev/awesome-opus5-5-videos)
* **역할**: HTML5 Canvas, SVG, Three.js 기반의 수학적 제너레이티브 파형 및 물리 시뮬레이션 코드 프롬프트 아카이브.

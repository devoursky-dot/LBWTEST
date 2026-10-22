/**
 * scrollModule.ts
 * ============================================================================
 * 앱 전역 스크롤 & 터치 & 툴바 오버플로우 문제 해결 모듈
 * 
 * 1. 모달 팝업 내부 인풋 포커스 시 모바일 가상 키보드 가림 방지 자동 스크롤
 * 2. 툴바 및 가로 메뉴가 화면 폭을 초과할 때 마우스 휠 및 터치 제스처 가로 스크롤 연동
 * 3. 팜리젝션(touch-action: none) 환경에서도 모달과 툴바의 터치 스크롤 정상 작동 보장
 * ============================================================================
 */

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * 1. 가상 키보드 대응: 포커스된 입력 필드를 부모 모달 및 뷰포트 중앙으로 부드럽게 정렬
 */
export function ensureInputVisible(element: HTMLElement | null) {
  if (!element) return;
  
  // 가상 키보드가 올라오는 시간(약 300ms)을 감안하여 2회에 걸쳐 보정
  const doScroll = () => {
    try {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      });
    } catch {
      // 구형 브라우저 fallback
      element.scrollIntoView(false);
    }
  };

  setTimeout(doScroll, 100);
  setTimeout(doScroll, 350);
}

/**
 * 2. 전역 모달 입력창 자동 스크롤 등록 (모듈화)
 *    페이지 내에 어떤 모달이 뜨든, .modal-box 또는 .modal-backdrop 내부의
 *    모든 input/textarea가 포커스되면 자동으로 화면 중앙으로 스크롤됨.
 */
let isGlobalModalListenerRegistered = false;

export function initGlobalModalAutoScroll() {
  if (typeof window === 'undefined' || isGlobalModalListenerRegistered) return;

  const handleFocusIn = (e: FocusEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    // 모달 내부의 input, textarea, select 요소인지 확인
    const isInModal = target.closest('.modal-box, .modal-backdrop, .samsung-tool-popup, [data-scrollable-modal]');
    const isInputField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

    if (isInModal && isInputField) {
      ensureInputVisible(target);
    }
  };

  window.addEventListener('focusin', handleFocusIn, { passive: true });
  isGlobalModalListenerRegistered = true;
}

/**
 * 3. 가로 스크롤 컨테이너 바인딩 헬퍼
 *    - 마우스 휠(deltaY)을 좌우 스크롤(scrollLeft)로 자연스럽게 변환
 *    - 드래그 스크롤(터치/마우스) 지원
 */
export function bindHorizontalScroll(element: HTMLElement | null): () => void {
  if (!element) return () => {};

  const handleWheel = (e: WheelEvent) => {
    // 툴바의 가로 스크롤이 가능한 경우에만 가로로 전환
    if (element.scrollWidth > element.clientWidth) {
      // Shift 키를 누르지 않아도 일반 마우스 세로 휠을 가로 스크롤로 매핑
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        element.scrollLeft += e.deltaY;
      }
    }
  };

  element.addEventListener('wheel', handleWheel, { passive: false });

  return () => {
    element.removeEventListener('wheel', handleWheel);
  };
}

/**
 * 4. React 커스텀 훅: 가로 스크롤 툴바용
 *    - 마우스 휠 자동 연동
 *    - 좌/우 스크롤 가능 여부 실시간 감지 (canScrollLeft, canScrollRight)
 *    - 좌/우 원클릭 스크롤 함수 제공 (scrollByAmount)
 */
export function useHorizontalToolbarScroll<T extends HTMLElement = HTMLDivElement>() {
  const containerRef = useRef<T | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 4);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    checkScroll();

    // 1. 마우스 휠 연동
    const unbindWheel = bindHorizontalScroll(el);

    // 2. 스크롤 및 리사이즈 감지
    const handleScroll = () => checkScroll();
    el.addEventListener('scroll', handleScroll, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => checkScroll());
      resizeObserver.observe(el);
      if (el.parentElement) {
        resizeObserver.observe(el.parentElement);
      }
    }

    window.addEventListener('resize', checkScroll, { passive: true });

    return () => {
      unbindWheel();
      el.removeEventListener('scroll', handleScroll);
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', checkScroll);
    };
  }, [checkScroll]);

  const scrollToLeft = useCallback((amount = 180) => {
    if (containerRef.current) {
      containerRef.current.scrollBy({ left: -amount, behavior: 'smooth' });
    }
  }, []);

  const scrollToRight = useCallback((amount = 180) => {
    if (containerRef.current) {
      containerRef.current.scrollBy({ left: amount, behavior: 'smooth' });
    }
  }, []);

  return {
    containerRef,
    canScrollLeft,
    canScrollRight,
    scrollToLeft,
    scrollToRight,
    checkScroll
  };
}

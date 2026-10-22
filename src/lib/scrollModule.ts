/**
 * scrollModule.ts
 * ============================================================================
 * 앱 전역 스크롤 & 터치 & 툴바 오버플로우 문제 해결 모듈
 * 
 * 1. 모달 팝업 내부 인풋 포커스 시 모바일 가상 키보드 가림 방지 자동 스크롤
 * 2. 툴바 및 가로 메뉴가 화면 폭을 초과할 때 마우스 휠 및 터치 제스처 가로 스크롤 연동
 * 3. 태블릿/스마트폰 터치스크린 전용 다이렉트 터치 드래그 스크롤 엔진 (WebKit 버그 완벽 방어)
 * 4. 팜리젝션(touch-action: none) 환경에서도 모달과 툴바의 터치 스크롤 정상 작동 보장
 * ============================================================================
 */

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * 1. 가상 키보드 대응: 포커스된 입력 필드를 부모 모달 및 뷰포트 중앙으로 부드럽게 정렬
 */
export function ensureInputVisible(element: HTMLElement | null) {
  if (!element) return;
  
  const doScroll = () => {
    try {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      });
    } catch {
      element.scrollIntoView(false);
    }
  };

  setTimeout(doScroll, 100);
  setTimeout(doScroll, 350);
}

/**
 * 2. 전역 모달 입력창 자동 스크롤 등록 (모듈화)
 */
let isGlobalModalListenerRegistered = false;

export function initGlobalModalAutoScroll() {
  if (typeof window === 'undefined' || isGlobalModalListenerRegistered) return;

  const handleFocusIn = (e: FocusEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

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
 * 3. 태블릿/터치스크린 전용 다이렉트 터치 제스처 스크롤러 (모듈화)
 * 
 * iOS Safari / Android Chrome 등에서 부모의 touch-action: none이나
 * WebKit의 스크롤 제스처 억제 버그가 발생하더라도,
 * 사용자가 손가락으로 화면을 쓸어올리거나 내리면 100% 확실하게 스크롤을 이동시킵니다.
 */
export function bindDirectTouchScroll(
  element: HTMLElement | null,
  options: { direction: 'y' | 'x' | 'both'; propagate?: boolean } = { direction: 'y' }
): () => void {
  if (!element) return () => {};

  let startX = 0;
  let startY = 0;
  let initialScrollTop = 0;
  let initialScrollLeft = 0;
  let isDragging = false;
  let lastMoveTime = 0;
  let velocityY = 0;
  let velocityX = 0;
  let lastY = 0;
  let lastX = 0;

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    lastX = touch.clientX;
    lastY = touch.clientY;
    initialScrollTop = element.scrollTop;
    initialScrollLeft = element.scrollLeft;
    isDragging = false;
    lastMoveTime = Date.now();
    velocityY = 0;
    velocityX = 0;
  };

  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const diffX = touch.clientX - startX;
    const diffY = touch.clientY - startY;

    // 4px 이상 이동하면 스크롤 제스처로 판정
    if (!isDragging && (Math.hypot(diffX, diffY) > 5)) {
      isDragging = true;
    }

    if (isDragging) {
      const now = Date.now();
      const dt = Math.max(1, now - lastMoveTime);
      const dy = touch.clientY - lastY;
      const dx = touch.clientX - lastX;
      
      velocityY = dy / dt;
      velocityX = dx / dt;
      lastY = touch.clientY;
      lastX = touch.clientX;
      lastMoveTime = now;

      let handled = false;

      if (options.direction === 'y' || options.direction === 'both') {
        const canScrollY = element.scrollHeight > element.clientHeight;
        if (canScrollY) {
          element.scrollTop = initialScrollTop - diffY;
          handled = true;
        }
      }

      if (options.direction === 'x' || options.direction === 'both') {
        const canScrollX = element.scrollWidth > element.clientWidth;
        if (canScrollX) {
          element.scrollLeft = initialScrollLeft - diffX;
          handled = true;
        }
      }

      if (handled && e.cancelable && !options.propagate) {
        // 인풋 필드 텍스트 선택 중이 아닌 경우 기본 제스처 충돌 방지
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
        }
      }
    }
  };

  const onTouchEnd = () => {
    if (isDragging) {
      // 가벼운 관성 스크롤 (Inertia Flick)
      if (Math.abs(velocityY) > 0.3 && (options.direction === 'y' || options.direction === 'both')) {
        const momentum = velocityY * 120;
        element.scrollBy({ top: -momentum, behavior: 'smooth' });
      }
      if (Math.abs(velocityX) > 0.3 && (options.direction === 'x' || options.direction === 'both')) {
        const momentum = velocityX * 120;
        element.scrollBy({ left: -momentum, behavior: 'smooth' });
      }
    }
    isDragging = false;
  };

  element.addEventListener('touchstart', onTouchStart, { passive: true });
  element.addEventListener('touchmove', onTouchMove, { passive: false });
  element.addEventListener('touchend', onTouchEnd, { passive: true });
  element.addEventListener('touchcancel', onTouchEnd, { passive: true });

  return () => {
    element.removeEventListener('touchstart', onTouchStart);
    element.removeEventListener('touchmove', onTouchMove);
    element.removeEventListener('touchend', onTouchEnd);
    element.removeEventListener('touchcancel', onTouchEnd);
  };
}

/**
 * 4. 가로 스크롤 컨테이너 바인딩 헬퍼 (마우스 휠 + 터치 드래그)
 */
export function bindHorizontalScroll(element: HTMLElement | null): () => void {
  if (!element) return () => {};

  const handleWheel = (e: WheelEvent) => {
    if (element.scrollWidth > element.clientWidth) {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        element.scrollLeft += e.deltaY;
      }
    }
  };

  element.addEventListener('wheel', handleWheel, { passive: false });
  const unbindTouch = bindDirectTouchScroll(element, { direction: 'x' });

  return () => {
    element.removeEventListener('wheel', handleWheel);
    unbindTouch();
  };
}

/**
 * 5. React 커스텀 훅: 가로 스크롤 툴바용
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

    // 1. 마우스 휠 및 터치 드래그 연동
    const unbind = bindHorizontalScroll(el);

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
      unbind();
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

/**
 * 6. React 커스텀 훅: 모달 세로 스크롤용 (태블릿 터치 제스처 연동)
 */
export function useModalVerticalScroll<T extends HTMLElement = HTMLDivElement>() {
  const modalBoxRef = useRef<T | null>(null);

  useEffect(() => {
    const el = modalBoxRef.current;
    if (!el) return;

    // 터치 드래그 스크롤 바인딩
    const unbindTouch = bindDirectTouchScroll(el, { direction: 'y' });
    return () => {
      unbindTouch();
    };
  }, []);

  return modalBoxRef;
}

/**
 * 7. 전역 터치 제스처 스크롤 엔진 (모든 모달, 팝업, 툴바에 자동 적용)
 * 
 * 태블릿(iPad Safari, Galaxy Tab Chrome 등)에서 부모 컨테이너의
 * 팜리젝션(touch-action: none) 또는 WebKit의 스크롤 제스처 억제 버그가 발생하더라도,
 * 사용자가 스크롤 가능한 요소(모달 박스, 백드롭, 툴바 등)를 손가락으로 밀었을 때
 * 100% 무조건 스크롤되도록 보장합니다.
 */
let isGlobalTouchScrollRegistered = false;

export function initGlobalTouchScroll() {
  if (typeof window === 'undefined' || isGlobalTouchScrollRegistered) return;

  let activeScrollEl: HTMLElement | null = null;
  let startX = 0;
  let startY = 0;
  let startScrollTop = 0;
  let startScrollLeft = 0;
  let isMoving = false;
  let scrollDir: 'x' | 'y' | 'none' = 'none';

  const findScrollableParent = (target: HTMLElement | null): { el: HTMLElement; canY: boolean; canX: boolean } | null => {
    let curr: HTMLElement | null = target;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      // 드로잉 캔버스 자체는 스크롤 대상에서 제외
      if (curr.classList.contains('student-canvas') || curr.tagName === 'CANVAS') {
        return null;
      }

      // 모달, 툴바, 팝업, 또는 스크롤 컨테이너 감지
      const isModal = curr.classList.contains('modal-box') || curr.classList.contains('modal-backdrop');
      const isToolbar = curr.classList.contains('student-floating-toolbar') || curr.classList.contains('floating-toolbar');
      const isPopup = curr.classList.contains('samsung-tool-popup');

      const style = window.getComputedStyle(curr);
      const overflowY = style.overflowY;
      const overflowX = style.overflowX;

      const canScrollY = (overflowY === 'auto' || overflowY === 'scroll' || isModal || isPopup) && curr.scrollHeight > curr.clientHeight;
      const canScrollX = (overflowX === 'auto' || overflowX === 'scroll' || isToolbar) && curr.scrollWidth > curr.clientWidth;

      if (canScrollY || canScrollX) {
        return { el: curr, canY: canScrollY, canX: canScrollX };
      }

      curr = curr.parentElement;
    }
    return null;
  };

  window.addEventListener('touchstart', (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      activeScrollEl = null;
      return;
    }

    const touch = e.touches[0];
    const target = touch.target as HTMLElement | null;
    const found = findScrollableParent(target);

    if (found) {
      activeScrollEl = found.el;
      startX = touch.clientX;
      startY = touch.clientY;
      startScrollTop = found.el.scrollTop;
      startScrollLeft = found.el.scrollLeft;
      isMoving = false;
      scrollDir = 'none';
    } else {
      activeScrollEl = null;
    }
  }, { passive: true, capture: true });

  window.addEventListener('touchmove', (e: TouchEvent) => {
    if (!activeScrollEl || e.touches.length !== 1) return;

    const touch = e.touches[0];
    const diffX = touch.clientX - startX;
    const diffY = touch.clientY - startY;

    if (!isMoving && Math.hypot(diffX, diffY) > 5) {
      isMoving = true;
      scrollDir = Math.abs(diffY) > Math.abs(diffX) ? 'y' : 'x';
    }

    if (isMoving) {
      if (scrollDir === 'y' && activeScrollEl.scrollHeight > activeScrollEl.clientHeight) {
        activeScrollEl.scrollTop = startScrollTop - diffY;
      } else if (scrollDir === 'x' && activeScrollEl.scrollWidth > activeScrollEl.clientWidth) {
        activeScrollEl.scrollLeft = startScrollLeft - diffX;
      }
    }
  }, { passive: true, capture: true });

  window.addEventListener('touchend', () => {
    activeScrollEl = null;
    isMoving = false;
  }, { passive: true, capture: true });

  isGlobalTouchScrollRegistered = true;
}

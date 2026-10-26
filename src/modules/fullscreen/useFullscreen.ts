/**
 * useFullscreen.ts
 * ============================================================================
 * 모듈화된 표준 전체화면(Fullscreen) 관리 훅
 * 
 * - 강제 복구 인터셉터나 편법 없이 브라우저 표준 Fullscreen API 준수
 * - PWA Standalone 모드에서는 브라우저 주소창이 기본 제거되므로 자동 대응
 * ============================================================================
 */

import { useState, useEffect, useCallback } from 'react';

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false;
    const doc = document as any;
    return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
  });

  const [isSupported] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false;
    const doc = document as any;
    return Boolean(
      doc.fullscreenEnabled ||
      doc.webkitFullscreenEnabled ||
      document.documentElement.requestFullscreen ||
      (document.documentElement as any).webkitRequestFullscreen
    );
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleFsChange = () => {
      const doc = document as any;
      setIsFullscreen(Boolean(doc.fullscreenElement || doc.webkitFullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
    };
  }, []);

  const enterFullscreen = useCallback(async (targetElement?: HTMLElement | null): Promise<boolean> => {
    if (typeof window === 'undefined') return false;
    const doc = document as any;
    if (doc.fullscreenElement || doc.webkitFullscreenElement) return true;

    const el = (targetElement || document.documentElement) as any;
    try {
      if (typeof el.requestFullscreen === 'function') {
        await el.requestFullscreen();
        return true;
      } else if (typeof el.webkitRequestFullscreen === 'function') {
        el.webkitRequestFullscreen();
        return true;
      }
    } catch (err) {
      console.warn('[Fullscreen] 진입 실패:', err);
    }
    return false;
  }, []);

  const exitFullscreen = useCallback(async (): Promise<boolean> => {
    if (typeof window === 'undefined') return false;
    const doc = document as any;
    if (!doc.fullscreenElement && !doc.webkitFullscreenElement) return true;

    try {
      if (typeof doc.exitFullscreen === 'function') {
        await doc.exitFullscreen();
        return true;
      } else if (typeof doc.webkitExitFullscreen === 'function') {
        doc.webkitExitFullscreen();
        return true;
      }
    } catch (err) {
      console.warn('[Fullscreen] 해제 실패:', err);
    }
    return false;
  }, []);

  const toggleFullscreen = useCallback(async (): Promise<boolean> => {
    if (isFullscreen) {
      return await exitFullscreen();
    } else {
      return await enterFullscreen();
    }
  }, [isFullscreen, enterFullscreen, exitFullscreen]);

  return {
    isFullscreen,
    isSupported,
    enterFullscreen,
    exitFullscreen,
    toggleFullscreen
  };
}

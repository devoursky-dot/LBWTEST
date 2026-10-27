/**
 * usePwaInstall.ts
 * ============================================================================
 * PWA 설치 상태 감지 및 원클릭 설치 훅
 * - 이미 앱으로 설치되어 실행 중(Standalone/Fullscreen/Minimal-ui)일 때는 완전히 숨김
 * - 일반 웹 브라우저에서 실행 중일 때만 설치 버튼 노출
 * ============================================================================
 */

import { useState, useEffect, useCallback } from 'react';

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      (navigator as any).standalone === true ||
      document.referrer.includes('android-app://') ||
      window.location.search.includes('source=pwa') ||
      window.location.search.includes('mode=app')
    );
  });
  const [isIos, setIsIos] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // iOS 사파리 감지
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIos(isIosDevice);

    // Standalone 변경 감지 (미디어 쿼리 리스너)
    const mediaQueryStandalone = window.matchMedia('(display-mode: standalone)');
    const mediaQueryFullscreen = window.matchMedia('(display-mode: fullscreen)');
    const handleDisplayChange = () => {
      setIsStandalone(
        mediaQueryStandalone.matches ||
        mediaQueryFullscreen.matches ||
        (navigator as any).standalone === true
      );
    };
    mediaQueryStandalone.addEventListener('change', handleDisplayChange);
    mediaQueryFullscreen.addEventListener('change', handleDisplayChange);

    // Chrome, Android, Edge 전용 beforeinstallprompt 이벤트 캡처
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // 앱이 성공적으로 설치되었을 때
    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
      console.log('[PWA] 학생필기앱이 성공적으로 태블릿에 설치되었습니다.');
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      mediaQueryStandalone.removeEventListener('change', handleDisplayChange);
      mediaQueryFullscreen.removeEventListener('change', handleDisplayChange);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const canInstall = Boolean(deferredPrompt) || isIos;

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    try {
      deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        setDeferredPrompt(null);
        return true;
      }
    } catch (err) {
      console.warn('[PWA] 설치 프롬프트 오류:', err);
    }
    return false;
  }, [deferredPrompt]);

  return {
    isStandalone,
    canInstall,
    isIos,
    promptInstall
  };
}

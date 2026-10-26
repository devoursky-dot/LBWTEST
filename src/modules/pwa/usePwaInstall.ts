/**
 * usePwaInstall.ts
 * ============================================================================
 * PWA 설치 상태 감지 및 원클릭 설치 훅
 * ============================================================================
 */

import { useState, useEffect, useCallback } from 'react';

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true ||
      document.referrer.includes('android-app://')
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
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayChange = (e: MediaQueryListEvent) => {
      setIsStandalone(e.matches);
    };
    mediaQuery.addEventListener('change', handleDisplayChange);

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
      mediaQuery.removeEventListener('change', handleDisplayChange);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false;

    try {
      deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        console.log('[PWA] 사용자가 앱 설치를 수락했습니다.');
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
    canInstall: Boolean(deferredPrompt) || (isIos && !isStandalone),
    isIos,
    promptInstall
  };
}

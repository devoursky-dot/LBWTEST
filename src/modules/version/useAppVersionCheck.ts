/**
 * useAppVersionCheck.ts
 * ============================================================================
 * 앱 실행 시 및 구동 중 최신 배포 버전 상시 자동 검사 및 강제 업데이트 훅
 * - 마운트 시 즉시 검사
 * - 3분 주기 백그라운드 폴링 검사
 * - 탭 복귀(visibilitychange) 및 네트워크 연결(online) 시 즉시 검사
 * ============================================================================
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getLocalVersionInfo,
  fetchServerVersionInfo,
  isNewerVersion,
  forceApplyAppUpdate,
  type VersionInfo
} from './versionManager';

export function useAppVersionCheck(options?: {
  autoCheckOnMount?: boolean;
  onToast?: (msg: string) => void;
}) {
  const autoCheck = options?.autoCheckOnMount ?? true;
  const [localVersion] = useState<VersionInfo>(() => getLocalVersionInfo());
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [newVersionInfo, setNewVersionInfo] = useState<VersionInfo | null>(null);
  const isCheckingRef = useRef<boolean>(false);

  const checkVersion = useCallback(async (isManual = false) => {
    if (isCheckingRef.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (isManual && options?.onToast) {
        options.onToast('📡 오프라인 상태이므로 버전 확인을 건너뜁니다.');
      }
      return;
    }

    isCheckingRef.current = true;
    try {
      const serverInfo = await fetchServerVersionInfo();
      if (!serverInfo) {
        if (isManual && options?.onToast) {
          options.onToast('⚠️ 서버 버전 정보를 가져올 수 없습니다.');
        }
        return;
      }

      if (isNewerVersion(serverInfo, localVersion, isManual)) {
        console.log(`[VersionCheck] 새 버전 감지: ${serverInfo.version} (${serverInfo.buildTime}) -> 최신 버전으로 자동 업데이트를 실행합니다.`);
        setNewVersionInfo(serverInfo);
        setIsUpdating(true);

        // 오버레이 표시 후 캐시 완전 청소 및 최신 번들 강제 리로드
        setTimeout(async () => {
          await forceApplyAppUpdate(serverInfo.version);
        }, 1200);
      } else {
        if (isManual && options?.onToast) {
          options.onToast(`✨ 현재 최신 버전입니다. (${localVersion.buildTime})`);
        }
      }
    } catch (err) {
      console.warn('[VersionCheck] 버전 검사 오류:', err);
    } finally {
      isCheckingRef.current = false;
    }
  }, [localVersion, options]);

  useEffect(() => {
    if (!autoCheck) return;

    // 1. 앱 구동 즉시 최초 버전 검사 (최신 버전 보장)
    const initTimer = setTimeout(() => {
      checkVersion(false);
    }, 50);

    // 2. 3분(180초) 주기 상시 백그라운드 버전 검사
    const intervalTimer = setInterval(() => {
      checkVersion(false);
    }, 180000);

    // 3. 브라우저 탭/화면 다시 활성화 시 즉시 검사
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkVersion(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 4. 네트워크 오프라인 -> 온라인 복귀 시 즉시 검사
    const handleOnline = () => {
      checkVersion(false);
    };
    window.addEventListener('online', handleOnline);

    return () => {
      clearTimeout(initTimer);
      clearInterval(intervalTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [autoCheck, checkVersion]);

  return {
    localVersion,
    isUpdating,
    newVersionInfo,
    checkVersion
  };
}

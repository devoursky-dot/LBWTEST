/**
 * useAppVersionCheck.ts
 * ============================================================================
 * 앱 실행 시 최신 배포 버전 자동 검사 및 강제 업데이트 훅
 * ============================================================================
 */

import { useState, useEffect, useCallback } from 'react';
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

  const checkVersion = useCallback(async (isManual = false) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (isManual && options?.onToast) {
        options.onToast('📡 오프라인 상태이므로 버전 확인을 건너뜁니다.');
      }
      return;
    }

    try {
      const serverInfo = await fetchServerVersionInfo();
      if (!serverInfo) {
        if (isManual && options?.onToast) {
          options.onToast('⚠️ 서버 버전 정보를 가져올 수 없습니다.');
        }
        return;
      }

      if (isNewerVersion(serverInfo, localVersion, isManual)) {
        console.log(`[VersionCheck] 새 버전 감지: ${serverInfo.version} (${serverInfo.buildTime}) -> 최신 버전으로 강제 업데이트를 실행합니다.`);
        setNewVersionInfo(serverInfo);
        setIsUpdating(true);

        // 오버레이 표시 후 1.2초 뒤 캐시 삭제 및 강제 새로고침
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
    }
  }, [localVersion, options]);

  useEffect(() => {
    if (autoCheck) {
      // 앱 구동 1.5초 후 백그라운드 버전 검사
      const timer = setTimeout(() => {
        checkVersion(false);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [autoCheck, checkVersion]);

  return {
    localVersion,
    isUpdating,
    newVersionInfo,
    checkVersion
  };
}

/**
 * versionManager.ts
 * ============================================================================
 * 앱 버전 관리 및 최신 버전 감지/강제 업데이트 엔진
 * ============================================================================
 */

export interface VersionInfo {
  version: string;     // 예: "2026.10.26.1030"
  buildTime: string;   // 예: "2026-10-26 10:30"
  timestamp: number;   // ms timestamp
}

// 빌드 시점에 Vite define에 의해 주입되는 상수
declare const __APP_BUILD_INFO__: VersionInfo | undefined;

const FALLBACK_VERSION: VersionInfo = {
  version: '2026.10.26.1030',
  buildTime: '2026-10-26 10:30',
  timestamp: 1792978200000
};

/**
 * 1. 현재 실행 중인 앱의 로컬 번들 버전 조회
 */
export function getLocalVersionInfo(): VersionInfo {
  try {
    if (typeof __APP_BUILD_INFO__ !== 'undefined' && __APP_BUILD_INFO__.buildTime) {
      return __APP_BUILD_INFO__;
    }
  } catch {}
  return FALLBACK_VERSION;
}

/**
 * 2. 원격 서버(GitHub Pages/Vercel)의 최신 배포 버전 확인
 */
export async function fetchServerVersionInfo(): Promise<VersionInfo | null> {
  if (typeof window === 'undefined') return null;

  try {
    // 브라우저 캐시를 무력화하기 위해 고유 타임스탬프 쿼리 및 no-store 헤더 전달
    const res = await fetch(`./version.json?_t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });

    if (res.ok) {
      const data: VersionInfo = await res.json();
      if (data && data.version && data.buildTime) {
        return data;
      }
    }
  } catch (err) {
    console.warn('[VersionManager] 서버 버전 조회 실패 (오프라인 상태 등):', err);
  }
  return null;
}

/**
 * 3. 새 버전이 있는지 비교
 */
export function isNewerVersion(serverInfo: VersionInfo, localInfo: VersionInfo, forceCheck = false): boolean {
  // 개발 환경(Vite Dev Server)에서는 자동 강제 리로드 방지 (수동 확인 제외)
  if (!forceCheck && typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
    return false;
  }

  // 무한 리로드 방지: 이미 같은 새 버전으로 리로드를 시도한 직후라면 중복 리로드 차단
  if (typeof sessionStorage !== 'undefined') {
    const lastAttempt = sessionStorage.getItem('last_forced_reload_version');
    if (lastAttempt === serverInfo.version) {
      return false;
    }
  }

  // 타임스탬프 기준 비교 (서버가 5초 이상 최신인 경우)
  if (serverInfo.timestamp && localInfo.timestamp) {
    return serverInfo.timestamp > (localInfo.timestamp + 5000);
  }
  // 문자열 빌드 버전 기준 비교
  return serverInfo.version !== localInfo.version;
}

/**
 * 4. 브라우저 캐시를 완전히 청소하고 최신 버전으로 강제 리로드(업데이트)
 */
export async function forceApplyAppUpdate(targetVersion?: string): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    if (targetVersion && typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('last_forced_reload_version', targetVersion);
    }

    // 1. 모든 브라우저 Cache Storage 청소
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      console.log('[VersionManager] 브라우저 캐시 스토리지 전체 삭제 완료.');
    }

    // 2. 서비스 워커 강제 갱신/해제
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.update().catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[VersionManager] 캐시 청소 중 경미한 예외:', err);
  }

  // 3. 브라우저 강제 새로고침
  window.location.reload();
}


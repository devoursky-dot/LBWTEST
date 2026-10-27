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
  version: '0.0.0',
  buildTime: '초기화 대기중',
  timestamp: 0
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
    // 상대 경로 및 절대 경로 모두 지원
    const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/');
    const versionUrl = `${baseUrl}version.json?_t=${Date.now()}`;
    const res = await fetch(versionUrl, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
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
  if (!serverInfo || !serverInfo.version) return false;

  // 개발 환경(Vite Dev Server)에서는 자동 강제 리로드 방지 (수동 확인 제외)
  if (!forceCheck && typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
    return false;
  }

  // 무한 리로드 방지: 동일 버전에 대해 최근 15초 이내에 이미 업데이트 리로드를 실행한 경우만 일시 대기
  if (typeof sessionStorage !== 'undefined') {
    const lastAttemptTime = Number(sessionStorage.getItem(`last_update_reload_${serverInfo.version}`) || '0');
    if (Date.now() - lastAttemptTime < 15000) {
      return false;
    }
  }

  // 1. 버전 문자열이 다르면 즉시 새 버전으로 판정
  if (localInfo.version && serverInfo.version !== localInfo.version) {
    return true;
  }

  // 2. 타임스탬프 기준 비교 (서버가 3초 이상 최신인 경우)
  if (serverInfo.timestamp && localInfo.timestamp) {
    return serverInfo.timestamp > (localInfo.timestamp + 3000);
  }

  return false;
}

/**
 * 4. 브라우저 캐시를 완전히 청소하고 최신 버전으로 강제 리로드(업데이트)
 */
export async function forceApplyAppUpdate(targetVersion?: string): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    if (targetVersion && typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(`last_update_reload_${targetVersion}`, String(Date.now()));
    }

    // 1. 모든 브라우저 Cache Storage 청소
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      console.log('[VersionManager] 브라우저 캐시 스토리지 전체 삭제 완료.');
    }

    // 2. 서비스 워커 등록 해제 및 최신 업데이트
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister().catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[VersionManager] 캐시 청소 중 경미한 예외:', err);
  }

  // 3. 브라우저 강제 새로고침 (URL에 고유 타임스탬프 쿼리를 추가하여 브라우저/CDN의 index.html HTTP 캐시를 100% 원천 무력화)
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('_v', String(Date.now()));
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
}


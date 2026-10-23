/**
 * offlineSync.ts
 * ============================================================================
 * 오프라인 상태 감지 및 자동 백그라운드 동기화(Auto-Sync Engine)
 * 
 * - window.navigator.onLine 및 온라인/오프라인 이벤트 자동 감지
 * - 네트워크가 복구되는 즉시 IndexedDB 대기열(Outbox)의 미제출 과제를 백그라운드 자동 전송
 * - React 컴포넌트(OfflineStatusBadge 등)에 실시간 상태 알림 구독 지원
 * ============================================================================
 */

import {
  getPendingSubmissions,
  removePendingSubmission,
  incrementSubmissionRetry,
  type PendingSubmission
} from './offlineStorage';

export interface SyncStatus {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  lastSyncedAt: number | null;
}

type StatusListener = (status: SyncStatus) => void;
type SubmitHandler = (item: PendingSubmission) => Promise<boolean>;

let listeners: StatusListener[] = [];
let registeredSubmitHandler: SubmitHandler | null = null;
let isCurrentlySyncing = false;
let lastSyncedTime: number | null = null;
let currentPendingCount = 0;

function notifyListeners() {
  const currentStatus: SyncStatus = {
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    pendingCount: currentPendingCount,
    isSyncing: isCurrentlySyncing,
    lastSyncedAt: lastSyncedTime
  };
  for (const listener of listeners) {
    try {
      listener(currentStatus);
    } catch (err) {
      console.error('[OfflineSync] 리스너 호출 오류:', err);
    }
  }
}

/**
 * 대기열 건수 갱신
 */
export async function refreshPendingCount(): Promise<number> {
  try {
    const items = await getPendingSubmissions();
    currentPendingCount = items.length;
    notifyListeners();
    return currentPendingCount;
  } catch {
    return 0;
  }
}

/**
 * 대기열에 쌓인 항목들을 순차적으로 서버에 전송
 */
export async function flushPendingSubmissions(): Promise<{ succeeded: number; failed: number }> {
  if (isCurrentlySyncing) return { succeeded: 0, failed: 0 };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await refreshPendingCount();
    return { succeeded: 0, failed: 0 };
  }
  if (!registeredSubmitHandler) {
    console.warn('[OfflineSync] 등록된 서버 전송 핸들러(SubmitHandler)가 없습니다.');
    return { succeeded: 0, failed: 0 };
  }

  isCurrentlySyncing = true;
  notifyListeners();

  let succeeded = 0;
  let failed = 0;

  try {
    const queue = await getPendingSubmissions();
    currentPendingCount = queue.length;

    for (const item of queue) {
      try {
        const success = await registeredSubmitHandler(item);
        if (success) {
          await removePendingSubmission(item.id);
          succeeded++;
          currentPendingCount = Math.max(0, currentPendingCount - 1);
          notifyListeners();
        } else {
          await incrementSubmissionRetry(item.id);
          failed++;
        }
      } catch (err) {
        console.warn(`[OfflineSync] 항목 전송 실패 (ID: ${item.id}):`, err);
        await incrementSubmissionRetry(item.id);
        failed++;
      }
    }

    if (succeeded > 0) {
      lastSyncedTime = Date.now();
    }
  } finally {
    isCurrentlySyncing = false;
    await refreshPendingCount();
  }

  return { succeeded, failed };
}

/**
 * 오프라인 동기화 엔진 초기화
 * 
 * @param submitHandler 서버로 실제 제출을 수행하는 비동기 함수 (성공 시 true 반환)
 */
export function initOfflineSync(submitHandler: SubmitHandler): () => void {
  registeredSubmitHandler = submitHandler;

  const handleOnline = () => {
    console.log('[OfflineSync] 🌐 인터넷 연결 감지: 대기열 자동 동기화를 시작합니다.');
    notifyListeners();
    // 연결 안정화를 위해 1초 후 플러시
    setTimeout(() => {
      flushPendingSubmissions();
    }, 1000);
  };

  const handleOffline = () => {
    console.log('[OfflineSync] 📡 네트워크 끊김: 오프라인 모드로 전환되었습니다.');
    notifyListeners();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  }

  // 초기 로드 시 대기열 검사 및 동기화 시도
  refreshPendingCount().then((count) => {
    if (count > 0 && typeof navigator !== 'undefined' && navigator.onLine) {
      flushPendingSubmissions();
    }
  });

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    }
  };
}

/**
 * 상태 변화 실시간 구독
 */
export function subscribeOfflineStatus(listener: StatusListener): () => void {
  listeners.push(listener);
  // 구독 즉시 현재 상태 1회 전달
  listener({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    pendingCount: currentPendingCount,
    isSyncing: isCurrentlySyncing,
    lastSyncedAt: lastSyncedTime
  });

  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
}

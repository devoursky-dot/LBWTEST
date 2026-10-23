/**
 * offlineStorage.ts
 * ============================================================================
 * IndexedDB 기반 고성능 로컬 저장소 모듈
 * 
 * - 브라우저 localStorage의 5MB 용량 한계를 극복하여 대용량 PDF 및 수십 페이지 필기 스트로크 저장
 * - 오프라인 제출 대기열(Outbox Queue) 영구 보관
 * ============================================================================
 */

const DB_NAME = 'LBW_OFFLINE_DB';
const DB_VERSION = 1;
const STORE_DRAFTS = 'notebook_drafts';
const STORE_OUTBOX = 'submission_outbox';

export interface PendingSubmission {
  id: string; // 고유 ID (timestamp-random)
  lessonId: string;
  studentId: string;
  studentName: string;
  classNumber?: string;
  payload: any; // 전송할 수업 데이터 원본 (스냅샷, 스트로크, 페이지 정보 등)
  queuedAt: number; // 큐에 담긴 시각 (ms)
  retryCount: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.reject(new Error('IndexedDB is not supported in this environment.'));
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event: any) => {
        const db = event.target.result as IDBDatabase;
        if (!db.objectStoreNames.contains(STORE_DRAFTS)) {
          db.createObjectStore(STORE_DRAFTS, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
          const outboxStore = db.createObjectStore(STORE_OUTBOX, { keyPath: 'id' });
          outboxStore.createIndex('by_queuedAt', 'queuedAt', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
  }

  return dbPromise;
}

/**
 * 1. 학생 공책 임시 저장 (자동 저장 및 로컬 복구용)
 */
export async function saveOfflineNotebookDraft(
  lessonId: string,
  studentId: string,
  data: any
): Promise<void> {
  try {
    const db = await getDB();
    const key = `${lessonId}_${studentId}`;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DRAFTS, 'readwrite');
      const store = tx.objectStore(STORE_DRAFTS);
      const record = {
        key,
        lessonId,
        studentId,
        data,
        updatedAt: Date.now()
      };
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[OfflineStorage] 임시 저장 실패:', err);
  }
}

/**
 * 2. 학생 공책 임시 저장본 불러오기
 */
export async function getOfflineNotebookDraft(
  lessonId: string,
  studentId: string
): Promise<any | null> {
  try {
    const db = await getDB();
    const key = `${lessonId}_${studentId}`;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DRAFTS, 'readonly');
      const store = tx.objectStore(STORE_DRAFTS);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.data : null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[OfflineStorage] 임시 저장본 조회 실패:', err);
    return null;
  }
}

/**
 * 3. 오프라인 제출 큐(Outbox)에 대기열 추가
 */
export async function enqueuePendingSubmission(
  submission: Omit<PendingSubmission, 'id' | 'queuedAt' | 'retryCount'>
): Promise<PendingSubmission> {
  const db = await getDB();
  const fullItem: PendingSubmission = {
    ...submission,
    id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    queuedAt: Date.now(),
    retryCount: 0
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    const store = tx.objectStore(STORE_OUTBOX);
    const req = store.put(fullItem);
    req.onsuccess = () => resolve(fullItem);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 4. 대기열에 쌓인 모든 미전송 제출 목록 조회
 */
export async function getPendingSubmissions(): Promise<PendingSubmission[]> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_OUTBOX, 'readonly');
      const store = tx.objectStore(STORE_OUTBOX);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = (req.result || []) as PendingSubmission[];
        items.sort((a, b) => a.queuedAt - b.queuedAt);
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[OfflineStorage] 대기열 목록 조회 실패:', err);
    return [];
  }
}

/**
 * 5. 전송 완료된 대기열 항목 삭제
 */
export async function removePendingSubmission(id: string): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_OUTBOX, 'readwrite');
      const store = tx.objectStore(STORE_OUTBOX);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[OfflineStorage] 대기열 항목 삭제 실패:', err);
  }
}

/**
 * 6. 재시도 횟수 증가
 */
export async function incrementSubmissionRetry(id: string): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    const store = tx.objectStore(STORE_OUTBOX);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      if (getReq.result) {
        const updated = { ...getReq.result, retryCount: (getReq.result.retryCount || 0) + 1 };
        store.put(updated);
      }
    };
  } catch (err) {
    console.warn('[OfflineStorage] 재시도 횟수 업데이트 실패:', err);
  }
}

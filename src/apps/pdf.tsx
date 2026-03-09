import { useEffect, useState, type ChangeEvent } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// PDF.js 워커 설정 (호환성을 위해 CDN 사용, 버전 자동 감지 또는 고정)
const pdfVersion = pdfjsLib.version || '2.16.105';
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfVersion}/pdf.worker.min.js`;

// --- IndexedDB 유틸리티 (브라우저 내부 저장소) ---
const DB_NAME = 'PDF_CACHE_DB';
const STORE_NAME = 'pages';
const DB_VERSION = 1;

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // fileId + pageIndex를 키로 사용
        db.createObjectStore(STORE_NAME, { keyPath: ['fileId', 'pageIndex'] });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const savePageToCache = async (fileId: string, pageIndex: number, blob: Blob) => {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({ fileId, pageIndex, blob, timestamp: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const getPageFromCache = async (fileId: string, pageIndex: number): Promise<Blob | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get([fileId, pageIndex]);
    request.onsuccess = () => resolve(request.result ? request.result.blob : null);
    request.onerror = () => reject(request.error);
  });
};

const checkCacheExists = async (fileId: string, totalPages: number): Promise<boolean> => {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    // 첫 페이지와 마지막 페이지가 있는지 확인하여 캐시 여부 판단 (단순화된 로직)
    const req1 = store.get([fileId, 1]);
    req1.onsuccess = () => {
      if (!req1.result) return resolve(false);
      const req2 = store.get([fileId, totalPages]);
      req2.onsuccess = () => resolve(!!req2.result);
    };
  });
};

const Whiteboard = () => {
  const [currentImageSrc, setCurrentImageSrc] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<string>('');
  const [currentFileId, setCurrentFileId] = useState<string>('');
  const [scale, setScale] = useState<number>(1.0);

  // 페이지 변경 시 이미지 로드
  useEffect(() => {
    if (currentFileId && totalPages > 0) {
      loadPageImage(currentFileId, currentPage);
    }
    setScale(1.0); // 페이지 변경 시 배율 초기화
  }, [currentPage, currentFileId]);

  // PDF 파일 선택 핸들러
  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    // 파일 고유 ID 생성 (이름 + 크기 + 수정일)
    const fileId = `${file.name}_${file.size}_${file.lastModified}`;
    setCurrentFileId(fileId);
    setIsLoading(true);
    setProgress('파일 분석 중...');

    try {
      // 구형 환경 호환성을 위해 무조건 FileReader 사용
      const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (reader.result) {
            resolve(reader.result as ArrayBuffer);
          } else {
            reject(new Error("파일을 읽을 수 없습니다."));
          }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      });

      const loadingTask = pdfjsLib.getDocument({ 
        data: arrayBuffer,
        cMapUrl: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfVersion}/cmaps/`,
        cMapPacked: true,
      });
      const doc = await loadingTask.promise;
      const pages = doc.numPages;
      setTotalPages(pages);

      // 캐시 확인
      const isCached = await checkCacheExists(fileId, pages);

      if (isCached) {
        setProgress('캐시된 데이터 로드 중...');
        setIsLoading(false);
        setCurrentPage(1);
        loadPageImage(fileId, 1);
      } else {
        // 캐시 생성 프로세스 시작
        await generateCache(doc, fileId, pages);
      }

    } catch (error) {
      console.error("PDF 로드 실패:", error);
      alert(`PDF 파일을 로드하는데 실패했습니다.\n${error instanceof Error ? error.message : String(error)}`);
      setIsLoading(false);
    }
  };

  // 고화질 이미지 생성 및 캐싱 (최초 1회)
  const generateCache = async (doc: any, fileId: string, total: number) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    for (let i = 1; i <= total; i++) {
      setProgress(`고화질 변환 중... (${i}/${total})`);
      
      try {
        const page = await doc.getPage(i);
        // 고화질을 위해 스케일 2.0 설정 (전자칠판 해상도 대응)
        const viewport = page.getViewport({ scale: 2.0 });
        
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
          canvasContext: ctx,
          viewport: viewport
        }).promise;

        // 캔버스를 Blob(이미지)으로 변환하여 저장
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
        
        if (blob) {
          await savePageToCache(fileId, i, blob);
        }
      } catch (err) {
        console.error(`페이지 ${i} 변환 실패`, err);
      }
    }

    setIsLoading(false);
    setCurrentPage(1);
    loadPageImage(fileId, 1);
  };

  // 캐시된 이미지 불러오기 (빠른 로딩)
  const loadPageImage = async (fileId: string, pageNum: number) => {
    try {
      const blob = await getPageFromCache(fileId, pageNum);
      if (blob) {
        const url = URL.createObjectURL(blob);
        setCurrentImageSrc(url);
        // 이전 URL 해제 (메모리 누수 방지)
        return () => URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error("이미지 로드 실패:", error);
    }
  };

  // 확대/축소 핸들러
  const handleZoomIn = () => {
    setScale(prev => Math.min(prev + 0.25, 3.0)); // 최대 3배
  };
  const handleZoomOut = () => {
    setScale(prev => Math.max(prev - 0.25, 1.0)); // 최소 1배 (기본)
  };

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative', backgroundColor: '#f5f5f5', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', touchAction: 'none' }}>
      
      {/* 툴바 영역 (상단 플로팅) */}
      <div style={{ 
        position: 'absolute', 
        top: 10, 
        zIndex: 100, 
        backgroundColor: 'rgba(255, 255, 255, 0.9)', 
        padding: '10px 20px', 
        borderRadius: '30px', 
        boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
        display: 'flex', 
        gap: '15px', 
        alignItems: 'center',
        backdropFilter: 'blur(5px)'
      }}>
        <span style={{ fontWeight: 'bold', marginRight: '10px' }}>PDF 고속 뷰어</span>
        <input type="file" accept=".pdf" onChange={handleFileChange} />
        
        {totalPages > 0 && !isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}>이전</button>
            <span>{currentPage} / {totalPages}</span>
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}>다음</button>
          </div>
        )}

        {/* 확대/축소 버튼 */}
        {currentImageSrc && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginLeft: '10px', borderLeft: '1px solid #ccc', paddingLeft: '10px' }}>
            <button onClick={handleZoomOut} disabled={scale <= 1.0}>-</button>
            <span style={{ minWidth: '40px', textAlign: 'center' }}>{Math.round(scale * 100)}%</span>
            <button onClick={handleZoomIn} disabled={scale >= 3.0}>+</button>
          </div>
        )}
      </div>

      {/* 로딩 인디케이터 */}
      {isLoading && (
        <div style={{ position: 'absolute', zIndex: 50, backgroundColor: 'rgba(0,0,0,0.7)', color: 'white', padding: '20px', borderRadius: '10px' }}>
          {progress}
        </div>
      )}

      {/* 이미지 뷰어 컨테이너 */}
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
        {currentImageSrc ? (
          <img 
            src={currentImageSrc} 
            alt={`Page ${currentPage}`} 
            style={{ 
              maxWidth: scale === 1 ? '100%' : 'none', 
              maxHeight: scale === 1 ? '100%' : 'none', 
              width: scale === 1 ? 'auto' : `${scale * 100}%`, // 확대 시 너비 강제 조정
              objectFit: 'contain', 
              boxShadow: '0 0 20px rgba(0,0,0,0.1)' 
            }} 
          />
        ) : (
          <div style={{ color: '#999' }}>PDF 파일을 선택해주세요 (최초 1회 변환 과정이 필요합니다)</div>
        )}
      </div>
    </div>
  );
};

export default Whiteboard;
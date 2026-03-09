import { useEffect, useState, useRef, type ChangeEvent } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// 1. 저사양 기기용 워커 설정 (CDN 버전 일치)
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js`;

const DB_NAME = 'PDF_CACHE_DB';
const STORE_NAME = 'pages';

const Whiteboard = () => {
  // --- 상태 관리 ---
  const [currentImageSrc, setCurrentImageSrc] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<string>('');
  const [currentFileId, setCurrentFileId] = useState<string>('');

  // --- Canvas Ref (판서용) ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const isDrawing = useRef(false);
  const prevUrlRef = useRef<string | null>(null);

  // 2. 판서 캔버스 초기화 (화면 크기에 맞춤)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // 부모 컨테이너 크기에 맞게 설정
    canvas.width = canvas.parentElement?.clientWidth || window.innerWidth;
    canvas.height = canvas.parentElement?.clientHeight || window.innerHeight;

    const ctx = canvas.getContext('2d', { desynchronized: true }); // 저지연 옵션
    if (ctx) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#ff0000"; // 판서 색상 (빨강)
      ctx.lineWidth = 3;
      contextRef.current = ctx;
    }
  }, [currentImageSrc]); // 이미지가 로드될 때마다 캔버스 크기 재조정

  // 3. IndexedDB 초기화
  const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = (e: any) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: ['fileId', 'pageIndex'] });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };

  // 4. 메모리 해제 및 이미지 로드
  const loadPageImage = async (fileId: string, pageNum: number) => {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get([fileId, pageNum]);

    request.onsuccess = () => {
      if (request.result) {
        if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
        const url = URL.createObjectURL(request.result.blob);
        setCurrentImageSrc(url);
        prevUrlRef.current = url;
      }
    };
  };

  useEffect(() => {
    if (currentFileId && totalPages > 0) loadPageImage(currentFileId, currentPage);
  }, [currentPage, currentFileId]);

  // 5. PDF 처리 및 캐싱 (최적화 버전)
  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileId = `${file.name}_${file.size}_${file.lastModified}`;
    setCurrentFileId(fileId);
    setIsLoading(true);
    setProgress('PDF 로드 중...');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      setTotalPages(doc.numPages);

      const cacheCanvas = document.createElement('canvas');
      const cacheCtx = cacheCanvas.getContext('2d');

      for (let i = 1; i <= doc.numPages; i++) {
        setProgress(`페이지 변환 중... (${i}/${doc.numPages})`);
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 }); // 8GB 램 권장 사양
        
        cacheCanvas.width = viewport.width;
        cacheCanvas.height = viewport.height;

        await page.render({ canvasContext: cacheCtx!, viewport }).promise;
        const blob = await new Promise<Blob | null>(res => cacheCanvas.toBlob(res, 'image/jpeg', 0.8));

        if (blob) {
          const db = await openDB();
          const tx = db.transaction(STORE_NAME, 'readwrite');
          await tx.objectStore(STORE_NAME).put({ fileId, pageIndex: i, blob });
        }
        if (i === 1) loadPageImage(fileId, 1);
      }
      setIsLoading(false);
    } catch (err) {
      alert("PDF 처리에 실패했습니다.");
      setIsLoading(false);
    }
  };

  // 6. 판서 로직 (고성능 직접 제어)
  const getPos = (e: any) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const onStart = (e: any) => {
    isDrawing.current = true;
    const { x, y } = getPos(e);
    contextRef.current?.beginPath();
    contextRef.current?.moveTo(x, y);
  };

  const onDraw = (e: any) => {
    if (!isDrawing.current) return;
    const { x, y } = getPos(e);
    contextRef.current?.lineTo(x, y);
    contextRef.current?.stroke();
  };

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#222', overflow: 'hidden' }}>
      {/* 상단바 */}
      <div style={{ padding: '10px', background: '#fff', display: 'flex', gap: '15px', alignItems: 'center', zIndex: 10 }}>
        <input type="file" accept=".pdf" onChange={handleFileChange} />
        {totalPages > 0 && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>이전</button>
            <span style={{ fontWeight: 'bold' }}>{currentPage} / {totalPages}</span>
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>다음</button>
            <button onClick={() => contextRef.current?.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height)} style={{ marginLeft: '20px', color: 'red' }}>판서 모두 지우기</button>
          </div>
        )}
      </div>

      {/* 메인 뷰어 영역 */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'auto' }}>
        {isLoading && <div style={{ position: 'absolute', background: 'rgba(0,0,0,0.8)', color: '#fff', padding: '20px', borderRadius: '10px', zIndex: 20 }}>{progress}</div>}
        
        <div style={{ position: 'relative', boxShadow: '0 0 20px rgba(0,0,0,0.5)' }}>
          {/* PDF 이미지 층 */}
          {currentImageSrc && (
            <img src={currentImageSrc} alt="pdf page" style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
          )}
          {/* 판서 캔버스 층 (이미지 위에 겹침) */}
          <canvas
            ref={canvasRef}
            onMouseDown={onStart}
            onMouseMove={onDraw}
            onMouseUp={() => isDrawing.current = false}
            onTouchStart={onStart}
            onTouchMove={onDraw}
            onTouchEnd={() => isDrawing.current = false}
            style={{ position: 'absolute', top: 0, left: 0, touchAction: 'none', cursor: 'crosshair' }}
          />
        </div>
      </div>
    </div>
  );
};

export default Whiteboard;
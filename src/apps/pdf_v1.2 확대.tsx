{/*
# 기존 패키지 삭제
npm uninstall pdfjs-dist

# 저사양 기기용 안정 버전 설치
npm install pdfjs-dist@2.16.105

버전을 반드시 맞추고 실행해야한다는 것을 항상 체크해주세요
*/}


import React, { useState, useCallback, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";

// [최적화] 전자칠판 안드로이드 11 호환용 워커 설정
const PDFJS_VERSION = '2.16.105';
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;

// --- IndexedDB 유틸리티 (고화질 이미지 캐시용) ---
const DB_NAME = 'PDF_HIGH_RES_CACHE';
const STORE_NAME = 'images';
const DB_VERSION = 1;

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: ['fileId', 'pageNum'] });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export default function PdfApp() {
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [fileId, setFileId] = useState("");
  const [showPageList, setShowPageList] = useState(false);

  // 확대/축소 및 이동 상태
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef({ lastDist: 0, lastPos: { x: 0, y: 0 } });

  // 메모리 해제 및 이미지 업데이트
  const updateImageSource = useCallback((blob: Blob) => {
    setCurrentImage((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
    setZoom(1); // 페이지 변경 시 줌 초기화
    setOffset({ x: 0, y: 0 });
  }, []);

  const loadFromCache = async (fId: string, pageNum: number): Promise<Blob | null> => {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get([fId, pageNum]);
      request.onsuccess = () => resolve(request.result ? request.result.blob : null);
      request.onerror = () => resolve(null);
    });
  };

  // PDF 고화질 변환 (최초 1회)
  const generateCache = async (pdf: any, fId: string) => {
    const db = await openDB();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;

    for (let i = 1; i <= pdf.numPages; i++) {
      setProgress(`고화질 변환 중... (${i}/${pdf.numPages})`);
      const page = await pdf.getPage(i);
      // [고화질 업스케일링] 3.0배율로 렌더링하여 확대 시에도 선명함 유지
      const viewport = page.getViewport({ scale: 3.0 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: context, viewport }).promise;

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
      if (blob) {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ fileId: fId, pageNum: i, blob });
      }
      if (i === 1) {
        const firstBlob = await loadFromCache(fId, 1);
        if (firstBlob) updateImageSource(firstBlob);
      }
    }
    setProgress("");
    setIsLoading(false);
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setProgress("파일 분석 중...");
    const fId = `${file.name}_${file.size}`;
    setFileId(fId);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = event.target?.result as ArrayBuffer;
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        setTotalPages(pdf.numPages);

        const cached = await loadFromCache(fId, 1);
        if (cached) {
          updateImageSource(cached);
          setIsLoading(false);
        } else {
          await generateCache(pdf, fId);
        }
      } catch (err) {
        alert("PDF 로드 실패");
        setIsLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const selectPage = async (num: number) => {
    setCurrentPage(num);
    setShowPageList(false);
    const blob = await loadFromCache(fileId, num);
    if (blob) updateImageSource(blob);
  };

  // --- 터치 이벤트 핸들러 (확대/축소/이동) ---
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
      touchRef.current.lastDist = dist;
    } else if (e.touches.length === 1) {
      touchRef.current.lastPos = { x: e.touches[0].pageX, y: e.touches[0].pageY };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
      const delta = dist / touchRef.current.lastDist;
      setZoom((prev) => Math.min(Math.max(prev * delta, 1), 5));
      touchRef.current.lastDist = dist;
    } else if (e.touches.length === 1 && zoom > 1) {
      const deltaX = e.touches[0].pageX - touchRef.current.lastPos.x;
      const deltaY = e.touches[0].pageY - touchRef.current.lastPos.y;
      setOffset((prev) => ({ x: prev.x + deltaX, y: prev.y + deltaY }));
      touchRef.current.lastPos = { x: e.touches[0].pageX, y: e.touches[0].pageY };
    }
  };

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column", backgroundColor: "#1a1a1a", overflow: "hidden", touchAction: "none" }}>
      {/* 상단 툴바 */}
      <div style={{ height: "60px", background: "#2c2c2c", display: "flex", alignItems: "center", padding: "0 20px", gap: "15px", color: "white", zIndex: 100 }}>
        <input type="file" accept=".pdf" onChange={onFileChange} style={{ fontSize: "14px" }} />
        {totalPages > 0 && (
          <button 
            onClick={() => setShowPageList(true)}
            style={{ padding: "8px 20px", backgroundColor: "#007bff", color: "white", border: "none", borderRadius: "20px", cursor: "pointer", fontWeight: "bold" }}
          >
            페이지 목록 ({currentPage}/{totalPages})
          </button>
        )}
        {progress && <span style={{ color: "#ffc107", fontSize: "13px" }}>{progress}</span>}
      </div>

      {/* 메인 뷰어 영역 */}
      <div 
        ref={containerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex", justifyContent: "center", alignItems: "center" }}
      >
        {currentImage ? (
          <img 
            src={currentImage} 
            alt="PDF Page" 
            style={{ 
              maxHeight: "95%", 
              maxWidth: "95%",
              boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              transition: zoom === 1 ? "transform 0.2s ease-out" : "none", // 초기화 시에만 부드럽게
              willChange: "transform"
            }} 
          />
        ) : (
          <div style={{ color: "#555", textAlign: "center" }}>
            {isLoading ? "고화질 변환 중입니다. 잠시만 기다려주세요..." : "PDF 파일을 선택하여 시작하세요."}
          </div>
        )}
      </div>

      {/* 80% 팝업 페이지 목록 */}
      {showPageList && (
        <div style={{
          position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
          backgroundColor: "rgba(0,0,0,0.85)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000
        }}>
          <div style={{
            width: "80%", height: "80%", backgroundColor: "#fff", borderRadius: "15px",
            display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,0.3)"
          }}>
            <div style={{ padding: "20px", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8f9fa" }}>
              <h2 style={{ margin: 0, fontSize: "1.2rem", color: "#333" }}>페이지 이동</h2>
              <button 
                onClick={() => setShowPageList(false)}
                style={{ padding: "10px 25px", cursor: "pointer", border: "none", background: "#dc3545", color: "white", borderRadius: "8px", fontWeight: "bold" }}
              >닫기</button>
            </div>
            <div style={{ 
              flex: 1, padding: "25px", overflowY: "auto", 
              display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: "20px" 
            }}>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((num) => (
                <button
                  key={num}
                  onClick={() => selectPage(num)}
                  style={{
                    aspectRatio: "1/1.4", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center",
                    backgroundColor: currentPage === num ? "#007bff" : "#f1f3f5",
                    color: currentPage === num ? "white" : "#495057",
                    border: "1px solid #dee2e6", borderRadius: "10px", cursor: "pointer", fontSize: "20px", fontWeight: "bold",
                    boxShadow: currentPage === num ? "0 5px 15px rgba(0,123,255,0.3)" : "none"
                  }}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
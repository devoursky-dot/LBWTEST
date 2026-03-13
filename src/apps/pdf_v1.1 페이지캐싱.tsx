/*
 # 기존 패키지 삭제
 npm uninstall pdfjs-dist

 # 저사양 기기용 안정 버전 설치
 npm install pdfjs-dist@2.16.105

 버전을 반드시 맞추고 실행해야한다는 것을 항상 체크해주세요
*/


import React, { useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";

// [최적화] 전자칠판 호환용 워커 설정
const PDFJS_VERSION = '2.16.105';
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;

// --- IndexedDB 유틸리티 (고화질 이미지 캐시용) ---
const DB_NAME = 'PDF_IMAGE_CACHE';
const STORE_NAME = 'page_images';
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

  // [최적화] 메모리 해제: 새 이미지를 로드하기 전 이전 ObjectURL을 파기합니다.
  const updateImageSource = useCallback((blob: Blob) => {
    setCurrentImage((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
  }, []);

  // 캐시에서 이미지 가져오기
  const loadFromCache = async (fId: string, pageNum: number) => {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get([fId, pageNum]);

    return new Promise<Blob | null>((resolve) => {
      request.onsuccess = () => resolve(request.result ? request.result.blob : null);
      request.onerror = () => resolve(null);
    });
  };

  // PDF 페이지를 고화질 이미지로 변환하여 캐싱
  const generateAllPagesCache = async (pdf: any, fId: string) => {
    const db = await openDB();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;

    for (let i = 1; i <= pdf.numPages; i++) {
      setProgress(`고화질 변환 중... (${i}/${pdf.numPages})`);
      const page = await pdf.getPage(i);
      // [고화질] 2.0 배율 적용
      const viewport = page.getViewport({ scale: 2.0 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: context, viewport }).promise;

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (blob) {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ fileId: fId, pageNum: i, blob });
      }
      
      // 첫 페이지는 즉시 표시
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
    setProgress("파일 읽는 중...");
    const fId = `${file.name}_${file.size}`;
    setFileId(fId);
    setCurrentPage(1);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = event.target?.result as ArrayBuffer;
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        setTotalPages(pdf.numPages);

        // 이미 캐시가 있는지 확인
        const cachedFirstPage = await loadFromCache(fId, 1);
        if (cachedFirstPage) {
          updateImageSource(cachedFirstPage);
          setIsLoading(false);
        } else {
          await generateAllPagesCache(pdf, fId);
        }
      } catch (err) {
        alert("PDF를 열 수 없습니다.");
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

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column", backgroundColor: "#333", overflow: "hidden" }}>
      {/* 툴바 */}
      <div style={{ height: "60px", background: "#222", display: "flex", alignItems: "center", padding: "0 20px", gap: "20px", color: "white", zIndex: 10 }}>
        <input type="file" accept=".pdf" onChange={onFileChange} style={{ color: "white" }} />
        {totalPages > 0 && (
          <>
            <button 
              onClick={() => setShowPageList(true)}
              style={{ padding: "8px 16px", backgroundColor: "#444", color: "white", border: "1px solid #666", borderRadius: "4px", cursor: "pointer" }}
            >
              페이지 목록 ({currentPage} / {totalPages})
            </button>
          </>
        )}
        {progress && <span style={{ color: "#00ff00", fontSize: "14px" }}>{progress}</span>}
      </div>

      {/* 메인 뷰어 */}
      <div style={{ flex: 1, overflow: "auto", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "20px" }}>
        {currentImage ? (
          <img 
            src={currentImage} 
            alt="PDF Page" 
            style={{ maxWidth: "100%", boxShadow: "0 0 20px rgba(0,0,0,0.5)", backgroundColor: "white" }} 
          />
        ) : (
          <div style={{ color: "#888", marginTop: "100px" }}>{isLoading ? "로딩 중..." : "PDF 파일을 선택해주세요."}</div>
        )}
      </div>

      {/* 80% 팝업창 (페이지 목록) */}
      {showPageList && (
        <div style={{
          position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
          backgroundColor: "rgba(0,0,0,0.8)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000
        }}>
          <div style={{
            width: "80%", height: "80%", backgroundColor: "#fff", borderRadius: "12px",
            display: "flex", flexDirection: "column", overflow: "hidden"
          }}>
            <div style={{ padding: "20px", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>페이지 선택</h3>
              <button 
                onClick={() => setShowPageList(false)}
                style={{ padding: "8px 16px", cursor: "pointer", border: "none", background: "#ff4444", color: "white", borderRadius: "4px" }}
              >닫기</button>
            </div>
            <div style={{ 
              flex: 1, padding: "20px", overflowY: "auto", 
              display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: "15px" 
            }}>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((num) => (
                <button
                  key={num}
                  onClick={() => selectPage(num)}
                  style={{
                    height: "80px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center",
                    backgroundColor: currentPage === num ? "#007bff" : "#f8f9fa",
                    color: currentPage === num ? "white" : "#333",
                    border: "1px solid #ddd", borderRadius: "8px", cursor: "pointer", fontSize: "18px", fontWeight: "bold"
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
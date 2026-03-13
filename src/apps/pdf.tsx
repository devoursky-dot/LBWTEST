/*
 # 기존 패키지 삭제
 npm uninstall pdfjs-dist

 # 저사양 기기용 안정 버전 설치
 npm install pdfjs-dist@2.16.105

 버전을 반드시 맞추고 실행해야한다는 것을 항상 체크해주세요
*/


import React, { useState, useCallback, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";

// [최적화] 전자칠판 안드로이드 11 호환용 워커 설정
const PDFJS_VERSION = '2.16.105';
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;

export default function PdfApp() {
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [showPageList, setShowPageList] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // 확대/축소 및 이동 상태
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef({ lastDist: 0, lastPos: { x: 0, y: 0 } });

  // [핵심] 단일 페이지 고화질 렌더링 로직
  const renderPage = useCallback(async (doc: any, pageNum: number) => {
    if (!doc) return;
    setIsLoading(true);
    try {
      const page = await doc.getPage(pageNum);
      // [고화질 업스케일링] 3.0배율 적용
      const viewport = page.getViewport({ scale: 3.0 });
      
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext("2d");
      
      if (context) {
        await page.render({ canvasContext: context, viewport }).promise;
        
        // 캔버스를 이미지로 변환 (메모리 효율을 위해 JPEG 사용)
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            setCurrentImage((prev) => {
              if (prev) URL.revokeObjectURL(prev); // 이전 페이지 메모리 해제
              return url;
            });
            setZoom(1);
            setOffset({ x: 0, y: 0 });
          }
          setIsLoading(false);
        }, 'image/jpeg', 0.9);
      }
    } catch (err) {
      console.error("렌더링 에러:", err);
      setIsLoading(false);
    }
  }, []);

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = event.target?.result as ArrayBuffer;
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        setPdfDoc(pdf);
        setTotalPages(pdf.numPages);
        setCurrentPage(1);
        renderPage(pdf, 1);
      } catch (err) {
        alert("PDF 로드 실패");
        setIsLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const selectPage = async (num: number) => {
    if (num === currentPage) {
      setShowPageList(false);
      return;
    }
    setCurrentPage(num);
    setShowPageList(false);
    renderPage(pdfDoc, num);
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

  // 전체 화면 토글 함수
  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error(`전체 화면 모드 활성화 실패: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  // 공통 아이콘 버튼 스타일
  const iconButtonStyle: React.CSSProperties = {
    width: "45px",
    height: "45px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#444",
    color: "white",
    border: "none",
    borderRadius: "10px",
    cursor: "pointer",
    fontSize: "20px",
  };

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "row", backgroundColor: "#1a1a1a", overflow: "hidden", touchAction: "none" }}>
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
            {isLoading ? "고화질 로딩 중..." : "PDF 파일을 선택하세요."}
          </div>
        )}
      </div>

      {/* 우측 툴바 */}
      <div style={{ 
        width: "65px", 
        background: "#2c2c2c", 
        display: "flex", 
        flexDirection: "column", 
        alignItems: "center", 
        justifyContent: "center", // 세로 중앙 배치
        padding: "10px", 
        gap: "15px", 
        color: "white", 
        zIndex: 100, 
        flexShrink: 0,
        borderLeft: "1px solid #444"
      }}>
        <input type="file" ref={fileInputRef} accept=".pdf" onChange={onFileChange} style={{ display: "none" }} />
        <button onClick={() => fileInputRef.current?.click()} style={iconButtonStyle} title="파일 열기">
          📂
        </button>
        
        {totalPages > 0 && (
          <button onClick={() => setShowPageList(true)} style={{ ...iconButtonStyle, backgroundColor: "#007bff" }} title="페이지 목록">
            📑
          </button>
        )}
        <button onClick={toggleFullScreen} style={{ ...iconButtonStyle, backgroundColor: "#6c757d" }} title="전체화면">
          ⛶
        </button>
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
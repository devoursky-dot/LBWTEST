import { useRef, useEffect, useState, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent, type ChangeEvent } from 'react';
// import katex from 'katex';
// import 'katex/dist/katex.min.css';
// @ts-ignore
import * as pdfjsLib from 'pdfjs-dist';

// PDF.js 워커 설정 (호환성을 위해 CDN 사용, 버전 자동 감지 또는 고정)
const pdfVersion = pdfjsLib.version || '2.16.105';
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfVersion}/pdf.worker.min.js`;

const Whiteboard = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null); // PDF 렌더링용 캔버스
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  // 좌표뿐만 아니라 시간과 굵기 정보도 저장
  const lastPointRef = useRef<{ x: number; y: number; time: number; width: number } | null>(null);

  // PDF 관련 상태
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(0);

  // 1. 캔버스 초기 설정 및 리사이즈 대응
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // 초기 상태(PDF 없을 때)는 전체 화면으로 설정
      if (!pdfDoc) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        
        const context = canvas.getContext('2d');
        if (context) {
          context.lineCap = "round";
          context.lineJoin = "round";
          context.strokeStyle = "black";
          context.lineWidth = 5;
          contextRef.current = context;
        }
      } else {
        // PDF가 있으면 renderPage에서 크기를 결정하므로 여기서는 호출만 함
        renderPage(currentPage);
      }
    };

    // 초기 실행
    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [pdfDoc, currentPage]);

  // PDF 파일 선택 핸들러
  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

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
      setPdfDoc(doc);
      setTotalPages(doc.numPages);
      setCurrentPage(1);
    } catch (error) {
      console.error("PDF 로드 실패:", error);
      alert(`PDF 파일을 로드하는데 실패했습니다.\n${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // 페이지 변경 시 렌더링
  useEffect(() => {
    if (pdfDoc) {
      renderPage(currentPage);
    }
  }, [pdfDoc, currentPage]);

  const renderPage = async (pageNum: number) => {
    if (!pdfDoc) return;

    try {
      const page = await pdfDoc.getPage(pageNum);
      // 화면 너비에 맞춰 스케일 조정
      const viewport = page.getViewport({ scale: 1.0 });
      
      // 화면에 꽉 차게 비율 계산 (너비/높이 중 더 작은 쪽 기준)
      const scaleX = window.innerWidth / viewport.width;
      const scaleY = window.innerHeight / viewport.height;
      const scale = Math.min(scaleX, scaleY) * 0.95; // 약간의 여백(0.95)
      const scaledViewport = page.getViewport({ scale });

      const pdfCanvas = pdfCanvasRef.current;
      const drawCanvas = canvasRef.current;

      if (pdfCanvas && drawCanvas) {
        // 캔버스 크기 설정
        pdfCanvas.width = scaledViewport.width;
        pdfCanvas.height = scaledViewport.height;
        drawCanvas.width = scaledViewport.width;
        drawCanvas.height = scaledViewport.height;

        // 드로잉 컨텍스트 재설정 (크기 변경 시 초기화되므로)
        const context = drawCanvas.getContext('2d');
        if (context) {
          context.lineCap = "round";
          context.lineJoin = "round";
          context.strokeStyle = "black";
          context.lineWidth = 5;
          contextRef.current = context;
        }

        // PDF 렌더링
        const renderContext = {
          canvasContext: pdfCanvas.getContext('2d')!,
          viewport: scaledViewport,
        };
        await page.render(renderContext).promise;
      }
    } catch (error) {
      console.error("페이지 렌더링 실패:", error);
    }
  };

  // 속도 기반 굵기 계산 함수
  const getLineWidth = (speed: number) => {
    const minWidth = 1;
    const maxWidth = 10;
    const minSpeed = 0.1;
    const maxSpeed = 2.5; // 속도 임계값 (조절 가능)

    // 속도가 빠를수록 얇게, 느릴수록 굵게
    const normalizedSpeed = Math.min(Math.max((speed - minSpeed) / (maxSpeed - minSpeed), 0), 1);
    return maxWidth - normalizedSpeed * (maxWidth - minWidth);
  };

  // 2. 그리기 로직 (직접 Canvas 조작으로 리액트 리렌더링 회피)
  const startDrawing = ({ nativeEvent }: ReactMouseEvent | ReactTouchEvent) => {
    const { offsetX, offsetY } = getCoordinates(nativeEvent);
    contextRef.current?.beginPath();
    contextRef.current?.moveTo(offsetX, offsetY);
    setIsDrawing(true);
    // 초기 상태 저장 (현재 시간, 기본 굵기)
    lastPointRef.current = { x: offsetX, y: offsetY, time: Date.now(), width: 5 };
  };

  const draw = ({ nativeEvent }: ReactMouseEvent | ReactTouchEvent) => {
    if (!isDrawing) return;
    const { offsetX, offsetY } = getCoordinates(nativeEvent);
    const ctx = contextRef.current;
    
    if (ctx && lastPointRef.current) {
      const now = Date.now();
      const timeDiff = now - lastPointRef.current.time;
      const dist = Math.sqrt(Math.pow(offsetX - lastPointRef.current.x, 2) + Math.pow(offsetY - lastPointRef.current.y, 2));
      
      // 속도 계산 및 굵기 보간
      let newWidth = lastPointRef.current.width;
      if (timeDiff > 0) {
        const speed = dist / timeDiff;
        const targetWidth = getLineWidth(speed);
        // 급격한 굵기 변화를 막기 위해 이전 굵기와 보간 (0.2는 반응 속도 계수)
        newWidth = lastPointRef.current.width + (targetWidth - lastPointRef.current.width) * 0.2;
      }

      const midX = (lastPointRef.current.x + offsetX) / 2;
      const midY = (lastPointRef.current.y + offsetY) / 2;

      // 계산된 굵기 적용
      ctx.lineWidth = newWidth;
      
      // 스플라인 곡선 그리기
      ctx.quadraticCurveTo(lastPointRef.current.x, lastPointRef.current.y, midX, midY);
      ctx.stroke();
      
      // 다음 선을 위해 경로 초기화 및 시작점 이동
      ctx.beginPath();
      ctx.moveTo(midX, midY);
      
      // 상태 업데이트
      lastPointRef.current = { x: offsetX, y: offsetY, time: now, width: newWidth };
    }
  };

  const stopDrawing = () => {
    const ctx = contextRef.current;
    if (ctx && lastPointRef.current) {
      ctx.lineTo(lastPointRef.current.x, lastPointRef.current.y);
      ctx.stroke();
    }
    setIsDrawing(false);
    lastPointRef.current = null;
  };

  // 좌표 계산 유틸리티 (마우스/터치 공용)
  const getCoordinates = (event: MouseEvent | TouchEvent) => {
    if ('touches' in event) {
      const rect = canvasRef.current?.getBoundingClientRect();
      return {
        offsetX: event.touches[0].clientX - (rect?.left || 0),
        offsetY: event.touches[0].clientY - (rect?.top || 0)
      };
    }
    return { offsetX: (event as MouseEvent).offsetX, offsetY: (event as MouseEvent).offsetY };
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
        <span style={{ fontWeight: 'bold', marginRight: '10px' }}>PDF 화이트보드</span>
        <input type="file" accept=".pdf" onChange={handleFileChange} />
        
        {/* 페이지 목록 아이콘 */}
        {totalPages > 0 && (
          <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', maxWidth: '300px' }}>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
              <button
                key={pageNum}
                onClick={() => setCurrentPage(pageNum)}
                style={{
                  padding: '5px 10px',
                  cursor: 'pointer',
                  backgroundColor: currentPage === pageNum ? '#007bff' : '#f0f0f0',
                  color: currentPage === pageNum ? 'white' : 'black',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  minWidth: '30px'
                }}
              >
                {pageNum}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 캔버스 컨테이너 */}
      <div style={{ position: 'relative', boxShadow: '0 0 20px rgba(0,0,0,0.1)' }}>
        {/* PDF 렌더링용 캔버스 (배경) */}
        <canvas
          ref={pdfCanvasRef}
          style={{ display: 'block', backgroundColor: '#fff' }}
        />
        {/* 드로잉용 캔버스 (상단, 투명) */}
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          style={{ 
            position: 'absolute', 
            top: 0, 
            left: 0, 
            cursor: 'crosshair', 
            touchAction: 'none',
            backgroundColor: 'transparent' // 투명 배경
          }}
        />
      </div>
    </div>
  );
};

export default Whiteboard;
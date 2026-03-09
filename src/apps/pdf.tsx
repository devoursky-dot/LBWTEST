import { useRef, useEffect, useState, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent, type ChangeEvent } from 'react';
// import katex from 'katex';
// import 'katex/dist/katex.min.css';
// @ts-ignore
import * as pdfjsLib from 'pdfjs-dist';

// PDF.js 워커 설정 (CDN 사용)
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

const Whiteboard = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null); // PDF 렌더링용 캔버스
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [latex, setLatex] = useState<string>("e = mc^2");
  // 좌표뿐만 아니라 시간과 굵기 정보도 저장
  const lastPointRef = useRef<{ x: number; y: number; time: number; width: number } | null>(null);

  // PDF 관련 상태
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(0);

  // 1. 캔버스 초기 설정 (저사양 기기 최적화)
  useEffect(() => {
    if (pdfDoc) return; // PDF가 있으면 renderPage에서 처리

    const canvas = canvasRef.current;
    if (!canvas) return;

    // 브라우저 크기에 맞게 설정
    canvas.width = window.innerWidth * 0.8;
    canvas.height = 500;

    const context = canvas.getContext('2d');
    if (context) {
      context.lineCap = "round";
      context.lineJoin = "round"; // 선 연결 부위를 부드럽게
      context.strokeStyle = "black";
      context.lineWidth = 5; // 기본 굵기
      contextRef.current = context;
    }
  }, [pdfDoc]);

  // PDF 파일 선택 핸들러
  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const doc = await loadingTask.promise;
      setPdfDoc(doc);
      setTotalPages(doc.numPages);
      setCurrentPage(1);
    } catch (error) {
      console.error("PDF 로드 실패:", error);
      alert("PDF 파일을 로드하는데 실패했습니다.");
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
      const desiredWidth = window.innerWidth * 0.8;
      const scale = desiredWidth / viewport.width;
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
    <div style={{ padding: '20px', textAlign: 'center', fontFamily: 'sans-serif' }}>
      <h2>속도 기반 필압 감지 화이트보드 (PDF 지원)</h2>
      
      {/* 툴바 영역 */}
      <div style={{ marginBottom: '10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
        <input type="file" accept=".pdf" onChange={handleFileChange} />
        
        {/* 페이지 목록 아이콘 */}
        {totalPages > 0 && (
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '80%' }}>
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

      <p style={{ fontSize: '0.9rem', color: '#666' }}>빠르게 그리면 얇게, 천천히 그리면 굵게 나옵니다.</p>
      
      {/* 캔버스 컨테이너 (겹치기 위해 relative) */}
      <div style={{ position: 'relative', display: 'inline-block', border: '2px solid #333', borderRadius: '8px', overflow: 'hidden' }}>
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

      <div style={{ marginTop: '20px' }}>
        <input 
          type="text" 
          value={latex} 
          onChange={(e) => setLatex(e.target.value)}
          placeholder="LaTeX 수식을 입력하세요"
          style={{ width: '60%', padding: '10px', fontSize: '1.2rem' }}
        />
        
        {/* 수식 렌더링 영역 (katex 미설치 시 오류 방지를 위해 주석 처리) */}
        {/* <div 
          style={{ marginTop: '20px', fontSize: '2rem' }}
          dangerouslySetInnerHTML={{ 
            __html: katex.renderToString(latex, { throwOnError: false }) 
          }} 
        /> */}
        <div style={{ marginTop: '20px', color: '#888' }}>
          (수식 렌더링을 위해선 katex 패키지 설치가 필요합니다)
        </div>
      </div>
    </div>
  );
};

export default Whiteboard;
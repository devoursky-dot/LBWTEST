import { useRef, useEffect, useState, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react';
// import katex from 'katex';
// import 'katex/dist/katex.min.css';

const Whiteboard = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [latex, setLatex] = useState<string>("e = mc^2");
  const [maxSpeed, setMaxSpeed] = useState<number>(2.5);
  // 좌표뿐만 아니라 시간과 굵기 정보도 저장
  const lastPointRef = useRef<{ x: number; y: number; time: number; width: number } | null>(null);

  // 1. 캔버스 초기 설정 (저사양 기기 최적화)
  useEffect(() => {
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
  }, []);

  // 속도 기반 굵기 계산 함수
  const getLineWidth = (speed: number) => {
    const minWidth = 1;
    const maxWidth = 10;
    const minSpeed = 0.1;

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
      <h2>속도 기반 필압 감지 화이트보드</h2>
      <p style={{ fontSize: '0.9rem', color: '#666' }}>빠르게 그리면 얇게, 천천히 그리면 굵게 나옵니다.</p>

      <div style={{ marginBottom: '10px' }}>
        <label>
          속도 민감도: {maxSpeed}
          <input
            type="range"
            min="0.5"
            max="10"
            step="0.1"
            value={maxSpeed}
            onChange={(e) => setMaxSpeed(Number(e.target.value))}
            style={{ marginLeft: '10px', verticalAlign: 'middle' }}
          />
        </label>
      </div>
      
      {/* 판서 영역 */}
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
        style={{ border: '2px solid #333', borderRadius: '8px', cursor: 'crosshair', backgroundColor: '#fff', touchAction: 'none' }}
      />

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
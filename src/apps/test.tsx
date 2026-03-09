import React, { useRef, useEffect, useState } from 'react';
// import katex from 'katex';
// import 'katex/dist/katex.min.css';

const Whiteboard = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [latex, setLatex] = useState<string>("e = mc^2");

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
      context.strokeStyle = "black";
      context.lineWidth = 3;
      contextRef.current = context;
    }
  }, []);

  // 2. 그리기 로직 (직접 Canvas 조작으로 리액트 리렌더링 회피)
  const startDrawing = ({ nativeEvent }: React.MouseEvent | React.TouchEvent) => {
    const { offsetX, offsetY } = getCoordinates(nativeEvent);
    contextRef.current?.beginPath();
    contextRef.current?.moveTo(offsetX, offsetY);
    setIsDrawing(true);
  };

  const draw = ({ nativeEvent }: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const { offsetX, offsetY } = getCoordinates(nativeEvent);
    contextRef.current?.lineTo(offsetX, offsetY);
    contextRef.current?.stroke();
  };

  const stopDrawing = () => {
    contextRef.current?.closePath();
    setIsDrawing(false);
  };

  // 좌표 계산 유틸리티 (마우스/터치 공용)
  const getCoordinates = (event: any) => {
    if (event.touches) {
      const rect = canvasRef.current?.getBoundingClientRect();
      return {
        offsetX: event.touches[0].clientX - (rect?.left || 0),
        offsetY: event.touches[0].clientY - (rect?.top || 0)
      };
    }
    return { offsetX: event.offsetX, offsetY: event.offsetY };
  };

  return (
    <div style={{ padding: '20px', textAlign: 'center', fontFamily: 'sans-serif' }}>
      <h2>저사양 최적화 판서 & 수식 앱</h2>
      
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
        style={{ border: '2px solid #333', borderRadius: '8px', cursor: 'crosshair', backgroundColor: '#fff' }}
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
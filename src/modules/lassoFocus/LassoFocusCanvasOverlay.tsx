/**
 * LassoFocusCanvasOverlay.tsx
 * ============================================================================
 * 올가미 집중 풀이 인터랙티브 오버레이 컴포넌트
 * 
 * - 사용자가 올가미로 영역을 지정하고 손을 떼면 원본 페이지에 머물지 않고
 *   즉시 새 페이지를 생성/삽입하여 문제를 배치합니다.
 * - 0ms 실시간 부드러운 SVG 궤적 시각화 & 시작점 자석 스냅(Magnetic Snap)
 * ============================================================================
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { type Point, getPolygonBounds, getPointDistance, type PolygonBounds } from './lassoFocusService';
import { defaultLassoFocusConfig } from './lassoFocusConfig';

export interface LassoFocusCanvasOverlayProps {
  isActive: boolean;
  A4_WIDTH: number;
  A4_HEIGHT: number;
  onConfirmLasso: (
    points: Point[],
    placement: 'top_center' | 'original',
    scale?: number,
    customBounds?: PolygonBounds
  ) => void;
  onCancel: () => void;
  isProcessing?: boolean;
}

export const LassoFocusCanvasOverlay: React.FC<LassoFocusCanvasOverlayProps> = ({
  isActive,
  A4_WIDTH,
  A4_HEIGHT,
  onConfirmLasso,
  onCancel,
  isProcessing = false
}) => {
  const [points, setPoints] = useState<Point[]>([]);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [isNearStart, setIsNearStart] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // ESC 키 누를 시 올가미 취소
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPoints([]);
        setIsDrawing(false);
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  // --------------------------------------------------------------------------
  // 좌표 정규화: 화면(CSS px) 좌표를 캔버스 기준 좌표(A4_WIDTH x A4_HEIGHT)로 변환
  // --------------------------------------------------------------------------
  const getCanvasCoords = useCallback((e: React.PointerEvent | PointerEvent): Point => {
    if (!containerRef.current) return { x: e.clientX, y: e.clientY };
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = A4_WIDTH / rect.width;
    const scaleY = A4_HEIGHT / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY)
    };
  }, [A4_WIDTH, A4_HEIGHT]);

  // --------------------------------------------------------------------------
  // 드로잉 포인터 이벤트 핸들러
  // --------------------------------------------------------------------------
  const handlePointerDown = (e: React.PointerEvent) => {
    if (isProcessing) return;
    e.preventDefault();
    e.stopPropagation();

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}

    const startPt = getCanvasCoords(e);
    setPoints([startPt]);
    setIsDrawing(true);
    setIsNearStart(false);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDrawing || isProcessing) return;
    e.preventDefault();
    e.stopPropagation();

    const currPt = getCanvasCoords(e);

    setPoints(prev => {
      if (prev.length === 0) return [currPt];
      const lastPt = prev[prev.length - 1];
      if (Math.hypot(currPt.x - lastPt.x, currPt.y - lastPt.y) < 4) {
        return prev;
      }

      if (prev.length >= 3) {
        const distToStart = getPointDistance(currPt, prev[0]);
        const near = distToStart <= defaultLassoFocusConfig.snapRadius;
        setIsNearStart(near);
      }

      return [...prev, currPt];
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDrawing || isProcessing) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDrawing(false);

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}

    if (points.length < 3) {
      setPoints([]);
      setIsNearStart(false);
      return;
    }

    const closedPoints = [...points, points[0]];
    const bounds = getPolygonBounds(closedPoints);

    if (bounds.width < defaultLassoFocusConfig.minDimension || bounds.height < defaultLassoFocusConfig.minDimension) {
      setPoints([]);
      setIsNearStart(false);
      return;
    }

    // 영역 선택 완료 즉시 콜백 호출 (새 페이지 삽입 및 편집 모드 전환)
    onConfirmLasso(closedPoints, 'top_center', 1.0, bounds);
    setPoints([]);
    setIsNearStart(false);
  };

  if (!isActive) return null;

  // SVG 패스 데이터 생성
  let pathD = '';
  if (points.length > 0) {
    pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      pathD += ` L ${points[i].x} ${points[i].y}`;
    }
    if (isNearStart) {
      pathD += ' Z';
    }
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 25,
        cursor: 'crosshair',
        userSelect: 'none',
        touchAction: 'none'
      }}
    >
      {/* 1. 상단 안내 플로팅 배너 */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 35,
          background: 'rgba(15, 23, 42, 0.92)',
          backdropFilter: 'blur(8px)',
          border: '1.5px solid rgba(139, 92, 246, 0.65)',
          borderRadius: '24px',
          padding: '8px 22px',
          color: '#ffffff',
          fontSize: '13px',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.55)',
          pointerEvents: 'none',
          whiteSpace: 'nowrap'
        }}
      >
        <span style={{ fontSize: '18px' }}>🎯</span>
        <span>원하는 문제를 둘러싸세요 (손을 떼면 새 페이지에 바로 삽입됩니다)</span>
        {points.length > 5 && isNearStart && (
          <span style={{ color: '#4ade80', fontWeight: 800 }}>✨ 손을 떼면 새 페이지 생성!</span>
        )}
      </div>

      {/* 2. SVG 올가미 궤적 렌더링 레이어 */}
      <svg
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          pointerEvents: 'none'
        }}
        viewBox={`0 0 ${A4_WIDTH} ${A4_HEIGHT}`}
        preserveAspectRatio="none"
      >
        <defs>
          <filter id="lasso-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#8b5cf6" floodOpacity="0.75" />
          </filter>
        </defs>

        {/* 시작점 자석 스냅 앵커 표시 */}
        {points.length > 0 && (
          <circle
            cx={points[0].x}
            cy={points[0].y}
            r={isNearStart ? 16 : 8}
            fill={isNearStart ? '#10b981' : '#8b5cf6'}
            fillOpacity={isNearStart ? 0.35 : 0.8}
            stroke="#ffffff"
            strokeWidth="2.5"
            style={{ transition: 'r 0.15s ease, fill 0.15s ease' }}
          />
        )}

        {/* 올가미 곡선 궤적 */}
        {pathD && (
          <path
            d={pathD}
            fill={isNearStart ? 'rgba(16, 185, 129, 0.18)' : 'rgba(139, 92, 246, 0.12)'}
            stroke={isNearStart ? '#10b981' : '#8b5cf6'}
            strokeWidth={2.8}
            strokeDasharray={isNearStart ? 'none' : '7, 5'}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#lasso-glow)"
          />
        )}
      </svg>

      {/* 3. 처리 중 로딩 인디케이터 오버레이 */}
      {isProcessing && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.72)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 45,
            color: '#ffffff',
            gap: '14px'
          }}
        >
          <div
            style={{
              width: '42px',
              height: '42px',
              border: '3.5px solid rgba(139, 92, 246, 0.25)',
              borderTopColor: '#a78bfa',
              borderRadius: '50%',
              animation: 'lassoSpin 0.7s linear infinite'
            }}
          />
          <style>{`
            @keyframes lassoSpin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
          <span style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '-0.3px' }}>
            문제를 추출하여 새 풀이 페이지를 삽입하고 있습니다...
          </span>
        </div>
      )}
    </div>
  );
};

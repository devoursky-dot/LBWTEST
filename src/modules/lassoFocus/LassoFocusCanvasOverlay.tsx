/**
 * LassoFocusCanvasOverlay.tsx
 * ============================================================================
 * 올가미 집중 풀이 인터랙티브 오버레이 컴포넌트
 * 
 * - 4개 모서리 드래그 크기 조절 핸들 (Interactive Corner Resize Handles)
 * - 원터치 고해상도 확대 배율 선택 버튼 (0.8x, 1.0x, 1.25x, 1.5x, 2.0x)
 * - 0ms 실시간 부드러운 SVG 궤적 시각화 & 시작점 자석 스냅(Magnetic Snap)
 * ============================================================================
 */

import React, { useState, useRef, useCallback } from 'react';
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
  const [selectedBounds, setSelectedBounds] = useState<PolygonBounds | null>(null);
  const [isSelectionCompleted, setIsSelectionCompleted] = useState<boolean>(false);

  // 배율 상태 (기본 1.2x)
  const [scaleFactor, setScaleFactor] = useState<number>(1.2);

  // 핸들 드래그 크기 조절 상태
  const [resizingHandle, setResizingHandle] = useState<'nw' | 'ne' | 'se' | 'sw' | null>(null);
  const resizeStartRef = useRef<{ clientX: number; clientY: number; initialBounds: PolygonBounds } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

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
    if (isProcessing || resizingHandle) return;
    e.preventDefault();
    e.stopPropagation();

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}

    const startPt = getCanvasCoords(e);
    setPoints([startPt]);
    setIsDrawing(true);
    setIsNearStart(false);
    setSelectedBounds(null);
    setIsSelectionCompleted(false);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (resizingHandle && resizeStartRef.current && selectedBounds) {
      // 핸들 크기 조절 드래그 처리
      e.preventDefault();
      e.stopPropagation();
      const currPt = getCanvasCoords(e);
      const initPt = getCanvasCoords({ clientX: resizeStartRef.current.clientX, clientY: resizeStartRef.current.clientY } as any);
      const dx = currPt.x - initPt.x;
      const dy = currPt.y - initPt.y;
      const initB = resizeStartRef.current.initialBounds;

      let newMinX = initB.minX;
      let newMaxX = initB.maxX;
      let newMinY = initB.minY;
      let newMaxY = initB.maxY;

      if (resizingHandle === 'se') {
        newMaxX = Math.max(initB.minX + 40, initB.maxX + dx);
        newMaxY = Math.max(initB.minY + 40, initB.maxY + dy);
      } else if (resizingHandle === 'sw') {
        newMinX = Math.min(initB.maxX - 40, initB.minX + dx);
        newMaxY = Math.max(initB.minY + 40, initB.maxY + dy);
      } else if (resizingHandle === 'ne') {
        newMaxX = Math.max(initB.minX + 40, initB.maxX + dx);
        newMinY = Math.min(initB.maxY - 40, initB.minY + dy);
      } else if (resizingHandle === 'nw') {
        newMinX = Math.min(initB.maxX - 40, initB.minX + dx);
        newMinY = Math.min(initB.maxY - 40, initB.minY + dy);
      }

      const w = Math.max(40, newMaxX - newMinX);
      const h = Math.max(40, newMaxY - newMinY);

      setSelectedBounds({
        minX: newMinX,
        minY: newMinY,
        maxX: newMaxX,
        maxY: newMaxY,
        width: w,
        height: h,
        centerX: Math.round(newMinX + w / 2),
        centerY: Math.round(newMinY + h / 2)
      });
      return;
    }

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
    if (resizingHandle) {
      setResizingHandle(null);
      resizeStartRef.current = null;
      return;
    }

    if (!isDrawing) return;
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
      setSelectedBounds(null);
      setIsSelectionCompleted(false);
      return;
    }

    setPoints(closedPoints);
    setSelectedBounds(bounds);
    setIsSelectionCompleted(true);
    setIsNearStart(false);
  };

  // 핸들 드래그 시작
  const handleHandlePointerDown = (e: React.PointerEvent, handle: 'nw' | 'ne' | 'se' | 'sw') => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedBounds) return;
    setResizingHandle(handle);
    resizeStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      initialBounds: { ...selectedBounds }
    };
  };

  if (!isActive) return null;

  // SVG 패스 데이터 생성
  let pathD = '';
  if (points.length > 0) {
    pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      pathD += ` L ${points[i].x} ${points[i].y}`;
    }
    if (isSelectionCompleted || isNearStart) {
      pathD += ' Z';
    }
  }

  // 액션 버블 위치 계산
  let bubbleTopPct = 50;
  let bubbleLeftPct = 50;
  if (selectedBounds) {
    bubbleLeftPct = Math.max(12, Math.min(88, (selectedBounds.centerX / A4_WIDTH) * 100));
    const topPx = selectedBounds.minY > 150 ? selectedBounds.minY - 110 : selectedBounds.maxY + 25;
    bubbleTopPct = Math.max(8, Math.min(90, (topPx / A4_HEIGHT) * 100));
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
        cursor: isSelectionCompleted ? 'default' : 'crosshair',
        userSelect: 'none',
        touchAction: 'none'
      }}
    >
      {/* 1. 상단 안내 플로팅 배너 */}
      {!isSelectionCompleted && (
        <div
          style={{
            position: 'absolute',
            top: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 35,
            background: 'rgba(15, 23, 42, 0.9)',
            backdropFilter: 'blur(8px)',
            border: '1.5px solid rgba(139, 92, 246, 0.55)',
            borderRadius: '24px',
            padding: '8px 20px',
            color: '#ffffff',
            fontSize: '13px',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap'
          }}
        >
          <span style={{ fontSize: '18px' }}>🎯</span>
          <span>원하는 문제를 둘러싸세요 (선택 후 모서리를 당겨 크기 조절 가능)</span>
          {points.length > 5 && isNearStart && (
            <span style={{ color: '#4ade80', fontWeight: 800 }}>✨ 손을 떼면 완료!</span>
          )}
        </div>
      )}

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
        {points.length > 0 && !isSelectionCompleted && (
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
            fill={isSelectionCompleted || isNearStart ? 'rgba(139, 92, 246, 0.18)' : 'rgba(139, 92, 246, 0.08)'}
            stroke={isSelectionCompleted || isNearStart ? '#10b981' : '#8b5cf6'}
            strokeWidth={isSelectionCompleted ? 3 : 2.5}
            strokeDasharray={isSelectionCompleted ? 'none' : '7, 5'}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#lasso-glow)"
          />
        )}

        {/* 선택 완료 바운딩 박스 가이드라인 */}
        {selectedBounds && isSelectionCompleted && (
          <rect
            x={selectedBounds.minX}
            y={selectedBounds.minY}
            width={selectedBounds.width}
            height={selectedBounds.height}
            fill="none"
            stroke="#38bdf8"
            strokeWidth="2"
            strokeDasharray="5, 4"
            rx="6"
          />
        )}
      </svg>

      {/* 2-1. 선택 완료 시 4개 모서리 크기 조절 핸들 (HTML 엘리먼트 오버레이) */}
      {selectedBounds && isSelectionCompleted && (
        <>
          {/* NW 핸들 */}
          <div
            onPointerDown={(e) => handleHandlePointerDown(e, 'nw')}
            style={{
              position: 'absolute',
              left: `${(selectedBounds.minX / A4_WIDTH) * 100}%`,
              top: `${(selectedBounds.minY / A4_HEIGHT) * 100}%`,
              transform: 'translate(-50%, -50%)',
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              background: '#38bdf8',
              border: '2.5px solid #ffffff',
              boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
              cursor: 'nwse-resize',
              zIndex: 38
            }}
            title="크기 조절 (좌상단)"
          />
          {/* NE 핸들 */}
          <div
            onPointerDown={(e) => handleHandlePointerDown(e, 'ne')}
            style={{
              position: 'absolute',
              left: `${(selectedBounds.maxX / A4_WIDTH) * 100}%`,
              top: `${(selectedBounds.minY / A4_HEIGHT) * 100}%`,
              transform: 'translate(-50%, -50%)',
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              background: '#38bdf8',
              border: '2.5px solid #ffffff',
              boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
              cursor: 'nesw-resize',
              zIndex: 38
            }}
            title="크기 조절 (우상단)"
          />
          {/* SE 핸들 */}
          <div
            onPointerDown={(e) => handleHandlePointerDown(e, 'se')}
            style={{
              position: 'absolute',
              left: `${(selectedBounds.maxX / A4_WIDTH) * 100}%`,
              top: `${(selectedBounds.maxY / A4_HEIGHT) * 100}%`,
              transform: 'translate(-50%, -50%)',
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              background: '#38bdf8',
              border: '2.5px solid #ffffff',
              boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
              cursor: 'nwse-resize',
              zIndex: 38
            }}
            title="크기 조절 (우하단)"
          />
          {/* SW 핸들 */}
          <div
            onPointerDown={(e) => handleHandlePointerDown(e, 'sw')}
            style={{
              position: 'absolute',
              left: `${(selectedBounds.minX / A4_WIDTH) * 100}%`,
              top: `${(selectedBounds.maxY / A4_HEIGHT) * 100}%`,
              transform: 'translate(-50%, -50%)',
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              background: '#38bdf8',
              border: '2.5px solid #ffffff',
              boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
              cursor: 'nesw-resize',
              zIndex: 38
            }}
            title="크기 조절 (좌하단)"
          />
        </>
      )}

      {/* 3. 선택 완료 시 뜨는 우아한 플로팅 액션 & 크기 조절 버블 */}
      {isSelectionCompleted && selectedBounds && (
        <div
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: `${bubbleTopPct}%`,
            left: `${bubbleLeftPct}%`,
            transform: 'translate(-50%, -50%)',
            zIndex: 40,
            background: '#131620',
            border: '1.5px solid #8b5cf6',
            borderRadius: '16px',
            padding: '14px 18px',
            boxShadow: '0 18px 45px rgba(0, 0, 0, 0.85), 0 0 20px rgba(139, 92, 246, 0.35)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            minWidth: '310px',
            maxWidth: '380px',
            fontFamily: '"Pretendard", "Apple SD Gothic Neo", sans-serif'
          }}
        >
          {/* 타이틀 헤더 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '18px' }}>🎯</span>
              <span style={{ fontSize: '14px', fontWeight: 800, color: '#ffffff' }}>
                선택 영역 크기 및 풀이장 생성
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setPoints([]);
                setSelectedBounds(null);
                setIsSelectionCompleted(false);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                fontSize: '15px',
                cursor: 'pointer',
                padding: '2px 4px'
              }}
              title="다시 선택"
            >
              ✕
            </button>
          </div>

          {/* 크기 및 확대 배율 선택 바 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>
                🔍 고해상도 확대 배율
              </span>
              <span style={{ fontSize: '11.5px', color: '#a78bfa', fontWeight: 800 }}>
                {scaleFactor}x ({Math.round(selectedBounds.width * scaleFactor)} × {Math.round(selectedBounds.height * scaleFactor)} px)
              </span>
            </div>
            <div style={{ display: 'flex', gap: '5px' }}>
              {[0.8, 1.0, 1.25, 1.5, 2.0].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScaleFactor(s)}
                  style={{
                    flex: 1,
                    padding: '5px 0',
                    fontSize: '11px',
                    fontWeight: 700,
                    borderRadius: '6px',
                    border: scaleFactor === s ? '1px solid #8b5cf6' : '1px solid rgba(255, 255, 255, 0.12)',
                    background: scaleFactor === s ? '#8b5cf6' : 'rgba(255, 255, 255, 0.06)',
                    color: scaleFactor === s ? '#ffffff' : '#cbd5e1',
                    cursor: 'pointer',
                    transition: 'all 0.1s ease'
                  }}
                >
                  {s}x
                </button>
              ))}
            </div>
            <span style={{ fontSize: '10px', color: '#6ee7b7' }}>
              ✨ 2x 슈퍼샘플링 엔진으로 1.5x~2x 확대 시에도 글씨와 수식이 칼처럼 선명합니다.
            </span>
          </div>

          {/* 버튼 액션 바 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => onConfirmLasso(points, 'top_center', scaleFactor, selectedBounds)}
              style={{
                background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 14px',
                fontSize: '13px',
                fontWeight: 800,
                cursor: isProcessing ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                boxShadow: '0 4px 14px rgba(139, 92, 246, 0.45)'
              }}
            >
              <span>{isProcessing ? '⏳' : '🚀'}</span>
              <span>{isProcessing ? '고해상도 풀이장 생성 중...' : `다음 쪽에 생성 (상단 ${scaleFactor}x)`}</span>
            </button>

            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => onConfirmLasso(points, 'original', scaleFactor, selectedBounds)}
                style={{
                  flex: 1,
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: '#cbd5e1',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '6px',
                  padding: '7px 8px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  cursor: isProcessing ? 'wait' : 'pointer',
                  textAlign: 'center'
                }}
                title="원본 위치 그대로 남기고 나머지 배경 마스킹"
              >
                📄 원위치로 생성
              </button>
              <button
                type="button"
                disabled={isProcessing}
                onClick={onCancel}
                style={{
                  background: 'rgba(239, 68, 68, 0.12)',
                  color: '#fca5a5',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '6px',
                  padding: '7px 12px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  cursor: isProcessing ? 'wait' : 'pointer'
                }}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

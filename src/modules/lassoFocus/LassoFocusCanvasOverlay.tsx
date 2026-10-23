/**
 * LassoFocusCanvasOverlay.tsx
 * ============================================================================
 * 올가미 집중 풀이 인터랙티브 오버레이 컴포넌트
 * 
 * - 애플펜슬 / 갤럭시 S펜 / 손가락 터치 100% 호환
 * - 0ms 실시간 부드러운 SVG 궤적 시각화
 * - 시작점 자석 스냅(Magnetic Snap) & 자동 폐곡선 닫기
 * - 선택 완료 시 우아한 플로팅 액션 버블 (상단 중앙 재배치 vs 원위치 생성)
 * ============================================================================
 */

import React, { useState, useRef, useCallback } from 'react';
import { type Point, getPolygonBounds, getPointDistance, type PolygonBounds } from './lassoFocusService';
import { defaultLassoFocusConfig } from './lassoFocusConfig';

export interface LassoFocusCanvasOverlayProps {
  isActive: boolean;
  A4_WIDTH: number;
  A4_HEIGHT: number;
  onConfirmLasso: (points: Point[], placement: 'top_center' | 'original') => void;
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

  const containerRef = useRef<HTMLDivElement>(null);

  // --------------------------------------------------------------------------
  // 좌표 정규화: 화면(CSS px) 좌표를 캔버스 기준 좌표(A4_WIDTH x A4_HEIGHT)로 변환
  // --------------------------------------------------------------------------
  const getCanvasCoords = useCallback((e: React.PointerEvent): Point => {
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
    setSelectedBounds(null);
    setIsSelectionCompleted(false);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDrawing || isProcessing) return;
    e.preventDefault();
    e.stopPropagation();

    const currPt = getCanvasCoords(e);

    setPoints(prev => {
      if (prev.length === 0) return [currPt];
      const lastPt = prev[prev.length - 1];
      // 미세 떨림 방지: 최소 4px 이상 이동했을 때만 포인트 추가
      if (Math.hypot(currPt.x - lastPt.x, currPt.y - lastPt.y) < 4) {
        return prev;
      }

      // 시작점과의 거리 검사 (자석 스냅 반경 내에 들어왔는지)
      if (prev.length > 8) {
        const distToStart = getPointDistance(currPt, prev[0]);
        const near = distToStart <= defaultLassoFocusConfig.snapRadius;
        setIsNearStart(near);
      }

      return [...prev, currPt];
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDrawing(false);

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}

    if (points.length < 8) {
      // 점 하나만 찍었거나 너무 짧은 경우 초기화
      setPoints([]);
      setIsNearStart(false);
      return;
    }

    // 폐곡선 닫기 (마지막 점을 시작점과 연결)
    const closedPoints = [...points, points[0]];
    const bounds = getPolygonBounds(closedPoints);

    if (bounds.width < defaultLassoFocusConfig.minDimension || bounds.height < defaultLassoFocusConfig.minDimension) {
      // 너무 작은 영역은 취소
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

  // 액션 버블 위치 (A4 캔버스 % 기준)
  let bubbleTopPct = 50;
  let bubbleLeftPct = 50;
  if (selectedBounds) {
    bubbleLeftPct = Math.max(10, Math.min(90, (selectedBounds.centerX / A4_WIDTH) * 100));
    // 선택 영역 위쪽에 공간이 있으면 위쪽에, 없으면 아래쪽에 표시
    const topPx = selectedBounds.minY > 120 ? selectedBounds.minY - 75 : selectedBounds.maxY + 20;
    bubbleTopPct = Math.max(5, Math.min(92, (topPx / A4_HEIGHT) * 100));
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
      {!isSelectionCompleted && (
        <div
          style={{
            position: 'absolute',
            top: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 35,
            background: 'rgba(15, 23, 42, 0.88)',
            backdropFilter: 'blur(8px)',
            border: '1.5px solid rgba(139, 92, 246, 0.5)',
            borderRadius: '24px',
            padding: '8px 20px',
            color: '#ffffff',
            fontSize: '13px',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap'
          }}
        >
          <span style={{ fontSize: '18px' }}>🎯</span>
          <span>원하는 문제를 펜이나 손가락으로 둥글게 둘러싸세요</span>
          {points.length > 5 && isNearStart && (
            <span style={{ color: '#4ade80', fontWeight: 800 }}>✨ 손을 떼면 선택 완료!</span>
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
            <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#8b5cf6" floodOpacity="0.7" />
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
            stroke="rgba(56, 189, 248, 0.5)"
            strokeWidth="1.5"
            strokeDasharray="4, 4"
            rx="6"
          />
        )}
      </svg>

      {/* 3. 선택 완료 시 뜨는 우아한 플로팅 액션 버블 */}
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
            padding: '12px 16px',
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.8), 0 0 20px rgba(139, 92, 246, 0.35)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            minWidth: '280px',
            maxWidth: '360px',
            fontFamily: '"Pretendard", "Apple SD Gothic Neo", sans-serif'
          }}
        >
          {/* 타이틀 헤더 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '18px' }}>🎯</span>
              <span style={{ fontSize: '13.5px', fontWeight: 800, color: '#ffffff' }}>
                선택한 문제 집중 풀이장 생성
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

          <p style={{ margin: 0, fontSize: '11px', color: '#cbd5e1', lineHeight: 1.4 }}>
            💡 문제를 다음 쪽에 <b>상단 중앙</b>으로 깔끔하게 배치하고, 아래에 넓은 백지 풀이 공간을 만들어줍니다.
          </p>

          {/* 버튼 액션 바 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => onConfirmLasso(points, 'top_center')}
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
              <span>{isProcessing ? '새 풀이장 생성 중...' : '다음 쪽에 집중 풀이 생성 (상단 재배치)'}</span>
            </button>

            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => onConfirmLasso(points, 'original')}
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

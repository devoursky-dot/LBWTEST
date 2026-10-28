import React, { useRef, useEffect, useLayoutEffect } from 'react';
import {
  type Stroke,
  isStrokeHit,
  drawSingleStroke,
  renderCanvasGridAndStrokes,
  calculateDynamicStrokeWidth
} from '../lib/drawingGeometry';
import {
  recognizeShape,
  generateLinePoints,
  generateCirclePoints,
  updateCircularArcPoints,
  updateBezierPoints,
  type RecognizedShape
} from '../lib/shapeRecognizer';

export interface DrawingCanvasProps {
  strokes: Stroke[];
  onStrokeComplete: (stroke: Stroke) => void;
  onStrokesChange: (strokes: Stroke[]) => void;
  onUndoSnapshot: () => void;
  tool: 'pen' | 'highlighter' | 'eraser' | 'text' | 'image' | 'lasso' | 'shapePen';
  penColor: string;
  penSize: number;
  highlighterColor: string;
  highlighterSize: number;
  eraserSize: number;
  eraserMode: 'stroke' | 'pixel';
  penOnlyMode: boolean;
  onAutoPenModeDetected?: () => void;
  fullPageBackground: string | null;
  A4_WIDTH: number;
  A4_HEIGHT: number;
  selectedImageId: string | null;
  onFingerPanMove?: (dx: number, dy: number) => void;
  onFingerPanEnd?: () => void;
  onCanvasPointerDown?: () => void;
  onTogglePenEraser?: () => void;
  paperTheme?: 'white' | 'dark' | 'ivory';
  enablePressure?: boolean;
  enableQuickShape?: boolean;
}

/**
 * 획들의 끝점(시작점과 끝점) 중 좌표 (x, y)와 가장 가까운 앵커 탐색 (자석 연결)
 */
function findNearestAnchor(
  x: number,
  y: number,
  strokes: Stroke[],
  excludeStrokeId?: string,
  maxDist: number = 26
): { x: number; y: number } | null {
  let nearest: { x: number; y: number } | null = null;
  let minDist = maxDist;

  for (const s of strokes) {
    if (s.id === excludeStrokeId || !s.points || s.points.length === 0) continue;
    const startPt = s.points[0];
    const endPt = s.points[s.points.length - 1];

    const dStart = Math.hypot(x - startPt.x, y - startPt.y);
    if (dStart < minDist) {
      minDist = dStart;
      nearest = { x: startPt.x, y: startPt.y };
    }

    const dEnd = Math.hypot(x - endPt.x, y - endPt.y);
    if (dEnd < minDist) {
      minDist = dEnd;
      nearest = { x: endPt.x, y: endPt.y };
    }
  }

  return nearest;
}

/**
 * [최우선 독립 필기 엔진 컴포넌트]
 * - GoodNotes / Procreate / Figma 방식의 하드웨어 직결 캔버스 엔진
 * - React 상위 상태 리렌더링과 캔버스 드로잉 루프를 완전 분리
 * - 네이티브 비수동(passive: false) 이벤트 및 setPointerCapture로 iOS Safari 제스처 탈취 원천 차단
 * - 0ms 즉각 반응: 획과 획 사이(글자 쓸 때) 1.2초 쿨다운 지연 없이 100% 즉시 인식
 */
export const DrawingCanvas: React.FC<DrawingCanvasProps> = ({
  strokes,
  onStrokeComplete,
  onStrokesChange,
  onUndoSnapshot,
  tool,
  penColor,
  penSize,
  highlighterColor,
  highlighterSize,
  eraserSize,
  eraserMode,
  penOnlyMode,
  onAutoPenModeDetected,
  fullPageBackground,
  A4_WIDTH,
  A4_HEIGHT,
  selectedImageId,
  onFingerPanMove,
  onFingerPanEnd,
  onCanvasPointerDown,
  onTogglePenEraser,
  paperTheme = 'white',
  enablePressure = true,
  enableQuickShape = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 필기 진행 상태 레퍼런스 (리렌더링 무관, 0ms 실시간 보장)
  const isDrawingRef = useRef(false);
  const activeDrawPointerIdRef = useRef<number | null>(null);
  const activeDrawPointerTypeRef = useRef<string | null>(null);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const isInternalStrokeAddRef = useRef(false);
  const didEraseInGestureRef = useRef(false);

  // 퀵셰이프(QuickShape) 선 유지 시 도형 자동 변환 레퍼런스
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isHoldSnappedRef = useRef<boolean>(false);
  const holdAnchorCoordRef = useRef<{ x: number; y: number } | null>(null);
  const snappedShapeRef = useRef<RecognizedShape | null>(null);
  const lastPointTimeRef = useRef<number>(0);

  // 펜 모드(penOnlyMode)에서 손가락 화면 톡톡(더블탭) 펜/지우개 전환 감지 레퍼런스
  const lastFingerTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const fingerTouchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const fingerTotalMoveDistRef = useRef<number>(0);

  // 손가락 위치 이동(Pan) 레퍼런스
  const fingerPanStartRef = useRef<{ x: number; y: number } | null>(null);

  // 최신 props를 Ref에 동기화하여 네이티브 이벤트 리스너 내에서 항상 최신 값 참조
  const propsRef = useRef({
    tool,
    penColor,
    penSize,
    highlighterColor,
    highlighterSize,
    eraserSize,
    eraserMode,
    penOnlyMode,
    onAutoPenModeDetected,
    onStrokeComplete,
    onStrokesChange,
    onUndoSnapshot,
    onFingerPanMove,
    onFingerPanEnd,
    onCanvasPointerDown,
    onTogglePenEraser,
    strokes,
    enablePressure,
    enableQuickShape,
    fullPageBackground,
    paperTheme,
    A4_WIDTH,
    A4_HEIGHT
  });

  propsRef.current = {
    tool,
    penColor,
    penSize,
    highlighterColor,
    highlighterSize,
    eraserSize,
    eraserMode,
    penOnlyMode,
    onAutoPenModeDetected,
    onStrokeComplete,
    onStrokesChange,
    onUndoSnapshot,
    onFingerPanMove,
    onFingerPanEnd,
    onCanvasPointerDown,
    onTogglePenEraser,
    strokes,
    enablePressure,
    enableQuickShape,
    fullPageBackground,
    paperTheme,
    A4_WIDTH,
    A4_HEIGHT
  };

  // 캔버스 크기(해상도) 초기화 및 동기화
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== A4_WIDTH || canvas.height !== A4_HEIGHT) {
      canvas.width = A4_WIDTH;
      canvas.height = A4_HEIGHT;
    }
  }, [A4_WIDTH, A4_HEIGHT]);

  // 전체 캔버스 다시 그리기 (외부에서 strokes가 바뀌었을 때만 실행: 실행취소, 다시실행, 페이지전환, 지우기)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (isInternalStrokeAddRef.current) {
      isInternalStrokeAddRef.current = false;
      return;
    }

    renderCanvasGridAndStrokes(canvas, strokes, fullPageBackground, paperTheme, enablePressure);
  }, [strokes, fullPageBackground, A4_WIDTH, A4_HEIGHT, paperTheme, enablePressure]);

  // ==========================================================================
  // [네이티브 하드웨어 직결 포인터 이벤트 리스너 (iOS Safari 완벽 방어)]
  // ==========================================================================
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getCanvasCoords = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
      };
    };

    const handleNativePointerDown = (e: PointerEvent) => {
      const p = propsRef.current;

      // 캔버스 터치 즉시 상단 열려있는 도구 팝오버 메뉴 즉시 닫기
      if (p.onCanvasPointerDown) {
        p.onCanvasPointerDown();
      }

      // 텍스트, 이미지 편집, 올가미 집중 풀이 도구 중일 때는 캔버스 필기 패스
      if (p.tool === 'text' || p.tool === 'image' || p.tool === 'lasso') return;

      // iOS Safari의 기본 제스처(스크롤, 돋보기 루페, 스크리블, 선택) 즉시 차단
      if (e.cancelable) {
        e.preventDefault();
      }

      // [1. 애플펜슬 / 스타일러스 최우선권 (연속 점 찍기 시 지우개 오작동 원천 차단)]:
      if (e.pointerType === 'pen') {
        // 스타일러스가 감지되면 자동으로 펜 전용 모드 활성화 (손바닥 터치 오작동 원천 차단)
        if (!p.penOnlyMode && p.onAutoPenModeDetected) {
          p.onAutoPenModeDetected();
        }

        // 손바닥으로 잘못 시작된 터치가 있었다면 즉시 파기 및 캔버스 지우기
        if (isDrawingRef.current && activeDrawPointerTypeRef.current === 'touch') {
          isDrawingRef.current = false;
          currentStrokeRef.current = null;
          activeDrawPointerIdRef.current = null;
          activeDrawPointerTypeRef.current = null;
          const cCtx = canvas.getContext('2d');
          if (cCtx) {
            renderCanvasGridAndStrokes(canvas, p.strokes, fullPageBackground, paperTheme, p.enablePressure);
          }
        }
      }

      // [2. 펜 모드(penOnlyMode)일 때 - 손가락 터치는 화면 이동 및 제자리 더블탭 지우개 토글]:
      if (p.penOnlyMode) {
        if (e.pointerType === 'touch') {
          fingerTouchStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
          fingerPanStartRef.current = { x: e.clientX, y: e.clientY };
          fingerTotalMoveDistRef.current = 0;
          return;
        }
        // 펜 또는 마우스가 아니면 무조건 무시 (손바닥 터치 완벽 무시)
        if (e.pointerType !== 'pen' && e.pointerType !== 'mouse') {
          return;
        }
      }

      // [3. 터치 모드일 때]:
      if (!p.penOnlyMode && e.pointerType === 'touch') {
        // 이미 다른 손가락으로 그리고 있다면 추가 손가락은 무시 (두 손가락 직선 튀김 방지)
        if (isDrawingRef.current) {
          return;
        }
      }

      // 이전 획이 미처 pointerup 되지 못하고 바로 새 터치다운이 들어온 경우 안전하게 이전 획 저장 (글자 획 빠르게 칠 때 누락 방어)
      if (isDrawingRef.current && currentStrokeRef.current && currentStrokeRef.current.points.length > 0) {
        isInternalStrokeAddRef.current = true;
        p.onStrokeComplete({ ...currentStrokeRef.current, points: [...currentStrokeRef.current.points] });
        currentStrokeRef.current = null;
      }

      // [4. 포인터 캡처 (iOS Safari 획 끊김 방지의 핵심)]:
      // 펜이 캔버스 밖으로 살짝 나가거나 빠르게 움직여도 이벤트 스트림을 캔버스에 영구 고정
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {}

      isDrawingRef.current = true;
      activeDrawPointerIdRef.current = e.pointerId;
      activeDrawPointerTypeRef.current = e.pointerType;

      const { x, y } = getCanvasCoords(e.clientX, e.clientY);
      const initialPressure = e.pressure > 0 ? e.pressure : 0.5;
      lastPointTimeRef.current = Date.now();

      // 퀵셰이프 상태 초기화
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      isHoldSnappedRef.current = false;
      snappedShapeRef.current = null;
      holdAnchorCoordRef.current = { x, y };

      // [5. 획 단위 지우개 모드]:
      if (p.tool === 'eraser' && p.eraserMode === 'stroke') {
        didEraseInGestureRef.current = false;
        const eraserRadius = Math.max(16, p.eraserSize / 2);
        const hitStrokes = p.strokes.filter(s => isStrokeHit(s, x, y, eraserRadius));
        if (hitStrokes.length > 0) {
          p.onUndoSnapshot();
          didEraseInGestureRef.current = true;
          const remaining = p.strokes.filter(s => !hitStrokes.some(hs => hs.id === s.id));
          p.onStrokesChange(remaining);
        }
        return;
      }

      // [6. 일반 필기 / 도형 펜 / 형광펜 / 픽셀 지우개 시작]:
      p.onUndoSnapshot();

      const currentSize = (p.tool === 'pen' || p.tool === 'shapePen')
        ? p.penSize
        : p.tool === 'highlighter'
          ? p.highlighterSize
          : p.eraserSize;
      const currentColor = p.tool === 'highlighter' ? p.highlighterColor : p.penColor;

      let startX = x;
      let startY = y;

      // [도형 펜 전용]: 획 시작점이 다른 도형 선분의 끝점 근처면 자석처럼 달라붙어 연결 제도
      if (p.tool === 'shapePen') {
        const anchor = findNearestAnchor(x, y, p.strokes, undefined, 26);
        if (anchor) {
          startX = anchor.x;
          startY = anchor.y;
        }
      }

      const newStroke: Stroke = {
        id: `stroke_${Date.now()}_${Math.random()}`,
        tool: p.tool as 'pen' | 'highlighter' | 'eraser' | 'shapePen',
        color: currentColor,
        size: currentSize,
        points: [{ x: startX, y: startY, pressure: initialPressure }]
      };

      currentStrokeRef.current = newStroke;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        drawSingleStroke(ctx, newStroke, p.enablePressure);
      }
    };

    const handleNativePointerMove = (e: PointerEvent) => {
      const p = propsRef.current;

      if (e.cancelable) {
        e.preventDefault();
      }

      // 펜 모드에서 손가락 드래그로 화면 이동 중일 때 (이동 거리 누적)
      if (fingerPanStartRef.current && e.pointerType === 'touch') {
        const dx = e.clientX - fingerPanStartRef.current.x;
        const dy = e.clientY - fingerPanStartRef.current.y;
        fingerTotalMoveDistRef.current += Math.hypot(dx, dy);
        fingerPanStartRef.current = { x: e.clientX, y: e.clientY };
        if (p.onFingerPanMove) {
          p.onFingerPanMove(dx, dy);
        }
        return;
      }

      // 현재 필기 중인 포인터 ID와 일치하지 않으면 무시 (손바닥 간섭 방어)
      if (!isDrawingRef.current || e.pointerId !== activeDrawPointerIdRef.current) {
        return;
      }

      // 획 지우개 이동 중 스친 스트로크 삭제
      if (p.tool === 'eraser' && p.eraserMode === 'stroke') {
        const { x, y } = getCanvasCoords(e.clientX, e.clientY);
        const eraserRadius = Math.max(16, p.eraserSize / 2);
        const hitStrokes = p.strokes.filter(s => isStrokeHit(s, x, y, eraserRadius));
        if (hitStrokes.length > 0) {
          if (!didEraseInGestureRef.current) {
            p.onUndoSnapshot();
            didEraseInGestureRef.current = true;
          }
          const remaining = p.strokes.filter(s => !hitStrokes.some(hs => hs.id === s.id));
          p.onStrokesChange(remaining);
        }
        return;
      }

      if (!currentStrokeRef.current) return;
      const currentStroke = currentStrokeRef.current;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const now = Date.now();
      const dt = Math.max(1, now - lastPointTimeRef.current);
      lastPointTimeRef.current = now;

      // iPad 120Hz/240Hz 애플펜슬 서브프레임 정밀도를 위한 Coalesced Events 처리
      const coalesced = (e as any).getCoalescedEvents ? (e as any).getCoalescedEvents() : [e];
      const eventsToProcess = coalesced.length > 0 ? coalesced : [e];

      // ----------------------------------------------------------------------
      // [A] 퀵셰이프 스냅 완료 상태: 드래그하여 끝점 위치 실시간 조절
      // ----------------------------------------------------------------------
      if (isHoldSnappedRef.current && snappedShapeRef.current) {
        const shape = snappedShapeRef.current;
        const lastEv = eventsToProcess[eventsToProcess.length - 1];
        let { x, y } = getCanvasCoords(lastEv.clientX, lastEv.clientY);
        const fixedStart = shape.startPoint || currentStroke.points[0];

        // 도형 펜인 경우 끝점도 기존 꼭짓점 또는 시작점에 자석 스냅!
        if (p.tool === 'shapePen') {
          const anchor = findNearestAnchor(x, y, p.strokes, currentStroke.id, 26);
          if (anchor) {
            x = anchor.x;
            y = anchor.y;
          } else if (fixedStart && Math.hypot(x - fixedStart.x, y - fixedStart.y) < 24 && Math.hypot(x - fixedStart.x, y - fixedStart.y) > 0) {
            x = fixedStart.x;
            y = fixedStart.y;
          }
        }

        if (shape.type === 'line') {
          if (p.tool === 'shapePen') {
            if (Math.abs(y - fixedStart.y) < 14 && Math.hypot(x - fixedStart.x, y - fixedStart.y) > 25) {
              y = fixedStart.y;
            } else if (Math.abs(x - fixedStart.x) < 14 && Math.hypot(x - fixedStart.x, y - fixedStart.y) > 25) {
              x = fixedStart.x;
            }
          }
          currentStroke.points = generateLinePoints(fixedStart, { x, y }, 0.5);
        } else if (shape.type === 'circle') {
          const pivot = shape.oppositePoint || fixedStart;
          const diam = Math.hypot(x - pivot.x, y - pivot.y);
          const radius = Math.max(8, diam / 2);
          const cx = (pivot.x + x) / 2;
          const cy = (pivot.y + y) / 2;
          currentStroke.points = generateCirclePoints(cx, cy, radius, 0.5);
        } else if (shape.type === 'circular_arc' || shape.type === 'elliptic_arc') {
          currentStroke.points = updateCircularArcPoints(shape, fixedStart, { x, y });
        } else if (shape.type === 'bezier') {
          currentStroke.points = updateBezierPoints(shape.points, fixedStart, { x, y });
        }

        // 화면 1회 리렌더링 (최신 propsRef 참조로 Stale Closure 방지)
        renderCanvasGridAndStrokes(canvas, p.strokes, p.fullPageBackground, p.paperTheme, p.enablePressure);
        drawSingleStroke(ctx, currentStroke, false);

        if (p.tool === 'shapePen') {
          ctx.save();
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        return;
      }

      // ----------------------------------------------------------------------
      // [B] 일반 필기/드로잉 (손을 뗀 채 자유롭게 그리는 단계)
      // ----------------------------------------------------------------------
      for (let i = 0; i < eventsToProcess.length; i++) {
        const ev = eventsToProcess[i];
        const { x, y } = getCanvasCoords(ev.clientX, ev.clientY);

        const pts = currentStroke.points;
        const prevPt = pts[pts.length - 1];

        // 펜촉이 제자리(anchor)에서 홀드 대기 중일 때 미세 진동으로 인한 무의미한 점 누적 방어
        if (holdAnchorCoordRef.current && prevPt) {
          const distFromAnchor = Math.hypot(x - holdAnchorCoordRef.current.x, y - holdAnchorCoordRef.current.y);
          const distFromPrev = Math.hypot(x - prevPt.x, y - prevPt.y);
          if (distFromAnchor < 8 && distFromPrev < 1.2) {
            continue;
          }
        }

        let effectivePressure = ev.pressure > 0 ? ev.pressure : 0.5;
        if (effectivePressure === 0.5 && prevPt) {
          const dist = Math.hypot(x - prevPt.x, y - prevPt.y);
          const speed = dist / dt;
          effectivePressure = Math.max(0.15, Math.min(0.95, 0.95 - speed * 0.18));
        }

        pts.push({ x, y, pressure: effectivePressure });

        if (prevPt) {
          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          const isPen = currentStroke.tool === 'pen';
          const segWidth = (isPen && p.enablePressure)
            ? calculateDynamicStrokeWidth(currentStroke.size, effectivePressure)
            : currentStroke.size;

          if (currentStroke.tool === 'highlighter') {
            ctx.globalAlpha = 0.35;
            ctx.strokeStyle = currentStroke.color;
            ctx.lineWidth = currentStroke.size;
          } else if (currentStroke.tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = currentStroke.size;
          } else {
            ctx.globalAlpha = 1.0;
            ctx.strokeStyle = currentStroke.color;
            ctx.lineWidth = segWidth;
          }

          ctx.beginPath();
          ctx.moveTo(prevPt.x, prevPt.y);
          ctx.lineTo(x, y);
          ctx.stroke();

          ctx.restore();
        }
      }

      // [C] 퀵셰이프 홀드 감지:
      // 1) 도형 펜(shapePen)은 항상 활성화 (기민한 400ms 반응, 모든 기하학적 형태 지원)
      // 2) 일반 펜(pen)은 오직 p.enableQuickShape가 명시적으로 켜져 있을 때만 동작 (기본값 false: 손글씨 100% 보장)
      const shouldCheckQuickShape = (p.tool === 'shapePen') || (p.enableQuickShape && (currentStroke.tool === 'pen' || currentStroke.tool === 'highlighter'));
      if (shouldCheckQuickShape && !isHoldSnappedRef.current) {
        const pts = currentStroke.points;
        const lastPt = pts[pts.length - 1];

        const anchor = holdAnchorCoordRef.current;
        const distFromAnchor = anchor ? Math.hypot(lastPt.x - anchor.x, lastPt.y - anchor.y) : 999;

        if (distFromAnchor > 18 || !holdTimerRef.current) {
          holdAnchorCoordRef.current = { x: lastPt.x, y: lastPt.y };
          if (holdTimerRef.current) {
            clearTimeout(holdTimerRef.current);
            holdTimerRef.current = null;
          }

          if (pts.length >= 6) {
            const holdDelay = p.tool === 'shapePen' ? 400 : 850;
            holdTimerRef.current = setTimeout(() => {
              if (!isDrawingRef.current || !currentStrokeRef.current) return;
              const strokeSize = currentStrokeRef.current.size || 3;
              const shape = recognizeShape(currentStrokeRef.current.points, strokeSize);
              if (shape) {
                const isAllowedShape = p.tool === 'shapePen'
                  ? true
                  : (shape.type === 'line' || shape.type === 'circle');

                if (isAllowedShape) {
                  if (typeof navigator !== 'undefined' && navigator.vibrate) {
                    try { navigator.vibrate(20); } catch {}
                  }

                  isHoldSnappedRef.current = true;
                  snappedShapeRef.current = shape;

                  const fixedStart = shape.startPoint || currentStrokeRef.current.points[0];

                  if (shape.type === 'line' && shape.endPoint) {
                    let ex = shape.endPoint.x;
                    let ey = shape.endPoint.y;
                    if (p.tool === 'shapePen') {
                      const endAnchor = findNearestAnchor(ex, ey, p.strokes, currentStrokeRef.current.id, 26);
                      if (endAnchor) {
                        ex = endAnchor.x;
                        ey = endAnchor.y;
                      } else if (Math.abs(ey - fixedStart.y) < 14 && Math.hypot(ex - fixedStart.x, ey - fixedStart.y) > 25) {
                        ey = fixedStart.y;
                      } else if (Math.abs(ex - fixedStart.x) < 14 && Math.hypot(ex - fixedStart.x, ey - fixedStart.y) > 25) {
                        ex = fixedStart.x;
                      }
                    }
                    currentStrokeRef.current.points = generateLinePoints(fixedStart, { x: ex, y: ey }, 0.5);
                  } else {
                    currentStrokeRef.current.points = shape.points;
                  }

                  renderCanvasGridAndStrokes(canvas, p.strokes, fullPageBackground, paperTheme, p.enablePressure);
                  drawSingleStroke(ctx, currentStrokeRef.current, false);
                }
              }
            }, holdDelay);
          }
        }
      }
    };

    const handleNativePointerUp = (e: PointerEvent) => {
      const p = propsRef.current;

      // 퀵셰이프 타이머 리셋
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      holdAnchorCoordRef.current = null;

      // [마우스를 떼면 즉시 고정!]
      isHoldSnappedRef.current = false;
      snappedShapeRef.current = null;

      // 포인터 캡처 안전 해제
      if (canvas.hasPointerCapture(e.pointerId)) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {}
      }

      // 펜 모드(penOnlyMode)에서 손가락 화면 톡톡(더블탭) 펜/지우개 전환 감지:
      // 손가락으로 화면을 이동(Pan)한 것이 아니라, 제자리에서 가볍게 탭(< 280ms, 이동거리 < 14px)한 경우만 엄격 판별!
      if (p.penOnlyMode && e.pointerType === 'touch' && fingerTouchStartRef.current) {
        const touchDuration = Date.now() - fingerTouchStartRef.current.time;
        const totalDist = fingerTotalMoveDistRef.current;
        const isPureTap = touchDuration < 280 && totalDist < 14;

        if (isPureTap) {
          const now = Date.now();
          if (lastFingerTapRef.current) {
            const elapsed = now - lastFingerTapRef.current.time;
            const distFromLastTap = Math.hypot(e.clientX - lastFingerTapRef.current.x, e.clientY - lastFingerTapRef.current.y);

            // 40ms ~ 360ms 사이, 반경 35px 이내의 연속 두 번 탭(더블탭) 감지 성공!
            if (elapsed >= 40 && elapsed < 360 && distFromLastTap < 35) {
              if (p.onTogglePenEraser) {
                p.onTogglePenEraser();
              }
              lastFingerTapRef.current = null;
            } else {
              lastFingerTapRef.current = { time: now, x: e.clientX, y: e.clientY };
            }
          } else {
            lastFingerTapRef.current = { time: now, x: e.clientX, y: e.clientY };
          }
        } else {
          lastFingerTapRef.current = null;
        }
        fingerTouchStartRef.current = null;
      }

      // 손가락 팬 종료
      if (fingerPanStartRef.current && e.pointerType === 'touch') {
        fingerPanStartRef.current = null;
        if (p.onFingerPanEnd) {
          p.onFingerPanEnd();
        }
      }

      // 포인터 캡처 안전 해제
      if (canvas.hasPointerCapture(e.pointerId)) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {}
      }

      // 현재 필기 중인 포인터가 떼어졌을 때
      if (isDrawingRef.current && (e.pointerId === activeDrawPointerIdRef.current || e.pointerType === 'pen')) {
        isDrawingRef.current = false;
        activeDrawPointerIdRef.current = null;
        activeDrawPointerTypeRef.current = null;

        if (p.tool === 'eraser' && p.eraserMode === 'stroke') {
          return;
        }

        const finishedStroke = currentStrokeRef.current;
        if (finishedStroke && finishedStroke.points.length > 0) {
          // [도형 펜 shapePen 전용 모듈화]:
          // 홀드하지 않고 슥 그었더라도, 직선/원/호 형태이면 즉시 CAD 스타일 정형화 및 자석 연결
          if (p.tool === 'shapePen' && !isHoldSnappedRef.current && finishedStroke.points.length >= 5) {
            const shape = recognizeShape(finishedStroke.points, finishedStroke.size || 3);
            if (shape) {
              const startPt = finishedStroke.points[0];
              let endPt = finishedStroke.points[finishedStroke.points.length - 1];

              const endAnchor = findNearestAnchor(endPt.x, endPt.y, p.strokes, finishedStroke.id, 26);
              if (endAnchor) {
                endPt = { x: endAnchor.x, y: endAnchor.y, pressure: 0.5 };
              } else if (Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y) < 24 && Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y) > 0) {
                endPt = { x: startPt.x, y: startPt.y, pressure: 0.5 };
              }

              if (shape.type === 'line') {
                let ex = endPt.x;
                let ey = endPt.y;
                if (Math.abs(ey - startPt.y) < 14 && Math.hypot(ex - startPt.x, ey - startPt.y) > 20) {
                  ey = startPt.y;
                } else if (Math.abs(ex - startPt.x) < 14 && Math.hypot(ex - startPt.x, ey - startPt.y) > 20) {
                  ex = startPt.x;
                }
                finishedStroke.points = generateLinePoints(startPt, { x: ex, y: ey }, 0.5);
              } else if (shape.type === 'circle' || shape.type === 'circular_arc' || shape.type === 'elliptic_arc') {
                finishedStroke.points = shape.points;
              }
            }
          }

          isInternalStrokeAddRef.current = true;
          p.onStrokeComplete({ ...finishedStroke, points: [...finishedStroke.points] });
        }
        currentStrokeRef.current = null;
      }
    };

    const handleNativePointerCancel = (e: PointerEvent) => {
      // iOS Safari에서 pointercancel 발생 시 획을 유실하지 않고 정상 마감
      handleNativePointerUp(e);
    };

    // iOS Safari 전용: 단일 터치/펜 터치 시 브라우저 제스처(돋보기, 텍스트 선택, 스크롤 대기 300ms) 원천 차단
    const handleNativeTouchStart = (e: TouchEvent) => {
      // 2손가락 이상 핀치줌은 부모 컨테이너로 전달되도록 단일 터치일 때만 즉각 차단
      if (e.touches.length === 1 && e.cancelable) {
        e.preventDefault();
      }
    };
    const handleNativeTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1 && e.cancelable) {
        e.preventDefault();
      }
    };

    const handleNativeContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    // 네이티브 비수동(passive: false) 리스너 직접 부착
    canvas.addEventListener('pointerdown', handleNativePointerDown, { passive: false });
    canvas.addEventListener('pointermove', handleNativePointerMove, { passive: false });
    canvas.addEventListener('pointerup', handleNativePointerUp, { passive: false });
    canvas.addEventListener('pointercancel', handleNativePointerCancel, { passive: false });
    canvas.addEventListener('touchstart', handleNativeTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleNativeTouchMove, { passive: false });
    canvas.addEventListener('contextmenu', handleNativeContextMenu, { passive: false });

    // 전역 window 레벨에서도 펜을 빠르게 뗐을 때를 대비해 안전 포인터업 등록
    const handleGlobalWindowPointerUp = (e: PointerEvent) => {
      if (isDrawingRef.current && (e.pointerId === activeDrawPointerIdRef.current || e.pointerType === 'pen')) {
        handleNativePointerUp(e);
      }
    };
    window.addEventListener('pointerup', handleGlobalWindowPointerUp, { passive: true });
    window.addEventListener('pointercancel', handleGlobalWindowPointerUp, { passive: true });

    return () => {
      canvas.removeEventListener('pointerdown', handleNativePointerDown);
      canvas.removeEventListener('pointermove', handleNativePointerMove);
      canvas.removeEventListener('pointerup', handleNativePointerUp);
      canvas.removeEventListener('pointercancel', handleNativePointerCancel);
      canvas.removeEventListener('touchstart', handleNativeTouchStart);
      canvas.removeEventListener('touchmove', handleNativeTouchMove);
      canvas.removeEventListener('contextmenu', handleNativeContextMenu);
      window.removeEventListener('pointerup', handleGlobalWindowPointerUp);
      window.removeEventListener('pointercancel', handleGlobalWindowPointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="student-canvas"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        display: 'block',
        zIndex: tool === 'image' && selectedImageId ? 2 : 4,
        pointerEvents: tool === 'image' ? 'none' : 'auto',
        touchAction: 'none',
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
        WebkitTapHighlightColor: 'transparent'
      }}
    />
  );
};

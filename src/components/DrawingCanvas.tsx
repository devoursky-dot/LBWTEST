import React, { useRef, useState, useEffect, useLayoutEffect } from 'react';
import {
  type Stroke,
  isStrokeHit,
  drawSingleStroke,
  renderCanvasGridAndStrokes,
  calculateDynamicStrokeWidth
} from '../lib/drawingGeometry';
import {
  recognizeShape,
  generateCirclePoints,
  getArcControlPoint,
  calculateTangentArcApex,
  generateStrokePointsFromEditableShape,
  type RecognizedShape,
  type EditableShape,
  type EditableArcSegment
} from '../lib/shapeRecognizer';

export interface DrawingCanvasProps {
  strokes: Stroke[];
  onStrokeComplete: (stroke: Stroke) => void;
  onStrokesChange: (strokes: Stroke[]) => void;
  onUndoSnapshot: () => void;
  tool: 'pen' | 'highlighter' | 'eraser' | 'text' | 'image' | 'lasso';
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
  enableQuickShape = true
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
  const lastPointTimeRef = useRef<number>(Date.now());

  // [📐 연속 체이닝 & 편집 모드 상태 및 레퍼런스]
  const [editingShape, setEditingShape] = useState<EditableShape | null>(null);
  const editingShapeRef = useRef<EditableShape | null>(null);
  editingShapeRef.current = editingShape;

  const chainShapeTypeRef = useRef<'line' | 'arc' | 'circle' | null>(null);
  const polylineVerticesRef = useRef<{ x: number; y: number }[]>([]);
  const arcSegmentsRef = useRef<EditableArcSegment[]>([]);
  const circleDataRef = useRef<{ cx: number; cy: number; radius: number; pivotX: number; pivotY: number } | null>(null);
  const chainHoldTimerRef = useRef<NodeJS.Timeout | null>(null);
  const chainAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const isTapToCompleteRef = useRef<boolean>(false);

  // 편집 모드 핸들 조절 중인 정보
  const draggingHandleRef = useRef<{
    type: 'vertex' | 'arc_point' | 'arc_apex' | 'circle_center' | 'circle_radius';
    index?: number;
    subIndex?: number;
    startCoord: { x: number; y: number };
  } | null>(null);

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
    enableQuickShape
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
    enableQuickShape
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

  // [도형 편집 완료 및 커밋]
  const commitEditingShape = () => {
    const shape = editingShapeRef.current;
    if (!shape) return;

    const finalPoints = generateStrokePointsFromEditableShape(shape);
    if (finalPoints.length > 0) {
      const finalStroke: Stroke = {
        id: `stroke_${Date.now()}_${Math.random()}`,
        tool: shape.strokeProps.tool,
        color: shape.strokeProps.color,
        size: shape.strokeProps.size,
        points: finalPoints
      };
      isInternalStrokeAddRef.current = true;
      propsRef.current.onStrokeComplete(finalStroke);
    }

    setEditingShape(null);
    editingShapeRef.current = null;

    const canvas = canvasRef.current;
    if (canvas) {
      renderCanvasGridAndStrokes(canvas, propsRef.current.strokes, fullPageBackground, paperTheme, enablePressure);
    }
  };

  // [도형 편집 취소]
  const cancelEditingShape = () => {
    setEditingShape(null);
    editingShapeRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      renderCanvasGridAndStrokes(canvas, propsRef.current.strokes, fullPageBackground, paperTheme, enablePressure);
    }
  };

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

      // [📐 도형 편집 모드 중 다른 곳 클릭 시 즉각 도형 완성 및 모드 해제]
      if (editingShapeRef.current) {
        commitEditingShape();
        isTapToCompleteRef.current = true;
        return;
      }

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

        // 손바닥으로 잘못 시작된 터치가 있었다면 즉시 파기
        if (isDrawingRef.current && activeDrawPointerTypeRef.current === 'touch') {
          isDrawingRef.current = false;
          currentStrokeRef.current = null;
          activeDrawPointerIdRef.current = null;
          activeDrawPointerTypeRef.current = null;
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

      // 퀵셰이프 및 연속 체이닝 상태 초기화
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      if (chainHoldTimerRef.current) {
        clearTimeout(chainHoldTimerRef.current);
        chainHoldTimerRef.current = null;
      }
      isHoldSnappedRef.current = false;
      snappedShapeRef.current = null;
      chainShapeTypeRef.current = null;
      polylineVerticesRef.current = [];
      arcSegmentsRef.current = [];
      circleDataRef.current = null;
      chainAnchorRef.current = null;
      isTapToCompleteRef.current = false;
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

      // [6. 일반 필기 / 형광펜 / 픽셀 지우개 시작]:
      p.onUndoSnapshot();

      const currentSize = p.tool === 'pen' ? p.penSize : p.tool === 'highlighter' ? p.highlighterSize : p.eraserSize;
      const currentColor = p.tool === 'highlighter' ? p.highlighterColor : p.penColor;

      const newStroke: Stroke = {
        id: `stroke_${Date.now()}_${Math.random()}`,
        tool: p.tool as 'pen' | 'highlighter' | 'eraser',
        color: currentColor,
        size: currentSize,
        points: [{ x, y, pressure: initialPressure }]
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

      for (let i = 0; i < eventsToProcess.length; i++) {
        const ev = eventsToProcess[i];
        const { x, y } = getCanvasCoords(ev.clientX, ev.clientY);

        // --------------------------------------------------------------------
        // 1) 퀵셰이프로 스냅된 후 손을 떼지 않고 조절 & 연속 체이닝
        // --------------------------------------------------------------------
        if (isHoldSnappedRef.current) {
          // (A) 직선 체이닝 (Line Chaining)
          if (chainShapeTypeRef.current === 'line' && polylineVerticesRef.current.length >= 2) {
            const verts = polylineVerticesRef.current;
            verts[verts.length - 1] = { x, y };

            const pts = generateStrokePointsFromEditableShape({
              type: 'line',
              vertices: verts,
              strokeProps: { color: currentStroke.color, size: currentStroke.size, tool: currentStroke.tool as any }
            });
            currentStroke.points = pts;
            renderCanvasGridAndStrokes(canvas, p.strokes, fullPageBackground, paperTheme, p.enablePressure);
            drawSingleStroke(ctx, currentStroke, false);

            // [직선으로 바뀌고 드래그하다 멈추면 연결된 다음 직선이 계속 그려짐]
            const anchor = chainAnchorRef.current;
            const dist = anchor ? Math.hypot(x - anchor.x, y - anchor.y) : 999;
            if (dist > 22 || !chainHoldTimerRef.current) {
              chainAnchorRef.current = { x, y };
              if (chainHoldTimerRef.current) {
                clearTimeout(chainHoldTimerRef.current);
                chainHoldTimerRef.current = null;
              }
              chainHoldTimerRef.current = setTimeout(() => {
                if (!isDrawingRef.current || !isHoldSnappedRef.current) return;
                if (typeof navigator !== 'undefined' && navigator.vibrate) {
                  try { navigator.vibrate(25); } catch {}
                }
                // 손끝 위치를 고정 꼭짓점으로 굳히고, 다음 연결 직선 꼭짓점 추가!
                polylineVerticesRef.current.push({ x, y });
                chainAnchorRef.current = { x, y };
              }, 380);
            }
            continue;
          }

          // (B) 곡선(호) 체이닝 및 접선 연속성 ($C^1$ Continuity)
          if (chainShapeTypeRef.current === 'arc' && arcSegmentsRef.current.length > 0) {
            const segs = arcSegmentsRef.current;
            const currIdx = segs.length - 1;
            const currSeg = segs[currIdx];

            currSeg.end = { x, y };

            if (currIdx === 0) {
              const midX = (currSeg.start.x + x) / 2;
              const midY = (currSeg.start.y + y) / 2;
              const baseApex = snappedShapeRef.current?.apexPoint;
              if (baseApex && snappedShapeRef.current?.startPoint && snappedShapeRef.current?.endPoint) {
                const origMidX = (snappedShapeRef.current.startPoint.x + snappedShapeRef.current.endPoint.x) / 2;
                const origMidY = (snappedShapeRef.current.startPoint.y + snappedShapeRef.current.endPoint.y) / 2;
                const offX = baseApex.x - origMidX;
                const offY = baseApex.y - origMidY;
                currSeg.apex = { x: midX + offX, y: midY + offY };
              } else {
                currSeg.apex = { x: midX, y: midY };
              }
            } else {
              // 이전 호의 끝점 접선 방향을 그대로 계승하여 매끄럽게 연결 ($C^1$ 연속성)
              const prevSeg = segs[currIdx - 1];
              const prevCtrl = getArcControlPoint(prevSeg.start, prevSeg.end, prevSeg.apex);
              currSeg.apex = calculateTangentArcApex(prevCtrl, currSeg.start, { x, y });
            }

            const pts = generateStrokePointsFromEditableShape({
              type: 'arc',
              arcSegments: segs,
              strokeProps: { color: currentStroke.color, size: currentStroke.size, tool: currentStroke.tool as any }
            });
            currentStroke.points = pts;
            renderCanvasGridAndStrokes(canvas, p.strokes, fullPageBackground, paperTheme, p.enablePressure);
            drawSingleStroke(ctx, currentStroke, false);

            // [곡선을 호로 바꾸고 계속 드래그하다 멈추면 연결된 다음 호가 생성]
            const anchor = chainAnchorRef.current;
            const dist = anchor ? Math.hypot(x - anchor.x, y - anchor.y) : 999;
            if (dist > 22 || !chainHoldTimerRef.current) {
              chainAnchorRef.current = { x, y };
              if (chainHoldTimerRef.current) {
                clearTimeout(chainHoldTimerRef.current);
                chainHoldTimerRef.current = null;
              }
              chainHoldTimerRef.current = setTimeout(() => {
                if (!isDrawingRef.current || !isHoldSnappedRef.current) return;
                if (typeof navigator !== 'undefined' && navigator.vibrate) {
                  try { navigator.vibrate(25); } catch {}
                }
                // 이전 끝점을 시작점으로 하여 다음 연결 호 추가
                arcSegmentsRef.current.push({
                  start: { x, y },
                  apex: { x: x + 1, y: y + 1 },
                  end: { x, y }
                });
                chainAnchorRef.current = { x, y };
              }, 380);
            }
            continue;
          }

          // (C) 원 크기 조절 (Circle Sizing)
          if (chainShapeTypeRef.current === 'circle' && circleDataRef.current) {
            const c = circleDataRef.current;
            const diam = Math.hypot(x - c.pivotX, y - c.pivotY);
            const radius = Math.max(8, diam / 2);
            const cx = (c.pivotX + x) / 2;
            const cy = (c.pivotY + y) / 2;
            c.cx = cx;
            c.cy = cy;
            c.radius = radius;

            currentStroke.points = generateCirclePoints(cx, cy, radius, 0.5);
            renderCanvasGridAndStrokes(canvas, p.strokes, fullPageBackground, paperTheme, p.enablePressure);
            drawSingleStroke(ctx, currentStroke, false);
            continue;
          }

          continue;
        }

        // 2) 일반 필기 중: 다이나믹 가변 필압 계산 (갤럭시 S펜 & 아이패드 애플펜슬 + 속도 보조)
        const pts = currentStroke.points;
        const prevPt = pts[pts.length - 1];

        let effectivePressure = ev.pressure > 0 ? ev.pressure : 0.5;
        // 하드웨어 압력이 0.5 고정(마우스/일반터치)인 경우 속도 기반 가상 압력 보조
        if (effectivePressure === 0.5 && prevPt) {
          const dist = Math.hypot(x - prevPt.x, y - prevPt.y);
          const speed = dist / dt; // px/ms
          effectivePressure = Math.max(0.15, Math.min(0.95, 0.95 - speed * 0.18));
        }

        pts.push({ x, y, pressure: effectivePressure });

        if (prevPt) {
          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          // 🖊️ 가변 두께 (S펜 / 애플펜슬 W3C 센서 또는 속도 다이나믹스)
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

      // ----------------------------------------------------------------------
      // [📐 퀵셰이프 (QuickShape) 홀드 감지]:
      // 펜/형광펜으로 선을 그리고 화면 끝에서 0.38초간 멈추면 직선, 호, 원으로 스냅!
      // (반경 22px 이내의 미세 지터/손떨림은 타이머를 취소하지 않고 계속 유지하여 100% 발동)
      // ----------------------------------------------------------------------
      if (p.enableQuickShape && !isHoldSnappedRef.current && (currentStroke.tool === 'pen' || currentStroke.tool === 'highlighter')) {
        const pts = currentStroke.points;
        const lastPt = pts[pts.length - 1];

        const anchor = holdAnchorCoordRef.current;
        const distFromAnchor = anchor ? Math.hypot(lastPt.x - anchor.x, lastPt.y - anchor.y) : 999;

        // 22px 이상 크게 이동했을 때만 기준점을 갱신하고 타이머를 새로 시작 (지터 방어)
        if (distFromAnchor > 22 || !holdTimerRef.current) {
          holdAnchorCoordRef.current = { x: lastPt.x, y: lastPt.y };
          if (holdTimerRef.current) {
            clearTimeout(holdTimerRef.current);
            holdTimerRef.current = null;
          }

          if (pts.length >= 6) {
            holdTimerRef.current = setTimeout(() => {
              if (!isDrawingRef.current || !currentStrokeRef.current) return;
              const strokeSize = currentStrokeRef.current.size || 3;
              const shape = recognizeShape(currentStrokeRef.current.points, strokeSize);
              if (shape) {
                // 손끝 햅틱 진동 피드백
                if (typeof navigator !== 'undefined' && navigator.vibrate) {
                  try { navigator.vibrate(20); } catch {}
                }

                isHoldSnappedRef.current = true;
                snappedShapeRef.current = shape;

                if (shape.type === 'line' && shape.startPoint && shape.endPoint) {
                  chainShapeTypeRef.current = 'line';
                  polylineVerticesRef.current = [{ ...shape.startPoint }, { ...shape.endPoint }];
                  chainAnchorRef.current = { ...shape.endPoint };
                  currentStrokeRef.current.points = generateStrokePointsFromEditableShape({
                    type: 'line',
                    vertices: polylineVerticesRef.current,
                    strokeProps: { color: currentStrokeRef.current.color, size: currentStrokeRef.current.size, tool: currentStrokeRef.current.tool as any }
                  });
                } else if (shape.type === 'circle' && shape.center && shape.oppositePoint) {
                  chainShapeTypeRef.current = 'circle';
                  circleDataRef.current = {
                    cx: shape.center.x,
                    cy: shape.center.y,
                    radius: shape.radius || 10,
                    pivotX: shape.oppositePoint.x,
                    pivotY: shape.oppositePoint.y
                  };
                  chainAnchorRef.current = { ...(shape.endPoint || shape.oppositePoint) };
                  currentStrokeRef.current.points = shape.points;
                } else if (shape.type === 'curve' && shape.startPoint && shape.apexPoint && shape.endPoint) {
                  chainShapeTypeRef.current = 'arc';
                  arcSegmentsRef.current = [{
                    start: { ...shape.startPoint },
                    apex: { ...shape.apexPoint },
                    end: { ...shape.endPoint }
                  }];
                  chainAnchorRef.current = { ...shape.endPoint };
                  currentStrokeRef.current.points = shape.points;
                } else {
                  currentStrokeRef.current.points = shape.points;
                }

                // 캔버스 배경 및 기존 획 다시 그리기 후 보정된 도형 깔끔 반영 (정갈한 중간 굵기)
                renderCanvasGridAndStrokes(canvas, p.strokes, fullPageBackground, paperTheme, p.enablePressure);
                drawSingleStroke(ctx, currentStrokeRef.current, false);
              }
            }, 380); // 380ms 홀드 감지
          }
        }
      }
    };

    const handleNativePointerUp = (e: PointerEvent) => {
      const p = propsRef.current;

      // 퀵셰이프 및 체이닝 홀드 타이머 리셋
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      if (chainHoldTimerRef.current) {
        clearTimeout(chainHoldTimerRef.current);
        chainHoldTimerRef.current = null;
      }
      holdAnchorCoordRef.current = null;
      chainAnchorRef.current = null;

      // [📐 마우스를 떼면 점의 위치를 조절할 수 있는 편집모드로 진입]
      if (isHoldSnappedRef.current) {
        isHoldSnappedRef.current = false;
        isDrawingRef.current = false;
        activeDrawPointerIdRef.current = null;
        activeDrawPointerTypeRef.current = null;

        const color = currentStrokeRef.current?.color || p.penColor;
        const size = currentStrokeRef.current?.size || p.penSize;
        const tool = (currentStrokeRef.current?.tool || 'pen') as 'pen' | 'highlighter';

        let shapeToEdit: EditableShape | null = null;

        if (chainShapeTypeRef.current === 'line' && polylineVerticesRef.current.length >= 2) {
          shapeToEdit = {
            type: 'line',
            vertices: [...polylineVerticesRef.current],
            strokeProps: { color, size, tool }
          };
        } else if (chainShapeTypeRef.current === 'arc' && arcSegmentsRef.current.length > 0) {
          shapeToEdit = {
            type: 'arc',
            arcSegments: [...arcSegmentsRef.current],
            strokeProps: { color, size, tool }
          };
        } else if (chainShapeTypeRef.current === 'circle' && circleDataRef.current) {
          shapeToEdit = {
            type: 'circle',
            circle: { ...circleDataRef.current },
            strokeProps: { color, size, tool }
          };
        }

        currentStrokeRef.current = null;

        if (shapeToEdit) {
          setEditingShape(shapeToEdit);
          editingShapeRef.current = shapeToEdit;
        }

        if (canvas.hasPointerCapture(e.pointerId)) {
          try { canvas.releasePointerCapture(e.pointerId); } catch {}
        }
        return;
      }

      // 다른 곳 탭하여 도형을 완성한 경우 점 스트로크 생성 방어
      if (isTapToCompleteRef.current) {
        isTapToCompleteRef.current = false;
        currentStrokeRef.current = null;
        isDrawingRef.current = false;
        activeDrawPointerIdRef.current = null;
        activeDrawPointerTypeRef.current = null;
        if (canvas.hasPointerCapture(e.pointerId)) {
          try { canvas.releasePointerCapture(e.pointerId); } catch {}
        }
        return;
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

    // 네이티브 비수동(passive: false) 리스너 직접 부착
    canvas.addEventListener('pointerdown', handleNativePointerDown, { passive: false });
    canvas.addEventListener('pointermove', handleNativePointerMove, { passive: false });
    canvas.addEventListener('pointerup', handleNativePointerUp, { passive: false });
    canvas.addEventListener('pointercancel', handleNativePointerCancel, { passive: false });
    canvas.addEventListener('touchstart', handleNativeTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleNativeTouchMove, { passive: false });

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
      window.removeEventListener('pointerup', handleGlobalWindowPointerUp);
      window.removeEventListener('pointercancel', handleGlobalWindowPointerUp);
    };
  }, []);

  // --------------------------------------------------------------------------
  // [도형 편집 모드 핸들 인터랙션 (마우스/펜/터치 드래그)]
  // --------------------------------------------------------------------------
  const getCanvasCoordsFromEvent = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: e.clientX, y: e.clientY };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const handleHandlePointerDown = (
    e: React.PointerEvent,
    handleInfo: {
      type: 'vertex' | 'arc_point' | 'arc_apex' | 'circle_center' | 'circle_radius';
      index?: number;
      subIndex?: number;
    }
  ) => {
    e.stopPropagation();
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {}
    const coords = getCanvasCoordsFromEvent(e);
    draggingHandleRef.current = {
      ...handleInfo,
      startCoord: coords
    };
  };

  const handleHandlePointerMove = (e: React.PointerEvent) => {
    if (!draggingHandleRef.current || !editingShapeRef.current) return;
    e.stopPropagation();
    const { x, y } = getCanvasCoordsFromEvent(e);
    const h = draggingHandleRef.current;

    const shape: EditableShape = { ...editingShapeRef.current };

    if (shape.type === 'line' && shape.vertices && h.type === 'vertex' && h.index !== undefined) {
      const newVerts = [...shape.vertices];
      newVerts[h.index] = { x, y };
      shape.vertices = newVerts;
    } else if (shape.type === 'arc' && shape.arcSegments) {
      const newSegs = [...shape.arcSegments];
      if (h.type === 'arc_point' && h.index !== undefined) {
        const idx = h.index;
        if (h.subIndex === 0) {
          newSegs[idx] = { ...newSegs[idx], start: { x, y } };
          if (idx > 0) {
            newSegs[idx - 1] = { ...newSegs[idx - 1], end: { x, y } };
          }
        } else {
          newSegs[idx] = { ...newSegs[idx], end: { x, y } };
          if (idx < newSegs.length - 1) {
            newSegs[idx + 1] = { ...newSegs[idx + 1], start: { x, y } };
          }
        }
      } else if (h.type === 'arc_apex' && h.index !== undefined) {
        newSegs[h.index] = { ...newSegs[h.index], apex: { x, y } };
      }
      shape.arcSegments = newSegs;
    } else if (shape.type === 'circle' && shape.circle) {
      const c = { ...shape.circle };
      if (h.type === 'circle_center') {
        c.cx = x;
        c.cy = y;
      } else if (h.type === 'circle_radius') {
        c.radius = Math.max(8, Math.hypot(x - c.cx, y - c.cy));
      }
      shape.circle = c;
    }

    setEditingShape(shape);
    editingShapeRef.current = shape;

    // 캔버스 실시간 피드백 렌더링
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        renderCanvasGridAndStrokes(canvas, propsRef.current.strokes, fullPageBackground, paperTheme, enablePressure);
        const tempStroke: Stroke = {
          id: 'temp_editing_stroke',
          tool: shape.strokeProps.tool,
          color: shape.strokeProps.color,
          size: shape.strokeProps.size,
          points: generateStrokePointsFromEditableShape(shape)
        };
        drawSingleStroke(ctx, tempStroke, false);
      }
    }
  };

  const handleHandlePointerUp = (e: React.PointerEvent) => {
    if (draggingHandleRef.current) {
      e.stopPropagation();
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch {}
      draggingHandleRef.current = null;
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none'
      }}
    >
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

      {/* [도형 편집 모드 조작 핸들 SVG 오버레이] */}
      {editingShape && (
        <svg
          viewBox={`0 0 ${A4_WIDTH} ${A4_HEIGHT}`}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 10
          }}
        >
          <defs>
            <filter id="handle-shadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000000" floodOpacity="0.3" />
            </filter>
          </defs>

          {/* (1) 직선(Line / Polyline) 꼭짓점 핸들 */}
          {editingShape.type === 'line' &&
            editingShape.vertices?.map((v, i) => (
              <g
                key={`line-v-${i}`}
                transform={`translate(${v.x}, ${v.y})`}
                style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                onPointerDown={(e) => handleHandlePointerDown(e, { type: 'vertex', index: i })}
                onPointerMove={handleHandlePointerMove}
                onPointerUp={handleHandlePointerUp}
              >
                {/* 넉넉한 터치 패딩 */}
                <circle r={22} fill="transparent" />
                <circle r={8} fill="#ffffff" stroke="#2563eb" strokeWidth={2.5} filter="url(#handle-shadow)" />
                <circle r={3} fill="#2563eb" />
              </g>
            ))}

          {/* (2) 호(Arc Chain) 연결점 및 정점(곡률) 핸들 */}
          {editingShape.type === 'arc' &&
            editingShape.arcSegments?.map((seg, i) => (
              <g key={`arc-seg-${i}`}>
                {/* 시작점 핸들 (첫 세그먼트만 렌더링) */}
                {i === 0 && (
                  <g
                    transform={`translate(${seg.start.x}, ${seg.start.y})`}
                    style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                    onPointerDown={(e) => handleHandlePointerDown(e, { type: 'arc_point', index: 0, subIndex: 0 })}
                    onPointerMove={handleHandlePointerMove}
                    onPointerUp={handleHandlePointerUp}
                  >
                    <circle r={22} fill="transparent" />
                    <circle r={8} fill="#ffffff" stroke="#2563eb" strokeWidth={2.5} filter="url(#handle-shadow)" />
                    <circle r={3} fill="#2563eb" />
                  </g>
                )}

                {/* 끝점 핸들 */}
                <g
                  transform={`translate(${seg.end.x}, ${seg.end.y})`}
                  style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                  onPointerDown={(e) => handleHandlePointerDown(e, { type: 'arc_point', index: i, subIndex: 1 })}
                  onPointerMove={handleHandlePointerMove}
                  onPointerUp={handleHandlePointerUp}
                >
                  <circle r={22} fill="transparent" />
                  <circle r={8} fill="#ffffff" stroke="#2563eb" strokeWidth={2.5} filter="url(#handle-shadow)" />
                  <circle r={3} fill="#2563eb" />
                </g>

                {/* 곡률 정점(Apex) 핸들 (에메랄드 다이아몬드/원) */}
                <g
                  transform={`translate(${seg.apex.x}, ${seg.apex.y})`}
                  style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                  onPointerDown={(e) => handleHandlePointerDown(e, { type: 'arc_apex', index: i })}
                  onPointerMove={handleHandlePointerMove}
                  onPointerUp={handleHandlePointerUp}
                >
                  <circle r={22} fill="transparent" />
                  <circle r={7} fill="#ffffff" stroke="#059669" strokeWidth={2} filter="url(#handle-shadow)" />
                  <circle r={2.5} fill="#059669" />
                </g>
              </g>
            ))}

          {/* (3) 원(Circle) 중심 및 반지름 핸들 */}
          {editingShape.type === 'circle' && editingShape.circle && (
            <g>
              {/* 중심점 핸들 (위치 이동) */}
              <g
                transform={`translate(${editingShape.circle.cx}, ${editingShape.circle.cy})`}
                style={{ cursor: 'move', pointerEvents: 'auto' }}
                onPointerDown={(e) => handleHandlePointerDown(e, { type: 'circle_center' })}
                onPointerMove={handleHandlePointerMove}
                onPointerUp={handleHandlePointerUp}
              >
                <circle r={22} fill="transparent" />
                <circle r={9} fill="#ffffff" stroke="#2563eb" strokeWidth={2.5} filter="url(#handle-shadow)" />
                <circle r={3.5} fill="#2563eb" />
              </g>

              {/* 둘레 조절 핸들 (반지름 크기 조절) */}
              <g
                transform={`translate(${editingShape.circle.cx + editingShape.circle.radius}, ${editingShape.circle.cy})`}
                style={{ cursor: 'ew-resize', pointerEvents: 'auto' }}
                onPointerDown={(e) => handleHandlePointerDown(e, { type: 'circle_radius' })}
                onPointerMove={handleHandlePointerMove}
                onPointerUp={handleHandlePointerUp}
              >
                <circle r={22} fill="transparent" />
                <circle r={8} fill="#ffffff" stroke="#7c3aed" strokeWidth={2.5} filter="url(#handle-shadow)" />
                <circle r={3} fill="#7c3aed" />
              </g>
            </g>
          )}
        </svg>
      )}

      {/* [도형 편집 완료 / 취소 플로팅 액션 바] */}
      {editingShape && (
        <div
          style={{
            position: 'absolute',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '8px 18px',
            background: 'rgba(15, 23, 42, 0.88)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            borderRadius: 9999,
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.12)',
            color: '#ffffff',
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            pointerEvents: 'auto',
            userSelect: 'none'
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#93c5fd' }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#3b82f6',
                boxShadow: '0 0 8px #60a5fa'
              }}
            />
            {editingShape.type === 'line' ? '직선 편집' : editingShape.type === 'arc' ? '호 곡선 편집' : '원 편집'}
            <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400, marginLeft: 2 }}>
              (빈 곳 터치 시 완료)
            </span>
          </span>

          <span style={{ color: 'rgba(255,255,255,0.2)' }}>|</span>

          <button
            onClick={(e) => {
              e.stopPropagation();
              commitEditingShape();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 14px',
              borderRadius: 9999,
              background: '#2563eb',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              boxShadow: '0 2px 8px rgba(37, 99, 235, 0.4)',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#1d4ed8')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#2563eb')}
          >
            ✓ 도형 완성
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              cancelEditingShape();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '6px 10px',
              borderRadius: 9999,
              background: 'rgba(255, 255, 255, 0.08)',
              color: '#cbd5e1',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.18)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
          >
            취소
          </button>
        </div>
      )}
    </div>
  );
};

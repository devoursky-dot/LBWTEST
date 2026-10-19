import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase, isSupabaseConfigured, localRealtimeChannel, type ClassNoteRecord } from './lib/supabase';

interface StudentInfo {
  grade: string;
  classNum: string;
  studentNum: string;
  name: string;
}

interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}

interface Stroke {
  id: string;
  tool: 'pen' | 'highlighter' | 'eraser';
  color: string;
  size: number;
  points: StrokePoint[];
}

interface TextItem {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
}

interface LessonPage {
  id: string;
  strokes: Stroke[];
  textItems: TextItem[];
}

interface StudentLessonViewProps {
  lessonId: string;
  lessonTitle: string;
  onExit?: () => void;
}

// ============================================================================
// [아이콘 & 기하학 유틸리티]
// ============================================================================

// 사각 고무 지우개 SVG 아이콘 (붓/빗자루 대신 직사각형 지우개 모양)
const EraserIcon: React.FC<{ size?: number; color?: string }> = ({ size = 18, color = 'currentColor' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ display: 'inline-block', verticalAlign: 'middle' }}
  >
    <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
    <path d="M22 21H7" />
    <path d="m5 11 9 9" />
  </svg>
);

// 점(px, py)에서 선분 (x1, y1)-(x2, y2)까지의 최단 거리
function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

// 스트로크와 지우개 반경 충돌 검사 (획 단위 지우개)
function isStrokeHit(stroke: Stroke, px: number, py: number, eraserRadius: number): boolean {
  if (!stroke.points || stroke.points.length === 0) return false;
  const threshold = eraserRadius + (stroke.size || 3) / 2;

  if (stroke.points.length === 1) {
    return Math.hypot(px - stroke.points[0].x, py - stroke.points[0].y) <= threshold;
  }

  for (let i = 0; i < stroke.points.length - 1; i++) {
    const p1 = stroke.points[i];
    const p2 = stroke.points[i + 1];
    if (distToSegment(px, py, p1.x, p1.y, p2.x, p2.y) <= threshold) {
      return true;
    }
  }
  return false;
}

export const StudentLessonView: React.FC<StudentLessonViewProps> = ({
  lessonId,
  lessonTitle,
  onExit
}) => {
  // --- 1. 학생 계정 로그인 상태 (영구 기억) ---
  const [studentInfo, setStudentInfo] = useState<StudentInfo | null>(() => {
    try {
      const saved = localStorage.getItem('lbw_student_info');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [inputGrade, setInputGrade] = useState('3');
  const [inputClassNum, setInputClassNum] = useState('1');
  const [inputStudentNum, setInputStudentNum] = useState('15');
  const [inputName, setInputName] = useState('');
  const [isChangingStudent, setIsChangingStudent] = useState(false);

  // --- 2. 삼성노트 REA 뷰포트 & A4 용지 규격 상태 ---
  // 기본 표준: A4 세로 (Portrait)
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('portrait');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [zoomScale, setZoomScale] = useState<number>(1.0);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // --- 3. 멀티페이지 공책 상태 ---
  const [pages, setPages] = useState<LessonPage[]>([
    { id: 'page_1', strokes: [], textItems: [] }
  ]);
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);

  // 현재 활성 페이지의 데이터 & Undo/Redo 스택 (획 추가 및 획 삭제 모두 지원)
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [undoStack, setUndoStack] = useState<Stroke[][]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[][]>([]);
  const [textItems, setTextItems] = useState<TextItem[]>([]);
  const [activeTextId, setActiveTextId] = useState<string | null>(null);

  // --- 4. 필기 도구 상태 (삼성노트 REA 분리 모드) ---
  const [tool, setTool] = useState<'pen' | 'highlighter' | 'eraser' | 'text'>('pen');
  const [penColor, setPenColor] = useState<string>('#ffffff');
  const [penSize, setPenSize] = useState<number>(3);
  const [highlighterColor, setHighlighterColor] = useState<string>('#fde047');
  const [highlighterSize, setHighlighterSize] = useState<number>(18);
  const [eraserSize, setEraserSize] = useState<number>(24);
  const [eraserMode, setEraserMode] = useState<'stroke' | 'pixel'>('stroke'); // 기본값: 획 지우개
  const [penOnlyMode, setPenOnlyMode] = useState<boolean>(false); // false: 터치 모드, true: 펜 모드 (팜리젝션 & 1손가락 이동)
  const [activePopup, setActivePopup] = useState<'pen' | 'highlighter' | 'eraser' | 'settings' | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // 학생 제출 고유 ID (1인 1행 유지하여 중복 생성 및 타임아웃 방지)
  const submissionIdRef = useRef<string | null>(null);

  // DOM 참조
  const containerRef = useRef<HTMLDivElement>(null);
  const paperSheetRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const isDrawingRef = useRef(false);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const strokeDragStartSnapshotRef = useRef<Stroke[]>([]);
  const didEraseInGestureRef = useRef<boolean>(false);
  const hasInitializedZoomRef = useRef<boolean>(false);

  // 제스처 및 스크롤 추적 ref
  const isGestureRef = useRef(false);
  const initialTouchDistanceRef = useRef(0);
  const initialScaleRef = useRef(1);
  const initialPanRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const initialCenterRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // 멀티터치 직선 생성 방지 및 스마트 팜리젝션(애플펜슬/손바닥 분리) 포인터 추적
  const activePointersRef = useRef<Map<number, { x: number; y: number; type: string }>>(new Map());
  const activeDrawPointerIdRef = useRef<number | null>(null);
  const activeDrawPointerTypeRef = useRef<string | null>(null);

  // 펜 모드 시 손가락 1개 드래그 이동(Pan) ref
  const isFingerPanningRef = useRef(false);
  const fingerPanStartRef = useRef<{ x: number; y: number; pan: { x: number; y: number } }>({ x: 0, y: 0, pan: { x: 0, y: 0 } });

  // 첫 터치 시 자동 전체화면 플래그
  const hasRequestedFullscreenRef = useRef(false);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg(prev => (prev === msg ? null : prev));
    }, 3000);
  };

  // 학생 등록/변경
  const handleSaveStudentInfo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputName.trim()) return;
    const info: StudentInfo = {
      grade: inputGrade.trim(),
      classNum: inputClassNum.trim(),
      studentNum: inputStudentNum.trim(),
      name: inputName.trim()
    };
    setStudentInfo(info);
    localStorage.setItem('lbw_student_info', JSON.stringify(info));
    setIsChangingStudent(false);
    showToast(`👨‍🎓 ${info.grade}학년 ${info.classNum}반 ${info.name} 학생으로 등록되었습니다.`);
  };

  // 전체화면 토글
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      setIsFullscreen(false);
    }
  };

  // 사용자 최초 터치/클릭 시 자동 전체화면 전환 (브라우저 User Gesture 보안 정책 준수)
  const tryAutoFullscreen = useCallback(() => {
    if (!hasRequestedFullscreenRef.current && !document.fullscreenElement) {
      hasRequestedFullscreenRef.current = true;
      document.documentElement.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handleFirstGesture = () => {
      tryAutoFullscreen();
    };
    window.addEventListener('pointerdown', handleFirstGesture, { once: true });
    window.addEventListener('touchstart', handleFirstGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', handleFirstGesture);
      window.removeEventListener('touchstart', handleFirstGesture);
    };
  }, [tryAutoFullscreen]);

  // ==========================================================================
  // [A4 용지 규격 캔버스 초기화]
  // - A4 표준 비율: 1 : √2 ≈ 1 : 1.4142 (세로 210mm x 297mm)
  // - 인쇄 및 모바일/스마트보드 기준: 세로(Portrait) 기본
  // ==========================================================================
  const paperBaseWidth = orientation === 'landscape' ? 1133 : 800;
  const paperBaseHeight = orientation === 'landscape' ? 800 : 1133;

  const A4_WIDTH = orientation === 'landscape' ? 1600 : 1130;
  const A4_HEIGHT = orientation === 'landscape' ? 1130 : 1600;

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (canvas.width !== A4_WIDTH || canvas.height !== A4_HEIGHT) {
      canvas.width = A4_WIDTH;
      canvas.height = A4_HEIGHT;
    }
  }, [A4_WIDTH, A4_HEIGHT]);

  // 단일 스트로크 그리기 유틸리티
  const drawSingleStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
    if (!stroke.points || stroke.points.length === 0) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (stroke.tool === 'highlighter') {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
    } else if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = stroke.size;
    } else {
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
    }

    if (stroke.points.length === 1) {
      ctx.beginPath();
      ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fillStyle = stroke.color;
      ctx.fill();
    } else if (stroke.points.length === 2) {
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      ctx.lineTo(stroke.points[1].x, stroke.points[1].y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

      for (let i = 1; i < stroke.points.length - 1; i++) {
        const midX = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
        const midY = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
        ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, midX, midY);
      }
      const last = stroke.points[stroke.points.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
    ctx.restore();
  };

  // 전체 캔버스 다시 그리기 (A4 모눈종이 + 스트로크)
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 모눈종이 그리드 배경
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const gridSize = 32;

    for (let x = gridSize; x < canvas.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = gridSize; y < canvas.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    ctx.restore();

    // 완료된 모든 스트로크 그리기
    for (const stroke of strokes) {
      drawSingleStroke(ctx, stroke);
    }

    // 현재 실시간 드로잉 중인 획
    if (isDrawingRef.current && currentStrokeRef.current) {
      drawSingleStroke(ctx, currentStrokeRef.current);
    }
  }, [strokes]);

  useEffect(() => {
    resizeCanvas();
    renderCanvas();
  }, [resizeCanvas, renderCanvas, orientation]);

  // ==========================================================================
  // [멀티페이지 전환 & 보존 관리]
  // ==========================================================================

  // 페이지 이동 핸들러 (동기식 페이지 갱신으로 스트로크 유실 방지)
  const handleGoToPage = (targetIdx: number) => {
    if (targetIdx < 0 || targetIdx >= pages.length) return;
    
    const updated = [...pages];
    if (updated[currentPageIndex]) {
      updated[currentPageIndex] = {
        ...updated[currentPageIndex],
        strokes,
        textItems
      };
    }
    setPages(updated);

    const targetPage = updated[targetIdx];
    setCurrentPageIndex(targetIdx);
    setStrokes(targetPage?.strokes || []);
    setTextItems(targetPage?.textItems || []);
    setUndoStack([]);
    setRedoStack([]);
    setActiveTextId(null);
  };

  // 페이지 추가 핸들러
  const handleAddPage = () => {
    const newPage: LessonPage = {
      id: `page_${Date.now()}`,
      strokes: [],
      textItems: []
    };

    const nextIndex = pages.length;
    const updated = [...pages];
    if (updated[currentPageIndex]) {
      updated[currentPageIndex] = {
        ...updated[currentPageIndex],
        strokes,
        textItems
      };
    }
    setPages([...updated, newPage]);
    setCurrentPageIndex(nextIndex);
    setStrokes([]);
    setTextItems([]);
    setUndoStack([]);
    setRedoStack([]);
    setActiveTextId(null);
    showToast(`📄 ${nextIndex + 1}페이지가 추가되었습니다.`);
  };


  // ==========================================================================
  // [삼성노트 REA 좌표 변환 헬퍼 (줌 & 스크롤 반영)]
  // ==========================================================================
  const getCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    return { x, y };
  };

  // ==========================================================================
  // [포인터 이벤트 핸들러 (터치 모드 & 펜 모드, 획 지우개, 멀티터치 직선 방지)]
  // ==========================================================================
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // 1. 브라우저 기본 제스처, 돋보기 루페, 텍스트 선택 모드 원천 차단
    if (e.cancelable) {
      e.preventDefault();
    }

    if (activePopup) {
      setActivePopup(null);
    }

    // 2. 활성 포인터 등록 (포인터 타입 함께 보관)
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

    // 3. [스마트 팜리젝션 1]: 이미 애플펜슬/펜이 필기 중일 때 손바닥(touch)이 닿으면 펜 필기를 취소하지 않고 손바닥 터치만 무시!
    if (isDrawingRef.current && activeDrawPointerTypeRef.current === 'pen') {
      if (e.pointerType === 'touch') {
        return; // 손바닥 터치 무시
      }
    }

    // 4. [펜 모드 전용 특수 동작]: 손가락 터치이면 위치 이동(Pan), 펜/마우스이면 필기!
    if (penOnlyMode) {
      if (e.pointerType === 'touch') {
        if (activePointersRef.current.size === 1) {
          isFingerPanningRef.current = true;
          fingerPanStartRef.current = {
            x: e.clientX,
            y: e.clientY,
            pan: { ...panOffset }
          };
        }
        return;
      }

      // 펜/마우스가 아니면 무시 (손바닥 터치 차단)
      if (e.pointerType !== 'pen' && e.pointerType !== 'mouse') {
        return;
      }
    }

    // 5. [터치 모드에서의 멀티터치 감지]:
    // 펜이 아닌 일반 손가락 터치 모드에서 2개 이상의 손가락 터치가 들어오거나 제스처 중이면 필기 취소
    if (e.pointerType === 'touch') {
      const touchPointers = Array.from(activePointersRef.current.values()).filter(p => p.type === 'touch');
      if (touchPointers.length >= 2 || isGestureRef.current) {
        if (isDrawingRef.current && activeDrawPointerTypeRef.current === 'touch') {
          isDrawingRef.current = false;
          currentStrokeRef.current = null;
          activeDrawPointerIdRef.current = null;
          activeDrawPointerTypeRef.current = null;
          renderCanvas();
        }
        if (isFingerPanningRef.current) {
          isFingerPanningRef.current = false;
        }
        return;
      }
    }

    if (tool === 'text') {
      const { x, y } = getCanvasCoords(e);
      const newId = `text_${Date.now()}`;
      setTextItems(prev => [...prev, { id: newId, x, y, text: '', color: penColor, fontSize: 18 }]);
      setActiveTextId(newId);
      return;
    }

    // 6. 획 지우개 모드
    if (tool === 'eraser' && eraserMode === 'stroke') {
      strokeDragStartSnapshotRef.current = [...strokes];
      didEraseInGestureRef.current = false;
      isDrawingRef.current = true;
      activeDrawPointerIdRef.current = e.pointerId;
      activeDrawPointerTypeRef.current = e.pointerType;

      const { x, y } = getCanvasCoords(e);
      const eraserRadius = Math.max(16, eraserSize / 2);
      const hitStrokes = strokes.filter(s => isStrokeHit(s, x, y, eraserRadius));
      if (hitStrokes.length > 0) {
        didEraseInGestureRef.current = true;
        setStrokes(prev => prev.filter(s => !hitStrokes.some(hs => hs.id === s.id)));
      }
      return;
    }

    // 7. 일반 필기 시작
    isDrawingRef.current = true;
    activeDrawPointerIdRef.current = e.pointerId;
    activeDrawPointerTypeRef.current = e.pointerType;
    strokeDragStartSnapshotRef.current = [...strokes];

    const { x, y } = getCanvasCoords(e);
    const pressure = e.pressure > 0 ? e.pressure : 0.5;

    const currentSize = tool === 'pen' ? penSize : tool === 'highlighter' ? highlighterSize : eraserSize;
    const currentColor = tool === 'highlighter' ? highlighterColor : penColor;

    const newStroke: Stroke = {
      id: `stroke_${Date.now()}_${Math.random()}`,
      tool: tool as 'pen' | 'highlighter' | 'eraser',
      color: currentColor,
      size: currentSize,
      points: [{ x, y, pressure }]
    };

    currentStrokeRef.current = newStroke;

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        drawSingleStroke(ctx, newStroke);
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.cancelable) {
      e.preventDefault();
    }

    // 1. 펜 모드에서 손가락 1개로 드래그 위치 이동 중일 때
    if (isFingerPanningRef.current && e.pointerType === 'touch') {
      const dx = e.clientX - fingerPanStartRef.current.x;
      const dy = e.clientY - fingerPanStartRef.current.y;
      setPanOffset(clampPanOffset({
        x: fingerPanStartRef.current.pan.x + dx,
        y: fingerPanStartRef.current.pan.y + dy
      }, zoomScale));
      return;
    }

    // 2. 필기 중이 아니거나, 필기 중인 포인터 ID와 일치하지 않는 이벤트는 무시 (손바닥 터치 무시!)
    if (!isDrawingRef.current || e.pointerId !== activeDrawPointerIdRef.current) {
      return;
    }

    // 3. 손가락 터치 필기 중일 때 두 손가락 핀치 제스처가 시작된 경우에만 필기 취소
    if (activeDrawPointerTypeRef.current === 'touch' && isGestureRef.current) {
      isDrawingRef.current = false;
      currentStrokeRef.current = null;
      activeDrawPointerIdRef.current = null;
      activeDrawPointerTypeRef.current = null;
      renderCanvas();
      return;
    }

    const { x, y } = getCanvasCoords(e);

    // 4. 획 지우개 모드: 이동 경로에서 스친 획 전체 삭제
    if (tool === 'eraser' && eraserMode === 'stroke') {
      const eraserRadius = Math.max(16, eraserSize / 2);
      setStrokes(prev => {
        const remaining = prev.filter(s => !isStrokeHit(s, x, y, eraserRadius));
        if (remaining.length !== prev.length) {
          didEraseInGestureRef.current = true;
        }
        return remaining;
      });
      return;
    }

    // 5. 일반 필기 및 영역(픽셀) 지우개 실시간 증분 렌더링 (초당 120회 초고속 직결)
    if (!currentStrokeRef.current) return;
    const currentStroke = currentStrokeRef.current;
    const pressure = e.pressure > 0 ? e.pressure : 0.5;
    currentStroke.points.push({ x, y, pressure });

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const pts = currentStroke.points;
        if (pts.length >= 2) {
          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

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
            ctx.lineWidth = currentStroke.size;
          }

          const p1 = pts[pts.length - 2];
          const p2 = pts[pts.length - 1];

          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  };

  const handlePointerUp = (e?: React.PointerEvent<HTMLCanvasElement>) => {
    if (e) {
      activePointersRef.current.delete(e.pointerId);
    }

    // 손가락 팬 종료
    if (isFingerPanningRef.current) {
      isFingerPanningRef.current = false;
    }

    // 획 지우개 종료 및 Undo 히스토리 기록
    if (isDrawingRef.current && tool === 'eraser' && eraserMode === 'stroke') {
      if (!e || e.pointerId === activeDrawPointerIdRef.current) {
        isDrawingRef.current = false;
        activeDrawPointerIdRef.current = null;
        activeDrawPointerTypeRef.current = null;
        if (didEraseInGestureRef.current) {
          setUndoStack(prev => [...prev.slice(-30), strokeDragStartSnapshotRef.current]);
          setRedoStack([]);
          didEraseInGestureRef.current = false;
        }
      }
      return;
    }

    // 일반 필기 종료 처리 (현재 필기 중인 포인터가 떼어졌을 때만 저장)
    if (isDrawingRef.current && e && e.pointerId === activeDrawPointerIdRef.current) {
      isDrawingRef.current = false;
      activeDrawPointerIdRef.current = null;
      activeDrawPointerTypeRef.current = null;

      const finishedStroke = currentStrokeRef.current;
      if (finishedStroke && finishedStroke.points.length > 0) {
        setUndoStack(prev => [...prev.slice(-30), strokeDragStartSnapshotRef.current]);
        setRedoStack([]);
        setStrokes(prev => [...prev, { ...finishedStroke, points: [...finishedStroke.points] }]);
      }
      currentStrokeRef.current = null;
    } else if (isDrawingRef.current && !e) {
      isDrawingRef.current = false;
      activeDrawPointerIdRef.current = null;
      activeDrawPointerTypeRef.current = null;
      currentStrokeRef.current = null;
    }
  };

  // 포인터 취소 이벤트 (iOS Safari 손바닥 분리 처리)
  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.delete(e.pointerId);

    // 취소된 포인터가 현재 필기 중인 포인터인 경우에만 획 보존 후 종료
    if (e.pointerId === activeDrawPointerIdRef.current) {
      handlePointerUp(e);
    }
  };

  // 실행 취소 & 다시 실행 (획 추가 및 획 삭제 모두 지원)
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setRedoStack(prev => [...prev.slice(-30), strokes]);
    setUndoStack(prev => prev.slice(0, -1));
    setStrokes(previous);
  }, [undoStack, strokes]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(prev => [...prev.slice(-30), strokes]);
    setRedoStack(prev => prev.slice(0, -1));
    setStrokes(next);
  }, [redoStack, strokes]);

  // [지우기 1] 현재 페이지만 지우기
  const handleClearCurrentPage = () => {
    if (window.confirm(`현재 ${currentPageIndex + 1}쪽의 필기 내용을 모두 지우시겠습니까?`)) {
      if (strokes.length > 0) {
        setUndoStack(prev => [...prev.slice(-30), strokes]);
        setRedoStack([]);
      }
      setStrokes([]);
      setTextItems([]);
      setActivePopup(null);
      showToast(`🗑️ ${currentPageIndex + 1}쪽 내용이 초기화되었습니다.`);
    }
  };

  // [지우기 2] 전체 페이지 다 지우기
  const handleClearAllPages = () => {
    if (window.confirm('전체 페이지의 모든 필기 내용을 완전히 초기화하시겠습니까?\n(공책의 모든 쪽이 비워집니다)')) {
      const resetPages: LessonPage[] = [{ id: `page_${Date.now()}`, strokes: [], textItems: [] }];
      setPages(resetPages);
      setCurrentPageIndex(0);
      setStrokes([]);
      setTextItems([]);
      setUndoStack([]);
      setRedoStack([]);
      setActivePopup(null);
      showToast('🗑️ 모든 페이지의 필기가 초기화되었습니다.');
    }
  };

  // [지우기 3] 현재 쪽 완전히 삭제 (2쪽 이상일 때)
  const handleDeleteCurrentPage = () => {
    if (pages.length <= 1) {
      showToast('⚠️ 최소 1개 페이지는 유지되어야 합니다.');
      return;
    }
    if (window.confirm(`현재 ${currentPageIndex + 1}쪽을 공책에서 완전히 삭제하시겠습니까?`)) {
      const updated = pages.filter((_, idx) => idx !== currentPageIndex);
      const nextIdx = Math.max(0, currentPageIndex - 1);
      setPages(updated);
      setCurrentPageIndex(nextIdx);
      setStrokes(updated[nextIdx]?.strokes || []);
      setTextItems(updated[nextIdx]?.textItems || []);
      setUndoStack([]);
      setRedoStack([]);
      setActivePopup(null);
      showToast(`🗑️ ${currentPageIndex + 1}쪽이 삭제되었습니다.`);
    }
  };

  // ==========================================================================
  // [동적 확대/축소 배율 계산 (폭 맞춤 100% vs 전체 보기)]
  // - 100% 확대: 화면 가로 폭(Width)에 정확히 맞춤
  // - 전체 보기 (최대 축소): 한 페이지 전체(세로+가로)가 화면에 완전히 다 보일 때까지 축소
  // - 축소 제한: 한 페이지 전체가 보이는 배율보다 더 작아지지 않음 (축소하더라도 한 페이지 전체가 보일 때까지만 축소)
  // ==========================================================================
  const getFitScales = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return { fitWidthScale: 1.0, fitPageScale: 0.6, minScale: 0.6, maxScale: 3.0 };
    }

    const availW = Math.max(200, container.clientWidth - 24);
    const availH = Math.max(200, container.clientHeight - 32);

    // 100% 폭 맞춤 배율 (화면 가로 폭 크기에 맞춤)
    const fitWidthScale = availW / paperBaseWidth;

    // 한 페이지 전체 보기 배율 (화면 높이와 폭 모두에 완전히 쏙 들어오는 최대 축소 기준)
    const fitPageScale = Math.min(availW / paperBaseWidth, availH / paperBaseHeight);

    // 축소는 한 페이지 전체가 다 보일 때까지만 허용 (화면폭보다 작아서 의미 없는 축소 방지)
    const minScale = fitPageScale;
    const maxScale = Math.max(fitWidthScale * 3.0, 3.0);

    return { fitWidthScale, fitPageScale, minScale, maxScale };
  }, [paperBaseWidth, paperBaseHeight]);

  const { fitWidthScale, fitPageScale, minScale, maxScale } = getFitScales();
  const displayPercent = Math.round((zoomScale / fitWidthScale) * 100);
  const isFitWidth = Math.abs(zoomScale - fitWidthScale) < 0.03;
  const isFitPage = Math.abs(zoomScale - fitPageScale) < 0.03;

  // ==========================================================================
  // [가로 크기 기준 가운데 정렬 및 화면 이탈 방지 헬퍼]
  // ==========================================================================
  const clampPanOffset = useCallback((pan: { x: number; y: number }, scale: number): { x: number; y: number } => {
    const container = containerRef.current;
    if (!container) return pan;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    const renderedWidth = paperBaseWidth * scale;
    const renderedHeight = paperBaseHeight * scale;

    // 1. 가로: 화면 폭보다 작거나 같으면 무조건 x = 0 (정중앙 정렬)
    let clampedX = 0;
    if (renderedWidth > containerWidth) {
      const maxPanX = (renderedWidth - containerWidth) / 2 + 16;
      clampedX = Math.max(-maxPanX, Math.min(maxPanX, pan.x));
    } else {
      clampedX = 0;
    }

    // 2. 세로: 화면 높이보다 작거나 같으면 무조건 y = 0 (정중앙 정렬)
    let clampedY = 0;
    if (renderedHeight > containerHeight) {
      const maxPanY = (renderedHeight - containerHeight) / 2 + 24;
      clampedY = Math.max(-maxPanY, Math.min(maxPanY, pan.y));
    } else {
      clampedY = 0;
    }

    return { x: clampedX, y: clampedY };
  }, [paperBaseWidth, paperBaseHeight]);

  // [1] 한 페이지 전체 보기 (최대 축소: 한 페이지 전체가 한눈에 다 보임)
  const handleFitPage = useCallback(() => {
    const { fitPageScale: targetScale } = getFitScales();
    setZoomScale(targetScale);
    setPanOffset({ x: 0, y: 0 });
    showToast('📄 한 페이지 전체 보기에 맞췄습니다.');
  }, [getFitScales]);

  // [2] 화면 폭 맞춤 100% (화면 폭 크기에 맞게 페이지 크기 맞춤)
  const handleFitWidth = useCallback(() => {
    const { fitWidthScale: targetScale } = getFitScales();
    setZoomScale(targetScale);
    setPanOffset(clampPanOffset({ x: 0, y: 0 }, targetScale));
    showToast('↔️ 화면 폭에 100% 맞췄습니다.');
  }, [getFitScales, clampPanOffset]);

  // [3] 폭 맞춤 ↔ 전체 보기 원터치 토글
  const handleToggleZoomFit = useCallback(() => {
    const { fitWidthScale: fw, fitPageScale: fp } = getFitScales();
    if (Math.abs(zoomScale - fw) <= Math.abs(zoomScale - fp)) {
      handleFitPage();
    } else {
      handleFitWidth();
    }
  }, [getFitScales, zoomScale, handleFitPage, handleFitWidth]);

  // 초기 로드 시 한 페이지 전체가 잘림 없이 보이도록 전체 보기에 자동 맞춤
  useEffect(() => {
    if (!hasInitializedZoomRef.current && containerRef.current) {
      hasInitializedZoomRef.current = true;
      const { fitPageScale: targetScale } = getFitScales();
      setZoomScale(targetScale);
      setPanOffset({ x: 0, y: 0 });
    }
  }, [getFitScales]);

  // 방향 전환 및 화면 크기 변화 시 클램핑 및 가로/세로 정렬 유지
  useEffect(() => {
    setPanOffset(prev => clampPanOffset(prev, zoomScale));
  }, [orientation, zoomScale, clampPanOffset]);

  useEffect(() => {
    const handleResize = () => {
      const { minScale: minS, maxScale: maxS } = getFitScales();
      setZoomScale(prev => {
        const next = Math.min(maxS, Math.max(minS, prev));
        setPanOffset(p => clampPanOffset(p, next));
        return next;
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [getFitScales, clampPanOffset]);

  // ==========================================================================
  // [휠 줌 및 스크롤 이벤트 핸들러 - 마우스 커서 위치 중심 줌]
  // ==========================================================================
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const { minScale: minS, maxScale: maxS } = getFitScales();
    if (e.ctrlKey) {
      // Ctrl + 휠: 마우스 커서 위치 중심 확대/축소 (최소 배율은 한 페이지 전체 보기로 제한!)
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const nextScale = Math.min(maxS, Math.max(minS, zoomScale * zoomFactor));
      if (nextScale === zoomScale) return;

      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const viewportCenterX = rect.left + rect.width / 2;
        const viewportCenterY = rect.top + rect.height / 2;

        const deltaX = e.clientX - viewportCenterX;
        const deltaY = e.clientY - viewportCenterY;
        const scaleRatio = nextScale / zoomScale;

        const rawPanX = panOffset.x * scaleRatio + deltaX * (1 - scaleRatio);
        const rawPanY = panOffset.y * scaleRatio + deltaY * (1 - scaleRatio);

        setPanOffset(clampPanOffset({ x: rawPanX, y: rawPanY }, nextScale));
      }
      setZoomScale(nextScale);
    } else {
      // 일반 휠: 위아래 / 좌우 스크롤
      setPanOffset(prev => {
        const nextX = prev.x - (e.shiftKey ? e.deltaY : e.deltaX);
        const nextY = prev.y - (!e.shiftKey ? e.deltaY : 0);
        return clampPanOffset({ x: nextX, y: nextY }, zoomScale);
      });
    }
  };

  // 삼성노트 REA 2손가락 핀치 줌 & 팬
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onTouchStart = (e: TouchEvent) => {
      // 애플펜슬 필기 중 손바닥이 닿아 발생하는 터치는 핀치 제스처로 오인하지 않도록 완벽 무시
      if (isDrawingRef.current && activeDrawPointerTypeRef.current === 'pen') {
        return;
      }

      if (e.touches.length >= 2) {
        isGestureRef.current = true;

        if (isDrawingRef.current) {
          isDrawingRef.current = false;
          currentStrokeRef.current = null;
          activeDrawPointerIdRef.current = null;
          activeDrawPointerTypeRef.current = null;
          renderCanvas();
        }
        if (isFingerPanningRef.current) {
          isFingerPanningRef.current = false;
        }

        const t1 = e.touches[0];
        const t2 = e.touches[1];
        initialTouchDistanceRef.current = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        initialScaleRef.current = zoomScale;
        initialPanRef.current = { ...panOffset };
        initialCenterRef.current = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (isGestureRef.current && e.touches.length >= 2) {
        if (e.cancelable) e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currentDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const currentCenter = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2
        };

        if (initialTouchDistanceRef.current > 0) {
          const ratio = currentDist / initialTouchDistanceRef.current;
          const { minScale: minS, maxScale: maxS } = getFitScales();
          // 축소 시 한 페이지 전체가 보일 때까지만(minScale) 제한
          const nextScale = Math.min(maxS, Math.max(minS, initialScaleRef.current * ratio));
          setZoomScale(nextScale);

          const rect = container.getBoundingClientRect();
          const viewportCenterX = rect.left + rect.width / 2;
          const viewportCenterY = rect.top + rect.height / 2;

          const initialFocalRelX = initialCenterRef.current.x - viewportCenterX;
          const initialFocalRelY = initialCenterRef.current.y - viewportCenterY;

          const translationX = currentCenter.x - initialCenterRef.current.x;
          const translationY = currentCenter.y - initialCenterRef.current.y;

          const scaleChangeRatio = nextScale / initialScaleRef.current;

          const rawPanX = (initialPanRef.current.x * scaleChangeRatio) + (initialFocalRelX * (1 - scaleChangeRatio)) + translationX;
          const rawPanY = (initialPanRef.current.y * scaleChangeRatio) + (initialFocalRelY * (1 - scaleChangeRatio)) + translationY;

          setPanOffset(clampPanOffset({ x: rawPanX, y: rawPanY }, nextScale));
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        // 두 손가락 제스처 종료 직후 1개 손가락 잔여 터치로 인한 오작동 방지 (150ms 쿨다운)
        setTimeout(() => {
          isGestureRef.current = false;
        }, 150);
      }
      if (e.touches.length === 0) {
        activePointersRef.current.clear();
        isDrawingRef.current = false;
        isFingerPanningRef.current = false;
        activeDrawPointerIdRef.current = null;
      }
    };

    const onSelectStart = (e: Event) => {
      e.preventDefault();
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
    container.addEventListener('selectstart', onSelectStart);

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('selectstart', onSelectStart);
    };
  }, [zoomScale, panOffset, clampPanOffset]);

  // 팝오버 메뉴 외부 클릭 시 자동 닫기 (이벤트 버블링 및 렌더링 노드 분리 방어)
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target || !target.isConnected) return;
      if (!target.closest('.student-toolbar') && !target.closest('.samsung-tool-popup')) {
        setActivePopup(null);
      }
    };
    if (activePopup) {
      const timer = setTimeout(() => {
        document.addEventListener('click', handleClickOutside);
      }, 50);
      return () => {
        clearTimeout(timer);
        document.removeEventListener('click', handleClickOutside);
      };
    }
  }, [activePopup]);

  // 이전 필기 복원 (학생이 다시 들어왔을 때 이전 내용 자동 로드)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`lbw_lesson_${lessonId}_note_v2`);
      if (saved) {
        const data = JSON.parse(saved);
        if (data.pages && Array.isArray(data.pages) && data.pages.length > 0) {
          setPages(data.pages);
          setStrokes(data.pages[0].strokes || []);
          setTextItems(data.pages[0].textItems || []);
        } else if (data.strokes) {
          setStrokes(data.strokes);
          if (data.textItems) setTextItems(data.textItems);
        }
        if (data.orientation) {
          setOrientation(data.orientation);
        }
      }
    } catch (e) {
      console.warn('Failed to restore note:', e);
    }
  }, [lessonId]);

  // 학생 필기 포인트 최적화 헬퍼 (좌표 반올림 및 미세 떨림 필터링으로 데이터 60% 경량화)
  const optimizePoints = (points: StrokePoint[]): StrokePoint[] => {
    if (!points || points.length === 0) return [];
    if (points.length <= 2) {
      return points.map(p => ({
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        pressure: Math.round((p.pressure ?? 0.5) * 100) / 100
      }));
    }
    const result: StrokePoint[] = [];
    let prev = points[0];
    result.push({
      x: Math.round(prev.x * 10) / 10,
      y: Math.round(prev.y * 10) / 10,
      pressure: Math.round((prev.pressure ?? 0.5) * 100) / 100
    });
    for (let i = 1; i < points.length - 1; i++) {
      const cur = points[i];
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      // 2픽셀 미만의 미세 떨림/중복 터치 좌표 필터링 (가독성 손실 없이 데이터 대폭 절감)
      if (dx * dx + dy * dy >= 2.0) {
        result.push({
          x: Math.round(cur.x * 10) / 10,
          y: Math.round(cur.y * 10) / 10,
          pressure: Math.round((cur.pressure ?? 0.5) * 100) / 100
        });
        prev = cur;
      }
    }
    const last = points[points.length - 1];
    result.push({
      x: Math.round(last.x * 10) / 10,
      y: Math.round(last.y * 10) / 10,
      pressure: Math.round((last.pressure ?? 0.5) * 100) / 100
    });
    return result;
  };

  // ==========================================================================
  // [등록 및 제출하기 (멀티페이지 통합 저장 & 중복 방지 최적화)]
  // ==========================================================================
  const handleSubmitLesson = async () => {
    if (!studentInfo) {
      setIsChangingStudent(true);
      return;
    }

    // 현재 페이지 데이터 동기화
    const updatedPages = [...pages];
    updatedPages[currentPageIndex] = {
      ...updatedPages[currentPageIndex],
      strokes,
      textItems
    };

    // 끝부분의 불필요한 빈 페이지만 정리 (2쪽 이상인 경우)
    let finalPages = [...updatedPages];
    while (
      finalPages.length > 1 &&
      (!finalPages[finalPages.length - 1].strokes || finalPages[finalPages.length - 1].strokes.length === 0) &&
      (!finalPages[finalPages.length - 1].textItems || finalPages[finalPages.length - 1].textItems.length === 0)
    ) {
      finalPages.pop();
    }

    const hasAnyContent = finalPages.some(
      p => (p.strokes && p.strokes.length > 0) || (p.textItems && p.textItems.length > 0)
    );

    if (!hasAnyContent) {
      showToast('⚠️ 필기나 타이핑한 내용이 없습니다.');
      return;
    }

    setIsSubmitting(true);
    showToast(`🚀 '${studentInfo.name}' 학생의 필기를 등록하는 중...`);

    try {
      const now = new Date().toISOString();

      // 스트로크 포인트 경량화 최적화 적용
      const optimizedPages = finalPages.map(p => ({
        ...p,
        strokes: (p.strokes || []).map(s => ({
          ...s,
          points: optimizePoints(s.points)
        }))
      }));

      // 1. 학생 필기 멀티페이지 데이터를 로컬 스토리지에 안전 백업 (QuotaExceeded 예외 보호)
      const studentPayload = {
        student: studentInfo,
        lessonId,
        pages: optimizedPages,
        orientation,
        timestamp: now
      };
      try {
        localStorage.setItem(`lbw_lesson_${lessonId}_note_v2`, JSON.stringify(studentPayload));
      } catch (lsErr) {
        console.warn('LocalStorage 용량 초과(무시하고 클라우드 전송):', lsErr);
      }

      // 2. 기존 등록 row ID 확인 (1인 1행 유지하여 중복 생성 및 DB 타임아웃 원천 방지)
      let targetRowId = submissionIdRef.current;
      if (!targetRowId && supabase && isSupabaseConfigured) {
        try {
          const { data: existingRows } = await supabase
            .from('class_notes')
            .select('id')
            .eq('lesson_id', lessonId)
            .eq('student_grade', studentInfo.grade)
            .eq('student_class', studentInfo.classNum)
            .eq('student_num', studentInfo.studentNum)
            .order('updated_at', { ascending: false })
            .limit(1);

          if (existingRows && existingRows.length > 0) {
            targetRowId = existingRows[0].id;
            submissionIdRef.current = targetRowId;
          }
        } catch (findErr) {
          console.warn('기존 제출 ID 조회 경고:', findErr);
        }
      }

      const record: ClassNoteRecord = {
        ...(targetRowId ? { id: targetRowId } : {}),
        lesson_id: lessonId,
        student_grade: studentInfo.grade,
        student_class: studentInfo.classNum,
        student_num: studentInfo.studentNum,
        student_name: studentInfo.name,
        strokes_data: {
          pages: optimizedPages,
          orientation,
          // 하위 호환용 1페이지 데이터
          strokes: optimizedPages[0]?.strokes || [],
          textItems: optimizedPages[0]?.textItems || []
        },
        updated_at: now
      };

      // 3. Supabase 클라우드 실시간 업서트 (기존 ID가 있으면 UPDATE, 없으면 INSERT)
      if (supabase && isSupabaseConfigured) {
        const { data: savedData, error: sbError } = await supabase
          .from('class_notes')
          .upsert([record])
          .select('id')
          .single();

        if (sbError) {
          console.error('Supabase 저장 실패:', sbError.message);
          throw new Error(sbError.message);
        } else if (savedData?.id) {
          submissionIdRef.current = savedData.id;
        }
      }

      // 4. 로컬 브로드캐스트 채널 전송
      if (localRealtimeChannel) {
        localRealtimeChannel.postMessage({
          type: 'STUDENT_SUBMIT',
          record: {
            ...record,
            id: submissionIdRef.current || record.id
          }
        });
      }

      showToast(`🎉 '${studentInfo.name}' 학생의 ${optimizedPages.length}페이지 필기가 등록되었습니다!`);
    } catch (err: any) {
      console.error('제출 오류:', err);
      showToast(`❌ 등록 실패: ${err.message || '네트워크 오류'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="student-app-container"
      onContextMenu={(e) => e.preventDefault()}
      style={{
        overflow: 'hidden',
        position: 'relative',
        touchAction: 'none',
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none'
      }}
    >
      {/* 1. 상단 학생 식별 및 액션 바 */}
      <header className="student-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span style={{ fontSize: '20px' }}>🏫</span>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {lessonTitle}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--g-text-secondary)' }}>
              삼성노트 REA 디지털 스마트 노트
            </span>
          </div>
        </div>

        {/* 학생 정보 배지 및 조절 버튼 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {studentInfo ? (
            <div
              onClick={() => setIsChangingStudent(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(59, 130, 246, 0.15)',
                border: '1px solid var(--g-primary-blue)',
                padding: '4px 10px',
                borderRadius: 'var(--radius-full)',
                cursor: 'pointer',
                fontSize: '12px',
                color: '#ffffff'
              }}
              title="클릭하여 학생 정보 수정"
            >
              <span>👨‍🎓</span>
              <span style={{ fontWeight: 600 }}>
                {studentInfo.grade}학년 {studentInfo.classNum}반 {studentInfo.studentNum}번 {studentInfo.name}
              </span>
              <span style={{ fontSize: '10px', color: '#93c5fd' }}>✏️</span>
            </div>
          ) : (
            <button
              className="g-btn g-btn-primary"
              style={{ fontSize: '12px', padding: '4px 10px' }}
              onClick={() => setIsChangingStudent(true)}
            >
              👨‍🎓 학생 등록
            </button>
          )}

          {/* 전체화면 토글 */}
          <button
            id="btn-toggle-fullscreen"
            type="button"
            className="student-tool-btn"
            onClick={toggleFullscreen}
            style={{ padding: '5px 9px', fontSize: '12px' }}
            title={isFullscreen ? '전체화면 종료' : '전체화면으로 몰입 필기'}
          >
            {isFullscreen ? '🗗 창모드' : '⛶ 전체화면'}
          </button>

          {/* 등록하기 제출 버튼 */}
          <button
            id="btn-submit-lesson"
            type="button"
            className="g-btn g-btn-primary"
            style={{
              fontSize: '12.5px',
              fontWeight: 700,
              padding: '6px 14px',
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              border: 'none',
              boxShadow: '0 4px 12px rgba(16, 185, 129, 0.4)'
            }}
            disabled={isSubmitting}
            onClick={handleSubmitLesson}
          >
            {isSubmitting ? '전송 중...' : '🚀 등록하기'}
          </button>

          {onExit && (
            <button className="g-btn g-btn-text" style={{ fontSize: '12px', padding: '4px 8px' }} onClick={onExit}>
              나가기
            </button>
          )}
        </div>
      </header>

      {/* 2. 툴바 (필기 핵심 도구 최우선 배치 + 더보기 ⚙️ 설정 & 지우기 서브메뉴) */}
      <div className="student-toolbar" style={{ flexWrap: 'nowrap', gap: '5px', padding: '4px 10px', position: 'relative', overflowX: 'auto', overflowY: 'visible' }}>
        
        {/* [A] 필기 도구 모음 (삼성노트 REA 탭 확장 팝오버) */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center', flexShrink: 0 }}>
          {/* 1. 펜 도구 & 팝오버 토글 */}
          <button
            id="btn-tool-pen"
            type="button"
            className={`student-tool-btn ${tool === 'pen' ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (tool !== 'pen') {
                setTool('pen');
                setActivePopup('pen');
              } else {
                setActivePopup(prev => prev === 'pen' ? null : 'pen');
              }
            }}
            style={{
              position: 'relative',
              flexDirection: 'column',
              justifyContent: 'center',
              height: '38px',
              padding: '2px 8px',
              gap: '2px'
            }}
            title="일반 펜 (클릭 시 굵기 및 색상 팔레트 열기)"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: '13px' }}>
              <span>🖊️</span>
              <span style={{ fontSize: '9px', opacity: 0.8 }}>{activePopup === 'pen' ? '▲' : '▼'}</span>
            </div>
            {/* 현재 펜 색상 및 굵기 표시 인디케이터 바 */}
            <div
              style={{
                width: '18px',
                height: `${Math.min(5, Math.max(2, penSize))}px`,
                borderRadius: '2px',
                backgroundColor: penColor,
                boxShadow: '0 0 3px rgba(0,0,0,0.5)',
                border: penColor === '#000000' ? '1px solid #777' : undefined
              }}
            />
          </button>

          {/* 2. 형광펜 도구 & 팝오버 토글 */}
          <button
            id="btn-tool-highlighter"
            type="button"
            className={`student-tool-btn ${tool === 'highlighter' ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (tool !== 'highlighter') {
                setTool('highlighter');
                setActivePopup('highlighter');
              } else {
                setActivePopup(prev => prev === 'highlighter' ? null : 'highlighter');
              }
            }}
            style={{
              position: 'relative',
              flexDirection: 'column',
              justifyContent: 'center',
              height: '38px',
              padding: '2px 8px',
              gap: '2px'
            }}
            title="형광펜 (반투명 강조, 클릭 시 굵기 및 형광색 설정)"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: '13px' }}>
              <span>🖍️</span>
              <span style={{ fontSize: '9px', opacity: 0.8 }}>{activePopup === 'highlighter' ? '▲' : '▼'}</span>
            </div>
            {/* 형광펜 색상 및 굵기 인디케이터 */}
            <div
              style={{
                width: '18px',
                height: '4px',
                borderRadius: '2px',
                backgroundColor: highlighterColor,
                opacity: 0.8,
                boxShadow: `0 0 4px ${highlighterColor}`
              }}
            />
          </button>

          {/* 3. 지우개 도구 & 팝오버 토글 */}
          <button
            id="btn-tool-eraser"
            type="button"
            className={`student-tool-btn ${tool === 'eraser' ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (tool !== 'eraser') {
                setTool('eraser');
                setActivePopup('eraser');
              } else {
                setActivePopup(prev => prev === 'eraser' ? null : 'eraser');
              }
            }}
            style={{
              position: 'relative',
              flexDirection: 'column',
              justifyContent: 'center',
              height: '38px',
              padding: '2px 8px',
              gap: '2px'
            }}
            title={`지우개 (${eraserMode === 'stroke' ? '획 지우개' : '영역 지우개'}, 클릭 시 모드 및 크기 설정)`}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: '13px' }}>
              <EraserIcon size={16} color={tool === 'eraser' ? '#38bdf8' : '#e2e8f0'} />
              <span style={{ fontSize: '9px', opacity: 0.8 }}>{activePopup === 'eraser' ? '▲' : '▼'}</span>
            </div>
            <div
              style={{
                width: '16px',
                height: '3px',
                borderRadius: '2px',
                backgroundColor: eraserMode === 'stroke' ? '#38bdf8' : '#cbd5e1'
              }}
            />
          </button>

          {/* 4. 텍스트 타이핑 */}
          <button
            id="btn-tool-text"
            type="button"
            className={`student-tool-btn ${tool === 'text' ? 'active' : ''}`}
            onClick={() => {
              setTool('text');
              setActivePopup(null);
            }}
            style={{ height: '38px', padding: '0 8px' }}
            title="텍스트 타이핑 (원하는 위치 클릭하여 글씨 입력)"
          >
            ⌨️
          </button>
        </div>

        <div className="toolbar-divider" />

        {/* [B] 퀵 컬러 스와치 (원터치 빠른 색상 3개: 흰색, 빨강, 파랑) */}
        <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexShrink: 0 }}>
          {[
            { color: '#ffffff', label: '흰색' },
            { color: '#ef4444', label: '빨강' },
            { color: '#3b82f6', label: '파랑' }
          ].map(({ color, label }) => (
            <button
              key={color}
              type="button"
              className={`color-dot-btn ${penColor === color && tool === 'pen' ? 'selected' : ''}`}
              style={{
                backgroundColor: color,
                width: '20px',
                height: '20px',
                border: '1px solid rgba(255,255,255,0.25)'
              }}
              onClick={() => {
                setPenColor(color);
                if (tool === 'eraser') setTool('pen');
                setActivePopup(null);
                showToast(`🖊️ ${label} 펜 선택`);
              }}
              title={`${label} 펜으로 원터치 전환`}
            />
          ))}
        </div>

        <div className="toolbar-divider" />

        {/* [C] 실행 취소 & 다시 실행 */}
        <div style={{ display: 'flex', gap: '2px', alignItems: 'center', flexShrink: 0 }}>
          <button
            type="button"
            className="student-tool-btn"
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            style={{ opacity: undoStack.length === 0 ? 0.35 : 1.0, padding: '3px 7px', height: '34px' }}
            title="실행 취소 (Ctrl+Z)"
          >
            ↩️
          </button>
          <button
            type="button"
            className="student-tool-btn"
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            style={{ opacity: redoStack.length === 0 ? 0.35 : 1.0, padding: '3px 7px', height: '34px' }}
            title="다시 실행 (Ctrl+Y)"
          >
            ↪️
          </button>
        </div>

        <div className="toolbar-divider" />

        {/* [C-2] 터치 모드 / 펜 모드 원터치 전환 버튼 */}
        <button
          id="btn-input-mode-toggle"
          type="button"
          className={`student-tool-btn ${penOnlyMode ? 'active-pen-mode' : ''}`}
          onClick={() => {
            const next = !penOnlyMode;
            setPenOnlyMode(next);
            showToast(next ? '✏️ 펜 모드 ON (펜 전용 필기, 손가락은 화면 이동)' : '🖐️ 터치 모드 ON (손가락과 펜 모두 필기)');
          }}
          style={{
            padding: '3px 8px',
            height: '34px',
            fontSize: '11.5px',
            background: penOnlyMode ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255, 255, 255, 0.06)',
            border: penOnlyMode ? '1px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.12)',
            color: penOnlyMode ? '#93c5fd' : '#cbd5e1',
            gap: '3px',
            flexShrink: 0
          }}
          title={
            penOnlyMode
              ? '현재: 펜 모드 (애플펜슬/스타일러스 전용 필기, 손가락은 화면 이동) - 클릭하여 터치 모드로 전환'
              : '현재: 터치 모드 (손가락 및 펜 모두 필기 가능) - 클릭하여 펜 모드로 전환'
          }
        >
          {penOnlyMode ? '✏️ 펜 모드' : '🖐️ 터치 모드'}
        </button>

        <div className="toolbar-divider" />

        {/* [D] 페이지 탐색 및 새 페이지 추가 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(255,255,255,0.06)', borderRadius: '8px', padding: '2px 5px', flexShrink: 0 }}>
          <button
            id="btn-page-prev"
            type="button"
            className="student-tool-btn"
            disabled={currentPageIndex <= 0}
            onClick={() => handleGoToPage(currentPageIndex - 1)}
            style={{ padding: '2px 5px', fontSize: '11px', height: '28px', opacity: currentPageIndex <= 0 ? 0.3 : 1 }}
            title="이전 쪽"
          >
            ◀
          </button>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#38bdf8', minWidth: '42px', textAlign: 'center' }}>
            {currentPageIndex + 1}/{pages.length}쪽
          </span>
          <button
            id="btn-page-next"
            type="button"
            className="student-tool-btn"
            disabled={currentPageIndex >= pages.length - 1}
            onClick={() => handleGoToPage(currentPageIndex + 1)}
            style={{ padding: '2px 5px', fontSize: '11px', height: '28px', opacity: currentPageIndex >= pages.length - 1 ? 0.3 : 1 }}
            title="다음 쪽"
          >
            ▶
          </button>
          <button
            id="btn-add-page"
            type="button"
            className="student-tool-btn"
            onClick={handleAddPage}
            style={{ padding: '2px 6px', fontSize: '11px', height: '28px', background: 'rgba(59, 130, 246, 0.25)', color: '#93c5fd', fontWeight: 600 }}
            title="새 페이지 추가"
          >
            +쪽
          </button>
        </div>

        {/* [E] 우측 줌 맞춤 및 설정 */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          {/* 1. 한 페이지 전체 보기 (최대 축소) */}
          <button
            id="btn-zoom-fit-page"
            type="button"
            className={`student-tool-btn ${isFitPage ? 'active' : ''}`}
            onClick={handleFitPage}
            style={{
              padding: '3px 7px',
              fontSize: '11px',
              height: '32px',
              background: isFitPage ? 'rgba(168, 85, 247, 0.25)' : 'rgba(255, 255, 255, 0.05)',
              border: isFitPage ? '1px solid #a855f7' : '1px solid rgba(255, 255, 255, 0.1)',
              color: isFitPage ? '#d8b4fe' : '#cbd5e1'
            }}
            title="한 페이지 전체 보기 (최대 축소)"
          >
            📄 전체
          </button>

          {/* 2. 100% 폭 맞춤 */}
          <button
            id="btn-zoom-fit-width"
            type="button"
            className={`student-tool-btn ${isFitWidth ? 'active' : ''}`}
            onClick={handleFitWidth}
            style={{
              padding: '3px 7px',
              fontSize: '11px',
              height: '32px',
              fontWeight: 600,
              background: isFitWidth ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255, 255, 255, 0.05)',
              border: isFitWidth ? '1px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.1)',
              color: isFitWidth ? '#93c5fd' : '#cbd5e1'
            }}
            title="화면 폭에 100% 맞춤"
          >
            ↔️ 100% 폭
          </button>

          {/* 3. 배율 표시 & 원터치 토글 */}
          <span
            onClick={handleToggleZoomFit}
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: isFitWidth ? '#38bdf8' : isFitPage ? '#c084fc' : 'var(--g-text-secondary)',
              cursor: 'pointer',
              padding: '3px 6px',
              borderRadius: '4px',
              background: isFitWidth || isFitPage ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
              minWidth: '40px',
              textAlign: 'center'
            }}
            title="클릭 시 [100% 폭 맞춤] ↔ [전체 보기] 전환"
          >
            🔍 {displayPercent}%
          </span>

          <button
            id="btn-settings-toggle"
            type="button"
            className={`student-tool-btn ${activePopup === 'settings' ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setActivePopup(prev => prev === 'settings' ? null : 'settings');
            }}
            style={{
              padding: '3px 8px',
              fontSize: '12px',
              height: '32px',
              background: activePopup === 'settings' ? 'var(--g-primary-blue)' : 'rgba(255,255,255,0.08)',
              color: activePopup === 'settings' ? '#ffffff' : 'var(--g-text-secondary)',
              border: '1px solid var(--g-border)'
            }}
            title="용지 방향, 입력 모드, 페이지 관리 메뉴"
          >
            ⚙️ 설정 {activePopup === 'settings' ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* ====================================================================
          플로팅 툴 팝오버 (툴바 바깥 렌더링으로 클리핑 방지)
          ==================================================================== */}
        {activePopup === 'pen' && (
          <div
            id="popup-pen-settings"
            className="samsung-tool-popup"
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'absolute', top: '96px', left: '8px', zIndex: 1000, width: '280px', maxWidth: 'calc(100vw - 16px)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#ffffff' }}>🖊️ 펜 설정</span>
              <button
                type="button"
                onClick={() => setActivePopup(null)}
                style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '14px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* 실시간 굵기 미리보기 곡선 */}
            <div className="samsung-preview-box">
              <svg width="170" height="32" viewBox="0 0 170 32" style={{ overflow: 'visible' }}>
                <path
                  d="M 10 16 Q 45 4, 85 16 T 160 16"
                  fill="none"
                  stroke={penColor}
                  strokeWidth={penSize}
                  strokeLinecap="round"
                />
              </svg>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#38bdf8' }}>{penSize}px</span>
            </div>

            {/* 굵기 슬라이더 & 프리셋 점 */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--g-text-secondary)', marginBottom: '5px' }}>
                <span>펜 굵기</span>
                <span>1px ~ 30px</span>
              </div>
              <input
                type="range"
                min="1"
                max="30"
                value={penSize}
                onChange={(e) => setPenSize(Number(e.target.value))}
                className="samsung-range-slider"
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
                {[1, 3, 6, 12, 24].map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    className={`size-dot-btn ${penSize === sz ? 'selected' : ''}`}
                    onClick={() => setPenSize(sz)}
                    style={{ width: '28px', height: '28px' }}
                    title={`${sz}px`}
                  >
                    <div
                      style={{
                        width: `${Math.min(18, Math.max(3, sz))}px`,
                        height: `${Math.min(18, Math.max(3, sz))}px`,
                        borderRadius: '50%',
                        background: penSize === sz ? '#ffffff' : 'rgba(255, 255, 255, 0.7)'
                      }}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div style={{ height: '1px', background: 'var(--g-border-subtle)' }} />

            {/* 색상 팔레트 그리드 (기본 6색 + 파스텔 6색 + 커스텀 피커) */}
            <div>
              <div style={{ fontSize: '11px', color: 'var(--g-text-secondary)', marginBottom: '6px', fontWeight: 600 }}>
                색상 팔레트
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px' }}>
                {[
                  '#ffffff', '#000000', '#ef4444', '#3b82f6', '#eab308', '#22c55e',
                  '#38bdf8', '#a855f7', '#fb7185', '#34d399', '#fb923c', '#9ca3af'
                ].map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`color-dot-btn ${penColor === color ? 'selected' : ''}`}
                    style={{
                      backgroundColor: color,
                      width: '26px',
                      height: '26px',
                      border: color === '#000000' ? '1px solid #555' : undefined,
                      margin: '0 auto'
                    }}
                    onClick={() => setPenColor(color)}
                  />
                ))}
              </div>

              {/* 커스텀 색상 선택기 */}
              <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '11px', color: 'var(--g-text-secondary)' }}>직접 색상 지정</span>
                <label
                  style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '3px 8px',
                    background: 'rgba(255,255,255,0.08)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '11.5px',
                    color: '#ffffff'
                  }}
                >
                  <input
                    type="color"
                    value={penColor}
                    onChange={(e) => setPenColor(e.target.value)}
                    style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
                  />
                  <span style={{
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
                    display: 'inline-block'
                  }} />
                  <span>팔레트 🎨</span>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* ====================================================================
            [팝오버 2] 삼성노트 REA 🖍️ 형광펜 설정 팝오버
            ==================================================================== */}
        {activePopup === 'highlighter' && (
          <div
            id="popup-highlighter-settings"
            className="samsung-tool-popup"
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'absolute', top: '96px', left: '40px', zIndex: 1000, width: '280px', maxWidth: 'calc(100vw - 16px)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#ffffff' }}>🖍️ 형광펜 설정</span>
              <button
                type="button"
                onClick={() => setActivePopup(null)}
                style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '14px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* 실시간 형광선 미리보기 */}
            <div className="samsung-preview-box">
              <svg width="170" height="32" viewBox="0 0 170 32" style={{ overflow: 'visible' }}>
                <path
                  d="M 10 16 Q 45 4, 85 16 T 160 16"
                  fill="none"
                  stroke={highlighterColor}
                  strokeWidth={highlighterSize}
                  strokeLinecap="round"
                  opacity="0.4"
                />
              </svg>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#fde047' }}>{highlighterSize}px</span>
            </div>

            {/* 굵기 슬라이더 & 프리셋 */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--g-text-secondary)', marginBottom: '5px' }}>
                <span>형광펜 굵기</span>
                <span>6px ~ 48px</span>
              </div>
              <input
                type="range"
                min="6"
                max="48"
                value={highlighterSize}
                onChange={(e) => setHighlighterSize(Number(e.target.value))}
                className="samsung-range-slider"
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
                {[10, 18, 28, 40].map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    className={`size-dot-btn ${highlighterSize === sz ? 'selected' : ''}`}
                    onClick={() => setHighlighterSize(sz)}
                    style={{ width: '30px', height: '28px', fontSize: '11px', color: '#ffffff' }}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ height: '1px', background: 'var(--g-border-subtle)' }} />

            {/* 형광 색상 팔레트 */}
            <div>
              <div style={{ fontSize: '11px', color: 'var(--g-text-secondary)', marginBottom: '6px', fontWeight: 600 }}>
                형광 색상
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px' }}>
                {[
                  '#fde047', '#86efac', '#67e8f9', '#f472b6', '#c084fc', '#fdba74'
                ].map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`color-dot-btn ${highlighterColor === color ? 'selected' : ''}`}
                    style={{
                      backgroundColor: color,
                      width: '28px',
                      height: '28px',
                      margin: '0 auto',
                      boxShadow: highlighterColor === color ? `0 0 8px ${color}` : undefined
                    }}
                    onClick={() => setHighlighterColor(color)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ====================================================================
            [팝오버 3] 삼성노트 REA 지우개 크기 & 방식 팝오버
            ==================================================================== */}
        {activePopup === 'eraser' && (
          <div
            id="popup-eraser-settings"
            className="samsung-tool-popup"
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'absolute', top: '96px', left: '70px', zIndex: 1000, width: '275px', maxWidth: 'calc(100vw - 16px)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <EraserIcon size={16} color="#38bdf8" /> 지우개 설정
              </span>
              <button
                type="button"
                onClick={() => setActivePopup(null)}
                style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '14px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* 지우개 모드 선택: 획 지우개 vs 영역(픽셀) 지우개 */}
            <div>
              <div style={{ fontSize: '11px', color: 'var(--g-text-secondary)', marginBottom: '5px', fontWeight: 600 }}>
                지우개 모드
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <button
                  type="button"
                  className={`student-tool-btn ${eraserMode === 'stroke' ? 'active' : ''}`}
                  onClick={() => {
                    setEraserMode('stroke');
                    showToast('⚡ 획 지우개: 선을 건드리면 그린 획 전체가 깔끔하게 삭제됩니다.');
                  }}
                  style={{ justifyContent: 'center', fontSize: '11.5px', padding: '6px' }}
                >
                  ⚡ 획 지우개
                </button>
                <button
                  type="button"
                  className={`student-tool-btn ${eraserMode === 'pixel' ? 'active' : ''}`}
                  onClick={() => {
                    setEraserMode('pixel');
                    showToast('🧽 영역 지우개: 닿은 부분만 지워집니다.');
                  }}
                  style={{ justifyContent: 'center', fontSize: '11.5px', padding: '6px' }}
                >
                  🧽 영역 지우개
                </button>
              </div>
              <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '4px' }}>
                {eraserMode === 'stroke'
                  ? '• 그린 획(선)을 터치하거나 스치면 획 단위로 삭제됩니다.'
                  : '• 닿은 부분만 칠하듯 부분적으로 지워집니다.'}
              </div>
            </div>

            <div style={{ height: '1px', background: 'var(--g-border-subtle)' }} />

            {/* 지우개 크기 프리셋 */}
            <div>
              <div style={{ fontSize: '11px', color: 'var(--g-text-secondary)', marginBottom: '6px', fontWeight: 600 }}>
                지우개 크기
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                {[
                  { sz: 12, label: '소 (12)' },
                  { sz: 24, label: '중 (24)' },
                  { sz: 40, label: '대 (40)' },
                  { sz: 64, label: '특대 (64)' }
                ].map(({ sz, label }) => (
                  <button
                    key={sz}
                    type="button"
                    className={`student-tool-btn ${eraserSize === sz ? 'active' : ''}`}
                    onClick={() => setEraserSize(sz)}
                    style={{ justifyContent: 'center', fontSize: '11px', padding: '6px 2px' }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ height: '1px', background: 'var(--g-border-subtle)' }} />

            {/* 안전한 페이지 지우기 액션 */}
            <div>
              <div style={{ fontSize: '11px', color: '#f87171', marginBottom: '6px', fontWeight: 700 }}>
                🗑️ 빠른 지우기
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <button
                  type="button"
                  className="student-tool-btn"
                  onClick={handleClearCurrentPage}
                  style={{
                    justifyContent: 'flex-start',
                    fontSize: '11.5px',
                    padding: '8px 10px',
                    background: 'rgba(255,255,255,0.05)',
                    color: '#e2e8f0',
                    border: '1px solid rgba(255,255,255,0.1)'
                  }}
                >
                  📄 현재 쪽({currentPageIndex + 1}쪽) 내용만 지우기
                </button>
                <button
                  type="button"
                  className="student-tool-btn danger"
                  onClick={handleClearAllPages}
                  style={{
                    justifyContent: 'flex-start',
                    fontSize: '11.5px',
                    padding: '8px 10px',
                    background: 'rgba(239, 68, 68, 0.12)',
                    color: '#fca5a5',
                    border: '1px solid rgba(239, 68, 68, 0.25)'
                  }}
                >
                  📚 전체 페이지 모든 필기 다 지우기
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ====================================================================
            [팝오버 4] ⚙️ 설정 & 페이지 관리 팝오버
            ==================================================================== */}
        {activePopup === 'settings' && (
          <div
            id="popup-general-settings"
            className="samsung-tool-popup"
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'absolute', top: '96px', right: '8px', zIndex: 1000, width: '280px', maxWidth: 'calc(100vw - 16px)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#ffffff' }}>⚙️ 설정 & 페이지 관리</span>
              <button
                type="button"
                onClick={() => setActivePopup(null)}
                style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '14px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* A4 용지 방향 */}
            <div>
              <div style={{ fontSize: '11px', color: 'var(--g-text-secondary)', marginBottom: '5px', fontWeight: 600 }}>
                📐 A4 용지 방향 (표준 1:1.414)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <button
                  type="button"
                  className={`student-tool-btn ${orientation === 'portrait' ? 'active' : ''}`}
                  onClick={() => {
                    setOrientation('portrait');
                    showToast('📏 A4 세로 모드로 전환되었습니다.');
                  }}
                  style={{ justifyContent: 'center', fontSize: '11.5px', padding: '6px' }}
                >
                  📏 세로 (표준)
                </button>
                <button
                  type="button"
                  className={`student-tool-btn ${orientation === 'landscape' ? 'active' : ''}`}
                  onClick={() => {
                    setOrientation('landscape');
                    showToast('📐 A4 가로 모드로 전환되었습니다.');
                  }}
                  style={{ justifyContent: 'center', fontSize: '11.5px', padding: '6px' }}
                >
                  📐 가로
                </button>
              </div>
            </div>

            <div style={{ height: '1px', background: 'var(--g-border-subtle)' }} />

            {/* 터치 모드 vs 펜 모드 (팜리젝션) */}
            <div>
              <div style={{ fontSize: '11px', color: 'var(--g-text-secondary)', marginBottom: '5px', fontWeight: 600 }}>
                ✏️ 입력 모드 (터치 / 펜)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <button
                  type="button"
                  className={`student-tool-btn ${!penOnlyMode ? 'active' : ''}`}
                  onClick={() => {
                    setPenOnlyMode(false);
                    showToast('🖐️ 터치 모드 (손가락과 펜 모두 필기 가능)');
                  }}
                  style={{ justifyContent: 'center', fontSize: '11.5px', padding: '6px' }}
                >
                  🖐️ 터치 모드
                </button>
                <button
                  type="button"
                  className={`student-tool-btn ${penOnlyMode ? 'active-pen-mode' : ''}`}
                  onClick={() => {
                    setPenOnlyMode(true);
                    showToast('✏️ 펜 모드 ON (펜 전용 필기, 손가락은 화면 이동, 팜리젝션)');
                  }}
                  style={{ justifyContent: 'center', fontSize: '11.5px', padding: '6px' }}
                >
                  ✏️ 펜 모드
                </button>
              </div>
              <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '4px' }}>
                {penOnlyMode
                  ? '• 펜(스타일러스/애플펜슬)으로만 필기되며 손가락은 화면 이동에 사용됩니다.'
                  : '• 손가락과 펜 모두 자유롭게 필기할 수 있습니다.'}
              </div>
            </div>

            <div style={{ height: '1px', background: 'var(--g-border-subtle)' }} />

            {/* 화면 줌 조절 */}
            <div>
              <div style={{ fontSize: '11px', color: 'var(--g-text-secondary)', marginBottom: '5px', fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
                <span>🔍 화면 맞춤 / 줌</span>
                <span style={{ color: '#38bdf8', fontWeight: 700 }}>
                  {displayPercent}% {isFitWidth ? '(폭 맞춤)' : isFitPage ? '(전체)' : ''}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '6px' }}>
                <button
                  type="button"
                  className={`student-tool-btn ${isFitPage ? 'active' : ''}`}
                  onClick={handleFitPage}
                  style={{ justifyContent: 'center', fontSize: '11.5px', padding: '6px' }}
                >
                  📄 전체 보기
                </button>
                <button
                  type="button"
                  className={`student-tool-btn ${isFitWidth ? 'active' : ''}`}
                  onClick={handleFitWidth}
                  style={{ justifyContent: 'center', fontSize: '11.5px', padding: '6px', fontWeight: 600, color: '#93c5fd' }}
                >
                  ↔️ 100% 폭 맞춤
                </button>
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="student-tool-btn"
                  onClick={() => {
                    setZoomScale(prev => {
                      const next = Math.max(minScale, prev - fitWidthScale * 0.15);
                      setPanOffset(p => clampPanOffset(p, next));
                      return next;
                    });
                  }}
                  style={{ flex: 1, justifyContent: 'center', fontSize: '11.5px' }}
                  title="축소 (한 페이지 전체까지만 축소)"
                >
                  - 축소
                </button>
                <button
                  type="button"
                  className="student-tool-btn"
                  onClick={() => {
                    setZoomScale(prev => {
                      const next = Math.min(maxScale, prev + fitWidthScale * 0.15);
                      setPanOffset(p => clampPanOffset(p, next));
                      return next;
                    });
                  }}
                  style={{ flex: 1, justifyContent: 'center', fontSize: '11.5px' }}
                  title="확대"
                >
                  + 확대
                </button>
              </div>
            </div>

            {/* 현재 쪽 완전 삭제 */}
            {pages.length > 1 && (
              <>
                <div style={{ height: '1px', background: 'var(--g-border-subtle)' }} />
                <button
                  type="button"
                  className="student-tool-btn danger"
                  onClick={handleDeleteCurrentPage}
                  style={{
                    justifyContent: 'center',
                    fontSize: '11.5px',
                    padding: '8px 10px',
                    background: 'rgba(239, 68, 68, 0.2)',
                    color: '#f87171',
                    border: '1px solid rgba(239, 68, 68, 0.4)'
                  }}
                >
                  ❌ 현재 쪽({currentPageIndex + 1}쪽) 완전히 삭제
                </button>
              </>
            )}
          </div>
        )}

      {/* 3. 메인 작업 영역: A4 종이 시트 & 줌/스크롤 뷰포트 */}
      <main
        ref={containerRef}
        className="student-canvas-wrapper"
        onWheel={handleWheel}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          background: '#090b10',
          position: 'relative',
          touchAction: 'none',
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none'
        }}
      >
        {/* A4 실제 용지 시트 (하드웨어 가속 줌/팬 적용) */}
        <div
          ref={paperSheetRef}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
          style={{
            width: `${paperBaseWidth}px`,
            height: `${paperBaseHeight}px`,
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
            transformOrigin: 'center center',
            transition: isGestureRef.current ? 'none' : 'transform 0.15s ease-out, width 0.2s ease, height 0.2s ease',
            position: 'relative',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.1)',
            borderRadius: '12px',
            background: '#131314',
            overflow: 'hidden',
            touchAction: 'none',
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
            userSelect: 'none'
          }}
        >
          <canvas
            ref={canvasRef}
            className="student-canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              touchAction: 'none',
              WebkitTouchCallout: 'none',
              WebkitUserSelect: 'none',
              userSelect: 'none',
              WebkitTapHighlightColor: 'transparent'
            }}
          />

          {/* 텍스트 타이핑 오버레이 레이어 */}
          {textItems.map(item => (
            <div
              key={item.id}
              style={{
                position: 'absolute',
                left: `${(item.x / A4_WIDTH) * 100}%`,
                top: `${(item.y / A4_HEIGHT) * 100}%`,
                zIndex: 10
              }}
            >
              {activeTextId === item.id ? (
                <input
                  type="text"
                  value={item.text}
                  onChange={(e) => {
                    const val = e.target.value;
                    setTextItems(prev => prev.map(t => t.id === item.id ? { ...t, text: val } : t));
                  }}
                  onBlur={() => setActiveTextId(null)}
                  autoFocus
                  style={{
                    background: 'rgba(0,0,0,0.7)',
                    border: '1px solid var(--g-primary-blue)',
                    color: item.color,
                    fontSize: `${item.fontSize}px`,
                    padding: '2px 6px',
                    borderRadius: '4px',
                    outline: 'none'
                  }}
                />
              ) : (
                <span
                  onClick={() => setActiveTextId(item.id)}
                  style={{
                    color: item.color,
                    fontSize: `${item.fontSize}px`,
                    fontWeight: 600,
                    cursor: 'pointer',
                    userSelect: 'none',
                    textShadow: '0 2px 4px rgba(0,0,0,0.8)'
                  }}
                >
                  {item.text || '클릭하여 입력'}
                </span>
              )}
            </div>
          ))}
        </div>
      </main>

      {/* 4. 학생 정보 등록/수정 모달 */}
      {isChangingStudent && (
        <div className="modal-backdrop" onClick={() => setIsChangingStudent(false)}>
          <div className="modal-box" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>👨‍🎓 학생 정보 등록</h2>
              <button className="modal-close-btn" onClick={() => setIsChangingStudent(false)}>✕</button>
            </div>
            <form onSubmit={handleSaveStudentInfo} style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--g-text-secondary)', marginBottom: '4px' }}>학년</label>
                  <select
                    className="g-form-input"
                    value={inputGrade}
                    onChange={(e) => setInputGrade(e.target.value)}
                  >
                    <option value="1">1학년</option>
                    <option value="2">2학년</option>
                    <option value="3">3학년</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--g-text-secondary)', marginBottom: '4px' }}>반</label>
                  <input
                    type="number"
                    min="1"
                    max="15"
                    className="g-form-input"
                    value={inputClassNum}
                    onChange={(e) => setInputClassNum(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--g-text-secondary)', marginBottom: '4px' }}>번호</label>
                  <input
                    type="number"
                    min="1"
                    max="40"
                    className="g-form-input"
                    value={inputStudentNum}
                    onChange={(e) => setInputStudentNum(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--g-text-secondary)', marginBottom: '4px' }}>이름</label>
                <input
                  type="text"
                  className="g-form-input"
                  placeholder="예: 홍길동"
                  value={inputName}
                  onChange={(e) => setInputName(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                <button type="button" className="g-btn g-btn-text" onClick={() => setIsChangingStudent(false)}>
                  취소
                </button>
                <button type="submit" className="g-btn g-btn-primary">
                  저장하기
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 하단 토스트 메시지 */}
      {toastMsg && (
        <div className="toast-container" style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', zIndex: 9999 }}>
          <span>🔔</span>
          <span>{toastMsg}</span>
        </div>
      )}
    </div>
  );
};

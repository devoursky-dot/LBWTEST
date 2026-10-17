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
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [zoomScale, setZoomScale] = useState<number>(1.0); // 0.5 ~ 3.0
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // --- 3. 멀티페이지 공책 상태 ---
  const [pages, setPages] = useState<LessonPage[]>([
    { id: 'page_1', strokes: [], textItems: [] }
  ]);
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);

  // 현재 활성 페이지의 데이터
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStrokes, setRedoStrokes] = useState<Stroke[]>([]);
  const [textItems, setTextItems] = useState<TextItem[]>([]);
  const [activeTextId, setActiveTextId] = useState<string | null>(null);

  // --- 4. 필기 도구 상태 ---
  const [tool, setTool] = useState<'pen' | 'highlighter' | 'eraser' | 'text'>('pen');
  const [penColor, setPenColor] = useState<string>('#ffffff');
  const [penSize, setPenSize] = useState<number>(3);
  const [penOnlyMode, setPenOnlyMode] = useState<boolean>(false); // 기본 터치/펜 모두 허용, S펜 전용 클릭 시 손바닥 차단
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState<boolean>(false); // 더보기(⚙️) 설정 및 지우기 서브메뉴 상태

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // DOM 참조
  const containerRef = useRef<HTMLDivElement>(null);
  const paperSheetRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const isDrawingRef = useRef(false);
  const currentStrokeRef = useRef<Stroke | null>(null);

  // 제스처 및 스크롤 추적 ref
  const isGestureRef = useRef(false);
  const initialTouchDistanceRef = useRef(0);
  const initialScaleRef = useRef(1);
  const initialPanRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const initialCenterRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

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

  // ==========================================================================
  // [A4 용지 규격 캔버스 초기화]
  // ==========================================================================
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
      ctx.lineWidth = stroke.size * 3.5;
    } else if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = stroke.size * 5;
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
  // 페이지 이동 전 현재 페이지 데이터 동기화
  const syncCurrentPageData = useCallback(() => {
    setPages(prevPages => {
      const updated = [...prevPages];
      if (updated[currentPageIndex]) {
        updated[currentPageIndex] = {
          ...updated[currentPageIndex],
          strokes,
          textItems
        };
      }
      return updated;
    });
  }, [currentPageIndex, strokes, textItems]);

  // 페이지 이동 핸들러
  const handleGoToPage = (targetIdx: number) => {
    if (targetIdx < 0 || targetIdx >= pages.length) return;
    syncCurrentPageData();

    const targetPage = pages[targetIdx];
    setCurrentPageIndex(targetIdx);
    setStrokes(targetPage.strokes || []);
    setTextItems(targetPage.textItems || []);
    setRedoStrokes([]);
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
    setRedoStrokes([]);
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
  // [삼성노트 REA 팜리젝션 포인터 이벤트 핸들러]
  // ==========================================================================
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // 팜리젝션: S펜 전용 모드일 때 터치(손바닥, 손가락) 원천 무시
    if (penOnlyMode && e.pointerType !== 'pen' && e.pointerType !== 'mouse') {
      return;
    }

    if (tool === 'text') {
      const { x, y } = getCanvasCoords(e);
      const newId = `text_${Date.now()}`;
      setTextItems(prev => [...prev, { id: newId, x, y, text: '', color: penColor, fontSize: 18 }]);
      setActiveTextId(newId);
      return;
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}

    isDrawingRef.current = true;
    const { x, y } = getCanvasCoords(e);
    const pressure = e.pressure > 0 ? e.pressure : 0.5;

    const newStroke: Stroke = {
      id: `stroke_${Date.now()}_${Math.random()}`,
      tool: tool as 'pen' | 'highlighter' | 'eraser',
      color: penColor,
      size: penSize,
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
    if (!isDrawingRef.current || !currentStrokeRef.current) return;
    if (penOnlyMode && e.pointerType !== 'pen' && e.pointerType !== 'mouse') return;

    const { x, y } = getCanvasCoords(e);
    const pressure = e.pressure > 0 ? e.pressure : 0.5;

    const currentStroke = currentStrokeRef.current;
    currentStroke.points.push({ x, y, pressure });

    // 초고속 실시간 증분 렌더링
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
            ctx.lineWidth = currentStroke.size * 3.5;
          } else if (currentStroke.tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = currentStroke.size * 5;
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
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    if (e) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    }

    const finishedStroke = currentStrokeRef.current;
    if (finishedStroke && finishedStroke.points.length > 0) {
      setStrokes(prev => [...prev, { ...finishedStroke, points: [...finishedStroke.points] }]);
      setRedoStrokes([]);
    }
    currentStrokeRef.current = null;
  };

  // 실행 취소 & 다시 실행
  const handleUndo = () => {
    if (strokes.length === 0) return;
    const last = strokes[strokes.length - 1];
    setStrokes(prev => prev.slice(0, -1));
    setRedoStrokes(prev => [...prev, last]);
  };

  const handleRedo = () => {
    if (redoStrokes.length === 0) return;
    const last = redoStrokes[redoStrokes.length - 1];
    setRedoStrokes(prev => prev.slice(0, -1));
    setStrokes(prev => [...prev, last]);
  };

  // [지우기 1] 현재 페이지만 지우기
  const handleClearCurrentPage = () => {
    if (window.confirm(`현재 ${currentPageIndex + 1}쪽의 필기 내용을 모두 지우시겠습니까?`)) {
      setStrokes([]);
      setTextItems([]);
      setRedoStrokes([]);
      setIsMoreMenuOpen(false);
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
      setRedoStrokes([]);
      setIsMoreMenuOpen(false);
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
      setRedoStrokes([]);
      setIsMoreMenuOpen(false);
      showToast(`🗑️ ${currentPageIndex + 1}쪽이 삭제되었습니다.`);
    }
  };

  // ==========================================================================
  // [삼성노트 REA 휠 줌 및 스크롤 이벤트 핸들러 - 마우스 커서 위치 중심 줌]
  // ==========================================================================
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey) {
      // Ctrl + 휠: 마우스 커서 위치 중심 초정밀 확대/축소
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const nextScale = Math.min(Math.max(0.5, zoomScale * zoomFactor), 3.0);
      if (nextScale === zoomScale) return;

      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const viewportCenterX = rect.left + rect.width / 2;
        const viewportCenterY = rect.top + rect.height / 2;

        const deltaX = e.clientX - viewportCenterX;
        const deltaY = e.clientY - viewportCenterY;
        const scaleRatio = nextScale / zoomScale;

        setPanOffset(prev => ({
          x: prev.x * scaleRatio + deltaX * (1 - scaleRatio),
          y: prev.y * scaleRatio + deltaY * (1 - scaleRatio)
        }));
      }
      setZoomScale(nextScale);
    } else {
      // 일반 휠: 위아래 / 좌우 스크롤
      setPanOffset(prev => ({
        x: prev.x - (e.shiftKey ? e.deltaY : e.deltaX),
        y: prev.y - (!e.shiftKey ? e.deltaY : 0)
      }));
    }
  };

  // 줌 리셋
  const handleResetZoom = () => {
    setZoomScale(1.0);
    setPanOffset({ x: 0, y: 0 });
    showToast('🔍 100% 원위치로 맞췄습니다.');
  };

  // 삼성노트 REA 2손가락 핀치 줌 & 팬 (손가락 접촉 지점 100% 고정 포컬포인트 줌)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        isGestureRef.current = true;
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
      if (isGestureRef.current && e.touches.length === 2) {
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
          const nextScale = Math.min(3.0, Math.max(0.5, initialScaleRef.current * ratio));
          setZoomScale(nextScale);

          const rect = container.getBoundingClientRect();
          const viewportCenterX = rect.left + rect.width / 2;
          const viewportCenterY = rect.top + rect.height / 2;

          // 터치 시작 시 두 손가락 중심과 뷰포트 중심 간의 상대 벡터
          const initialFocalRelX = initialCenterRef.current.x - viewportCenterX;
          const initialFocalRelY = initialCenterRef.current.y - viewportCenterY;

          // 두 손가락 중심 자체의 이동량 (Pan translation)
          const translationX = currentCenter.x - initialCenterRef.current.x;
          const translationY = currentCenter.y - initialCenterRef.current.y;

          // 줌 배율 변화비
          const scaleChangeRatio = nextScale / initialScaleRef.current;

          // 손가락 밑의 종이 좌표가 손가락을 따라 정확히 고정되도록 panOffset 보정
          const newPanX = (initialPanRef.current.x * scaleChangeRatio) + (initialFocalRelX * (1 - scaleChangeRatio)) + translationX;
          const newPanY = (initialPanRef.current.y * scaleChangeRatio) + (initialFocalRelY * (1 - scaleChangeRatio)) + translationY;

          setPanOffset({ x: newPanX, y: newPanY });
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        isGestureRef.current = false;
      }
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
    };
  }, [zoomScale, panOffset]);

  // 더보기 메뉴 외부 클릭 시 자동 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('#btn-more-settings') && !target.closest('#more-settings-popup')) {
        setIsMoreMenuOpen(false);
      }
    };
    if (isMoreMenuOpen) {
      document.addEventListener('click', handleClickOutside);
    }
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isMoreMenuOpen]);

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

  // ==========================================================================
  // [등록 및 제출하기 (멀티페이지 통합 저장)]
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

    const hasAnyContent = updatedPages.some(
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

      // 1. 학생 필기 멀티페이지 데이터를 로컬 스토리지에 백업
      const studentPayload = {
        student: studentInfo,
        lessonId,
        pages: updatedPages,
        orientation,
        timestamp: now
      };
      localStorage.setItem(`lbw_lesson_${lessonId}_note_v2`, JSON.stringify(studentPayload));

      const record: ClassNoteRecord = {
        lesson_id: lessonId,
        student_grade: studentInfo.grade,
        student_class: studentInfo.classNum,
        student_num: studentInfo.studentNum,
        student_name: studentInfo.name,
        strokes_data: {
          pages: updatedPages,
          orientation,
          // 하위 호환용 1페이지 데이터
          strokes: updatedPages[0]?.strokes || [],
          textItems: updatedPages[0]?.textItems || []
        },
        updated_at: now
      };

      // 2. Supabase 클라우드 실시간 업서트
      if (supabase && isSupabaseConfigured) {
        try {
          const { error } = await supabase
            .from('class_notes')
            .upsert([record]);
          if (error) {
            console.warn('Supabase 저장 경고:', error.message);
          }
        } catch (sbErr) {
          console.warn('Supabase network error:', sbErr);
        }
      }

      // 3. 로컬 브로드캐스트 채널 전송
      if (localRealtimeChannel) {
        localRealtimeChannel.postMessage({
          type: 'STUDENT_SUBMIT',
          record
        });
      }

      showToast(`🎉 '${studentInfo.name}' 학생의 ${updatedPages.length}페이지 필기가 등록되었습니다!`);
    } catch (err: any) {
      showToast(`❌ 등록 실패: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="student-app-container"
      style={{ overflow: 'hidden', position: 'relative' }}
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
      <div className="student-toolbar" style={{ flexWrap: 'wrap', gap: '6px', padding: '6px 12px', position: 'relative' }}>
        
        {/* [A] 필기 도구 선택 (펜, 형광펜, 지우개, 타이핑) */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          <button
            type="button"
            className={`student-tool-btn ${tool === 'pen' ? 'active' : ''}`}
            onClick={() => setTool('pen')}
            title="일반 펜 (글씨/필기)"
          >
            🖊️ 펜
          </button>
          <button
            type="button"
            className={`student-tool-btn ${tool === 'highlighter' ? 'active' : ''}`}
            onClick={() => setTool('highlighter')}
            title="형광펜 (반투명 강조)"
          >
            🖍️ 형광펜
          </button>
          <button
            type="button"
            className={`student-tool-btn ${tool === 'eraser' ? 'active' : ''}`}
            onClick={() => setTool('eraser')}
            title="지우개 (획 부분 지우기)"
          >
            🧹 지우개
          </button>
          <button
            type="button"
            className={`student-tool-btn ${tool === 'text' ? 'active' : ''}`}
            onClick={() => setTool('text')}
            title="텍스트 타이핑"
          >
            ⌨️ 타이핑
          </button>
        </div>

        <div className="toolbar-divider" />

        {/* [B] 색상 팔레트 (선명한 6색 + 커스텀 컬러 피커) */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {[
            { color: '#ffffff', label: '흰색' },
            { color: '#000000', label: '검정' },
            { color: '#ef4444', label: '빨강' },
            { color: '#3b82f6', label: '파랑' },
            { color: '#eab308', label: '노랑' },
            { color: '#22c55e', label: '초록' },
          ].map(({ color, label }) => (
            <button
              key={color}
              type="button"
              className={`color-dot-btn ${penColor === color ? 'selected' : ''}`}
              style={{
                backgroundColor: color,
                border: color === '#000000' ? '1px solid #555' : undefined
              }}
              onClick={() => {
                setPenColor(color);
                if (tool === 'eraser') setTool('pen');
              }}
              title={label}
            />
          ))}

          {/* 커스텀 색상 선택 피커 */}
          <label
            title="더 많은 색상 직접 선택"
            style={{
              position: 'relative',
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '2px solid rgba(255,255,255,0.4)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.5)'
            }}
          >
            <input
              type="color"
              value={penColor}
              onChange={(e) => {
                setPenColor(e.target.value);
                if (tool === 'eraser') setTool('pen');
              }}
              style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
            />
            <span style={{ fontSize: '11px', textShadow: '0 1px 2px #000' }}>🎨</span>
          </label>
        </div>

        <div className="toolbar-divider" />

        {/* [C] 펜/지우개 굵기 조절 (1, 3, 6, 12, 24px) */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          {[
            { size: 1, label: '가늘게 (1px)' },
            { size: 3, label: '보통 (3px)' },
            { size: 6, label: '굵게 (6px)' },
            { size: 12, label: '매우 굵게 (12px)' },
            { size: 24, label: '마커/대형 (24px)' }
          ].map(({ size, label }) => (
            <button
              key={size}
              type="button"
              className={`size-dot-btn ${penSize === size ? 'selected' : ''}`}
              onClick={() => setPenSize(size)}
              title={label}
              style={{ width: '26px', height: '26px' }}
            >
              <div
                style={{
                  width: `${Math.min(18, Math.max(3, size))}px`,
                  height: `${Math.min(18, Math.max(3, size))}px`,
                  borderRadius: '50%',
                  background: penSize === size ? '#ffffff' : 'rgba(255, 255, 255, 0.7)'
                }}
              />
            </button>
          ))}
        </div>

        <div className="toolbar-divider" />

        {/* [D] 실행 취소 & 다시 실행 */}
        <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
          <button
            type="button"
            className="student-tool-btn"
            onClick={handleUndo}
            disabled={strokes.length === 0}
            style={{ opacity: strokes.length === 0 ? 0.4 : 1.0, padding: '3px 8px' }}
            title="실행 취소 (Ctrl+Z)"
          >
            ↩️
          </button>
          <button
            type="button"
            className="student-tool-btn"
            onClick={handleRedo}
            disabled={redoStrokes.length === 0}
            style={{ opacity: redoStrokes.length === 0 ? 0.4 : 1.0, padding: '3px 8px' }}
            title="다시 실행 (Ctrl+Y)"
          >
            ↪️
          </button>
        </div>

        <div className="toolbar-divider" />

        {/* [E] 페이지 이동 및 추가 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '8px', padding: '2px 6px' }}>
          <button
            id="btn-page-prev"
            type="button"
            className="student-tool-btn"
            disabled={currentPageIndex <= 0}
            onClick={() => handleGoToPage(currentPageIndex - 1)}
            style={{ padding: '3px 6px', fontSize: '11px', opacity: currentPageIndex <= 0 ? 0.35 : 1 }}
            title="이전 쪽"
          >
            ◀
          </button>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#38bdf8', minWidth: '46px', textAlign: 'center' }}>
            {currentPageIndex + 1} / {pages.length}쪽
          </span>
          <button
            id="btn-page-next"
            type="button"
            className="student-tool-btn"
            disabled={currentPageIndex >= pages.length - 1}
            onClick={() => handleGoToPage(currentPageIndex + 1)}
            style={{ padding: '3px 6px', fontSize: '11px', opacity: currentPageIndex >= pages.length - 1 ? 0.35 : 1 }}
            title="다음 쪽"
          >
            ▶
          </button>
          <button
            id="btn-add-page"
            type="button"
            className="student-tool-btn"
            onClick={handleAddPage}
            style={{ padding: '3px 8px', fontSize: '11.5px', background: 'rgba(59, 130, 246, 0.25)', color: '#93c5fd', fontWeight: 600 }}
            title="새 페이지 추가"
          >
            + 추가
          </button>
        </div>

        {/* [F] 우측 정렬: 더보기 ⚙️ 설정 & 지우기 서브메뉴 버튼 */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* 현재 줌 배율 간략 표시 */}
          <span
            onClick={handleResetZoom}
            style={{
              fontSize: '11.5px',
              fontWeight: 600,
              color: zoomScale !== 1.0 ? '#60a5fa' : 'var(--g-text-secondary)',
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: '4px',
              background: zoomScale !== 1.0 ? 'rgba(59, 130, 246, 0.15)' : 'transparent'
            }}
            title="클릭 시 100% 원위치 리셋"
          >
            🔍 {Math.round(zoomScale * 100)}%
          </span>

          <button
            id="btn-more-settings"
            type="button"
            className={`student-tool-btn ${isMoreMenuOpen ? 'active' : ''}`}
            onClick={() => setIsMoreMenuOpen(prev => !prev)}
            style={{
              padding: '4px 10px',
              fontSize: '12px',
              background: isMoreMenuOpen ? 'var(--g-primary-blue)' : 'rgba(255,255,255,0.08)',
              color: isMoreMenuOpen ? '#ffffff' : 'var(--g-text-secondary)',
              border: '1px solid var(--g-border)'
            }}
            title="용지 방향, S펜 설정, 페이지 지우기 등 펼치기"
          >
            ⚙️ 설정 및 관리 {isMoreMenuOpen ? '▲' : '▼'}
          </button>
        </div>

        {/* ====================================================================
            더보기 ⚙️ 설정 및 지우기 드롭다운 팝오버
            ==================================================================== */}
        {isMoreMenuOpen && (
          <div
            id="more-settings-popup"
            style={{
              position: 'absolute',
              top: '52px',
              right: '12px',
              width: '290px',
              backgroundColor: '#1e1f20',
              border: '1px solid var(--g-border)',
              borderRadius: '12px',
              boxShadow: '0 16px 36px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.1)',
              zIndex: 999,
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              backdropFilter: 'blur(16px)'
            }}
          >
            {/* 섹션 1: A4 용지 방향 */}
            <div>
              <div style={{ fontSize: '11.5px', color: 'var(--g-text-secondary)', marginBottom: '6px', fontWeight: 600 }}>
                📐 A4 용지 방향
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <button
                  type="button"
                  className={`student-tool-btn ${orientation === 'landscape' ? 'active' : ''}`}
                  onClick={() => {
                    setOrientation('landscape');
                    showToast('📐 A4 가로 모드로 전환되었습니다.');
                  }}
                  style={{ justifyContent: 'center', fontSize: '12px', padding: '6px' }}
                >
                  📐 가로 (1600×1130)
                </button>
                <button
                  type="button"
                  className={`student-tool-btn ${orientation === 'portrait' ? 'active' : ''}`}
                  onClick={() => {
                    setOrientation('portrait');
                    showToast('📏 A4 세로 모드로 전환되었습니다.');
                  }}
                  style={{ justifyContent: 'center', fontSize: '12px', padding: '6px' }}
                >
                  📏 세로 (1130×1600)
                </button>
              </div>
            </div>

            <div style={{ height: '1px', background: 'var(--g-border-subtle)' }} />

            {/* 섹션 2: S펜 팜리젝션 모드 */}
            <div>
              <div style={{ fontSize: '11.5px', color: 'var(--g-text-secondary)', marginBottom: '6px', fontWeight: 600 }}>
                ✏️ 터치 / S펜 모드
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <button
                  type="button"
                  className={`student-tool-btn ${!penOnlyMode ? 'active' : ''}`}
                  onClick={() => {
                    setPenOnlyMode(false);
                    showToast('🖐️ 손가락 터치 필기가 허용되었습니다.');
                  }}
                  style={{ justifyContent: 'center', fontSize: '12px', padding: '6px' }}
                >
                  🖐️ 터치 허용
                </button>
                <button
                  type="button"
                  className={`student-tool-btn ${penOnlyMode ? 'active-pen-mode' : ''}`}
                  onClick={() => {
                    setPenOnlyMode(true);
                    showToast('🛡️ S펜 전용 모드 ON (손바닥 터치 100% 차단)');
                  }}
                  style={{ justifyContent: 'center', fontSize: '12px', padding: '6px' }}
                >
                  ✏️ S펜 전용
                </button>
              </div>
            </div>

            <div style={{ height: '1px', background: 'var(--g-border-subtle)' }} />

            {/* 섹션 3: 화면 줌 조절 */}
            <div>
              <div style={{ fontSize: '11.5px', color: 'var(--g-text-secondary)', marginBottom: '6px', fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
                <span>🔍 화면 확대 / 축소</span>
                <span style={{ color: '#38bdf8' }}>{Math.round(zoomScale * 100)}%</span>
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="student-tool-btn"
                  onClick={() => setZoomScale(prev => Math.max(0.5, prev - 0.15))}
                  style={{ flex: 1, justifyContent: 'center', fontSize: '12px' }}
                >
                  - 축소
                </button>
                <button
                  type="button"
                  className="student-tool-btn"
                  onClick={handleResetZoom}
                  style={{ flex: 1.2, justifyContent: 'center', fontSize: '12px', background: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd' }}
                >
                  100% 원위치
                </button>
                <button
                  type="button"
                  className="student-tool-btn"
                  onClick={() => setZoomScale(prev => Math.min(3.0, prev + 0.15))}
                  style={{ flex: 1, justifyContent: 'center', fontSize: '12px' }}
                >
                  + 확대
                </button>
              </div>
            </div>

            <div style={{ height: '1px', background: 'var(--g-border-subtle)' }} />

            {/* 섹션 4: 🗑️ 지우기 및 초기화 메뉴 (안전하게 숨김 배치) */}
            <div>
              <div style={{ fontSize: '11.5px', color: '#f87171', marginBottom: '6px', fontWeight: 700 }}>
                🗑️ 지우기 & 페이지 관리
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <button
                  type="button"
                  className="student-tool-btn"
                  onClick={handleClearCurrentPage}
                  style={{
                    justifyContent: 'flex-start',
                    fontSize: '12px',
                    padding: '8px 10px',
                    background: 'rgba(255,255,255,0.04)',
                    color: '#e2e8f0',
                    border: '1px solid rgba(255,255,255,0.08)'
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
                    fontSize: '12px',
                    padding: '8px 10px',
                    background: 'rgba(239, 68, 68, 0.12)',
                    color: '#fca5a5',
                    border: '1px solid rgba(239, 68, 68, 0.25)'
                  }}
                >
                  📚 전체 페이지 모든 필기 다 지우기
                </button>
                {pages.length > 1 && (
                  <button
                    type="button"
                    className="student-tool-btn danger"
                    onClick={handleDeleteCurrentPage}
                    style={{
                      justifyContent: 'flex-start',
                      fontSize: '12px',
                      padding: '8px 10px',
                      background: 'rgba(239, 68, 68, 0.2)',
                      color: '#f87171',
                      border: '1px solid rgba(239, 68, 68, 0.4)'
                    }}
                  >
                    ❌ 현재 쪽({currentPageIndex + 1}쪽) 완전히 삭제
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 3. 메인 작업 영역: A4 종이 시트 & 줌/스크롤 뷰포트 */}
      <main
        ref={containerRef}
        className="student-canvas-wrapper"
        onWheel={handleWheel}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          background: '#090b10',
          position: 'relative',
          touchAction: 'none'
        }}
      >
        {/* A4 실제 용지 시트 (하드웨어 가속 줌/팬 적용) */}
        <div
          ref={paperSheetRef}
          style={{
            width: `${orientation === 'landscape' ? 1120 : 792}px`,
            height: `${orientation === 'landscape' ? 792 : 1120}px`,
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
            transformOrigin: 'center center',
            transition: 'width 0.2s ease, height 0.2s ease',
            position: 'relative',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.1)',
            borderRadius: '12px',
            background: '#131314',
            overflow: 'hidden',
            touchAction: 'none'
          }}
        >
          <canvas
            ref={canvasRef}
            className="student-canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              touchAction: 'none'
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

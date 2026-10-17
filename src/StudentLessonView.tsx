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

  // 페이지 삭제 핸들러 (2페이지 이상일 때)
  const handleDeletePage = () => {
    if (pages.length <= 1) {
      showToast('⚠️ 최소 1개 페이지는 유지되어야 합니다.');
      return;
    }
    if (window.confirm(`${currentPageIndex + 1}페이지를 삭제하시겠습니까?`)) {
      const updated = pages.filter((_, idx) => idx !== currentPageIndex);
      const nextIdx = Math.max(0, currentPageIndex - 1);
      setPages(updated);
      setCurrentPageIndex(nextIdx);
      setStrokes(updated[nextIdx]?.strokes || []);
      setTextItems(updated[nextIdx]?.textItems || []);
      setRedoStrokes([]);
      setActiveTextId(null);
      showToast('🗑️ 페이지가 삭제되었습니다.');
    }
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

  // 전체 지우기
  const handleClearAll = () => {
    if (confirm('현재 페이지의 필기 내용을 모두 지우시겠습니까?')) {
      setStrokes([]);
      setTextItems([]);
      setRedoStrokes([]);
      showToast('🗑️ 현재 페이지 내용이 초기화되었습니다.');
    }
  };

  // ==========================================================================
  // [삼성노트 REA 휠 줌 및 스크롤 이벤트 핸들러]
  // ==========================================================================
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey) {
      // Ctrl + 휠: 줌 인/아웃
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      setZoomScale(prev => Math.min(Math.max(0.5, prev * zoomFactor), 3.0));
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

  // 삼성노트 REA 2손가락 핀치 줌 & 팬 (태블릿/모바일 터치 제스처)
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
        }

        const deltaX = currentCenter.x - initialCenterRef.current.x;
        const deltaY = currentCenter.y - initialCenterRef.current.y;
        setPanOffset({
          x: initialPanRef.current.x + deltaX,
          y: initialPanRef.current.y + deltaY
        });
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

      {/* 2. 툴바 (A4 방향, 페이지 추가/이동, 줌 컨트롤, 도구, 팔레트) */}
      <div className="student-toolbar" style={{ flexWrap: 'wrap', gap: '6px', padding: '6px 12px' }}>
        {/* A4 용지 가로/세로 방향 토글 */}
        <button
          id="btn-toggle-orientation"
          type="button"
          className="student-tool-btn"
          onClick={() => {
            const next = orientation === 'landscape' ? 'portrait' : 'landscape';
            setOrientation(next);
            showToast(`📐 A4 ${next === 'landscape' ? '가로' : '세로'} 모드로 전환되었습니다.`);
          }}
          title="A4 용지 방향 전환"
        >
          <span>{orientation === 'landscape' ? '📐 A4 가로' : '📏 A4 세로'}</span>
        </button>

        <div className="toolbar-divider" />

        {/* 멀티페이지 네비게이션 & 추가 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '8px', padding: '2px 6px' }}>
          <button
            id="btn-page-prev"
            type="button"
            className="student-tool-btn"
            disabled={currentPageIndex <= 0}
            onClick={() => handleGoToPage(currentPageIndex - 1)}
            style={{ padding: '3px 6px', fontSize: '11px' }}
            title="이전 페이지"
          >
            ◀
          </button>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#38bdf8', minWidth: '42px', textAlign: 'center' }}>
            {currentPageIndex + 1} / {pages.length}p
          </span>
          <button
            id="btn-page-next"
            type="button"
            className="student-tool-btn"
            disabled={currentPageIndex >= pages.length - 1}
            onClick={() => handleGoToPage(currentPageIndex + 1)}
            style={{ padding: '3px 6px', fontSize: '11px' }}
            title="다음 페이지"
          >
            ▶
          </button>
          <button
            id="btn-add-page"
            type="button"
            className="student-tool-btn"
            onClick={handleAddPage}
            style={{ padding: '3px 8px', fontSize: '11.5px', background: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd' }}
            title="새 페이지 추가"
          >
            + 추가
          </button>
          {pages.length > 1 && (
            <button
              id="btn-delete-page"
              type="button"
              className="student-tool-btn danger"
              onClick={handleDeletePage}
              style={{ padding: '3px 6px', fontSize: '11px' }}
              title="현재 페이지 삭제"
            >
              🗑️
            </button>
          )}
        </div>

        <div className="toolbar-divider" />

        {/* 줌 확대/축소 컨트롤 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '8px', padding: '2px 6px' }}>
          <button
            id="btn-zoom-out"
            type="button"
            className="student-tool-btn"
            onClick={() => setZoomScale(prev => Math.max(0.5, prev - 0.15))}
            style={{ padding: '3px 7px', fontSize: '11px' }}
            title="축소"
          >
            -
          </button>
          <span
            id="btn-zoom-reset"
            onClick={handleResetZoom}
            style={{ fontSize: '11px', fontWeight: 600, color: '#e2e8f0', minWidth: '40px', textAlign: 'center', cursor: 'pointer' }}
            title="클릭 시 100% 원위치 리셋"
          >
            {Math.round(zoomScale * 100)}%
          </span>
          <button
            id="btn-zoom-in"
            type="button"
            className="student-tool-btn"
            onClick={() => setZoomScale(prev => Math.min(3.0, prev + 0.15))}
            style={{ padding: '3px 7px', fontSize: '11px' }}
            title="확대"
          >
            +
          </button>
          {(zoomScale !== 1.0 || panOffset.x !== 0 || panOffset.y !== 0) && (
            <button
              id="btn-zoom-restore"
              type="button"
              className="student-tool-btn"
              onClick={handleResetZoom}
              style={{ padding: '3px 6px', fontSize: '11px', color: '#60a5fa' }}
              title="원위치로 복원"
            >
              ⟲
            </button>
          )}
        </div>

        <div className="toolbar-divider" />

        {/* 팜리젝션 S펜 전용 토글 */}
        <button
          type="button"
          className={`student-tool-btn ${penOnlyMode ? 'active-pen-mode' : ''}`}
          onClick={() => {
            const next = !penOnlyMode;
            setPenOnlyMode(next);
            showToast(next ? '🛡️ S펜 전용 모드 ON (손바닥 터치 차단)' : '🖐️ 손가락 터치 필기 허용');
          }}
          title={penOnlyMode ? 'S펜만 필기 (손바닥 100% 무시)' : '손가락으로도 필기 가능'}
        >
          <span>{penOnlyMode ? '✏️ S펜 전용' : '🖐️ 터치 허용'}</span>
        </button>

        <div className="toolbar-divider" />

        {/* 필기 도구 선택 */}
        <button
          type="button"
          className={`student-tool-btn ${tool === 'pen' ? 'active' : ''}`}
          onClick={() => setTool('pen')}
          title="펜"
        >
          🖊️ 펜
        </button>
        <button
          type="button"
          className={`student-tool-btn ${tool === 'highlighter' ? 'active' : ''}`}
          onClick={() => setTool('highlighter')}
          title="형광펜"
        >
          🖍️ 형광펜
        </button>
        <button
          type="button"
          className={`student-tool-btn ${tool === 'eraser' ? 'active' : ''}`}
          onClick={() => setTool('eraser')}
          title="지우개"
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

        <div className="toolbar-divider" />

        {/* 색상 팔레트 */}
        <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
          {['#ffffff', '#60a5fa', '#f87171', '#4ade80', '#facc15'].map(c => (
            <button
              key={c}
              type="button"
              className={`color-dot-btn ${penColor === c ? 'selected' : ''}`}
              style={{ backgroundColor: c }}
              onClick={() => {
                setPenColor(c);
                if (tool === 'eraser') setTool('pen');
              }}
            />
          ))}
        </div>

        <div className="toolbar-divider" />

        {/* 굵기 조절 */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          {[2, 4, 8].map(s => (
            <button
              key={s}
              type="button"
              className={`size-dot-btn ${penSize === s ? 'selected' : ''}`}
              onClick={() => setPenSize(s)}
            >
              <div style={{ width: `${s * 2}px`, height: `${s * 2}px`, borderRadius: '50%', background: '#ffffff' }} />
            </button>
          ))}
        </div>

        <div className="toolbar-divider" />

        {/* 되돌리기 & 지우기 */}
        <button type="button" className="student-tool-btn" onClick={handleUndo} title="실행 취소">
          ↩️
        </button>
        <button type="button" className="student-tool-btn" onClick={handleRedo} title="다시 실행">
          ↪️
        </button>
        <button type="button" className="student-tool-btn danger" onClick={handleClearAll} title="현재 페이지 지우기">
          🗑️
        </button>
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

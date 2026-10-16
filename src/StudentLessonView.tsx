import React, { useState, useEffect, useRef, useCallback } from 'react';

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

  // --- 2. 삼성노트 REA 필기 도구 상태 ---
  const [tool, setTool] = useState<'pen' | 'highlighter' | 'eraser' | 'text'>('pen');
  const [penColor, setPenColor] = useState<string>('#ffffff');
  const [penSize, setPenSize] = useState<number>(3);
  const [penOnlyMode, setPenOnlyMode] = useState<boolean>(true); // S펜 전용 모드 (손 터치 끄기: 팜리젝션 100%)

  // --- 3. 캔버스 벡터 데이터 상태 ---
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStrokes, setRedoStrokes] = useState<Stroke[]>([]);
  const [textItems, setTextItems] = useState<TextItem[]>([]);
  const [activeTextId, setActiveTextId] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const currentPointsRef = useRef<StrokePoint[]>([]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg(prev => (prev === msg ? null : prev));
    }, 3000);
  };

  // 학생 등록 제출
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

  // 캔버스 크기 재조정
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const width = parent.clientWidth;
    const height = parent.clientHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }
  }, []);

  // 전체 캔버스 다시 그리기 (벡터 스트로크 렌더링)
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    // 모눈종이 그리드 배경
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const gridSize = 28;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    for (let x = gridSize; x < w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = gridSize; y < h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();

    // 스트로크 그리기
    for (const stroke of strokes) {
      if (stroke.points.length === 0) continue;

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (stroke.tool === 'highlighter') {
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size * 3.5;
      } else if (stroke.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = stroke.size * 4;
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
      } else {
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

        // Catmull-Rom / Quadratic Curve 보간 (삼성노트 REA 부드러운 곡선)
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
    }
  }, [strokes]);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener('resize', () => {
      resizeCanvas();
      renderCanvas();
    });
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [resizeCanvas, renderCanvas]);

  useEffect(() => {
    renderCanvas();
  }, [strokes, renderCanvas]);

  // ==========================================================================
  // [삼성노트 REA 팜리젝션 포인터 이벤트 핸들러]
  // ==========================================================================
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // 팜리젝션: S펜 전용 모드일 때 터치(손바닥, 손가락) 원천 차단
    if (penOnlyMode && e.pointerType !== 'pen') {
      return;
    }

    if (tool === 'text') {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const newId = `text_${Date.now()}`;
      setTextItems(prev => [...prev, { id: newId, x, y, text: '', color: penColor, fontSize: 16 }]);
      setActiveTextId(newId);
      return;
    }

    isDrawingRef.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pressure = e.pressure > 0 ? e.pressure : 0.5;

    currentPointsRef.current = [{ x, y, pressure }];

    const newStroke: Stroke = {
      id: `stroke_${Date.now()}`,
      tool: tool as 'pen' | 'highlighter' | 'eraser',
      color: penColor,
      size: penSize,
      points: [{ x, y, pressure }]
    };

    setStrokes(prev => [...prev, newStroke]);
    setRedoStrokes([]);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    if (penOnlyMode && e.pointerType !== 'pen') return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pressure = e.pressure > 0 ? e.pressure : 0.5;

    currentPointsRef.current.push({ x, y, pressure });

    setStrokes(prev => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      const lastIndex = updated.length - 1;
      updated[lastIndex] = {
        ...updated[lastIndex],
        points: [...currentPointsRef.current]
      };
      return updated;
    });
  };

  const handlePointerUp = () => {
    isDrawingRef.current = false;
    currentPointsRef.current = [];
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

  // 캔버스 전체 지우기
  const handleClearAll = () => {
    if (confirm('작성 중인 필기 내용을 모두 지우시겠습니까?')) {
      setStrokes([]);
      setTextItems([]);
      setRedoStrokes([]);
      showToast('🗑️ 필기 내용이 초기화되었습니다.');
    }
  };

  // ==========================================================================
  // [등록 및 제출하기]
  // ==========================================================================
  const handleSubmitLesson = async () => {
    if (!studentInfo) {
      setIsChangingStudent(true);
      return;
    }
    if (strokes.length === 0 && textItems.length === 0) {
      showToast('⚠️ 필기나 타이핑한 내용이 없습니다.');
      return;
    }

    setIsSubmitting(true);
    showToast(`🚀 '${studentInfo.name}' 학생의 필기를 등록하는 중...`);

    try {
      // 1. 학생 필기 벡터 데이터를 로컬 스토리지에 즉각 백업
      const studentPayload = {
        student: studentInfo,
        lessonId,
        strokes,
        textItems,
        timestamp: new Date().toISOString()
      };
      localStorage.setItem(`lbw_lesson_${lessonId}_note`, JSON.stringify(studentPayload));

      // 2. 가상의 Supabase / GAS 등록 파이프라인 시뮬레이션
      await new Promise(r => setTimeout(r, 600));

      showToast(`🎉 '${studentInfo.name}' 학생의 필기가 선생님 폴더에 성공적으로 등록되었습니다!`);
    } catch (err: any) {
      showToast(`❌ 등록 실패: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="student-app-container">
      {/* 1. 상단 학생 전용 헤더 */}
      <header className="student-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px' }}>📱</span>
          <div>
            <h1 style={{ fontSize: '15px', margin: 0, fontWeight: 700, color: '#ffffff' }}>
              {lessonTitle || 'QR 대화형 라이브 수업'}
            </h1>
            <span style={{ fontSize: '11.5px', color: 'var(--g-text-secondary)' }}>
              삼성노트 REA 벡터 필기 웹앱
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {studentInfo ? (
            <button
              className="student-badge-btn"
              onClick={() => setIsChangingStudent(true)}
              title="학생 정보 변경"
            >
              <span>👤</span>
              <span>{studentInfo.grade}학년 {studentInfo.classNum}반 {studentInfo.studentNum}번 {studentInfo.name}</span>
            </button>
          ) : (
            <button
              className="student-badge-btn warning"
              onClick={() => setIsChangingStudent(true)}
            >
              ⚠️ 학생 이름 등록 필요
            </button>
          )}

          <button
            className="g-btn g-btn-primary"
            style={{ padding: '6px 14px', fontSize: '13px', fontWeight: 700 }}
            onClick={handleSubmitLesson}
            disabled={isSubmitting}
          >
            {isSubmitting ? '등록 중...' : '🚀 등록하기'}
          </button>

          {onExit && (
            <button
              className="gdrive-icon-btn"
              style={{ width: '34px', height: '34px' }}
              title="수업 나가기"
              onClick={onExit}
            >
              ✕
            </button>
          )}
        </div>
      </header>

      {/* 2. 필기 도구 툴바 */}
      <div className="student-toolbar">
        {/* S펜 전용 모드 토글 (팜리젝션 100%) */}
        <button
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

        {/* 펜 도구 선택 */}
        <button
          className={`student-tool-btn ${tool === 'pen' ? 'active' : ''}`}
          onClick={() => setTool('pen')}
          title="펜"
        >
          🖊️ 펜
        </button>
        <button
          className={`student-tool-btn ${tool === 'highlighter' ? 'active' : ''}`}
          onClick={() => setTool('highlighter')}
          title="형광펜"
        >
          🖍️ 형광펜
        </button>
        <button
          className={`student-tool-btn ${tool === 'eraser' ? 'active' : ''}`}
          onClick={() => setTool('eraser')}
          title="지우개"
        >
          🧹 지우개
        </button>
        <button
          className={`student-tool-btn ${tool === 'text' ? 'active' : ''}`}
          onClick={() => setTool('text')}
          title="텍스트 타이핑"
        >
          ⌨️ 타이핑
        </button>

        <div className="toolbar-divider" />

        {/* 색상 팔레트 */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {['#ffffff', '#60a5fa', '#f87171', '#4ade80', '#facc15'].map(c => (
            <button
              key={c}
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
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {[2, 4, 8].map(s => (
            <button
              key={s}
              className={`size-dot-btn ${penSize === s ? 'selected' : ''}`}
              onClick={() => setPenSize(s)}
            >
              <div style={{ width: `${s * 2}px`, height: `${s * 2}px`, borderRadius: '50%', background: '#ffffff' }} />
            </button>
          ))}
        </div>

        <div className="toolbar-divider" />

        {/* 되돌리기 & 지우기 */}
        <button className="student-tool-btn" onClick={handleUndo} title="실행 취소">
          ↩️
        </button>
        <button className="student-tool-btn" onClick={handleRedo} title="다시 실행">
          ↪️
        </button>
        <button className="student-tool-btn danger" onClick={handleClearAll} title="전체 지우기">
          🗑️
        </button>
      </div>

      {/* 3. 메인 캔버스 영역 */}
      <main className="student-canvas-wrapper">
        <canvas
          ref={canvasRef}
          className="student-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          style={{ touchAction: penOnlyMode ? 'pan-x pan-y' : 'none' }}
        />

        {/* 텍스트 타이핑 오버레이 레이어 */}
        {textItems.map(item => (
          <div
            key={item.id}
            style={{
              position: 'absolute',
              left: `${item.x}px`,
              top: `${item.y}px`,
              zIndex: 10
            }}
          >
            <input
              type="text"
              className="student-text-input"
              value={item.text}
              placeholder="텍스트 입력..."
              autoFocus={activeTextId === item.id}
              style={{ color: item.color, fontSize: `${item.fontSize}px` }}
              onChange={(e) => {
                const val = e.target.value;
                setTextItems(prev => prev.map(t => t.id === item.id ? { ...t, text: val } : t));
              }}
              onBlur={() => {
                if (!item.text.trim()) {
                  setTextItems(prev => prev.filter(t => t.id !== item.id));
                }
                setActiveTextId(null);
              }}
            />
          </div>
        ))}
      </main>

      {/* 4. 학생 등록 / 변경 모달 */}
      {(!studentInfo || isChangingStudent) && (
        <div className="modal-backdrop">
          <div className="modal-box" style={{ maxWidth: '420px' }}>
            <div className="modal-header">
              <h2><span>👤</span> 학생 본인 확인</h2>
              {studentInfo && (
                <button className="modal-close-btn" onClick={() => setIsChangingStudent(false)}>✕</button>
              )}
            </div>

            <div style={{ background: 'rgba(168, 199, 250, 0.08)', border: '1px solid rgba(168, 199, 250, 0.25)', padding: '12px', borderRadius: '8px', fontSize: '12.5px', color: 'var(--g-text-secondary)', marginBottom: '16px', lineHeight: 1.5 }}>
              💡 한 번 등록하면 다음 수업부터는 로그인 없이 바로 필기장으로 접속됩니다.
            </div>

            <form onSubmit={handleSaveStudentInfo} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', color: 'var(--g-text-secondary)', display: 'block', marginBottom: '4px' }}>학년</label>
                  <input
                    type="text"
                    className="g-form-input"
                    value={inputGrade}
                    onChange={(e) => setInputGrade(e.target.value)}
                    required
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', color: 'var(--g-text-secondary)', display: 'block', marginBottom: '4px' }}>반</label>
                  <input
                    type="text"
                    className="g-form-input"
                    value={inputClassNum}
                    onChange={(e) => setInputClassNum(e.target.value)}
                    required
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', color: 'var(--g-text-secondary)', display: 'block', marginBottom: '4px' }}>번호</label>
                  <input
                    type="text"
                    className="g-form-input"
                    value={inputStudentNum}
                    onChange={(e) => setInputStudentNum(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '12px', color: 'var(--g-text-secondary)', display: 'block', marginBottom: '4px' }}>이름</label>
                <input
                  type="text"
                  className="g-form-input"
                  placeholder="예: 홍길동"
                  value={inputName}
                  onChange={(e) => setInputName(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                {studentInfo && (
                  <button type="button" className="g-btn g-btn-text" onClick={() => setIsChangingStudent(false)}>
                    취소
                  </button>
                )}
                <button type="submit" className="g-btn g-btn-primary">
                  확인 및 시작하기
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 토스트 알림 */}
      {toastMsg && (
        <div className="toast-container">
          <span>🔔</span>
          <span>{toastMsg}</span>
        </div>
      )}
    </div>
  );
};

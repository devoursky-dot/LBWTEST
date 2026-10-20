import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StudentNoteSheet, type StudentNoteSheetPage } from './StudentNoteSheet';
import type { ClassNoteRecord } from '../lib/supabase';

export type ToolbarPosition = 'top' | 'bottom' | 'left' | 'right';

export interface StudentNoteFullscreenViewerProps {
  noteRecord: ClassNoteRecord;
  initialPageIdx?: number;
  isLoading?: boolean;
  onClose: () => void;
  onSendFeedback?: (studentName: string) => void;
}

export const StudentNoteFullscreenViewer: React.FC<StudentNoteFullscreenViewerProps> = ({
  noteRecord,
  initialPageIdx = 0,
  isLoading = false,
  onClose,
  onSendFeedback
}) => {
  // 1. 멀티페이지 데이터 정규화
  const studentPages: StudentNoteSheetPage[] =
    Array.isArray(noteRecord.strokes_data?.pages) && noteRecord.strokes_data.pages.length > 0
      ? noteRecord.strokes_data.pages
      : [
          {
            strokes: noteRecord.strokes_data?.strokes || [],
            textItems: noteRecord.strokes_data?.textItems || [],
            fullPageBackground: noteRecord.strokes_data?.fullPageBackground || null,
            images: noteRecord.strokes_data?.images || []
          }
        ];

  const orientation: 'portrait' | 'landscape' =
    noteRecord.strokes_data?.orientation || 'landscape';
  const isPortrait = orientation === 'portrait';

  // A4 원본 해상도
  const docWidth = isPortrait ? 1130 : 1600;
  const docHeight = isPortrait ? 1600 : 1130;

  // 2. 현재 선택된 페이지 인덱스
  const [currentPageIdx, setCurrentPageIdx] = useState(
    Math.min(Math.max(0, initialPageIdx), studentPages.length - 1)
  );

  const currentPage = studentPages[currentPageIdx] || {
    strokes: [],
    textItems: [],
    images: []
  };

  // 3. 툴바 위치 (상/하/좌/우) 및 브라우저 전체화면 상태
  const [toolbarPosition, setToolbarPosition] = useState<ToolbarPosition>(() => {
    try {
      const saved = localStorage.getItem('lbw_viewer_toolbar_pos');
      if (saved === 'top' || saved === 'bottom' || saved === 'left' || saved === 'right') {
        return saved;
      }
    } catch {}
    return 'top';
  });

  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState<boolean>(() => {
    return Boolean(document.fullscreenElement);
  });

  useEffect(() => {
    const handleFsChange = () => {
      setIsBrowserFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const handleSetToolbarPosition = (pos: ToolbarPosition) => {
    setToolbarPosition(pos);
    try {
      localStorage.setItem('lbw_viewer_toolbar_pos', pos);
    } catch {}
  };

  const toggleBrowserFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      console.warn('전체화면 전환 오류:', e);
    }
  };

  // 4. 확대/축소(Zoom) 및 화면 이동(Pan) 상태
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoomScale, setZoomScale] = useState<number>(1);
  const [fitScale, setFitScale] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  // 드래그 제스처 추적 레퍼런스
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // 컨테이너 크기 기반 최적 화면 맞춤 배율 계산
  const calculateFitScale = useCallback(() => {
    const container = containerRef.current;
    if (!container) return 1;

    const availW = Math.max(300, container.clientWidth - 40);
    const availH = Math.max(300, container.clientHeight - 40);

    const scaleW = availW / docWidth;
    const scaleH = availH / docHeight;
    const bestFit = Math.min(scaleW, scaleH);

    return Math.max(0.2, Math.min(3.0, bestFit));
  }, [docWidth, docHeight]);

  // 초기 화면 맞춤 설정 (툴바 위치나 방향 변경 시 자동 재계산)
  useEffect(() => {
    // 툴바 렌더링 후 레이아웃 완료 시점 대기
    const timer = setTimeout(() => {
      const bestFit = calculateFitScale();
      setFitScale(bestFit);
      setZoomScale(bestFit);
      setPanOffset({ x: 0, y: 0 });
    }, 50);
    return () => clearTimeout(timer);
  }, [calculateFitScale, orientation, toolbarPosition]);

  // 창 크기 변경 시 자동 재계산
  useEffect(() => {
    const handleResize = () => {
      const bestFit = calculateFitScale();
      setFitScale(bestFit);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [calculateFitScale]);

  // 확대 / 축소 버튼 핸들러
  const handleZoomIn = () => {
    setZoomScale(prev => Math.min(3.5, prev * 1.2));
  };

  const handleZoomOut = () => {
    setZoomScale(prev => Math.max(fitScale * 0.5, prev / 1.2));
  };

  const handleResetZoomFit = () => {
    setZoomScale(fitScale);
    setPanOffset({ x: 0, y: 0 });
  };

  // ESC 키로 나가기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && currentPageIdx > 0) {
        setCurrentPageIdx(prev => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight' && currentPageIdx < studentPages.length - 1) {
        setCurrentPageIdx(prev => Math.min(studentPages.length - 1, prev + 1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, currentPageIdx, studentPages.length]);

  // 마우스/터치 드래그 이동(Pan) 핸들러
  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    setIsPanning(true);
    panStartRef.current = {
      x: e.clientX - panOffset.x,
      y: e.clientY - panOffset.y
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isPanning) return;
    setPanOffset({
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isPanning) {
      setIsPanning(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  // 마우스 휠 줌 핸들러
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    setZoomScale(prev => Math.max(fitScale * 0.4, Math.min(3.5, prev * delta)));
  };

  const zoomPercent = Math.round((zoomScale / fitScale) * 100);
  const isVerticalToolbar = toolbarPosition === 'left' || toolbarPosition === 'right';

  // --------------------------------------------------------------------------
  // [공통 툴바 렌더러] - 가로 모드 (상/하) 및 세로 모드 (좌/우) 완벽 지원
  // --------------------------------------------------------------------------
  const renderToolbar = () => {
    return (
      <aside
        style={{
          background: '#161b22',
          borderBottom: toolbarPosition === 'top' ? '1px solid #30363d' : 'none',
          borderTop: toolbarPosition === 'bottom' ? '1px solid #30363d' : 'none',
          borderRight: toolbarPosition === 'left' ? '1px solid #30363d' : 'none',
          borderLeft: toolbarPosition === 'right' ? '1px solid #30363d' : 'none',
          display: 'flex',
          flexDirection: isVerticalToolbar ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: isVerticalToolbar ? 'flex-start' : 'space-between',
          padding: isVerticalToolbar ? '12px 8px' : '0 16px',
          height: isVerticalToolbar ? '100%' : '60px',
          width: isVerticalToolbar ? '146px' : '100%',
          flexShrink: 0,
          zIndex: 10,
          gap: isVerticalToolbar ? '10px' : '12px',
          overflowY: isVerticalToolbar ? 'auto' : 'hidden',
          overflowX: isVerticalToolbar ? 'hidden' : 'auto',
          scrollbarWidth: 'none',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
        }}
      >
        {/* 좌측: 학생 기본 정보 배지 */}
        <div
          style={{
            display: 'flex',
            flexDirection: isVerticalToolbar ? 'column' : 'row',
            alignItems: 'center',
            gap: isVerticalToolbar ? '4px' : '8px',
            flexShrink: 0,
            textAlign: isVerticalToolbar ? 'center' : 'left'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: isVerticalToolbar ? '20px' : '22px' }}>👨‍🎓</span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                background: 'rgba(59, 130, 246, 0.15)',
                color: '#93c5fd',
                padding: '2px 6px',
                borderRadius: '6px',
                border: '1px solid rgba(59, 130, 246, 0.3)'
              }}
            >
              {isPortrait ? '📐세로' : '📐가로'}
            </span>
          </div>
          <h2
            style={{
              fontSize: isVerticalToolbar ? '13px' : '14.5px',
              fontWeight: 700,
              margin: 0,
              color: '#ffffff',
              whiteSpace: 'nowrap'
            }}
          >
            {noteRecord.student_grade}-{noteRecord.student_class} {noteRecord.student_num}번 {noteRecord.student_name}
          </h2>
        </div>

        {/* 중앙: 컨트롤 바 (전체화면 + 툴바위치 + 쪽이동 + 확대축소) - 좁은 화면에서도 가로 스크롤되어 우측 나가기 버튼 보장 */}
        <div
          style={{
            display: 'flex',
            flexDirection: isVerticalToolbar ? 'column' : 'row',
            alignItems: 'center',
            gap: '8px',
            flex: isVerticalToolbar ? 'none' : 1,
            justifyContent: isVerticalToolbar ? 'flex-start' : 'center',
            minWidth: 0,
            overflowX: isVerticalToolbar ? 'visible' : 'auto',
            scrollbarWidth: 'none',
            padding: isVerticalToolbar ? 0 : '0 6px',
            width: isVerticalToolbar ? '100%' : 'auto'
          }}
        >
          {/* 전체화면 토글 버튼 */}
          <button
            type="button"
            className="g-btn g-btn-secondary"
            onClick={toggleBrowserFullscreen}
            style={{
              fontSize: '12px',
              fontWeight: 700,
              padding: '5px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              color: isBrowserFullscreen ? '#a5b4fc' : '#c9d1d9',
              background: isBrowserFullscreen ? 'rgba(99, 102, 241, 0.2)' : '#21262d',
              border: isBrowserFullscreen ? '1px solid #6366f1' : '1px solid #30363d',
              flexShrink: 0,
              width: isVerticalToolbar ? '100%' : 'auto',
              justifyContent: 'center'
            }}
            title="브라우저 전체화면 토글 (F11)"
          >
            <span>{isBrowserFullscreen ? '🗗' : '⛶'}</span>
            <span>{isBrowserFullscreen ? '창모드' : '전체화면'}</span>
          </button>

          {/* 툴바 위치 4방향 스위처 */}
          <div
            style={
              isVerticalToolbar
                ? {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    background: '#21262d',
                    padding: '2px',
                    borderRadius: '8px',
                    border: '1px solid #30363d',
                    gap: '2px',
                    width: '100%'
                  }
                : {
                    display: 'flex',
                    alignItems: 'center',
                    background: '#21262d',
                    padding: '2px',
                    borderRadius: '8px',
                    border: '1px solid #30363d',
                    gap: '2px',
                    flexShrink: 0
                  }
            }
            title="전자칠판 툴바 위치 이동 (선생님/학생 키 높이 및 서 있는 위치 맞춤)"
          >
            <button
              type="button"
              onClick={() => handleSetToolbarPosition('top')}
              style={{
                background: toolbarPosition === 'top' ? '#388bfd' : 'transparent',
                color: toolbarPosition === 'top' ? '#ffffff' : '#8b949e',
                border: 'none',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                padding: '4px 6px',
                cursor: 'pointer'
              }}
              title="툴바 상단 고정"
            >
              ⬆️상
            </button>
            <button
              type="button"
              onClick={() => handleSetToolbarPosition('bottom')}
              style={{
                background: toolbarPosition === 'bottom' ? '#388bfd' : 'transparent',
                color: toolbarPosition === 'bottom' ? '#ffffff' : '#8b949e',
                border: 'none',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                padding: '4px 6px',
                cursor: 'pointer'
              }}
              title="툴바 하단 고정"
            >
              ⬇️하
            </button>
            <button
              type="button"
              onClick={() => handleSetToolbarPosition('left')}
              style={{
                background: toolbarPosition === 'left' ? '#388bfd' : 'transparent',
                color: toolbarPosition === 'left' ? '#ffffff' : '#8b949e',
                border: 'none',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                padding: '4px 6px',
                cursor: 'pointer'
              }}
              title="툴바 좌측 고정"
            >
              ⬅️좌
            </button>
            <button
              type="button"
              onClick={() => handleSetToolbarPosition('right')}
              style={{
                background: toolbarPosition === 'right' ? '#388bfd' : 'transparent',
                color: toolbarPosition === 'right' ? '#ffffff' : '#8b949e',
                border: 'none',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                padding: '4px 6px',
                cursor: 'pointer'
              }}
              title="툴바 우측 고정"
            >
              ➡️우
            </button>
          </div>

        {/* 3. 쪽 이동 컨트롤 (다중 페이지인 경우) */}
        {studentPages.length > 1 && (
          <div
            style={{
              display: 'flex',
              flexDirection: isVerticalToolbar ? 'column' : 'row',
              alignItems: 'center',
              gap: '4px',
              background: '#21262d',
              padding: '4px 6px',
              borderRadius: '8px',
              border: '1px solid #30363d',
              flexShrink: 0,
              width: isVerticalToolbar ? '100%' : 'auto'
            }}
          >
            <div style={{ display: 'flex', width: isVerticalToolbar ? '100%' : 'auto', gap: '4px' }}>
              <button
                type="button"
                className="g-btn g-btn-secondary"
                style={{ fontSize: '11px', padding: '3px 8px', fontWeight: 700, flex: 1 }}
                disabled={currentPageIdx === 0}
                onClick={() => setCurrentPageIdx(prev => Math.max(0, prev - 1))}
              >
                ◀ 이전
              </button>
              <button
                type="button"
                className="g-btn g-btn-secondary"
                style={{ fontSize: '11px', padding: '3px 8px', fontWeight: 700, flex: 1 }}
                disabled={currentPageIdx >= studentPages.length - 1}
                onClick={() => setCurrentPageIdx(prev => Math.min(studentPages.length - 1, prev + 1))}
              >
                다음 ▶
              </button>
            </div>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#e2e8f0', textAlign: 'center', minWidth: '50px' }}>
              {currentPageIdx + 1} / {studentPages.length} 쪽
            </span>
          </div>
        )}

        {/* 4. 확대 / 축소 / 이동 컨트롤 */}
        <div
          style={{
            display: 'flex',
            flexDirection: isVerticalToolbar ? 'column' : 'row',
            alignItems: 'center',
            gap: '4px',
            background: '#21262d',
            padding: '4px 6px',
            borderRadius: '8px',
            border: '1px solid #30363d',
            flexShrink: 0,
            width: isVerticalToolbar ? '100%' : 'auto'
          }}
        >
          <div style={{ display: 'flex', width: isVerticalToolbar ? '100%' : 'auto', gap: '4px' }}>
            <button
              type="button"
              className="g-btn g-btn-secondary"
              style={{ fontSize: '12px', padding: '4px 7px', fontWeight: 700, flex: 1 }}
              onClick={handleZoomOut}
              title="화면 축소"
            >
              🔍➖
            </button>
            <button
              type="button"
              className="g-btn g-btn-secondary"
              style={{ fontSize: '12px', padding: '4px 7px', fontWeight: 700, flex: 1 }}
              onClick={handleZoomIn}
              title="화면 확대"
            >
              🔍➕
            </button>
          </div>
          <div style={{ display: 'flex', width: isVerticalToolbar ? '100%' : 'auto', gap: '4px' }}>
            <button
              type="button"
              className="g-btn g-btn-secondary"
              style={{ fontSize: '11px', padding: '4px 6px', fontWeight: 700, flex: 1 }}
              onClick={handleResetZoomFit}
              title="화면 맞춤 100% 초기화"
            >
              {zoomPercent}%
            </button>
            <button
              type="button"
              className="g-btn g-btn-secondary"
              style={{ fontSize: '11px', padding: '4px 6px', color: '#93c5fd', flex: 1 }}
              onClick={() => setPanOffset({ x: 0, y: 0 })}
              title="화면 중앙 정렬"
            >
              🎯중앙
            </button>
          </div>
        </div>
      </div>

        {/* 5. 우측(하단): 칭찬 피드백 및 대형 [ ✕ 나가기 ] 버튼 */}
        <div
          style={{
            display: 'flex',
            flexDirection: isVerticalToolbar ? 'column' : 'row',
            alignItems: 'center',
            gap: '8px',
            flexShrink: 0,
            marginTop: isVerticalToolbar ? 'auto' : 0,
            width: isVerticalToolbar ? '100%' : 'auto'
          }}
        >
          {onSendFeedback && (
            <button
              type="button"
              className="g-btn g-btn-primary"
              style={{
                fontSize: '12px',
                fontWeight: 700,
                padding: '6px 10px',
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                border: '1px solid #f59e0b',
                boxShadow: '0 2px 8px rgba(245, 158, 11, 0.3)',
                whiteSpace: 'nowrap',
                width: isVerticalToolbar ? '100%' : 'auto'
              }}
              onClick={() => onSendFeedback(noteRecord.student_name)}
            >
              🌟 참 잘했어요!
            </button>
          )}

          {/* 💥 핵심: 전자칠판 대형 나가기 버튼 */}
          <button
            type="button"
            onClick={onClose}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              fontSize: '14px',
              fontWeight: 800,
              padding: isVerticalToolbar ? '10px 8px' : '7px 16px',
              background: 'rgba(239, 68, 68, 0.25)',
              border: '1.5px solid #ef4444',
              color: '#fca5a5',
              borderRadius: '8px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              width: isVerticalToolbar ? '100%' : 'auto',
              boxShadow: '0 2px 10px rgba(239, 68, 68, 0.3)',
              transition: 'all 0.15s ease'
            }}
            title="학생 필기 전체화면 닫기 (Esc)"
          >
            <span style={{ fontSize: '16px' }}>✕</span>
            <span>나가기</span>
          </button>
        </div>
      </aside>
    );
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: '#0a0d12',
        color: '#f0f6fc',
        display: 'flex',
        flexDirection: isVerticalToolbar ? 'row' : 'column',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        userSelect: 'none',
        fontFamily: '"Pretendard", "Apple SD Gothic Neo", sans-serif'
      }}
    >
      {/* 상단 또는 좌측 툴바 */}
      {(toolbarPosition === 'top' || toolbarPosition === 'left') && renderToolbar()}

      {/* 2. 메인 뷰어 캔버스 (마우스/터치 드래그 이동 및 자유 줌) */}
      <main
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#06090e',
          cursor: isPanning ? 'grabbing' : 'grab',
          touchAction: 'none'
        }}
      >
        {/* 로딩 인디케이터 */}
        {isLoading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(10, 13, 18, 0.85)',
              zIndex: 30
            }}
          >
            <span style={{ fontSize: '36px', display: 'inline-block', animation: 'spin 1s linear infinite' }}>🔄</span>
            <span style={{ marginTop: '12px', fontSize: '14px', color: '#93c5fd', fontWeight: 600 }}>
              학생의 최신 필기 데이터를 동기화 중입니다...
            </span>
          </div>
        )}

        {/* 실제 A4 용지 캔버스 (Pan & Zoom 실시간 적용) */}
        <div
          style={{
            width: `${docWidth}px`,
            height: `${docHeight}px`,
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
            transformOrigin: 'center center',
            transition: isPanning ? 'none' : 'transform 0.12s ease-out',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.1)',
            borderRadius: '6px',
            overflow: 'hidden',
            flexShrink: 0
          }}
        >
          <StudentNoteSheet page={currentPage} orientation={orientation} />
        </div>

        {/* 하단 툴팁 가이드 */}
        <div
          style={{
            position: 'absolute',
            bottom: toolbarPosition === 'bottom' ? '12px' : '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(22, 27, 34, 0.85)',
            backdropFilter: 'blur(8px)',
            border: '1px solid #30363d',
            borderRadius: '20px',
            padding: '5px 14px',
            fontSize: '11.5px',
            color: '#8b949e',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            pointerEvents: 'none',
            zIndex: 20,
            whiteSpace: 'nowrap'
          }}
        >
          <span>💡 드래그로 화면 이동</span>
          <span>•</span>
          <span>휠/버튼으로 확대/축소</span>
          <span>•</span>
          <span>단축키: [←/→] 쪽이동, [ESC] 나가기</span>
        </div>
      </main>

      {/* 하단 또는 우측 툴바 */}
      {(toolbarPosition === 'bottom' || toolbarPosition === 'right') && renderToolbar()}
    </div>
  );
};

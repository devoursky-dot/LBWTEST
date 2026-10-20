import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StudentNoteSheet, type StudentNoteSheetPage } from './StudentNoteSheet';
import type { ClassNoteRecord } from '../lib/supabase';

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

  // 3. 확대/축소(Zoom) 및 화면 이동(Pan) 상태
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

    const availW = Math.max(300, container.clientWidth - 48);
    const availH = Math.max(300, container.clientHeight - 48);

    const scaleW = availW / docWidth;
    const scaleH = availH / docHeight;
    const bestFit = Math.min(scaleW, scaleH);

    return Math.max(0.2, Math.min(3.0, bestFit));
  }, [docWidth, docHeight]);

  // 초기 화면 맞춤 설정
  useEffect(() => {
    const bestFit = calculateFitScale();
    setFitScale(bestFit);
    setZoomScale(bestFit);
    setPanOffset({ x: 0, y: 0 });
  }, [calculateFitScale, orientation]);

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
    // 툴바 클릭 제외
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

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: '#0a0d12',
        color: '#f0f6fc',
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        userSelect: 'none',
        fontFamily: '"Pretendard", "Apple SD Gothic Neo", sans-serif'
      }}
    >
      {/* 1. 상단 전자칠판 풀스크린 컨트롤 바 */}
      <header
        style={{
          height: '64px',
          background: '#161b22',
          borderBottom: '1px solid #30363d',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          flexShrink: 0,
          zIndex: 10,
          gap: '12px'
        }}
      >
        {/* 좌측 + 중앙 스크롤 가능 영역 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            overflowX: 'auto',
            flex: 1,
            minWidth: 0,
            scrollbarWidth: 'none',
            whiteSpace: 'nowrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <span style={{ fontSize: '24px' }}>👨‍🎓</span>
            <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: '#ffffff' }}>
              {noteRecord.student_grade}학년 {noteRecord.student_class}반 {noteRecord.student_num}번 {noteRecord.student_name}
            </h2>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                background: 'rgba(59, 130, 246, 0.15)',
                color: '#93c5fd',
                padding: '2px 8px',
                borderRadius: '6px',
                border: '1px solid rgba(59, 130, 246, 0.3)'
              }}
            >
              {isPortrait ? '📐 세로' : '📐 가로'}
            </span>
          </div>

          {/* 페이지 이동 컨트롤 */}
          {studentPages.length > 1 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: '#21262d',
                padding: '4px 8px',
                borderRadius: '8px',
                border: '1px solid #30363d',
                flexShrink: 0
              }}
            >
              <button
                type="button"
                className="g-btn g-btn-secondary"
                style={{ fontSize: '12px', padding: '4px 10px', fontWeight: 700 }}
                disabled={currentPageIdx === 0}
                onClick={() => setCurrentPageIdx(prev => Math.max(0, prev - 1))}
              >
                ◀ 이전 쪽
              </button>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#e2e8f0', minWidth: '60px', textAlign: 'center' }}>
                {currentPageIdx + 1} / {studentPages.length} 쪽
              </span>
              <button
                type="button"
                className="g-btn g-btn-secondary"
                style={{ fontSize: '12px', padding: '4px 10px', fontWeight: 700 }}
                disabled={currentPageIdx >= studentPages.length - 1}
                onClick={() => setCurrentPageIdx(prev => Math.min(studentPages.length - 1, prev + 1))}
              >
                다음 쪽 ▶
              </button>
            </div>
          )}

          {/* 확대 / 축소 / 이동 컨트롤 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: '#21262d',
              padding: '4px 8px',
              borderRadius: '8px',
              border: '1px solid #30363d',
              flexShrink: 0
            }}
          >
            <button
              type="button"
              className="g-btn g-btn-secondary"
              style={{ fontSize: '12px', padding: '4px 8px', fontWeight: 700 }}
              onClick={handleZoomOut}
              title="화면 축소"
            >
              🔍➖
            </button>
            <button
              type="button"
              className="g-btn g-btn-secondary"
              style={{ fontSize: '12px', padding: '4px 10px', fontWeight: 700, minWidth: '64px' }}
              onClick={handleResetZoomFit}
              title="화면 맞춤 100% 초기화"
            >
              {zoomPercent}%
            </button>
            <button
              type="button"
              className="g-btn g-btn-secondary"
              style={{ fontSize: '12px', padding: '4px 8px', fontWeight: 700 }}
              onClick={handleZoomIn}
              title="화면 확대"
            >
              🔍➕
            </button>
            <button
              type="button"
              className="g-btn g-btn-secondary"
              style={{ fontSize: '12px', padding: '4px 8px', color: '#93c5fd' }}
              onClick={() => {
                setPanOffset({ x: 0, y: 0 });
              }}
              title="화면 중앙 정렬"
            >
              🎯 중앙
            </button>
          </div>
        </div>

        {/* 우측: 칭찬 피드백 및 고정 나가기 버튼 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, whiteSpace: 'nowrap' }}>
          {onSendFeedback && (
            <button
              type="button"
              className="g-btn g-btn-primary"
              style={{
                fontSize: '13px',
                fontWeight: 700,
                padding: '8px 14px',
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                border: '1px solid #f59e0b',
                boxShadow: '0 2px 8px rgba(245, 158, 11, 0.3)',
                whiteSpace: 'nowrap',
                flexShrink: 0
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
              gap: '6px',
              fontSize: '15px',
              fontWeight: 800,
              padding: '8px 18px',
              background: 'rgba(239, 68, 68, 0.25)',
              border: '1.5px solid #ef4444',
              color: '#fca5a5',
              borderRadius: '8px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              transition: 'all 0.15s ease',
              boxShadow: '0 2px 10px rgba(239, 68, 68, 0.3)'
            }}
            title="학생 필기 전체화면 닫기 (Esc)"
          >
            <span style={{ fontSize: '16px' }}>✕</span>
            <span>나가기</span>
          </button>
        </div>
      </header>

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

        {/* 실제 A4 용지 캔버스 (Pan & Zoom 실시간 60fps 적용) */}
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
            bottom: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(22, 27, 34, 0.85)',
            backdropFilter: 'blur(8px)',
            border: '1px solid #30363d',
            borderRadius: '20px',
            padding: '6px 16px',
            fontSize: '12px',
            color: '#8b949e',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            pointerEvents: 'none',
            zIndex: 20
          }}
        >
          <span>💡 마우스/터치 드래그로 화면 이동</span>
          <span>•</span>
          <span>휠이나 상단 버튼으로 확대/축소</span>
          <span>•</span>
          <span>단축키: [← / →] 쪽 이동, [ESC] 나가기</span>
        </div>
      </main>
    </div>
  );
};

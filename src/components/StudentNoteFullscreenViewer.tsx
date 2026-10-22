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
  const sheetContainerRef = useRef<HTMLDivElement>(null);

  const [zoomScale, setZoomScale] = useState<number>(1);
  const [fitScale, setFitScale] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  // 고성능 60fps GPU 가속을 위한 실시간 ref 및 RAF 추적
  const panOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const zoomScaleRef = useRef<number>(1);
  const rafIdRef = useRef<number | null>(null);

  // 멀티터치 & 핀치 줌 추적 레퍼런스
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{
    dist: number;
    midpoint: { x: number; y: number };
    scale: number;
    pan: { x: number; y: number };
  } | null>(null);
  const singlePanStartRef = useRef<{
    x: number;
    y: number;
    pan: { x: number; y: number };
  } | null>(null);

  // React 상태와 Ref 및 실제 DOM style.transform 동기화
  const syncTransformToDom = useCallback((scale: number, pan: { x: number; y: number }) => {
    if (sheetContainerRef.current) {
      sheetContainerRef.current.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;
    }
  }, []);

  const scheduleTransformUpdate = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      syncTransformToDom(zoomScaleRef.current, panOffsetRef.current);
    });
  }, [syncTransformToDom]);

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
    const timer = setTimeout(() => {
      const bestFit = calculateFitScale();
      setFitScale(bestFit);
      setZoomScale(bestFit);
      setPanOffset({ x: 0, y: 0 });
      zoomScaleRef.current = bestFit;
      panOffsetRef.current = { x: 0, y: 0 };
      syncTransformToDom(bestFit, { x: 0, y: 0 });
    }, 60);
    return () => clearTimeout(timer);
  }, [calculateFitScale, orientation, toolbarPosition, syncTransformToDom]);

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
    const next = Math.min(3.5, zoomScaleRef.current * 1.2);
    setZoomScale(next);
    zoomScaleRef.current = next;
    syncTransformToDom(next, panOffsetRef.current);
  };

  const handleZoomOut = () => {
    const next = Math.max(fitScale * 0.4, zoomScaleRef.current / 1.2);
    setZoomScale(next);
    zoomScaleRef.current = next;
    syncTransformToDom(next, panOffsetRef.current);
  };

  const handleResetZoomFit = () => {
    setZoomScale(fitScale);
    setPanOffset({ x: 0, y: 0 });
    zoomScaleRef.current = fitScale;
    panOffsetRef.current = { x: 0, y: 0 };
    syncTransformToDom(fitScale, { x: 0, y: 0 });
  };

  // 키보드 단축키
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && currentPageIdx > 0) {
        setCurrentPageIdx(prev => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight' && currentPageIdx < studentPages.length - 1) {
        setCurrentPageIdx(prev => Math.min(studentPages.length - 1, prev + 1));
      } else if (e.key === '+' || e.key === '=') {
        handleZoomIn();
      } else if (e.key === '-' || e.key === '_') {
        handleZoomOut();
      } else if (e.key === '0') {
        handleResetZoomFit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, currentPageIdx, studentPages.length, fitScale]);

  // 멀티터치 & 마우스 제스처 (1점 터치 이동, 2점 터치 중심 확대/축소 및 이동)
  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;

    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}

    const pointerCount = activePointersRef.current.size;
    setIsPanning(true);

    if (pointerCount === 1) {
      // 1점 터치 / 마우스: 드래그 이동(Pan) 준비
      singlePanStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        pan: { ...panOffsetRef.current }
      };
      pinchStartRef.current = null;
    } else if (pointerCount === 2) {
      // 2점 터치: 두 손가락 중심 핀치 줌 준비
      const pts = Array.from(activePointersRef.current.values());
      const p1 = pts[0];
      const p2 = pts[1];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const midpoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

      pinchStartRef.current = {
        dist: Math.max(10, dist),
        midpoint,
        scale: zoomScaleRef.current,
        pan: { ...panOffsetRef.current }
      };
      singlePanStartRef.current = null;
    } else {
      // 3점 이상 (손바닥/Palm Rejection): 오터치 방지를 위해 제스처 홀드
      pinchStartRef.current = null;
      singlePanStartRef.current = null;
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activePointersRef.current.has(e.pointerId)) return;
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const pointerCount = activePointersRef.current.size;

    if (pointerCount === 1 && singlePanStartRef.current) {
      // 1점 터치: 부드러운 화면 이동(Pan)
      const dx = e.clientX - singlePanStartRef.current.x;
      const dy = e.clientY - singlePanStartRef.current.y;
      panOffsetRef.current = {
        x: singlePanStartRef.current.pan.x + dx,
        y: singlePanStartRef.current.pan.y + dy
      };
      scheduleTransformUpdate();
    } else if (pointerCount === 2 && pinchStartRef.current && containerRef.current) {
      // 2점 터치: 두 손가락 중심 기준 핀치 줌(Focal-point Zoom) 및 동시 이동(Pan)
      const pts = Array.from(activePointersRef.current.values());
      const p1 = pts[0];
      const p2 = pts[1];
      const currentDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const currentMid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

      const { dist: startDist, midpoint: startMid, scale: startScale, pan: startPan } = pinchStartRef.current;
      const rawScale = startScale * (currentDist / startDist);
      const clampedScale = Math.max(fitScale * 0.4, Math.min(3.5, rawScale));
      const scaleRatio = clampedScale / startScale;

      const rect = containerRef.current.getBoundingClientRect();
      const contCenterX = rect.width / 2;
      const contCenterY = rect.height / 2;

      const startMidRelX = startMid.x - rect.left;
      const startMidRelY = startMid.y - rect.top;
      const curMidRelX = currentMid.x - rect.left;
      const curMidRelY = currentMid.y - rect.top;

      // 두 손가락 중심점 고정 수학 공식
      const newPanX = (curMidRelX - contCenterX) - scaleRatio * (startMidRelX - contCenterX - startPan.x);
      const newPanY = (curMidRelY - contCenterY) - scaleRatio * (startMidRelY - contCenterY - startPan.y);

      zoomScaleRef.current = clampedScale;
      panOffsetRef.current = { x: newPanX, y: newPanY };
      scheduleTransformUpdate();
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    activePointersRef.current.delete(e.pointerId);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}

    const remainingCount = activePointersRef.current.size;
    if (remainingCount === 1) {
      // 2개에서 1개로 줄었을 때: 남은 손가락으로 자연스럽게 1점 팬으로 전환
      const remaining = Array.from(activePointersRef.current.values())[0];
      singlePanStartRef.current = {
        x: remaining.x,
        y: remaining.y,
        pan: { ...panOffsetRef.current }
      };
      pinchStartRef.current = null;
    } else if (remainingCount === 0) {
      // 모든 손가락 뗌: React 상태에 최종 동기화 (불필요한 리렌더링 최소화)
      setIsPanning(false);
      singlePanStartRef.current = null;
      pinchStartRef.current = null;
      setPanOffset(panOffsetRef.current);
      setZoomScale(zoomScaleRef.current);
    }
  };

  // 마우스 휠 줌 핸들러 (커서 위치 중심 확대/축소)
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;

    const delta = e.deltaY < 0 ? 1.15 : 0.87;
    const curScale = zoomScaleRef.current;
    const nextScale = Math.max(fitScale * 0.4, Math.min(3.5, curScale * delta));
    const ratio = nextScale / curScale;

    const rect = containerRef.current.getBoundingClientRect();
    const contCenterX = rect.width / 2;
    const contCenterY = rect.height / 2;

    const cursorRelX = e.clientX - rect.left;
    const cursorRelY = e.clientY - rect.top;

    const newPanX = (cursorRelX - contCenterX) - ratio * (cursorRelX - contCenterX - panOffsetRef.current.x);
    const newPanY = (cursorRelY - contCenterY) - ratio * (cursorRelY - contCenterY - panOffsetRef.current.y);

    zoomScaleRef.current = nextScale;
    panOffsetRef.current = { x: newPanX, y: newPanY };
    syncTransformToDom(nextScale, { x: newPanX, y: newPanY });

    setZoomScale(nextScale);
    setPanOffset({ x: newPanX, y: newPanY });
  };

  const zoomPercent = Math.round((zoomScale / fitScale) * 100);
  const isVerticalToolbar = toolbarPosition === 'left' || toolbarPosition === 'right';

  // --------------------------------------------------------------------------
  // [공통 툴바 렌더러]
  // --------------------------------------------------------------------------
  const renderToolbar = () => {
    return (
      <header
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
          height: isVerticalToolbar ? '100%' : '62px',
          width: isVerticalToolbar ? '154px' : '100%',
          flexShrink: 0,
          zIndex: 100,
          gap: isVerticalToolbar ? '10px' : '14px',
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
              {isPortrait ? '📐 세로' : '📐 가로'}
            </span>
          </div>
          <h2
            style={{
              fontSize: isVerticalToolbar ? '13px' : '15px',
              fontWeight: 700,
              margin: 0,
              color: '#ffffff',
              whiteSpace: 'nowrap'
            }}
          >
            {noteRecord.student_grade}-{noteRecord.student_class} {noteRecord.student_num}번 {noteRecord.student_name}
          </h2>
        </div>

        {/* 중앙: 쪽 이동 및 확대/축소 핵심 컨트롤 (flexShrink 0으로 절대 숨겨지지 않음) */}
        <div
          style={{
            display: 'flex',
            flexDirection: isVerticalToolbar ? 'column' : 'row',
            alignItems: 'center',
            gap: isVerticalToolbar ? '8px' : '12px',
            flexShrink: 0,
            justifyContent: 'center',
            width: isVerticalToolbar ? '100%' : 'auto'
          }}
        >
          {/* 1. 페이지 이동 컨트롤 (항상 표시: 1쪽이어도 1/1쪽 확인 가능) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: '#21262d',
              padding: '4px 8px',
              borderRadius: '8px',
              border: '1px solid #30363d',
              flexShrink: 0,
              width: isVerticalToolbar ? '100%' : 'auto',
              justifyContent: 'center'
            }}
          >
            <button
              type="button"
              disabled={currentPageIdx <= 0}
              onClick={() => setCurrentPageIdx(prev => Math.max(0, prev - 1))}
              style={{
                fontSize: '12.5px',
                padding: '5px 10px',
                fontWeight: 700,
                background: currentPageIdx <= 0 ? '#161b22' : 'rgba(56, 139, 253, 0.15)',
                color: currentPageIdx <= 0 ? '#484f58' : '#58a6ff',
                border: '1px solid #30363d',
                borderRadius: '6px',
                cursor: currentPageIdx <= 0 ? 'not-allowed' : 'pointer'
              }}
              title="이전 페이지 (단축키: ←)"
            >
              ◀ 이전 쪽
            </button>
            <span
              style={{
                fontSize: '13px',
                fontWeight: 700,
                color: '#e2e8f0',
                textAlign: 'center',
                minWidth: '58px',
                padding: '0 4px'
              }}
            >
              {currentPageIdx + 1} / {studentPages.length} 쪽
            </span>
            <button
              type="button"
              disabled={currentPageIdx >= studentPages.length - 1}
              onClick={() => setCurrentPageIdx(prev => Math.min(studentPages.length - 1, prev + 1))}
              style={{
                fontSize: '12.5px',
                padding: '5px 10px',
                fontWeight: 700,
                background: currentPageIdx >= studentPages.length - 1 ? '#161b22' : 'rgba(56, 139, 253, 0.15)',
                color: currentPageIdx >= studentPages.length - 1 ? '#484f58' : '#58a6ff',
                border: '1px solid #30363d',
                borderRadius: '6px',
                cursor: currentPageIdx >= studentPages.length - 1 ? 'not-allowed' : 'pointer'
              }}
              title="다음 페이지 (단축키: →)"
            >
              다음 쪽 ▶
            </button>
          </div>

          {/* 2. 확대 / 축소 / 맞춤 컨트롤 (항상 표시) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: '#21262d',
              padding: '4px 8px',
              borderRadius: '8px',
              border: '1px solid #30363d',
              flexShrink: 0,
              width: isVerticalToolbar ? '100%' : 'auto',
              justifyContent: 'center'
            }}
          >
            <button
              type="button"
              style={{
                fontSize: '13px',
                padding: '5px 9px',
                fontWeight: 700,
                background: '#161b22',
                color: '#f0f6fc',
                border: '1px solid #30363d',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
              onClick={handleZoomOut}
              title="화면 축소 (단축키: -)"
            >
              🔍➖
            </button>
            <button
              type="button"
              style={{
                fontSize: '12px',
                padding: '5px 8px',
                fontWeight: 700,
                background: '#161b22',
                color: '#38bdf8',
                border: '1px solid #30363d',
                borderRadius: '6px',
                cursor: 'pointer',
                minWidth: '56px',
                textAlign: 'center'
              }}
              onClick={handleResetZoomFit}
              title="화면 맞춤 100% 초기화 (단축키: 0)"
            >
              {zoomPercent}%
            </button>
            <button
              type="button"
              style={{
                fontSize: '13px',
                padding: '5px 9px',
                fontWeight: 700,
                background: '#161b22',
                color: '#f0f6fc',
                border: '1px solid #30363d',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
              onClick={handleZoomIn}
              title="화면 확대 (단축키: +)"
            >
              🔍➕
            </button>
            <button
              type="button"
              style={{
                fontSize: '12px',
                padding: '5px 8px',
                fontWeight: 700,
                background: '#161b22',
                color: '#93c5fd',
                border: '1px solid #30363d',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
              onClick={() => setPanOffset({ x: 0, y: 0 })}
              title="화면 중앙 정렬"
            >
              🎯 중앙
            </button>
          </div>

          {/* 3. 전체화면 & 툴바 위치 버튼 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            <button
              type="button"
              onClick={toggleBrowserFullscreen}
              style={{
                fontSize: '12px',
                fontWeight: 700,
                padding: '5px 9px',
                color: isBrowserFullscreen ? '#a5b4fc' : '#c9d1d9',
                background: isBrowserFullscreen ? 'rgba(99, 102, 241, 0.2)' : '#21262d',
                border: isBrowserFullscreen ? '1px solid #6366f1' : '1px solid #30363d',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
              title="브라우저 전체화면 토글 (F11)"
            >
              <span>{isBrowserFullscreen ? '🗗' : '⛶'}</span>
              <span>{isBrowserFullscreen ? '창모드' : '전체화면'}</span>
            </button>

            {/* 툴바 상/하/좌/우 위치 변경 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: '#21262d',
                padding: '2px',
                borderRadius: '6px',
                border: '1px solid #30363d',
                gap: '2px'
              }}
              title="전자칠판 툴바 위치 (상/하/좌/우)"
            >
              <button
                type="button"
                onClick={() => handleSetToolbarPosition('top')}
                style={{
                  background: toolbarPosition === 'top' ? '#388bfd' : 'transparent',
                  color: toolbarPosition === 'top' ? '#ffffff' : '#8b949e',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '10.5px',
                  fontWeight: 700,
                  padding: '3px 5px',
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
                  borderRadius: '4px',
                  fontSize: '10.5px',
                  fontWeight: 700,
                  padding: '3px 5px',
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
                  borderRadius: '4px',
                  fontSize: '10.5px',
                  fontWeight: 700,
                  padding: '3px 5px',
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
                  borderRadius: '4px',
                  fontSize: '10.5px',
                  fontWeight: 700,
                  padding: '3px 5px',
                  cursor: 'pointer'
                }}
                title="툴바 우측 고정"
              >
                ➡️우
              </button>
            </div>
          </div>
        </div>

        {/* 우측: 칭찬 피드백 및 대형 [ ✕ 나가기 ] 버튼 */}
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
              style={{
                fontSize: '12.5px',
                fontWeight: 700,
                padding: '6px 12px',
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: '#ffffff',
                border: '1px solid #f59e0b',
                borderRadius: '8px',
                boxShadow: '0 2px 8px rgba(245, 158, 11, 0.3)',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                width: isVerticalToolbar ? '100%' : 'auto'
              }}
              onClick={() => onSendFeedback(noteRecord.student_name)}
            >
              🌟 참 잘했어요!
            </button>
          )}

          {/* 전자칠판 대형 나가기 버튼 */}
          <button
            type="button"
            onClick={onClose}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              fontSize: '14.5px',
              fontWeight: 800,
              padding: isVerticalToolbar ? '10px 8px' : '7px 18px',
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
      </header>
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
          ref={sheetContainerRef}
          style={{
            width: `${docWidth}px`,
            height: `${docHeight}px`,
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
            transformOrigin: 'center center',
            transition: isPanning ? 'none' : 'transform 0.12s ease-out',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.1)',
            borderRadius: '6px',
            overflow: 'hidden',
            flexShrink: 0,
            willChange: 'transform'
          }}
        >
          <StudentNoteSheet page={currentPage} orientation={orientation} />
        </div>

        {/* 🌟 핵심: 전자칠판 전용 캔버스 플로팅 퀵 툴바 (손 닿는 곳에 항상 고정) */}
        <aside
          style={{
            position: 'absolute',
            bottom: toolbarPosition === 'bottom' ? '20px' : '24px',
            right: toolbarPosition === 'right' ? '20px' : '24px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(22, 27, 34, 0.94)',
            backdropFilter: 'blur(12px)',
            border: '1.5px solid rgba(59, 130, 246, 0.4)',
            borderRadius: '30px',
            padding: '6px 14px',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.75)',
            zIndex: 60
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 쪽 이동 버튼 그룹 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              type="button"
              disabled={currentPageIdx <= 0}
              onClick={() => setCurrentPageIdx(p => Math.max(0, p - 1))}
              style={{
                fontSize: '13px',
                padding: '4px 8px',
                fontWeight: 700,
                background: currentPageIdx <= 0 ? 'transparent' : 'rgba(56, 139, 253, 0.2)',
                color: currentPageIdx <= 0 ? '#484f58' : '#58a6ff',
                border: 'none',
                borderRadius: '6px',
                cursor: currentPageIdx <= 0 ? 'not-allowed' : 'pointer'
              }}
              title="이전 쪽 (←)"
            >
              ◀
            </button>
            <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#38bdf8', minWidth: '45px', textAlign: 'center' }}>
              {currentPageIdx + 1}/{studentPages.length}
            </span>
            <button
              type="button"
              disabled={currentPageIdx >= studentPages.length - 1}
              onClick={() => setCurrentPageIdx(p => Math.min(studentPages.length - 1, p + 1))}
              style={{
                fontSize: '13px',
                padding: '4px 8px',
                fontWeight: 700,
                background: currentPageIdx >= studentPages.length - 1 ? 'transparent' : 'rgba(56, 139, 253, 0.2)',
                color: currentPageIdx >= studentPages.length - 1 ? '#484f58' : '#58a6ff',
                border: 'none',
                borderRadius: '6px',
                cursor: currentPageIdx >= studentPages.length - 1 ? 'not-allowed' : 'pointer'
              }}
              title="다음 쪽 (→)"
            >
              ▶
            </button>
          </div>

          <div style={{ width: '1px', height: '18px', background: 'rgba(255, 255, 255, 0.15)' }} />

          {/* 줌 확대/축소 버튼 그룹 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <button
              type="button"
              onClick={handleZoomOut}
              style={{
                fontSize: '12px',
                padding: '4px 7px',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
              title="화면 축소"
            >
              🔍➖
            </button>
            <button
              type="button"
              onClick={handleResetZoomFit}
              style={{
                fontSize: '11.5px',
                fontWeight: 700,
                padding: '4px 6px',
                background: 'rgba(56, 139, 253, 0.2)',
                color: '#60a5fa',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                minWidth: '48px',
                textAlign: 'center'
              }}
              title="화면 맞춤 100%"
            >
              {zoomPercent}%
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              style={{
                fontSize: '12px',
                padding: '4px 7px',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
              title="화면 확대"
            >
              🔍➕
            </button>
            <button
              type="button"
              onClick={() => setPanOffset({ x: 0, y: 0 })}
              style={{
                fontSize: '12px',
                padding: '4px 6px',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#93c5fd',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
              title="중앙 정렬"
            >
              🎯
            </button>
          </div>
        </aside>

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
          <span>💡 1손가락: 화면 이동</span>
          <span>•</span>
          <span>✌️ 2손가락 핀치: 중심 확대/축소</span>
          <span>•</span>
          <span>휠/버튼: 확대축소</span>
          <span>•</span>
          <span>단축키: [←/→] 쪽이동, [ESC] 나가기</span>
        </div>
      </main>

      {/* 하단 또는 우측 툴바 */}
      {(toolbarPosition === 'bottom' || toolbarPosition === 'right') && renderToolbar()}
    </div>
  );
};

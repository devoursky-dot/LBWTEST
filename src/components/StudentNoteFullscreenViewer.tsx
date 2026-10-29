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
  onRefresh?: () => void;
}

// ============================================================================
// 🎨 표준 벡터 SVG 아이콘 세트 (최신 트렌드 Geist / Lucide 스타일 24x24)
// ============================================================================

/** 툴바 숨기기 / 펼치기 토글 (동심원 ◎ 아이콘 - 사용자 스케치 1:1 역추적) */
const IconCollapse: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4" fill="currentColor" fillOpacity="0.35" />
  </svg>
);

/** 숨김 메뉴 (햄버거 3선 ≡ 아이콘 - 사용자 스케치 1:1 역추적) */
const IconMenu: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </svg>
);

/** 이전 페이지 쉐브론 (<) */
const IconChevronLeft: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

/** 다음 페이지 쉐브론 (>) */
const IconChevronRight: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

/** 전체화면 진입 (□ 사각 뷰파인더) */
const IconFullscreen: React.FC<{ size?: number }> = ({ size = 19 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
  </svg>
);

/** 전체화면 해제 (축소 뷰파인더) */
const IconFullscreenExit: React.FC<{ size?: number }> = ({ size = 19 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 14h6m0 0v6m0-6-7 7m17-11h-6m0 0V4m0 6 7-7M4 10h6m0 0V4m0 6-7-7m17 11h-6m0 0v6m0-6 7 7" />
  </svg>
);

/** 닫기 / 나가기 (✕) */
const IconClose: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

/** 참 잘했어요 칭찬 별 (★) */
const IconStar: React.FC<{ size?: number }> = ({ size = 19 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

/** 화면 맞춤 (🎯 100% Fit) */
const IconFit: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="3" />
    <line x1="12" y1="2" x2="12" y2="5" />
    <line x1="12" y1="19" x2="12" y2="22" />
    <line x1="2" y1="12" x2="5" y2="12" />
    <line x1="19" y1="12" x2="22" y2="12" />
  </svg>
);

/** 줌 인 (+) */
const IconZoomIn: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="11" y1="8" x2="11" y2="14" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);

/** 줌 아웃 (-) */
const IconZoomOut: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);

// ============================================================================
// 💡 커스텀 스마트 툴팁 버튼 컴포넌트
// ============================================================================
interface TooltipButtonProps {
  onClick: (e: React.MouseEvent) => void;
  tooltip: string;
  shortcut?: string;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  accent?: boolean;
  style?: React.CSSProperties;
  dockPosition?: ToolbarPosition;
}

const TooltipButton: React.FC<TooltipButtonProps> = ({
  onClick,
  tooltip,
  shortcut,
  children,
  active = false,
  disabled = false,
  danger = false,
  accent = false,
  style,
  dockPosition = 'right'
}) => {
  const [isHovered, setIsHovered] = useState(false);

  // 툴팁 위치 자동 계산 (독 위치의 반대편에 산뜻하게 표시)
  let tooltipStyle: React.CSSProperties = {
    position: 'absolute',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
    zIndex: 1200,
    background: 'rgba(15, 18, 24, 0.96)',
    backdropFilter: 'blur(16px)',
    border: '1px solid rgba(255, 255, 255, 0.14)',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.7)',
    borderRadius: '8px',
    padding: '5px 9px',
    fontSize: '11px',
    fontWeight: 600,
    color: '#f0f6fc',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'opacity 0.15s ease, transform 0.15s ease',
    opacity: isHovered && !disabled ? 1 : 0,
    visibility: isHovered && !disabled ? 'visible' : 'hidden'
  };

  if (dockPosition === 'right') {
    tooltipStyle.right = 'calc(100% + 10px)';
    tooltipStyle.top = '50%';
    tooltipStyle.transform = isHovered ? 'translateY(-50%) translateX(0)' : 'translateY(-50%) translateX(4px)';
  } else if (dockPosition === 'left') {
    tooltipStyle.left = 'calc(100% + 10px)';
    tooltipStyle.top = '50%';
    tooltipStyle.transform = isHovered ? 'translateY(-50%) translateX(0)' : 'translateY(-50%) translateX(-4px)';
  } else if (dockPosition === 'top') {
    tooltipStyle.top = 'calc(100% + 10px)';
    tooltipStyle.left = '50%';
    tooltipStyle.transform = isHovered ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(-4px)';
  } else {
    tooltipStyle.bottom = 'calc(100% + 10px)';
    tooltipStyle.left = '50%';
    tooltipStyle.transform = isHovered ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(4px)';
  }

  // 색상 테마 결정
  let bg = 'transparent';
  let color = '#c9d1d9';
  let borderColor = 'transparent';

  if (active) {
    bg = 'rgba(56, 189, 248, 0.2)';
    color = '#38bdf8';
    borderColor = 'rgba(56, 189, 248, 0.4)';
  } else if (accent) {
    bg = 'rgba(245, 158, 11, 0.2)';
    color = '#fbbf24';
  } else if (danger) {
    bg = isHovered ? 'rgba(239, 68, 68, 0.25)' : 'rgba(239, 68, 68, 0.12)';
    color = '#fca5a5';
    borderColor = 'rgba(239, 68, 68, 0.35)';
  } else if (isHovered && !disabled) {
    bg = 'rgba(255, 255, 255, 0.1)';
    color = '#ffffff';
  }

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          width: '38px',
          height: '38px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '12px',
          border: `1px solid ${borderColor}`,
          background: bg,
          color: disabled ? '#484f58' : color,
          cursor: disabled ? 'not-allowed' : 'pointer',
          padding: 0,
          transition: 'all 0.16s cubic-bezier(0.16, 1, 0.3, 1)',
          transform: isHovered && !disabled ? 'scale(1.05)' : 'scale(1)',
          ...style
        }}
        title={`${tooltip}${shortcut ? ` [${shortcut}]` : ''}`}
      >
        {children}
      </button>

      {/* 스마트 플로팅 툴팁 */}
      <div style={tooltipStyle}>
        <span>{tooltip}</span>
        {shortcut && (
          <kbd
            style={{
              background: 'rgba(255, 255, 255, 0.12)',
              border: '1px solid rgba(255, 255, 255, 0.16)',
              borderRadius: '4px',
              padding: '1px 5px',
              fontSize: '10px',
              color: '#93c5fd',
              fontWeight: 700
            }}
          >
            {shortcut}
          </kbd>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 🌟 메인 컴포넌트: 굿노트/삼성노트 감성 풀스크린 뷰어
// ============================================================================
export const StudentNoteFullscreenViewer: React.FC<StudentNoteFullscreenViewerProps> = ({
  noteRecord,
  initialPageIdx = 0,
  isLoading = false,
  onClose,
  onSendFeedback,
  onRefresh
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
    Math.min(Math.max(0, initialPageIdx), Math.max(0, studentPages.length - 1))
  );

  // 학생 데이터가 비동기로 로드되거나 쪽수가 변경되면 학생이 보고 있는 해당 쪽으로 즉각 동기화
  useEffect(() => {
    if (initialPageIdx !== undefined && initialPageIdx >= 0) {
      const validTarget = Math.min(initialPageIdx, Math.max(0, studentPages.length - 1));
      setCurrentPageIdx(validTarget);
    }
  }, [initialPageIdx, studentPages.length]);

  const currentPage = studentPages[currentPageIdx] || {
    strokes: [],
    textItems: [],
    images: []
  };

  // 3. 툴바 위치 (상/하/좌/우) 및 접힘(Collapse), 숨김 메뉴(Menu) 상태
  const [toolbarPosition, setToolbarPosition] = useState<ToolbarPosition>(() => {
    try {
      const saved = localStorage.getItem('lbw_viewer_toolbar_pos');
      if (saved === 'top' || saved === 'bottom' || saved === 'left' || saved === 'right') {
        return saved;
      }
    } catch {}
    return 'right'; // 기본 우측 독
  });

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // 외부 클릭 시 숨김 메뉴 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    if (isMenuOpen) {
      document.addEventListener('pointerdown', handleClickOutside);
    }
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [isMenuOpen]);

  const handleSetToolbarPosition = (pos: ToolbarPosition) => {
    setToolbarPosition(pos);
    setIsMenuOpen(false);
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

  // 초기 화면 맞춤 설정 (방향이나 창 크기 변경 시 자동 재계산)
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
  }, [calculateFitScale, orientation, syncTransformToDom]);

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
    const next = Math.min(4.0, zoomScaleRef.current * 1.25);
    setZoomScale(next);
    zoomScaleRef.current = next;
    syncTransformToDom(next, panOffsetRef.current);
  };

  const handleZoomOut = () => {
    const next = Math.max(fitScale * 0.4, zoomScaleRef.current / 1.25);
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
        if (isMenuOpen) {
          setIsMenuOpen(false);
        } else {
          onClose();
        }
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
  }, [onClose, currentPageIdx, studentPages.length, fitScale, isMenuOpen]);

  // 터치 & 마우스 드래그 / 핀치 줌 제스처
  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, aside, header')) return;

    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}

    const pointerCount = activePointersRef.current.size;
    setIsPanning(true);

    if (pointerCount === 1) {
      singlePanStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        pan: { ...panOffsetRef.current }
      };
      pinchStartRef.current = null;
    } else if (pointerCount === 2) {
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
      pinchStartRef.current = null;
      singlePanStartRef.current = null;
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activePointersRef.current.has(e.pointerId)) return;
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const pointerCount = activePointersRef.current.size;

    if (pointerCount === 1 && singlePanStartRef.current) {
      const dx = e.clientX - singlePanStartRef.current.x;
      const dy = e.clientY - singlePanStartRef.current.y;
      panOffsetRef.current = {
        x: singlePanStartRef.current.pan.x + dx,
        y: singlePanStartRef.current.pan.y + dy
      };
      scheduleTransformUpdate();
    } else if (pointerCount === 2 && pinchStartRef.current && containerRef.current) {
      const pts = Array.from(activePointersRef.current.values());
      const p1 = pts[0];
      const p2 = pts[1];
      const currentDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const currentMid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

      const { dist: startDist, midpoint: startMid, scale: startScale, pan: startPan } = pinchStartRef.current;
      const rawScale = startScale * (currentDist / startDist);
      const clampedScale = Math.max(fitScale * 0.4, Math.min(4.0, rawScale));
      const scaleRatio = clampedScale / startScale;

      const rect = containerRef.current.getBoundingClientRect();
      const contCenterX = rect.width / 2;
      const contCenterY = rect.height / 2;

      const startMidRelX = startMid.x - rect.left;
      const startMidRelY = startMid.y - rect.top;
      const curMidRelX = currentMid.x - rect.left;
      const curMidRelY = currentMid.y - rect.top;

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
      const remaining = Array.from(activePointersRef.current.values())[0];
      singlePanStartRef.current = {
        x: remaining.x,
        y: remaining.y,
        pan: { ...panOffsetRef.current }
      };
      pinchStartRef.current = null;
    } else if (remainingCount === 0) {
      setIsPanning(false);
      singlePanStartRef.current = null;
      pinchStartRef.current = null;
      setPanOffset(panOffsetRef.current);
      setZoomScale(zoomScaleRef.current);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;

    const delta = e.deltaY < 0 ? 1.15 : 0.87;
    const curScale = zoomScaleRef.current;
    const nextScale = Math.max(fitScale * 0.4, Math.min(4.0, curScale * delta));
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
  const isHorizontalDock = toolbarPosition === 'top' || toolbarPosition === 'bottom';

  // 툴바 독 위치 스타일 계산
  const getDockPositionStyle = (): React.CSSProperties => {
    if (toolbarPosition === 'right') {
      return {
        position: 'absolute',
        right: '18px',
        top: '50%',
        transform: 'translateY(-50%)',
        flexDirection: 'column'
      };
    }
    if (toolbarPosition === 'left') {
      return {
        position: 'absolute',
        left: '18px',
        top: '50%',
        transform: 'translateY(-50%)',
        flexDirection: 'column'
      };
    }
    if (toolbarPosition === 'top') {
      return {
        position: 'absolute',
        top: '18px',
        left: '50%',
        transform: 'translateX(-50%)',
        flexDirection: 'row'
      };
    }
    return {
      position: 'absolute',
      bottom: '22px',
      left: '50%',
      transform: 'translateX(-50%)',
      flexDirection: 'row'
    };
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: '#07090e',
        color: '#f0f6fc',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        userSelect: 'none',
        fontFamily: '"Pretendard", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}
    >
      {/* ====================================================================
          1. 굿노트 스타일 상단 문서 타이틀 바 (배경에 산뜻하게 플로팅)
          ==================================================================== */}
      <header
        style={{
          position: 'absolute',
          top: '16px',
          left: '20px',
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          background: 'rgba(15, 18, 24, 0.85)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '9999px',
          padding: '6px 14px',
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.55)',
          pointerEvents: 'auto'
        }}
      >
        <span style={{ fontSize: '16px' }}>👨‍🎓</span>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.3px' }}>
          {noteRecord.student_grade}-{noteRecord.student_class} {noteRecord.student_num}번 {noteRecord.student_name}
        </span>
        <div style={{ width: '1px', height: '14px', background: 'rgba(255, 255, 255, 0.15)' }} />
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            color: '#93c5fd',
            background: 'rgba(59, 130, 246, 0.15)',
            padding: '2px 7px',
            borderRadius: '9999px',
            border: '1px solid rgba(59, 130, 246, 0.25)'
          }}
        >
          {isPortrait ? '세로 A4' : '가로 A4'}
        </span>
        <div style={{ width: '1px', height: '14px', background: 'rgba(255, 255, 255, 0.15)' }} />
        {/* 줌 배율 배지 (클릭 시 100% 리셋) */}
        <button
          type="button"
          onClick={handleResetZoomFit}
          title="화면 맞춤 100% 초기화 (단축키: 0)"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#38bdf8',
            fontSize: '11.5px',
            fontWeight: 700,
            cursor: 'pointer',
            padding: '2px 4px',
            borderRadius: '4px',
            transition: 'opacity 0.15s ease'
          }}
        >
          {zoomPercent}% ↺
        </button>
        {onRefresh && (
          <>
            <div style={{ width: '1px', height: '14px', background: 'rgba(255, 255, 255, 0.15)' }} />
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              title="학생 태블릿에서 최신 필기 즉시 동기화"
              style={{
                background: 'rgba(56, 189, 248, 0.18)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                color: '#38bdf8',
                fontSize: '11px',
                fontWeight: 700,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                padding: '2px 8px',
                borderRadius: '9999px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                opacity: isLoading ? 0.6 : 1,
                transition: 'all 0.15s ease'
              }}
            >
              <span style={{ display: 'inline-block', animation: isLoading ? 'spin 1s linear infinite' : 'none' }}>🔄</span>
              <span>최신 동기화</span>
            </button>
          </>
        )}
      </header>

      {/* ====================================================================
          2. 100% 몰입형 메인 캔버스 뷰어
          ==================================================================== */}
      <main
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#06080d',
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
              background: 'rgba(7, 9, 14, 0.85)',
              zIndex: 40,
              backdropFilter: 'blur(8px)'
            }}
          >
            <span style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>🔄</span>
            <span style={{ marginTop: '12px', fontSize: '13.5px', color: '#93c5fd', fontWeight: 600 }}>
              학생의 최신 필기 데이터를 불러오는 중입니다...
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
            transition: isPanning ? 'none' : 'transform 0.14s cubic-bezier(0.16, 1, 0.3, 1)',
            boxShadow: '0 25px 70px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.1)',
            borderRadius: '6px',
            overflow: 'hidden',
            flexShrink: 0,
            willChange: 'transform'
          }}
        >
          <StudentNoteSheet page={currentPage} orientation={orientation} />
        </div>

        {/* 하단 미니멀 제스처 가이드 (반투명 힌트) */}
        <div
          style={{
            position: 'absolute',
            bottom: toolbarPosition === 'bottom' ? '80px' : '18px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(15, 18, 24, 0.7)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '9999px',
            padding: '4px 14px',
            fontSize: '11px',
            color: '#8b949e',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            pointerEvents: 'none',
            zIndex: 30,
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)'
          }}
        >
          <span>💡 1손가락: 이동</span>
          <span>•</span>
          <span>✌️ 2손가락 핀치: 확대/축소</span>
          <span>•</span>
          <span>[←/→] 쪽이동</span>
          <span>•</span>
          <span>[ESC] 나가기</span>
        </div>
      </main>

      {/* ====================================================================
          3. 🎨 삼성노트/굿노트 1:1 역추적 플로팅 툴바 팔레트 (사용자 스케치 완벽 구현)
          ==================================================================== */}
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          ...getDockPositionStyle(),
          zIndex: 1000,
          background: 'rgba(15, 18, 24, 0.92)',
          backdropFilter: 'blur(24px) saturate(190%)',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          borderRadius: '24px',
          padding: isCollapsed ? '6px' : '8px 6px',
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.75), inset 0 1px 0 rgba(255, 255, 255, 0.12)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        {/* [1] 툴바 숨기기 / 펼치기 토글 버튼 (동심원 ◎) */}
        <TooltipButton
          onClick={() => setIsCollapsed(!isCollapsed)}
          tooltip={isCollapsed ? '툴바 펼치기' : '툴바 접기'}
          shortcut="H"
          dockPosition={toolbarPosition}
          active={isCollapsed}
        >
          <IconCollapse size={21} />
        </TooltipButton>

        {/* 접힌 상태에서는 오직 토글 버튼만 표시되어 화면 가림 0% 달성 */}
        {!isCollapsed && (
          <>
            {/* 구분선 */}
            <div
              style={{
                width: isHorizontalDock ? '1px' : '26px',
                height: isHorizontalDock ? '22px' : '1px',
                background: 'rgba(255, 255, 255, 0.12)'
              }}
            />

            {/* [2] 숨김 메뉴 버튼 (≡) ➔ 클릭 시 툴바 이동(상하좌우) 및 뷰 도구 팝오버 오픈 */}
            <div style={{ position: 'relative' }} ref={menuRef}>
              <TooltipButton
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                tooltip="도구 및 툴바 위치 설정"
                dockPosition={toolbarPosition}
                active={isMenuOpen}
              >
                <IconMenu size={20} />
              </TooltipButton>

              {/* ≡ 클릭 시 열리는 플로팅 메뉴 팝오버 */}
              {isMenuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: toolbarPosition === 'bottom' ? 'auto' : toolbarPosition === 'top' ? 'calc(100% + 12px)' : '0',
                    bottom: toolbarPosition === 'bottom' ? 'calc(100% + 12px)' : 'auto',
                    right: toolbarPosition === 'right' ? 'calc(100% + 12px)' : 'auto',
                    left: toolbarPosition === 'left' ? 'calc(100% + 12px)' : isHorizontalDock ? '50%' : 'auto',
                    transform: isHorizontalDock ? 'translateX(-50%)' : 'none',
                    background: 'rgba(15, 18, 24, 0.96)',
                    backdropFilter: 'blur(24px)',
                    border: '1px solid rgba(255, 255, 255, 0.16)',
                    boxShadow: '0 20px 50px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                    borderRadius: '16px',
                    padding: '12px',
                    width: '210px',
                    zIndex: 1300,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}
                >
                  {/* 메뉴 타이틀 */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#f0f6fc' }}>⚙️ 툴바 및 화면 설정</span>
                    <button
                      type="button"
                      onClick={() => setIsMenuOpen(false)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#8b949e',
                        cursor: 'pointer',
                        padding: '2px 4px',
                        fontSize: '11px'
                      }}
                    >
                      ✕
                    </button>
                  </div>

                  {/* 툴바 위치 선택 (상 / 하 / 좌 / 우) */}
                  <div>
                    <div style={{ fontSize: '10.5px', fontWeight: 600, color: '#8b949e', marginBottom: '6px' }}>
                      툴바 위치 이동 (상하좌우)
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        background: 'rgba(255, 255, 255, 0.06)',
                        padding: '3px',
                        borderRadius: '8px',
                        gap: '2px'
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => handleSetToolbarPosition('top')}
                        style={{
                          background: toolbarPosition === 'top' ? '#388bfd' : 'transparent',
                          color: toolbarPosition === 'top' ? '#ffffff' : '#c9d1d9',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '5px 0',
                          cursor: 'pointer'
                        }}
                      >
                        상
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetToolbarPosition('bottom')}
                        style={{
                          background: toolbarPosition === 'bottom' ? '#388bfd' : 'transparent',
                          color: toolbarPosition === 'bottom' ? '#ffffff' : '#c9d1d9',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '5px 0',
                          cursor: 'pointer'
                        }}
                      >
                        하
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetToolbarPosition('left')}
                        style={{
                          background: toolbarPosition === 'left' ? '#388bfd' : 'transparent',
                          color: toolbarPosition === 'left' ? '#ffffff' : '#c9d1d9',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '5px 0',
                          cursor: 'pointer'
                        }}
                      >
                        좌
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetToolbarPosition('right')}
                        style={{
                          background: toolbarPosition === 'right' ? '#388bfd' : 'transparent',
                          color: toolbarPosition === 'right' ? '#ffffff' : '#c9d1d9',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '5px 0',
                          cursor: 'pointer'
                        }}
                      >
                        우
                      </button>
                    </div>
                  </div>

                  <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.1)' }} />

                  {/* 줌 확대/축소 및 화면 맞춤 도구 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <div style={{ fontSize: '10.5px', fontWeight: 600, color: '#8b949e' }}>화면 배율 조정</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <button
                        type="button"
                        onClick={handleZoomOut}
                        style={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          padding: '6px 8px',
                          background: 'rgba(255, 255, 255, 0.08)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#f0f6fc',
                          borderRadius: '6px',
                          fontSize: '11px',
                          cursor: 'pointer'
                        }}
                      >
                        <IconZoomOut size={14} /> 축소 (-)
                      </button>
                      <button
                        type="button"
                        onClick={handleZoomIn}
                        style={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          padding: '6px 8px',
                          background: 'rgba(255, 255, 255, 0.08)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#f0f6fc',
                          borderRadius: '6px',
                          fontSize: '11px',
                          cursor: 'pointer'
                        }}
                      >
                        <IconZoomIn size={14} /> 확대 (+)
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        handleResetZoomFit();
                        setIsMenuOpen(false);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        padding: '6px 8px',
                        background: 'rgba(56, 189, 248, 0.15)',
                        border: '1px solid rgba(56, 189, 248, 0.3)',
                        color: '#38bdf8',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      <IconFit size={14} /> 100% 화면 맞춤 초기화 (0)
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* [3] 컴팩트 페이지 박스 (2/2 상단 표시 + 아래에 < > 쉐브론 버튼 - 사용자 스케치 1:1 역추적) */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '12px',
                padding: '4px 3px',
                gap: '2px',
                minWidth: '38px'
              }}
            >
              {/* 상단: 쪽 번호 (예: 2/2) */}
              <span
                style={{
                  fontSize: '10.5px',
                  fontWeight: 800,
                  color: '#93c5fd',
                  textAlign: 'center',
                  lineHeight: 1.1,
                  letterSpacing: '-0.3px',
                  userSelect: 'none'
                }}
                title={`현재 쪽: ${currentPageIdx + 1} / 총 ${studentPages.length}쪽`}
              >
                {currentPageIdx + 1}/{studentPages.length}
              </span>

              {/* 하단: < > 좌우 쉐브론 이동 버튼 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <button
                  type="button"
                  disabled={currentPageIdx <= 0}
                  onClick={() => setCurrentPageIdx(p => Math.max(0, p - 1))}
                  style={{
                    width: '18px',
                    height: '18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: 'none',
                    color: currentPageIdx <= 0 ? '#484f58' : '#e2e8f0',
                    cursor: currentPageIdx <= 0 ? 'not-allowed' : 'pointer',
                    padding: 0,
                    borderRadius: '4px'
                  }}
                  title="이전 쪽 [←]"
                >
                  <IconChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  disabled={currentPageIdx >= studentPages.length - 1}
                  onClick={() => setCurrentPageIdx(p => Math.min(studentPages.length - 1, p + 1))}
                  style={{
                    width: '18px',
                    height: '18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: 'none',
                    color: currentPageIdx >= studentPages.length - 1 ? '#484f58' : '#e2e8f0',
                    cursor: currentPageIdx >= studentPages.length - 1 ? 'not-allowed' : 'pointer',
                    padding: 0,
                    borderRadius: '4px'
                  }}
                  title="다음 쪽 [→]"
                >
                  <IconChevronRight size={14} />
                </button>
              </div>
            </div>

            {/* [4] 전체화면 버튼 (□ 뷰파인더) */}
            <TooltipButton
              onClick={toggleBrowserFullscreen}
              tooltip={isBrowserFullscreen ? '전체화면 해제' : '전체화면'}
              shortcut="F11"
              dockPosition={toolbarPosition}
              active={isBrowserFullscreen}
            >
              {isBrowserFullscreen ? <IconFullscreenExit size={19} /> : <IconFullscreen size={19} />}
            </TooltipButton>

            {/* [선택 기능] 참 잘했어요! 피드백 별표 버튼 */}
            {onSendFeedback && (
              <TooltipButton
                onClick={() => onSendFeedback(noteRecord.student_name)}
                tooltip="참 잘했어요! 칭찬 전송"
                shortcut="P"
                dockPosition={toolbarPosition}
                accent
              >
                <IconStar size={18} />
              </TooltipButton>
            )}

            {/* 구분선 */}
            <div
              style={{
                width: isHorizontalDock ? '1px' : '26px',
                height: isHorizontalDock ? '22px' : '1px',
                background: 'rgba(255, 255, 255, 0.12)'
              }}
            />

            {/* [5] 대형 나가기 버튼 (✕) - 사용자 스케치 맨 하단 1:1 역추적 */}
            <TooltipButton
              onClick={onClose}
              tooltip="학생 필기 뷰어 닫기"
              shortcut="ESC"
              dockPosition={toolbarPosition}
              danger
            >
              <IconClose size={19} />
            </TooltipButton>
          </>
        )}
      </aside>
    </div>
  );
};

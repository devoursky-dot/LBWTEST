import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useHorizontalToolbarScroll } from './lib/scrollModule';
import { useAppConfirm } from './lib/fullscreenModule';
import { useFullscreen } from './modules/fullscreen';
import { PwaInstallButton } from './modules/pwa';
import { QrScannerModal, useQrScannerAction } from './modules/qrScanner';
import { supabase, isSupabaseConfigured, type ClassNoteRecord } from './lib/supabase';
import {
  loadPdfDocument,
  renderPdfPageToDataUrl,
  loadImageFile,
  type CropRect
} from './lib/pdfImporter';
import { PdfPagePickerModal } from './components/PdfPagePickerModal';
import { ImageCropModal } from './components/ImageCropModal';
import { ModularModal } from './components/ModularModal';
import { EmbeddedImageLayer, type EmbeddedImageItem } from './components/EmbeddedImageLayer';
import { DrawingCanvas } from './components/DrawingCanvas';
import { PageOverviewModal } from './components/PageOverviewModal';
import { ToolbarPageNavigator } from './components/ToolbarPageNavigator';
import {
  OfflineStatusBadge,
  initOfflineSync,
  enqueuePendingSubmission,
  saveOfflineNotebookDraft
} from './modules/offline';
import {
  defaultLassoFocusConfig,
  LassoFocusCanvasOverlay,
  createFocusedPageBackground,
  type Point,
  type PolygonBounds
} from './modules/lassoFocus';
import { type Stroke, type StrokePoint } from './lib/drawingGeometry';
import { exportStudentNotebookToPdf } from './lib/studentPdfExporter';
import { exportNotebookToFile, importNotebookFromFile } from './lib/studentNotebookFileManager';
import { classroomRealtime } from './lib/classroomRealtime';
import { getApiBaseUrl } from './lib/apiConfig';
import { compressNotePagesForTransmission } from './lib/imageCompressor';
import {
  parseStudentId,
  verifyStudentLogin,
  changeStudentPassword,
  saveStoredStudentName,
  getStoredStudentName,
  fetchStudentNameFromCloud,
  getCurrentSession,
  setCurrentSession
} from './lib/auth';
import {
  type StudentInfo,
  getSavedStudentInfo,
  saveSavedStudentInfo,
  studentInfoToId,
  loadStudentDraft,
  saveStudentDraft,
  clearStudentDraft,
  getStudentBackupKey,
  parseLessonParam
} from './lib/studentSessionManager';

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
  fullPageBackground?: string | null;
  images?: EmbeddedImageItem[];
}

interface StudentLessonViewProps {
  lessonId: string;
  lessonTitle: string;
  initialPdfId?: string;
  initialPdfName?: string;
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

/** 툴바 숨기기 / 펼치기 토글 (동심원 ◎) */
const IconCollapse: React.FC<{ size?: number; isCollapsed?: boolean }> = ({ size = 20, isCollapsed = false }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r={isCollapsed ? 3 : 5} fill="currentColor" fillOpacity={isCollapsed ? 0.8 : 0.35} />
  </svg>
);

/** 숨김 메뉴 (≡) */
const IconMenu: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </svg>
);

/** 펜 벡터 아이콘 */
const IconPen: React.FC<{ size?: number; color?: string }> = ({ size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </svg>
);

/** 형광펜 벡터 아이콘 */
const IconHighlighter: React.FC<{ size?: number; color?: string }> = ({ size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 11-6 6v3h3l6-6" />
    <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
  </svg>
);

/** PDF / 이미지 삽입 벡터 아이콘 */
const IconImageDoc: React.FC<{ size?: number; color?: string }> = ({ size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </svg>
);

/** 취소 (실행 취소 ↩️) 벡터 아이콘 */
const IconUndo: React.FC<{ size?: number; color?: string }> = ({ size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7v6h6" />
    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
  </svg>
);

/** 되돌리기 (다시 실행 ↪️) 벡터 아이콘 */
const IconRedo: React.FC<{ size?: number; color?: string }> = ({ size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 7v6h-6" />
    <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
  </svg>
);

/** 폭 맞춤 벡터 아이콘 */
const IconFitWidth: React.FC<{ size?: number; color?: string }> = ({ size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12h16" />
    <path d="M7 9l-3 3 3 3" />
    <path d="M17 9l3 3-3 3" />
    <line x1="2" y1="4" x2="2" y2="20" strokeWidth="2" />
    <line x1="22" y1="4" x2="22" y2="20" strokeWidth="2" />
  </svg>
);

// 브라우저 새로고침(F5, 모바일 사파리 당겨서 리로드, 백그라운드 탭 리로드 등) 여부 정밀 감지 헬퍼
const isPageReload = (): boolean => {
  try {
    const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (navEntries && navEntries.length > 0) {
      return navEntries[0].type === 'reload';
    }
    // eslint-disable-next-line deprecation/deprecation
    return (performance as any)?.navigation?.type === 1;
  } catch {
    return false;
  }
};

export const StudentLessonView: React.FC<StudentLessonViewProps> = ({
  lessonId,
  lessonTitle,
  initialPdfId,
  initialPdfName,
  onExit
}) => {
  // --- 1. 학생 계정 로그인 상태 (영구 기억) ---
  const [studentInfo, setStudentInfo] = useState<StudentInfo | null>(() => getSavedStudentInfo());

  // 학생 학번/비밀번호 인증 모달 상태 (학생 정보가 없으면 수업 진입 시 바로 로그인 모달 오픈)
  const [isChangingStudent, setIsChangingStudent] = useState(() => !getSavedStudentInfo());
  const [isConfirmStudentOpen, setIsConfirmStudentOpen] = useState(() => Boolean(getSavedStudentInfo()));

  const [authStudentId, setAuthStudentId] = useState('');
  const [authStudentName, setAuthStudentName] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authNewPassword, setAuthNewPassword] = useState('');
  const [authConfirmPassword, setAuthConfirmPassword] = useState('');
  const [isChangingPwMode, setIsChangingPwMode] = useState(false);
  const [authErrorMsg, setAuthErrorMsg] = useState<string | null>(null);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);

  // 로그인 상태에서 학생 이름 수정 입력 상태
  const [editStudentNameInput, setEditStudentNameInput] = useState(() => {
    try {
      const saved = localStorage.getItem('lbw_student_info');
      return saved ? JSON.parse(saved).name : '';
    } catch {
      return '';
    }
  });

  // studentInfo가 변경되거나 로드되면 이름 수정 인풋 동기화
  useEffect(() => {
    if (studentInfo?.name) {
      setEditStudentNameInput(studentInfo.name);
    }
  }, [studentInfo]);

  // 학번 입력 시 기존에 등록된 학생 이름 자동 완성 (1회 입력 후 영구 기억)
  useEffect(() => {
    const parsed = parseStudentId(authStudentId);
    if (parsed.valid) {
      const localName = getStoredStudentName(authStudentId.trim());
      if (localName) {
        setAuthStudentName(localName);
      } else {
        fetchStudentNameFromCloud(authStudentId.trim()).then(name => {
          if (name) setAuthStudentName(name);
        });
      }
    }
  }, [authStudentId]);

  // --- 2. 삼성노트 REA 뷰포트 & A4 용지 규격 상태 ---
  // 기본 표준: A4 세로 (Portrait)
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('portrait');
  const [zoomScale, setZoomScale] = useState<number>(1.0);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const popupTop = '58px';
  const [toolbarLayoutPref, setToolbarLayoutPref] = useState<'auto' | 'single' | 'double'>('auto');

  // 툴바 숨기기/펼치기 토글 상태 (사용자 스케치 ○)
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false);

  // 툴바 화면 폭 초과 시 가로 스크롤 & 마우스 휠 & 좌우 힌트 모듈
  const {
    containerRef: toolbarScrollRef,
    canScrollLeft: canToolbarScrollLeft,
    canScrollRight: canToolbarScrollRight,
    scrollToLeft: scrollToolbarToLeft,
    scrollToRight: scrollToolbarToRight
  } = useHorizontalToolbarScroll();

  // --- 3. 멀티페이지 공책 상태 ---
  const [pages, setPages] = useState<LessonPage[]>([
    { id: 'page_1', strokes: [], textItems: [] }
  ]);
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);
  const [isPageOverviewOpen, setIsPageOverviewOpen] = useState<boolean>(false);

  // 현재 활성 페이지의 데이터 & Undo/Redo 스택 (획 추가 및 획 삭제 모두 지원)
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [undoStack, setUndoStack] = useState<Stroke[][]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[][]>([]);
  const [textItems, setTextItems] = useState<TextItem[]>([]);
  const [activeTextId, setActiveTextId] = useState<string | null>(null);

  // --- 4. 용지 테마 및 필기 도구 상태 ---
  // 교실 통일성을 위해 항상 검정색 칠판 다크 모드(#131314)로 고정
  const paperTheme = 'dark';

  const [tool, setTool] = useState<'pen' | 'highlighter' | 'eraser' | 'text' | 'image' | 'lasso'>('pen');
  const [penColor, setPenColor] = useState<string>('#ffffff'); // 기본값: 칠판에 가장 선명한 흰색 분필
  const [penSize, setPenSize] = useState<number>(3);
  const [highlighterColor, setHighlighterColor] = useState<string>('#fde047');
  const [highlighterSize, setHighlighterSize] = useState<number>(18);
  const [eraserSize, setEraserSize] = useState<number>(24);
  const [eraserMode, setEraserMode] = useState<'stroke' | 'pixel'>('stroke'); // 기본값: 획 지우개
  const [penOnlyMode, setPenOnlyMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('lbw_pen_mode');
      return saved === 'true';
    } catch {
      return false;
    }
  }); // false: 터치 모드, true: 펜 모드 (팜리젝션 & 1손가락 이동)
  const [activePopup, setActivePopup] = useState<'pen' | 'highlighter' | 'eraser' | 'settings' | 'image' | 'menu' | null>(null);

  // --- 4-1. 페이지별 전체 배경 & 임베드 이미지(스티커) 상태 ---
  const [fullPageBackground, setFullPageBackground] = useState<string | null>(null);
  const [embeddedImages, setEmbeddedImages] = useState<EmbeddedImageItem[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);

  // --- 4-2. PDF 및 이미지 크롭 모달 상태 ---
  const [pdfPickerOpen, setPdfPickerOpen] = useState(false);
  const [pdfFileName, setPdfFileName] = useState('');
  const [pdfDocProxy, setPdfDocProxy] = useState<any>(null);
  const [pdfThumbnails, setPdfThumbnails] = useState<Array<{ pageNumber: number; dataUrl: string; width: number; height: number }>>([]);
  const [pdfTotalPages, setPdfTotalPages] = useState<number>(0);
  const [isPdfLoading, setIsPdfLoading] = useState(false);

  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropTargetImageSrc, setCropTargetImageSrc] = useState<string>('');
  const [editingImageItem, setEditingImageItem] = useState<EmbeddedImageItem | null>(null);

  const imagePdfInputRef = useRef<HTMLInputElement>(null);
  const notebookFileInputRef = useRef<HTMLInputElement>(null);
  const currentPdfFileRef = useRef<File | null>(null);

  // 선생님이 공유한 수업 학습지 PDF 정보
  const [lessonPdfInfo, setLessonPdfInfo] = useState<{ id: string; name: string } | null>(() => {
    if (initialPdfId) {
      return { id: initialPdfId, name: initialPdfName || '수업_학습지.pdf' };
    }
    if (typeof window !== 'undefined') {
      const parsed = parseLessonParam(window.location.search);
      if (parsed?.pdfId) {
        return { id: parsed.pdfId, name: parsed.pdfName || '수업_학습지.pdf' };
      }
    }
    return null;
  });

  useEffect(() => {
    if (initialPdfId) {
      setLessonPdfInfo({ id: initialPdfId, name: initialPdfName || '수업_학습지.pdf' });
    } else if (!lessonPdfInfo && lessonId) {
      // URL이나 props에 pdfId가 누락되었더라도, 수업 폴더(lessonId)에서 직접 PDF 자동 탐색하여 100% 연동
      (async () => {
        try {
          const directUrl = `https://www.googleapis.com/drive/v3/files?q='${lessonId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType)&key=AIzaSyAmEvx5j8IFigp22Ujp1Cm8lF4wpi0xlFw&_t=${Date.now()}`;
          const res = await fetch(directUrl);
          if (res.ok) {
            const data = await res.json();
            const files = data.files || [];
            const pdfFile = files.find((f: any) => f.mimeType === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
            if (pdfFile) {
              setLessonPdfInfo({ id: pdfFile.id, name: pdfFile.name });
            }
          }
        } catch {}
      })();
    }
  }, [initialPdfId, initialPdfName, lessonId, lessonPdfInfo]);
  const [isLessonPdfPromptOpen, setIsLessonPdfPromptOpen] = useState<boolean>(false);
  const [isDownloadingLessonPdf, setIsDownloadingLessonPdf] = useState<boolean>(false);

  // 📺 표준 모듈화된 전체화면 관리 (강제 복구 편법 인터셉터 제거)
  const {
    isFullscreen,
    toggleFullscreen,
    enterFullscreen: requestFullscreenSafe,
    exitFullscreen: exitFullscreenSafe
  } = useFullscreen();
  const dismissReentryPrompt = useCallback(() => {}, []);

  // 📷 카메라 QR코드 스캐너 모달 상태 및 처리 액션
  const [isQrScannerOpen, setIsQrScannerOpen] = useState<boolean>(false);
  const { handleScannedResult } = useQrScannerAction({
    onEnterLesson: (scannedLessonId, scannedTitle) => {
      setIsQrScannerOpen(false);
      showToast(`🚀 '${scannedTitle || '새 수업'}'에 입장합니다...`);
      const targetUrl = new URL(window.location.href);
      targetUrl.searchParams.set('lessonId', scannedLessonId);
      if (scannedTitle) targetUrl.searchParams.set('title', scannedTitle);
      window.location.href = targetUrl.toString();
    }
  });

  // 💬 전체화면을 파괴하는 window.confirm을 100% 대체하는 인앱 다이얼로그 시스템
  const { confirm, confirmModalElement } = useAppConfirm();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [hasSavedNote, setHasSavedNote] = useState(false);
  const [lastSavedTimeStr, setLastSavedTimeStr] = useState<string>('');
  const [recoveryPromptDraft, setRecoveryPromptDraft] = useState<any | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const isInitialMountRef = useRef<boolean>(true);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 학생 제출 고유 ID (1인 1행 유지하여 중복 생성 및 타임아웃 방지)
  const submissionIdRef = useRef<string | null>(null);
  // 제출 연타 방지 및 쿨다운 관리 (4초 이내 중복 제출 원천 차단)
  const lastSubmitTimeRef = useRef<number>(0);

  // --- 전자칠판 실시간 연결 및 화면 꺼짐 방지(WakeLock) 상태 ---
  const [isConnectedToBoard, setIsConnectedToBoard] = useState<boolean>(false);
  const wakeLockRef = useRef<any>(null);


  // DOM 참조
  const containerRef = useRef<HTMLDivElement>(null);
  const paperSheetRef = useRef<HTMLDivElement>(null);

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

  // 펜 <-> 지우개 원터치 토글 (펜 모드 시 손가락 화면 더블탭 톡톡 및 키보드 단축키 E/P)
  const handleTogglePenEraser = useCallback(() => {
    setTool(prev => {
      const next = prev === 'eraser' ? 'pen' : 'eraser';
      if (next === 'eraser') {
        showToast('🧹 지우개 모드로 전환되었습니다. (화면 손가락 톡톡)');
      } else {
        showToast('✏️ 펜 모드로 전환되었습니다. (화면 손가락 톡톡)');
      }
      return next;
    });
    setActivePopup(null);
  }, []);

  // 키보드 단축키 지원 (E: 지우개, P: 펜, H: 형광펜)
  useEffect(() => {
    const handleKeyNav = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      if (e.key === 'e' || e.key === 'E') {
        setTool('eraser');
        showToast('🧹 지우개 모드');
      } else if (e.key === 'p' || e.key === 'P') {
        setTool('pen');
        showToast('✏️ 펜 모드');
      } else if (e.key === 'h' || e.key === 'H') {
        setTool('highlighter');
        showToast('🖍️ 형광펜 모드');
      }
    };
    window.addEventListener('keydown', handleKeyNav);
    return () => window.removeEventListener('keydown', handleKeyNav);
  }, []);

  // 손가락 터치 vs 펜 전용 모드 토글
  const handleTogglePenTouchMode = () => {
    setPenOnlyMode(prev => {
      const next = !prev;
      try { localStorage.setItem('lbw_pen_mode', String(next)); } catch {}
      showToast(next ? '✏️ 펜 전용 모드 (애플펜슬 필기, 손가락 화면 이동)' : '🖐️ 터치 모드 (손가락 및 펜 모두 필기 가능)');
      return next;
    });
  };

  // 학생 로그인 및 학번 인증 핸들러
  const handleStudentAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthErrorMsg(null);

    const parsed = parseStudentId(authStudentId);
    if (!parsed.valid) {
      setAuthErrorMsg('⚠️ 올바른 4자리 학번(예: 1101 ~ 3830)을 입력하세요.');
      return;
    }

    if (!authPassword.trim()) {
      setAuthErrorMsg('⚠️ 비밀번호를 입력해 주세요. (초기 비밀번호: 1234)');
      return;
    }

    setIsAuthSubmitting(true);
    try {
      const verifyRes = await verifyStudentLogin(authStudentId.trim(), authPassword.trim());
      if (!verifyRes.success) {
        setAuthErrorMsg(verifyRes.message || '❌ 비밀번호가 일치하지 않습니다. 비밀번호를 잊어버린 경우 관리자 선생님께 1234 초기화를 요청하세요.');
        return;
      }

      const cleanName = authStudentName.trim() || `${parsed.grade}-${parsed.classNum} ${parsed.studentNum}번`;

      // 비밀번호 변경 요청이 활성화된 경우
      if (isChangingPwMode) {
        if (!authNewPassword.trim() || authNewPassword.trim().length < 4) {
          setAuthErrorMsg('⚠️ 새 비밀번호는 최소 4자리 이상이어야 합니다.');
          return;
        }
        if (authNewPassword.trim() !== authConfirmPassword.trim()) {
          setAuthErrorMsg('⚠️ 새 비밀번호와 비밀번호 확인이 일치하지 않습니다.');
          return;
        }
        const changeRes = await changeStudentPassword(authStudentId.trim(), authNewPassword.trim(), cleanName);
        if (!changeRes.success) {
          setAuthErrorMsg(changeRes.message || '비밀번호 변경 실패');
          return;
        }
        showToast('🎉 비밀번호가 안전하게 변경되었습니다!');
      }

      const info: StudentInfo = {
        grade: parsed.grade,
        classNum: parsed.classNum,
        studentNum: parsed.studentNum,
        name: cleanName
      };

      // 학생 이름 로컬 및 클라우드 영구 저장 (1회 입력 후 계속 유지)
      saveStoredStudentName(authStudentId.trim(), cleanName);
      setEditStudentNameInput(cleanName);

      setStudentInfo(info);
      saveSavedStudentInfo(info);
      setIsChangingStudent(false);
      requestFullscreenSafe();
      setAuthPassword('');
      setAuthNewPassword('');
      setAuthConfirmPassword('');

      // 공용 태블릿 완벽 대응: 변경/로그인된 학생의 독립 공책 드래프트 로드
      const newStudentId = studentInfoToId(info);
      const existingDraft = loadStudentDraft(lessonId, newStudentId);
      if (existingDraft?.draft?.pages?.length) {
        applyLoadedPages(existingDraft.draft.pages, existingDraft.draft.currentPageIndex ?? 0, existingDraft.draft.orientation);
        showToast(`👨‍🎓 ${info.name} 학생의 이전 필기 내용을 불러왔습니다.`);
      } else {
        // 이 학생의 이전 필기가 없으면 깨끗한 1쪽으로 시작 (배경 학습지는 보존)
        setStrokes([]);
        setTextItems([]);
        setEmbeddedImages([]);
        setUndoStack([]);
        setRedoStack([]);
        setPages(prev => [{
          id: 'page_1',
          strokes: [],
          textItems: [],
          fullPageBackground: prev[0]?.fullPageBackground || null,
          images: []
        }]);
        setCurrentPageIndex(0);
        showToast(`👨‍🎓 ${info.grade}학년 ${info.classNum}반 ${info.name} 학생으로 로그인되었습니다.`);
      }
    } catch {
      setAuthErrorMsg('인증 처리 중 네트워크 오류가 발생했습니다.');
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  // 로그인 상태에서 학생 이름만 단독 수정하는 핸들러
  const handleStudentUpdateNameOnly = (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentInfo) return;
    const cleanNewName = editStudentNameInput.trim();
    if (!cleanNewName) {
      setAuthErrorMsg('⚠️ 수정할 학생 이름을 입력해 주세요.');
      return;
    }

    const studentIdStr = studentInfoToId(studentInfo);
    const updatedInfo: StudentInfo = {
      ...studentInfo,
      name: cleanNewName
    };

    setStudentInfo(updatedInfo);
    saveSavedStudentInfo(updatedInfo);
    saveStoredStudentName(studentIdStr, cleanNewName);

    // 포털 세션 이름도 동기화
    const sess = getCurrentSession();
    if (sess && sess.role === 'student') {
      setCurrentSession({ ...sess, name: cleanNewName });
    }

    setAuthErrorMsg(null);
    showToast(`✅ 학생 이름이 '${cleanNewName}'(으)로 수정되었습니다.`);
  };

  // 로그인 상태에서 비밀번호만 단독 변경하는 핸들러
  const handleStudentChangePasswordOnly = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentInfo) return;
    setAuthErrorMsg(null);

    const studentIdStr = studentInfoToId(studentInfo);

    if (!authPassword.trim()) {
      setAuthErrorMsg('⚠️ 현재 비밀번호를 입력해 주세요. (기본: 1234)');
      return;
    }
    if (!authNewPassword.trim() || authNewPassword.trim().length < 4) {
      setAuthErrorMsg('⚠️ 새 비밀번호는 최소 4자리 이상이어야 합니다.');
      return;
    }
    if (authNewPassword.trim() !== authConfirmPassword.trim()) {
      setAuthErrorMsg('⚠️ 새 비밀번호와 비밀번호 확인이 일치하지 않습니다.');
      return;
    }

    setIsAuthSubmitting(true);
    try {
      const verifyRes = await verifyStudentLogin(studentIdStr, authPassword.trim());
      if (!verifyRes.success) {
        setAuthErrorMsg('❌ 현재 비밀번호가 일치하지 않습니다. 비밀번호를 잊어버린 경우 관리자 선생님께 1234 초기화를 요청하세요.');
        return;
      }

      const changeRes = await changeStudentPassword(studentIdStr, authNewPassword.trim(), studentInfo.name);
      if (!changeRes.success) {
        setAuthErrorMsg(changeRes.message || '비밀번호 변경 실패');
        return;
      }

      setAuthPassword('');
      setAuthNewPassword('');
      setAuthConfirmPassword('');
      setIsChangingStudent(false);
      showToast('🎉 비밀번호가 안전하게 변경되었습니다!');
    } catch {
      setAuthErrorMsg('비밀번호 변경 중 오류가 발생했습니다.');
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  // [공책 처음부터 새로 쓰기 (자율 백지 리셋)]
  const handleResetNotebookClean = useCallback(async () => {
    const ok = await confirm({
      title: '학습지 새로 시작',
      message: '현재 작성 중인 필기를 모두 지우고 깨끗한 학습지 상태로 새로 시작하시겠습니까?\n(선생님의 학습지 배경은 그대로 유지되며, 내가 쓴 필기만 초기화됩니다.)',
      confirmText: '새로 시작',
      isDanger: true
    });
    if (ok) {
      // 획, 텍스트, 이미지 및 undo/redo 스택 초기화
      setStrokes([]);
      setTextItems([]);
      setEmbeddedImages([]);
      setUndoStack([]);
      setRedoStack([]);

      // 페이지 구성 리셋 (배경은 1쪽 유지)
      setPages(prev => [{
        id: 'page_1',
        strokes: [],
        textItems: [],
        fullPageBackground: prev[0]?.fullPageBackground || null,
        images: []
      }]);
      setCurrentPageIndex(0);

      // 드래프트 삭제
      const curStudentId = studentInfo ? studentInfoToId(studentInfo) : null;
      clearStudentDraft(lessonId, curStudentId);
      setRecoveryPromptDraft(null);
      setHasSavedNote(false);
      setLastSavedTimeStr('');

      showToast('✨ 내 공책을 깨끗한 백지 상태로 새로 시작합니다.');
    }
  }, [lessonId, studentInfo]);





  // ==========================================================================
  // [A4 용지 규격 캔버스 초기화]
  // - A4 표준 비율: 1 : √2 ≈ 1 : 1.4142 (세로 210mm x 297mm)
  // - 인쇄 및 모바일/스마트보드 기준: 세로(Portrait) 기본
  // ==========================================================================
  const paperBaseWidth = orientation === 'landscape' ? 1133 : 800;
  const paperBaseHeight = orientation === 'landscape' ? 800 : 1133;

  const A4_WIDTH = orientation === 'landscape' ? 1600 : 1130;
  const A4_HEIGHT = orientation === 'landscape' ? 1130 : 1600;

  // --- 최우선 독립 필기 엔진 콜백 핸들러 ---
  const handleUndoSnapshot = useCallback(() => {
    setUndoStack(prev => [...prev.slice(-30), strokes]);
    setRedoStack([]);
  }, [strokes]);

  const handleStrokeComplete = useCallback((newStroke: Stroke) => {
    setStrokes(prev => [...prev, newStroke]);
  }, []);

  const handleStrokesChange = useCallback((newStrokes: Stroke[]) => {
    setStrokes(newStrokes);
  }, []);



  // ==========================================================================
  // [멀티페이지 전환 & 보존 관리]
  // ==========================================================================

  // 페이지 이동 핸들러 (동기식 페이지 갱신으로 스트로크/배경 유실 방지)
  const handleGoToPage = (targetIdx: number) => {
    if (targetIdx < 0 || targetIdx >= pages.length) return;
    
    const updated = [...pages];
    if (updated[currentPageIndex]) {
      updated[currentPageIndex] = {
        ...updated[currentPageIndex],
        strokes,
        textItems,
        fullPageBackground,
        images: embeddedImages
      };
    }
    setPages(updated);

    const targetPage = updated[targetIdx];
    setCurrentPageIndex(targetIdx);
    setStrokes(targetPage?.strokes || []);
    setTextItems(targetPage?.textItems || []);
    setFullPageBackground(targetPage?.fullPageBackground || null);
    setEmbeddedImages(targetPage?.images || []);
    setSelectedImageId(null);
    setUndoStack([]);
    setRedoStack([]);
    setActiveTextId(null);
  };

  // 페이지 추가 핸들러
  const handleAddPage = () => {
    const newPage: LessonPage = {
      id: `page_${Date.now()}`,
      strokes: [],
      textItems: [],
      fullPageBackground: null,
      images: []
    };

    const nextIndex = pages.length;
    const updated = [...pages];
    if (updated[currentPageIndex]) {
      updated[currentPageIndex] = {
        ...updated[currentPageIndex],
        strokes,
        textItems,
        fullPageBackground,
        images: embeddedImages
      };
    }
    setPages([...updated, newPage]);
    setCurrentPageIndex(nextIndex);
    setStrokes([]);
    setTextItems([]);
    setFullPageBackground(null);
    setEmbeddedImages([]);
    setSelectedImageId(null);
    setUndoStack([]);
    setRedoStack([]);
    setActiveTextId(null);
    showToast(`📄 ${nextIndex + 1}페이지가 추가되었습니다.`);
  };

  // 페이지 삭제 핸들러 (PageOverviewModal 및 단축 제어용)
  const handleDeletePage = async (targetIdx: number) => {
    if (pages.length <= 1) {
      showToast('⚠️ 최소 1개 페이지는 유지되어야 합니다.');
      return;
    }
    const ok = await confirm({
      title: '페이지 삭제 확인',
      message: `${targetIdx + 1}쪽을 공책에서 완전히 삭제하시겠습니까? (삭제된 쪽의 필기는 복구할 수 없습니다)`,
      confirmText: '삭제하기',
      isDanger: true
    });
    if (!ok) return;

    // 현재 활성 페이지 데이터 먼저 동기화
    const updated = pages.map((p, idx) => {
      if (idx === currentPageIndex) {
        return {
          ...p,
          strokes,
          textItems,
          fullPageBackground,
          images: embeddedImages
        };
      }
      return p;
    });

    const filtered = updated.filter((_, idx) => idx !== targetIdx);
    let nextIdx = currentPageIndex;
    if (currentPageIndex === targetIdx) {
      nextIdx = Math.max(0, targetIdx - 1);
    } else if (currentPageIndex > targetIdx) {
      nextIdx = currentPageIndex - 1;
    }

    setPages(filtered);
    setCurrentPageIndex(nextIdx);
    const targetPage = filtered[nextIdx];
    setStrokes(targetPage?.strokes || []);
    setTextItems(targetPage?.textItems || []);
    setFullPageBackground(targetPage?.fullPageBackground || null);
    setEmbeddedImages(targetPage?.images || []);
    setSelectedImageId(null);
    setUndoStack([]);
    setRedoStack([]);
    setActiveTextId(null);
    showToast(`🗑️ ${targetIdx + 1}쪽이 삭제되었습니다.`);
  };

  // ==========================================================================
  // [PDF 및 이미지 학습지 임포트 / 자르기 / 크기 조절 핸들러]
  // ==========================================================================

  // 파일 선택 처리 (PDF 또는 일반 이미지)
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    requestFullscreenSafe();
    const file = e.target.files?.[0];
    if (!file) return;

    // input 값 리셋하여 동일 파일 재선택 가능하게 처리
    e.target.value = '';

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      dismissReentryPrompt();
      currentPdfFileRef.current = file;
      setPdfFileName(file.name);
      setIsPdfLoading(true);
      setPdfPickerOpen(true);
      setPdfThumbnails([]);
      try {
        const pdfDoc = await loadPdfDocument(file);
        setPdfDocProxy(pdfDoc);
        const totalP = pdfDoc.numPages || 1;
        setPdfTotalPages(totalP);
        setIsPdfLoading(false);

        // 썸네일 자동 생성 루프를 제거하여 화면 번쩍임 및 과부하 100% 방지
        // 사용자가 터치한 페이지만 온디맨드로 선명하게 렌더링합니다.
      } catch (err: any) {
        console.error('PDF 로드 실패:', err);
        showToast(`❌ PDF 로드 실패: ${err.message || '파일을 열 수 없습니다.'}`);
        setPdfPickerOpen(false);
      } finally {
        setIsPdfLoading(false);
      }
    } else {
      // 일반 이미지 파일
      try {
        dismissReentryPrompt();
        const { dataUrl } = await loadImageFile(file);
        setEditingImageItem(null);
        setCropTargetImageSrc(dataUrl);
        setCropModalOpen(true);
      } catch (err: any) {
        console.error('이미지 로드 실패:', err);
        showToast(`❌ 이미지 로드 실패: ${err.message || '이미지를 불러올 수 없습니다.'}`);
      }
    }
  };

  // PDF 선택 페이지들을 공책 맨 앞쪽에 일괄 배경 페이지로 생성 (기존 필기 100% 보존)
  const handleBatchInsertPdfPages = async (pageNumbers: number[]) => {
    if (!pdfDocProxy || pageNumbers.length === 0) return;
    try {
      showToast(`⏳ PDF ${pageNumbers.length}개 쪽을 공책 맨 앞쪽에 생성하고 있습니다...`);

      // 1. 현재 작성 중인 페이지 상태를 메모리에 동기화
      const currentSavedPages = pages.map((p, idx) => {
        if (idx === currentPageIndex) {
          return {
            ...p,
            strokes,
            textItems,
            fullPageBackground,
            images: embeddedImages
          };
        }
        return p;
      });

      // 기존 공책이 완전히 비어있는 1페이지만 있는지 검사
      const isInitialPristine = currentSavedPages.length === 1 &&
        currentSavedPages[0].strokes.length === 0 &&
        currentSavedPages[0].textItems.length === 0 &&
        !currentSavedPages[0].fullPageBackground &&
        (!currentSavedPages[0].images || currentSavedPages[0].images.length === 0);

      // 2. 선택된 페이지들을 고해상도로 렌더링하여 새 페이지 객체 생성
      const newPagesList: LessonPage[] = [];
      let detectedLandscape = false;

      for (let i = 0; i < pageNumbers.length; i++) {
        const pNum = pageNumbers[i];
        if (pageNumbers.length > 3) {
          showToast(`⏳ PDF 페이지 생성 중 (${i + 1}/${pageNumbers.length}쪽)...`);
          // 브라우저 렌더링 루프 양보 (저사양 태블릿 OOM 방지 및 가비지 컬렉션 유도)
          await new Promise(r => setTimeout(r, 25));
        }
        const { dataUrl, width, height } = await renderPdfPageToDataUrl(pdfDocProxy, pNum, 2400);
        if (width > height) {
          detectedLandscape = true;
        }
        newPagesList.push({
          id: `page_pdf_${Date.now()}_${pNum}_${Math.random().toString(36).substring(2, 7)}`,
          strokes: [],
          textItems: [],
          fullPageBackground: dataUrl,
          images: []
        });
      }

      if (detectedLandscape && orientation !== 'landscape') {
        setOrientation('landscape');
        showToast('📐 가로 학습지에 맞춰 용지가 가로 방향으로 최적화되었습니다.');
      }

      // 3. 맨 앞쪽에 배치 (기존 필기 페이지는 새 PDF 페이지들 뒤에 그대로 보존)
      const finalPages = isInitialPristine ? newPagesList : [...newPagesList, ...currentSavedPages];

      setPages(finalPages);
      setCurrentPageIndex(0);
      setStrokes(finalPages[0].strokes || []);
      setTextItems(finalPages[0].textItems || []);
      setFullPageBackground(finalPages[0].fullPageBackground || null);
      setEmbeddedImages(finalPages[0].images || []);
      setSelectedImageId(null);
      setUndoStack([]);
      setRedoStack([]);
      setActiveTextId(null);
      setPdfPickerOpen(false);
      requestFullscreenSafe();

      showToast(`🎉 PDF ${pageNumbers.length}개 쪽이 공책 맨 앞쪽에 성공적으로 생성되었습니다!`);
    } catch (err: any) {
      console.error('PDF 일괄 페이지 생성 실패:', err);
      showToast(`❌ 페이지 일괄 생성 실패: ${err.message || '오류'}`);
    }
  };

  // 구글 드라이브 분산 다운로드 및 학습지 로드 핸들러
  const handleLoadLessonPdfFromDrive = async (mode: 'direct_download' | 'batch_insert' | 'open_picker') => {
    if (!lessonPdfInfo) return;

    // 1) 기기에 원본 PDF 직접 다운로드 (구글 드라이브 분산 다운로드 링크)
    if (mode === 'direct_download') {
      const downloadLink = `https://drive.google.com/uc?export=download&id=${lessonPdfInfo.id}`;
      const a = document.createElement('a');
      a.href = downloadLink;
      a.download = lessonPdfInfo.name;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast(`📥 '${lessonPdfInfo.name}' 다운로드를 시작합니다.`);
      setIsLessonPdfPromptOpen(false);
      return;
    }

    // 2) 브라우저 메모리에 로드하여 일괄 생성 또는 피커 모달 열기
    try {
      setIsDownloadingLessonPdf(true);
      showToast(`⏳ 구글 드라이브에서 '${lessonPdfInfo.name}'를 불러오고 있습니다...`);

      let buffer: ArrayBuffer | null = null;
      const proxyUrl = `https://lbwtest.vercel.app/api/drive?action=download&fileId=${lessonPdfInfo.id}&fileName=${encodeURIComponent(lessonPdfInfo.name)}`;
      try {
        const res = await fetch(proxyUrl);
        if (res.ok) {
          buffer = await res.arrayBuffer();
        }
      } catch (e) {
        console.warn('Vercel Edge Proxy fetch failed, trying direct Google Drive API:', e);
      }

      if (!buffer) {
        const directApiUrl = `https://www.googleapis.com/drive/v3/files/${lessonPdfInfo.id}?alt=media&key=AIzaSyAmEvx5j8IFigp22Ujp1Cm8lF4wpi0xlFw`;
        const res2 = await fetch(directApiUrl);
        if (res2.ok) {
          buffer = await res2.arrayBuffer();
        } else {
          throw new Error('구글 드라이브에서 학습지 파일을 다운로드하지 못했습니다.');
        }
      }

      const pdfDoc = await loadPdfDocument(buffer);
      setPdfDocProxy(pdfDoc);
      setPdfFileName(lessonPdfInfo.name);
      const totalP = pdfDoc.numPages || 1;
      setPdfTotalPages(totalP);
      setIsLessonPdfPromptOpen(false);

      if (mode === 'batch_insert') {
        if (totalP > 10) {
          // 10쪽 초과 대용량 PDF인 경우: 태블릿 OOM 메모리 충돌 방지 안내 후 피커 열기
          showToast(`⚠️ 총 ${totalP}쪽 대용량 자료입니다. 필요한 페이지만 범위(예: 1~5쪽)로 선택해주세요.`);
          setPdfPickerOpen(true);
        } else {
          const allPages = Array.from({ length: totalP }, (_, i) => i + 1);
          await handleBatchInsertPdfPages(allPages);
        }
      } else {
        setPdfPickerOpen(true);
      }
    } catch (err: any) {
      console.error('수업 PDF 로드 오류:', err);
      showToast(`❌ 학습지 로드 실패: ${err.message || '오류가 발생했습니다.'}`);
    } finally {
      setIsDownloadingLessonPdf(false);
    }
  };

  // PDF 특정 페이지 선택 처리 (전체 배경 또는 특정 영역 자르기)
  const handleSelectPdfPage = async (pageNumber: number, mode: 'full_page' | 'crop', preloadedDataUrl?: string) => {
    if (!pdfDocProxy) return;

    try {
      let dataUrl = preloadedDataUrl;
      if (!dataUrl) {
        showToast(`⏳ PDF ${pageNumber}페이지를 고해상도로 렌더링하고 있습니다...`);
        const result = await renderPdfPageToDataUrl(pdfDocProxy, pageNumber, 2000);
        dataUrl = result.dataUrl;
      }

      setPdfPickerOpen(false);

      if (mode === 'full_page') {
        setFullPageBackground(dataUrl);
        requestFullscreenSafe();
        showToast(`📄 PDF ${pageNumber}페이지가 현재 쪽 전체 배경으로 설정되었습니다.`);
      } else {
        // 크롭 모달 열기 (원자적 상태 전환)
        setEditingImageItem(null);
        setCropTargetImageSrc(dataUrl);
        setCropModalOpen(true);
      }
    } catch (err: any) {
      console.error('PDF 페이지 렌더링 실패:', err);
      showToast(`❌ PDF 페이지 처리 실패: ${err.message || '페이지 렌더링 오류'}`);
    }
  };

  // [시뮬레이션 및 테스트 전용]: 브라우저에서 100회 이상의 대량 페이지 선택 및 스트레스 테스트를 즉시 수행할 수 있도록 지원
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__openPdfPickerForTest = (totalPages = 20) => {
        setPdfFileName('테스트_학습지_20쪽.pdf');
        setPdfTotalPages(totalPages);
        setPdfThumbnails(Array.from({ length: totalPages }, (_, i) => ({
          pageNumber: i + 1,
          dataUrl: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280"><rect width="200" height="280" fill="%23ffffff" stroke="%233b82f6" stroke-width="2"/><text x="100" y="140" font-size="22" font-weight="bold" fill="%231e293b" text-anchor="middle">Page ${i + 1}</text></svg>`,
          width: 200,
          height: 280
        })));
        setPdfDocProxy({
          numPages: totalPages,
          getPage: async (num: number) => ({
            getViewport: () => ({ width: 800, height: 1120 }),
            render: ({ canvasContext }: any) => {
              canvasContext.fillStyle = '#ffffff';
              canvasContext.fillRect(0, 0, 800, 1120);
              canvasContext.fillStyle = '#1e293b';
              canvasContext.font = 'bold 36px sans-serif';
              canvasContext.fillText(`Page ${num} Content`, 250, 400);
              return { promise: Promise.resolve() };
            }
          })
        });
        setPdfPickerOpen(true);
      };
    }
  }, []);

  // 크롭 확정 핸들러 (새 이미지 추가 또는 기존 이미지 자르기 수정)
  const handleConfirmCrop = (croppedDataUrl: string, cropRect: CropRect) => {
    if (editingImageItem) {
      const aspect = cropRect.width / Math.max(1, cropRect.height);
      const newWidth = editingImageItem.width;
      const newHeight = Math.round(newWidth / aspect);
      setEmbeddedImages(prev => prev.map(img => img.id === editingImageItem.id ? {
        ...img,
        src: croppedDataUrl,
        crop: cropRect,
        width: newWidth,
        height: newHeight
      } : img));
      setEditingImageItem(null);
      showToast('✂️ 이미지 자르기 수정이 완료되었습니다.');
    } else {
      const aspect = cropRect.width / Math.max(1, cropRect.height);
      const initialWidth = Math.min(A4_WIDTH * 0.75, 750);
      const initialHeight = Math.round(initialWidth / aspect);
      const newId = `img_${Date.now()}`;
      const newImage: EmbeddedImageItem = {
        id: newId,
        src: croppedDataUrl,
        originalSrc: cropTargetImageSrc,
        x: Math.round((A4_WIDTH - initialWidth) / 2),
        y: Math.min(120, Math.round((A4_HEIGHT - initialHeight) / 3)),
        width: Math.round(initialWidth),
        height: Math.round(initialHeight),
        crop: cropRect
      };
      setEmbeddedImages(prev => [...prev, newImage]);
      setSelectedImageId(newId);
      setTool('image');
      showToast('🖼️ 이미지가 공책에 추가되었습니다. 위치와 크기를 조절할 수 있습니다.');
    }
    setCropModalOpen(false);
    requestFullscreenSafe();
  };

  // 기존 이미지 재자르기
  const handleEditCrop = (img: EmbeddedImageItem) => {
    setEditingImageItem(img);
    setCropTargetImageSrc(img.originalSrc || img.src);
    setCropModalOpen(true);
  };

  // 이미지 업데이트 (위치/크기 조절)
  const handleUpdateEmbeddedImage = (id: string, updates: Partial<EmbeddedImageItem>) => {
    setEmbeddedImages(prev => prev.map(img => img.id === id ? { ...img, ...updates } : img));
  };

  // 이미지 삭제
  const handleDeleteEmbeddedImage = (id: string) => {
    setEmbeddedImages(prev => prev.filter(img => img.id !== id));
    if (selectedImageId === id) setSelectedImageId(null);
    showToast('🗑️ 이미지가 삭제되었습니다.');
  };

  // ==========================================================================
  // [모듈 플러그인]: 올가미 집중 풀이 모듈 (Lasso Focus Page Handler)
  // ==========================================================================
  const [isLassoProcessing, setIsLassoProcessing] = useState<boolean>(false);

  const handleConfirmLassoFocus = async (
    lassoPoints: Point[],
    placement: 'top_center' | 'original',
    scale: number = 1.2,
    customBounds?: PolygonBounds
  ) => {
    if (!defaultLassoFocusConfig.enabled) return;
    setIsLassoProcessing(true);
    try {
      showToast('⏳ 선택한 문제로 고해상도 집중 풀이 페이지를 생성하고 있습니다...');
      const result = await createFocusedPageBackground({
        fullPageBackground,
        embeddedImages,
        strokes,
        textItems,
        paperTheme,
        lassoPoints,
        A4_WIDTH,
        A4_HEIGHT,
        placement,
        userScale: scale,
        customBounds
      });

      // 1. 현재 작성 중인 페이지 상태를 메모리에 안전하게 동기화 (기존 필기 100% 보존)
      const currentSavedPages = pages.map((p, idx) => {
        if (idx === currentPageIndex) {
          return {
            ...p,
            strokes,
            textItems,
            fullPageBackground,
            images: embeddedImages
          };
        }
        return p;
      });

      // 2. 새로운 집중 풀이 페이지 생성
      const newPageId = `page_focus_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const newFocusPage: LessonPage = {
        id: newPageId,
        strokes: [],
        textItems: [],
        fullPageBackground: result.dataUrl,
        images: []
      };

      // 3. 현재 페이지 바로 다음 쪽에 삽입!
      const nextIndex = currentPageIndex + 1;
      const updatedPages = [
        ...currentSavedPages.slice(0, nextIndex),
        newFocusPage,
        ...currentSavedPages.slice(nextIndex)
      ];

      setPages(updatedPages);
      setCurrentPageIndex(nextIndex);
      setStrokes([]);
      setTextItems([]);
      setFullPageBackground(result.dataUrl);
      setEmbeddedImages([]);
      setSelectedImageId(null);
      setUndoStack([]);
      setRedoStack([]);
      setActiveTextId(null);

      // 4. 즉시 풀이를 시작할 수 있도록 펜 도구로 자동 전환!
      setTool('pen');
      showToast(`✨ [집중 풀이] 문제가 상단에 배치된 ${nextIndex + 1}쪽 풀이장이 생성되었습니다! 바로 필기하세요.`);
    } catch (err: any) {
      console.error('올가미 집중 풀이 생성 오류:', err);
      showToast(`❌ 집중 풀이 페이지 생성 실패: ${err.message || '오류 발생'}`);
    } finally {
      setIsLassoProcessing(false);
    }
  };

  // 이미지 직접 전체 배경 설정
  const handleSetImageAsBackground = (imageSrc: string) => {
    setFullPageBackground(imageSrc);
    setCropModalOpen(false);
    showToast('📄 이미지가 현재 쪽 전체 배경으로 설정되었습니다.');
  };

  // 샘플 수학 문제지 생성 및 자르기 모달 열기 (테스트 및 빠른 실습용)
  const handleLoadSampleProblem = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 750;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 흰색 학습지 배경
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1000, 750);

    // 헤더 배너
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(40, 35, 920, 65);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px "Pretendard", sans-serif';
    ctx.fillText('📐 [단원 평가] 일차방정식과 함수의 활용', 65, 78);

    // 1번 문제 박스
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.strokeRect(40, 125, 920, 260);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 24px "Pretendard", sans-serif';
    ctx.fillText('[문제 1] 다음 일차방정식을 풀고 x의 값을 구하시오.', 65, 175);
    ctx.font = 'bold 32px monospace';
    ctx.fillStyle = '#dc2626';
    ctx.fillText('3x + 7 = 2x + 19', 120, 245);

    ctx.fillStyle = '#64748b';
    ctx.font = '19px "Pretendard", sans-serif';
    ctx.fillText('✍️ 풀이 과정과 정답을 아래 공책 여백에 직접 필기하세요.', 120, 320);

    // 2번 문제 박스
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.strokeRect(40, 415, 920, 290);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 24px "Pretendard", sans-serif';
    ctx.fillText('[문제 2] 다음 일차함수 y = 2x - 4 의 x절편과 y절편을 구하시오.', 65, 465);
    ctx.font = '22px "Pretendard", sans-serif';
    ctx.fillStyle = '#2563eb';
    ctx.fillText('(1) x절편: (      ,  0  )', 120, 540);
    ctx.fillText('(2) y절편: (  0   ,     )', 120, 610);

    const dataUrl = canvas.toDataURL('image/png');
    setEditingImageItem(null);
    setCropTargetImageSrc(dataUrl);
    setCropModalOpen(true);
    setActivePopup(null);
    showToast('📄 샘플 문제지를 불러왔습니다. 원하는 영역을 잘라보세요!');
  };

  // 20쪽 다쪽 샘플 PDF 학습지 즉시 로드 (페이지 선택/자르기/배경/다중선택 종합 테스트용)
  const handleLoadSamplePdf = () => {
    dismissReentryPrompt();
    setActivePopup(null);
    setPdfFileName('단원평가_수학학습지_20쪽.pdf');
    const totalP = 20;
    setPdfTotalPages(totalP);
    setPdfThumbnails(Array.from({ length: totalP }, (_, i) => {
      const pNum = i + 1;
      const cvs = document.createElement('canvas');
      cvs.width = 200;
      cvs.height = 282;
      const c = cvs.getContext('2d');
      if (c) {
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, 200, 282);
        c.fillStyle = '#3b82f6';
        c.fillRect(10, 10, 180, 25);
        c.fillStyle = '#ffffff';
        c.font = 'bold 12px sans-serif';
        c.fillText(`수학 학습지 - ${pNum}쪽`, 20, 27);
        c.fillStyle = '#1e293b';
        c.font = 'bold 14px sans-serif';
        c.fillText(`[문제 ${pNum * 2 - 1}] 3x + ${pNum} = 15`, 20, 70);
        c.fillText(`[문제 ${pNum * 2}] y = 2x - ${pNum}`, 20, 130);
        c.fillStyle = '#94a3b8';
        c.font = '10px sans-serif';
        c.fillText(`© 2026 전자칠판 수업자료`, 20, 260);
      }
      return {
        pageNumber: pNum,
        dataUrl: cvs.toDataURL('image/jpeg', 0.8),
        width: 200,
        height: 282
      };
    }));
    setPdfDocProxy({
      numPages: totalP,
      getPage: async (num: number) => ({
        getViewport: () => ({ width: 900, height: 1272 }),
        render: ({ canvasContext }: any) => {
          canvasContext.fillStyle = '#ffffff';
          canvasContext.fillRect(0, 0, 900, 1272);
          canvasContext.fillStyle = '#2563eb';
          canvasContext.fillRect(40, 40, 820, 70);
          canvasContext.fillStyle = '#ffffff';
          canvasContext.font = 'bold 30px sans-serif';
          canvasContext.fillText(`📐 [수학 단원평가] ${num}페이지 학습지`, 60, 88);
          canvasContext.fillStyle = '#0f172a';
          canvasContext.font = 'bold 24px sans-serif';
          canvasContext.fillText(`[문제 ${num * 2 - 1}] 다음 식을 계산하시오: 4x + ${num * 3} = 24`, 60, 190);
          canvasContext.fillText(`[문제 ${num * 2}] 그래프의 기울기를 구하시오: y = ${num}x + 5`, 60, 360);
          return { promise: Promise.resolve() };
        }
      })
    });
    setPdfPickerOpen(true);
    showToast('📑 20쪽 분량의 샘플 PDF 학습지가 로드되었습니다.');
  };


  // ==========================================================================


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
  const handleClearCurrentPage = async () => {
    setActivePopup(null);
    const ok = await confirm({
      title: '현재 쪽 필기 지우기',
      message: `현재 ${currentPageIndex + 1}쪽의 필기 내용을 모두 지우시겠습니까?`,
      confirmText: '내용 지우기',
      isDanger: true
    });
    if (!ok) return;

    if (strokes.length > 0) {
      setUndoStack(prev => [...prev.slice(-30), strokes]);
      setRedoStack([]);
    }
    setStrokes([]);
    setTextItems([]);
    showToast(`🗑️ ${currentPageIndex + 1}쪽 내용이 초기화되었습니다.`);
  };

  // [지우기 2] 전체 페이지 다 지우기
  const handleClearAllPages = async () => {
    setActivePopup(null);
    const ok = await confirm({
      title: '전체 페이지 초기화',
      message: '전체 페이지의 모든 필기 내용을 완전히 초기화하시겠습니까?\n(공책의 모든 쪽이 비워집니다)',
      confirmText: '모두 지우기',
      isDanger: true
    });
    if (!ok) return;

    const resetPages: LessonPage[] = [{ id: `page_${Date.now()}`, strokes: [], textItems: [] }];
    setPages(resetPages);
    setCurrentPageIndex(0);
    setStrokes([]);
    setTextItems([]);
    setUndoStack([]);
    setRedoStack([]);
    showToast('🗑️ 모든 페이지의 필기가 초기화되었습니다.');
  };

  // [지우기 3] 현재 쪽 완전히 삭제 (2쪽 이상일 때)
  const handleDeleteCurrentPage = async () => {
    if (pages.length <= 1) {
      showToast('⚠️ 최소 1개 페이지는 유지되어야 합니다.');
      return;
    }
    setActivePopup(null);
    const ok = await confirm({
      title: '페이지 완전 삭제',
      message: `현재 ${currentPageIndex + 1}쪽을 공책에서 완전히 삭제하시겠습니까?`,
      confirmText: '삭제하기',
      isDanger: true
    });
    if (!ok) return;

    const updated = pages.filter((_, idx) => idx !== currentPageIndex);
    const nextIdx = Math.max(0, currentPageIndex - 1);
    setPages(updated);
    setCurrentPageIndex(nextIdx);
    setStrokes(updated[nextIdx]?.strokes || []);
    setTextItems(updated[nextIdx]?.textItems || []);
    setUndoStack([]);
    setRedoStack([]);
    showToast(`🗑️ ${currentPageIndex + 1}쪽이 삭제되었습니다.`);
  };

  // ==========================================================================
  // [동적 확대/축소 배율 계산 (폭 맞춤 100% vs 전체 보기)]
  // - 100% 확대: 화면 가로 폭(Width)에 정확히 맞춤
  // - 전체 보기 (최대 축소): 한 페이지 전체(세로+가로)가 화면에 완전히 다 보일 때까지 축소
  // - 축소 제한: 화면 폭(100% 폭) 이하로 축소되지 않도록 철저히 제한 (정사각형/미니어처 축소 원천 차단)
  // ==========================================================================
  const getFitScales = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return { fitWidthScale: 1.0, fitPageScale: 0.6, minScale: 1.0, maxScale: 3.5 };
    }

    const availW = Math.max(200, container.clientWidth - 24);
    const availH = Math.max(200, container.clientHeight - 32);

    // 100% 폭 맞춤 배율 (화면 가로 폭 크기에 맞춤)
    const fitWidthScale = availW / paperBaseWidth;

    // 한 페이지 전체 보기 배율 (화면 높이와 폭 모두에 완전히 쏙 들어오는 최대 축소 기준)
    const fitPageScale = Math.min(availW / paperBaseWidth, availH / paperBaseHeight);

    // 사용자의 핵심 요구: "화면폭 이하로 축소 안되게"
    // 따라서 핀치 줌 및 축소 버튼의 기본 최소 배율(minScale)은 무조건 화면 폭 100%(fitWidthScale)로 제한!
    const minScale = fitWidthScale;
    const maxScale = Math.max(fitWidthScale * 3.5, 3.5);

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

  // 펜 전용 모드 시 캔버스 상에서 한 손가락 팬(스크롤) 이동 처리
  const handleFingerPanMove = useCallback((dx: number, dy: number) => {
    setPanOffset(prev => clampPanOffset({ x: prev.x + dx, y: prev.y + dy }, zoomScale));
  }, [clampPanOffset, zoomScale]);

  // [1] 한 페이지 전체 보기 (최대 축소: 한 페이지 전체가 한눈에 다 보임)
  const handleFitPage = useCallback(() => {
    const { fitPageScale: targetScale } = getFitScales();
    setZoomScale(targetScale);
    setPanOffset({ x: 0, y: 0 });
    showToast('📄 한 페이지 전체 보기에 맞췄습니다.');
  }, [getFitScales]);

  // [2] 화면 폭 맞춤 100% (화면 폭 크기에 맞게 페이지 크기 맞춤 및 상단부터 정렬)
  const handleFitWidth = useCallback(() => {
    const { fitWidthScale: targetScale } = getFitScales();
    setZoomScale(targetScale);
    const renderedHeight = paperBaseHeight * targetScale;
    const containerHeight = containerRef.current?.clientHeight || 800;
    const initialPanY = renderedHeight > containerHeight ? (renderedHeight - containerHeight) / 2 : 0;
    setPanOffset({ x: 0, y: initialPanY });
    showToast('↔️ 화면 폭에 100% 맞췄습니다.');
  }, [getFitScales, paperBaseHeight]);

  // [3] 폭 맞춤 ↔ 전체 보기 원터치 토글
  const handleToggleZoomFit = useCallback(() => {
    const { fitWidthScale: fw, fitPageScale: fp } = getFitScales();
    if (Math.abs(zoomScale - fw) <= Math.abs(zoomScale - fp)) {
      handleFitPage();
    } else {
      handleFitWidth();
    }
  }, [getFitScales, zoomScale, handleFitPage, handleFitWidth]);

  // 초기 로드 및 용지 방향(가로/세로) 전환 시 화면 폭 100% 맞춤으로 최적 로드 (상단부터 시작)
  useEffect(() => {
    if (containerRef.current) {
      const { fitWidthScale: targetScale } = getFitScales();
      setZoomScale(targetScale);
      const renderedHeight = paperBaseHeight * targetScale;
      const containerHeight = containerRef.current.clientHeight;
      const initialPanY = renderedHeight > containerHeight ? (renderedHeight - containerHeight) / 2 : 0;
      setPanOffset({ x: 0, y: initialPanY });
    }
  }, [orientation]);

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

  // 핀치 줌 / 팬 터치 제스처 중 리스너 재생성 및 프레임 드랍을 막기 위한 상태 Ref
  const zoomScaleRef = useRef(zoomScale);
  zoomScaleRef.current = zoomScale;
  const panOffsetRef = useRef(panOffset);
  panOffsetRef.current = panOffset;
  const clampPanOffsetRef = useRef(clampPanOffset);
  clampPanOffsetRef.current = clampPanOffset;
  const getFitScalesRef = useRef(getFitScales);
  getFitScalesRef.current = getFitScales;

  // 2손가락 핀치 줌 & 팬 (캔버스 필기 상태와 완전 격리, 60fps/120fps 부드러운 하드웨어 제스처)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        isGestureRef.current = true;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        initialTouchDistanceRef.current = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        initialScaleRef.current = zoomScaleRef.current;
        initialPanRef.current = { ...panOffsetRef.current };
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
          const { minScale: minS, maxScale: maxS } = getFitScalesRef.current();
          // 축소 시 화면 폭 이하로 작아지지 않도록 제한
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

          setPanOffset(clampPanOffsetRef.current({ x: rawPanX, y: rawPanY }, nextScale));
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
    };

    const onSelectStart = (e: Event) => {
      e.preventDefault();
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
    container.addEventListener('touchcancel', onTouchEnd, { passive: true });
    container.addEventListener('selectstart', onSelectStart);

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
      container.removeEventListener('selectstart', onSelectStart);
    };
  }, []);

  // 팝오버 메뉴 외부 터치/클릭 시 즉시 자동 닫기 (화면 가림 원천 해결)
  useEffect(() => {
    const handleOutsideInteraction = (e: Event) => {
      const target = e.target as HTMLElement;
      if (!target || !target.isConnected) return;
      if (!target.closest('.student-toolbar') && !target.closest('.samsung-tool-popup')) {
        setActivePopup(null);
      }
    };
    if (activePopup) {
      // 30ms 후 캡처 단계에서 pointerdown/touchstart/mousedown/click 모두 감지하여 터치 즉시 닫힘 보장
      const timer = setTimeout(() => {
        document.addEventListener('pointerdown', handleOutsideInteraction, { capture: true });
        document.addEventListener('touchstart', handleOutsideInteraction, { capture: true });
        document.addEventListener('mousedown', handleOutsideInteraction, { capture: true });
        document.addEventListener('click', handleOutsideInteraction, { capture: true });
      }, 30);
      return () => {
        clearTimeout(timer);
        document.removeEventListener('pointerdown', handleOutsideInteraction, { capture: true });
        document.removeEventListener('touchstart', handleOutsideInteraction, { capture: true });
        document.removeEventListener('mousedown', handleOutsideInteraction, { capture: true });
        document.removeEventListener('click', handleOutsideInteraction, { capture: true });
      };
    }
  }, [activePopup]);

  // 멀티페이지 데이터 일괄 복원 헬퍼
  const applyLoadedPages = useCallback((loadedPages: LessonPage[], targetIdx = 0, targetOrientation?: 'portrait' | 'landscape') => {
    if (!Array.isArray(loadedPages) || loadedPages.length === 0) return;
    const safeIdx = Math.min(Math.max(0, targetIdx), loadedPages.length - 1);
    setPages(loadedPages);
    setCurrentPageIndex(safeIdx);
    setStrokes(loadedPages[safeIdx].strokes || []);
    setTextItems(loadedPages[safeIdx].textItems || []);
    setFullPageBackground(loadedPages[safeIdx].fullPageBackground || null);
    setEmbeddedImages(loadedPages[safeIdx].images || []);
    setSelectedImageId(null);
    setUndoStack([]);
    setRedoStack([]);
    if (targetOrientation === 'landscape' || targetOrientation === 'portrait') {
      setOrientation(targetOrientation);
    }
  }, []);

  // [브라우저 탭 닫기/실수 새로고침 방지 경고]
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const hasWork = strokes.length > 0 || pages.some(p => (p.strokes?.length || 0) > 0 || (p.textItems?.length || 0) > 0 || p.fullPageBackground);
      if (hasWork) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [strokes, pages]);

  // [실시간 디바운스 자동 임시 저장 (0.6초)]
  // 학생이 획을 긋거나 지울 때마다 기기 로컬에 실시간 자동 보관하여 새로고침 시 100% 복원 보장
  useEffect(() => {
    if (isInitialMountRef.current) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(() => {
      try {
        const pagesToSave = [...pages];
        if (pagesToSave[currentPageIndex]) {
          pagesToSave[currentPageIndex] = {
            ...pagesToSave[currentPageIndex],
            strokes,
            textItems,
            fullPageBackground,
            images: embeddedImages
          };
        }

        const hasAnyContent = pagesToSave.some(
          p => (p.strokes?.length || 0) > 0 || (p.textItems?.length || 0) > 0 || p.fullPageBackground || (p.images?.length || 0) > 0
        );

        if (!hasAnyContent) {
          return;
        }

        const draft = {
          version: 'a4_v3',
          lessonId,
          timestamp: Date.now(),
          pages: pagesToSave,
          currentPageIndex,
          orientation,
          studentInfo
        };

        const currentStudentId = studentInfo ? studentInfoToId(studentInfo) : null;
        saveStudentDraft(lessonId, currentStudentId, draft);

        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        setLastSavedTimeStr(timeStr);
      } catch (err) {
        console.warn('자동 임시 저장 실패 (로컬 용량 등):', err);
      }
    }, 600);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [strokes, textItems, fullPageBackground, embeddedImages, pages, currentPageIndex, orientation, studentInfo, lessonId]);

  // [초기 마운트 시 복구 판별]
  // 1) 새로고침(Reload)인 경우: 작업 중이던 필기를 100% 무조건 자동 복원! (작업 손실 원천 차단)
  // 2) 신규 진입(Navigate, QR코드 첫 촬영)인 경우: 깨끗한 신규 A4 페이지로 시작하되,
  //    최근 저장된 작업이 있으면 상단에 [필기 이어하기] 배너를 제공하여 학생이 선택 가능하게 배려
  useEffect(() => {
    try {
      const currentStudentId = studentInfo ? studentInfoToId(studentInfo) : null;
      const loaded = loadStudentDraft(lessonId, currentStudentId);
      const wasReload = isPageReload();

      if (loaded?.draft && Array.isArray(loaded.draft.pages) && loaded.draft.pages.length > 0) {
        const draft = loaded.draft;
        if (wasReload) {
          // 새로고침 시 무조건 즉시 자동 복원!
          applyLoadedPages(draft.pages, draft.currentPageIndex ?? 0, draft.orientation);
          const now = new Date(draft.timestamp || Date.now());
          const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
          setLastSavedTimeStr(timeStr);
          showToast('🔄 새로고침 후 작성 중이던 필기를 안전하게 복원했습니다.');
          isInitialMountRef.current = false;
          return;
        } else {
          // 새 QR 진입인 경우: 신규 깨끗한 A4 페이지로 열리되, 이전 필기 복구 안내 배너 표시
          setRecoveryPromptDraft(draft);
          setHasSavedNote(true);
        }
      }

      // 레거시/개별 백업 확인 (설정 팝업용)
      const backupKey = getStudentBackupKey(lessonId, currentStudentId);
      const rawSaved = localStorage.getItem(backupKey) ||
                       localStorage.getItem(`lbw_lesson_${lessonId}_note_v2`) ||
                       localStorage.getItem(`lbw_lesson_${lessonId}_note`);
      if (rawSaved) {
        setHasSavedNote(true);
      }
    } catch (e) {
      console.warn('Failed to inspect draft on mount:', e);
    } finally {
      isInitialMountRef.current = false;
    }
  }, [lessonId, studentInfo, applyLoadedPages]);

  // [이전 필기 불러오기 (수동 복원)]
  const handleRestoreSavedNote = useCallback(() => {
    try {
      // 1. 활성 드래프트 우선 확인 (학생별 독립 키)
      const currentStudentId = studentInfo ? studentInfoToId(studentInfo) : null;
      const loaded = loadStudentDraft(lessonId, currentStudentId);
      if (loaded?.draft && Array.isArray(loaded.draft.pages) && loaded.draft.pages.length > 0) {
        applyLoadedPages(loaded.draft.pages, loaded.draft.currentPageIndex ?? 0, loaded.draft.orientation);
        showToast('📂 최근 임시 저장된 필기 내용을 성공적으로 불러왔습니다.');
        setActivePopup(null);
        return;
      }

      // 2. 제출본 백업 확인
      const backupKey = getStudentBackupKey(lessonId, currentStudentId);
      const rawSaved = localStorage.getItem(backupKey) ||
                       localStorage.getItem(`lbw_lesson_${lessonId}_note_v2`) ||
                       localStorage.getItem(`lbw_lesson_${lessonId}_note`);
      if (!rawSaved) {
        showToast('ℹ️ 저장된 이전 필기 데이터가 없습니다.');
        return;
      }
      const data = JSON.parse(rawSaved);
      if (data.pages && Array.isArray(data.pages) && data.pages.length > 0) {
        applyLoadedPages(data.pages, 0, data.orientation);
      } else if (data.strokes) {
        const legacyPage: LessonPage = {
          id: 'page_1',
          strokes: data.strokes || [],
          textItems: data.textItems || [],
          fullPageBackground: data.fullPageBackground || null,
          images: data.images || []
        };
        applyLoadedPages([legacyPage], 0, data.orientation);
      }
      showToast('📂 이전 필기 내용을 성공적으로 불러왔습니다.');
      setActivePopup(null);
    } catch (err: any) {
      showToast(`❌ 이전 필기 불러오기 실패: ${err.message}`);
    }
  }, [lessonId, applyLoadedPages]);

  // [깨끗한 새 A4 공책으로 새로 시작]
  const handleStartFreshNotebook = useCallback(() => {
    try {
      localStorage.removeItem(`lbw_active_draft_${lessonId}_v3`);
      sessionStorage.removeItem(`lbw_session_draft_${lessonId}`);
    } catch {}
    setRecoveryPromptDraft(null);
    setLastSavedTimeStr('');
    const newPage: LessonPage = {
      id: `page_${Date.now()}`,
      strokes: [],
      textItems: [],
      fullPageBackground: null,
      images: []
    };
    setPages([newPage]);
    setStrokes([]);
    setTextItems([]);
    setFullPageBackground(null);
    setEmbeddedImages([]);
    setSelectedImageId(null);
    setUndoStack([]);
    setRedoStack([]);
    setCurrentPageIndex(0);
    showToast('✨ 깨끗한 새 A4 공책이 생성되었습니다.');
    setActivePopup(null);
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
  // [전자칠판 실시간 연결 및 출석 신호 전송 (초경량 100바이트)]
  // ==========================================================================
  const handleConnectToBoard = async () => {
    if (!studentInfo || !studentInfo.name.trim()) {
      showToast('⚠️ 먼저 학번과 이름을 입력해주세요.');
      setIsChangingStudent(true);
      return;
    }

    // 1. 브라우저 전체화면 요청
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } catch (fsErr) {
      console.warn('전체화면 요청 실패(사용자 제스처 필요):', fsErr);
    }

    // 2. 화면 꺼짐 방지 (Screen Wake Lock API)
    try {
      if ('wakeLock' in navigator && !wakeLockRef.current) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch (wlErr) {
      console.warn('Wake Lock 활성화 경고:', wlErr);
    }

    // 3. 전자칠판 실시간 채널 연결 및 출석 신호 전송 (학생은 웹소켓 연결을 소모하지 않는 student 모드로 등록)
    setIsConnectedToBoard(true);
    classroomRealtime.joinLesson(lessonId, undefined, 'student');
    // 600명 동시 로그인 시 트래픽 스파이크 방지 (0~1500ms 랜덤 지터)
    const connectJitter = Math.floor(Math.random() * 1500);
    setTimeout(async () => {
      try {
        await classroomRealtime.sendSignal({
          type: 'STUDENT_PRESENCE',
          lessonId,
          student: studentInfo,
          status: 'connected'
        });
      } catch {}
    }, connectJitter);

    showToast(`📡 '${studentInfo.name}' 학생이 전자칠판에 연결되었습니다! (전체화면)`);
  };

  // 수업 나가기 처리 (WakeLock 해제, 전체화면 종료, 이탈 신호)
  const handleExitLesson = async () => {
    if (isConnectedToBoard) {
      const ok = await confirm({
        title: '수업 종료',
        message: '수업을 종료하고 전자칠판 연결을 해제하시겠습니까?',
        confirmText: '수업 종료',
        cancelText: '계속 수업하기',
        isDanger: true
      });
      if (!ok) return;

      if (wakeLockRef.current) {
        try {
          await wakeLockRef.current.release();
        } catch {}
        wakeLockRef.current = null;
      }
      await exitFullscreenSafe();
      await classroomRealtime.sendSignal({
        type: 'STUDENT_PRESENCE',
        lessonId,
        student: studentInfo || undefined,
        status: 'left'
      });
      classroomRealtime.leaveLesson();
      setIsConnectedToBoard(false);
    }

    if (onExit) onExit();
  };

  // ==========================================================================
  // [초경량 백그라운드 필기 동기화 엔진 (온디맨드 호출 & 등록 공용)]
  // ==========================================================================
  const syncCurrentNoteToCloud = useCallback(async (quiet = false): Promise<ClassNoteRecord | null> => {
    if (!studentInfo) return null;

    try {
      // 1. 현재 작성 중인 페이지와 메모리 동기화
      const currentPagesCopy = pages.map((p, idx) => {
        if (idx === currentPageIndex) {
          return {
            ...p,
            strokes,
            textItems,
            fullPageBackground,
            images: embeddedImages
          };
        }
        return p;
      });

      // 끝부분의 빈 페이지 정리 (최소 1페이지 유지)
      const finalPages = [...currentPagesCopy];
      while (finalPages.length > 1) {
        const last = finalPages[finalPages.length - 1];
        const isBlank = (!last.strokes || last.strokes.length === 0) &&
                        (!last.textItems || last.textItems.length === 0) &&
                        !last.fullPageBackground &&
                        (!last.images || last.images.length === 0);
        if (isBlank) finalPages.pop();
        else break;
      }

      // 2. 포인트 최적화
      const rawOptimized = finalPages.map(p => ({
        ...p,
        fullPageBackground: p.fullPageBackground || null,
        images: p.images || [],
        strokes: (p.strokes || []).map(s => ({ ...s, points: optimizePoints(s.points) }))
      }));

      // 3. 💥 초경량 이미지 압축 (배경 이미지 및 스티커 95% 압축 -> 150KB 내외)
      const optimizedPages = await compressNotePagesForTransmission(rawOptimized);

      const now = new Date().toISOString();
      const studentKey = `${studentInfo.grade}_${studentInfo.classNum}_${studentInfo.studentNum}`;
      const targetRowId = submissionIdRef.current || `note_${lessonId}_${studentKey}`;

      const record: ClassNoteRecord = {
        id: targetRowId,
        lesson_id: lessonId,
        student_grade: studentInfo.grade,
        student_class: studentInfo.classNum,
        student_num: studentInfo.studentNum,
        student_name: studentInfo.name,
        strokes_data: {
          pages: optimizedPages,
          orientation,
          paperTheme,
          strokes: optimizedPages[0]?.strokes || [],
          textItems: optimizedPages[0]?.textItems || []
        },
        updated_at: now
      };

      const curStudentId = studentInfo ? studentInfoToId(studentInfo) : 'anonymous';

      // 4-0. [오프라인 모듈]: IndexedDB 영구 저장소에 5MB 한계 없이 안전 백업
      saveOfflineNotebookDraft(lessonId, curStudentId, {
        student: studentInfo,
        lessonId,
        pages: optimizedPages,
        orientation,
        paperTheme,
        timestamp: now
      });

      // 4-0-1. 오프라인 상태 감지 시: Outbox 대기열에 담고 즉시 완료 처리
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await enqueuePendingSubmission({
          lessonId,
          studentId: curStudentId,
          studentName: studentInfo.name,
          classNumber: `${studentInfo.grade}-${studentInfo.classNum}`,
          payload: record
        });
        if (!quiet) {
          showToast(`📡 오프라인 상태입니다. 기기에 안전하게 저장되었으며, 연결 시 자동 제출됩니다.`);
        }
        setHasSavedNote(true);
        return record;
      }

      // 4-1. 🚀 [Vercel 클라우드 릴레이] 초고속 0.05초 즉시 등록 (Supabase 장애/지연 시에도 100% 가용성 보장)
      try {
        const apiBase = getApiBaseUrl();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        await fetch(`${apiBase}/api/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'submit',
            lessonId,
            record
          }),
          signal: controller.signal
        }).finally(() => clearTimeout(timeoutId));
      } catch (relayErr) {
        console.warn('Vercel relay submit warning:', relayErr);
      }

      // 4-2. Supabase 클라우드 실시간 업서트 (최대 3.5초 비차단 타임아웃 가드 + 1회 백오프 재시도)
      const client = supabase;
      if (client && isSupabaseConfigured) {
        try {
          const executeUpsert = async () => {
            const sbPromise = client
              .from('class_notes')
              .upsert([record])
              .select('id')
              .single();
            const timeoutPromise = new Promise<any>((resolve) =>
              setTimeout(() => resolve({ data: null, error: new Error('TIMEOUT') }), 3500)
            );
            return await Promise.race([sbPromise, timeoutPromise]);
          };

          let { data: savedData, error: sbError } = await executeUpsert();

          // 일시적 타임아웃/경합 시 1초 대기 후 1회 자동 재시도
          if (sbError && !savedData) {
            await new Promise((r) => setTimeout(r, 1000));
            const retryRes = await executeUpsert();
            savedData = retryRes.data;
          }

          if (savedData?.id) {
            submissionIdRef.current = savedData.id;
            record.id = savedData.id;
          }
        } catch (sbErr) {
          console.warn('Supabase save timeout/error:', sbErr);
        }
      }

      // 5. 로컬 스토리지 안전 캐시 (학생별 독립 키로 보관)
      try {
        const curStudentId = studentInfo ? studentInfoToId(studentInfo) : null;
        const backupKey = getStudentBackupKey(lessonId, curStudentId);
        localStorage.setItem(backupKey, JSON.stringify({
          student: studentInfo,
          lessonId,
          pages: optimizedPages,
          orientation,
          paperTheme,
          timestamp: now
        }));
      } catch {}

      if (!quiet) {
        showToast(`🎉 '${studentInfo.name}' 학생의 필기가 등록되었습니다!`);
      }
      setHasSavedNote(true);
      return record;
    } catch (err: any) {
      console.error('필기 동기화 오류:', err);
      if (!quiet) showToast(`⚠️ 온라인 전송이 지연되고 있으나, 기기 로컬에 100% 안전하게 보관되었습니다.`);
      return null;
    }
  }, [studentInfo, pages, currentPageIndex, strokes, textItems, fullPageBackground, embeddedImages, lessonId, orientation]);

  // [오프라인 모듈]: 백그라운드 자동 재전송 엔진 가동
  useEffect(() => {
    const cleanup = initOfflineSync(async (item) => {
      try {
        const apiBase = getApiBaseUrl();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(`${apiBase}/api/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'submit',
            lessonId: item.lessonId,
            record: item.payload
          }),
          signal: controller.signal
        }).finally(() => clearTimeout(timeoutId));

        if (res.ok) {
          showToast(`🚀 '${item.studentName}' 학생의 오프라인 필기가 전자칠판으로 자동 전송되었습니다!`);
          return true;
        }
      } catch (err) {
        console.warn('[OfflineSync] 자동 전송 지연:', err);
      }
      return false;
    });
    return cleanup;
  }, []);

  // 실시간 신호 리스너 (선생님이 특정 학생을 클릭하거나 전체 동기화 요청 시)
  useEffect(() => {
    if (!isConnectedToBoard || !studentInfo) return;

    const unsubscribe = classroomRealtime.subscribe(async (signal) => {
      if (signal.lessonId !== lessonId) return;

      if (signal.type === 'RESET_SESSION') {
        setIsConnectedToBoard(false);
        submissionIdRef.current = null;
        showToast('📢 선생님이 새 수업을 시작하여 세션이 초기화되었습니다.');
        return;
      }

      const myKey = `${studentInfo.grade}_${studentInfo.classNum}_${studentInfo.studentNum}`;

      // 선생님이 칠판에서 잘못 접속된 학생을 삭제/해제한 경우
      if (signal.type === 'KICK_STUDENT' && signal.targetStudentKey === myKey) {
        setIsConnectedToBoard(false);
        submissionIdRef.current = null;
        classroomRealtime.leaveLesson();
        showToast('📢 선생님에 의해 전자칠판 연결이 해제되었습니다. 작성 중이던 필기는 기기에 안전하게 보존됩니다.');
        return;
      }
      const isTargeted = signal.type === 'REQUEST_STUDENT_NOTE' && signal.targetStudentKey === myKey;
      const isAllSync = signal.type === 'REQUEST_ALL_SYNC';

      if (isTargeted || isAllSync) {
        try {
          // 600명 학생 동시성 분산 (전체 동기화 시 0~4.5초 무작위 지연으로 Supabase 트래픽 폭주 100% 방어)
          if (isAllSync) {
            const jitterMs = Math.floor(Math.random() * 4500);
            await new Promise((res) => setTimeout(res, jitterMs));
          }

          const syncedRecord = await syncCurrentNoteToCloud(true);
          if (syncedRecord) {
            await classroomRealtime.sendSignal({
              type: 'RESPONSE_STUDENT_NOTE',
              lessonId,
              student: studentInfo,
              noteRecord: syncedRecord
            });
          }
        } catch (syncErr) {
          console.warn('백그라운드 동기화 실패:', syncErr);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [isConnectedToBoard, studentInfo, lessonId, syncCurrentNoteToCloud]);

  // [등록 및 제출하기] 수동 버튼 클릭 핸들러 (연타 방지 및 4초 쿨다운 가드)
  const handleSubmitLesson = async () => {
    if (isSubmitting) return;

    if (!studentInfo) {
      setIsChangingStudent(true);
      return;
    }

    // 4초 이내 중복 연타 방지
    const now = Date.now();
    if (now - lastSubmitTimeRef.current < 4000) {
      showToast('⏳ 방금 필기가 전송되었습니다. 4초 후에 다시 제출할 수 있습니다.');
      return;
    }
    lastSubmitTimeRef.current = now;

    setIsSubmitting(true);
    showToast(`🚀 '${studentInfo.name}' 학생의 필기를 등록하는 중...`);

    try {
      const record = await syncCurrentNoteToCloud(false);
      if (record) {
        // 실시간 채널에 제출 알림
        await classroomRealtime.sendSignal({
          type: 'STUDENT_SUBMIT',
          lessonId,
          student: studentInfo,
          noteRecord: record
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // [로컬 기기에 현재 필기 PDF 다운로드 저장]
  const handleExportStudentPdf = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    showToast('⏳ 필기 내용을 고화질 PDF로 생성하는 중입니다...');

    try {
      // 현재 쪽 데이터 최신 동기화
      const pagesToExport = [...pages];
      if (pagesToExport[currentPageIndex]) {
        pagesToExport[currentPageIndex] = {
          ...pagesToExport[currentPageIndex],
          strokes,
          textItems,
          fullPageBackground,
          images: embeddedImages
        };
      }

      const res = await exportStudentNotebookToPdf({
        lessonTitle,
        studentInfo,
        pages: pagesToExport,
        orientation,
        A4_WIDTH,
        A4_HEIGHT
      });

      if (res.success) {
        showToast(`📥 PDF가 성공적으로 저장되었습니다!\n(${res.fileName})`);
      }
    } catch (err: any) {
      console.error('PDF 다운로드 실패:', err);
      showToast(`❌ PDF 저장 실패: ${err.message || '알 수 없는 오류'}`);
    } finally {
      setIsExportingPdf(false);
    }
  };

  // [공책 편집 파일(.lbwnote) 로컬 저장]
  const handleExportNotebookFile = () => {
    try {
      const pagesToExport = [...pages];
      if (pagesToExport[currentPageIndex]) {
        pagesToExport[currentPageIndex] = {
          ...pagesToExport[currentPageIndex],
          strokes,
          textItems,
          fullPageBackground,
          images: embeddedImages
        };
      }

      const res = exportNotebookToFile({
        lessonTitle,
        studentInfo,
        pages: pagesToExport,
        currentPageIndex,
        orientation,
        A4_WIDTH,
        A4_HEIGHT
      });

      if (res.success) {
        showToast(`💾 필기 편집 파일이 저장되었습니다!\n(${res.fileName})`);
        setActivePopup(null);
      }
    } catch (err: any) {
      console.error('필기 파일 저장 실패:', err);
      showToast(`❌ 필기 파일 저장 실패: ${err.message || '알 수 없는 오류'}`);
    }
  };

  // [공책 편집 파일(.lbwnote / .json) 불러오기]
  const handleImportNotebookFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    requestFullscreenSafe();
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    try {
      showToast(`⏳ '${file.name}' 필기 파일을 불러오는 중입니다...`);
      const notebook = await importNotebookFromFile(file);
      applyLoadedPages(notebook.pages, notebook.currentPageIndex, notebook.orientation);
      showToast(`📂 '${file.name}' 필기 파일(총 ${notebook.pages.length}쪽)을 불러왔습니다! 바로 이어서 편집할 수 있습니다.`);
      setActivePopup(null);
    } catch (err: any) {
      console.error('필기 파일 불러오기 실패:', err);
      showToast(`❌ 파일 불러오기 실패: ${err.message || '파일을 열 수 없습니다.'}`);
    }
  };

  return (
    <div
      className="student-app-container"
      onContextMenu={(e) => e.preventDefault()}
      style={{
        overflow: 'hidden',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100dvh',
        touchAction: 'none',
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
        boxSizing: 'border-box',
        paddingTop: 'max(12px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(6px, env(safe-area-inset-bottom, 0px))',
        zIndex: 50
      }}
    >
      {/* ====================================================================
          스케치 1:1 반영 플로팅 툴바
          [○ 툴바숨기기 토글] [≡ 숨김메뉴] | [/ 펜] [/ 형광펜] [▱ 지우개] [□ PDF/이미지] | [○ ○ ○ ○ ○ 색상] | [↔ 폭맞춤]
          ==================================================================== */}
      {isToolbarCollapsed ? (
        <button
          id="btn-expand-toolbar"
          type="button"
          onClick={() => setIsToolbarCollapsed(false)}
          style={{
            position: 'absolute',
            top: 'max(12px, env(safe-area-inset-top, 12px))',
            left: '14px',
            zIndex: 1050,
            width: '42px',
            height: '42px',
            borderRadius: '50%',
            background: 'rgba(18, 20, 26, 0.92)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            boxShadow: '0 6px 22px rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ffffff',
            cursor: 'pointer',
            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
          title="툴바 펼치기 (도구함 열기)"
        >
          <IconCollapse size={20} isCollapsed={true} />
        </button>
      ) : (
        <div className="student-floating-toolbar-wrapper">
          {canToolbarScrollLeft && (
            <button
              id="btn-toolbar-scroll-left"
              type="button"
              className="toolbar-scroll-hint-btn left"
              onClick={() => scrollToolbarToLeft(140)}
              title="도구 왼쪽으로 스크롤"
            >
              ◀
            </button>
          )}

          <div
            id="student-main-toolbar"
            ref={toolbarScrollRef}
            className="student-floating-toolbar student-toolbar"
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              borderRadius: '9999px',
              background: 'rgba(18, 20, 26, 0.92)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5), 0 0 1px rgba(255, 255, 255, 0.2) inset',
              maxWidth: 'calc(100vw - 20px)',
              overflowX: 'auto',
              overflowY: 'visible',
              scrollbarWidth: 'none',
              touchAction: 'pan-x'
            }}
          >
          {/* 1. [○ 툴바숨기기 토글] */}
          <button
            id="btn-collapse-toolbar"
            type="button"
            className="student-tool-btn"
            onClick={() => {
              setIsToolbarCollapsed(true);
              setActivePopup(null);
            }}
            style={{
              width: '34px',
              height: '34px',
              padding: 0,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#94a3b8',
              flexShrink: 0
            }}
            title="툴바 숨기기 (필기 화면 최대화)"
          >
            <IconCollapse size={16} isCollapsed={false} />
          </button>

          {/* 2. [≡ 숨김메뉴 -> 나머지 모두 여기에 정리] */}
          <button
            id="btn-toggle-menu"
            type="button"
            className={`student-tool-btn ${activePopup === 'menu' ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setActivePopup(prev => prev === 'menu' ? null : 'menu');
            }}
            style={{
              width: '34px',
              height: '34px',
              padding: 0,
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: activePopup === 'menu' ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255, 255, 255, 0.06)',
              border: activePopup === 'menu' ? '1px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.1)',
              color: activePopup === 'menu' ? '#60a5fa' : '#cbd5e1',
              flexShrink: 0,
              position: 'relative'
            }}
            title="전체 메뉴 (학생 정보, 칠판 등록, PDF 저장, 용지 설정 등)"
          >
            <IconMenu size={18} />
            {isConnectedToBoard && (
              <span
                style={{
                  position: 'absolute',
                  top: '4px',
                  right: '4px',
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: '#22c55e',
                  boxShadow: '0 0 6px #22c55e'
                }}
              />
            )}
          </button>

          {/* [모듈 플러그인]: 메인 툴바 컴팩트 페이지 내비게이션 위젯 */}
          <ToolbarPageNavigator
            currentPageIndex={currentPageIndex}
            totalPages={pages.length}
            onPrevPage={() => handleGoToPage(currentPageIndex - 1)}
            onNextPage={() => handleGoToPage(currentPageIndex + 1)}
            onOpenOverview={() => setIsPageOverviewOpen(true)}
            onAddPage={handleAddPage}
          />

          {/* [오프라인 모듈]: 네트워크 상태 및 동기화 대기열 배지 */}
          <OfflineStatusBadge style={{ marginLeft: '4px', flexShrink: 0 }} />

          {/* [PWA 모듈]: 브라우저 접속 시 홈 화면 앱 설치 배지 (설치 시 자동 숨김) */}
          <PwaInstallButton style={{ marginLeft: '4px', flexShrink: 0 }} />

          {/* [QR 스캐너 모듈]: 카메라로 전자칠판 QR코드 즉시 스캔 버튼 */}
          <button
            type="button"
            onClick={() => setIsQrScannerOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: '14px',
              border: '1px solid rgba(168, 85, 247, 0.45)',
              background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.2) 0%, rgba(139, 92, 246, 0.25) 100%)',
              color: '#c084fc',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              marginLeft: '4px',
              flexShrink: 0,
              userSelect: 'none',
              backdropFilter: 'blur(4px)'
            }}
            title="카메라로 전자칠판의 수업 QR코드를 찍어서 바로 입장"
          >
            <span>📷</span>
            <span>QR 찍기</span>
          </button>

          <div style={{ width: '1px', height: '20px', background: 'rgba(255, 255, 255, 0.15)', margin: '0 2px', flexShrink: 0 }} />

          {/* 3. [/ 펜] */}
          <button
            id="btn-tool-pen"
            type="button"
            className={`student-tool-btn ${tool === 'pen' ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (tool !== 'pen') {
                setTool('pen');
              } else {
                setActivePopup(prev => prev === 'pen' ? null : 'pen');
              }
            }}
            style={{
              width: '36px',
              height: '34px',
              padding: 0,
              borderRadius: '8px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: tool === 'pen' ? 'rgba(59, 130, 246, 0.22)' : 'transparent',
              border: tool === 'pen' ? '1px solid rgba(59, 130, 246, 0.6)' : '1px solid transparent',
              color: tool === 'pen' ? '#38bdf8' : '#e2e8f0',
              gap: '2px',
              flexShrink: 0
            }}
            title="펜 (애플펜슬 화면 더블탭 또는 'P' 단축키로 지우개와 전환, 다시 클릭 시 굵기 설정)"
          >
            <IconPen size={18} color={tool === 'pen' ? '#38bdf8' : '#e2e8f0'} />
            <div
              style={{
                width: '14px',
                height: `${Math.min(4, Math.max(2, penSize))}px`,
                borderRadius: '2px',
                backgroundColor: penColor,
                boxShadow: '0 0 4px rgba(0,0,0,0.4)',
                border: penColor === '#000000' ? '1px solid #777' : undefined
              }}
            />
          </button>

          {/* 4. [/ 형광펜] */}
          <button
            id="btn-tool-highlighter"
            type="button"
            className={`student-tool-btn ${tool === 'highlighter' ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (tool !== 'highlighter') {
                setTool('highlighter');
              } else {
                setActivePopup(prev => prev === 'highlighter' ? null : 'highlighter');
              }
            }}
            style={{
              width: '36px',
              height: '34px',
              padding: 0,
              borderRadius: '8px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: tool === 'highlighter' ? 'rgba(250, 204, 21, 0.18)' : 'transparent',
              border: tool === 'highlighter' ? '1px solid rgba(250, 204, 21, 0.5)' : '1px solid transparent',
              color: tool === 'highlighter' ? '#fde047' : '#e2e8f0',
              gap: '2px',
              flexShrink: 0
            }}
            title="형광펜 ('H' 단축키로 전환, 다시 클릭 시 굵기 및 색상 설정)"
          >
            <IconHighlighter size={18} color={tool === 'highlighter' ? '#fde047' : '#e2e8f0'} />
            <div
              style={{
                width: '14px',
                height: '3px',
                borderRadius: '2px',
                backgroundColor: highlighterColor,
                opacity: 0.85,
                boxShadow: `0 0 4px ${highlighterColor}`
              }}
            />
          </button>

          {/* 5. [▱ 지우개] */}
          <button
            id="btn-tool-eraser"
            type="button"
            className={`student-tool-btn ${tool === 'eraser' ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (tool !== 'eraser') {
                setTool('eraser');
              } else {
                setActivePopup(prev => prev === 'eraser' ? null : 'eraser');
              }
            }}
            style={{
              width: '36px',
              height: '34px',
              padding: 0,
              borderRadius: '8px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: tool === 'eraser' ? 'rgba(56, 189, 248, 0.22)' : 'transparent',
              border: tool === 'eraser' ? '1px solid rgba(56, 189, 248, 0.6)' : '1px solid transparent',
              color: tool === 'eraser' ? '#38bdf8' : '#e2e8f0',
              gap: '2px',
              flexShrink: 0
            }}
            title={`지우개 (${eraserMode === 'stroke' ? '획 지우개' : '영역 지우개'}, 애플펜슬 화면 더블탭 또는 'E' 단축키로 펜과 전환, 다시 클릭 시 설정)`}
          >
            <EraserIcon size={17} color={tool === 'eraser' ? '#38bdf8' : '#e2e8f0'} />
            <div
              style={{
                width: '14px',
                height: '2px',
                borderRadius: '2px',
                backgroundColor: eraserMode === 'stroke' ? '#38bdf8' : '#cbd5e1'
              }}
            />
          </button>

          {/* [모듈 플러그인]: 5-1. [🎯 올가미 집중 풀이 도구] */}
          {defaultLassoFocusConfig.enabled && (
            <button
              id="btn-tool-lasso"
              type="button"
              className={`student-tool-btn ${tool === 'lasso' ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                if (tool !== 'lasso') {
                  setTool('lasso');
                  setActivePopup(null);
                  showToast('🎯 올가미 활성화: 집중해서 풀고 싶은 문제를 동그랗게 둘러싸세요!');
                } else {
                  setTool('pen');
                }
              }}
              style={{
                width: '36px',
                height: '34px',
                padding: 0,
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: tool === 'lasso' ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.3) 0%, rgba(99, 102, 241, 0.3) 100%)' : 'transparent',
                border: tool === 'lasso' ? '1.5px solid #8b5cf6' : '1px solid transparent',
                color: tool === 'lasso' ? '#c084fc' : '#e2e8f0',
                gap: '2px',
                flexShrink: 0,
                boxShadow: tool === 'lasso' ? '0 0 12px rgba(139, 92, 246, 0.5)' : 'none'
              }}
              title="집중 풀이 올가미 (문제를 둘러싸면 상단에 배치된 새 풀이장이 다음 쪽에 자동 생성됩니다)"
            >
              <span style={{ fontSize: '16px' }}>🎯</span>
              <div
                style={{
                  width: '14px',
                  height: '2px',
                  borderRadius: '2px',
                  backgroundColor: tool === 'lasso' ? '#c084fc' : 'transparent'
                }}
              />
            </button>
          )}

          {/* 6. [□ PDF/이미지] */}
          <button
            id="btn-tool-image"
            type="button"
            className={`student-tool-btn ${activePopup === 'image' ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setActivePopup(prev => prev === 'image' ? null : 'image');
            }}
            style={{
              width: '36px',
              height: '34px',
              padding: 0,
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: activePopup === 'image' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              border: activePopup === 'image' ? '1px solid rgba(99, 102, 241, 0.6)' : '1px solid transparent',
              color: activePopup === 'image' ? '#a5b4fc' : '#e2e8f0',
              flexShrink: 0
            }}
            title="PDF 및 이미지 삽입 (학습지, 문제 사진 배경/스티커 추가)"
          >
            <IconImageDoc size={18} color={activePopup === 'image' ? '#a5b4fc' : '#e2e8f0'} />
          </button>

          <div style={{ width: '1px', height: '20px', background: 'rgba(255, 255, 255, 0.15)', margin: '0 2px', flexShrink: 0 }} />

          {/* 7. [↩️ 취소] & [↪️ 되돌리기] */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
            <button
              id="btn-tool-undo"
              type="button"
              className="student-tool-btn"
              disabled={undoStack.length === 0}
              onClick={handleUndo}
              style={{
                width: '34px',
                height: '34px',
                padding: 0,
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: '1px solid transparent',
                color: undoStack.length > 0 ? '#e2e8f0' : '#475569',
                opacity: undoStack.length > 0 ? 1 : 0.35,
                cursor: undoStack.length > 0 ? 'pointer' : 'not-allowed',
                flexShrink: 0
              }}
              title="취소 (방금 그린 획 실행 취소, Ctrl+Z)"
            >
              <IconUndo size={17} />
            </button>
            <button
              id="btn-tool-redo"
              type="button"
              className="student-tool-btn"
              disabled={redoStack.length === 0}
              onClick={handleRedo}
              style={{
                width: '34px',
                height: '34px',
                padding: 0,
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: '1px solid transparent',
                color: redoStack.length > 0 ? '#e2e8f0' : '#475569',
                opacity: redoStack.length > 0 ? 1 : 0.35,
                cursor: redoStack.length > 0 ? 'pointer' : 'not-allowed',
                flexShrink: 0
              }}
              title="되돌리기 (취소한 획 다시 실행, Ctrl+Y)"
            >
              <IconRedo size={17} />
            </button>
          </div>

          <div style={{ width: '1px', height: '20px', background: 'rgba(255, 255, 255, 0.15)', margin: '0 2px', flexShrink: 0 }} />

          {/* 7. [○ ○ ○ ○ ○ 색상 원 5개] */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '0 2px', flexShrink: 0 }}>
            {[
              { color: '#ffffff', label: '흰색' },
              { color: '#fde047', label: '노란색' },
              { color: '#38bdf8', label: '하늘색' },
              { color: '#f87171', label: '빨간색' },
              { color: '#4ade80', label: '초록색' }
            ].map(({ color, label }) => {
              const isSelected = tool !== 'eraser' && penColor.toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={color}
                  type="button"
                  onClick={() => {
                    setPenColor(color);
                    if (tool === 'eraser') setTool('pen');
                  }}
                  style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    backgroundColor: color,
                    border: '2px solid rgba(18, 20, 26, 0.9)',
                    outline: isSelected ? '2px solid #38bdf8' : 'none',
                    outlineOffset: '1px',
                    boxShadow: isSelected ? `0 0 8px ${color}` : 'none',
                    cursor: 'pointer',
                    padding: 0,
                    transform: isSelected ? 'scale(1.15)' : 'scale(1)',
                    transition: 'transform 0.15s ease, outline 0.15s ease',
                    flexShrink: 0
                  }}
                  title={`${label} 펜`}
                />
              );
            })}
          </div>

          <div style={{ width: '1px', height: '20px', background: 'rgba(255, 255, 255, 0.15)', margin: '0 2px', flexShrink: 0 }} />

          {/* 8. [↔ 폭맞춤] */}
          <button
            id="btn-fit-width"
            type="button"
            className={`student-tool-btn ${isFitWidth ? 'active' : ''}`}
            onClick={handleToggleZoomFit}
            style={{
              width: '36px',
              height: '34px',
              padding: 0,
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: isFitWidth ? 'rgba(59, 130, 246, 0.25)' : 'transparent',
              border: isFitWidth ? '1px solid rgba(59, 130, 246, 0.6)' : '1px solid transparent',
              color: isFitWidth ? '#60a5fa' : '#cbd5e1',
              flexShrink: 0
            }}
            title="화면 폭에 100% 맞춤 (아이패드/화면 폭 전체 채우기)"
          >
            <IconFitWidth size={18} />
          </button>
        </div>

        {canToolbarScrollRight && (
          <button
            id="btn-toolbar-scroll-right"
            type="button"
            className="toolbar-scroll-hint-btn right"
            onClick={() => scrollToolbarToRight(140)}
            title="도구 오른쪽으로 스크롤"
          >
            ▶
          </button>
        )}
      </div>
    )}

      {/* ====================================================================
          [숨김 메뉴 팝오버] ≡ 스케치: "나머지 모두 여기에 정리"
          수업명, 학생 정보/비번, 칠판 등록, 칠판 연결, 새로 쓰기, PDF 저장 등
          ==================================================================== */}
      {activePopup === 'menu' && (
        <div
          id="popup-student-menu"
          className="samsung-tool-popup"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: popupTop,
            left: '12px',
            zIndex: 1100,
            width: '340px',
            maxWidth: 'calc(100vw - 24px)',
            maxHeight: 'calc(100dvh - 80px)',
            overflowY: 'auto',
            background: 'rgba(20, 24, 33, 0.97)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.16)',
            borderRadius: '16px',
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.7)',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            color: '#ffffff'
          }}
        >
          {/* 헤더: 수업명 및 닫기 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '16px' }}>🏫</span>
                <span style={{ fontSize: '14px', fontWeight: 700, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {lessonTitle}
                </span>
              </div>
              <span style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>삼성노트 REA 디지털 스마트 필기</span>
                {lastSavedTimeStr && <span style={{ color: '#34d399', fontWeight: 600 }}>• 자동저장됨 ({lastSavedTimeStr})</span>}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActivePopup(null)}
              style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '16px', cursor: 'pointer', padding: '2px 4px' }}
            >
              ✕
            </button>
          </div>

          {/* 학생 프로필 배지 */}
          {studentInfo ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(59, 130, 246, 0.12)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '10px', padding: '8px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                <span>👨‍🎓</span>
                <span style={{ color: '#93c5fd' }}>
                  {studentInfo.grade}학년 {studentInfo.classNum}반 {studentInfo.studentNum}번
                </span>
                <span style={{ color: '#ffffff' }}>{studentInfo.name}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsChangingStudent(true);
                  setActivePopup(null);
                }}
                style={{
                  background: 'rgba(59, 130, 246, 0.25)',
                  border: 'none',
                  color: '#60a5fa',
                  borderRadius: '6px',
                  padding: '3px 8px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                수정
              </button>
            </div>
          ) : null}

          {/* 핵심 수업 액션 (등록하기 & 전자칠판 실시간 연결) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              id="menu-btn-submit-lesson"
              type="button"
              className="g-btn g-btn-primary"
              style={{
                width: '100%',
                padding: '10px 14px',
                fontSize: '13px',
                fontWeight: 700,
                background: hasSavedNote
                  ? 'linear-gradient(135deg, #059669 0%, #047857 100%)'
                  : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                border: hasSavedNote ? '1px solid #34d399' : 'none',
                boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)',
                cursor: 'pointer'
              }}
              disabled={isSubmitting}
              onClick={() => {
                handleSubmitLesson();
                setActivePopup(null);
              }}
            >
              {isSubmitting ? '칠판으로 전송 중...' : hasSavedNote ? '✅ 칠판 등록 완료 (다시 등록)' : '🚀 선생님 전자칠판에 등록하기'}
            </button>

            <button
              id="menu-btn-connect-board"
              type="button"
              style={{
                width: '100%',
                padding: '9px 12px',
                fontSize: '12.5px',
                fontWeight: 700,
                background: isConnectedToBoard
                  ? 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)'
                  : 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                color: '#ffffff',
                border: isConnectedToBoard ? '1px solid #4ade80' : '1px solid #60a5fa',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                cursor: 'pointer'
              }}
              onClick={() => {
                handleConnectToBoard();
                setActivePopup(null);
              }}
            >
              <span>{isConnectedToBoard ? '🟢' : '📡'}</span>
              <span>{isConnectedToBoard ? '전자칠판 연결됨 (전체화면 유지)' : '전자칠판 실시간 연결'}</span>
            </button>
          </div>

          <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)' }} />

          {/* 페이지 관리 & 모아보기 */}
          <div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '8px', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>📄 공책 페이지 관리</span>
              <span style={{ color: '#38bdf8' }}>총 {pages.length}쪽</span>
            </div>

            {/* 전체 페이지 모아보기 팝업 버튼 */}
            <button
              type="button"
              id="btn-open-page-overview"
              onClick={() => {
                setActivePopup(null);
                setIsPageOverviewOpen(true);
              }}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: '8px',
                fontSize: '12.5px',
                fontWeight: 600,
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.22) 0%, rgba(139, 92, 246, 0.22) 100%)',
                border: '1px solid rgba(139, 92, 246, 0.45)',
                color: '#c084fc',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '7px',
                cursor: 'pointer',
                marginBottom: '8px',
                boxShadow: '0 2px 8px rgba(139, 92, 246, 0.15)'
              }}
            >
              <span>🖼️</span>
              <span>전체 페이지 모아보기 및 빠른 이동 ({pages.length}쪽)</span>
            </button>

            {/* 이전/다음 쪽 이동 & 추가 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.04)', padding: '6px 10px', borderRadius: '8px' }}>
              <button
                type="button"
                className="student-tool-btn"
                disabled={currentPageIndex <= 0}
                onClick={() => handleGoToPage(currentPageIndex - 1)}
                style={{ padding: '4px 10px', fontSize: '12px' }}
              >
                ◀ 이전 쪽
              </button>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#38bdf8' }}>
                {currentPageIndex + 1} / {pages.length} 쪽
              </span>
              <button
                type="button"
                className="student-tool-btn"
                disabled={currentPageIndex >= pages.length - 1}
                onClick={() => handleGoToPage(currentPageIndex + 1)}
                style={{ padding: '4px 10px', fontSize: '12px' }}
              >
                다음 쪽 ▶
              </button>
              <button
                type="button"
                className="student-tool-btn"
                onClick={handleAddPage}
                style={{ padding: '4px 10px', fontSize: '12px', background: 'rgba(59, 130, 246, 0.25)', color: '#93c5fd', fontWeight: 600 }}
              >
                + 쪽 추가
              </button>
            </div>
          </div>

          <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)' }} />

          {/* 공책 파일 & 저장 관리 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>
              💾 공책 및 파일 관리
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <button
                type="button"
                className="student-tool-btn"
                onClick={() => {
                  handleExportStudentPdf();
                  setActivePopup(null);
                }}
                disabled={isExportingPdf}
                style={{ justifyContent: 'center', fontSize: '12px', padding: '8px 6px', background: 'rgba(59, 130, 246, 0.15)', color: '#93c5fd' }}
              >
                📥 PDF 다운로드
              </button>
              <button
                type="button"
                className="student-tool-btn"
                onClick={() => {
                  handleResetNotebookClean();
                  setActivePopup(null);
                }}
                style={{ justifyContent: 'center', fontSize: '12px', padding: '8px 6px', background: 'rgba(249, 115, 22, 0.12)', color: '#fdba74' }}
              >
                🔄 새로 쓰기
              </button>
              <button
                type="button"
                className="student-tool-btn"
                onClick={() => {
                  handleExportNotebookFile();
                  setActivePopup(null);
                }}
                style={{ justifyContent: 'center', fontSize: '12px', padding: '8px 6px' }}
              >
                💾 파일로 저장
              </button>
              <button
                type="button"
                className="student-tool-btn"
                onClick={() => {
                  notebookFileInputRef.current?.click();
                  setActivePopup(null);
                }}
                style={{ justifyContent: 'center', fontSize: '12px', padding: '8px 6px' }}
              >
                📂 파일 불러오기
              </button>
            </div>
            {lessonPdfInfo && (
              <button
                type="button"
                className="student-tool-btn"
                onClick={() => {
                  setIsLessonPdfPromptOpen(true);
                  setActivePopup(null);
                }}
                style={{
                  justifyContent: 'center',
                  fontSize: '12px',
                  padding: '8px',
                  background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(59, 130, 246, 0.25) 100%)',
                  color: '#a5b4fc',
                  fontWeight: 600
                }}
              >
                📑 선생님 수업 학습지 열기
              </button>
            )}
          </div>

          <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)' }} />

          {/* 환경 및 보기 설정 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>
              ⚙️ 환경 설정
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <button
                type="button"
                className="student-tool-btn"
                onClick={() => {
                  setIsQrScannerOpen(true);
                  setActivePopup(null);
                }}
                style={{ justifyContent: 'center', fontSize: '12px', padding: '7px 6px', background: 'rgba(168, 85, 247, 0.18)', color: '#d8b4fe' }}
              >
                📷 수업 QR 스캔
              </button>
              <button
                type="button"
                className="student-tool-btn"
                onClick={toggleFullscreen}
                style={{ justifyContent: 'center', fontSize: '12px', padding: '7px 6px' }}
              >
                {isFullscreen ? '⛶ 전체화면 종료' : '⛶ 전체화면'}
              </button>
              <button
                type="button"
                className="student-tool-btn"
                onClick={handleTogglePenTouchMode}
                style={{ justifyContent: 'center', fontSize: '12px', padding: '7px 6px', color: penOnlyMode ? '#93c5fd' : '#cbd5e1' }}
              >
                {penOnlyMode ? '✏️ 펜 전용 모드' : '🖐️ 터치 모드'}
              </button>
              <button
                type="button"
                className="student-tool-btn"
                disabled={undoStack.length === 0}
                onClick={handleUndo}
                style={{ justifyContent: 'center', fontSize: '12px', padding: '7px 6px', opacity: undoStack.length === 0 ? 0.35 : 1 }}
              >
                ↩️ 실행 취소
              </button>
              <button
                type="button"
                className="student-tool-btn"
                disabled={redoStack.length === 0}
                onClick={handleRedo}
                style={{ justifyContent: 'center', fontSize: '12px', padding: '7px 6px', opacity: redoStack.length === 0 ? 0.35 : 1 }}
              >
                ↪️ 다시 실행
              </button>
              <button
                type="button"
                className="student-tool-btn"
                onClick={() => {
                  setActivePopup('settings');
                }}
                style={{ justifyContent: 'center', fontSize: '11.5px', padding: '7px 6px', gridColumn: 'span 2' }}
              >
                ⚙️ 상세 설정
              </button>
            </div>
          </div>

          <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)' }} />

          {/* 수업 나가기 버튼 */}
          <button
            id="menu-btn-exit-lesson"
            type="button"
            className="student-tool-btn danger"
            onClick={() => {
              setActivePopup(null);
              handleExitLesson();
            }}
            style={{
              width: '100%',
              justifyContent: 'center',
              padding: '8px',
              fontSize: '12px',
              background: 'rgba(239, 68, 68, 0.1)',
              color: '#fca5a5',
              border: '1px solid rgba(239, 68, 68, 0.25)'
            }}
          >
            🚪 수업 나가기
          </button>
        </div>
      )}

      {/* 로컬스토리지 백업 복원 배너 (클린 플로팅 디자인) */}
      {recoveryPromptDraft && (
        <div
          id="banner-recovery-prompt"
          style={{
            position: 'absolute',
            top: '64px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1100,
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.98), rgba(15, 23, 42, 0.98))',
            border: '1px solid rgba(168, 85, 247, 0.6)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
            borderRadius: '12px',
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            backdropFilter: 'blur(8px)',
            maxWidth: 'calc(100vw - 20px)'
          }}
        >
          <div style={{ fontSize: '12.5px', color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>💡</span>
            <span>이전에 작성하던 필기(총 {recoveryPromptDraft.pages?.length || 1}쪽)가 보관되어 있습니다.</span>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
            <button
              id="btn-confirm-recovery"
              type="button"
              onClick={() => {
                applyLoadedPages(recoveryPromptDraft.pages, recoveryPromptDraft.currentPageIndex ?? 0, recoveryPromptDraft.orientation);
                setRecoveryPromptDraft(null);
                showToast('📂 이전 필기 내용을 불러왔습니다.');
              }}
              style={{
                background: '#8b5cf6',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '5px 12px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              필기 이어하기
            </button>
            <button
              id="btn-dismiss-recovery"
              type="button"
              onClick={() => {
                setRecoveryPromptDraft(null);
                showToast('✨ 새 A4 공책으로 시작합니다.');
              }}
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                color: '#94a3b8',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '6px',
                padding: '5px 9px',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              새로 시작
            </button>
          </div>
        </div>
      )}

      {/* ====================================================================
          플로팅 툴 팝오버 (툴바 바깥 렌더링으로 클리핑 방지)
          ==================================================================== */}
        {activePopup === 'pen' && (
          <div
            id="popup-pen-settings"
            className="samsung-tool-popup"
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'absolute', top: popupTop, left: '8px', zIndex: 1000, width: '280px', maxWidth: 'calc(100vw - 16px)' }}
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
            style={{ position: 'absolute', top: popupTop, left: '40px', zIndex: 1000, width: '280px', maxWidth: 'calc(100vw - 16px)' }}
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
            style={{ position: 'absolute', top: popupTop, left: '70px', zIndex: 1000, width: '275px', maxWidth: 'calc(100vw - 16px)' }}
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
            [팝오버 5] 🖼️ 학습지 / PDF 관리 팝오버
            ==================================================================== */}
        {activePopup === 'image' && (
          <div
            id="popup-image-settings"
            className="samsung-tool-popup"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: popupTop,
              left: '120px',
              zIndex: 1000,
              width: '290px',
              maxWidth: 'calc(100vw - 24px)',
              maxHeight: 'calc(100dvh - 160px)',
              overflowY: 'auto',
              background: '#1a1d24',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '12px',
              boxShadow: '0 12px 36px rgba(0, 0, 0, 0.7)',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#ffffff' }}>🖼️ 학습지 / PDF 도구</span>
              <button
                type="button"
                onClick={() => setActivePopup(null)}
                style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '14px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8', lineHeight: 1.4 }}>
              PDF나 문제 이미지를 불러와 전체 배경으로 넣거나, 원하는 문제만 잘라서 배치하고 그 위에 필기하세요.
            </p>

            {/* 선생님 공유 학습지 바로가기 */}
            {lessonPdfInfo && (
              <button
                type="button"
                className="student-tool-btn"
                onClick={() => {
                  setIsLessonPdfPromptOpen(true);
                  setActivePopup(null);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  fontSize: '12.5px',
                  padding: '8px 12px',
                  background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(59, 130, 246, 0.25) 100%)',
                  color: '#a5b4fc',
                  border: '1px solid rgba(129, 140, 248, 0.45)',
                  fontWeight: 700
                }}
              >
                <span>📑</span> 선생님 수업 학습지 열기
              </button>
            )}

            {/* 이미 로드된 PDF가 있으면 즉시 목록 다시 열기 */}
            {pdfDocProxy && (
              <button
                type="button"
                className="student-tool-btn"
                onClick={() => {
                  setPdfPickerOpen(true);
                  setActivePopup(null);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  fontSize: '12.5px',
                  padding: '8px 12px',
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  fontWeight: 700
                }}
              >
                <span>🔍</span> 현재 PDF 페이지 목록 보기 ({pdfTotalPages}쪽)
              </button>
            )}

            <button
              id="btn-load-image-pdf"
              type="button"
              className="g-btn g-btn-primary"
              onClick={() => {
                imagePdfInputRef.current?.click();
                setActivePopup(null);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                fontSize: '12.5px',
                padding: '8px 12px'
              }}
            >
              <span>📂</span> 새 PDF / 이미지 파일 열기
            </button>

            <button
              id="btn-load-sample-problem"
              type="button"
              className="student-tool-btn"
              onClick={handleLoadSampleProblem}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                fontSize: '12px',
                padding: '7px 12px',
                background: 'rgba(59, 130, 246, 0.15)',
                color: '#93c5fd',
                border: '1px solid rgba(59, 130, 246, 0.35)',
                fontWeight: 600
              }}
              title="테스트용 샘플 수학 문제지 즉시 불러오기"
            >
              <span>🧪</span> 샘플 수학 문제지 불러오기 (단일)
            </button>

            <button
              id="btn-load-sample-pdf"
              type="button"
              className="student-tool-btn"
              onClick={handleLoadSamplePdf}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                fontSize: '12px',
                padding: '7px 12px',
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(59, 130, 246, 0.2) 100%)',
                color: '#60a5fa',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                fontWeight: 700
              }}
              title="20쪽 분량의 샘플 PDF 학습지를 즉시 열어 페이지 선택 및 자르기 테스트"
            >
              <span>📑</span> 20쪽 PDF 학습지 열기 (시뮬레이션/테스트)
            </button>

            {fullPageBackground && (
              <button
                type="button"
                className="student-tool-btn danger"
                onClick={() => {
                  setFullPageBackground(null);
                  showToast('🗑️ 현재 쪽의 배경이 제거되었습니다.');
                }}
                style={{
                  fontSize: '11.5px',
                  padding: '7px 10px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#fca5a5',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  justifyContent: 'center'
                }}
              >
                ✕ 현재 쪽 배경 제거
              </button>
            )}

            {embeddedImages.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>
                  배치된 문제 이미지 ({embeddedImages.length}개)
                </div>
                <button
                  type="button"
                  className="student-tool-btn"
                  onClick={() => {
                    setEmbeddedImages([]);
                    setSelectedImageId(null);
                    showToast('🗑️ 모든 이미지가 삭제되었습니다.');
                  }}
                  style={{
                    fontSize: '11.5px',
                    padding: '6px 10px',
                    background: 'rgba(239, 68, 68, 0.12)',
                    color: '#f87171',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    justifyContent: 'center'
                  }}
                >
                  🗑️ 모든 문제 이미지 지우기
                </button>
              </div>
            )}

            <button
              type="button"
              className="student-tool-btn"
              onClick={() => {
                setTool('pen');
                setActivePopup(null);
                setSelectedImageId(null);
              }}
              style={{
                fontSize: '11.5px',
                padding: '7px 10px',
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                justifyContent: 'center',
                fontWeight: 600
              }}
            >
              ✓ 펜 필기 모드로 전환
            </button>
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
            style={{
              position: 'absolute',
              top: popupTop,
              right: '8px',
              zIndex: 1000,
              width: '290px',
              maxWidth: 'calc(100vw - 16px)',
              maxHeight: 'calc(100dvh - 160px)',
              overflowY: 'auto'
            }}
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

            {/* 툴바 표시 형태 (아이패드 세로 맞춤) */}
            <div>
              <div style={{ fontSize: '11px', color: 'var(--g-text-secondary)', marginBottom: '5px', fontWeight: 600 }}>
                📱 툴바 배열 (아이패드 세로 맞춤)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px' }}>
                <button
                  type="button"
                  className={`student-tool-btn ${toolbarLayoutPref === 'auto' ? 'active' : ''}`}
                  onClick={() => {
                    setToolbarLayoutPref('auto');
                    try { localStorage.setItem('lbw_toolbar_layout_pref', 'auto'); } catch {}
                    showToast('🔄 툴바 자동 맞춤 (세로 2줄, 가로 1줄)');
                  }}
                  style={{ justifyContent: 'center', fontSize: '11px', padding: '5px 2px' }}
                  title="세로 화면에서는 2줄, 가로 화면에서는 1줄로 자동 전환"
                >
                  🔄 자동
                </button>
                <button
                  type="button"
                  className={`student-tool-btn ${toolbarLayoutPref === 'double' ? 'active' : ''}`}
                  onClick={() => {
                    setToolbarLayoutPref('double');
                    try { localStorage.setItem('lbw_toolbar_layout_pref', 'double'); } catch {}
                    showToast('↕️ 툴바 2줄 모드 고정');
                  }}
                  style={{ justifyContent: 'center', fontSize: '11px', padding: '5px 2px' }}
                  title="모든 도구를 한눈에 볼 수 있도록 2줄로 표시"
                >
                  ↕️ 2줄 보기
                </button>
                <button
                  type="button"
                  className={`student-tool-btn ${toolbarLayoutPref === 'single' ? 'active' : ''}`}
                  onClick={() => {
                    setToolbarLayoutPref('single');
                    try { localStorage.setItem('lbw_toolbar_layout_pref', 'single'); } catch {}
                    showToast('↔️ 툴바 1줄 모드 고정 (가로 스크롤 가능)');
                  }}
                  style={{ justifyContent: 'center', fontSize: '11px', padding: '5px 2px' }}
                  title="1줄 컴팩트 모드 (넘치는 도구는 가로 스크롤)"
                >
                  ↔️ 1줄 보기
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

            <div style={{ height: '1px', background: 'var(--g-border-subtle)' }} />

            {/* 필기 보관 & 복원 관리 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ fontSize: '11px', color: 'var(--g-text-secondary)', fontWeight: 600 }}>
                📑 공책 및 필기 파일 관리 (PDF 및 편집 파일)
              </div>

              {/* 1. PDF 저장 (인쇄/제출용 고화질 문서) */}
              <button
                id="btn-settings-export-pdf"
                type="button"
                className="student-tool-btn"
                onClick={handleExportStudentPdf}
                disabled={isExportingPdf}
                style={{
                  justifyContent: 'flex-start',
                  fontSize: '11.5px',
                  padding: '7px 10px',
                  background: 'rgba(59, 130, 246, 0.18)',
                  color: '#93c5fd',
                  border: '1px solid rgba(59, 130, 246, 0.4)',
                  fontWeight: 600
                }}
                title="모든 쪽의 필기를 고화질 인쇄/제출용 A4 PDF로 다운로드합니다."
              >
                <span>📄</span>
                <span>{isExportingPdf ? 'PDF 생성 중...' : 'PDF 문서로 기기에 저장 (인쇄/제출용)'}</span>
              </button>

              {/* 2. 편집 파일로 내보내기 (.lbwnote) */}
              <button
                id="btn-settings-export-note-file"
                type="button"
                className="student-tool-btn"
                onClick={handleExportNotebookFile}
                style={{
                  justifyContent: 'flex-start',
                  fontSize: '11.5px',
                  padding: '7px 10px',
                  background: 'rgba(16, 185, 129, 0.18)',
                  color: '#6ee7b7',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  fontWeight: 600
                }}
                title="언제든 다시 불러와 필기를 이어쓸 수 있는 전용 파일(.lbwnote)로 저장합니다."
              >
                <span>💾</span>
                <span>필기 파일로 저장 (.lbwnote 편집 가능)</span>
              </button>

              {/* 3. 편집 파일 불러오기 (.lbwnote / .json) */}
              <button
                id="btn-settings-import-note-file"
                type="button"
                className="student-tool-btn"
                onClick={() => {
                  notebookFileInputRef.current?.click();
                }}
                style={{
                  justifyContent: 'flex-start',
                  fontSize: '11.5px',
                  padding: '7px 10px',
                  background: 'rgba(234, 179, 8, 0.15)',
                  color: '#fde047',
                  border: '1px solid rgba(234, 179, 8, 0.35)',
                  fontWeight: 600
                }}
                title="저장해둔 .lbwnote 필기 파일을 열어 그대로 편집을 이어갑니다."
              >
                <span>📂</span>
                <span>내 기기에서 필기 파일 불러오기 (.lbwnote)</span>
              </button>

              {/* 4. 새 A4 공책으로 시작 */}
              <button
                id="btn-settings-start-fresh"
                type="button"
                className="student-tool-btn"
                onClick={handleStartFreshNotebook}
                style={{
                  justifyContent: 'flex-start',
                  fontSize: '11.5px',
                  padding: '7px 10px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  color: '#e2e8f0',
                  border: '1px solid rgba(255, 255, 255, 0.12)'
                }}
              >
                <span>✨</span>
                <span>새 A4 공책으로 시작 (초기화)</span>
              </button>

              {/* 5. 자동 저장된 이전 필기 복원 (기존 캐시) */}
              {hasSavedNote && (
                <button
                  type="button"
                  className="student-tool-btn"
                  onClick={handleRestoreSavedNote}
                  style={{
                    justifyContent: 'flex-start',
                    fontSize: '11.5px',
                    padding: '7px 10px',
                    background: 'rgba(168, 85, 247, 0.15)',
                    color: '#d8b4fe',
                    border: '1px solid rgba(168, 85, 247, 0.35)',
                    fontWeight: 600
                  }}
                  title="이전에 기기에 자동 저장되었던 필기를 복원합니다."
                >
                  <span>🔄</span>
                  <span>최근 자동 저장된 필기 복원</span>
                </button>
              )}
            </div>
          </div>
        )}

      {/* 3. 메인 작업 영역: A4 종이 시트 & 줌/스크롤 뷰포트 (단일 페이지 집중 모드) */}
      <main
        ref={containerRef}
        className="student-canvas-wrapper"
        onWheel={handleWheel}
        onPointerDown={() => {
          if (activePopup) setActivePopup(null);
          requestFullscreenSafe();
        }}
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
            boxShadow: '0 12px 48px rgba(0, 0, 0, 0.75), 0 0 0 1.5px rgba(255, 255, 255, 0.18)',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            borderRadius: '8px',
            background: '#131314',
            overflow: 'hidden',
            touchAction: 'none',
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
            userSelect: 'none'
          }}
        >
          {/* Layer 0: A4 전체 배경 (PDF 또는 이미지) */}
          {fullPageBackground && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                zIndex: 1,
                pointerEvents: 'none',
                overflow: 'hidden'
              }}
            >
              <img
                src={fullPageBackground}
                alt="Worksheet Background"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'fill',
                  display: 'block'
                }}
              />
            </div>
          )}

          {/* 배경 제거 퀵 버튼 */}
          {fullPageBackground && (
            <button
              type="button"
              onClick={() => {
                setFullPageBackground(null);
                showToast('🗑️ 현재 쪽의 배경이 제거되었습니다.');
              }}
              style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                zIndex: 15,
                background: 'rgba(0, 0, 0, 0.75)',
                color: '#cbd5e1',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                borderRadius: '6px',
                padding: '3px 8px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
              title="배경 PDF/이미지 제거"
            >
              <span>✕</span> 배경 제거
            </button>
          )}

          {/* Layer 1: 임베드된 잘라낸 문제/이미지 스티커 레이어 */}
          <EmbeddedImageLayer
            images={embeddedImages}
            selectedImageId={selectedImageId}
            onSelectImage={setSelectedImageId}
            onUpdateImage={handleUpdateEmbeddedImage}
            onDeleteImage={handleDeleteEmbeddedImage}
            onEditCrop={handleEditCrop}
            isDrawingToolActive={tool === 'pen' || tool === 'highlighter' || tool === 'eraser'}
            A4_WIDTH={A4_WIDTH}
            A4_HEIGHT={A4_HEIGHT}
          />

          {/* Layer 2: 최우선 독립 필기 캔버스 엔진 */}
          <DrawingCanvas
            strokes={strokes}
            onStrokeComplete={handleStrokeComplete}
            onStrokesChange={handleStrokesChange}
            onUndoSnapshot={handleUndoSnapshot}
            tool={tool}
            penColor={penColor}
            penSize={penSize}
            highlighterColor={highlighterColor}
            highlighterSize={highlighterSize}
            eraserSize={eraserSize}
            eraserMode={eraserMode}
            penOnlyMode={penOnlyMode}
            onAutoPenModeDetected={() => {
              if (!penOnlyMode) {
                setPenOnlyMode(true);
                try { localStorage.setItem('lbw_pen_mode', 'true'); } catch {}
              }
            }}
            onTogglePenEraser={handleTogglePenEraser}
            fullPageBackground={fullPageBackground}
            A4_WIDTH={A4_WIDTH}
            A4_HEIGHT={A4_HEIGHT}
            selectedImageId={selectedImageId}
            onFingerPanMove={handleFingerPanMove}
            onCanvasPointerDown={() => {
              if (activePopup) setActivePopup(null);
            }}
            paperTheme={paperTheme}
          />

          {/* Layer 3: [모듈 플러그인] 올가미 집중 풀이 캔버스 오버레이 레이어 */}
          {defaultLassoFocusConfig.enabled && tool === 'lasso' && (
            <LassoFocusCanvasOverlay
              isActive={tool === 'lasso'}
              A4_WIDTH={A4_WIDTH}
              A4_HEIGHT={A4_HEIGHT}
              onConfirmLasso={handleConfirmLassoFocus}
              onCancel={() => setTool('pen')}
              isProcessing={isLassoProcessing}
            />
          )}

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

      {/* 4. 전체 페이지 모아보기 그리드 모달 (PageOverviewModal) */}
      <PageOverviewModal
        isOpen={isPageOverviewOpen}
        pages={pages.map((p, idx) => {
          if (idx === currentPageIndex) {
            return {
              ...p,
              strokes,
              textItems,
              fullPageBackground,
              images: embeddedImages
            };
          }
          return p;
        })}
        currentPageIndex={currentPageIndex}
        onSelectPage={(index) => handleGoToPage(index)}
        onAddPage={handleAddPage}
        onDeletePage={handleDeletePage}
        onClose={() => setIsPageOverviewOpen(false)}
      />

            {/* 4-0. 시작 시 학생 확인 & 전체화면 진입 팝업 (ModularModal: Portal + 태블릿 터치 스크롤 엔진 내장) */}
      <ModularModal
        isOpen={Boolean(isConfirmStudentOpen && studentInfo)}
        maxWidth="440px"
        zIndex={10001}
        showCloseButton={false}
      >
        {studentInfo && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', color: '#ffffff' }}>
            {/* 학교/수업 아이콘 */}
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '16px',
                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.25) 0%, rgba(99, 102, 241, 0.25) 100%)',
                border: '1px solid rgba(96, 165, 250, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '28px',
                marginBottom: '14px'
              }}
            >
              🏫
            </div>

            <span style={{ fontSize: '13px', color: '#93c5fd', fontWeight: 600, letterSpacing: '0.5px' }}>
              디지털 스마트 노트 수업 참여
            </span>
            <h2 style={{ fontSize: '19px', fontWeight: 800, margin: '4px 0 18px 0', color: '#ffffff' }}>
              {lessonTitle}
            </h2>

            {/* 학생 신원 확인 카드 */}
            <div
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '14px',
                padding: '14px 16px',
                marginBottom: '20px',
                boxSizing: 'border-box'
              }}
            >
              <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>참여 학생 확인</div>
              <div style={{ fontSize: '17px', fontWeight: 700, color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span style={{ color: '#60a5fa' }}>{studentInfo.grade}학년 {studentInfo.classNum}반 {studentInfo.studentNum}번</span>
                <span>{studentInfo.name}</span>
              </div>
              <div style={{ fontSize: '11.5px', color: '#34d399', marginTop: '6px' }}>
                ✓ 본인 정보가 맞으면 아래 버튼을 눌러 전체화면으로 시작하세요.
              </div>
            </div>

            {/* 전체화면으로 수업 시작하기 */}
            <button
              id="btn-confirm-start-lesson-fullscreen"
              type="button"
              className="g-btn g-btn-primary"
              onClick={() => {
                requestFullscreenSafe();
                setIsConfirmStudentOpen(false);
                showToast(`👋 ${studentInfo.name} 학생, 수업에 오신 것을 환영합니다! (전체화면)`);
              }}
              style={{
                width: '100%',
                padding: '13px 20px',
                fontSize: '15px',
                fontWeight: 800,
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                color: '#ffffff',
                border: '1px solid #60a5fa',
                boxShadow: '0 6px 20px rgba(37, 99, 235, 0.45)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                marginBottom: '10px'
              }}
            >
              <span>⛶</span>
              <span>전체화면으로 수업 시작하기</span>
            </button>

            {/* 다른 학생으로 로그인 또는 변경 */}
            <button
              type="button"
              onClick={() => {
                setIsConfirmStudentOpen(false);
                setIsChangingStudent(true);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                fontSize: '12.5px',
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: '6px'
              }}
            >
              내 정보가 아니거나 다른 학생으로 변경하기
            </button>
          </div>
        )}
      </ModularModal>

{/* 4. 학생 계정 로그인 & 비밀번호 관리 모달 (ModularModal: Portal + 태블릿 터치 스크롤 엔진 내장) */}
      <ModularModal
        isOpen={isChangingStudent}
        onClose={studentInfo ? () => { setIsChangingStudent(false); setAuthErrorMsg(null); } : undefined}
        title={studentInfo ? '👨‍🎓 학생 계정 & 비밀번호 관리' : '👨‍🎓 학생 수업 참여 로그인'}
        subtitle={studentInfo ? '비밀번호를 변경하거나 다른 학생으로 전환합니다' : '4자리 학번(1101~3830)과 비밀번호로 로그인하세요'}
        maxWidth="460px"
        zIndex={10001}
        showCloseButton={Boolean(studentInfo)}
      >

            {authErrorMsg && (
              <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#fca5a5', padding: '10px 14px', borderRadius: '10px', fontSize: '12.5px', marginBottom: '14px', lineHeight: 1.5 }}>
                {authErrorMsg}
              </div>
            )}

            {!studentInfo ? (
              // 1. 처음 수업 진입 시: 학번 + 비밀번호 로그인 폼
              <form onSubmit={handleStudentAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                    <label style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 600 }}>학번 (4자리 숫자)</label>
                    {parseStudentId(authStudentId).valid && (
                      <span style={{ fontSize: '11px', color: '#86efac', fontWeight: 600 }}>
                        ✓ {parseStudentId(authStudentId).label}
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    maxLength={4}
                    value={authStudentId}
                    onChange={(e) => setAuthStudentId(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="예: 1101, 2315, 3830"
                    style={{
                      width: '100%',
                      padding: '11px 14px',
                      borderRadius: '10px',
                      border: parseStudentId(authStudentId).valid ? '1px solid #22c55e' : '1px solid rgba(255, 255, 255, 0.15)',
                      background: 'rgba(15, 23, 42, 0.6)',
                      color: '#ffffff',
                      fontSize: '14px',
                      fontWeight: 600,
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                    autoFocus
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '5px', fontWeight: 600 }}>학생 이름</label>
                  <input
                    type="text"
                    value={authStudentName}
                    onChange={(e) => setAuthStudentName(e.target.value)}
                    placeholder="예: 홍길동"
                    style={{
                      width: '100%',
                      padding: '11px 14px',
                      borderRadius: '10px',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      background: 'rgba(15, 23, 42, 0.6)',
                      color: '#ffffff',
                      fontSize: '14px',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '5px', fontWeight: 600 }}>비밀번호</label>
                  <input
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="비밀번호 입력"
                    style={{
                      width: '100%',
                      padding: '11px 14px',
                      borderRadius: '10px',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      background: 'rgba(15, 23, 42, 0.6)',
                      color: '#ffffff',
                      fontSize: '14px',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                    required
                  />
                </div>

                {/* 로그인 시 비밀번호 동시 변경 토글 */}
                <div style={{ borderTop: '1px dashed rgba(255,255,255,0.1)', paddingTop: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setIsChangingPwMode(!isChangingPwMode)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#60a5fa',
                      fontSize: '12px',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <span>{isChangingPwMode ? '▲ 비밀번호 변경 취소' : '🔑 비밀번호 지금 변경하기'}</span>
                  </button>

                  {isChangingPwMode && (
                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <input
                        type="password"
                        value={authNewPassword}
                        onChange={(e) => setAuthNewPassword(e.target.value)}
                        placeholder="새 비밀번호 입력 (4자리 이상)"
                        style={{
                          width: '100%',
                          padding: '10px 14px',
                          borderRadius: '8px',
                          border: '1px solid rgba(96, 165, 250, 0.4)',
                          background: 'rgba(15, 23, 42, 0.8)',
                          color: '#ffffff',
                          fontSize: '13px',
                          outline: 'none',
                          boxSizing: 'border-box'
                        }}
                      />
                      <input
                        type="password"
                        value={authConfirmPassword}
                        onChange={(e) => setAuthConfirmPassword(e.target.value)}
                        placeholder="새 비밀번호 확인"
                        style={{
                          width: '100%',
                          padding: '10px 14px',
                          borderRadius: '8px',
                          border: '1px solid rgba(96, 165, 250, 0.4)',
                          background: 'rgba(15, 23, 42, 0.8)',
                          color: '#ffffff',
                          fontSize: '13px',
                          outline: 'none',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>
                  )}
                </div>

                <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', padding: '10px 12px', borderRadius: '10px', fontSize: '11.5px', color: '#93c5fd', lineHeight: 1.5 }}>
                  💡 <strong>비밀번호 안내:</strong> 초기 비밀번호는 <code>1234</code>입니다. 분실한 경우 관리자 선생님께 1234 초기화를 요청하세요.
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                  {onExit && (
                    <button type="button" className="g-btn g-btn-text" onClick={onExit} style={{ color: '#94a3b8' }}>
                      수업 나가기
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={isAuthSubmitting}
                    style={{
                      padding: '11px 20px',
                      borderRadius: '10px',
                      border: 'none',
                      background: isAuthSubmitting ? '#475569' : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      color: '#ffffff',
                      fontSize: '13.5px',
                      fontWeight: 700,
                      cursor: isAuthSubmitting ? 'not-allowed' : 'pointer',
                      boxShadow: '0 4px 12px rgba(16, 185, 129, 0.35)'
                    }}
                  >
                    {isAuthSubmitting ? '확인 중...' : '👨‍🎓 수업 시작하기'}
                  </button>
                </div>
              </form>
            ) : (
              // 2. 이미 로그인된 상태에서 이름 수정, 비밀번호 변경 및 로그아웃 관리 폼
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* 현재 로그인된 학생 정보 카드 */}
                <div style={{ background: 'rgba(59, 130, 246, 0.08)', padding: '14px 16px', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.25)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11.5px', color: '#93c5fd', fontWeight: 600 }}>현재 로그인 계정</span>
                    <span style={{ fontSize: '11px', color: '#60a5fa', background: 'rgba(59,130,246,0.2)', padding: '2px 8px', borderRadius: '6px' }}>
                      학번 {studentInfo.grade}{studentInfo.classNum}{parseInt(studentInfo.studentNum, 10) < 10 ? '0' + studentInfo.studentNum : studentInfo.studentNum}
                    </span>
                  </div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#ffffff', marginTop: '6px' }}>
                    👨‍🎓 {studentInfo.grade}학년 {studentInfo.classNum}반 {studentInfo.studentNum}번 <span style={{ color: '#38bdf8' }}>{studentInfo.name}</span>
                  </div>
                </div>

                {/* 1. 학생 이름 수정 폼 */}
                <form
                  onSubmit={handleStudentUpdateNameOnly}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    padding: '14px',
                    borderRadius: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.08)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: '13px', fontWeight: 700, margin: 0, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>✏️</span> 학생 이름 수정
                    </h3>
                    <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>1회 저장 시 자동 기억</span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      value={editStudentNameInput}
                      onChange={(e) => setEditStudentNameInput(e.target.value)}
                      placeholder="수정할 학생 이름 입력"
                      style={{
                        flex: 1,
                        padding: '9px 12px',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        background: 'rgba(15, 23, 42, 0.7)',
                        color: '#ffffff',
                        fontSize: '13px',
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                      required
                    />
                    <button
                      type="submit"
                      style={{
                        padding: '9px 14px',
                        borderRadius: '8px',
                        border: 'none',
                        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                        color: '#ffffff',
                        fontSize: '12.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)'
                      }}
                    >
                      💾 이름 저장
                    </button>
                  </div>
                </form>

                {/* 2. 비밀번호 변경 폼 */}
                <form
                  onSubmit={handleStudentChangePasswordOnly}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    padding: '14px',
                    borderRadius: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.08)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: '13px', fontWeight: 700, margin: 0, color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>🔑</span> 내 비밀번호 변경하기
                    </h3>
                    <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>초기: 1234</span>
                  </div>

                  <div>
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="현재 비밀번호 입력"
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        background: 'rgba(15, 23, 42, 0.6)',
                        color: '#ffffff',
                        fontSize: '13px',
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                      required
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <input
                      type="password"
                      value={authNewPassword}
                      onChange={(e) => setAuthNewPassword(e.target.value)}
                      placeholder="새 비밀번호 (4자리+)"
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        background: 'rgba(15, 23, 42, 0.6)',
                        color: '#ffffff',
                        fontSize: '13px',
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                      required
                    />
                    <input
                      type="password"
                      value={authConfirmPassword}
                      onChange={(e) => setAuthConfirmPassword(e.target.value)}
                      placeholder="새 비밀번호 확인"
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        background: 'rgba(15, 23, 42, 0.6)',
                        color: '#ffffff',
                        fontSize: '13px',
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isAuthSubmitting}
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      border: 'none',
                      background: isAuthSubmitting ? '#475569' : 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                      color: '#ffffff',
                      fontSize: '12.5px',
                      fontWeight: 700,
                      cursor: isAuthSubmitting ? 'not-allowed' : 'pointer',
                      marginTop: '2px'
                    }}
                  >
                    {isAuthSubmitting ? '변경 저장 중...' : '🔑 새 비밀번호 저장'}
                  </button>
                </form>

                {/* 3. 하단 로그아웃 및 닫기 버튼 */}
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await confirm({
                        title: '학생 로그아웃',
                        message: '현재 학생 로그아웃 후 로그인 화면으로 돌아가시겠습니까?',
                        confirmText: '로그아웃',
                        isDanger: true
                      });
                      if (ok) {
                        localStorage.removeItem('lbw_student_info');
                        setStudentInfo(null);
                        setAuthStudentId('');
                        setAuthStudentName('');
                        setAuthPassword('');
                        setAuthNewPassword('');
                        setAuthConfirmPassword('');
                        setIsChangingStudent(false);
                        if (onExit) {
                          onExit();
                        } else {
                          showToast('로그아웃되었습니다. 새 학생 계정으로 로그인하세요.');
                        }
                      }
                    }}
                    style={{
                      background: 'transparent',
                      border: '1px solid #ef4444',
                      color: '#f87171',
                      padding: '7px 12px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    🚪 로그아웃 / 계정 전환
                  </button>

                  <button
                    type="button"
                    className="g-btn g-btn-text"
                    onClick={() => {
                      setIsChangingStudent(false);
                      setAuthErrorMsg(null);
                    }}
                    style={{ color: '#cbd5e1' }}
                  >
                    닫기
                  </button>
                </div>
              </div>
            )}
      </ModularModal>

      {/* 하단 토스트 메시지 */}
      {toastMsg && (
        <div className="toast-container" style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', zIndex: 9999 }}>
          <span>🔔</span>
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 5. PDF 페이지 선택 모달 (0.01초 무지연 인덱스 카드, 온디맨드 미리보기, 다중/범위 선택) */}
      <PdfPagePickerModal
        isOpen={pdfPickerOpen}
        fileName={pdfFileName}
        pdfDocProxy={pdfDocProxy}
        totalPages={pdfTotalPages}
        thumbnails={pdfThumbnails}
        isLoading={isPdfLoading}
        fileObject={currentPdfFileRef.current}
        downloadUrl={lessonPdfInfo ? `https://drive.google.com/uc?export=download&id=${lessonPdfInfo.id}` : null}
        onSelectPage={handleSelectPdfPage}
        onBatchInsertPages={handleBatchInsertPdfPages}
        onClose={() => setPdfPickerOpen(false)}
      />

      {/* 5-1. 선생님 수업 학습지 안내 & 분산 다운로드 / 일괄 생성 모달 (ModularModal) */}
      <ModularModal
        isOpen={Boolean(isLessonPdfPromptOpen && lessonPdfInfo)}
        onClose={() => setIsLessonPdfPromptOpen(false)}
        maxWidth="520px"
        zIndex={10000}
        showCloseButton={true}
      >
        {lessonPdfInfo && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div
                style={{
                  width: '46px',
                  height: '46px',
                  borderRadius: '12px',
                  background: 'rgba(99, 102, 241, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '24px'
                }}
              >
                📑
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  수업 학습지 불러오기
                </h3>
                <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {lessonPdfInfo.name}
                </p>
              </div>
            </div>

            <div
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                padding: '14px',
                marginBottom: '18px',
                fontSize: '12.5px',
                color: '#cbd5e1',
                lineHeight: 1.6
              }}
            >
              <div style={{ fontWeight: 700, color: '#93c5fd', marginBottom: '4px' }}>
                💡 구글 드라이브 동시 접속 분산 다운로드 안내
              </div>
              <div>
                선생님이 개설한 수업의 PDF 학습지입니다. 기기에 원본 PDF를 직접 저장하거나, 공책의 <strong>맨 앞쪽에 배경 페이지</strong>로 일괄 생성하여 바로 필기할 수 있습니다.
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* 옵션 1: 공책 배경으로 일괄 생성 */}
              <button
                type="button"
                disabled={isDownloadingLessonPdf}
                onClick={() => handleLoadLessonPdfFromDrive('batch_insert')}
                style={{
                  padding: '12px 16px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                  color: '#ffffff',
                  border: '1px solid #3b82f6',
                  fontSize: '13.5px',
                  fontWeight: 700,
                  cursor: isDownloadingLessonPdf ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  boxShadow: '0 4px 14px rgba(37, 99, 235, 0.35)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '18px' }}>📑</span>
                  <div style={{ textAlign: 'left' }}>
                    <div>공책 배경으로 전체 생성 (추천)</div>
                    <div style={{ fontSize: '11px', opacity: 0.8, fontWeight: 400 }}>모든 페이지를 공책 맨 앞쪽에 배경으로 넣고 필기 시작</div>
                  </div>
                </div>
                <span>➔</span>
              </button>

              {/* 옵션 2: 페이지 골라서 넣기 */}
              <button
                type="button"
                disabled={isDownloadingLessonPdf}
                onClick={() => handleLoadLessonPdfFromDrive('open_picker')}
                style={{
                  padding: '12px 16px',
                  borderRadius: '10px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  color: '#e2e8f0',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  fontSize: '13.5px',
                  fontWeight: 700,
                  cursor: isDownloadingLessonPdf ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '18px' }}>🔍</span>
                  <div style={{ textAlign: 'left' }}>
                    <div>원하는 쪽 골라서 넣기 (페이지 선택기)</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 400 }}>미리보기, 범위 지정(예: 1~3쪽), 문제 영역 잘라내기</div>
                  </div>
                </div>
                <span>➔</span>
              </button>

              {/* 옵션 3: 원본 PDF 파일 다운로드 */}
              <button
                type="button"
                disabled={isDownloadingLessonPdf}
                onClick={() => handleLoadLessonPdfFromDrive('direct_download')}
                style={{
                  padding: '11px 16px',
                  borderRadius: '10px',
                  background: 'rgba(59, 130, 246, 0.12)',
                  color: '#93c5fd',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: isDownloadingLessonPdf ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '17px' }}>📥</span>
                  <div style={{ textAlign: 'left' }}>
                    <div>PDF 원본 파일 기기 저장</div>
                    <div style={{ fontSize: '11px', opacity: 0.8, fontWeight: 400 }}>구글 드라이브에서 직접 분산 다운로드</div>
                  </div>
                </div>
                <span>💾</span>
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '18px' }}>
              <button
                type="button"
                className="g-btn g-btn-text"
                onClick={() => setIsLessonPdfPromptOpen(false)}
                style={{ fontSize: '12.5px', color: '#94a3b8' }}
              >
                닫기
              </button>
            </div>
          </div>
        )}
      </ModularModal>

      {/* 5-2. 카메라 기반 전자칠판 QR코드 스캐너 모달 */}
      <QrScannerModal
        isOpen={isQrScannerOpen}
        onClose={() => setIsQrScannerOpen(false)}
        onScanSuccess={handleScannedResult}
      />

      {/* 5-3. 전체화면을 파괴하지 않는 모듈화 인앱 확인 다이얼로그 (AppConfirmModal) */}
      {confirmModalElement}

      {/* 6. 이미지/문제 영역 자르기(Crop) 모달 */}
      <ImageCropModal
        isOpen={cropModalOpen}
        imageSrc={cropTargetImageSrc}
        initialCrop={editingImageItem?.crop}
        onConfirmCrop={handleConfirmCrop}
        onSetAsBackground={handleSetImageAsBackground}
        onClose={() => {
          setCropModalOpen(false);
          setEditingImageItem(null);
        }}
      />

      {/* 7. 숨김 파일 입력 엘리먼트: PDF/이미지 및 .lbwnote 필기 파일 */}
      <input
        type="file"
        ref={imagePdfInputRef}
        onChange={handleFileSelect}
        accept="application/pdf,image/*"
        style={{ display: 'none' }}
      />
      <input
        type="file"
        ref={notebookFileInputRef}
        onChange={handleImportNotebookFile}
        accept=".lbwnote,.json"
        style={{ display: 'none' }}
      />
    </div>
  );
};

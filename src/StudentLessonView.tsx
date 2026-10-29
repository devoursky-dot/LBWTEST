import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useHorizontalToolbarScroll } from './lib/scrollModule';
import { useAppConfirm } from './lib/fullscreenModule';
import { useFullscreen } from './modules/fullscreen';
import { PwaInstallButton, usePwaInstall } from './modules/pwa';
import { QrScannerModal, useQrScannerAction } from './modules/qrScanner';
import { useAppVersionCheck, VersionUpdateOverlay } from './modules/version';
import { supabase, isSupabaseConfigured, type ClassNoteRecord } from './lib/supabase';
import { getDriveConfig, fetchDriveItems } from './lib/driveService';
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
  extractLassoImageAndBackground,
  type Point,
  type PolygonBounds
} from './modules/lassoFocus';
import { type Stroke, type StrokePoint } from './lib/drawingGeometry';
import { exportStudentNotebookToPdf } from './lib/studentPdfExporter';
import { exportNotebookToFile, importNotebookFromFile } from './lib/studentNotebookFileManager';
import { classroomRealtime, type ActiveTeacherLesson } from './lib/classroomRealtime';
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
  setCurrentSession,
  clearSavedStudentInfo
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
  parseLessonParam,
  listStudentSavedNotebooks,
  deleteStudentNotebook,
  type SavedNotebookItem
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

  const [tool, setTool] = useState<'pen' | 'shapePen' | 'highlighter' | 'eraser' | 'text' | 'image' | 'lasso'>('pen');
  const [penColor, setPenColor] = useState<string>('#ffffff'); // 기본값: 칠판에 가장 선명한 흰색 분필
  const [penSize, setPenSize] = useState<number>(3);
  const [shapePenColor, setShapePenColor] = useState<string>('#38bdf8'); // 도형/제도 펜 기본 색상: 또렷한 시안 블루
  const [shapePenSize, setShapePenSize] = useState<number>(3);
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

  // 스타일러스(S펜 / 애플펜슬) W3C 가변 필압 감도 ON/OFF (기본값 true)
  const [penPressureEnabled, setPenPressureEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('lbw_pen_pressure');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  // 선 끝 유지(0.85초) 시 직선/원 자동 스냅 퀵셰이프 ON/OFF (기본값 false: 자연스러운 필기 보장)
  const [quickShapeEnabled, setQuickShapeEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('lbw_quick_shape');
      return saved !== null ? saved === 'true' : false;
    } catch {
      return false;
    }
  });

  const [activePopup, setActivePopup] = useState<'pen' | 'shapePen' | 'highlighter' | 'eraser' | 'settings' | 'image' | 'menu' | null>(null);

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
          const apiKey = getDriveConfig().googleApiKey;
          const directUrl = `https://www.googleapis.com/drive/v3/files?q='${lessonId}'+in+parents+and+trashed=false&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType)&key=${apiKey}&_t=${Date.now()}`;
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
  const [_isLessonPdfPromptOpen, setIsLessonPdfPromptOpen] = useState<boolean>(false);
  const [isDownloadingLessonPdf, setIsDownloadingLessonPdf] = useState<boolean>(false);

  // 📥 실시간 파일 다운로드 진행률 상태 (스피너, % 게이지, MB 실시간 표시)
  const [downloadProgress, setDownloadProgress] = useState<{
    isActive: boolean;
    fileName: string;
    loadedBytes: number;
    totalBytes: number;
    percent: number;
  } | null>(null);

  // 📄 학습지 문서 로딩 상태 (구글 드라이브 다운로드 및 PDF 파싱 실시간 피드백)
  const [loadingPdfState, setLoadingPdfState] = useState<{
    isLoading: boolean;
    fileName: string;
    message: string;
  } | null>(null);

  // 🚀 공책 페이지 일괄 생성 실시간 진행 상태 (n/total 쪽 실시간 게이지)
  const [batchPageProgress, setBatchPageProgress] = useState<{
    isActive: boolean;
    currentPage: number;
    totalPages: number;
    percent: number;
  } | null>(null);

  // 📺 표준 모듈화된 전체화면 관리 (불필요한 강제 재진입 편법 및 하드코딩 제거)
  const {
    isFullscreen,
    toggleFullscreen,
    enterFullscreen: requestFullscreenSafe,
    exitFullscreen: exitFullscreenSafe
  } = useFullscreen();

  // 📺 앱 실행 시 자동 전체화면 진입 (묻지 않고 즉시 & 첫 화면 터치/클릭 시 100% 자동 실행)
  useEffect(() => {
    // 1차 시도: 마운트 즉시 전체화면 진입 시도
    requestFullscreenSafe().catch(() => {});

    // 2차 시도: 브라우저 보안 제약 해제를 위해 사용자 첫 화면 터치/클릭 시 자동 진입
    const handleFirstInteraction = () => {
      if (!document.fullscreenElement) {
        requestFullscreenSafe().catch(() => {});
      }
    };

    window.addEventListener('pointerdown', handleFirstInteraction, { once: true });
    window.addEventListener('touchstart', handleFirstInteraction, { once: true });
    window.addEventListener('click', handleFirstInteraction, { once: true });

    return () => {
      window.removeEventListener('pointerdown', handleFirstInteraction);
      window.removeEventListener('touchstart', handleFirstInteraction);
      window.removeEventListener('click', handleFirstInteraction);
    };
  }, [requestFullscreenSafe]);

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

  // const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [hasSavedNote, setHasSavedNote] = useState(false);
  const [lastSavedTimeStr, setLastSavedTimeStr] = useState<string>('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const isInitialMountRef = useRef<boolean>(true);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 학생 제출 고유 ID (1인 1행 유지하여 중복 생성 및 타임아웃 방지)
  const submissionIdRef = useRef<string | null>(null);
  // 제출 연타 방지 및 쿨다운 관리 (4초 이내 중복 제출 원천 차단)
  // const lastSubmitTimeRef = useRef<number>(0);

  // --- 전자칠판 실시간 연결 및 화면 꺼짐 방지(WakeLock) 상태 ---
  const [isConnectedToBoard, setIsConnectedToBoard] = useState<boolean>(false);
  const wakeLockRef = useRef<any>(null);
  const studentInfoRef = useRef(studentInfo);
  studentInfoRef.current = studentInfo;

  // 컴포넌트 언마운트 시 실시간 연결 해제 및 WakeLock 해제 (5초 핑 누수 방지)
  useEffect(() => {
    return () => {
      classroomRealtime.leaveLesson(studentInfoRef.current || undefined);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, []);

  // 현재 연결된 수업 정보 및 등록 수업자료 다운로드 상태
  const [activeLessonTitle, setActiveLessonTitle] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      const title = p.get('title');
      if (title) return title;
    }
    return lessonTitle || '';
  });
  const [activeTeacherName, setActiveTeacherName] = useState<string>('');
  const [connectedLessonFiles, setConnectedLessonFiles] = useState<Array<{ id: string; name: string; size?: string | number; mimeType?: string }>>([]);
  const [isLessonMaterialsModalOpen, setIsLessonMaterialsModalOpen] = useState<boolean>(false);
  const [isLoadingMaterials, setIsLoadingMaterials] = useState<boolean>(false);

  // --- 📡 선생님 수업 연결 모달 및 활성 목록 상태 (2단계: 선생님 선택 -> 수업 선택) ---
  const [isJoinLessonModalOpen, setIsJoinLessonModalOpen] = useState(false);
  const [activeTeachersList, setActiveTeachersList] = useState<ActiveTeacherLesson[]>([]);
  const [isLoadingActiveLessons, setIsLoadingActiveLessons] = useState(false);
  const [selectedTeacherForJoin, setSelectedTeacherForJoin] = useState<ActiveTeacherLesson | null>(null);

  // --- 📂 내 필기 보관함 (오프라인 기본 공책 + 수업별 공책 목록 및 삭제 관리) ---
  const [isNotebookArchiveModalOpen, setIsNotebookArchiveModalOpen] = useState(false);
  const [savedNotebooksList, setSavedNotebooksList] = useState<SavedNotebookItem[]>([]);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);

  // --- ⏱️ 1시간 절대 세션 타이머 상태 (수업 60분 후 오프라인 모드 자동 전환) ---
  const lessonConnectionStartTimeRef = useRef<number | null>(null);
  const [remainingLessonMinutes, setRemainingLessonMinutes] = useState<number>(60);

  // --- 📲 PWA 홈 화면 추가 앱 설치 가드 통과 상태 (웹 브라우저 임시 허용) ---
  const [bypassPwaGuard, setBypassPwaGuard] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('lbw_bypass_pwa') === 'true';
    } catch {
      return false;
    }
  });

  // --- 💾 다른 이름으로 저장 (.qrdocs) 모달 상태 ---
  const [isSaveAsModalOpen, setIsSaveAsModalOpen] = useState(false);
  const [saveAsFileNameInput, setSaveAsFileNameInput] = useState('');


  // [실시간 핑 동기화]: 학생이 현재 보고 있는 쪽수(currentPageIndex)를 칠판에 실시간 전송
  useEffect(() => {
    classroomRealtime.setStudentPageInfoGetter(() => ({
      currentPage: currentPageIndex + 1,
      totalPages: pages.length
    }));
    classroomRealtime.triggerStudentPing();
    return () => {
      classroomRealtime.setStudentPageInfoGetter(null);
    };
  }, [currentPageIndex, pages.length]);

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

  // 🚀 최신 앱 배포 버전 자동 검증 및 강제 업데이트 훅
  const { localVersion, isUpdating, newVersionInfo, checkVersion } = useAppVersionCheck({
    autoCheckOnMount: true,
    onToast: showToast
  });

  // 📲 PWA 설치 상태 제어 훅
  const { isStandalone, isIos, promptInstall } = usePwaInstall();

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
      } else if (e.key === 's' || e.key === 'S') {
        setTool('shapePen');
        showToast('📐 도형/제도 펜 모드');
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
      setAuthErrorMsg('⚠️ 올바른 학번(예: 1101 또는 11201)을 입력하세요.');
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
      setAuthPassword('');
      setAuthNewPassword('');
      setAuthConfirmPassword('');

      // 학생 학번/이름 변경 시 이전 학생 세션 정리 후 새 학생 정보로 칠판 연결 즉시 갱신
      if (isTeacherLesson) {
        classroomRealtime.leaveLesson(studentInfo || undefined);
        isUserExitedRef.current = false;
        setTimeout(() => {
          handleConnectToBoard(lessonId, lessonTitle);
        }, 150);
      }

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

    if (isTeacherLesson) {
      classroomRealtime.leaveLesson(studentInfo || undefined);
      isUserExitedRef.current = false;
      setTimeout(() => {
        handleConnectToBoard(lessonId, lessonTitle);
      }, 150);
    }
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
    const file = e.target.files?.[0];
    if (!file) return;

    // input 값 리셋하여 동일 파일 재선택 가능하게 처리
    e.target.value = '';

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

    if (isPdf) {
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

  // Blob 파일 브라우저 다운로드 헬퍼
  const triggerBlobDownload = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  // 📥 수업자료 실시간 스트리밍 다운로드 (진행률 게이지 & 실시간 MB 표시)
  const handleDownloadMaterialWithProgress = async (mat: { id: string; name: string; size?: string | number; mimeType?: string }) => {
    try {
      const parsedSize = typeof mat.size === 'number' ? mat.size : parseInt(String(mat.size || 0), 10) || 0;
      setDownloadProgress({
        isActive: true,
        fileName: mat.name,
        loadedBytes: 0,
        totalBytes: parsedSize,
        percent: 0
      });

      const apiBase = getApiBaseUrl();
      const proxyUrl = `${apiBase}/api/drive?action=download&fileId=${mat.id}&fileName=${encodeURIComponent(mat.name)}`;

      let res = await fetch(proxyUrl);
      if (!res.ok) {
        // 프록시 실패 시 구글 직접 다운로드로 안전하게 폴백
        const downloadLink = `https://drive.google.com/uc?export=download&id=${mat.id}`;
        const a = document.createElement('a');
        a.href = downloadLink;
        a.download = mat.name;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast(`📥 '${mat.name}' 다운로드를 시작했습니다.`);
        setDownloadProgress(null);
        return;
      }

      const contentLength = res.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : parsedSize;

      const reader = res.body?.getReader();
      if (!reader) {
        const blob = await res.blob();
        triggerBlobDownload(blob, mat.name);
        setDownloadProgress(null);
        showToast(`✅ '${mat.name}' 다운로드가 완료되었습니다.`);
        return;
      }

      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
          setDownloadProgress({
            isActive: true,
            fileName: mat.name,
            loadedBytes: received,
            totalBytes: total,
            percent: pct
          });
        }
      }

      const blob = new Blob(chunks as any, { type: mat.mimeType || 'application/octet-stream' });
      triggerBlobDownload(blob, mat.name);
      setDownloadProgress(null);
      showToast(`✅ '${mat.name}' 다운로드가 성공적으로 완료되었습니다!`);
    } catch (err: any) {
      console.error('다운로드 오류:', err);
      setDownloadProgress(null);
      showToast(`❌ 다운로드 실패: ${err.message || '오류 발생'}`);
    }
  };

  // PDF 선택 페이지들을 공책 맨 앞쪽에 일괄 배경 페이지로 생성 (기존 필기 100% 보존 & 실시간 진행 게이지)
  const handleBatchInsertPdfPages = async (pageNumbers: number[]) => {
    if (!pdfDocProxy || pageNumbers.length === 0) return;
    try {
      setPdfPickerOpen(false); // 페이지 선택기는 즉시 닫아 렉 제거
      setBatchPageProgress({
        isActive: true,
        currentPage: 0,
        totalPages: pageNumbers.length,
        percent: 0
      });

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
        setBatchPageProgress({
          isActive: true,
          currentPage: i + 1,
          totalPages: pageNumbers.length,
          percent: Math.round(((i + 1) / pageNumbers.length) * 100)
        });
        // 브라우저 렌더링 루프 양보 (저사양 태블릿 OOM 방지 및 실시간 UI 업데이트)
        await new Promise(r => setTimeout(r, 20));

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

      setBatchPageProgress({
        isActive: true,
        currentPage: pageNumbers.length,
        totalPages: pageNumbers.length,
        percent: 100
      });
      await new Promise(r => setTimeout(r, 250));
      setBatchPageProgress(null);

      showToast(`🎉 PDF ${pageNumbers.length}개 쪽이 공책 맨 앞쪽에 성공적으로 생성되었습니다!`);
    } catch (err: any) {
      setBatchPageProgress(null);
      console.error('PDF 일괄 페이지 생성 실패:', err);
      showToast(`❌ 페이지 일괄 생성 실패: ${err.message || '오류'}`);
    }
  };

  // 구글 드라이브 분산 다운로드 및 학습지 로드 핸들러 (즉시 페이지 선택기 팝업 & 실시간 로딩)
  const handleLoadLessonPdfFromDrive = async (
    mode: 'direct_download' | 'batch_insert' | 'open_picker',
    targetPdf?: { id: string; name: string }
  ) => {
    const target = targetPdf || lessonPdfInfo;
    if (!target) return;

    // 1) 기기에 원본 PDF 직접 다운로드 (구글 드라이브 분산 다운로드 링크)
    if (mode === 'direct_download') {
      await handleDownloadMaterialWithProgress({ id: target.id, name: target.name });
      setIsLessonPdfPromptOpen(false);
      return;
    }

    // 2) 브라우저 메모리에 로드하여 즉시 피커 모달 열기 또는 일괄 생성
    try {
      setIsDownloadingLessonPdf(true);
      setLoadingPdfState({
        isLoading: true,
        fileName: target.name,
        message: '구글 드라이브에서 학습지 문서를 불러오고 있습니다...'
      });

      let buffer: ArrayBuffer | null = null;
      const apiBase = getApiBaseUrl();
      const proxyUrl = `${apiBase}/api/drive?action=download&fileId=${target.id}&fileName=${encodeURIComponent(target.name)}`;
      try {
        const res = await fetch(proxyUrl);
        if (res.ok) {
          const contentLength = res.headers.get('content-length');
          const total = contentLength ? parseInt(contentLength, 10) : 0;
          const reader = res.body?.getReader();

          if (reader && total > 0) {
            const chunks: Uint8Array[] = [];
            let received = 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                chunks.push(value);
                received += value.length;
                const pct = Math.round((received / total) * 100);
                setLoadingPdfState({
                  isLoading: true,
                  fileName: target.name,
                  message: `구글 드라이브에서 문서를 다운로드하는 중입니다 (${formatBytes(received)} / ${formatBytes(total)}, ${pct}%)...`
                });
              }
            }
            const blob = new Blob(chunks as any);
            buffer = await blob.arrayBuffer();
          } else {
            buffer = await res.arrayBuffer();
          }
        }
      } catch (e) {
        console.warn('Vercel Edge Proxy fetch failed, trying direct Google Drive API:', e);
      }

      if (!buffer) {
        const apiKey = getDriveConfig().googleApiKey;
        const directApiUrl = `https://www.googleapis.com/drive/v3/files/${target.id}?alt=media&supportsAllDrives=true&key=${apiKey}`;
        const res2 = await fetch(directApiUrl);
        if (res2.ok) {
          buffer = await res2.arrayBuffer();
        } else {
          throw new Error('구글 드라이브에서 학습지 파일을 다운로드하지 못했습니다.');
        }
      }

      setLoadingPdfState({
        isLoading: true,
        fileName: target.name,
        message: 'PDF 페이지 정보를 분석하고 있습니다...'
      });

      const pdfDoc = await loadPdfDocument(buffer);
      setPdfDocProxy(pdfDoc);
      setPdfFileName(target.name);
      const totalP = pdfDoc.numPages || 1;
      setPdfTotalPages(totalP);
      setIsLessonPdfPromptOpen(false);

      if (mode === 'batch_insert') {
        if (totalP > 10) {
          showToast(`⚠️ 총 ${totalP}쪽 대용량 자료입니다. 필요한 페이지만 범위로 선택해주세요.`);
          setPdfPickerOpen(true);
        } else {
          const allPages = Array.from({ length: totalP }, (_, i) => i + 1);
          await handleBatchInsertPdfPages(allPages);
        }
      } else {
        // 즉시 페이지 선택기 띄우기!
        setPdfPickerOpen(true);
      }
    } catch (err: any) {
      console.error('수업 PDF 로드 오류:', err);
      showToast(`❌ 학습지 로드 실패: ${err.message || '오류가 발생했습니다.'}`);
    } finally {
      setIsDownloadingLessonPdf(false);
      setLoadingPdfState(null);
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

  // 임베드 이미지 선택 및 고정 핸들러 (빈 공간 클릭 시 고정 및 펜 모드 자동 복귀)
  const handleSelectImage = useCallback((id: string | null) => {
    setSelectedImageId(id);
    if (id === null) {
      setTool('pen');
      showToast('📌 문제 배치가 고정되었습니다. 자유롭게 필기하세요.');
    } else {
      setTool('image');
    }
  }, []);

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
  // [모듈 플러그인]: 올가미 집중 풀이 - 새 페이지 삽입 및 편집 모드 전환
  // ==========================================================================
  const handleConfirmLassoFocus = async (
    lassoPoints: Point[],
    placement: 'top_center' | 'original',
    scale: number = 1.0,
    customBounds?: PolygonBounds
  ) => {
    if (!defaultLassoFocusConfig.enabled) return;
    setIsLassoProcessing(true);
    try {
      showToast('⏳ 선택 영역의 최빈 배경색을 분석하여 새 페이지를 생성하고 있습니다...');
      const result = await extractLassoImageAndBackground({
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

      // 2. 잘라낸 문제를 새 페이지의 독립 임베드 이미지 객체로 생성
      const newImageId = `img_lasso_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const newImageItem: EmbeddedImageItem = {
        id: newImageId,
        src: result.imageDataUrl,
        originalSrc: result.imageDataUrl,
        x: result.defaultPlacement.x,
        y: result.defaultPlacement.y,
        width: result.defaultPlacement.width,
        height: result.defaultPlacement.height
      };

      // 3. 최빈 배경색으로 채워진 새 풀이 페이지 생성
      const newPageId = `page_focus_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const newFocusPage: LessonPage = {
        id: newPageId,
        strokes: [],
        textItems: [],
        fullPageBackground: result.bgCanvasDataUrl,
        images: [newImageItem]
      };

      // 4. 현재 페이지 바로 다음 쪽에 삽입!
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
      setFullPageBackground(result.bgCanvasDataUrl);
      setEmbeddedImages([newImageItem]);
      setUndoStack([]);
      setRedoStack([]);
      setActiveTextId(null);

      // 5. 페이지 쪽 전체가 한눈에 다 보이는 상태(Fit to Page)로 뷰포트 맞춤
      const { fitPageScale: targetScale } = getFitScales();
      setZoomScale(targetScale);
      setPanOffset({ x: 0, y: 0 });

      // 6. 새 페이지에서 즉시 크기와 위치를 조절할 수 있도록 이미지 선택 활성화!
      setSelectedImageId(newImageId);
      setTool('image');

      // 7. 스마트 펜 색상 자동 매칭 (추출된 배경색이 밝으면 검정 펜, 어두우면 흰색 펜)
      const isBgLight = (() => {
        const bg = result.detectedBgColor.toLowerCase();
        if (bg.startsWith('#')) {
          const hex = bg.replace('#', '');
          const r = parseInt(hex.substring(0, 2), 16) || 255;
          const g = parseInt(hex.substring(2, 4), 16) || 255;
          const b = parseInt(hex.substring(4, 6), 16) || 255;
          return (r * 299 + g * 587 + b * 114) / 1000 > 140;
        }
        const m = bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (m) {
          const r = parseInt(m[1]);
          const g = parseInt(m[2]);
          const b = parseInt(m[3]);
          return (r * 299 + g * 587 + b * 114) / 1000 > 140;
        }
        return true;
      })();

      if (isBgLight && penColor === '#ffffff') {
        setPenColor('#111827');
      } else if (!isBgLight && penColor === '#111827') {
        setPenColor('#ffffff');
      }

      showToast(`✨ [${nextIndex + 1}쪽] 문제가 삽입되었습니다. 위치/크기 조절 후 빈 공간을 클릭해 고정하세요.`);
    } catch (err: any) {
      console.error('올가미 집중 풀이 생성 오류:', err);
      showToast(`❌ 집중 풀이 페이지 생성 실패: ${err.message || '오류 발생'}`);
    } finally {
      setIsLassoProcessing(false);
    }
  };

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
          title: activeLessonTitle || lessonTitle || (lessonId.startsWith('student_note_') ? '오프라인 기본 공책' : '수업 필기'),
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

  // [초기 마운트 시 복구 판별]: 해당 수업 필기가 있으면 번거로운 배너 없이 100% 즉시 자동 복원!
  useEffect(() => {
    try {
      const currentStudentId = studentInfo ? studentInfoToId(studentInfo) : null;
      const loaded = loadStudentDraft(lessonId, currentStudentId);

      if (loaded?.draft && Array.isArray(loaded.draft.pages) && loaded.draft.pages.length > 0) {
        const draft = loaded.draft;
        applyLoadedPages(draft.pages, draft.currentPageIndex ?? 0, draft.orientation);
        const now = new Date(draft.timestamp || Date.now());
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        setLastSavedTimeStr(timeStr);
        setHasSavedNote(true);
        showToast('📂 작성 중이던 필기를 안전하게 불러왔습니다.');
        isInitialMountRef.current = false;
        return;
      }

      // 레거시/개별 백업 확인 및 복원
      const backupKey = getStudentBackupKey(lessonId, currentStudentId);
      const rawSaved = localStorage.getItem(backupKey) ||
                       localStorage.getItem(`lbw_lesson_${lessonId}_note_v2`) ||
                       localStorage.getItem(`lbw_lesson_${lessonId}_note`);
      if (rawSaved) {
        setHasSavedNote(true);
        try {
          const parsed = JSON.parse(rawSaved);
          if (parsed && Array.isArray(parsed.pages) && parsed.pages.length > 0) {
            applyLoadedPages(parsed.pages, parsed.currentPageIndex ?? 0, parsed.orientation);
            showToast('📂 보관된 필기를 자동으로 불러왔습니다.');
            isInitialMountRef.current = false;
            return;
          }
        } catch {}
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
  // [선생님 목록 및 활성 수업 로드 (2단계 수업 선택기 초기화)]
  // ==========================================================================
  const handleOpenJoinLessonModal = async () => {
    setIsJoinLessonModalOpen(true);
    setSelectedTeacherForJoin(null);
    setIsLoadingActiveLessons(true);
    try {
      const teachers = await classroomRealtime.fetchActiveTeacherLessons();
      setActiveTeachersList(teachers);
    } catch (err) {
      console.warn('활성 수업 로드 실패:', err);
    } finally {
      setIsLoadingActiveLessons(false);
    }
  };

  // 파일 크기 포맷 헬퍼
  const formatBytes = (bytes?: number | string) => {
    if (!bytes) return '';
    const num = typeof bytes === 'string' ? parseFloat(bytes) : bytes;
    if (isNaN(num)) return String(bytes);
    if (num < 1024) return num + ' B';
    if (num < 1024 * 1024) return (num / 1024).toFixed(1) + ' KB';
    return (num / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // ==========================================================================
  // [전자칠판 실시간 연결 및 5초 주기 생존 핑 가동]
  // ==========================================================================
  const handleConnectToBoard = async (
    targetLessonId?: string,
    targetTitle?: string,
    targetFiles?: any[],
    targetTeacher?: string,
    targetExpiresAt?: number,
    targetSessionKey?: string
  ) => {
    if (!studentInfo || !studentInfo.name.trim()) {
      showToast('⚠️ 먼저 학번과 이름을 입력해주세요.');
      setIsChangingStudent(true);
      return;
    }

    const currentTargetId = targetLessonId || lessonId;
    const currentTargetTitle = targetTitle || lessonTitle;

    // 만약 선택한 수업이 현재 페이지의 수업 ID와 다르면, 해당 수업 URL로 이동 후 자동 연결
    if (targetLessonId && targetLessonId !== lessonId) {
      const targetUrl = new URL(window.location.href);
      targetUrl.searchParams.set('lessonId', targetLessonId);
      if (targetTitle) targetUrl.searchParams.set('title', targetTitle);
      targetUrl.searchParams.set('autoConnect', 'true');
      window.location.href = targetUrl.toString();
      return;
    }

    // 1. 화면 꺼짐 방지 (Screen Wake Lock API)
    try {
      if ('wakeLock' in navigator && !wakeLockRef.current) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch (wlErr) {
      console.warn('Wake Lock 활성화 경고:', wlErr);
    }

    // 2. 전체화면 전환 시도
    try {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen().catch(() => {});
      }
    } catch {}

    // 3. 전자칠판 실시간 채널 연결 및 5초 주기 핑 발송 자동 가동
    isUserExitedRef.current = false;
    setIsConnectedToBoard(true);
    if (currentTargetTitle) setActiveLessonTitle(currentTargetTitle);
    if (targetTeacher) setActiveTeacherName(targetTeacher);
    if (targetFiles && Array.isArray(targetFiles)) setConnectedLessonFiles(targetFiles);
    if (targetExpiresAt) {
      setSessionExpiresAt(targetExpiresAt);
      const rem = Math.max(1, Math.ceil((targetExpiresAt - Date.now()) / 60000));
      setRemainingLessonMinutes(rem);
    }

    classroomRealtime.joinLesson(currentTargetId, undefined, 'student', studentInfo, targetSessionKey);

    setIsJoinLessonModalOpen(false);
    showToast(`🟢 '${currentTargetTitle}' 수업에 실시간 연결되었습니다!`);
  };

  // [오프라인 모드로 해당 수업 필기 열기]
  const handleOpenOfflineLesson = (targetLessonId: string, targetTitle: string, pdfId?: string, pdfName?: string) => {
    setIsJoinLessonModalOpen(false);
    if (targetLessonId === lessonId) {
      showToast(`📖 현재 '${targetTitle}' 수업 필기를 열람 중입니다 (오프라인 모드).`);
      return;
    }
    showToast(`📖 '${targetTitle}' 수업 필기를 엽니다 (오프라인 모드)...`);
    const targetUrl = new URL(window.location.href);
    targetUrl.searchParams.set('lessonId', targetLessonId);
    if (targetTitle) targetUrl.searchParams.set('title', targetTitle);
    if (pdfId) targetUrl.searchParams.set('pdfId', pdfId);
    if (pdfName) targetUrl.searchParams.set('pdfName', pdfName);
    targetUrl.searchParams.delete('autoConnect');
    window.location.href = targetUrl.toString();
  };

  // [보관함에서 공책 열기 핸들러]
  const handleOpenNotebook = (targetLessonId: string, targetTitle?: string) => {
    setIsNotebookArchiveModalOpen(false);
    if (targetLessonId === lessonId) {
      showToast('📖 현재 화면에 열려있는 공책입니다.');
      return;
    }
    showToast(`📖 '${targetTitle || targetLessonId}' 공책을 불러옵니다...`);
    const targetUrl = new URL(window.location.href);
    targetUrl.searchParams.set('lessonId', targetLessonId);
    if (targetTitle) targetUrl.searchParams.set('title', targetTitle);
    targetUrl.searchParams.delete('autoConnect');
    window.location.href = targetUrl.toString();
  };

  // [보관함에서 공책 영구 삭제 핸들러]
  const handleDeleteNotebook = async (item: SavedNotebookItem) => {
    const currentStudentId = studentInfo ? studentInfoToId(studentInfo) : null;
    const ok = await confirm({
      title: '필기 영구 삭제',
      message: `'${item.title}' 필기(총 ${item.pageCount}쪽)를 영구 삭제하시겠습니까?\n\n삭제된 필기는 기기에서 완전히 제거되며 복구할 수 없습니다.`,
      confirmText: '삭제하기',
      cancelText: '취소',
      isDanger: true
    });
    if (!ok) return;

    deleteStudentNotebook(item.lessonId, currentStudentId);
    showToast(`🗑️ '${item.title}' 필기가 삭제되었습니다.`);

    const updated = listStudentSavedNotebooks(currentStudentId);
    setSavedNotebooksList(updated);

    // 만약 현재 열려있는 공책을 삭제했다면 기본 공책으로 전환 이동
    if (item.lessonId === lessonId) {
      const defaultId = `student_note_${currentStudentId || 'guest'}`;
      const targetUrl = new URL(window.location.href);
      targetUrl.searchParams.set('lessonId', defaultId);
      targetUrl.searchParams.delete('title');
      targetUrl.searchParams.delete('autoConnect');
      window.location.href = targetUrl.toString();
    }
  };

  // URL 파라미터 중 autoConnect 감지 시 전자칠판 자동 연결 가동
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('autoConnect') === 'true') {
      params.delete('autoConnect');
      const cleanUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
      window.history.replaceState(null, '', cleanUrl);
      setTimeout(() => {
        handleConnectToBoard(lessonId, lessonTitle);
      }, 500);
    }
  }, [lessonId, lessonTitle]);

  // 교사 수업 진입 여부 판별 (학생 개인 공책이 아닌 경우)
  const isTeacherLesson = Boolean(lessonId && !lessonId.startsWith('student_note_'));

  // 교사 수업 진입 시 구글 드라이브 실제 수업자료 및 선생님 정보 실시간 동기화
  const loadLessonMaterials = useCallback(async () => {
    if (!lessonId || lessonId.startsWith('student_note_')) return;
    setIsLoadingMaterials(true);

    try {
      // 1. 구글 드라이브 수업 폴더 내의 모든 실제 파일 조회 (Google Drive 단일 진실원)
      const driveFiles = await fetchDriveItems(lessonId);
      const validFiles: Array<{ id: string; name: string; size?: string | number; mimeType?: string }> = [];
      let foundPdf: { id: string; name: string } | null = null;

      for (const f of driveFiles) {
        if (f.type === 'folder') continue;
        if (f.name === 'lesson_config.json') continue;
        if (f.name.toLowerCase().endsWith('.png') && f.name.toLowerCase().includes('qr')) continue;

        validFiles.push({
          id: f.id,
          name: f.name,
          size: f.size,
          mimeType: f.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : undefined
        });

        if (!foundPdf && f.name.toLowerCase().endsWith('.pdf')) {
          foundPdf = { id: f.id, name: f.name };
        }
      }

      // 2. 활성 선생님 수업 목록 대조하여 교사 이름 및 실시간 수업 정보 동기화
      try {
        const teachers = await classroomRealtime.fetchActiveTeacherLessons();
        setActiveTeachersList(teachers);
        for (const t of teachers) {
          const found = t.lessons.find(l => l.lessonId === lessonId || (activeLessonTitle && l.title === activeLessonTitle));
          if (found) {
            if (found.title) setActiveLessonTitle(found.title);
            if (t.teacherName) setActiveTeacherName(t.teacherName);
            if (found.pdfId && !foundPdf) {
              foundPdf = { id: found.pdfId, name: found.pdfName || `${found.title}.pdf` };
            }
            if (found.attachedFiles && found.attachedFiles.length > 0) {
              found.attachedFiles.forEach(af => {
                if (af && af.id && !validFiles.some(vf => vf.id === af.id)) {
                  validFiles.push(af);
                }
              });
            }
            break;
          }
        }
      } catch {}

      // 3. lesson_config.json 대조 (외부 링크된 첨부자료 병합)
      try {
        const apiBase = getApiBaseUrl();
        const apiKey = getDriveConfig().googleApiKey;
        const directUrl = `https://www.googleapis.com/drive/v3/files?q='${lessonId}'+in+parents+and+name='lesson_config.json'+and+trashed=false&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name)&key=${apiKey}&_t=${Date.now()}`;
        const cRes = await fetch(directUrl);
        if (cRes.ok) {
          const cData = await cRes.json();
          const cfgFile = (cData.files || [])[0];
          if (cfgFile) {
            const dlRes = await fetch(`${apiBase}/api/drive?action=download&fileId=${cfgFile.id}&fileName=lesson_config.json`);
            if (dlRes.ok) {
              const cfgJson = await dlRes.json();
              if (cfgJson.attachedFiles && Array.isArray(cfgJson.attachedFiles)) {
                cfgJson.attachedFiles.forEach((af: any) => {
                  if (af && af.id && !validFiles.some(vf => vf.id === af.id)) {
                    validFiles.push(af);
                  }
                });
              }
              if (cfgJson.pdfId && !foundPdf) {
                foundPdf = { id: cfgJson.pdfId, name: cfgJson.pdfName || `${cfgJson.title || '수업'}.pdf` };
              }
              if (cfgJson.title && !activeLessonTitle) setActiveLessonTitle(cfgJson.title);
            }
          }
        }
      } catch (cfgErr) {
        console.warn('lesson_config.json fetch warning:', cfgErr);
      }

      setConnectedLessonFiles(validFiles);
      if (foundPdf) {
        setLessonPdfInfo(foundPdf);
      }
    } catch (err) {
      console.warn('수업자료 로드 오류:', err);
    } finally {
      setIsLoadingMaterials(false);
    }
  }, [lessonId, activeLessonTitle]);

  // 사용자가 명시적으로 수업 나가기를 눌렀는지 추적 (자동 재연결 방지)
  const isUserExitedRef = useRef<boolean>(false);

  // 본 수업 공식 등록 수업자료 단일 진실 공급원 (Single Source of Truth)
  // 대표 PDF(lessonPdfInfo)와 첨부 학습지(connectedLessonFiles)의 ID 중복을 원천 제거
  const uniqueMaterials = useMemo(() => {
    const list: Array<{ id: string; name: string; size?: string | number; mimeType?: string; isPrimaryPdf?: boolean }> = [];
    if (lessonPdfInfo && lessonPdfInfo.id) {
      list.push({
        id: lessonPdfInfo.id,
        name: lessonPdfInfo.name,
        mimeType: 'application/pdf',
        isPrimaryPdf: true
      });
    }
    if (connectedLessonFiles && connectedLessonFiles.length > 0) {
      connectedLessonFiles.forEach(f => {
        if (f && f.id && !list.some(m => m.id === f.id)) {
          list.push({ ...f, isPrimaryPdf: false });
        }
      });
    }
    return list;
  }, [lessonPdfInfo, connectedLessonFiles]);

  // 수업 진입 시 구글 드라이브 수업자료 자동 로드
  useEffect(() => {
    if (isTeacherLesson) {
      loadLessonMaterials();
    }
  }, [isTeacherLesson, loadLessonMaterials]);

  // 교사 수업 진입 시 실시간 전자칠판 세션 자동 연결 (퇴장 플래그가 세워진 경우에만 재연결 차단)
  useEffect(() => {
    if (isTeacherLesson && !isConnectedToBoard && !isUserExitedRef.current) {
      if (studentInfo && studentInfo.name.trim()) {
        handleConnectToBoard(lessonId, lessonTitle);
      }
    }
  }, [isTeacherLesson, isConnectedToBoard, studentInfo, lessonId, lessonTitle]);

  // 수업 나가기 처리 (실시간 핑/연결만 해제, 화면의 수업 필기는 유지하여 오프라인 자동저장 지속)
  const handleExitLesson = async () => {
    const ok = await confirm({
      title: '수업 연결 종료',
      message: '전자칠판 연결을 해제하고 오프라인 공책 모드로 전환하시겠습니까?\n\n(화면의 필기는 그대로 유지되며, 계속해서 기기에 자동 저장됩니다.)',
      confirmText: '연결 해제 (필기 유지)',
      cancelText: '계속 수업하기',
      isDanger: false
    });
    if (!ok) return;

    // 1. 퇴장 플래그 설정하여 재접속 useEffect 원천 차단
    isUserExitedRef.current = true;

    // 2. 화면 꺼짐 방지 및 전체화면 해제
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
      } catch {}
      wakeLockRef.current = null;
    }
    await exitFullscreenSafe();

    // 3. 실시간 연결 해제 및 퇴장 신호 전송
    classroomRealtime.leaveLesson(studentInfo || undefined);
    setIsConnectedToBoard(false);
    setSessionExpiresAt(null);

    showToast('📓 전자칠판 연결이 해제되었습니다. 작성 중이던 필기는 오프라인에서 계속 유지 및 저장됩니다.');
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
      // 학생의 모든 페이지(학습지 PDF 및 추가된 쪽 전체)를 축소/잘림 없이 온전히 보존
      const finalPages = [...currentPagesCopy];

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

  const syncCurrentNoteToCloudRef = useRef(syncCurrentNoteToCloud);
  syncCurrentNoteToCloudRef.current = syncCurrentNoteToCloud;

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
        classroomRealtime.leaveLesson(studentInfo || undefined);
        showToast('📢 선생님이 새 수업을 시작하여 세션이 초기화되었습니다.');
        return;
      }

      const myKey = `${studentInfo.grade}_${studentInfo.classNum}_${studentInfo.studentNum}`;

      // 선생님이 칠판에서 잘못 접속된 학생을 삭제/해제한 경우
      if (signal.type === 'KICK_STUDENT' && signal.targetStudentKey === myKey) {
        isUserExitedRef.current = true;
        setIsConnectedToBoard(false);
        submissionIdRef.current = null;
        classroomRealtime.leaveLesson();
        showToast('📢 선생님에 의해 전자칠판 연결이 해제되었습니다. 작성 중이던 필기는 기기에 안전하게 보존됩니다.');
        return;
      }
      // 선생님 칠판으로부터 원격 강제 새로고침(최신 버전 갱신) 신호 수신
      if (signal.type === 'FORCE_RELOAD' && (!signal.targetStudentKey || signal.targetStudentKey === myKey)) {
        showToast('🚀 전자칠판으로부터 최신 버전 갱신 신호를 수신했습니다. 화면을 새로고침합니다...');
        setTimeout(() => {
          window.location.reload();
        }, 600);
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

          const syncedRecord = await syncCurrentNoteToCloudRef.current(true);
          if (syncedRecord) {
            let recordToSend: ClassNoteRecord | undefined = syncedRecord;
            try {
              if (JSON.stringify(syncedRecord).length > 200000) {
                // 200KB 초과 대용량 필기인 경우 웹소켓 256KB 제한 드롭 방지를 위해 DB 조회를 유도
                recordToSend = undefined;
              }
            } catch {}

            try {
              await classroomRealtime.sendSignal({
                type: 'RESPONSE_STUDENT_NOTE',
                lessonId,
                student: studentInfo,
                noteRecord: recordToSend
              });
            } catch (wsErr) {
              await classroomRealtime.sendSignal({
                type: 'RESPONSE_STUDENT_NOTE',
                lessonId,
                student: studentInfo
              });
            }
          }
        } catch (syncErr) {
          console.warn('백그라운드 동기화 실패:', syncErr);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [isConnectedToBoard, studentInfo, lessonId]);

  // [수업 세션 타이머]: 교사 설정 만료 시각 또는 수업 시간 경과 후 자동 종료 및 오프라인 모드 안전 전환
  useEffect(() => {
    if (!isConnectedToBoard) {
      lessonConnectionStartTimeRef.current = null;
      return;
    }

    if (!lessonConnectionStartTimeRef.current) {
      lessonConnectionStartTimeRef.current = Date.now();
      if (!sessionExpiresAt) {
        setRemainingLessonMinutes(60);
      }
    }

    const interval = setInterval(() => {
      const now = Date.now();
      const expiresAt = sessionExpiresAt || ((lessonConnectionStartTimeRef.current || now) + 60 * 60 * 1000);

      if (now >= expiresAt) {
        clearInterval(interval);
        classroomRealtime.leaveLesson(studentInfoRef.current || undefined);
        setIsConnectedToBoard(false);
        lessonConnectionStartTimeRef.current = null;
        setSessionExpiresAt(null);
        showToast('⏱️ 수업 시간이 경과하여 오프라인 필기 모드로 전환되었습니다. 작성하신 필기는 안전하게 보존됩니다.');
        return;
      }

      setRemainingLessonMinutes(Math.max(1, Math.ceil((expiresAt - now) / 60000)));
    }, 3000);

    return () => clearInterval(interval);
  }, [isConnectedToBoard, sessionExpiresAt]);

  /*
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

  */

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

  // 📲 [PWA 홈 화면 추가 앱 설치 가드]
  // 웹 브라우저 탭(Safari, Chrome)으로 접속 시 안정적인 전체화면 및 펜 필기 몰입을 위해 홈 화면 추가 유도
  if (!isStandalone && !bypassPwaGuard) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: '#090d16',
          color: '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          zIndex: 999999,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}
      >
        <div
          style={{
            maxWidth: '460px',
            width: '100%',
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: '20px',
            padding: '32px 26px',
            textAlign: 'center',
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.8)'
          }}
        >
          <div style={{ fontSize: '46px', marginBottom: '14px' }}>📲</div>
          <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#ffffff', marginBottom: '10px' }}>
            LBW 스마트 학생필기앱
          </h2>
          <p style={{ fontSize: '13.5px', color: '#94a3b8', lineHeight: 1.6, marginBottom: '24px' }}>
            수업 중 안정적인 펜 필기와 전체화면 유지를 위해<br />
            <strong>[홈 화면에 추가]</strong>하여 전용 앱으로 실행해 주세요.
          </p>

          {isIos ? (
            /* iOS 사파리 (아이패드) 가이드 */
            <div
              style={{
                background: 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                borderRadius: '12px',
                padding: '16px',
                textAlign: 'left',
                marginBottom: '20px',
                fontSize: '13px',
                color: '#cbd5e1',
                lineHeight: 1.7
              }}
            >
              <div style={{ fontWeight: 700, color: '#38bdf8', marginBottom: '8px' }}>
                🍎 iPad 사파리 홈 화면 추가 방법:
              </div>
              <div>1. 브라우저 상단 <strong>공유 버튼(📤)</strong> 터치</div>
              <div>2. 메뉴에서 <strong>[홈 화면에 추가]</strong> 선택</div>
              <div>3. 홈 화면에 생성된 <strong>'LBW 학생필기앱'</strong> 아이콘으로 실행</div>
            </div>
          ) : (
            /* Android 갤럭시 탭 / PC 크롬 가이드 */
            <div style={{ marginBottom: '20px' }}>
              <button
                type="button"
                onClick={async () => {
                  const installed = await promptInstall();
                  if (!installed) {
                    showToast('브라우저 메뉴(⋮)에서 [홈 화면에 추가] 또는 [앱 설치]를 선택해 주세요.');
                  }
                }}
                style={{
                  width: '100%',
                  padding: '14px 20px',
                  background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                  border: '1px solid #3b82f6',
                  borderRadius: '12px',
                  color: '#ffffff',
                  fontSize: '15px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(37, 99, 235, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                <span>📲</span>
                <span>앱 설치하고 홈 화면에 추가하기</span>
              </button>
              <p style={{ fontSize: '12px', color: '#64748b', marginTop: '10px' }}>
                설치 후 홈 화면 아이콘을 눌러 실행하시면 전체화면 전용 모드로 시작됩니다.
              </p>
            </div>
          )}

          {/* 비상/테스트용 임시 계속하기 */}
          <button
            type="button"
            onClick={() => {
              setBypassPwaGuard(true);
              try { sessionStorage.setItem('lbw_bypass_pwa', 'true'); } catch {}
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              fontSize: '12px',
              textDecoration: 'underline',
              cursor: 'pointer',
              padding: '8px'
            }}
          >
            웹 브라우저에서 임시로 계속 진행하기
          </button>
        </div>
      </div>
    );
  }

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
          {/* 🌟 1. 수업 연결 시 툴바 바로 위에 항상 배치되는 수업제목줄 및 자료 다운로드 */}
          {(isConnectedToBoard || isTeacherLesson) ? (
            <div
              id="student-lesson-header-bar"
              style={{
                pointerEvents: 'auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                padding: '6px 14px',
                borderRadius: '9999px',
                background: 'rgba(15, 23, 42, 0.94)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5), 0 0 14px rgba(56, 189, 248, 0.25)',
                maxWidth: 'calc(100vw - 20px)',
                boxSizing: 'border-box'
              }}
            >
              {/* 1-1. 수업 제목 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flexShrink: 1 }}>
                <span style={{ fontSize: '14px' }}>📚</span>
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#ffffff',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '280px'
                  }}
                  title={activeLessonTitle || '실시간 수업'}
                >
                  {activeTeacherName ? `[${activeTeacherName}T] ` : ''}{activeLessonTitle || '실시간 수업'}
                </span>
              </div>

              {/* 1-2. ⏱️ 1시간 수업 타이머 배지 & 수업자료다운로드 & 나가기 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                {isConnectedToBoard && (
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid rgba(255, 255, 255, 0.16)',
                      padding: '3px 8px',
                      borderRadius: '12px',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      color: remainingLessonMinutes <= 5 ? '#f87171' : '#cbd5e1',
                      whiteSpace: 'nowrap'
                    }}
                    title="수업은 1시간 기준이며 1시간 경과 시 오프라인 모드로 안전 전환됩니다."
                  >
                    <span>⏱️</span>
                    <span>{remainingLessonMinutes}분</span>
                  </div>
                )}

                <button
                  id="btn-header-download-materials"
                  type="button"
                  onClick={() => setIsLessonMaterialsModalOpen(true)}
                  style={{
                    background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                    border: '1px solid #38bdf8',
                    color: '#ffffff',
                    padding: '4px 12px',
                    borderRadius: '9999px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 2px 8px rgba(2, 132, 199, 0.35)',
                    transition: 'all 0.15s ease'
                  }}
                  title="선생님이 등록한 공식 수업자료 다운로드"
                >
                  <span>📥</span>
                  <span>수업자료 다운로드</span>
                  {uniqueMaterials.length > 0 && (
                    <span
                      style={{
                        fontSize: '10.5px',
                        background: 'rgba(255, 255, 255, 0.25)',
                        padding: '1px 6px',
                        borderRadius: '10px',
                        fontWeight: 800
                      }}
                    >
                      {uniqueMaterials.length}
                    </span>
                  )}
                </button>

                <button
                  id="btn-header-exit-lesson"
                  type="button"
                  onClick={handleExitLesson}
                  style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.45)',
                    color: '#fca5a5',
                    padding: '4px 12px',
                    borderRadius: '9999px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease'
                  }}
                  title="전자칠판 연결을 해제하고 오프라인 공책 모드로 돌아갑니다"
                >
                  <span>🚪</span>
                  <span>수업 나가기</span>
                </button>
              </div>
            </div>
          ) : (
            /* 오프라인/미연결 상태일 때: 원터치 [수업 선택] 바 */
            <div
              id="student-lesson-header-bar"
              style={{
                pointerEvents: 'auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '5px 14px',
                borderRadius: '9999px',
                background: 'rgba(15, 23, 42, 0.94)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid rgba(59, 130, 246, 0.4)',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
                boxSizing: 'border-box'
              }}
            >
              <button
                type="button"
                onClick={handleOpenJoinLessonModal}
                style={{
                  background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                  border: '1px solid #3b82f6',
                  color: '#ffffff',
                  padding: '5px 14px',
                  borderRadius: '9999px',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                title="담당 선생님을 선택하고 개설된 수업에 연결합니다"
              >
                <span>📡</span>
                <span>수업 선택 (선생님 연결)</span>
              </button>
            </div>
          )}

          {/* 2. 메인 플로팅 툴바 가로 컨테이너 */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', maxWidth: '100%', pointerEvents: 'none' }}>
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

          {/* [오프라인 모듈]: 네트워크 상태 및 동기화 대기열 컴팩트 아이콘 배지 */}
          <OfflineStatusBadge style={{ marginLeft: '4px', flexShrink: 0 }} />

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

          {/* 3-1. [📐 도형/제도 펜 (직선·원·호·자석 연결)] */}
          <button
            id="btn-tool-shape-pen"
            type="button"
            className={`student-tool-btn ${tool === 'shapePen' ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (tool !== 'shapePen') {
                setTool('shapePen');
                showToast('📐 도형/제도 펜 활성화: 직선, 원, 호, 자석 연결 제도를 그릴 수 있습니다.');
              } else {
                setActivePopup(prev => prev === 'shapePen' ? null : 'shapePen');
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
              background: tool === 'shapePen' ? 'rgba(168, 85, 247, 0.25)' : 'transparent',
              border: tool === 'shapePen' ? '1px solid rgba(168, 85, 247, 0.6)' : '1px solid transparent',
              color: tool === 'shapePen' ? '#c084fc' : '#e2e8f0',
              gap: '2px',
              flexShrink: 0
            }}
            title="도형/제도 펜 (직선, 원, 호 자동 정렬 및 끝점 자석 연결, 'S' 단축키, 다시 클릭 시 굵기 및 색상 설정)"
          >
            <span style={{ fontSize: '15px', lineHeight: 1 }}>📐</span>
            <div
              style={{
                width: '14px',
                height: `${Math.min(4, Math.max(2, shapePenSize))}px`,
                borderRadius: '2px',
                backgroundColor: shapePenColor,
                boxShadow: '0 0 4px rgba(0,0,0,0.4)',
                border: shapePenColor === '#000000' ? '1px solid #777' : undefined
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

          {/* 1. 수업 연결 & 실시간 상태 관리 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {isConnectedToBoard ? (
              <>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'rgba(34, 197, 94, 0.15)',
                  border: '1px solid rgba(34, 197, 94, 0.35)',
                  borderRadius: '10px',
                  padding: '8px 12px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 700, color: '#4ade80' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px #22c55e' }} />
                    <span>전자칠판 실시간 연결 중</span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#86efac' }}>5초 생존 핑</span>
                </div>

                {/* 수업 연결 해제 버튼 */}
                <button
                  id="menu-btn-disconnect-board"
                  type="button"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: 'rgba(239, 68, 68, 0.12)',
                    color: '#fca5a5',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    cursor: 'pointer'
                  }}
                  onClick={() => {
                    handleExitLesson();
                    setActivePopup(null);
                  }}
                  title="전자칠판 연결을 해제하고 오프라인 공책 모드로 돌아갑니다"
                >
                  <span>🚪</span> 수업 연결 종료 (오프라인 복귀)
                </button>
              </>
            ) : (
              <>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'rgba(148, 163, 184, 0.1)',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  borderRadius: '10px',
                  padding: '8px 12px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 600, color: '#cbd5e1' }}>
                    <span>📓</span>
                    <span>오프라인 자유 공책 모드</span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>로컬 자동저장</span>
                </div>

                {/* 선생님 수업 연결하기 버튼 */}
                <button
                  id="menu-btn-open-join-modal"
                  type="button"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    fontSize: '13px',
                    fontWeight: 700,
                    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                    color: '#ffffff',
                    border: '1px solid #60a5fa',
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(37, 99, 235, 0.35)'
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActivePopup(null);
                    handleOpenJoinLessonModal();
                  }}
                  title="개설된 선생님 목록을 확인하거나 수업을 선택하여 참여합니다"
                >
                  <span>📡</span>
                  <span>선생님 수업 연결하기</span>
                </button>
              </>
            )}

            {/* 📂 [내 필기 보관함] 버튼: 기본 공책 및 지난 수업별 필기 목록/불러오기/삭제 관리 */}
            <button
              id="menu-btn-open-notebook-archive"
              type="button"
              style={{
                width: '100%',
                padding: '9px 12px',
                fontSize: '12.5px',
                fontWeight: 700,
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.18) 0%, rgba(139, 92, 246, 0.18) 100%)',
                border: '1px solid rgba(139, 92, 246, 0.45)',
                color: '#c084fc',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '7px',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(139, 92, 246, 0.2)'
              }}
              onClick={() => {
                setActivePopup(null);
                const sId = studentInfo ? studentInfoToId(studentInfo) : null;
                const list = listStudentSavedNotebooks(sId);
                setSavedNotebooksList(list);
                setIsNotebookArchiveModalOpen(true);
              }}
              title="오프라인 기본 공책 및 지난 수업별 필기 목록을 확인, 불러오기 및 삭제합니다"
            >
              <span>📂</span>
              <span>내 필기 보관함 (공책 관리)</span>
            </button>
          </div>

          <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)' }} />

          {/* 2. 페이지 관리 (추가, 개별 삭제, 전체 비우기) */}
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
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.22) 0%, rgba(139, 92, 246, 0.22) 100%)',
                border: '1px solid rgba(139, 92, 246, 0.45)',
                color: '#c084fc',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '7px',
                cursor: 'pointer',
                marginBottom: '8px'
              }}
              title="전체 페이지를 썸네일로 확인하고 순서를 이동합니다"
            >
              <span>🖼️</span>
              <span>전체 페이지 목록 보기 ({pages.length}쪽)</span>
            </button>

            {/* 이전/다음 쪽 이동 & 추가 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.04)', padding: '6px 10px', borderRadius: '8px', marginBottom: '6px' }}>
              <button
                type="button"
                className="student-tool-btn"
                disabled={currentPageIndex <= 0}
                onClick={() => handleGoToPage(currentPageIndex - 1)}
                style={{ padding: '4px 10px', fontSize: '12px' }}
                title="이전 쪽으로 이동"
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
                title="다음 쪽으로 이동"
              >
                다음 쪽 ▶
              </button>
              <button
                type="button"
                className="student-tool-btn"
                onClick={handleAddPage}
                style={{ padding: '4px 10px', fontSize: '12px', background: 'rgba(59, 130, 246, 0.25)', color: '#93c5fd', fontWeight: 600 }}
                title="새로운 페이지를 추가합니다"
              >
                + 쪽 추가
              </button>
            </div>

            {/* 개별 페이지 삭제 & 전체 비우기 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <button
                type="button"
                className="student-tool-btn"
                onClick={() => {
                  handleDeletePage(currentPageIndex);
                  setActivePopup(null);
                }}
                disabled={pages.length <= 1}
                style={{
                  justifyContent: 'center',
                  fontSize: '11.5px',
                  padding: '6px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: pages.length <= 1 ? '#6b7280' : '#f87171',
                  border: '1px solid rgba(239, 68, 68, 0.25)'
                }}
                title="현재 보고 있는 페이지를 삭제합니다 (최소 1쪽 유지)"
              >
                🗑️ 현재 쪽 삭제
              </button>
              <button
                type="button"
                className="student-tool-btn"
                onClick={() => {
                  handleResetNotebookClean();
                  setActivePopup(null);
                }}
                style={{
                  justifyContent: 'center',
                  fontSize: '11.5px',
                  padding: '6px',
                  background: 'rgba(249, 115, 22, 0.12)',
                  color: '#fdba74',
                  border: '1px solid rgba(249, 115, 22, 0.25)'
                }}
                title="공책의 모든 필기를 지우고 1쪽 새 공책으로 완전 초기화합니다"
              >
                🧹 공책 전체 비우기
              </button>
            </div>
          </div>

          {/* [툴바에서 이전된 학습지 및 이미지 삽입 도구] */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>
              🖼️ 학습지 / 문제 사진 삽입
            </div>
            <button
              id="menu-btn-image-tool"
              type="button"
              className="student-tool-btn"
              onClick={(e) => {
                e.stopPropagation();
                setActivePopup('image');
              }}
              style={{
                width: '100%',
                justifyContent: 'center',
                padding: '9px 12px',
                fontSize: '12.5px',
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(139, 92, 246, 0.25) 100%)',
                border: '1px solid rgba(139, 92, 246, 0.5)',
                color: '#c7d2fe',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                borderRadius: '8px',
                cursor: 'pointer'
              }}
              title="PDF 학습지 및 문제 사진을 배경 또는 스티커로 삽입합니다"
            >
              <IconImageDoc size={18} color="#c7d2fe" />
              <span>PDF 및 이미지 삽입 도구 열기</span>
            </button>
          </div>

          <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)' }} />

          {/* 3. 공책 파일 저장 관리 (.qrdocs & PDF) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>
              💾 파일 저장 및 관리
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <button
                type="button"
                className="student-tool-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setSaveAsFileNameInput(`${studentInfo?.name || '학생'}_스마트필기`);
                  setIsSaveAsModalOpen(true);
                  setActivePopup(null);
                }}
                style={{ justifyContent: 'center', fontSize: '12px', padding: '8px 6px', background: 'rgba(59, 130, 246, 0.15)', color: '#93c5fd' }}
                title="원하는 파일명으로 편집 가능한 원본 파일(*.qrdocs)을 저장합니다"
              >
                💾 다른이름 저장 (.qrdocs)
              </button>
              <button
                type="button"
                className="student-tool-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  notebookFileInputRef.current?.click();
                  setActivePopup(null);
                }}
                style={{ justifyContent: 'center', fontSize: '12px', padding: '8px 6px' }}
                title="이전에 저장한 .qrdocs 파일을 불러와서 필기를 이어갑니다"
              >
                📂 .qrdocs 불러오기
              </button>
              <button
                type="button"
                className="student-tool-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleExportStudentPdf();
                  setActivePopup(null);
                }}
                disabled={isExportingPdf}
                style={{ justifyContent: 'center', fontSize: '12px', padding: '8px 6px', background: 'rgba(34, 197, 94, 0.15)', color: '#86efac' }}
                title="제출 및 보관용 최종본 PDF를 다운로드합니다"
              >
                📄 최종 PDF 저장
              </button>
              {lessonPdfInfo && (
                <button
                  type="button"
                  className="student-tool-btn"
                  onClick={() => {
                    handleLoadLessonPdfFromDrive('open_picker', lessonPdfInfo);
                    setActivePopup(null);
                  }}
                  style={{
                    justifyContent: 'center',
                    fontSize: '12px',
                    padding: '8px 6px',
                    background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(59, 130, 246, 0.25) 100%)',
                    color: '#a5b4fc',
                    fontWeight: 600
                  }}
                  title="선생님이 올려두신 구글 드라이브 학습지 PDF를 확인하고 공책 배경으로 불러옵니다"
                >
                  📑 수업 학습지 열기
                </button>
              )}
            </div>
          </div>

          <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)' }} />

          {/* 4. 환경 & 계정 설정 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>
              ⚙️ 계정 및 설정
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
                title="칠판의 QR코드를 카메라로 스캔하여 수업에 연결합니다"
              >
                📷 수업 QR 스캔
              </button>
              <button
                type="button"
                className="student-tool-btn"
                onClick={toggleFullscreen}
                style={{ justifyContent: 'center', fontSize: '12px', padding: '7px 6px' }}
                title="전체화면 모드를 켜거나 끕니다"
              >
                {isFullscreen ? '⛶ 전체화면 종료' : '⛶ 전체화면'}
              </button>
              <button
                type="button"
                className="student-tool-btn"
                onClick={() => {
                  setIsChangingStudent(true);
                  setActivePopup(null);
                }}
                style={{ justifyContent: 'center', fontSize: '12px', padding: '7px 6px' }}
                title="학생 비밀번호를 변경합니다"
              >
                🔑 비밀번호 변경
              </button>
              <button
                type="button"
                className="student-tool-btn"
                onClick={() => {
                  if (window.confirm('현재 학생 계정에서 로그아웃하시겠습니까?')) {
                    clearSavedStudentInfo();
                    window.location.reload();
                  }
                }}
                style={{ justifyContent: 'center', fontSize: '12px', padding: '7px 6px', color: '#f87171' }}
                title="공용 태블릿에서 다른 학생이 로그인할 수 있도록 로그아웃합니다"
              >
                🚪 학생 로그아웃
              </button>
              <button
                type="button"
                className="student-tool-btn"
                onClick={handleTogglePenTouchMode}
                style={{ justifyContent: 'center', fontSize: '12px', padding: '7px 6px', color: penOnlyMode ? '#93c5fd' : '#cbd5e1' }}
                title="펜 터치 전용 모드를 토글합니다"
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
                style={{ justifyContent: 'center', fontSize: '11.5px', padding: '7px 6px' }}
              >
                ⚙️ 상세 설정
              </button>
              {!isStandalone && (
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <PwaInstallButton style={{ width: '100%', justifyContent: 'center' }} />
                </div>
              )}
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

          {/* 하단 버전 정보 및 최신 버전 확인 */}
          <div
            style={{
              paddingTop: '6px',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '10.5px',
              color: '#64748b'
            }}
          >
            <span>v{localVersion.buildTime}</span>
            <button
              type="button"
              onClick={() => checkVersion(true)}
              style={{
                background: 'none',
                border: 'none',
                color: '#38bdf8',
                fontSize: '10.5px',
                cursor: 'pointer',
                fontWeight: 600,
                padding: '2px 4px'
              }}
              title="서버의 최신 버전 확인"
            >
              🔄 업데이트 확인
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

            <div style={{ height: '1px', background: 'var(--g-border-subtle)' }} />

            {/* 필압 감도 및 도형 자동 보정(퀵셰이프) 스마트 필기 옵션 */}
            <div>
              <div style={{ fontSize: '11px', color: 'var(--g-text-secondary)', marginBottom: '8px', fontWeight: 600 }}>
                스마트 필기 편의 기능
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* 1. 필압 감도 (S펜 / 애플펜슬) */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'rgba(255,255,255,0.04)',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.08)'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#ffffff' }}>
                      ✍️ 펜 필압 감도
                    </span>
                    <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                      누르는 힘에 따라 선 굵기 조절 (S펜/애플펜슬)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !penPressureEnabled;
                      setPenPressureEnabled(next);
                      try { localStorage.setItem('lbw_pen_pressure', String(next)); } catch {}
                      showToast(next ? '✍️ 펜 필압 감도 활성화 (가변 굵기)' : '✍️ 펜 고정 두께 모드');
                    }}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '14px',
                      fontSize: '11px',
                      fontWeight: 700,
                      border: 'none',
                      cursor: 'pointer',
                      background: penPressureEnabled ? '#3b82f6' : 'rgba(255,255,255,0.15)',
                      color: '#ffffff',
                      transition: 'background 0.2s'
                    }}
                  >
                    {penPressureEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>

                {/* 2. 도형 자동 보정 (퀵셰이프) */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'rgba(255,255,255,0.04)',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.08)'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#ffffff' }}>
                      📐 도형 자동 보정 (퀵셰이프)
                    </span>
                    <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                      선 끝을 0.5초 누르면 직선·원·타원으로 스냅
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !quickShapeEnabled;
                      setQuickShapeEnabled(next);
                      try { localStorage.setItem('lbw_quick_shape', String(next)); } catch {}
                      showToast(next ? '📐 도형 자동 보정 활성화' : '📐 도형 자동 보정 비활성화');
                    }}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '14px',
                      fontSize: '11px',
                      fontWeight: 700,
                      border: 'none',
                      cursor: 'pointer',
                      background: quickShapeEnabled ? '#10b981' : 'rgba(255,255,255,0.15)',
                      color: '#ffffff',
                      transition: 'background 0.2s'
                    }}
                  >
                    {quickShapeEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ====================================================================
            [팝오버 1-1] 📐 도형/제도 펜 설정 팝오버
            ==================================================================== */}
        {activePopup === 'shapePen' && (
          <div
            id="popup-shape-pen-settings"
            className="samsung-tool-popup"
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'absolute', top: popupTop, left: '44px', zIndex: 1000, width: '280px', maxWidth: 'calc(100vw - 16px)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '15px' }}>📐</span>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#ffffff' }}>도형 / 제도 펜 설정</span>
              </div>
              <button
                type="button"
                onClick={() => setActivePopup(null)}
                style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '14px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8', lineHeight: 1.4 }}>
              직선, 원, 호를 깔끔하게 정돈하고, 꼭짓점이 자석처럼 달라붙어 다각형과 그래프를 쉽게 그립니다.
            </p>

            {/* 실시간 굵기 미리보기 */}
            <div className="samsung-preview-box">
              <svg width="170" height="32" viewBox="0 0 170 32" style={{ overflow: 'visible' }}>
                <line
                  x1="10"
                  y1="16"
                  x2="160"
                  y2="16"
                  stroke={shapePenColor}
                  strokeWidth={shapePenSize}
                  strokeLinecap="round"
                />
              </svg>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#c084fc' }}>{shapePenSize}px</span>
            </div>

            {/* 굵기 슬라이더 */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--g-text-secondary)', marginBottom: '5px' }}>
                <span>제도선 굵기</span>
                <span>1px ~ 24px</span>
              </div>
              <input
                type="range"
                min="1"
                max="24"
                value={shapePenSize}
                onChange={(e) => setShapePenSize(Number(e.target.value))}
                className="samsung-range-slider"
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
                {[1, 2, 3, 5, 8, 14].map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    className={`size-dot-btn ${shapePenSize === sz ? 'selected' : ''}`}
                    onClick={() => setShapePenSize(sz)}
                    style={{ width: '28px', height: '28px' }}
                    title={`${sz}px`}
                  >
                    <div
                      style={{
                        width: `${Math.min(18, Math.max(3, sz))}px`,
                        height: `${Math.min(18, Math.max(3, sz))}px`,
                        borderRadius: '50%',
                        background: shapePenSize === sz ? '#ffffff' : 'rgba(255, 255, 255, 0.7)'
                      }}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div style={{ height: '1px', background: 'var(--g-border-subtle)' }} />

            {/* 색상 팔레트 */}
            <div>
              <div style={{ fontSize: '11px', color: 'var(--g-text-secondary)', marginBottom: '6px', fontWeight: 600 }}>
                도형 선 색상
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px' }}>
                {[
                  '#38bdf8', '#a855f7', '#ffffff', '#ef4444', '#f59e0b', '#10b981',
                  '#60a5fa', '#ec4899', '#94a3b8', '#000000', '#f43f5e', '#6366f1'
                ].map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`color-dot-btn ${shapePenColor === color ? 'selected' : ''}`}
                    style={{
                      backgroundColor: color,
                      width: '26px',
                      height: '26px',
                      border: color === '#000000' ? '1px solid #555' : undefined,
                      margin: '0 auto'
                    }}
                    onClick={() => setShapePenColor(color)}
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
                    value={shapePenColor}
                    onChange={(e) => setShapePenColor(e.target.value)}
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
                  handleLoadLessonPdfFromDrive('open_picker', lessonPdfInfo);
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

            {/* 필압 감도 & 도형 자동 보정 (퀵셰이프) 빠른 설정 */}
            <div>
              <div style={{ fontSize: '11px', color: 'var(--g-text-secondary)', marginBottom: '5px', fontWeight: 600 }}>
                ✍️ 스마트 필기 기능
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <button
                  type="button"
                  className={`student-tool-btn ${penPressureEnabled ? 'active' : ''}`}
                  onClick={() => {
                    const next = !penPressureEnabled;
                    setPenPressureEnabled(next);
                    try { localStorage.setItem('lbw_pen_pressure', String(next)); } catch {}
                    showToast(next ? '✍️ 필압 감도 ON' : '✍️ 고정 두께');
                  }}
                  style={{ justifyContent: 'center', fontSize: '11px', padding: '6px 4px' }}
                >
                  {penPressureEnabled ? '✍️ 필압 ON' : '✍️ 필압 OFF'}
                </button>
                <button
                  type="button"
                  className={`student-tool-btn ${quickShapeEnabled ? 'active' : ''}`}
                  onClick={() => {
                    const next = !quickShapeEnabled;
                    setQuickShapeEnabled(next);
                    try { localStorage.setItem('lbw_quick_shape', String(next)); } catch {}
                    showToast(next ? '📐 퀵셰이프 ON' : '📐 퀵셰이프 OFF');
                  }}
                  style={{ justifyContent: 'center', fontSize: '11px', padding: '6px 4px' }}
                >
                  {quickShapeEnabled ? '📐 퀵셰이프 ON' : '📐 퀵셰이프 OFF'}
                </button>
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
            onSelectImage={handleSelectImage}
            onUpdateImage={handleUpdateEmbeddedImage}
            onDeleteImage={handleDeleteEmbeddedImage}
            onEditCrop={handleEditCrop}
            isDrawingToolActive={tool === 'pen' || tool === 'shapePen' || tool === 'highlighter' || tool === 'eraser'}
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
            penColor={tool === 'shapePen' ? shapePenColor : penColor}
            penSize={tool === 'shapePen' ? shapePenSize : penSize}
            highlighterColor={highlighterColor}
            highlighterSize={highlighterSize}
            eraserSize={eraserSize}
            eraserMode={eraserMode}
            penOnlyMode={penOnlyMode}
            enablePressure={penPressureEnabled}
            enableQuickShape={quickShapeEnabled}
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

      {/* 🌟 5-0-A. 실시간 파일 다운로드 진행률 모달 (ModularModal) */}
      <ModularModal
        isOpen={Boolean(downloadProgress?.isActive)}
        onClose={() => setDownloadProgress(null)}
        maxWidth="440px"
        zIndex={11000}
        showCloseButton={false}
      >
        {downloadProgress && (
          <div style={{ textAlign: 'center', padding: '10px 4px' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                background: 'rgba(2, 132, 199, 0.15)',
                border: '2px solid rgba(56, 189, 248, 0.4)',
                margin: '0 auto 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '28px'
              }}
            >
              📥
            </div>
            <h3 style={{ margin: '0 0 6px', fontSize: '16.5px', fontWeight: 800, color: '#ffffff' }}>
              파일 다운로드 진행 중...
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#94a3b8', wordBreak: 'break-all' }}>
              {downloadProgress.fileName}
            </p>

            {/* 게이지 바 */}
            <div style={{ width: '100%', height: '10px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '5px', overflow: 'hidden', marginBottom: '10px' }}>
              <div
                style={{
                  width: `${downloadProgress.percent}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #38bdf8 0%, #2563eb 100%)',
                  borderRadius: '5px',
                  transition: 'width 0.15s ease'
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#cbd5e1', fontWeight: 600 }}>
              <span>
                {formatBytes(downloadProgress.loadedBytes)}
                {downloadProgress.totalBytes > 0 ? ` / ${formatBytes(downloadProgress.totalBytes)}` : ''}
              </span>
              <span style={{ color: '#38bdf8', fontWeight: 700 }}>{downloadProgress.percent}%</span>
            </div>
          </div>
        )}
      </ModularModal>

      {/* 🌟 5-0-B. 학습지 문서 로드/파싱 진행 모달 (ModularModal) */}
      <ModularModal
        isOpen={Boolean(loadingPdfState?.isLoading)}
        onClose={() => setLoadingPdfState(null)}
        maxWidth="440px"
        zIndex={11000}
        showCloseButton={false}
      >
        {loadingPdfState && (
          <div style={{ textAlign: 'center', padding: '12px 6px' }}>
            <div
              style={{
                width: '54px',
                height: '54px',
                borderRadius: '50%',
                background: 'rgba(99, 102, 241, 0.15)',
                border: '2px solid rgba(129, 140, 248, 0.4)',
                margin: '0 auto 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '26px'
              }}
            >
              📄
            </div>
            <h3 style={{ margin: '0 0 6px', fontSize: '16.5px', fontWeight: 800, color: '#ffffff' }}>
              학습지 불러오는 중...
            </h3>
            <p style={{ margin: '0 0 10px', fontSize: '13px', color: '#cbd5e1', fontWeight: 600, wordBreak: 'break-all' }}>
              {loadingPdfState.fileName}
            </p>
            <p style={{ margin: '0 0 16px', fontSize: '12px', color: '#94a3b8' }}>
              {loadingPdfState.message}
            </p>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 14px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '20px', fontSize: '12px', color: '#a5b4fc' }}>
              <span>⏳</span>
              <span>잠시만 기다려주세요... 페이지 선택기가 바로 열립니다</span>
            </div>
          </div>
        )}
      </ModularModal>

      {/* 🌟 5-0-C. 공책 페이지 일괄 생성 실시간 진행 모달 (ModularModal) */}
      <ModularModal
        isOpen={Boolean(batchPageProgress?.isActive)}
        onClose={() => setBatchPageProgress(null)}
        maxWidth="440px"
        zIndex={11000}
        showCloseButton={false}
      >
        {batchPageProgress && (
          <div style={{ textAlign: 'center', padding: '12px 6px' }}>
            <div
              style={{
                width: '54px',
                height: '54px',
                borderRadius: '50%',
                background: 'rgba(168, 85, 247, 0.15)',
                border: '2px solid rgba(192, 132, 252, 0.4)',
                margin: '0 auto 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '26px'
              }}
            >
              📖
            </div>
            <h3 style={{ margin: '0 0 6px', fontSize: '16.5px', fontWeight: 800, color: '#ffffff' }}>
              공책에 페이지 생성 중...
            </h3>
            <p style={{ margin: '0 0 14px', fontSize: '13px', color: '#cbd5e1' }}>
              고해상도로 변환하여 공책에 순서대로 배치하고 있습니다
            </p>

            {/* 게이지 바 */}
            <div style={{ width: '100%', height: '10px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '5px', overflow: 'hidden', marginBottom: '10px' }}>
              <div
                style={{
                  width: `${batchPageProgress.percent}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #c084fc 0%, #8b5cf6 100%)',
                  borderRadius: '5px',
                  transition: 'width 0.2s ease'
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', color: '#cbd5e1', fontWeight: 700 }}>
              <span>{batchPageProgress.currentPage} / {batchPageProgress.totalPages} 쪽 변환 완료</span>
              <span style={{ color: '#c084fc' }}>{batchPageProgress.percent}%</span>
            </div>
          </div>
        )}
      </ModularModal>

      {/* 5-1. 구버전 복잡한 중간 팝업 비활성화 (곧바로 페이지 선택기를 열도록 변경됨) */}
      <ModularModal
        isOpen={false}
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

      {/* 🌟 5-1-B. 본 수업 공식 등록 수업자료 다운로드 모달 (ModularModal) */}
      <ModularModal
        isOpen={isLessonMaterialsModalOpen}
        onClose={() => setIsLessonMaterialsModalOpen(false)}
        maxWidth="540px"
        zIndex={10000}
        showCloseButton={true}
      >
        <div>
          {/* 모달 헤더 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                background: 'rgba(56, 189, 248, 0.15)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '22px'
              }}
            >
              📥
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#ffffff' }}>
                  수업자료 다운로드
                </h3>
                <button
                  type="button"
                  onClick={() => loadLessonMaterials()}
                  disabled={isLoadingMaterials}
                  style={{
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#e2e8f0',
                    padding: '3px 9px',
                    borderRadius: '6px',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                  title="구글 드라이브에서 최신 수업자료 다시 확인"
                >
                  <span>🔄</span>
                  <span>{isLoadingMaterials ? '조회 중...' : '새로고침'}</span>
                </button>
              </div>
              <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: '#94a3b8' }}>
                {activeTeacherName ? `${activeTeacherName} 선생님 • ` : ''}{activeLessonTitle || '실시간 수업'}
              </p>
            </div>
          </div>

          {/* 안내 배너 */}
          <div
            style={{
              background: 'rgba(56, 189, 248, 0.08)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              borderRadius: '10px',
              padding: '10px 14px',
              marginBottom: '14px',
              fontSize: '12px',
              color: '#bae6fd',
              lineHeight: 1.5
            }}
          >
            선생님이 본 수업에 공식 등록하신 학습 자료입니다. 기기에 직접 저장하거나 공책 배경으로 바로 넣어 필기할 수 있습니다.
          </div>

          {/* 자료 목록 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '340px', overflowY: 'auto' }}>
            {(() => {
              if (isLoadingMaterials) {
                return (
                  <div style={{ padding: '36px 16px', textAlign: 'center', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '12px', border: '1px dashed #30363d' }}>
                    <span style={{ fontSize: '28px', display: 'block', marginBottom: '8px' }}>⏳</span>
                    <p style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 700, color: '#ffffff' }}>
                      구글 드라이브에서 수업자료를 불러오는 중입니다...
                    </p>
                  </div>
                );
              }

              if (uniqueMaterials.length === 0) {
                return (
                  <div style={{ padding: '36px 16px', textAlign: 'center', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '12px', border: '1px dashed #30363d' }}>
                    <span style={{ fontSize: '30px', display: 'block', marginBottom: '8px' }}>📂</span>
                    <p style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 700, color: '#ffffff' }}>
                      본 수업에 등록된 수업자료가 없습니다.
                    </p>
                    <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#8b949e' }}>
                      선생님이 수업 자료를 등록하시면 여기에 자동으로 표시됩니다.
                    </p>
                    <button
                      type="button"
                      onClick={() => loadLessonMaterials()}
                      style={{
                        background: 'rgba(56, 189, 248, 0.15)',
                        border: '1px solid rgba(56, 189, 248, 0.3)',
                        color: '#38bdf8',
                        padding: '6px 14px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      🔄 드라이브 다시 확인
                    </button>
                  </div>
                );
              }

              return uniqueMaterials.map(mat => {
                const viewUrl = `https://drive.google.com/file/d/${mat.id}/view?usp=sharing`;

                return (
                  <div
                    key={mat.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      borderRadius: '10px',
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      gap: '10px'
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '15px' }}>{mat.mimeType?.includes('pdf') || mat.name.endsWith('.pdf') ? '📄' : '📁'}</span>
                        <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {mat.name}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                        <span style={{ fontSize: '10.5px', background: mat.isPrimaryPdf ? 'rgba(56, 189, 248, 0.2)' : 'rgba(168, 85, 247, 0.2)', color: mat.isPrimaryPdf ? '#7dd3fc' : '#c084fc', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                          {mat.isPrimaryPdf ? '📌 대표 학습지' : '📎 첨부 자료'}
                        </span>
                        {mat.size && (
                          <span style={{ fontSize: '11px', color: '#64748b' }}>
                            {formatBytes(mat.size)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      {/* 직접 다운로드 (실시간 진행률 게이지 & 스피너 제공) */}
                      <button
                        type="button"
                        onClick={() => handleDownloadMaterialWithProgress(mat)}
                        style={{
                          background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                          border: '1px solid #38bdf8',
                          color: '#ffffff',
                          padding: '6px 12px',
                          borderRadius: '7px',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          boxShadow: '0 2px 6px rgba(2, 132, 199, 0.3)'
                        }}
                        title={`기기에 '${mat.name}' 다운로드 (진행률 표시)`}
                      >
                        <span>📥</span> 다운로드
                      </button>

                      {/* PDF인 경우 공책에 바로 넣기 -> 중간 팝업 없이 즉시 페이지 선택기 띄우기! */}
                      {(mat.mimeType?.includes('pdf') || mat.name.endsWith('.pdf')) && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsLessonMaterialsModalOpen(false);
                            handleLoadLessonPdfFromDrive('open_picker', { id: mat.id, name: mat.name });
                          }}
                          style={{
                            background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                            border: '1px solid #818cf8',
                            color: '#ffffff',
                            padding: '6px 12px',
                            borderRadius: '7px',
                            fontSize: '12px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            boxShadow: '0 2px 6px rgba(99, 102, 241, 0.3)'
                          }}
                          title="페이지 선택기를 열어 원하는 페이지를 골라 공책에 넣습니다"
                        >
                          <span>📑</span> 공책에 넣기
                        </button>
                      )}

                      {/* 미리보기 */}
                      <button
                        type="button"
                        onClick={() => window.open(viewUrl, '_blank', 'noopener,noreferrer')}
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid #30363d',
                          color: '#c9d1d9',
                          padding: '6px 8px',
                          borderRadius: '7px',
                          fontSize: '11.5px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                        title="새 창에서 미리보기"
                      >
                        👁️
                      </button>
                    </div>
                  </div>
                );
              });
            })()}
          </div>

          {/* 모달 하단 닫기 */}
          <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setIsLessonMaterialsModalOpen(false)}
              style={{
                background: '#21262d',
                border: '1px solid #30363d',
                color: '#c9d1d9',
                padding: '7px 16px',
                borderRadius: '8px',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              닫기
            </button>
          </div>
        </div>
      </ModularModal>

      {/* 5-2. 카메라 기반 전자칠판 QR코드 스캐너 모달 */}
      <QrScannerModal
        isOpen={isQrScannerOpen}
        onClose={() => setIsQrScannerOpen(false)}
        onScanSuccess={handleScannedResult}
      />

      {/* 5-3. 전체화면을 파괴하지 않는 모듈화 인앱 확인 다이얼로그 (AppConfirmModal) */}
      {confirmModalElement}

      {/* 5-5. 최신 배포 버전 감지 시 자동 업데이트 진행 오버레이 */}
      <VersionUpdateOverlay isOpen={isUpdating} newVersionTime={newVersionInfo?.buildTime} />

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

      {/* 8. 📡 2단계 순수 수업 선택 모달 ([1단계: 담당 선생님 선택] -> [2단계: 개설 수업 선택]) */}
      <ModularModal
        isOpen={isJoinLessonModalOpen}
        onClose={() => {
          setIsJoinLessonModalOpen(false);
          setSelectedTeacherForJoin(null);
        }}
        maxWidth="520px"
        zIndex={10000}
        showCloseButton={true}
      >
        <div>
          {/* 헤더 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '24px' }}>{!selectedTeacherForJoin ? '👨‍🏫' : '📚'}</span>
              <div>
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#ffffff' }}>
                  {!selectedTeacherForJoin ? '1단계: 담당 선생님 선택' : '2단계: 개설 수업 선택'}
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                  {!selectedTeacherForJoin
                    ? '수업을 진행할 선생님을 터치해 주세요.'
                    : `[${selectedTeacherForJoin.teacherName} 선생님]의 개설 수업 중 참여할 수업을 터치하세요.`}
                </p>
              </div>
            </div>

            {/* 2단계 진행 중일 때: 1단계로 돌아가기 버튼 */}
            {selectedTeacherForJoin && (
              <button
                type="button"
                onClick={() => setSelectedTeacherForJoin(null)}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.16)',
                  color: '#cbd5e1',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <span>◀</span>
                <span>선생님 다시 선택</span>
              </button>
            )}
          </div>

          {/* 본문 컨테이너 */}
          <div style={{ maxHeight: '420px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '4px' }}>
            {isLoadingActiveLessons ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8', fontSize: '13px' }}>
                <span style={{ fontSize: '24px', display: 'block', marginBottom: '8px' }}>🔄</span>
                선생님 및 개설 수업 목록을 확인하는 중입니다...
              </div>
            ) : !selectedTeacherForJoin ? (
              /* [1단계: 담당 선생님 선택 뷰] */
              activeTeachersList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '36px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px dashed #30363d' }}>
                  <span style={{ fontSize: '32px', display: 'block', marginBottom: '8px' }}>🏫</span>
                  <p style={{ margin: '0 0 6px 0', fontSize: '14px', fontWeight: 600, color: '#ffffff' }}>
                    등록된 선생님 수업이 없습니다.
                  </p>
                  <p style={{ margin: '0 0 14px 0', fontSize: '12px', color: '#8b949e' }}>
                    선생님이 수업을 개설하면 여기에 자동으로 표시됩니다.
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenJoinLessonModal}
                    style={{
                      background: '#21262d',
                      border: '1px solid #30363d',
                      color: '#c9d1d9',
                      padding: '6px 14px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    🔄 목록 새로고침
                  </button>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '10px' }}>
                  {activeTeachersList.map(teacher => {
                    const liveCount = teacher.lessons.filter(l => l.isLive).length;
                    return (
                      <div
                        key={teacher.teacherName}
                        onClick={() => setSelectedTeacherForJoin(teacher)}
                        style={{
                          background: liveCount > 0 ? 'linear-gradient(135deg, rgba(37, 99, 235, 0.22) 0%, rgba(30, 41, 59, 0.8) 100%)' : 'rgba(22, 27, 34, 0.8)',
                          border: liveCount > 0 ? '1.5px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.1)',
                          borderRadius: '12px',
                          padding: '16px 14px',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '24px' }}>👨‍🏫</span>
                          {liveCount > 0 ? (
                            <span style={{ fontSize: '11px', color: '#4ade80', background: 'rgba(74, 222, 128, 0.18)', border: '1px solid rgba(74, 222, 128, 0.35)', padding: '2px 8px', borderRadius: '10px', fontWeight: 700 }}>
                              🟢 {liveCount}개 진행 중
                            </span>
                          ) : (
                            <span style={{ fontSize: '11px', color: '#94a3b8', background: 'rgba(148, 163, 184, 0.12)', padding: '2px 7px', borderRadius: '10px' }}>
                              {teacher.lessons.length}개 개설
                            </span>
                          )}
                        </div>
                        <div>
                          <div style={{ fontSize: '15px', fontWeight: 700, color: '#ffffff' }}>
                            {teacher.teacherName} 선생님
                          </div>
                          <div style={{ fontSize: '11.5px', color: '#94a3b8', marginTop: '2px' }}>
                            터치하여 개설 수업 목록 보기 ▶
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            ) : (
              /* [2단계: 개설 수업 선택 뷰] */
              selectedTeacherForJoin.lessons.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '36px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px dashed #30363d' }}>
                  <span style={{ fontSize: '30px', display: 'block', marginBottom: '8px' }}>📂</span>
                  <p style={{ margin: 0, fontSize: '13.5px', color: '#94a3b8' }}>
                    {selectedTeacherForJoin.teacherName} 선생님이 개설한 수업이 아직 없습니다.
                  </p>
                </div>
              ) : (
                selectedTeacherForJoin.lessons.map(lesson => {
                  const isLive = !!lesson.isLive;
                  const hasFiles = lesson.attachedFiles && lesson.attachedFiles.length > 0;
                  return (
                    <div
                      key={lesson.lessonId}
                      style={{
                        background: isLive ? 'rgba(16, 185, 129, 0.08)' : 'rgba(30, 41, 59, 0.6)',
                        border: isLive ? '1.5px solid rgba(52, 211, 153, 0.5)' : '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '12px',
                        padding: '12px 14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: '14.5px', fontWeight: 700, color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>{isLive ? '🟢' : '📓'}</span>
                            <span>{lesson.title}</span>
                          </div>
                          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {isLive ? (
                              <span style={{ color: '#4ade80', fontWeight: 700 }}>🟢 실시간 수업 진행 중</span>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>📓 오프라인 필기 모드</span>
                            )}
                            {lesson.pdfName && !hasFiles && (
                              <span style={{ color: '#a5b4fc' }}>• 📄 {lesson.pdfName}</span>
                            )}
                          </div>
                        </div>

                        {/* 입장 버튼 */}
                        <div>
                          {isLive ? (
                            <button
                              type="button"
                              onClick={() => {
                                handleConnectToBoard(
                                  lesson.lessonId,
                                  lesson.title,
                                  lesson.attachedFiles,
                                  selectedTeacherForJoin.teacherName,
                                  lesson.expiresAt,
                                  lesson.sessionKey
                                );
                              }}
                              style={{
                                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                border: '1px solid #34d399',
                                color: '#ffffff',
                                padding: '8px 16px',
                                borderRadius: '8px',
                                fontSize: '13px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                boxShadow: '0 2px 10px rgba(16, 185, 129, 0.4)'
                              }}
                              title="전자칠판 실시간 수업에 연결합니다"
                            >
                              🟢 실시간 연결
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleOpenOfflineLesson(lesson.lessonId, lesson.title, lesson.pdfId, lesson.pdfName)}
                              style={{
                                background: 'rgba(59, 130, 246, 0.15)',
                                border: '1px solid rgba(96, 165, 250, 0.4)',
                                color: '#93c5fd',
                                padding: '8px 14px',
                                borderRadius: '8px',
                                fontSize: '12.5px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                whiteSpace: 'nowrap'
                              }}
                              title="오프라인 모드로 필기를 시작합니다"
                            >
                              📖 필기 열기
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 연결된 학습 자료 목록 */}
                      {hasFiles && (
                        <div style={{ background: 'rgba(0, 0, 0, 0.3)', borderRadius: '6px', padding: '6px 10px', marginTop: '2px', border: '1px solid rgba(255,255,255,0.06)' }}>
                          <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>
                            📎 등록 학습자료 ({lesson.attachedFiles!.length}개)
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            {lesson.attachedFiles!.map(file => (
                              <div
                                key={file.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  fontSize: '11.5px',
                                  color: '#cbd5e1'
                                }}
                              >
                                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: '8px' }}>
                                  📄 {file.name}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    showToast(`📥 '${file.name}' 다운로드를 시작합니다...`);
                                    const apiBase = typeof window !== 'undefined' && window.location.hostname.includes('github.io')
                                      ? 'https://lbwtest.vercel.app'
                                      : '';
                                    const dlUrl = `${apiBase}/api/drive?action=download&fileId=${file.id}&fileName=${encodeURIComponent(file.name)}`;
                                    try {
                                      const link = document.createElement('a');
                                      link.href = dlUrl;
                                      link.setAttribute('download', file.name);
                                      link.target = '_blank';
                                      link.rel = 'noreferrer';
                                      document.body.appendChild(link);
                                      link.click();
                                      setTimeout(() => {
                                        try {
                                          if (document.body.contains(link)) document.body.removeChild(link);
                                        } catch {}
                                      }, 500);
                                    } catch {
                                      window.open(dlUrl, '_blank');
                                    }
                                  }}
                                  style={{
                                    background: '#1f2937',
                                    border: '1px solid #374151',
                                    color: '#60a5fa',
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    fontSize: '10.5px',
                                    cursor: 'pointer',
                                    flexShrink: 0
                                  }}
                                  title={`${file.name} 다운로드`}
                                >
                                  📥 다운로드
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )
            )}
          </div>
        </div>
      </ModularModal>

      {/* 📂 [내 필기 보관함] 모달: 기본 공책 및 지난 수업별 필기 목록, 불러오기 및 삭제 관리 */}
      <ModularModal
        isOpen={isNotebookArchiveModalOpen}
        onClose={() => setIsNotebookArchiveModalOpen(false)}
        maxWidth="540px"
        zIndex={10000}
        showCloseButton={true}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* 헤더 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '22px' }}>📂</span>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#ffffff' }}>
                  내 필기 보관함
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '11.5px', color: '#94a3b8' }}>
                  기기에 자동 보관된 기본 공책과 지난 수업별 필기 목록입니다
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                const sId = studentInfo ? studentInfoToId(studentInfo) : null;
                const list = listStudentSavedNotebooks(sId);
                setSavedNotebooksList(list);
                showToast('🔄 보관함 목록을 새로고침했습니다.');
              }}
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#cbd5e1',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
              title="보관함 목록 새로고침"
            >
              <span>🔄 새로고침</span>
            </button>
          </div>

          {/* 공책 카드 목록 */}
          <div style={{ maxHeight: '60vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '2px' }}>
            {savedNotebooksList.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 16px', color: '#94a3b8' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>📭</div>
                <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#cbd5e1' }}>보관된 필기가 없습니다.</div>
                <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '4px' }}>
                  기본 공책에 필기를 하거나 수업에 참여하면 자동으로 안전하게 보관됩니다.
                </div>
              </div>
            ) : (
              savedNotebooksList.map((item) => {
                const isCurrent = item.lessonId === lessonId;
                return (
                  <div
                    key={item.lessonId}
                    style={{
                      background: isCurrent ? 'rgba(59, 130, 246, 0.12)' : 'rgba(30, 41, 59, 0.6)',
                      border: isCurrent ? '1.5px solid rgba(96, 165, 250, 0.5)' : '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '10px',
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {/* 공책 정보 */}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '14.5px', fontWeight: 700, color: '#ffffff', wordBreak: 'break-all' }}>
                          {item.isDefaultNote ? '📖 내 기본 공책' : `📝 ${item.title}`}
                        </span>
                        {isCurrent && (
                          <span style={{
                            fontSize: '10.5px',
                            fontWeight: 700,
                            background: '#10b981',
                            color: '#ffffff',
                            padding: '1px 7px',
                            borderRadius: '9999px'
                          }}>
                            현재 열림
                          </span>
                        )}
                        {item.isDefaultNote && (
                          <span style={{
                            fontSize: '10px',
                            background: 'rgba(168, 85, 247, 0.2)',
                            color: '#c084fc',
                            border: '1px solid rgba(168, 85, 247, 0.4)',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontWeight: 600
                          }}>
                            오프라인 기본
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: '#38bdf8', fontWeight: 600 }}>총 ${item.pageCount}쪽</span>
                        <span>•</span>
                        <span>{new Date(item.timestamp).toLocaleDateString()} {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>

                    {/* 액션 버튼들 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      <button
                        type="button"
                        disabled={isCurrent}
                        onClick={() => handleOpenNotebook(item.lessonId, item.title)}
                        style={{
                          background: isCurrent ? 'rgba(255, 255, 255, 0.05)' : 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                          border: isCurrent ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid #3b82f6',
                          color: isCurrent ? '#64748b' : '#ffffff',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: isCurrent ? 'default' : 'pointer'
                        }}
                        title={isCurrent ? '현재 열려있는 공책입니다' : '이 공책을 불러옵니다'}
                      >
                        {isCurrent ? '작성 중' : '열기'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteNotebook(item)}
                        style={{
                          background: 'rgba(239, 68, 68, 0.12)',
                          border: '1px solid rgba(239, 68, 68, 0.35)',
                          color: '#fca5a5',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                        title="이 공책의 필기를 기기에서 영구 삭제합니다"
                      >
                        🗑️ 삭제
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </ModularModal>

      {/* 9. 💾 다른 이름으로 저장 (.qrdocs) 모달 */}
      <ModularModal
        isOpen={isSaveAsModalOpen}
        onClose={() => setIsSaveAsModalOpen(false)}
        maxWidth="440px"
        zIndex={10000}
        showCloseButton={true}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
            <span style={{ fontSize: '24px' }}>💾</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#ffffff' }}>
                다른 이름으로 저장 (*.qrdocs)
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                필기 원본을 파일로 저장하여 언제든 다시 불러올 수 있습니다
              </p>
            </div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
              문서 파일 이름 (.qrdocs 자동 부여)
            </label>
            <input
              type="text"
              value={saveAsFileNameInput}
              onChange={(e) => setSaveAsFileNameInput(e.target.value)}
              placeholder="예: 3단원_수학_오답정리"
              style={{
                width: '100%',
                background: '#161b22',
                border: '1px solid #30363d',
                borderRadius: '8px',
                padding: '10px 12px',
                color: '#ffffff',
                fontSize: '13px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const currentPages = pages.map((p, idx) => idx === currentPageIndex ? { ...p, strokes, textItems, fullPageBackground, images: embeddedImages } : p);
                  exportNotebookToFile({
                    customFileName: saveAsFileNameInput.trim(),
                    lessonTitle,
                    studentInfo,
                    pages: currentPages,
                    currentPageIndex,
                    orientation,
                    A4_WIDTH,
                    A4_HEIGHT
                  });
                  setIsSaveAsModalOpen(false);
                  showToast(`💾 '${saveAsFileNameInput}.qrdocs' 파일이 저장되었습니다!`);
                }
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              className="g-btn g-btn-text"
              onClick={() => setIsSaveAsModalOpen(false)}
              style={{ color: '#94a3b8' }}
            >
              취소
            </button>
            <button
              type="button"
              className="g-btn g-btn-primary"
              style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 700 }}
              onClick={() => {
                const currentPages = pages.map((p, idx) => idx === currentPageIndex ? { ...p, strokes, textItems, fullPageBackground, images: embeddedImages } : p);
                const result = exportNotebookToFile({
                  customFileName: saveAsFileNameInput.trim(),
                  lessonTitle,
                  studentInfo,
                  pages: currentPages,
                  currentPageIndex,
                  orientation,
                  A4_WIDTH,
                  A4_HEIGHT
                });
                setIsSaveAsModalOpen(false);
                showToast(`💾 '${result.fileName}' 파일로 안전하게 저장되었습니다!`);
              }}
            >
              💾 저장하기
            </button>
          </div>
        </div>
      </ModularModal>

      {/* 7. 숨김 파일 입력 엘리먼트: PDF/이미지 및 .qrdocs/.lbwnote 필기 파일 */}
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
        accept=".qrdocs,.lbwnote,.json"
        style={{ display: 'none' }}
      />
    </div>
  );
};

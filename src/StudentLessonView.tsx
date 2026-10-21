import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase, isSupabaseConfigured, type ClassNoteRecord } from './lib/supabase';
import {
  loadPdfDocument,
  renderPdfThumbnailsProgressive,
  renderPdfPageToDataUrl,
  loadImageFile,
  type CropRect
} from './lib/pdfImporter';
import { PdfPagePickerModal } from './components/PdfPagePickerModal';
import { ImageCropModal } from './components/ImageCropModal';
import { EmbeddedImageLayer, type EmbeddedImageItem } from './components/EmbeddedImageLayer';
import { DrawingCanvas } from './components/DrawingCanvas';
import { type Stroke, type StrokePoint } from './lib/drawingGeometry';
import { exportStudentNotebookToPdf } from './lib/studentPdfExporter';
import { exportNotebookToFile, importNotebookFromFile } from './lib/studentNotebookFileManager';
import { classroomRealtime } from './lib/classroomRealtime';
import { compressNotePagesForTransmission } from './lib/imageCompressor';

interface StudentInfo {
  grade: string;
  classNum: string;
  studentNum: string;
  name: string;
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
  fullPageBackground?: string | null;
  images?: EmbeddedImageItem[];
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

  // --- 2-2. 툴바 2줄 모드 및 화면 너비 감지 (아이패드 세로 모드 대응) ---
  const [windowWidth, setWindowWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1200));
  const [toolbarLayoutPref, setToolbarLayoutPref] = useState<'auto' | 'single' | 'double'>(() => {
    try {
      const saved = localStorage.getItem('lbw_toolbar_layout_pref');
      return (saved as 'auto' | 'single' | 'double') || 'auto';
    } catch {
      return 'auto';
    }
  });

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  const isNarrowScreen = windowWidth < 960;
  const isTwoTier =
    toolbarLayoutPref === 'double' ||
    (toolbarLayoutPref === 'auto' && (isNarrowScreen || orientation === 'portrait'));

  const handleToggleToolbarLayout = () => {
    const next = isTwoTier ? 'single' : 'double';
    setToolbarLayoutPref(next);
    try {
      localStorage.setItem('lbw_toolbar_layout_pref', next);
    } catch {}
    showToast(next === 'double' ? '↕️ 툴바 2줄 모드 (세로 화면 모든 도구 한눈에 보기)' : '↔️ 툴바 1줄 컴팩트 모드');
  };

  const popupTop = isTwoTier ? '138px' : '98px';

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

  // --- 4. 용지 테마 및 필기 도구 상태 ---
  // 교실 통일성을 위해 항상 검정색 칠판 다크 모드(#131314)로 고정
  const paperTheme = 'dark';

  const [tool, setTool] = useState<'pen' | 'highlighter' | 'eraser' | 'text' | 'image'>('pen');
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
  const [activePopup, setActivePopup] = useState<'pen' | 'highlighter' | 'eraser' | 'settings' | 'image' | null>(null);

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

  // 전체화면 토글 (iOS Safari 등 미지원 환경 안전 방어)
  const toggleFullscreen = () => {
    try {
      const doc = document as any;
      const docEl = document.documentElement as any;
      if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
        if (typeof docEl.requestFullscreen === 'function') {
          docEl.requestFullscreen().catch(() => {});
          setIsFullscreen(true);
        } else if (typeof docEl.webkitRequestFullscreen === 'function') {
          docEl.webkitRequestFullscreen();
          setIsFullscreen(true);
        } else {
          showToast('ℹ️ 모바일 사파리는 브라우저 보안 정책상 전체화면 API를 지원하지 않습니다.');
        }
      } else {
        if (typeof doc.exitFullscreen === 'function') {
          doc.exitFullscreen().catch(() => {});
        } else if (typeof doc.webkitExitFullscreen === 'function') {
          doc.webkitExitFullscreen();
        }
        setIsFullscreen(false);
      }
    } catch (e) {
      console.warn('전체화면 전환 예외:', e);
    }
  };



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

        // REA 아키텍처 기반 점진적(Progressive/Streaming) 썸네일 고속 생성
        renderPdfThumbnailsProgressive(pdfDoc, (newThumb) => {
          setPdfThumbnails(prev => {
            if (prev.some(t => t.pageNumber === newThumb.pageNumber)) return prev;
            return [...prev, newThumb].sort((a, b) => a.pageNumber - b.pageNumber);
          });
        }, 180);
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

  // PDF 특정 페이지 선택 처리 (전체 배경 또는 특정 영역 자르기)
  const handleSelectPdfPage = async (pageNumber: number, mode: 'full_page' | 'crop') => {
    if (!pdfDocProxy) return;

    try {
      showToast(`⏳ PDF ${pageNumber}페이지를 고해상도로 렌더링하고 있습니다...`);
      const { dataUrl } = await renderPdfPageToDataUrl(pdfDocProxy, pageNumber, 2400);

      setPdfPickerOpen(false);

      if (mode === 'full_page') {
        setFullPageBackground(dataUrl);
        showToast(`📄 PDF ${pageNumber}페이지가 현재 쪽 전체 배경으로 설정되었습니다.`);
      } else {
        // 크롭 모달 열기
        setEditingImageItem(null);
        setCropTargetImageSrc(dataUrl);
        setCropModalOpen(true);
      }
    } catch (err: any) {
      console.error('PDF 페이지 렌더링 실패:', err);
      showToast(`❌ PDF 페이지 처리 실패: ${err.message || '페이지 렌더링 오류'}`);
    }
  };

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

        const draftJson = JSON.stringify(draft);
        localStorage.setItem(`lbw_active_draft_${lessonId}_v3`, draftJson);
        sessionStorage.setItem(`lbw_session_draft_${lessonId}`, draftJson);

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
      const activeDraftRaw = localStorage.getItem(`lbw_active_draft_${lessonId}_v3`) ||
                             sessionStorage.getItem(`lbw_session_draft_${lessonId}`);
      const wasReload = isPageReload();

      if (activeDraftRaw) {
        const draft = JSON.parse(activeDraftRaw);
        if (draft && draft.version === 'a4_v3' && Array.isArray(draft.pages) && draft.pages.length > 0) {
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
      }

      // 레거시 백업 확인 (설정 팝업용)
      const rawSaved = localStorage.getItem(`lbw_lesson_${lessonId}_note_v2`) ||
                       localStorage.getItem(`lbw_lesson_${lessonId}_note`);
      if (rawSaved) {
        setHasSavedNote(true);
      }
    } catch (e) {
      console.warn('Failed to inspect draft on mount:', e);
    } finally {
      isInitialMountRef.current = false;
    }
  }, [lessonId, applyLoadedPages]);

  // [이전 필기 불러오기 (수동 복원)]
  const handleRestoreSavedNote = useCallback(() => {
    try {
      // 1. 활성 드래프트 우선 확인
      const activeDraftRaw = localStorage.getItem(`lbw_active_draft_${lessonId}_v3`) ||
                             sessionStorage.getItem(`lbw_session_draft_${lessonId}`);
      if (activeDraftRaw) {
        const draft = JSON.parse(activeDraftRaw);
        if (draft && draft.version === 'a4_v3' && Array.isArray(draft.pages) && draft.pages.length > 0) {
          applyLoadedPages(draft.pages, draft.currentPageIndex ?? 0, draft.orientation);
          showToast('📂 최근 임시 저장된 필기 내용을 성공적으로 불러왔습니다.');
          setActivePopup(null);
          return;
        }
      }

      // 2. 제출본 백업 확인
      const rawSaved = localStorage.getItem(`lbw_lesson_${lessonId}_note_v2`) ||
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

    // 3. 전자칠판 실시간 채널 연결 및 출석 신호 전송
    setIsConnectedToBoard(true);
    classroomRealtime.joinLesson(lessonId);
    await classroomRealtime.sendSignal({
      type: 'STUDENT_PRESENCE',
      lessonId,
      student: studentInfo,
      status: 'connected'
    });

    showToast(`📡 '${studentInfo.name}' 학생이 전자칠판에 연결되었습니다! (전체화면)`);
  };

  // 수업 나가기 처리 (WakeLock 해제, 전체화면 종료, 이탈 신호)
  const handleExitLesson = async () => {
    if (isConnectedToBoard) {
      const ok = window.confirm('수업을 종료하고 전자칠판 연결을 해제하시겠습니까?');
      if (!ok) return;

      if (wakeLockRef.current) {
        try {
          await wakeLockRef.current.release();
        } catch {}
        wakeLockRef.current = null;
      }
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen();
        } catch {}
      }
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

  // 전체화면 상태 동기화 리스너 (이탈 감지 기능 제거하여 억울한 빨간색 경고 원천 차단)
  useEffect(() => {
    if (!isConnectedToBoard || !studentInfo) return;

    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [isConnectedToBoard, studentInfo, lessonId]);

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
          paperTheme,
          strokes: optimizedPages[0]?.strokes || [],
          textItems: optimizedPages[0]?.textItems || []
        },
        updated_at: now
      };

      // 4. Supabase 클라우드 실시간 업서트
      if (supabase && isSupabaseConfigured) {
        const { data: savedData, error: sbError } = await supabase
          .from('class_notes')
          .upsert([record])
          .select('id')
          .single();

        if (sbError) {
          console.error('Supabase 저장 실패:', sbError.message);
        } else if (savedData?.id) {
          submissionIdRef.current = savedData.id;
          record.id = savedData.id;
        }
      }

      // 5. 로컬 스토리지 안전 캐시
      try {
        localStorage.setItem(`lbw_lesson_${lessonId}_note_v2`, JSON.stringify({
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
      return record;
    } catch (err: any) {
      console.error('필기 동기화 오류:', err);
      if (!quiet) showToast(`❌ 등록 실패: ${err.message || '네트워크 오류'}`);
      return null;
    }
  }, [studentInfo, pages, currentPageIndex, strokes, textItems, fullPageBackground, embeddedImages, lessonId, orientation]);

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
      const isTargeted = signal.type === 'REQUEST_STUDENT_NOTE' && signal.targetStudentKey === myKey;
      const isAllSync = signal.type === 'REQUEST_ALL_SYNC';

      if (isTargeted || isAllSync) {
        try {
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

  // [등록 및 제출하기] 수동 버튼 클릭 핸들러
  const handleSubmitLesson = async () => {
    if (!studentInfo) {
      setIsChangingStudent(true);
      return;
    }

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

  // --- 툴바 서브 컴포넌트 렌더러 (1줄/2줄 반응형 레이아웃 공용) ---
  const renderDrawingAndModeTools = () => (
    <>
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

        {/* 5. 학습지 이미지 / PDF 삽입 및 관리 */}
        <button
          id="btn-tool-image-pdf"
          type="button"
          className={`student-tool-btn ${tool === 'image' ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (tool !== 'image') {
              setTool('image');
              setActivePopup('image');
            } else {
              setActivePopup(prev => prev === 'image' ? null : 'image');
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
          title="학습지 이미지/PDF 삽입 및 크기 조절/자르기"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: '13px' }}>
            <span>🖼️</span>
            <span style={{ fontSize: '9px', opacity: 0.8 }}>{activePopup === 'image' ? '▲' : '▼'}</span>
          </div>
          <div
            style={{
              width: '16px',
              height: '3px',
              borderRadius: '2px',
              backgroundColor: tool === 'image' ? '#38bdf8' : (fullPageBackground || embeddedImages.length > 0 ? '#10b981' : 'transparent')
            }}
          />
        </button>

        {/* 숨김 파일 인풋 (PDF 및 이미지) */}
        <input
          type="file"
          ref={imagePdfInputRef}
          accept="image/*,application/pdf"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
      </div>

      <div className="toolbar-divider" />

      {/* [B] 퀵 컬러 스와치 (원터치 빠른 5대 분필 색상: 다크모드 칠판 최적화) */}
      <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexShrink: 0 }}>
        {[
          { color: '#ffffff', label: '흰색' },
          { color: '#fde047', label: '노랑' },
          { color: '#38bdf8', label: '하늘' },
          { color: '#f87171', label: '빨강' },
          { color: '#4ade80', label: '초록' }
        ].map(({ color, label }) => (
          <button
            key={color}
            type="button"
            className={`color-dot-btn ${penColor === color && tool === 'pen' ? 'selected' : ''}`}
            style={{
              backgroundColor: color,
              width: '20px',
              height: '20px',
              border: color === '#ffffff' ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.25)',
              boxShadow: penColor === color ? `0 0 0 2px var(--g-bg-main), 0 0 0 3.5px ${color}` : 'none'
            }}
            onClick={() => {
              setPenColor(color);
              if (tool === 'eraser') setTool('pen');
              setActivePopup(null);
              showToast(`🖊️ ${label} 분필 선택`);
            }}
            title={`${label} 분필로 원터치 전환`}
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
          try { localStorage.setItem('lbw_pen_mode', String(next)); } catch {}
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

      {/* [C-3] 툴바 1줄 / 2줄 보기 토글 버튼 (화면 폭 좁을 때 모든 도구 선택 보장) */}
      <button
        id="btn-toggle-toolbar-layout"
        type="button"
        className="student-tool-btn"
        onClick={handleToggleToolbarLayout}
        style={{
          padding: '3px 8px',
          height: '34px',
          fontSize: '11.5px',
          background: isTwoTier ? 'rgba(168, 85, 247, 0.22)' : 'rgba(255, 255, 255, 0.06)',
          border: isTwoTier ? '1px solid #a855f7' : '1px solid rgba(255, 255, 255, 0.12)',
          color: isTwoTier ? '#d8b4fe' : '#cbd5e1',
          gap: '3px',
          flexShrink: 0
        }}
        title={
          isTwoTier
            ? '현재: 2줄 툴바 모드 (모든 도구 노출) - 클릭하여 1줄 모드로 전환'
            : '현재: 1줄 툴바 모드 - 클릭하여 2줄 모드로 전환 (세로 모드 필수)'
        }
      >
        {isTwoTier ? '↔️ 1줄 보기' : '↕️ 2줄 보기'}
      </button>
    </>
  );

  const renderPageAndZoomTools = (isTwoTierRow: boolean) => (
    <>
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
        <button
          id="btn-quick-export-pdf"
          type="button"
          className="student-tool-btn"
          disabled={isExportingPdf}
          onClick={handleExportStudentPdf}
          style={{
            padding: '2px 7px',
            fontSize: '11px',
            height: '28px',
            background: 'rgba(59, 130, 246, 0.2)',
            color: '#93c5fd',
            border: '1px solid rgba(59, 130, 246, 0.4)',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '3px'
          }}
          title="현재까지 필기한 내용을 PDF 파일로 기기에 저장"
        >
          <span>📄</span>
          <span>{isExportingPdf ? '...' : 'PDF'}</span>
        </button>
        <button
          id="btn-quick-export-file"
          type="button"
          className="student-tool-btn"
          onClick={handleExportNotebookFile}
          style={{
            padding: '2px 7px',
            fontSize: '11px',
            height: '28px',
            background: 'rgba(16, 185, 129, 0.2)',
            color: '#6ee7b7',
            border: '1px solid rgba(16, 185, 129, 0.4)',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '3px'
          }}
          title="언제든 다시 불러와 편집할 수 있는 .lbwnote 필기 파일로 기기에 저장"
        >
          <span>💾</span>
          <span>저장</span>
        </button>
        <button
          id="btn-quick-import-file"
          type="button"
          className="student-tool-btn"
          onClick={() => notebookFileInputRef.current?.click()}
          style={{
            padding: '2px 7px',
            fontSize: '11px',
            height: '28px',
            background: 'rgba(234, 179, 8, 0.18)',
            color: '#fde047',
            border: '1px solid rgba(234, 179, 8, 0.4)',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '3px'
          }}
          title="기기에 저장된 .lbwnote 필기 파일을 열어 편집 이어하기"
        >
          <span>📂</span>
          <span>열기</span>
        </button>
      </div>

      {isTwoTierRow && <div className="toolbar-divider" />}

      {/* [E] 우측 줌 맞춤 및 설정 */}
      <div style={{ marginLeft: isTwoTierRow ? '0' : 'auto', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
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
    </>
  );

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
        userSelect: 'none',
        width: '100dvw',
        height: '100dvh',
        boxSizing: 'border-box',
        paddingTop: 'max(12px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(6px, env(safe-area-inset-bottom, 0px))'
      }}
    >
      {/* 1. 상단 학생 식별 및 액션 바 */}
      <header
        className="student-header"
        style={{
          minHeight: '48px',
          padding: '6px 14px',
          flexWrap: 'wrap',
          boxSizing: 'border-box'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, maxWidth: isNarrowScreen ? '180px' : '340px' }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
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
                color: '#ffffff',
                maxWidth: isNarrowScreen ? '140px' : '220px',
                overflow: 'hidden'
              }}
              title="클릭하여 학생 정보 수정"
            >
              <span>👨‍🎓</span>
              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

          {/* 실시간 자동 임시 저장 상태 배지 */}
          {lastSavedTimeStr && (
            <div
              id="student-autosave-badge"
              style={{
                fontSize: '11px',
                color: '#34d399',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                background: 'rgba(16, 185, 129, 0.14)',
                padding: '4px 8px',
                borderRadius: '6px',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                whiteSpace: 'nowrap'
              }}
              title="필기 내용이 기기 로컬에 실시간 자동 임시 저장되고 있습니다. 새로고침해도 안전합니다."
            >
              <span>💾</span>
              <span>자동저장됨 ({lastSavedTimeStr})</span>
            </div>
          )}

          {/* PDF 로컬 다운로드 저장 버튼 */}
          <button
            id="btn-header-export-pdf"
            type="button"
            className="student-tool-btn"
            style={{
              fontSize: '12px',
              fontWeight: 600,
              padding: '6px 11px',
              background: 'rgba(59, 130, 246, 0.2)',
              color: '#93c5fd',
              border: '1px solid rgba(59, 130, 246, 0.45)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              borderRadius: '8px'
            }}
            disabled={isExportingPdf}
            onClick={handleExportStudentPdf}
            title="현재까지 작성한 필기 공책을 PDF 파일로 내 기기에 즉시 저장합니다."
          >
            <span>📥</span>
            <span>{isExportingPdf ? 'PDF 생성 중...' : 'PDF 저장'}</span>
          </button>

          {/* 전자칠판 실시간 연결 (전체화면) 버튼 */}
          <button
            id="btn-connect-board"
            type="button"
            className="g-btn"
            style={{
              fontSize: '12.5px',
              fontWeight: 700,
              padding: '6px 13px',
              background: isConnectedToBoard
                ? 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)'
                : 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
              color: '#ffffff',
              border: isConnectedToBoard ? '1px solid #4ade80' : '1px solid #60a5fa',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: isConnectedToBoard
                ? '0 0 12px rgba(34, 197, 94, 0.45)'
                : '0 4px 12px rgba(37, 99, 235, 0.35)',
              cursor: 'pointer'
            }}
            onClick={handleConnectToBoard}
            title={
              isConnectedToBoard
                ? '전자칠판에 실시간 연결 중입니다. 탭하면 전체화면을 다시 유지합니다.'
                : '전자칠판에 실시간 연결하고 전체화면 모드로 전환합니다.'
            }
          >
            <span>{isConnectedToBoard ? '🟢' : '📡'}</span>
            <span>{isConnectedToBoard ? '칠판 연결됨 (전체화면)' : '전자칠판 연결'}</span>
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

          {/* 수업 나가기 버튼 */}
          <button
            id="btn-exit-lesson"
            type="button"
            className="g-btn g-btn-text"
            style={{ fontSize: '12px', padding: '4px 8px', color: '#94a3b8' }}
            onClick={handleExitLesson}
            title="수업을 종료하고 나갑니다."
          >
            수업 나가기
          </button>
        </div>
      </header>

      {/* 1-1. 이전 필기 복구 안내 배너 (신규 QR 접속 시 최근 필기 드래프트가 남아있을 때 표시) */}
      {recoveryPromptDraft && (
        <div
          id="banner-recovery-prompt"
          style={{
            position: 'absolute',
            top: isTwoTier ? '108px' : '56px',
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

      {/* 2. 툴바 (2줄 반응형 및 1줄 모드 토글 지원) */}
      {isTwoTier ? (
        <div
          className="student-toolbar two-tier"
          style={{ position: 'relative', overflowY: 'visible' }}
        >
          <div className="student-toolbar-row">
            {renderDrawingAndModeTools()}
          </div>
          <div className="student-toolbar-row">
            {renderPageAndZoomTools(true)}
          </div>
        </div>
      ) : (
        <div
          className="student-toolbar"
          style={{
            flexWrap: 'nowrap',
            gap: '5px',
            padding: '4px 10px',
            position: 'relative',
            overflowX: 'auto',
            overflowY: 'visible'
          }}
        >
          {renderDrawingAndModeTools()}
          <div className="toolbar-divider" />
          {renderPageAndZoomTools(false)}
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
              <span>📂</span> 새 PDF / 이미지 불러오기
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
              <span>🧪</span> 샘플 수학 문제지 불러오기 (테스트)
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
                onClick={() => notebookFileInputRef.current?.click()}
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

      {/* 3. 메인 작업 영역: A4 종이 시트 & 줌/스크롤 뷰포트 */}
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

      {/* 5. PDF 페이지 선택 모달 */}
      <PdfPagePickerModal
        isOpen={pdfPickerOpen}
        fileName={pdfFileName}
        thumbnails={pdfThumbnails}
        totalPages={pdfTotalPages}
        isLoading={isPdfLoading}
        onSelectPage={handleSelectPdfPage}
        onClose={() => setPdfPickerOpen(false)}
      />

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

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import { StudentLessonView } from './StudentLessonView';
import { PortalLoginView } from './PortalLoginView';
import { AdminDashboardModal } from './AdminDashboardModal';
import { LiveClassroomDashboard } from './components/LiveClassroomDashboard';
import { StudentNoteFullscreenViewer } from './components/StudentNoteFullscreenViewer';
import { getCurrentSession, setCurrentSession, setWhiteboardPermanentAuth, verifyWhiteboardPassword, verifyAdminPassword, parseStudentId, type UserSession } from './lib/auth';
import { supabase, isSupabaseConfigured, localRealtimeChannel, type ClassNoteRecord } from './lib/supabase';
import { generateClassSubmissionPdf } from './lib/pdfGenerator';
import { parseLessonParam, buildLessonUrl, type LessonParam } from './lib/studentSessionManager';
import { classroomRealtime, type AttachedFileItem } from './lib/classroomRealtime';
import { PwaInstallButton } from './modules/pwa';
import { QrScannerModal, useQrScannerAction } from './modules/qrScanner';
import { useAppVersionCheck, VersionUpdateOverlay } from './modules/version';
import './index.css';

// ============================================================================
// [타입 정의]
// ============================================================================
interface DriveItem {
  id: string;
  name: string;
  type: 'folder' | 'document';
  folderId?: string;
  size?: string;
  updatedAt: string;
  viewUrl: string;
  downloadUrl: string;
  isQrLesson?: boolean;
}

const DEFAULT_ROOT_FOLDER_ID = '1Ew38nohOksBhypc2UjHYTmi6bSjbICmn';
const DEFAULT_GOOGLE_API_KEY = 'AIzaSyAmEvx5j8IFigp22Ujp1Cm8lF4wpi0xlFw';
const DEFAULT_GAS_UPLOAD_URL = (import.meta.env.VITE_GAS_UPLOAD_URL as string) || 'https://script.google.com/macros/s/AKfycbx_J2hdpXKy8iKFu8cxof4aKGYdhFO4ea93_E3a3KTeTNRbHMaaV4Fo7IkjbeDGUkli/exec';
const ADMIN_ID = 'admin';

const apiBase = typeof window !== 'undefined' && window.location.hostname.includes('github.io')
  ? 'https://lbwtest.vercel.app'
  : '';

type AuthMode = 'guest' | 'teacher' | 'admin' | 'whiteboard';

// 1분 Google Apps Script 표준 코드 템플릿 (업로드, 새 폴더, 이름 변경, 삭제 통합 지원)
const GAS_CODE_TEMPLATE = `function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || (data.base64 ? 'upload' : 'unknown');

    // 1. 파일 또는 폴더 휴지통 이동 (삭제)
    if (action === 'delete') {
      var targetId = data.id;
      if (!targetId) throw new Error('삭제할 항목의 ID가 없습니다.');
      try {
        var file = DriveApp.getFileById(targetId);
        file.setTrashed(true);
        return ContentService.createTextOutput(JSON.stringify({ success: true, id: targetId, type: 'file' })).setMimeType(ContentService.MimeType.JSON);
      } catch (errFile) {
        var folder = DriveApp.getFolderById(targetId);
        folder.setTrashed(true);
        return ContentService.createTextOutput(JSON.stringify({ success: true, id: targetId, type: 'folder' })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // 2. 새 폴더 만들기
    if (action === 'createFolder') {
      var targetFolderId = data.folderId || '1Ew38nohOksBhypc2UjHYTmi6bSjbICmn';
      var parentFolder = DriveApp.getFolderById(targetFolderId);
      var newFolder = parentFolder.createFolder(data.name || '새 폴더');
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        folderId: newFolder.getId(),
        name: newFolder.getName()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 3. 이름 바꾸기 (폴더 또는 파일 자동 감지)
    if (action === 'rename') {
      var renameId = data.id;
      var newName = data.name;
      try {
        DriveApp.getFileById(renameId).setName(newName);
      } catch (errF) {
        DriveApp.getFolderById(renameId).setName(newName);
      }
      return ContentService.createTextOutput(JSON.stringify({ success: true, id: renameId, name: newName })).setMimeType(ContentService.MimeType.JSON);
    }

    // 4. 파일 업로드
    if (action === 'upload') {
      var upFolderId = data.folderId || '1Ew38nohOksBhypc2UjHYTmi6bSjbICmn';
      var upFolder = DriveApp.getFolderById(upFolderId);
      var contentType = data.mimeType || 'application/octet-stream';
      var decoded = Utilities.base64Decode(data.base64);
      var blob = Utilities.newBlob(decoded, contentType, data.name);
      var file = upFolder.createFile(blob);
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        fileId: file.getId(),
        name: file.getName()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    throw new Error('지원되지 않는 요청 유형: ' + action);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}`;

export default function App() {
  // --- 통합 포털 세션 (전자칠판, 선생님, 학생, 관리자) ---
  const [currentSession, setCurrentSessionState] = useState<UserSession | null>(() => {
    if (typeof window !== 'undefined' && (window.location.search.includes('reset=true') || window.location.search.includes('portal=true'))) {
      localStorage.removeItem('lbw_current_session');
      localStorage.removeItem('lbw_whiteboard_permanent_auth');
      return null;
    }
    return getCurrentSession();
  });
  const [isAdminDashboardOpen, setIsAdminDashboardOpen] = useState<boolean>(false);

  // --- 권한 및 모드 상태 ---
  const [authMode, setAuthMode] = useState<AuthMode>(() => {
    if (typeof window !== 'undefined' && (window.location.search.includes('reset=true') || window.location.search.includes('portal=true'))) {
      return 'guest';
    }
    const initialSession = getCurrentSession();
    if (initialSession?.role === 'admin') return 'admin';
    if (initialSession?.role === 'teacher') return 'teacher';
    if (initialSession?.role === 'whiteboard') return 'whiteboard';
    return 'guest';
  });

  // 편집 권한 (선생님/관리자만 폴더생성/수정/삭제/업로드 가능, 기본 전자칠판 모드는 다운로드만 가능)
  const canEdit = authMode === 'teacher' || authMode === 'admin';

  // --- 학생 QR 수업 모드 감지 (?lessonId=...) ---
  const [studentLessonParam] = useState<LessonParam | null>(() => {
    if (typeof window !== 'undefined') {
      return parseLessonParam(window.location.search);
    }
    return null;
  });

  // 📷 카메라 QR 스캐너 모달 상태 및 처리 액션
  const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
  const { handleScannedResult } = useQrScannerAction();

  // --- 드라이브 설정 상태 ---
  const [rootFolderId, setRootFolderId] = useState<string>(() => {
    return localStorage.getItem('lbw_root_folder_id') || DEFAULT_ROOT_FOLDER_ID;
  });
  const [googleApiKey, setGoogleApiKey] = useState<string>(() => {
    return localStorage.getItem('lbw_google_api_key') || DEFAULT_GOOGLE_API_KEY;
  });
  const [gasUploadUrl, setGasUploadUrl] = useState<string>(() => {
    return localStorage.getItem('lbw_gas_upload_url') || DEFAULT_GAS_UPLOAD_URL;
  });

  // --- 폴더 탐색 상태 ---
  const [folderHistory, setFolderHistory] = useState<{ id: string; name: string }[]>([
    { id: rootFolderId, name: '내 드라이브' }
  ]);
  const [items, setItems] = useState<DriveItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // --- 구글 드라이브 UI 상태 ---
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isNewMenuOpen, setIsNewMenuOpen] = useState<boolean>(false);
  const [isDraggingGlobal, setIsDraggingGlobal] = useState<boolean>(false);

  // --- 모달 관리 ---
  const [activeModal, setActiveModal] = useState<'new_folder' | 'new_qr_lesson' | 'edit_qr_lesson' | 'qr_lesson_viewer' | 'lesson_session_prompt' | 'save_pdf_modal' | 'rename' | 'delete' | 'settings' | 'gas_guide' | 'login' | null>(null);
  const [targetItem, setTargetItem] = useState<DriveItem | null>(null);
  const [renameInput, setRenameInput] = useState<string>('');
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [isProcessingAction, setIsProcessingAction] = useState<boolean>(false);

  // --- QR 수업 관리 상태 ---
  const [qrLessonTitle, setQrLessonTitle] = useState<string>('');
  const [qrLessonPdfFile, setQrLessonPdfFile] = useState<File | null>(null);
  const [selectedDriveFileIds, setSelectedDriveFileIds] = useState<string[]>([]);
  const [editingQrLesson, setEditingQrLesson] = useState<DriveItem | null>(null);
  const [editLessonTitle, setEditLessonTitle] = useState<string>('');
  const [editSelectedDriveFileIds, setEditSelectedDriveFileIds] = useState<string[]>([]);
  const [existingAttachedFiles, setExistingAttachedFiles] = useState<AttachedFileItem[]>([]);
  const [activeQrLesson, setActiveQrLesson] = useState<DriveItem | null>(null);
  const [_qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [studentSubmissions, setStudentSubmissions] = useState<ClassNoteRecord[]>([]);
  const [selectedStudentNote, setSelectedStudentNote] = useState<ClassNoteRecord | null>(null);
  const [selectedStudentNotePageIdx] = useState<number>(0);
  const [selectedDateFilter, _setSelectedDateFilter] = useState<'today' | 'all'>('today');

  // --- 수업 세션 시작 모달 & 실시간 상태 관리 ---
  const [sessionPromptLesson, setSessionPromptLesson] = useState<DriveItem | null>(null);
  const [existingSessionCount, setExistingSessionCount] = useState<number>(0);
  const [_isRefreshingSubmissions, setIsRefreshingSubmissions] = useState<boolean>(false);
  const [isLoadingNoteDetail] = useState<boolean>(false);
  const [isQrLessonInitialClear, setIsQrLessonInitialClear] = useState<boolean>(false);

  // --- 🖥️ 전자칠판 라이브 수업 센터 전용 상태 ---
  const [whiteboardTeachersList, setWhiteboardTeachersList] = useState<any[]>([]);
  const [isLoadingWhiteboardLessons, setIsLoadingWhiteboardLessons] = useState<boolean>(false);
  const [selectedTeacherNameForBoard, setSelectedTeacherNameForBoard] = useState<string | null>(null);
  const [whiteboardViewMode, setWhiteboardViewMode] = useState<'hub' | 'drive'>('hub');
  const [whiteboardSessionPrompt, setWhiteboardSessionPrompt] = useState<{
    lesson: any;
    teacherName: string;
    hasExistingLive: boolean;
  } | null>(null);

  // --- 통합 PDF 모음집 생성 상태 ---
  const [pdfCompilationTitle, setPdfCompilationTitle] = useState<string>('');
  const [pdfSaveToDrive, setPdfSaveToDrive] = useState<boolean>(true);
  const [pdfDownloadLocal, setPdfDownloadLocal] = useState<boolean>(true);
  const [pdfPurgeSupabase, setPdfPurgeSupabase] = useState<boolean>(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  const [pdfProgress, setPdfProgress] = useState<{ current: number; total: number; name: string } | null>(null);

  const qrPdfInputRef = useRef<HTMLInputElement>(null);

  // 로그인 폼 상태
  const [loginTab, setLoginTab] = useState<'teacher' | 'admin'>('teacher');
  const [inputTeacherPw, setInputTeacherPw] = useState('');
  const [inputAdminId, setInputAdminId] = useState('');
  const [inputAdminPw, setInputAdminPw] = useState('');
  const [loginError, setLoginError] = useState('');

  // 설정 폼 임시 상태
  const [tempRootFolderId, setTempRootFolderId] = useState(rootFolderId);
  const [tempApiKey, setTempApiKey] = useState(googleApiKey);
  const [tempGasUrl, setTempGasUrl] = useState(gasUploadUrl);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentFolder = folderHistory[folderHistory.length - 1];

  // ==========================================================================
  // [알림 토스트 유틸 & 최신 배포 버전 자동 검사 엔진]
  // ==========================================================================
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(prev => (prev === msg ? null : prev));
    }, 3500);
  }, []);

  const { localVersion, isUpdating, newVersionInfo, checkVersion } = useAppVersionCheck({
    autoCheckOnMount: true,
    onToast: showToast
  });

  // 최상위 루트 폴더의 실제 선생님 폴더 목록 상태 (구글 드라이브 API v3 직접 조회 기반)
  const [rootTeacherFolders, setRootTeacherFolders] = useState<DriveItem[]>([]);

  // 구글 드라이브 최상위 루트 폴더에서 실제 등록된 선생님 폴더 목록을 항시 정확하게 조회
  const fetchRootTeacherFolders = useCallback(async () => {
    if (!rootFolderId) return [];
    try {
      let folders: DriveItem[] = [];
      if (googleApiKey) {
        // supportsAllDrives=true&includeItemsFromAllDrives=true 필수 포함 (구글 드라이브 404 차단 방지)
        const directUrl = `https://www.googleapis.com/drive/v3/files?q='${rootFolderId}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType)&orderBy=name&key=${googleApiKey}&_t=${Date.now()}`;
        const res = await fetch(directUrl);
        if (res.ok) {
          const data = await res.json();
          folders = (data.files || [])
            .filter((f: any) => !f.name.startsWith('[QR수업]'))
            .map((f: any) => ({
              id: f.id,
              name: f.name,
              type: 'folder' as const,
              folderId: f.id,
              size: '-',
              updatedAt: '-',
              viewUrl: `https://drive.google.com/drive/folders/${f.id}?usp=sharing`,
              downloadUrl: ''
            }));
        }
      }

      if (folders.length === 0) {
        const res = await fetch(`${apiBase}/api/drive?action=list&folderId=${rootFolderId}&_t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          folders = (data.items || []).filter((i: any) => i.type === 'folder' && !i.name.startsWith('[QR수업]'));
        }
      }

      setRootTeacherFolders(folders);
      return folders;
    } catch (err) {
      console.warn('선생님 폴더 목록 조회 오류:', err);
      return [];
    }
  }, [rootFolderId, googleApiKey, apiBase]);

  // 마운트 및 루트 폴더 설정 변경 시 구글 드라이브 실시간 선생님 폴더 즉시 조회
  useEffect(() => {
    fetchRootTeacherFolders();
  }, [fetchRootTeacherFolders]);

  // 선생님 폴더 이름 목록 (구글 드라이브 최상위 실제 폴더 목록 100% 반영)
  const driveTeacherFolders = useMemo(() => {
    return rootTeacherFolders.map(item => item.name);
  }, [rootTeacherFolders]);

  // 새 선생님 추가 핸들러: 구글 드라이브 최상위 폴더에 실제 폴더 생성 시도
  const handleAddTeacher = async (teacherName: string): Promise<{ success: boolean; error?: string }> => {
    const cleanName = teacherName.trim().replace(' 선생님', '').replace('선생님', '').trim();
    if (!cleanName) return { success: false, error: '선생님 이름을 입력해 주세요.' };

    showToast(`📁 구글 드라이브에 '${cleanName}' 선생님 폴더 생성을 시도합니다...`);

    try {
      const res = await executeDriveAction({
        action: 'createFolder',
        folderId: rootFolderId,
        name: cleanName
      });

      if (res && (res.folderId || res.id)) {
        await fetchRootTeacherFolders();
        loadWhiteboardTeacherLessons();
        showToast(`🎉 '${cleanName}' 선생님 폴더가 구글 드라이브에 생성되었습니다. (초기 비밀번호: 1234)`);
        return { success: true };
      } else {
        throw new Error(res?.error || '구글 드라이브 폴더 생성 실패');
      }
    } catch (err: any) {
      console.warn('구글 드라이브 선생님 폴더 생성 오류:', err);
      return { success: false, error: err.message || '구글 드라이브 시스템 권한(403) 오류' };
    }
  };

  // 현재 선생님 폴더에 있는 문서 파일 목록 (QR 수업 생성/수정 시 다중 선택 대상)
  const teacherDriveDocuments = useMemo(() => {
    return items.filter(item => item.type === 'document' && !item.name.endsWith('.json'));
  }, [items]);

  // 🖥️ 전자칠판 모드: 현재 선택된 선생님 데이터 (수업 목록 표시용)
  const selectedTeacherForWhiteboard = useMemo(() => {
    if (!whiteboardTeachersList.length) return null;
    return whiteboardTeachersList.find(t => t.teacherName === selectedTeacherNameForBoard) || whiteboardTeachersList[0];
  }, [whiteboardTeachersList, selectedTeacherNameForBoard]);

  // 선생님 폴더 탐색 및 자동 진입 헬퍼 (루트 폴더에서 정확히 해당 교사 이름 폴더를 탐색하여 진입)
  const findAndEnterTeacherFolder = async (rawName: string) => {
    const cleanTeacherName = rawName.replace('tch_', '').replace(' 선생님', '').trim();
    if (!cleanTeacherName) return;

    try {
      // 1. 구글 Drive API로 루트 폴더의 하위 폴더들을 직접 조회
      let rootFolders = rootTeacherFolders;
      if (rootFolders.length === 0) {
        rootFolders = await fetchRootTeacherFolders();
      }

      // 2. 해당 선생님 이름이 포함된 폴더 검색 (예: '이병우', '이병우 선생님')
      const matched = rootFolders.find(f => f.name.includes(cleanTeacherName) || cleanTeacherName.includes(f.name.replace(' 선생님', '')));
      if (matched) {
        setFolderHistory([{ id: matched.id, name: `${cleanTeacherName} 선생님 드라이브` }]);
        fetchDriveItems(matched.id);
      } else {
        console.warn(`선생님 폴더를 찾지 못했습니다: ${cleanTeacherName}`);
      }
    } catch (err) {
      console.warn('선생님 폴더 자동 진입 오류:', err);
    }
  };

  // 🖥️ 전자칠판 모드: 전체 선생님 목록 및 개설 수업 실시간 로드
  const loadWhiteboardTeacherLessons = async () => {
    setIsLoadingWhiteboardLessons(true);
    try {
      const teachers = await classroomRealtime.fetchAllTeacherLessons({
        rootFolderId,
        googleApiKey,
        apiBase
      });
      setWhiteboardTeachersList(teachers);
      if (teachers.length > 0) {
        if (!selectedTeacherNameForBoard || !teachers.some(t => t.teacherName === selectedTeacherNameForBoard)) {
          setSelectedTeacherNameForBoard(teachers[0].teacherName);
        }
      }
    } catch (err) {
      console.warn('전자칠판 수업 목록 로드 오류:', err);
    } finally {
      setIsLoadingWhiteboardLessons(false);
    }
  };

  // 마운트 시 세션 상태에 따라 해당 화면으로 자동 진입
  useEffect(() => {
    if (currentSession?.role === 'teacher') {
      findAndEnterTeacherFolder(currentSession.name || currentSession.id);
    } else if (currentSession?.role === 'whiteboard') {
      loadWhiteboardTeacherLessons();
    }
  }, [currentSession?.id, currentSession?.role]);

  const handlePortalLoginSuccess = (session: UserSession) => {
    setCurrentSessionState(session);
    if (session.role === 'admin') {
      setAuthMode('admin');
      localStorage.setItem('lbw_auth_mode', 'admin');
    } else if (session.role === 'teacher') {
      setAuthMode('teacher');
      localStorage.setItem('lbw_auth_mode', 'teacher');
      findAndEnterTeacherFolder(session.name || session.id);
    } else if (session.role === 'whiteboard') {
      setAuthMode('whiteboard');
      localStorage.setItem('lbw_auth_mode', 'whiteboard');
      loadWhiteboardTeacherLessons();
    } else {
      setAuthMode('guest');
      localStorage.setItem('lbw_auth_mode', 'guest');
    }
    showToast(`🎉 ${session.name}님으로 로그인되었습니다.`);
  };

  const handlePortalLogout = () => {
    setCurrentSession(null);
    setWhiteboardPermanentAuth(false);
    setCurrentSessionState(null);
    setAuthMode('guest');
    localStorage.removeItem('lbw_auth_mode');
    showToast('👋 로그아웃되었습니다.');
  };

  // ==========================================================================
  // [드라이브 폴더 데이터 실시간 로드 - 100% 구글 드라이브 실제 목록 연동]
  // ==========================================================================
  const fetchDriveItems = async (folderId: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    setSelectedItemId(null);

    // 1. 구글 공식 Drive API v3 직접 호출 최우선 실행 (100% 실제 데이터)
    if (googleApiKey) {
      try {
        const directUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=folder,name&key=${googleApiKey}&_t=${Date.now()}`;
        const gRes = await fetch(directUrl, { cache: 'no-store' });
        if (gRes.ok) {
          const gData = await gRes.json();
          const directItems: DriveItem[] = (gData.files || [])
            .map((file: any) => {
            const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
            const sizeBytes = file.size ? parseInt(file.size, 10) : 0;
            const sizeStr = sizeBytes > 0 
              ? sizeBytes > 1024 * 1024 
                ? `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB` 
                : `${(sizeBytes / 1024).toFixed(0)} KB` 
              : '-';

            return {
              id: file.id,
              name: file.name,
              type: isFolder ? 'folder' : 'document',
              folderId: isFolder ? file.id : undefined,
              size: isFolder ? '-' : sizeStr,
              updatedAt: file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString('ko-KR') : '-',
              viewUrl: isFolder 
                ? `https://drive.google.com/drive/folders/${file.id}?usp=sharing` 
                : `https://drive.google.com/file/d/${file.id}/view?usp=sharing`,
              downloadUrl: `${apiBase}/api/drive?action=download&fileId=${file.id}&fileName=${encodeURIComponent(file.name)}`
            };
          });
          setItems(directItems);
          setIsLoading(false);
          return;
        }
      } catch (directErr) {
        console.warn('Direct Google Drive API failed, fallback to proxy:', directErr);
      }
    }

    try {
      const queryParams = new URLSearchParams({
        action: 'list',
        folderId,
        _t: Date.now().toString(),
        ...(googleApiKey ? { apiKey: googleApiKey } : {})
      });

      const res = await fetch(`${apiBase}/api/drive?${queryParams.toString()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.items && Array.isArray(data.items)) {
          setItems(data.items);
          setIsLoading(false);
          return;
        }
      }
      throw new Error('데이터 응답 형식 오류');
    } catch (err: any) {
      console.warn('API 목록 조회 실패:', err);
      setItems([]);
      setErrorMessage(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDriveItems(currentFolder.id);
  }, [currentFolder.id, googleApiKey]);

  // 한국 표준시(KST) YYYY-MM-DD 날짜 문자열 변환 헬퍼 (UTC 시차 오류 완전 해결)
  const getKstDateString = (dateInput?: string | Date) => {
    const d = dateInput ? new Date(dateInput) : new Date();
    return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  };

  // 학생별 최신 1건만 유지하는 중복 제거 헬퍼
  const deduplicateSubmissions = (list: ClassNoteRecord[]): ClassNoteRecord[] => {
    const map = new Map<string, ClassNoteRecord>();
    for (const item of list) {
      const key = `${item.student_grade}_${item.student_class}_${item.student_num}`;
      if (!map.has(key)) {
        map.set(key, item);
      }
    }
    return Array.from(map.values());
  };

  // ==========================================================================
  // [전자칠판 라이브 대시보드: 학생 필기 실시간 수신 및 최신순 정렬 리스너]
  // ==========================================================================
  // 수동/자동 새로고침 함수 ref
  const refreshNotesRef = useRef<((isManual?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    if (activeModal !== 'qr_lesson_viewer' || !activeQrLesson) return;

    const currentLessonId = activeQrLesson.folderId || activeQrLesson.id;

    // 1. Supabase에서 경량 메타데이터만 0.2초 초고속 조회 (Statement Timeout 박멸!)
    const fetchExistingNotes = async (isManual = false) => {
      if (supabase && isSupabaseConfigured) {
        try {
          if (isManual) setIsRefreshingSubmissions(true);
          const { data, error } = await supabase
            .from('class_notes')
            .select('id, lesson_id, student_grade, student_class, student_num, student_name, created_at, updated_at')
            .eq('lesson_id', currentLessonId)
            .order('updated_at', { ascending: false });

          if (!error && data) {
            const deduplicated = deduplicateSubmissions(data);
            setStudentSubmissions(deduplicated);
            if (isManual) {
              showToast(`🔄 최신 학생 제출 현황을 갱신했습니다. (총 ${deduplicated.length}명)`);
            }
          }
        } catch (e) {
          console.warn('Supabase fetch notes error:', e);
        } finally {
          if (isManual) setIsRefreshingSubmissions(false);
        }
      }
    };

    refreshNotesRef.current = fetchExistingNotes;
    fetchExistingNotes();

    // 2. Supabase Realtime 채널 구독
    let sbChannel: any = null;
    if (supabase && isSupabaseConfigured) {
      try {
        sbChannel = supabase
          .channel(`lesson_${currentLessonId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'class_notes', filter: `lesson_id=eq.${currentLessonId}` },
            (payload) => {
              // 실시간 이벤트 수신 시 즉시 목록 갱신
              fetchExistingNotes();
              const newRecord = payload.new as ClassNoteRecord;
              if (newRecord && newRecord.student_name) {
                showToast(`🔔 ${newRecord.student_grade}-${newRecord.student_class} ${newRecord.student_name} 학생이 필기를 제출했습니다!`);
              }
            }
          )
          .subscribe();
      } catch (e) {
        console.warn('Realtime channel error:', e);
      }
    }

    // 3. 브라우저 로컬 브로드캐스트 채널 리스너 (동일 PC / 테스트 환경 0.01초 즉시 동기화)
    const handleLocalMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'STUDENT_SUBMIT') {
        const record = event.data.record as ClassNoteRecord;
        if (record && record.lesson_id === currentLessonId) {
          setStudentSubmissions(prev => {
            const filtered = prev.filter(p => !(p.student_grade === record.student_grade && p.student_class === record.student_class && p.student_num === record.student_num));
            return [record, ...filtered];
          });
          showToast(`🔔 ${record.student_grade}-${record.student_class} ${record.student_name} 학생이 필기를 제출했습니다!`);
        }
      }
    };

    if (localRealtimeChannel) {
      localRealtimeChannel.addEventListener('message', handleLocalMessage);
    }

    // 4. 백그라운드 3.5초 주기적 폴링 (Realtime 웹소켓 256KB 초과 누락 방지 완벽 보장)
    const pollInterval = setInterval(() => {
      fetchExistingNotes();
    }, 3500);

    return () => {
      clearInterval(pollInterval);
      if (sbChannel && supabase) supabase.removeChannel(sbChannel);
      if (localRealtimeChannel) localRealtimeChannel.removeEventListener('message', handleLocalMessage);
    };
  }, [activeModal, activeQrLesson]);

  // ==========================================================================
  // [구글 드라이브 통합 액션 실행 엔진]
  // ==========================================================================
  const executeDriveAction = async (payload: any): Promise<any> => {
    const finalGasUrl = gasUploadUrl || DEFAULT_GAS_UPLOAD_URL;


    try {
      const res = await fetch(`${apiBase}/api/drive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, gasUrl: finalGasUrl })
      });
      if (res.ok) {
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          if (data.success) return data;
          if (data.error) throw new Error(data.error);
        } catch (jsonErr: any) {
          throw new Error(jsonErr.message);
        }
      }
    } catch (proxyErr: any) {
      console.warn('Proxy drive action failed, trying direct GAS fetch:', proxyErr);
      if (proxyErr.message && (proxyErr.message.includes('액세스') || proxyErr.message.includes('권한'))) {
        throw proxyErr;
      }
    }

    if (finalGasUrl) {
      try {
        const directRes = await fetch(finalGasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });
        const directText = await directRes.text();
        let directData;
        try {
          directData = JSON.parse(directText);
        } catch {
          throw new Error('Google Apps Script 웹 앱 권한 오류 (HTML 응답 수신됨)');
        }
        if (!directData.success) {
          throw new Error(directData.error || '요청 처리에 실패했습니다.');
        }
        return directData;
      } catch (directErr: any) {
        throw new Error(directErr.message || '요청 처리에 실패했습니다.');
      }
    }

    throw new Error('Google Apps Script 업로드 URL이 설정되어 있지 않습니다.');
  };

  // ==========================================================================
  // [폴더 진입 및 브레드크럼]
  // ==========================================================================
  const handleOpenFolder = (folderId: string, folderName: string) => {
    setFolderHistory(prev => [...prev, { id: folderId, name: folderName }]);
    setSearchTerm('');
  };

  const handleBreadcrumbClick = (index: number) => {
    setFolderHistory(prev => prev.slice(0, index + 1));
    setSearchTerm('');
  };

  // ==========================================================================
  // [구형 전자칠판 내장브라우저 100% 호환 다운로드 엔진]
  // ==========================================================================
  const handleDownload = (item: DriveItem) => {
    showToast(`⚡ '${item.name}' 다운로드를 시작합니다...`);

    // 1. 호스트 환경에 따른 최적 다운로드 URL 결정 (로컬/Vercel 프록시 vs GitHub Pages)
    let proxyUrl = `${apiBase}/api/drive?action=download&fileId=${item.id}&fileName=${encodeURIComponent(item.name)}`;

    // 2. 구형 전자칠판 내장 브라우저 (Android 7~10 WebKit/Chromium) 특화:
    // 화면 이탈(화면 깜빡임 또는 빈 화면) 없이 시스템 다운로더를 트리거하는 숨겨진 iframe 활용
    try {
      let iframe = document.getElementById('gdrive-download-iframe') as HTMLIFrameElement;
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'gdrive-download-iframe';
        iframe.style.display = 'none';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        document.body.appendChild(iframe);
      }
      iframe.src = proxyUrl;
    } catch (iframeErr) {
      console.warn('Iframe download trigger warning:', iframeErr);
    }

    // 3. 최신 브라우저를 위한 <a> 태그 다운로드 동시 트리거 (듀얼 fallback)
    try {
      const link = document.createElement('a');
      link.href = proxyUrl;
      link.setAttribute('download', item.name);
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        if (document.body.contains(link)) {
          document.body.removeChild(link);
        }
      }, 300);
    } catch (aErr) {
      console.warn('Anchor download fallback warning:', aErr);
    }
  };

  // ==========================================================================
  // [새 폴더 만들기]
  // ==========================================================================
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      showToast('⚠️ 기본 모드(다운로드 전용)입니다. 선생님 로그인 후 가능합니다.');
      return;
    }
    if (!newFolderName.trim()) return;

    setIsProcessingAction(true);
    try {
      await executeDriveAction({
        action: 'createFolder',
        folderId: currentFolder.id,
        name: newFolderName.trim()
      });
      showToast(`📁 '${newFolderName.trim()}' 폴더가 생성되었습니다.`);
      setActiveModal(null);
      setNewFolderName('');
      fetchDriveItems(currentFolder.id);
    } catch (err: any) {
      showToast(`❌ 폴더 생성 실패: ${err.message}`);
      if (err.message && (err.message.includes('지원되지 않는') || err.message.includes('DriveApp'))) {
        setActiveModal('gas_guide');
      }
    } finally {
      setIsProcessingAction(false);
    }
  };

  // ==========================================================================
  // [QR 수업 판별 헬퍼]
  // ==========================================================================
  const isQrLessonItem = (item: DriveItem) => {
    return item.type === 'folder' && (item.name.startsWith('[QR수업]') || item.name.includes('[QR수업]'));
  };

  // ==========================================================================
  // [QR코드 수업 만들기: 폴더 생성 + 다중 파일 첨부 + lesson_config.json + Supabase 등록]
  // ==========================================================================
  const handleCreateQrLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      showToast('⚠️ 기본 모드(다운로드 전용)입니다. 선생님 로그인 후 가능합니다.');
      return;
    }
    const cleanTitle = qrLessonTitle.trim();
    if (!cleanTitle) {
      showToast('⚠️ 수업 제목을 입력해 주세요.');
      return;
    }

    setIsProcessingAction(true);
    const folderName = `[QR수업] ${cleanTitle}`;
    showToast(`📱 '${folderName}' 수업 폴더를 생성합니다...`);

    try {
      // 1. 구글 드라이브에 수업 전용 폴더 생성 (GAS 웹앱 경유)
      const folderRes = await executeDriveAction({
        action: 'createFolder',
        folderId: currentFolder.id,
        name: folderName
      });

      if (!folderRes || !folderRes.folderId) {
        throw new Error(folderRes?.error || '구글 드라이브에 폴더를 생성하지 못했습니다. Google Apps Script 배포 설정(모든 사용자 권한)을 확인해 주세요.');
      }

      const lessonFolderId = folderRes.folderId;
      const lessonId = lessonFolderId;
      const attachedFilesList: AttachedFileItem[] = [];

      // 2. 학습지 로컬 파일이 첨부되었으면 폴더 내에 업로드
      if (qrLessonPdfFile) {
        showToast(`📄 학습지 '${qrLessonPdfFile.name}' 업로드 중...`);
        const pdfBase64 = await fileToBase64(qrLessonPdfFile);
        const uploadPdfRes = await executeDriveAction({
          action: 'upload',
          folderId: lessonFolderId,
          name: qrLessonPdfFile.name,
          mimeType: qrLessonPdfFile.type || 'application/pdf',
          base64: pdfBase64
        });
        if (uploadPdfRes && (uploadPdfRes.fileId || uploadPdfRes.id)) {
          const fileId = uploadPdfRes.fileId || uploadPdfRes.id;
          attachedFilesList.push({
            id: fileId,
            name: qrLessonPdfFile.name,
            downloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
            mimeType: qrLessonPdfFile.type || 'application/pdf'
          });
        }
      }

      // 3. 선생님 구글 드라이브 폴더에서 다중 선택한 파일들 추가
      const selectedDriveDocs = teacherDriveDocuments.filter(doc => selectedDriveFileIds.includes(doc.id));
      for (const doc of selectedDriveDocs) {
        attachedFilesList.push({
          id: doc.id,
          name: doc.name,
          downloadUrl: doc.downloadUrl || `https://drive.google.com/uc?export=download&id=${doc.id}`,
          viewUrl: doc.viewUrl,
          size: doc.size
        });
      }

      // 4. 수업 설정(Config) JSON 데이터 생성
      const lessonConfig = {
        lessonId,
        title: cleanTitle,
        folderId: lessonFolderId,
        teacherPin: '1234',
        createdAt: new Date().toISOString(),
        pdfFileId: attachedFilesList[0]?.id,
        pdfFileName: attachedFilesList[0]?.name,
        attachedFiles: attachedFilesList
      };

      // 5. Supabase에 수업 세션(학생앱 실시간 및 오프라인 공책 목록 노출용) 즉시 등록
      const rawTeacherName = currentSession?.name || '선생님';
      const cleanTeacherName = rawTeacherName.replace(' 선생님', '').trim();
      await classroomRealtime.registerTeacherSession({
        lessonId: lessonFolderId,
        teacherName: cleanTeacherName,
        lessonTitle: cleanTitle,
        pdfId: attachedFilesList[0]?.id,
        pdfName: attachedFilesList[0]?.name,
        attachedFiles: attachedFilesList,
        isLive: false
      }).catch((sbErr) => console.warn('Supabase register error:', sbErr));

      // 6. 구글 드라이브 lesson_config.json 업로드
      try {
        const configJsonBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(lessonConfig, null, 2))));
        await executeDriveAction({
          action: 'upload',
          folderId: lessonFolderId,
          name: 'lesson_config.json',
          mimeType: 'application/json',
          base64: configJsonBase64
        });
      } catch (cfgErr) {
        console.warn('lesson_config.json upload warning:', cfgErr);
      }

      showToast(`🎉 '${cleanTitle}' QR 대화형 수업이 구글 드라이브에 성공적으로 개설되었습니다! (자료 ${attachedFilesList.length}개 첨부됨)`);
      setActiveModal(null);
      setQrLessonTitle('');
      setQrLessonPdfFile(null);
      setSelectedDriveFileIds([]);
      fetchDriveItems(currentFolder.id);
    } catch (err: any) {
      console.error('QR 수업 생성 오류:', err);
      const isGasPermErr = err.message && (err.message.includes('액세스') || err.message.includes('권한') || err.message.includes('403') || err.message.includes('Google Apps Script'));
      if (isGasPermErr) {
        setActiveModal('gas_guide');
        showToast('⚠️ 구글 드라이브 폴더 생성을 위해 Google Apps Script 배포 권한("모든 사용자") 확인이 필요합니다.');
      } else {
        showToast(`❌ 수업 생성 실패: ${err.message}`);
      }
    } finally {
      setIsProcessingAction(false);
    }
  };

  // ==========================================================================
  // [QR 수업 수정 모달 열기 및 기존 첨부자료 동기화]
  // ==========================================================================
  const handleOpenEditQrLesson = async (item: DriveItem) => {
    setEditingQrLesson(item);
    setEditLessonTitle(item.name.replace('[QR수업]', '').trim());
    setActiveModal('edit_qr_lesson');

    const lessonFolderId = item.folderId || item.id;
    if (supabase && isSupabaseConfigured) {
      try {
        const { data } = await supabase
          .from('class_notes')
          .select('strokes_data')
          .eq('lesson_id', lessonFolderId)
          .eq('student_grade', '_TEACHER_SESSION_')
          .maybeSingle();

        if (data?.strokes_data?.attachedFiles) {
          const files: AttachedFileItem[] = data.strokes_data.attachedFiles;
          setExistingAttachedFiles(files);
          setEditSelectedDriveFileIds(files.map(f => f.id));
          return;
        }
      } catch (err) {
        console.warn('기존 수업 첨부자료 조회 오류:', err);
      }
    }
    setExistingAttachedFiles([]);
    setEditSelectedDriveFileIds([]);
  };

  // ==========================================================================
  // [QR 수업 수정 저장: 폴더명 변경 + 다중 선택 자료 갱신 + Supabase 갱신]
  // ==========================================================================
  const handleSaveEditQrLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingQrLesson) return;
    const cleanTitle = editLessonTitle.trim();
    if (!cleanTitle) {
      showToast('⚠️ 수업 제목을 입력해 주세요.');
      return;
    }

    setIsProcessingAction(true);
    const lessonFolderId = editingQrLesson.folderId || editingQrLesson.id;
    const newFolderName = `[QR수업] ${cleanTitle}`;

    try {
      // 1. 다중 선택된 구글 드라이브 파일 목록 완벽 조합
      const newAttachedFiles: AttachedFileItem[] = [];

      // A) 현재 폴더의 파일 중 선택된 것들
      const selectedDocs = teacherDriveDocuments.filter(doc => editSelectedDriveFileIds.includes(doc.id));
      for (const doc of selectedDocs) {
        newAttachedFiles.push({
          id: doc.id,
          name: doc.name,
          downloadUrl: doc.downloadUrl || `https://drive.google.com/uc?export=download&id=${doc.id}`,
          viewUrl: doc.viewUrl,
          size: doc.size
        });
      }

      // B) 기존에 첨부되어 있던 파일 중 여전히 체크된 것들 보존
      for (const existing of existingAttachedFiles) {
        if (editSelectedDriveFileIds.includes(existing.id) && !newAttachedFiles.some(f => f.id === existing.id)) {
          newAttachedFiles.push(existing);
        }
      }

      // 2. [최우선 실행] Supabase 세션 정보 즉시 저장 (지연/오류 없이 100% 반영!)
      const rawTeacherName = currentSession?.name || '선생님';
      const cleanTeacherName = rawTeacherName.replace(' 선생님', '').trim();
      await classroomRealtime.registerTeacherSession({
        lessonId: lessonFolderId,
        teacherName: cleanTeacherName,
        lessonTitle: cleanTitle,
        pdfId: newAttachedFiles[0]?.id,
        pdfName: newAttachedFiles[0]?.name,
        attachedFiles: newAttachedFiles,
        isLive: false
      });

      // 3. 구글 드라이브 폴더명 변경 및 lesson_config.json 업로드는 백그라운드 안전 실행
      (async () => {
        try {
          if (editingQrLesson.name !== newFolderName) {
            await executeDriveAction({
              action: 'rename',
              id: lessonFolderId,
              name: newFolderName
            }).catch(() => {});
          }

          const lessonConfig = {
            lessonId: lessonFolderId,
            title: cleanTitle,
            folderId: lessonFolderId,
            teacherPin: '1234',
            updatedAt: new Date().toISOString(),
            pdfFileId: newAttachedFiles[0]?.id,
            pdfFileName: newAttachedFiles[0]?.name,
            attachedFiles: newAttachedFiles
          };
          const configJsonBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(lessonConfig, null, 2))));
          await executeDriveAction({
            action: 'upload',
            folderId: lessonFolderId,
            name: 'lesson_config.json',
            mimeType: 'application/json',
            base64: configJsonBase64
          }).catch(() => {});
        } catch (gErr) {
          console.warn('구글 드라이브 동기화 백그라운드 경고:', gErr);
        }
      })();

      showToast(`🎉 '${cleanTitle}' 수업 정보 및 첨부자료(${newAttachedFiles.length}개)가 성공적으로 저장되었습니다!`);
      setActiveModal(null);
      setEditingQrLesson(null);
      fetchDriveItems(currentFolder.id);
    } catch (err: any) {
      console.error('수업 수정 오류:', err);
      showToast(`❌ 수업 수정 실패: ${err.message}`);
    } finally {
      setIsProcessingAction(false);
    }
  };


  // ==========================================================================
  // [QR 수업 대화형 실행: 세션 선택 모달 & 이어하기 / 새로 갱신 분기]
  // ==========================================================================
  const handleOpenQrLesson = async (item: DriveItem) => {
    const currentLessonId = item.folderId || item.id;
    let existingCount = 0;

    // ⚡ 1.2초 타임아웃 가드 (Supabase 일시중지/지연 시 화면 멈춤 원천 차단)
    if (supabase && isSupabaseConfigured) {
      try {
        const sbPromise = supabase
          .from('class_notes')
          .select('id', { count: 'exact', head: true })
          .eq('lesson_id', currentLessonId);
        const timeoutPromise = new Promise<any>((resolve) =>
          setTimeout(() => resolve({ count: null, error: new Error('TIMEOUT') }), 1200)
        );
        const { count, error } = await Promise.race([sbPromise, timeoutPromise]);
        if (!error && typeof count === 'number') {
          existingCount = count;
        }
      } catch (e) {
        console.warn('기존 수업 제출 확인 오류:', e);
      }
    }

    if (existingCount > 0) {
      // 기존 제출된 기록이 있는 경우: 이어하기 vs 새로 갱신 모달 팝업
      setSessionPromptLesson(item);
      setExistingSessionCount(existingCount);
      setActiveModal('lesson_session_prompt');
      return;
    }

    // 기존 기록이 없으면 바로 수업 대시보드 열기
    await startQrLessonViewer(item, false);
  };

  // ==========================================================================
  // [🖥️ 전자칠판 라이브 수업 센터: 수업 선택 및 중복 진행 세션 분기]
  // ==========================================================================
  const handleWhiteboardSelectLesson = async (teacherName: string, lesson: any) => {
    const anyLive = whiteboardTeachersList.some(t => t.lessons.some((l: any) => l.isLive));
    const thisLessonLive = !!lesson.isLive;

    if (anyLive || thisLessonLive) {
      setWhiteboardSessionPrompt({
        lesson,
        teacherName,
        hasExistingLive: true
      });
      return;
    }

    await handleLaunchWhiteboardLesson(teacherName, lesson, false);
  };

  const handleLaunchWhiteboardLesson = async (teacherName: string, lesson: any, terminatePrevious: boolean) => {
    if (terminatePrevious) {
      await classroomRealtime.closeAllOtherActiveSessions(lesson.lessonId);
      showToast('🔄 이전 수업을 종료하고 새 수업을 개시합니다.');
    }

    const driveItem: DriveItem = {
      id: lesson.lessonId,
      name: `[QR수업] ${lesson.title}`,
      type: 'folder',
      folderId: lesson.lessonId,
      updatedAt: lesson.createdAt || new Date().toISOString(),
      viewUrl: '',
      downloadUrl: ''
    };
    (driveItem as any).pdfFileId = lesson.pdfId;
    (driveItem as any).pdfFileName = lesson.pdfName;
    (driveItem as any).attachedFiles = lesson.attachedFiles || [];
    (driveItem as any).teacherName = teacherName;

    setWhiteboardSessionPrompt(null);
    await startQrLessonViewer(driveItem, terminatePrevious);

    await classroomRealtime.registerTeacherSession({
      lessonId: lesson.lessonId,
      teacherName: teacherName,
      lessonTitle: lesson.title,
      pdfId: lesson.pdfId,
      pdfName: lesson.pdfName,
      attachedFiles: lesson.attachedFiles,
      isLive: true
    });

    loadWhiteboardTeacherLessons();
  };

  // 실제 QR 수업 대시보드 진입 실행 함수
  const startQrLessonViewer = async (item: DriveItem, clearExisting: boolean) => {
    const currentLessonId = item.folderId || item.id;
    if (clearExisting) {
      // 1. Vercel 클라우드 릴레이 세션 초기화
      try {
        fetch(`${apiBase}/api/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reset', lessonId: currentLessonId })
        }).catch(() => {});
      } catch {}

      // 2. Supabase 비동기 삭제 (비차단 1.5초 타임아웃 가드)
      if (supabase && isSupabaseConfigured) {
        try {
          const delPromise = supabase.from('class_notes').delete().eq('lesson_id', currentLessonId);
          const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 1500));
          Promise.race([delPromise, timeoutPromise]).catch(() => {});
        } catch (e) {
          console.warn('초기화 오류:', e);
        }
      }
      setStudentSubmissions([]);
      showToast('✨ 이전 기록을 모두 초기화하고 새 수업을 시작합니다.');
    }

    // Supabase 세션 row에서 첨부파일 및 PDF 정보 자동 보충 조회
    if (supabase && isSupabaseConfigured && !(item as any).attachedFiles?.length) {
      try {
        const { data: sessionData } = await supabase
          .from('class_notes')
          .select('strokes_data')
          .eq('lesson_id', currentLessonId)
          .eq('student_grade', '_TEACHER_SESSION_')
          .maybeSingle();
        if (sessionData?.strokes_data) {
          if (sessionData.strokes_data.pdfId && !(item as any).pdfFileId) (item as any).pdfFileId = sessionData.strokes_data.pdfId;
          if (sessionData.strokes_data.pdfName && !(item as any).pdfFileName) (item as any).pdfFileName = sessionData.strokes_data.pdfName;
          if (sessionData.strokes_data.attachedFiles && !(item as any).attachedFiles?.length) {
            (item as any).attachedFiles = sessionData.strokes_data.attachedFiles;
          }
        }
      } catch (sbFetchErr) {
        console.warn('세션 메타데이터 보충 조회 실패:', sbFetchErr);
      }
    }

    if (currentSession?.name && !(item as any).teacherName) {
      (item as any).teacherName = currentSession.name.replace(' 선생님', '').trim();
    }

    setIsQrLessonInitialClear(clearExisting);
    setActiveQrLesson(item);
    setActiveModal('qr_lesson_viewer');

    const cleanTitle = item.name.replace('[QR수업]', '').trim();
    const currentPath = typeof window !== 'undefined' ? window.location.pathname.replace(/\/$/, '') : '';
    const baseOrigin = typeof window !== 'undefined'
      ? (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
          ? 'https://devoursky-dot.github.io/LBWTEST'
          : `${window.location.origin}${currentPath}`)
      : 'https://devoursky-dot.github.io/LBWTEST';
    const studentUrl = buildLessonUrl(baseOrigin, {
      lessonId: currentLessonId,
      title: cleanTitle,
      pdfId: (item as any).pdfFileId,
      pdfName: (item as any).pdfFileName
    });

    // 교사 세션 Supabase 등록 (학생이 [선생님 목록 ➔ 수업 목록]에서 선택할 수 있도록 활성화)
    const rawTeacherName = currentSession?.name || '선생님';
    const cleanTeacherName = rawTeacherName.replace(' 선생님', '').trim();
    classroomRealtime.registerTeacherSession({
      lessonId: currentLessonId,
      teacherName: cleanTeacherName,
      lessonTitle: cleanTitle,
      pdfId: (item as any).pdfFileId,
      pdfName: (item as any).pdfFileName
    }).catch(() => {});

    try {
      const qrDataUrl = await QRCode.toDataURL(studentUrl, {
        width: 320,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      });
      setQrCodeDataUrl(qrDataUrl);
    } catch (qrErr) {
      console.error('QR 코드 생성 실패:', qrErr);
    }
  };

  // ==========================================================================
  // [전체 학생 필기 모음집 단일 PDF 생성 및 구글드라이브 업로드]
  // ==========================================================================
  const handleCompileAndSavePdf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeQrLesson) return;
    const lessonFolderId = activeQrLesson.folderId || activeQrLesson.id;
    const cleanLessonTitle = activeQrLesson.name.replace('[QR수업]', '').trim();

    // 한국 표준시(KST) 오늘 날짜 또는 전체 필터에 맞춘 제출 학생 목록
    const todayStr = getKstDateString();
    const targetNotes = studentSubmissions.filter(sub => {
      if (selectedDateFilter === 'all') return true;
      const datePart = getKstDateString(sub.updated_at || sub.created_at);
      return !datePart || datePart === todayStr;
    });

    if (targetNotes.length === 0) {
      showToast('⚠️ 모음집으로 저장할 학생 필기 제출 내역이 없습니다.');
      return;
    }

    setIsGeneratingPdf(true);
    setPdfProgress({ current: 0, total: targetNotes.length, name: 'PDF 생성 시작...' });
    showToast(`📄 ${targetNotes.length}명 학생 필기를 하나의 통합 PDF로 모으는 중...`);

    try {
      // PDF 생성을 위해 누락된 필기 데이터(strokes_data)를 대상 학생 ID로 일괄 보충 조회
      const noteIds = targetNotes.map(n => n.id).filter(Boolean);
      let notesWithStrokes = [...targetNotes];
      if (supabase && isSupabaseConfigured && noteIds.length > 0) {
        try {
          const { data: fullData, error: fetchErr } = await supabase
            .from('class_notes')
            .select('*')
            .in('id', noteIds);
          if (!fetchErr && fullData && fullData.length > 0) {
            notesWithStrokes = fullData;
          }
        } catch (fErr) {
          console.warn('PDF 병합용 스트로크 보충 조회 실패, 기존 캐시 사용:', fErr);
        }
      }

      const result = await generateClassSubmissionPdf({
        lessonTitle: cleanLessonTitle,
        customTitle: pdfCompilationTitle.trim() || cleanLessonTitle,
        notes: notesWithStrokes,
        onProgress: (current, total, name) => {
          setPdfProgress({ current, total, name });
        }
      });

      // 1. 내 컴퓨터로 즉시 다운로드 (옵션)
      if (pdfDownloadLocal) {
        const url = URL.createObjectURL(result.pdfBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 500);
      }

      // 2. 구글 드라이브 해당 수업 폴더로 단 1회 안전 업로드 (옵션)
      if (pdfSaveToDrive) {
        showToast(`☁️ 구글 드라이브에 '${result.fileName}' 업로드 중...`);
        await executeDriveAction({
          action: 'upload',
          folderId: lessonFolderId,
          name: result.fileName,
          mimeType: 'application/pdf',
          base64: result.pdfBase64
        });
        fetchDriveItems(currentFolder.id);
      }

      // 3. Supabase 임시 제출 내역 정리 (선택 옵션)
      if (pdfPurgeSupabase && supabase && isSupabaseConfigured) {
        try {
          await supabase.from('class_notes').delete().eq('lesson_id', lessonFolderId);
          setStudentSubmissions([]);
        } catch (e) {
          console.warn('Supabase purge error:', e);
        }
      }

      showToast(`🎉 '${result.fileName}' (${targetNotes.length}명) 수업 모음집 PDF가 저장되었습니다!`);
      setActiveModal('qr_lesson_viewer');
    } catch (err: any) {
      console.error('PDF 컴파일 오류:', err);
      showToast(`❌ PDF 생성 실패: ${err.message}`);
    } finally {
      setIsGeneratingPdf(false);
      setPdfProgress(null);
    }
  };

  // ==========================================================================
  // [이름 바꾸기]
  // ==========================================================================
  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      showToast('⚠️ 기본 모드(다운로드 전용)입니다. 선생님 로그인 후 가능합니다.');
      return;
    }
    if (!targetItem || !renameInput.trim()) return;

    if (renameInput.trim() === targetItem.name) {
      setActiveModal(null);
      return;
    }

    setIsProcessingAction(true);
    try {
      await executeDriveAction({
        action: 'rename',
        id: targetItem.id,
        name: renameInput.trim(),
        isFolder: targetItem.type === 'folder'
      });
      showToast(`✏️ 이름이 '${renameInput.trim()}'(으)로 변경되었습니다.`);
      setActiveModal(null);
      setTargetItem(null);
      fetchDriveItems(currentFolder.id);
    } catch (err: any) {
      showToast(`❌ 이름 변경 실패: ${err.message}`);
      if (err.message && (err.message.includes('지원되지 않는') || err.message.includes('DriveApp'))) {
        setActiveModal('gas_guide');
      }
    } finally {
      setIsProcessingAction(false);
    }
  };

  // ==========================================================================
  // [휴지통으로 이동(삭제)]
  // ==========================================================================
  const handleDelete = async () => {
    if (!canEdit) {
      showToast('⚠️ 기본 모드(다운로드 전용)입니다. 삭제는 선생님 로그인 후 가능합니다.');
      return;
    }
    if (!targetItem) return;

    setIsProcessingAction(true);
    const targetId = targetItem.folderId || targetItem.id;
    const cleanItemName = targetItem.name.replace('[QR수업]', '').trim();

    try {
      // 1. 구글 드라이브 실제 휴지통 이동 실행 (GAS 웹앱 경유)
      await executeDriveAction({
        action: 'delete',
        id: targetId,
        isFolder: targetItem.type === 'folder'
      });

      // 2. 구글 드라이브 삭제 성공 시에만 로컬 UI 및 목록 반영
      setItems(prev => prev.filter(i => (i.folderId || i.id) !== targetId && i.id !== targetId));
      setSelectedItemId(null);
      setActiveModal(null);
      setTargetItem(null);
      showToast(`🗑️ '${cleanItemName}' 항목이 구글 드라이브에서 삭제되었습니다.`);

      // 3. Supabase 수업 세션 및 모든 학생 필기 레코드 연동 정리
      if (supabase && isSupabaseConfigured) {
        try {
          await supabase.from('class_notes').delete().eq('lesson_id', targetId);
          fetch(`${apiBase}/api/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'reset', lessonId: targetId })
          }).catch(() => {});
        } catch (sbErr) {
          console.warn('Supabase 수업 세션 정리 오류:', sbErr);
        }
      }

      // 최신 목록 재조회
      fetchDriveItems(currentFolder.id);
    } catch (err: any) {
      console.error('구글 드라이브 삭제 실패:', err);
      setActiveModal(null);
      setTargetItem(null);
      showToast(`❌ 구글 드라이브 삭제 실패: ${err.message || '구글 드라이브 시스템 권한(403) 오류'}\n(구글 드라이브 웹 화면에서 직접 삭제해 주세요.)`);
    } finally {
      setIsProcessingAction(false);
    }
  };

  // ==========================================================================
  // [파일 업로드 처리]
  // ==========================================================================
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = error => reject(error);
    });
  };

  const handleUploadFiles = async (files: File[]) => {
    if (!canEdit) {
      showToast('⚠️ 기본 모드(다운로드 전용)입니다. 파일 업로드는 선생님 로그인 후 가능합니다.');
      return;
    }
    if (files.length === 0) return;
    showToast(`🚀 ${files.length}개 파일 업로드를 시작합니다...`);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        showToast(`(${i + 1}/${files.length}) '${file.name}' 업로드 중...`);
        const base64 = await fileToBase64(file);
        await executeDriveAction({
          action: 'upload',
          folderId: currentFolder.id,
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          base64: base64
        });
      }
      showToast(`🎉 ${files.length}개 파일이 성공적으로 업로드되었습니다!`);
      fetchDriveItems(currentFolder.id);
    } catch (err: any) {
      showToast(`❌ 업로드 실패: ${err.message}`);
    }
  };

  // ==========================================================================
  // [인증 로그인 처리: 선생님 / 최고 관리자]
  // ==========================================================================
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');

    if (loginTab === 'teacher') {
      const isCorrect = await verifyWhiteboardPassword(inputTeacherPw.trim());
      if (isCorrect) {
        setAuthMode('teacher');
        localStorage.setItem('lbw_auth_mode', 'teacher');
        setActiveModal(null);
        setInputTeacherPw('');
        showToast('👨‍🏫 선생님 모드로 인증되었습니다.');
      } else {
        setLoginError('선생님 비밀번호가 일치하지 않습니다.');
      }
    } else {
      const isCorrect = await verifyAdminPassword(inputAdminPw.trim());
      if (inputAdminId.trim() === ADMIN_ID && isCorrect) {
        setAuthMode('admin');
        localStorage.setItem('lbw_auth_mode', 'admin');
        setActiveModal(null);
        setInputAdminId('');
        setInputAdminPw('');
        showToast('🛡️ 시스템 관리자로 인증되었습니다.');
      } else {
        setLoginError('관리자 아이디 또는 비밀번호가 올바르지 않습니다.');
      }
    }
  };

  // ==========================================================================
  // [검색 및 정렬 필터링]
  // ==========================================================================
  const filteredItems = useMemo(() => {
    const list = items.filter(item => 
      item.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
    return [...list].sort((a, b) => {
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;
      return a.name.localeCompare(b.name, 'ko');
    });
  }, [items, searchTerm]);

  const selectedItem = useMemo(() => {
    return items.find(i => i.id === selectedItemId) || null;
  }, [items, selectedItemId]);

  // 파일 아이콘 렌더러
  const getItemIcon = (item: DriveItem) => {
    if (item.type === 'folder') return '📁';
    const lower = item.name.toLowerCase();
    if (lower.endsWith('.pdf')) return '📕';
    if (lower.endsWith('.hwp') || lower.endsWith('.hwpx')) return '📘';
    if (lower.endsWith('.ppt') || lower.endsWith('.pptx')) return '📙';
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return '🖼️';
    if (lower.endsWith('.zip') || lower.endsWith('.rar')) return '🗜️';
    if (lower.endsWith('.mp4') || lower.endsWith('.mov')) return '🎬';
    return '📄';
  };

  // 학생 QR 수업 모드 진입인 경우 학생 전용 삼성노트 REA 필기 뷰어 렌더링
  if (studentLessonParam) {
    return (
      <StudentLessonView
        lessonId={studentLessonParam.lessonId}
        lessonTitle={studentLessonParam.title}
        initialPdfId={studentLessonParam.pdfId}
        initialPdfName={studentLessonParam.pdfName}
        onExit={() => {
          window.location.href = window.location.pathname;
        }}
      />
    );
  }

  // 최신 버전 업데이트 오버레이가 활성화된 경우 전체화면 안내 및 리로드
  if (isUpdating) {
    return <VersionUpdateOverlay isOpen={true} newVersionTime={newVersionInfo?.buildTime} />;
  }

  // 첫 화면: 인증 세션이 없으면 통합 포털 로그인 게이트웨이 렌더링
  // (전자칠판에서 1회 입력해 두었다면 영구 인증으로 자동 통과)
  if (!currentSession) {
    return (
      <>
        <PortalLoginView
          driveTeacherFolders={driveTeacherFolders}
          onLoginSuccess={handlePortalLoginSuccess}
          appVersion={localVersion.version}
          buildTime={localVersion.buildTime}
          onCheckVersion={() => checkVersion(true)}
        />
        <VersionUpdateOverlay isOpen={isUpdating} newVersionTime={newVersionInfo?.buildTime} />
      </>
    );
  }

  // 학생 역할로 로그인한 경우: 전용 필기앱(StudentLessonView)을 즉시 실행
  if (currentSession.role === 'student') {
    const studentParsed = parseStudentId(currentSession.id);
    const personalLessonId = `student_note_${currentSession.id}`;
    const personalTitle = currentSession.name
      ? `${currentSession.name}의 스마트 디지털 노트`
      : `${studentParsed.label}의 스마트 디지털 노트`;

    return (
      <StudentLessonView
        lessonId={personalLessonId}
        lessonTitle={personalTitle}
        onExit={() => {
          handlePortalLogout();
        }}
      />
    );
  }

  // 최고관리자 역할로 로그인한 경우: 설정 & 회원관리 전용 대시보드를 즉시 실행
  if (currentSession.role === 'admin') {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#0a0a0a', color: '#ffffff' }}>
        <AdminDashboardModal
          driveFolderNames={driveTeacherFolders}
          onClose={handlePortalLogout}
          onToast={showToast}
          onAddTeacher={handleAddTeacher}
          onRefreshDriveFolders={fetchRootTeacherFolders}
        />
        {toastMessage && (
          <div className="toast-container">
            <span>🔔</span>
            <span>{toastMessage}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div 
      className="gdrive-app"
      onDragOver={(e) => { e.preventDefault(); setIsDraggingGlobal(true); }}
      onDragLeave={() => setIsDraggingGlobal(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingGlobal(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleUploadFiles(Array.from(e.dataTransfer.files));
        }
      }}
      onClick={() => {
        setIsNewMenuOpen(false);
      }}
    >
      {/* ====================================================================
          1. 상단 구글 드라이브 헤더
          ==================================================================== */}
      <header className="gdrive-header">
        <div 
          className="gdrive-logo-group"
          onClick={() => {
            setFolderHistory([{ id: rootFolderId, name: '내 드라이브' }]);
            setSearchTerm('');
          }}
        >
          <div className="gdrive-logo-icon">
            {/* Google Drive 공식 SVG 아이콘 */}
            <svg width="34" height="30" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
              <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
              <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
              <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
              <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
              <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
              <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
            </svg>
          </div>
          <span className="gdrive-logo-text">Drive</span>
          <span className="gdrive-logo-sub">전자칠판 허브</span>
        </div>

        {/* 타원형 검색 바 */}
        <div className="gdrive-search-bar" onClick={(e) => e.stopPropagation()}>
          <span style={{ fontSize: '18px', color: 'var(--g-text-muted)' }}>🔍</span>
          <input 
            type="text" 
            placeholder="드라이브에서 검색" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button 
              onClick={() => setSearchTerm('')}
              style={{ background: 'none', border: 'none', color: 'var(--g-text-muted)', cursor: 'pointer', fontSize: '16px' }}
            >
              ✕
            </button>
          )}
        </div>

        {/* 헤더 우측 메뉴 */}
        <div className="gdrive-header-actions" onClick={(e) => e.stopPropagation()}>
          {/* 최신 버전 확인 및 앱 버전 배지 */}
          <button
            type="button"
            className="g-btn"
            onClick={() => checkVersion(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '6px 11px',
              borderRadius: '20px',
              border: '1px solid rgba(255, 255, 255, 0.16)',
              background: 'rgba(255, 255, 255, 0.06)',
              color: '#cbd5e1',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              marginRight: '6px'
            }}
            title={`현재 버전: v${localVersion.version} (${localVersion.buildTime})\n클릭 시 최신 배포 버전을 확인하여 자동 업데이트합니다.`}
          >
            <span>🔄</span>
            <span>v{localVersion.version}</span>
          </button>

          {/* PWA 앱 설치 버튼 (이미 설치된 경우 자동 숨김) */}
          <PwaInstallButton style={{ marginRight: '6px' }} />

          {/* 칠판 QR코드 스캐너 버튼 */}
          <button
            type="button"
            className="g-btn"
            onClick={() => setIsQrScannerOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 12px',
              borderRadius: '20px',
              border: '1.5px solid #a855f7',
              background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.25) 0%, rgba(139, 92, 246, 0.3) 100%)',
              color: '#d8b4fe',
              fontSize: '12.5px',
              fontWeight: 700,
              cursor: 'pointer',
              marginRight: '6px'
            }}
            title="카메라로 전자칠판 수업 QR코드를 스캔하여 바로 입장"
          >
            <span>📷</span>
            <span>수업 QR 찍기</span>
          </button>

          {/* 전자칠판 모드 전용: 수업 센터 vs 드라이브 탐색기 원클릭 스위처 */}
          {authMode === 'whiteboard' && (
            <button
              type="button"
              className="g-btn"
              onClick={() => setWhiteboardViewMode(prev => prev === 'hub' ? 'drive' : 'hub')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 12px',
                borderRadius: '20px',
                border: '1.5px solid #3b82f6',
                background: whiteboardViewMode === 'hub' ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.25) 0%, rgba(37, 99, 235, 0.3) 100%)' : 'rgba(255,255,255,0.08)',
                color: '#93c5fd',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer',
                marginRight: '6px'
              }}
              title={whiteboardViewMode === 'hub' ? '구글 드라이브 파일 탐색기로 전환' : '전자칠판 라이브 수업 센터로 복귀'}
            >
              <span>{whiteboardViewMode === 'hub' ? '📁 드라이브 탐색기' : '🖥️ 수업 센터'}</span>
            </button>
          )}

          <button 
            className="gdrive-icon-btn" 
            title="새로고침"
            onClick={() => {
              showToast('🔄 드라이브 목록을 새로고침합니다...');
              fetchDriveItems(currentFolder.id);
            }}
          >
            🔄
          </button>
          {/* 드라이브 시스템 설정 - 최고관리자 대시보드 외 비상 진입 지원 */}
          {(currentSession as any)?.role === 'admin' && (
            <button 
              id="btn-settings-open"
              className="gdrive-icon-btn" 
              title="시스템 인프라 설정 (관리자 전용)"
              onClick={() => {
                setTempRootFolderId(rootFolderId);
                setTempApiKey(googleApiKey);
                setTempGasUrl(gasUploadUrl);
                setActiveModal('settings');
              }}
            >
              ⚙️
            </button>
          )}

          {/* 현재 로그인 프로필 및 로그아웃 버튼 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: 'var(--radius-full)',
                background: currentSession?.role === 'teacher' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255, 255, 255, 0.08)',
                border: `1px solid ${currentSession?.role === 'teacher' ? 'var(--g-primary-blue)' : 'var(--g-border)'}`,
                color: '#ffffff',
                fontSize: '12.5px',
                fontWeight: 600
              }}
            >
              <span>{currentSession?.role === 'teacher' ? '👨‍🏫' : '🖥️'}</span>
              <span>{currentSession?.name || '전자칠판 (기본모드)'}</span>
            </div>

            <button
              className="g-btn g-btn-text"
              style={{ fontSize: '12px', border: '1px solid var(--g-border)', padding: '5px 10px' }}
              onClick={handlePortalLogout}
              title="로그아웃하고 첫 화면(로그인 게이트)으로 돌아갑니다."
            >
              🚪 로그아웃
            </button>
          </div>
        </div>
      </header>

      {/* ====================================================================
          2. 바디 (사이드바 + 메인 뷰)
          ==================================================================== */}
      <div className="gdrive-body">
        {/* 좌측 사이드바 */}
        <aside className="gdrive-sidebar" onClick={(e) => e.stopPropagation()}>
          {/* [+ 새로 만들기] 버튼 - 오직 선생님/관리자 모드에서만 활성화! 기본 모드는 다운로드 뱃지 표시 */}
          {canEdit ? (
            <div className="gdrive-new-btn-wrapper">
              <button 
                className="gdrive-new-btn"
                onClick={() => setIsNewMenuOpen(prev => !prev)}
              >
                <svg width="24" height="24" viewBox="0 0 24 24">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor"/>
                </svg>
                <span>새로 만들기</span>
              </button>

              {/* 새로 만들기 팝업 메뉴 */}
              {isNewMenuOpen && (
                <div className="gdrive-dropdown-menu">
                  <button 
                    className="gdrive-menu-item"
                    onClick={() => {
                      setIsNewMenuOpen(false);
                      setNewFolderName('새 폴더');
                      setActiveModal('new_folder');
                    }}
                  >
                    <span style={{ fontSize: '18px' }}>📁</span>
                    <span>새 폴더</span>
                  </button>
                  <button 
                    className="gdrive-menu-item"
                    onClick={() => {
                      setIsNewMenuOpen(false);
                      setQrLessonTitle('');
                      setQrLessonPdfFile(null);
                      setActiveModal('new_qr_lesson');
                    }}
                  >
                    <span style={{ fontSize: '18px' }}>📱</span>
                    <span>QR코드 수업 만들기</span>
                  </button>
                  <div className="gdrive-menu-divider" />
                  <button 
                    className="gdrive-menu-item"
                    onClick={() => {
                      setIsNewMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                  >
                    <span style={{ fontSize: '18px' }}>⬆️</span>
                    <span>파일 업로드</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: '0 8px 16px 8px' }}>
              <div 
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-full)',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid var(--g-border)',
                  color: 'var(--g-text-secondary)',
                  fontSize: '13px',
                  fontWeight: 500
                }}
                title="기본 모드: 다운로드 및 보기만 가능합니다."
              >
                <span>📥</span>
                <span>자료 다운로드 모드</span>
              </div>
            </div>
          )}

          {canEdit && (
            <input 
              type="file" 
              multiple 
              ref={fileInputRef} 
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleUploadFiles(Array.from(e.target.files));
                  e.target.value = '';
                }
              }}
            />
          )}

          {/* 사이드바 메뉴 트리 */}
          <nav className="gdrive-nav-list">
            <button 
              className={`gdrive-nav-item ${folderHistory.length === 1 ? 'active' : ''}`}
              onClick={() => {
                setFolderHistory([{ id: rootFolderId, name: '내 드라이브' }]);
                setSearchTerm('');
              }}
            >
              <span style={{ fontSize: '18px' }}>📁</span>
              <span>내 드라이브</span>
            </button>
            <button 
              className="gdrive-nav-item"
              onClick={() => {
                showToast('💡 공유 드라이브 바로가기');
              }}
            >
              <span style={{ fontSize: '18px' }}>👥</span>
              <span>공유 드라이브</span>
            </button>
            <button 
              className="gdrive-nav-item"
              onClick={() => {
                showToast('💡 최근 사용 파일 보기');
              }}
            >
              <span style={{ fontSize: '18px' }}>🕒</span>
              <span>최근 문서함</span>
            </button>
            <button 
              className="gdrive-nav-item"
              onClick={() => {
                window.open('https://drive.google.com/drive/trash', '_blank');
              }}
            >
              <span style={{ fontSize: '18px' }}>🗑️</span>
              <span>휴지통 열기</span>
            </button>
          </nav>
        </aside>

        {/* 메인 뷰 */}
        <main className="gdrive-main" onClick={() => setSelectedItemId(null)}>
          {authMode === 'whiteboard' && whiteboardViewMode === 'hub' ? (
            /* 🖥️ [전자칠판 라이브 수업 센터] 전면 렌더링 */
            <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }} onClick={(e) => e.stopPropagation()}>
              {/* 상단 안내 배너 */}
              <div style={{
                background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.18) 0%, rgba(30, 41, 59, 0.7) 100%)',
                border: '1px solid rgba(59, 130, 246, 0.35)',
                borderRadius: '16px',
                padding: '20px 24px',
                marginBottom: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px',
                boxShadow: '0 8px 30px rgba(0, 0, 0, 0.4)'
              }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '28px' }}>🖥️</span>
                    <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#ffffff' }}>
                      전자칠판 라이브 수업 센터
                    </h2>
                  </div>
                  <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#94a3b8' }}>
                    선생님을 선택하고 개설된 수업을 터치하면 전자칠판 실시간 수업이 즉시 시작됩니다.
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={loadWhiteboardTeacherLessons}
                    className="g-btn g-btn-text"
                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid var(--g-border)', padding: '8px 14px', borderRadius: '8px', color: '#ffffff', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}
                    title="수업 목록 새로고침"
                  >
                    🔄 목록 새로고침
                  </button>
                  <button
                    type="button"
                    onClick={() => setWhiteboardViewMode('drive')}
                    className="g-btn g-btn-text"
                    style={{ background: 'rgba(59, 130, 246, 0.15)', border: '1px solid rgba(59, 130, 246, 0.4)', padding: '8px 14px', borderRadius: '8px', color: '#93c5fd', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}
                    title="구글 드라이브 파일 탐색기로 전환"
                  >
                    📁 드라이브 탐색기
                  </button>
                </div>
              </div>

              {/* 1. 선생님 선택 탭 / 카드 섹션 */}
              <div style={{ marginBottom: '24px' }}>
                <div style={{ fontSize: '13.5px', color: '#cbd5e1', fontWeight: 700, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>👨‍🏫 담당 선생님 선택</span>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>({whiteboardTeachersList.length}명 등록됨)</span>
                </div>

                {isLoadingWhiteboardLessons ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8', fontSize: '13px' }}>
                    <span style={{ fontSize: '24px', display: 'block', marginBottom: '8px' }}>🔄</span>
                    선생님 목록 및 개설 수업을 불러오는 중입니다...
                  </div>
                ) : whiteboardTeachersList.length === 0 ? (
                  <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px dashed #30363d', padding: '36px', textAlign: 'center', color: '#94a3b8' }}>
                    <span style={{ fontSize: '32px', display: 'block', marginBottom: '8px' }}>🏫</span>
                    <p style={{ margin: '0 0 6px 0', color: '#ffffff', fontWeight: 600 }}>개설된 선생님 수업이 없습니다.</p>
                    <p style={{ margin: 0, fontSize: '12px' }}>선생님 로그인 후 수업을 개설하시면 여기에 자동으로 표시됩니다.</p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '12px' }}>
                    {whiteboardTeachersList.map(teacher => {
                      const isSelected = (selectedTeacherNameForBoard || whiteboardTeachersList[0]?.teacherName) === teacher.teacherName;
                      const liveCount = teacher.lessons.filter((l: any) => l.isLive).length;
                      return (
                        <div
                          key={teacher.teacherName}
                          onClick={() => setSelectedTeacherNameForBoard(teacher.teacherName)}
                          style={{
                            background: isSelected ? 'linear-gradient(135deg, rgba(37, 99, 235, 0.3) 0%, rgba(30, 41, 59, 0.85) 100%)' : 'rgba(30, 41, 59, 0.5)',
                            border: isSelected ? '2px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.08)',
                            borderRadius: '14px',
                            padding: '14px 16px',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            boxShadow: isSelected ? '0 4px 16px rgba(37, 99, 235, 0.3)' : 'none'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <span style={{ fontSize: '24px' }}>👨‍🏫</span>
                            {liveCount > 0 ? (
                              <span style={{ fontSize: '11px', color: '#4ade80', background: 'rgba(74, 222, 128, 0.18)', border: '1px solid rgba(74, 222, 128, 0.35)', padding: '2px 8px', borderRadius: '10px', fontWeight: 700 }}>
                                🟢 {liveCount}개 진행 중
                              </span>
                            ) : (
                              <span style={{ fontSize: '11px', color: '#94a3b8', background: 'rgba(255, 255, 255, 0.06)', padding: '2px 8px', borderRadius: '10px' }}>
                                {teacher.lessons.length}개 개설됨
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '16px', fontWeight: 700, color: '#ffffff' }}>
                            {teacher.teacherName} 선생님
                          </div>
                          <div style={{ fontSize: '12px', color: isSelected ? '#93c5fd' : '#64748b', marginTop: '4px' }}>
                            {isSelected ? '선택됨 (수업 목록 표시 중)' : '터치하여 수업 보기 ▶'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 2. 선택된 선생님의 개설 수업 카드 목록 */}
              {selectedTeacherForWhiteboard && (
                <div>
                  <div style={{ fontSize: '14px', color: '#ffffff', fontWeight: 700, marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>📚 {selectedTeacherForWhiteboard.teacherName} 선생님이 개설한 수업 목록</span>
                    <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 400 }}>({selectedTeacherForWhiteboard.lessons.length}개)</span>
                  </div>

                  {selectedTeacherForWhiteboard.lessons.length === 0 ? (
                    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '30px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                      해당 선생님이 개설한 수업이 아직 없습니다.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
                      {selectedTeacherForWhiteboard.lessons.map((lesson: any) => {
                        const isLive = !!lesson.isLive;
                        const hasFiles = lesson.attachedFiles && lesson.attachedFiles.length > 0;
                        return (
                          <div
                            key={lesson.lessonId}
                            style={{
                              background: isLive ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(30, 41, 59, 0.85) 100%)' : 'rgba(30, 41, 59, 0.65)',
                              border: isLive ? '1.5px solid rgba(52, 211, 153, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
                              borderRadius: '16px',
                              padding: '18px 20px',
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'space-between',
                              boxShadow: isLive ? '0 8px 24px rgba(16, 185, 129, 0.2)' : 'none'
                            }}
                          >
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                                <span style={{ fontSize: '12px', color: isLive ? '#4ade80' : '#94a3b8', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span>{isLive ? '🟢' : '📓'}</span>
                                  <span>{isLive ? '실시간 수업 진행 중' : '수업 대기 (오프라인)'}</span>
                                </span>
                                {lesson.createdAt && (
                                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                                    {new Date(lesson.createdAt).toLocaleDateString('ko-KR')}
                                  </span>
                                )}
                              </div>

                              <h3 style={{ margin: '0 0 10px 0', fontSize: '17px', fontWeight: 700, color: '#ffffff', lineHeight: 1.3 }}>
                                {lesson.title}
                              </h3>

                              <div style={{ fontSize: '12px', color: '#94a3b8', background: 'rgba(0,0,0,0.25)', padding: '6px 10px', borderRadius: '8px', marginBottom: '16px' }}>
                                {hasFiles ? (
                                  <span>📎 학습 자료 {lesson.attachedFiles.length}개 연결됨</span>
                                ) : lesson.pdfName ? (
                                  <span>📄 {lesson.pdfName}</span>
                                ) : (
                                  <span>자유 필기 공책</span>
                                )}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleWhiteboardSelectLesson(selectedTeacherForWhiteboard.teacherName, lesson)}
                              style={{
                                width: '100%',
                                padding: '12px',
                                borderRadius: '10px',
                                border: 'none',
                                background: isLive
                                  ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                                  : 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                                color: '#ffffff',
                                fontSize: '14px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                boxShadow: isLive
                                  ? '0 4px 14px rgba(16, 185, 129, 0.4)'
                                  : '0 4px 14px rgba(37, 99, 235, 0.4)'
                              }}
                            >
                              <span>▶️</span>
                              <span>{isLive ? '수업 이어서 진행하기' : '전자칠판 수업 시작하기'}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* 상단 툴바 & 브레드크럼 */}
              <div className="gdrive-main-toolbar" onClick={(e) => e.stopPropagation()}>
            {/* 좌측: 선택된 항목 액션 바 OR 브레드크럼 */}
            {selectedItem ? (
              <div className="gdrive-selection-actions">
                <span className="gdrive-selection-count">1개 선택됨</span>
                {isQrLessonItem(selectedItem) ? (
                  <>
                    <button 
                      className="gdrive-action-chip"
                      style={{ background: 'var(--g-primary-blue)', color: '#041e49', fontWeight: 700 }}
                      onClick={() => handleOpenQrLesson(selectedItem)}
                    >
                      <span>▶️</span> 수업 실행
                    </button>
                    <button 
                      className="gdrive-action-chip"
                      style={{ background: 'rgba(59, 130, 246, 0.2)', border: '1px solid rgba(59, 130, 246, 0.4)', color: '#93c5fd', fontWeight: 600 }}
                      onClick={() => handleOpenEditQrLesson(selectedItem)}
                      title="수업 제목, PIN 및 첨부 학습 자료 다중 선택 수정"
                    >
                      <span>✏️</span> 자료 수정
                    </button>
                    <button 
                      className="gdrive-action-chip"
                      onClick={() => handleOpenFolder(selectedItem.folderId || selectedItem.id, selectedItem.name)}
                    >
                      <span>📁</span> 폴더 열기
                    </button>
                  </>
                ) : (
                  selectedItem.type === 'folder' ? (
                    <button 
                      className="gdrive-action-chip"
                      onClick={() => handleOpenFolder(selectedItem.folderId || selectedItem.id, selectedItem.name)}
                    >
                      <span>📁</span> 열기
                    </button>
                  ) : (
                    <button 
                      className="gdrive-action-chip" 
                      onClick={() => handleDownload(selectedItem)}
                    >
                      <span>📥</span> 다운로드
                    </button>
                  )
                )}
                {canEdit && (
                  <>
                    <button 
                      className="gdrive-action-chip"
                      onClick={() => {
                        setTargetItem(selectedItem);
                        setRenameInput(selectedItem.name);
                        setActiveModal('rename');
                      }}
                    >
                      <span>✏️</span> 이름 바꾸기
                    </button>
                    <button 
                      className="gdrive-action-chip danger"
                      onClick={() => {
                        setTargetItem(selectedItem);
                        setActiveModal('delete');
                      }}
                    >
                      <span>🗑️</span> 삭제
                    </button>
                  </>
                )}
                <a 
                  href={selectedItem.viewUrl} 
                  target="_blank" 
                  rel="noreferrer" 
                  className="gdrive-action-chip"
                >
                  <span>👁️</span> 구글 드라이브 보기
                </a>
                <button 
                  className="gdrive-action-chip" 
                  onClick={() => setSelectedItemId(null)}
                  style={{ color: 'var(--g-text-muted)' }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="gdrive-breadcrumb-list">
                {folderHistory.map((folder, idx) => {
                  const isCurrent = idx === folderHistory.length - 1;
                  return (
                    <React.Fragment key={folder.id}>
                      <button 
                        className={`gdrive-crumb-btn ${isCurrent ? 'current' : ''}`}
                        onClick={() => handleBreadcrumbClick(idx)}
                      >
                        {folder.name}
                      </button>
                      {!isCurrent && <span style={{ color: 'var(--g-text-muted)', fontSize: '14px' }}>›</span>}
                    </React.Fragment>
                  );
                })}
              </div>
            )}

            {/* 우측: 뷰 모드 전환 버튼 */}
            <div className="gdrive-toolbar-options">
              <button 
                className={`gdrive-icon-btn ${viewMode === 'list' ? 'active' : ''}`}
                title="목록 보기"
                onClick={() => setViewMode('list')}
              >
                ☰
              </button>
              <button 
                className={`gdrive-icon-btn ${viewMode === 'grid' ? 'active' : ''}`}
                title="그리드 타일 보기"
                onClick={() => setViewMode('grid')}
              >
                🔲
              </button>
            </div>
          </div>

          {/* 컨텐츠 스크롤 영역 */}
          <div className="gdrive-content-scroll">
            {isLoading ? (
              <div style={{ textAlign: 'center', padding: '5rem 1rem', color: 'var(--g-primary-blue)' }}>
                <p style={{ fontSize: '15px', fontWeight: 500 }}>로딩 중...</p>
              </div>
            ) : errorMessage ? (
              <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#f28b82' }}>
                <p style={{ fontSize: '15px', marginBottom: '1rem' }}>{errorMessage}</p>
                <button className="g-btn g-btn-primary" onClick={() => fetchDriveItems(currentFolder.id)}>
                  다시 시도
                </button>
              </div>
            ) : filteredItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '5rem 1rem', color: 'var(--g-text-muted)' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📂</div>
                <p style={{ fontSize: '16px', color: '#f1f3f4', fontWeight: 500 }}>폴더가 비어 있습니다</p>
                <p style={{ fontSize: '13px', marginTop: '6px' }}>
                  좌측 상단 [+ 새로 만들기]를 클릭하거나, 파일을 화면으로 끌어다 놓으세요.
                </p>
              </div>
            ) : viewMode === 'list' ? (
              /* [1. 구글 드라이브 목록 뷰 (Table List)] */
              <>
                {folderHistory.length === 1 && (
                  <div style={{
                    background: 'rgba(59, 130, 246, 0.08)',
                    border: '1px solid rgba(59, 130, 246, 0.2)',
                    borderRadius: '10px',
                    padding: '10px 16px',
                    margin: '8px 16px 14px 16px',
                    fontSize: '13px',
                    color: '#93c5fd',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}>
                    <span style={{ fontSize: '18px' }}>💡</span>
                    <span>
                      <strong>전자칠판 수업 실행 안내:</strong> 개설된 수업을 실행하시려면 담당 선생님 폴더(예: <strong>이병우</strong>, <strong>김정희</strong>)를 터치하여 안으로 들어가시면 <strong>[▶️ 수업 실행]</strong> 버튼이 나타납니다.
                    </span>
                  </div>
                )}
                <table className="gdrive-table">
                  <thead>
                    <tr>
                      <th>이름</th>
                      <th style={{ width: '180px' }}>최종 수정 날짜</th>
                      <th style={{ width: '130px' }}>파일 크기</th>
                      <th style={{ width: '150px', textAlign: 'right' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map(item => {
                      const isSelected = selectedItemId === item.id;
                      const isQr = isQrLessonItem(item);
                      return (
                        <tr 
                          key={item.id}
                          className={`gdrive-row ${item.type} ${isQr ? 'qr-lesson-row' : ''} ${isSelected ? 'selected' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedItemId(item.id);
                          }}
                          onDoubleClick={() => {
                            if (isQr) {
                              handleOpenQrLesson(item);
                            } else if (item.type === 'folder') {
                              handleOpenFolder(item.folderId || item.id, item.name);
                            } else {
                              handleDownload(item);
                            }
                          }}
                        >
                          <td>
                            <div className="gdrive-name-cell">
                              <span className="gdrive-item-icon">{getItemIcon(item)}</span>
                              <span className="gdrive-item-name" title={item.name}>
                                {isQr ? item.name.replace('[QR수업]', '').trim() : item.name}
                              </span>
                              {isQr && (
                                <>
                                  <button
                                    type="button"
                                    className="gdrive-qr-badge"
                                    style={{
                                      border: 'none',
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '5px',
                                      padding: '4px 10px',
                                      borderRadius: '6px',
                                      background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                                      color: '#ffffff',
                                      fontWeight: 700,
                                      fontSize: '12px',
                                      boxShadow: '0 2px 8px rgba(37, 99, 235, 0.4)'
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenQrLesson(item);
                                    }}
                                    title="터치하여 전자칠판 라이브 수업 즉시 실행"
                                  >
                                    ▶️ 수업 실행
                                  </button>
                                  <button
                                    type="button"
                                    className="gdrive-qr-badge"
                                    style={{
                                      border: '1px solid rgba(255, 255, 255, 0.2)',
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      padding: '4px 8px',
                                      borderRadius: '6px',
                                      background: 'rgba(255, 255, 255, 0.08)',
                                      color: '#93c5fd',
                                      fontWeight: 600,
                                      fontSize: '11.5px',
                                      marginLeft: '6px'
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenEditQrLesson(item);
                                    }}
                                    title="수업 제목, PIN 및 첨부 학습 자료 다중 선택 수정"
                                  >
                                    ✏️ 자료 수정
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        <td style={{ color: 'var(--g-text-secondary)', fontSize: '13px' }}>
                          {item.updatedAt}
                        </td>
                        <td style={{ color: 'var(--g-text-muted)', fontSize: '13px' }}>
                          {isQr ? '수업 앱' : item.size}
                        </td>
                        <td>
                          {/* 마우스 호버 시 나타나는 빠른 액션 */}
                          <div className="gdrive-row-actions" onClick={(e) => e.stopPropagation()}>
                            {isQr ? (
                              <button 
                                className="gdrive-icon-btn" 
                                style={{ width: '32px', height: '32px', fontSize: '15px', color: 'var(--g-primary-blue)' }}
                                title="수업 실행"
                                onClick={() => handleOpenQrLesson(item)}
                              >
                                ▶️
                              </button>
                            ) : (
                              item.type !== 'folder' && (
                                <button 
                                  className="gdrive-icon-btn" 
                                  style={{ width: '32px', height: '32px', fontSize: '15px' }}
                                  title="다운로드"
                                  onClick={() => handleDownload(item)}
                                >
                                  📥
                                </button>
                              )
                            )}
                            {canEdit && (
                              <>
                                <button 
                                  className="gdrive-icon-btn" 
                                  style={{ width: '32px', height: '32px', fontSize: '15px' }}
                                  title="이름 바꾸기"
                                  onClick={() => {
                                    setTargetItem(item);
                                    setRenameInput(item.name);
                                    setActiveModal('rename');
                                  }}
                                >
                                  ✏️
                                </button>
                                <button 
                                  className="gdrive-icon-btn" 
                                  style={{ width: '32px', height: '32px', fontSize: '15px', color: 'var(--g-danger-red)' }}
                                  title="삭제"
                                  onClick={() => {
                                    setTargetItem(item);
                                    setActiveModal('delete');
                                  }}
                                >
                                  🗑️
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </>
            ) : (
              /* [2. 구글 드라이브 타일 그리드 뷰 (Grid)] */
              <div>
                {filteredItems.some(i => i.type === 'folder') && (
                  <div>
                    <div className="gdrive-grid-section-title">폴더</div>
                    <div className="gdrive-folder-grid">
                      {filteredItems.filter(i => i.type === 'folder').map(folder => {
                        const isQr = isQrLessonItem(folder);
                        return (
                          <div 
                            key={folder.id}
                            className={`gdrive-folder-card ${isQr ? 'qr-lesson-card' : ''} ${selectedItemId === folder.id ? 'selected' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedItemId(folder.id);
                            }}
                            onDoubleClick={() => {
                              if (isQr) {
                                handleOpenQrLesson(folder);
                              } else {
                                handleOpenFolder(folder.folderId || folder.id, folder.name);
                              }
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                              <span style={{ fontSize: '20px' }}>{isQr ? '📱' : '📁'}</span>
                              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                <span className="gdrive-card-title">{isQr ? folder.name.replace('[QR수업]', '').trim() : folder.name}</span>
                                {isQr && <span style={{ fontSize: '11px', color: 'var(--g-primary-blue)', fontWeight: 600 }}>대화형 수업 앱</span>}
                              </div>
                            </div>
                            {isQr ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <button 
                                  className="gdrive-icon-btn"
                                  style={{ width: '28px', height: '28px', fontSize: '13px', color: '#93c5fd' }}
                                  title="수업 설정 및 첨부자료 수정"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenEditQrLesson(folder);
                                  }}
                                >
                                  ✏️
                                </button>
                                <button 
                                  className="gdrive-icon-btn"
                                  style={{ width: '28px', height: '28px', fontSize: '13px', color: 'var(--g-primary-blue)' }}
                                  title="수업 실행"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenQrLesson(folder);
                                  }}
                                >
                                  ▶️
                                </button>
                                {canEdit && (
                                  <button 
                                    className="gdrive-icon-btn"
                                    style={{ width: '28px', height: '28px', fontSize: '13px', color: '#f87171' }}
                                    title="수업 삭제"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setTargetItem(folder);
                                      setActiveModal('delete');
                                    }}
                                  >
                                    🗑️
                                  </button>
                                )}
                              </div>
                            ) : (
                              canEdit && (
                                <button 
                                  className="gdrive-icon-btn"
                                  style={{ width: '28px', height: '28px', fontSize: '13px' }}
                                  title="이름 바꾸기"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setTargetItem(folder);
                                    setRenameInput(folder.name);
                                    setActiveModal('rename');
                                  }}
                                >
                                  ✏️
                                </button>
                              )
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {filteredItems.some(i => i.type !== 'folder') && (
                  <div>
                    <div className="gdrive-grid-section-title">파일</div>
                    <div className="gdrive-file-grid">
                      {filteredItems.filter(i => i.type !== 'folder').map(file => (
                        <div 
                          key={file.id}
                          className={`gdrive-file-card ${selectedItemId === file.id ? 'selected' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedItemId(file.id);
                          }}
                          onDoubleClick={() => handleDownload(file)}
                        >
                          <div className="gdrive-card-preview">
                            {getItemIcon(file)}
                          </div>
                          <div className="gdrive-card-info">
                            <span style={{ fontSize: '18px' }}>{getItemIcon(file)}</span>
                            <span className="gdrive-card-title" title={file.name}>{file.name}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 전역 드래그 앤 드롭 오버레이 */}
          {isDraggingGlobal && (
            <div className="gdrive-drop-overlay">
              <span style={{ fontSize: '48px' }}>{canEdit ? '⬆️' : '🔒'}</span>
              <h3>
                {canEdit 
                  ? '드라이브에 파일을 업로드하려면 여기에 놓으세요' 
                  : '기본 모드(다운로드 전용)입니다. 업로드는 선생님 로그인 후 가능합니다.'}
              </h3>
            </div>
          )}
            </>
          )}
        </main>
      </div>

      {/* ====================================================================
          모달 0: 🖥️ 전자칠판 라이브 수업 센터 - 중복 진행 세션 확인 및 새로 개설 모달
          ==================================================================== */}
      {whiteboardSessionPrompt && (
        <div className="modal-backdrop" onClick={() => setWhiteboardSessionPrompt(null)}>
          <div className="modal-box" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px' }}>
                <span>⚠️</span> 수업 개설 및 전환 확인
              </h2>
              <button className="modal-close-btn" onClick={() => setWhiteboardSessionPrompt(null)}>✕</button>
            </div>

            <div style={{ padding: '8px 0 16px 0' }}>
              <p style={{ fontSize: '14.5px', color: '#ffffff', fontWeight: 600, lineHeight: 1.5, margin: '0 0 10px 0' }}>
                현재 다른 수업이 진행 중이거나 이전 세션 기록이 있습니다.
              </p>
              <div style={{ background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '10px', padding: '12px 14px', fontSize: '12.5px', color: '#fca5a5', lineHeight: 1.5 }}>
                <strong>[새로 개설]</strong>을 누르시면 이전 진행 수업은 <strong>자동 종료</strong>되며, 학생들에게 <strong>'{whiteboardSessionPrompt.lesson.title}'</strong> 새 수업이 즉시 열립니다.
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="g-btn g-btn-text"
                onClick={() => setWhiteboardSessionPrompt(null)}
                style={{ color: '#94a3b8' }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => handleLaunchWhiteboardLesson(whiteboardSessionPrompt.teacherName, whiteboardSessionPrompt.lesson, false)}
                style={{
                  background: 'rgba(59, 130, 246, 0.2)',
                  border: '1px solid rgba(59, 130, 246, 0.4)',
                  color: '#93c5fd',
                  padding: '9px 14px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                ▶️ 이어서 계속하기
              </button>
              <button
                type="button"
                onClick={() => handleLaunchWhiteboardLesson(whiteboardSessionPrompt.teacherName, whiteboardSessionPrompt.lesson, true)}
                style={{
                  background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                  border: 'none',
                  color: '#ffffff',
                  padding: '9px 16px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(239, 68, 68, 0.4)'
                }}
              >
                🔄 이전 수업 종료 후 새로 개설
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          모달 1: 새 폴더 만들기
          ==================================================================== */}
      {activeModal === 'new_folder' && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>새 폴더</h2>
              <button className="modal-close-btn" onClick={() => setActiveModal(null)}>✕</button>
            </div>
            <form onSubmit={handleCreateFolder} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <input 
                type="text" 
                className="g-form-input" 
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="제목 없는 폴더"
                autoFocus
                required
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="g-btn g-btn-text" onClick={() => setActiveModal(null)}>
                  취소
                </button>
                <button type="submit" className="g-btn g-btn-primary" disabled={isProcessingAction}>
                  {isProcessingAction ? '만드는 중...' : '만들기'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          모달 1-2: QR코드 수업 만들기
          ==================================================================== */}
      {activeModal === 'new_qr_lesson' && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-box" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2><span>📱</span> QR코드 수업 만들기</h2>
              <button className="modal-close-btn" onClick={() => setActiveModal(null)}>✕</button>
            </div>
            <form onSubmit={handleCreateQrLesson} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div style={{ background: 'rgba(168, 199, 250, 0.08)', border: '1px solid rgba(168, 199, 250, 0.25)', padding: '12px 14px', borderRadius: '8px', fontSize: '13px', color: 'var(--g-text-secondary)', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--g-primary-blue)' }}>💡 앱시트 스타일 QR 수업</strong><br/>
                드라이브에 <strong>[QR수업] 폴더</strong>가 생성되고, 그 안에 수업 설정과 학생들의 필기 누가기록이 자동 보관됩니다. 화면에서는 독립 실행형 수업 앱 카드로 렌더링됩니다.
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--g-text-secondary)', marginBottom: '6px' }}>
                  수업 제목 <span style={{ color: 'var(--g-danger-red)' }}>*</span>
                </label>
                <input 
                  type="text" 
                  className="g-form-input" 
                  value={qrLessonTitle}
                  onChange={(e) => setQrLessonTitle(e.target.value)}
                  placeholder="예: 3학년 1반 수학 삼각비의 활용"
                  autoFocus
                  required
                />
              </div>



              {/* 구글 드라이브 폴더 내 파일 다중 선택 영역 */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ fontSize: '12.5px', color: 'var(--g-text-secondary)', fontWeight: 600 }}>
                    📁 내 구글 드라이브 폴더 학습자료 다중 선택 ({selectedDriveFileIds.length}개 선택됨)
                  </label>
                  {teacherDriveDocuments.length > 0 && (
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', color: '#60a5fa', fontSize: '11.5px', cursor: 'pointer', fontWeight: 600 }}
                      onClick={() => {
                        if (selectedDriveFileIds.length === teacherDriveDocuments.length) {
                          setSelectedDriveFileIds([]);
                        } else {
                          setSelectedDriveFileIds(teacherDriveDocuments.map(d => d.id));
                        }
                      }}
                    >
                      {selectedDriveFileIds.length === teacherDriveDocuments.length ? '전체 해제' : '전체 선택'}
                    </button>
                  )}
                </div>

                <div style={{
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid var(--g-border)',
                  borderRadius: '10px',
                  maxHeight: '160px',
                  overflowY: 'auto',
                  padding: '8px'
                }}>
                  {teacherDriveDocuments.length === 0 ? (
                    <div style={{ padding: '18px 10px', textAlign: 'center', color: 'var(--g-text-muted)', fontSize: '12px' }}>
                      선생님 드라이브 폴더에 업로드된 문서/학습지 파일이 없습니다.<br/>
                      아래 [컴퓨터 파일 첨부]를 이용하시거나 먼저 드라이브에 파일을 업로드해 주세요.
                    </div>
                  ) : (
                    teacherDriveDocuments.map(doc => {
                      const isChecked = selectedDriveFileIds.includes(doc.id);
                      return (
                        <label
                          key={doc.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '6px 10px',
                            borderRadius: '6px',
                            background: isChecked ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                            cursor: 'pointer',
                            fontSize: '12.5px',
                            color: isChecked ? '#ffffff' : 'var(--g-text-secondary)',
                            transition: 'background 0.15s ease'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              setSelectedDriveFileIds(prev =>
                                isChecked ? prev.filter(id => id !== doc.id) : [...prev, doc.id]
                              );
                            }}
                            style={{ accentColor: '#3b82f6', width: '15px', height: '15px' }}
                          />
                          <span style={{ fontSize: '15px' }}>{doc.name.endsWith('.pdf') ? '📄' : '📎'}</span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {doc.name}
                          </span>
                          {doc.size && <span style={{ fontSize: '11px', color: 'var(--g-text-muted)' }}>{doc.size}</span>}
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--g-text-secondary)', marginBottom: '6px' }}>
                  수업용 학습지 PDF 첨부 (선택 사항)
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button 
                    type="button" 
                    className="g-btn g-btn-text" 
                    style={{ border: '1px solid var(--g-border)' }}
                    onClick={() => qrPdfInputRef.current?.click()}
                  >
                    📄 {qrLessonPdfFile ? 'PDF 변경' : 'PDF 파일 선택'}
                  </button>
                  <span style={{ fontSize: '12.5px', color: qrLessonPdfFile ? '#a8c7fa' : 'var(--g-text-muted)' }}>
                    {qrLessonPdfFile ? qrLessonPdfFile.name : '미선택 시 빈 스마트 노트로 진행'}
                  </span>
                </div>
                <input 
                  type="file" 
                  accept="application/pdf"
                  ref={qrPdfInputRef}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      setQrLessonPdfFile(e.target.files[0]);
                    }
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <button type="button" className="g-btn g-btn-text" onClick={() => setActiveModal(null)}>
                  취소
                </button>
                <button type="submit" className="g-btn g-btn-primary" disabled={isProcessingAction}>
                  {isProcessingAction ? '수업 개설 중...' : '📱 수업 생성하기'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          모달 1-3: QR코드 수업 및 학습자료 수정 (다중 선택 수정)
          ==================================================================== */}
      {activeModal === 'edit_qr_lesson' && editingQrLesson && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-box" style={{ maxWidth: '560px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2><span>✏️</span> QR코드 수업 및 학습자료 수정</h2>
              <button className="modal-close-btn" onClick={() => setActiveModal(null)}>✕</button>
            </div>
            <form onSubmit={handleSaveEditQrLesson} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.25)', padding: '10px 14px', borderRadius: '8px', fontSize: '12.5px', color: '#93c5fd', lineHeight: 1.5 }}>
                선생님 구글 드라이브 폴더의 파일 목록에서 학생들에게 배부할 자료를 <strong>다중 선택하여 추가/해제</strong>할 수 있습니다.
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--g-text-secondary)', marginBottom: '6px' }}>
                  수업 제목 <span style={{ color: 'var(--g-danger-red)' }}>*</span>
                </label>
                <input 
                  type="text" 
                  className="g-form-input" 
                  value={editLessonTitle}
                  onChange={(e) => setEditLessonTitle(e.target.value)}
                  placeholder="수업 제목"
                  autoFocus
                  required
                />
              </div>



              {/* 연결 학습자료 다중 선택 영역 */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ fontSize: '12.5px', color: 'var(--g-text-secondary)', fontWeight: 600 }}>
                    📁 배부할 학습자료 다중 선택 ({editSelectedDriveFileIds.length}개 선택됨)
                  </label>
                  {teacherDriveDocuments.length > 0 && (
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', color: '#60a5fa', fontSize: '11.5px', cursor: 'pointer', fontWeight: 600 }}
                      onClick={() => {
                        if (editSelectedDriveFileIds.length === teacherDriveDocuments.length) {
                          setEditSelectedDriveFileIds([]);
                        } else {
                          setEditSelectedDriveFileIds(teacherDriveDocuments.map(d => d.id));
                        }
                      }}
                    >
                      {editSelectedDriveFileIds.length === teacherDriveDocuments.length ? '전체 해제' : '전체 선택'}
                    </button>
                  )}
                </div>

                <div style={{
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid var(--g-border)',
                  borderRadius: '10px',
                  maxHeight: '180px',
                  overflowY: 'auto',
                  padding: '8px'
                }}>
                  {teacherDriveDocuments.length === 0 && existingAttachedFiles.length === 0 ? (
                    <div style={{ padding: '18px 10px', textAlign: 'center', color: 'var(--g-text-muted)', fontSize: '12px' }}>
                      선생님 드라이브 폴더에 문서/학습지 파일이 없습니다.
                    </div>
                  ) : (
                    <>
                      {/* 현재 폴더에 있는 파일들 */}
                      {teacherDriveDocuments.map(doc => {
                        const isChecked = editSelectedDriveFileIds.includes(doc.id);
                        return (
                          <label
                            key={doc.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              padding: '6px 10px',
                              borderRadius: '6px',
                              background: isChecked ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                              cursor: 'pointer',
                              fontSize: '12.5px',
                              color: isChecked ? '#ffffff' : 'var(--g-text-secondary)',
                              transition: 'background 0.15s ease'
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                setEditSelectedDriveFileIds(prev =>
                                  isChecked ? prev.filter(id => id !== doc.id) : [...prev, doc.id]
                                );
                              }}
                              style={{ accentColor: '#3b82f6', width: '15px', height: '15px' }}
                            />
                            <span style={{ fontSize: '15px' }}>{doc.name.endsWith('.pdf') ? '📄' : '📎'}</span>
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {doc.name}
                            </span>
                            {doc.size && <span style={{ fontSize: '11px', color: 'var(--g-text-muted)' }}>{doc.size}</span>}
                          </label>
                        );
                      })}
                      {/* 기존 첨부파일 중 현재 폴더에 없는 파일 표시 */}
                      {existingAttachedFiles.filter(ex => !teacherDriveDocuments.some(td => td.id === ex.id)).map(ex => {
                        const isChecked = editSelectedDriveFileIds.includes(ex.id);
                        return (
                          <label
                            key={ex.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              padding: '6px 10px',
                              borderRadius: '6px',
                              background: isChecked ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                              cursor: 'pointer',
                              fontSize: '12.5px',
                              color: isChecked ? '#ffffff' : 'var(--g-text-secondary)'
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                setEditSelectedDriveFileIds(prev =>
                                  isChecked ? prev.filter(id => id !== ex.id) : [...prev, ex.id]
                                );
                              }}
                              style={{ accentColor: '#3b82f6', width: '15px', height: '15px' }}
                            />
                            <span style={{ fontSize: '15px' }}>📄</span>
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {ex.name} (이전 첨부됨)
                            </span>
                          </label>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <button type="button" className="g-btn g-btn-text" onClick={() => setActiveModal(null)}>
                  취소
                </button>
                <button type="submit" className="g-btn g-btn-primary" disabled={isProcessingAction}>
                  {isProcessingAction ? '저장 중...' : '💾 수정사항 저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {activeModal === 'qr_lesson_viewer' && activeQrLesson && (
        <LiveClassroomDashboard
          lesson={activeQrLesson}
          initialClear={isQrLessonInitialClear}
          onExit={() => {
            const currentLessonId = activeQrLesson.folderId || activeQrLesson.id;
            classroomRealtime.closeTeacherSession(currentLessonId).catch(() => {});
            setActiveModal(null);
          }}
          onOpenFolder={handleOpenFolder}
          executeDriveAction={executeDriveAction}
          showToast={showToast}
        />
      )}

      {/* ====================================================================
          모달: 수업 세션 시작 모드 선택 (이전 기록 이어하기 vs 새로 갱신하여 시작)
          ==================================================================== */}
      {activeModal === 'lesson_session_prompt' && sessionPromptLesson && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-box" style={{ maxWidth: '580px', padding: '24px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(59, 130, 246, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px' }}>
                🎓
              </div>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: '#ffffff' }}>
                  수업 시작 방식 선택
                </h2>
                <div style={{ fontSize: '13px', color: '#93c5fd', marginTop: '2px', fontWeight: 600 }}>
                  {sessionPromptLesson.name.replace('[QR수업]', '').trim()}
                </div>
              </div>
            </div>

            <div style={{ background: '#1e1f20', border: '1px solid var(--g-border)', borderRadius: '10px', padding: '14px 16px', marginBottom: '20px' }}>
              <p style={{ margin: 0, fontSize: '13.5px', color: '#e2e8f0', lineHeight: 1.6 }}>
                💡 이전에 등록된 학생 필기 기록이 <strong style={{ color: '#38bdf8' }}>{existingSessionCount}건</strong> 있습니다.<br />
                이번 수업을 어떻게 진행하시겠습니까?
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
              {/* 옵션 1: 이전 기록 이어하기 */}
              <div
                onClick={() => {
                  const targetLesson = sessionPromptLesson;
                  setActiveModal(null);
                  setSessionPromptLesson(null);
                  startQrLessonViewer(targetLesson, false);
                }}
                style={{
                  background: 'rgba(30, 41, 59, 0.7)',
                  border: '1.5px solid #3b82f6',
                  borderRadius: '12px',
                  padding: '16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ fontSize: '28px', background: 'rgba(59, 130, 246, 0.2)', width: '48px', height: '48px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  📂
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    이전 수업 기록 가져오기 (이어하기)
                    <span style={{ fontSize: '11px', background: 'rgba(59, 130, 246, 0.3)', color: '#93c5fd', padding: '1px 6px', borderRadius: '4px' }}>추천</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--g-text-secondary)', marginTop: '4px', lineHeight: 1.4 }}>
                    수업 중 실수로 창을 닫았거나, 학생들이 이전에 제출한 내용을 그대로 유지하고 이어서 진행합니다.
                  </div>
                </div>
              </div>

              {/* 옵션 2: 새로 갱신하여 시작 */}
              <div
                onClick={() => {
                  const targetLesson = sessionPromptLesson;
                  setActiveModal(null);
                  setSessionPromptLesson(null);
                  startQrLessonViewer(targetLesson, true);
                }}
                style={{
                  background: 'rgba(30, 41, 59, 0.4)',
                  border: '1.5px solid rgba(239, 68, 68, 0.4)',
                  borderRadius: '12px',
                  padding: '16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ fontSize: '28px', background: 'rgba(239, 68, 68, 0.15)', width: '48px', height: '48px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  ✨
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#f87171' }}>
                    새로 갱신하여 시작 (이전 기록 초기화)
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--g-text-secondary)', marginTop: '4px', lineHeight: 1.4 }}>
                    새로운 반이나 새 수업을 시작할 때 선택하세요. 이전 기록을 깨끗이 비우고 새로운 등록을 받습니다.
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="g-btn g-btn-text" onClick={() => setActiveModal(null)} style={{ fontSize: '13px' }}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          모달 1-4: 전자칠판 학생 필기 전체화면 뷰어 (나가기 버튼 + 쪽 이동 + 확대축소/팬)
          ==================================================================== */}
      {selectedStudentNote && (
        <StudentNoteFullscreenViewer
          noteRecord={selectedStudentNote}
          initialPageIdx={selectedStudentNotePageIdx}
          isLoading={isLoadingNoteDetail}
          onClose={() => setSelectedStudentNote(null)}
          onSendFeedback={(studentName: string) => {
            showToast(`🌟 ${studentName} 학생에게 '참 잘했어요!' 피드백을 전달했습니다.`);
          }}
        />
      )}

      {/* ====================================================================
          모달 1-5: 학생 필기 모음집 단일 PDF 저장 및 구글드라이브 업로드
          ==================================================================== */}
      {activeModal === 'save_pdf_modal' && activeQrLesson && (
        <div className="modal-backdrop" onClick={() => !isGeneratingPdf && setActiveModal('qr_lesson_viewer')}>
          <div className="modal-box" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '22px' }}>📑</span>
                <h2 style={{ fontSize: '17px', margin: 0, fontWeight: 700 }}>
                  수업 필기 모음집 PDF로 저장
                </h2>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => !isGeneratingPdf && setActiveModal('qr_lesson_viewer')}
                disabled={isGeneratingPdf}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCompileAndSavePdf} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '10px' }}>
              <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.25)', borderRadius: '12px', padding: '12px 14px', fontSize: '12.5px', color: '#93c5fd', lineHeight: 1.5 }}>
                💡 <strong>단일 PDF 통합 저장:</strong> 제출된 모든 학생들의 필기와 학번/이름을 페이지별로 모아 <strong>하나의 통합 PDF 파일</strong>로 제작하여 구글 드라이브에 저장합니다.
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--g-text-secondary)', marginBottom: '6px', fontWeight: 600 }}>
                  저장할 수업 모음집 제목
                </label>
                <input
                  type="text"
                  className="g-form-input"
                  value={pdfCompilationTitle}
                  onChange={(e) => setPdfCompilationTitle(e.target.value)}
                  placeholder="예: 삼각비 형성평가, 1교시 수학필기"
                  required
                  autoFocus
                  disabled={isGeneratingPdf}
                />
              </div>

              {/* 파일명 미리보기 */}
              <div style={{ background: '#1c1f26', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--g-border)' }}>
                <span style={{ fontSize: '11px', color: 'var(--g-text-muted)' }}>생성될 파일명 미리보기</span>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#38bdf8', marginTop: '3px', wordBreak: 'break-all' }}>
                  {(() => {
                    const now = new Date();
                    const dStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
                    const base = pdfCompilationTitle.trim() || activeQrLesson.name.replace('[QR수업]', '').trim();
                    return `${base}_${dStr}.pdf`;
                  })()}
                </div>
              </div>

              {/* 저장 옵션 체크박스 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(255, 255, 255, 0.03)', padding: '12px', borderRadius: '10px', border: '1px solid var(--g-border-subtle)' }}>
                <span style={{ fontSize: '12px', color: '#ffffff', fontWeight: 600, marginBottom: '2px' }}>
                  저장 대상 학생: {studentSubmissions.length}명
                </span>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: '#cbd5e1', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={pdfSaveToDrive}
                    onChange={(e) => setPdfSaveToDrive(e.target.checked)}
                    style={{ accentColor: 'var(--g-primary-blue)', width: '16px', height: '16px' }}
                    disabled={isGeneratingPdf}
                  />
                  <span>☁️ 구글 드라이브 <code>{activeQrLesson.name}</code> 폴더에 자동 업로드</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: '#cbd5e1', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={pdfDownloadLocal}
                    onChange={(e) => setPdfDownloadLocal(e.target.checked)}
                    style={{ accentColor: 'var(--g-primary-blue)', width: '16px', height: '16px' }}
                    disabled={isGeneratingPdf}
                  />
                  <span>💾 내 컴퓨터에도 PDF 파일 즉시 다운로드 받기</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: '#cbd5e1', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={pdfPurgeSupabase}
                    onChange={(e) => setPdfPurgeSupabase(e.target.checked)}
                    style={{ accentColor: '#ef4444', width: '16px', height: '16px' }}
                    disabled={isGeneratingPdf}
                  />
                  <span>🧹 저장 완료 후 Supabase 임시 필기 목록 정리 (용량 절약)</span>
                </label>
              </div>

              {/* 진행 상태 바 */}
              {isGeneratingPdf && pdfProgress && (
                <div style={{ background: 'rgba(37, 99, 235, 0.15)', border: '1px solid #3b82f6', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: '#93c5fd', display: 'flex', justifyContent: 'space-between' }}>
                  <span>🔄 <strong>{pdfProgress.name}</strong> 학생 페이지 변환 중...</span>
                  <span style={{ fontWeight: 700 }}>{pdfProgress.current} / {pdfProgress.total}</span>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <button
                  type="button"
                  className="g-btn g-btn-text"
                  onClick={() => setActiveModal('qr_lesson_viewer')}
                  disabled={isGeneratingPdf}
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="g-btn g-btn-primary"
                  style={{ background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', fontWeight: 700 }}
                  disabled={isGeneratingPdf || studentSubmissions.length === 0}
                >
                  {isGeneratingPdf ? '⏳ PDF 생성 및 업로드 중...' : '🚀 하나의 PDF로 저장 시작'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          모달 2: 이름 바꾸기
          ==================================================================== */}
      {activeModal === 'rename' && targetItem && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>이름 바꾸기</h2>
              <button className="modal-close-btn" onClick={() => setActiveModal(null)}>✕</button>
            </div>
            <form onSubmit={handleRename} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <input 
                type="text" 
                className="g-form-input" 
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
                autoFocus
                required
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="g-btn g-btn-text" onClick={() => setActiveModal(null)}>
                  취소
                </button>
                <button type="submit" className="g-btn g-btn-primary" disabled={isProcessingAction}>
                  {isProcessingAction ? '저장 중...' : '확인'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          모달 3: 휴지통으로 이동 (삭제)
          ==================================================================== */}
      {activeModal === 'delete' && targetItem && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>휴지통으로 이동</h2>
              <button className="modal-close-btn" onClick={() => setActiveModal(null)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <p style={{ color: 'var(--g-text-secondary)', fontSize: '14px', lineHeight: 1.5 }}>
                <strong>'{targetItem.name}'</strong> 항목을 휴지통으로 이동하시겠습니까?
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="g-btn g-btn-text" onClick={() => setActiveModal(null)}>
                  취소
                </button>
                <button 
                  type="button" 
                  className="g-btn g-btn-danger" 
                  onClick={handleDelete}
                  disabled={isProcessingAction}
                >
                  {isProcessingAction ? '이동 중...' : '휴지통으로 이동'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          모달 0: 선생님 / 최고 관리자 로그인 인증 모달
          ==================================================================== */}
      {activeModal === 'login' && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-box" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2><span>🔐</span> 사용자 인증 로그인</h2>
              <button className="modal-close-btn" onClick={() => setActiveModal(null)}>✕</button>
            </div>

            {authMode === 'guest' && (
              <div style={{
                background: 'rgba(168, 199, 250, 0.08)',
                border: '1px solid rgba(168, 199, 250, 0.25)',
                padding: '10px 14px',
                borderRadius: '8px',
                marginBottom: '16px',
                fontSize: '12.5px',
                color: 'var(--g-text-secondary)',
                lineHeight: 1.5
              }}>
                <span style={{ color: 'var(--g-primary-blue)', fontWeight: 600 }}>💡 현재 전자칠판 기본 모드 (다운로드 전용)</span><br/>
                기본 모드에서는 자료 열람 및 다운로드만 가능합니다. 파일 수정/삭제/업로드 또는 새 폴더 생성이 필요하시면 선생님 모드로 로그인해주세요.
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <button
                type="button"
                className={`g-btn ${loginTab === 'teacher' ? 'g-btn-primary' : 'g-btn-text'}`}
                style={{ flex: 1 }}
                onClick={() => { setLoginTab('teacher'); setLoginError(''); }}
              >
                👨‍🏫 선생님 모드
              </button>
              <button
                type="button"
                className={`g-btn ${loginTab === 'admin' ? 'g-btn-primary' : 'g-btn-text'}`}
                style={{ flex: 1 }}
                onClick={() => { setLoginTab('admin'); setLoginError(''); }}
              >
                🛡️ 최고 관리자
              </button>
            </div>

            <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {loginTab === 'teacher' ? (
                <div>
                  <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--g-text-secondary)', marginBottom: '6px' }}>
                    선생님 / 전자칠판 비밀번호
                  </label>
                  <input
                    type="password"
                    className="g-form-input"
                    value={inputTeacherPw}
                    onChange={(e) => setInputTeacherPw(e.target.value)}
                    placeholder="비밀번호 입력"
                    autoFocus
                    required
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--g-text-secondary)', marginBottom: '6px' }}>
                      관리자 아이디
                    </label>
                    <input
                      type="text"
                      className="g-form-input"
                      value={inputAdminId}
                      onChange={(e) => setInputAdminId(e.target.value)}
                      placeholder="admin"
                      autoFocus
                      required
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--g-text-secondary)', marginBottom: '6px' }}>
                      관리자 비밀번호
                    </label>
                    <input
                      type="password"
                      className="g-form-input"
                      value={inputAdminPw}
                      onChange={(e) => setInputAdminPw(e.target.value)}
                      placeholder="비밀번호 입력"
                      required
                    />
                  </div>
                </>
              )}

              {loginError && (
                <div style={{ color: '#f28b82', fontSize: '13px' }}>⚠️ {loginError}</div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                {authMode !== 'guest' ? (
                  <button
                    type="button"
                    className="g-btn g-btn-text"
                    style={{ color: 'var(--g-danger-red)' }}
                    onClick={() => {
                      setAuthMode('guest');
                      localStorage.setItem('lbw_auth_mode', 'guest');
                      setActiveModal(null);
                      showToast('로그아웃 되었습니다.');
                    }}
                  >
                    로그아웃
                  </button>
                ) : <span />}

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" className="g-btn g-btn-text" onClick={() => setActiveModal(null)}>
                    취소
                  </button>
                  <button type="submit" className="g-btn g-btn-primary">
                    로그인
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          모달 4: 드라이브 시스템 설정
          ==================================================================== */}
      {activeModal === 'settings' && (currentSession as any)?.role === 'admin' && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-box" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>⚙️ 드라이브 시스템 설정 (관리자 전용)</h2>
              <button className="modal-close-btn" onClick={() => setActiveModal(null)}>✕</button>
            </div>
            <div style={{ background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.25)', padding: '10px 14px', borderRadius: '8px', fontSize: '12px', color: '#fde047', lineHeight: 1.5, marginBottom: '14px' }}>
              🛡️ <strong>관리자 보안 안내:</strong> 드라이브 루트 폴더 ID, Google API 키 및 앱스 스크립트 URL은 시스템 인프라 정보로 일반 교사 및 학생에게는 숨겨지며 오직 관리자만 변경할 수 있습니다.
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              if (tempRootFolderId.trim()) {
                setRootFolderId(tempRootFolderId.trim());
                localStorage.setItem('lbw_root_folder_id', tempRootFolderId.trim());
                setFolderHistory([{ id: tempRootFolderId.trim(), name: '내 드라이브' }]);
              }
              setGoogleApiKey(tempApiKey.trim());
              localStorage.setItem('lbw_google_api_key', tempApiKey.trim());
              const finalGas = tempGasUrl.trim() || DEFAULT_GAS_UPLOAD_URL;
              setGasUploadUrl(finalGas);
              localStorage.setItem('lbw_gas_upload_url', finalGas);
              setActiveModal(null);
              showToast('✅ 드라이브 인프라 설정이 저장되었습니다.');
            }} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--g-text-secondary)', marginBottom: '6px' }}>
                  📂 루트 폴더 ID
                </label>
                <input 
                  type="text" 
                  className="g-form-input" 
                  value={tempRootFolderId}
                  onChange={(e) => setTempRootFolderId(e.target.value)}
                  placeholder="1Ew38nohOksBhypc2UjHYTmi6bSjbICmn"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--g-text-secondary)', marginBottom: '6px' }}>
                  🔑 Google API 키 (Drive v3)
                </label>
                <input 
                  type="text" 
                  className="g-form-input" 
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--g-text-secondary)', marginBottom: '6px' }}>
                  🚀 Apps Script 업로더 URL
                </label>
                <input 
                  type="text" 
                  className="g-form-input" 
                  value={tempGasUrl}
                  onChange={(e) => setTempGasUrl(e.target.value)}
                  placeholder="https://script.google.com/macros/s/.../exec"
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <button type="button" className="g-btn g-btn-text" onClick={() => setActiveModal(null)}>
                  취소
                </button>
                <button type="submit" className="g-btn g-btn-primary">
                  설정 저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          모달 5: Google Apps Script 코드 안내 모달
          ==================================================================== */}
      {activeModal === 'gas_guide' && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-box" style={{ maxWidth: '640px', maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2><span>⚡</span> 구글 스크립트 코드 업데이트 (삭제/새폴더/이름변경 활성화)</h2>
              <button className="modal-close-btn" onClick={() => setActiveModal(null)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13.5px', color: 'var(--g-text-secondary)', lineHeight: 1.6 }}>
              <div style={{ background: 'rgba(234, 67, 53, 0.12)', border: '1px solid rgba(234, 67, 53, 0.3)', padding: '12px 16px', borderRadius: '8px', color: '#f28b82' }}>
                <strong>⚠️ 왜 지금 삭제가 차단되었나요?</strong><br/>
                현재 등록된 구글 스크립트 웹앱은 최초의 <strong>'업로드 전용(15줄)'</strong> 스크립트 버전으로 동작하고 있습니다.<br/>
                구글 정책상 파일 삭제/이름변경/새폴더 명령을 처리하려면 아래의 <strong>통합 스크립트</strong>로 코드를 업데이트해 주셔야 합니다!
              </div>

              <div style={{ background: '#1e1f20', padding: '14px', borderRadius: '8px', border: '1px solid var(--g-border)' }}>
                <strong style={{ color: '#ffffff' }}>📌 30초 업데이트 순서:</strong>
                <ol style={{ paddingLeft: '1.25rem', marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <li><a href="https://script.google.com/home/start" target="_blank" rel="noreferrer" style={{ color: 'var(--g-primary-blue)', fontWeight: 700 }}>script.google.com</a>에 접속하여 사용 중인 프로젝트 열기</li>
                  <li>기존 코드를 지우고 아래 <strong>[코드 복사]</strong> 버튼을 눌러 붙여넣기</li>
                  <li>우측 상단 <strong>[배포] ➡️ [새 배포]</strong> 클릭 (또는 배포 관리에서 수정)</li>
                  <li>유형: <strong>웹 앱</strong>, 액세스 권한: <strong>'모든 사용자(Anyone)'</strong> 확인 후 <strong>[배포]</strong> 클릭!</li>
                  <li>새 URL이 발급되었다면 복사하여 아래에 등록해 주시면 끝납니다.</li>
                </ol>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, color: '#f1f3f4' }}>📋 복사할 최신 통합 스크립트:</span>
                <button 
                  className="g-btn g-btn-primary" 
                  style={{ height: '32px', padding: '0 12px', fontSize: '12.5px' }}
                  onClick={() => {
                    navigator.clipboard.writeText(GAS_CODE_TEMPLATE);
                    showToast('✅ 스크립트 코드가 복사되었습니다! script.google.com에 붙여넣어 주세요.');
                  }}
                >
                  📋 코드 복사하기
                </button>
              </div>
              <pre style={{ background: '#131314', padding: '12px', borderRadius: '8px', fontSize: '12px', overflowX: 'auto', color: 'var(--g-primary-blue)', border: '1px solid var(--g-border)', maxHeight: '200px' }}>
                {GAS_CODE_TEMPLATE}
              </pre>

              <div style={{ marginTop: '4px' }}>
                <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--g-text-secondary)', marginBottom: '6px' }}>
                  🔗 새로 발급된 웹앱 URL 등록 (URL이 변경된 경우에만):
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input 
                    type="text" 
                    className="g-form-input" 
                    style={{ flex: 1 }}
                    value={tempGasUrl}
                    onChange={(e) => setTempGasUrl(e.target.value)}
                    placeholder="https://script.google.com/macros/s/.../exec"
                  />
                  <button 
                    className="g-btn g-btn-primary"
                    onClick={() => {
                      if (tempGasUrl.trim()) {
                        setGasUploadUrl(tempGasUrl.trim());
                        localStorage.setItem('lbw_gas_upload_url', tempGasUrl.trim());
                        showToast('✅ 웹앱 URL이 저장되었습니다.');
                        setActiveModal(null);
                      }
                    }}
                  >
                    저장
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                <button className="g-btn g-btn-text" onClick={() => setActiveModal(null)}>
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 관리자 계정 & 비밀번호 통합 관리 대시보드 모달 */}
      {isAdminDashboardOpen && (
        <AdminDashboardModal
          driveFolderNames={driveTeacherFolders}
          onClose={() => setIsAdminDashboardOpen(false)}
          onToast={showToast}
          onAddTeacher={handleAddTeacher}
          onRefreshDriveFolders={fetchRootTeacherFolders}
        />
      )}

      {/* 하단 토스트 알림 */}
      {toastMessage && (
        <div className="toast-container">
          <span>🔔</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 카메라 QR코드 스캐너 모달 */}
      <QrScannerModal
        isOpen={isQrScannerOpen}
        onClose={() => setIsQrScannerOpen(false)}
        onScanSuccess={handleScannedResult}
      />

      {/* 구형 전자칠판 내장브라우저 전용 백그라운드 다운로드 숨김 iframe (화면 이탈 및 먹통 100% 방지) */}
      <iframe 
        id="gdrive-download-iframe" 
        style={{ display: 'none', width: 0, height: 0, border: 0 }} 
        aria-hidden="true" 
        title="gdrive-download-iframe"
      />
      {/* 최신 버전 자동 업데이트 전체화면 오버레이 */}
      <VersionUpdateOverlay isOpen={isUpdating} newVersionTime={newVersionInfo?.buildTime} />
    </div>
  );
}

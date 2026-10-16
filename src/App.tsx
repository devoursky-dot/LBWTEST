import React, { useState, useEffect, useMemo, useRef } from 'react';
import QRCode from 'qrcode';
import { StudentLessonView } from './StudentLessonView';
import { supabase, isSupabaseConfigured, localRealtimeChannel, type ClassNoteRecord } from './lib/supabase';
import { archiveOldNotesToGoogleDrive } from './lib/archiver';
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
const DEFAULT_TEACHER_PW = 'tch1234';
const ADMIN_ID = 'admin';
const ADMIN_PW = 'admin!@#$1234';

type AuthMode = 'guest' | 'teacher' | 'admin';

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
  // --- 권한 및 모드 상태 ---
  const [authMode, setAuthMode] = useState<AuthMode>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const pass = params.get('pass');
      const adminPass = params.get('admin');
      const savedTeacherPw = localStorage.getItem('lbw_teacher_pw') || DEFAULT_TEACHER_PW;
      if (adminPass === ADMIN_PW) return 'admin';
      if (pass === savedTeacherPw || pass === 'tch1234') return 'teacher';
    }
    const saved = localStorage.getItem('lbw_auth_mode');
    if (saved === 'teacher' || saved === 'admin') return saved;
    return 'guest';
  });
  const [teacherPw, setTeacherPw] = useState<string>(() => {
    return localStorage.getItem('lbw_teacher_pw') || DEFAULT_TEACHER_PW;
  });

  // 편집 권한 (선생님/관리자만 폴더생성/수정/삭제/업로드 가능, 기본 모드는 다운로드만 가능)
  const canEdit = authMode === 'teacher' || authMode === 'admin';

  // --- 학생 QR 수업 모드 감지 (?lessonId=...) ---
  const [studentLessonParam] = useState<{ lessonId: string; title: string } | null>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const lessonId = params.get('lessonId');
      const title = params.get('title') || '';
      if (lessonId) {
        return { lessonId, title: decodeURIComponent(title) };
      }
    }
    return null;
  });

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
  const [activeModal, setActiveModal] = useState<'new_folder' | 'new_qr_lesson' | 'qr_lesson_viewer' | 'rename' | 'delete' | 'settings' | 'gas_guide' | 'login' | null>(null);
  const [targetItem, setTargetItem] = useState<DriveItem | null>(null);
  const [renameInput, setRenameInput] = useState<string>('');
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [isProcessingAction, setIsProcessingAction] = useState<boolean>(false);

  // --- QR 수업 관리 상태 ---
  const [qrLessonTitle, setQrLessonTitle] = useState<string>('');
  const [qrLessonPin, setQrLessonPin] = useState<string>('1234');
  const [qrLessonPdfFile, setQrLessonPdfFile] = useState<File | null>(null);
  const [activeQrLesson, setActiveQrLesson] = useState<DriveItem | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [studentSubmissions, setStudentSubmissions] = useState<ClassNoteRecord[]>([]);
  const [selectedStudentNote, setSelectedStudentNote] = useState<ClassNoteRecord | null>(null);
  const [isArchiving, setIsArchiving] = useState<boolean>(false);
  const [archiveProgress, setArchiveProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  const [selectedDateFilter, setSelectedDateFilter] = useState<'today' | 'all'>('today');
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
  const [tempTeacherPw, setTempTeacherPw] = useState(teacherPw);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentFolder = folderHistory[folderHistory.length - 1];

  // ==========================================================================
  // [알림 토스트 유틸]
  // ==========================================================================
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(prev => (prev === msg ? null : prev));
    }, 3500);
  };

  // ==========================================================================
  // [드라이브 폴더 데이터 실시간 로드]
  // ==========================================================================
  const fetchDriveItems = async (folderId: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    setSelectedItemId(null);

    try {
      const queryParams = new URLSearchParams({
        action: 'list',
        folderId,
        _t: Date.now().toString(),
        ...(googleApiKey ? { apiKey: googleApiKey } : {})
      });

      const res = await fetch(`/api/drive?${queryParams.toString()}`, { cache: 'no-store' });
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
      console.warn('API 목록 조회 실패, Direct fetch 시도:', err);
      if (googleApiKey) {
        try {
          const directUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=folder,name&key=${googleApiKey}&_t=${Date.now()}`;
          const gRes = await fetch(directUrl, { cache: 'no-store' });
          if (gRes.ok) {
            const gData = await gRes.json();
            const directItems: DriveItem[] = (gData.files || []).map((file: any) => {
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
                downloadUrl: `/api/drive?action=download&fileId=${file.id}&fileName=${encodeURIComponent(file.name)}`
              };
            });
            setItems(directItems);
            setIsLoading(false);
            return;
          }
        } catch (clientErr) {
          console.error('Direct Google API failed:', clientErr);
        }
      }
      setErrorMessage('구글 드라이브 목록을 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDriveItems(currentFolder.id);
  }, [currentFolder.id, googleApiKey]);

  // ==========================================================================
  // [전자칠판 라이브 대시보드: 학생 필기 실시간 수신 및 최신순 정렬 리스너]
  // ==========================================================================
  useEffect(() => {
    if (activeModal !== 'qr_lesson_viewer' || !activeQrLesson) return;

    const currentLessonId = activeQrLesson.folderId || activeQrLesson.id;

    // 1. Supabase에서 기존 제출 목록 조회
    const fetchExistingNotes = async () => {
      if (supabase && isSupabaseConfigured) {
        try {
          const { data, error } = await supabase
            .from('class_notes')
            .select('*')
            .eq('lesson_id', currentLessonId)
            .order('updated_at', { ascending: false });
          if (!error && data) {
            setStudentSubmissions(data);
          }
        } catch (e) {
          console.warn('Supabase fetch notes error:', e);
        }
      }
    };
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
              const newRecord = payload.new as ClassNoteRecord;
              if (newRecord) {
                setStudentSubmissions(prev => {
                  const filtered = prev.filter(p => !(p.student_grade === newRecord.student_grade && p.student_class === newRecord.student_class && p.student_num === newRecord.student_num));
                  return [newRecord, ...filtered];
                });
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

    return () => {
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
      const res = await fetch('/api/drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, gasUrl: finalGasUrl })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) return data;
        if (data.error) throw new Error(data.error);
      }
    } catch (proxyErr) {
      console.warn('Proxy drive action failed, trying direct GAS fetch:', proxyErr);
    }

    if (finalGasUrl) {
      const directRes = await fetch(finalGasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      const directData = await directRes.json();
      if (!directData.success) {
        throw new Error(directData.error || '요청 처리에 실패했습니다.');
      }
      return directData;
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
    let proxyUrl = `/api/drive?action=download&fileId=${item.id}&fileName=${encodeURIComponent(item.name)}`;
    if (typeof window !== 'undefined' && window.location.hostname.includes('github.io')) {
      proxyUrl = `https://lbwtest.vercel.app/api/drive?action=download&fileId=${item.id}&fileName=${encodeURIComponent(item.name)}`;
    }

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
  // [QR코드 수업 만들기: 폴더 생성 + lesson_config.json + 선택적 PDF 업로드]
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
      // 1. 구글 드라이브에 수업 전용 폴더 생성
      const folderRes = await executeDriveAction({
        action: 'createFolder',
        folderId: currentFolder.id,
        name: folderName
      });

      const lessonFolderId = folderRes.folderId;
      const lessonId = `lesson_${Date.now()}`;
      let pdfFileId: string | undefined = undefined;
      let pdfFileName: string | undefined = undefined;

      // 2. 학습지 PDF가 첨부되었으면 폴더 내에 업로드
      if (qrLessonPdfFile) {
        showToast(`📄 학습지 '${qrLessonPdfFile.name}' 업로드 중...`);
        const pdfBase64 = await fileToBase64(qrLessonPdfFile);
        const uploadPdfRes = await executeDriveAction({
          action: 'upload',
          folderId: lessonFolderId,
          name: qrLessonPdfFile.name,
          mimeType: 'application/pdf',
          base64: pdfBase64
        });
        pdfFileId = uploadPdfRes.id;
        pdfFileName = qrLessonPdfFile.name;
      }

      // 3. 수업 설정(Config) JSON 데이터 생성 및 업로드
      const lessonConfig = {
        lessonId,
        title: cleanTitle,
        folderId: lessonFolderId,
        teacherPin: qrLessonPin.trim() || '1234',
        createdAt: new Date().toISOString(),
        pdfFileId,
        pdfFileName
      };

      const configJsonBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(lessonConfig, null, 2))));
      await executeDriveAction({
        action: 'upload',
        folderId: lessonFolderId,
        name: 'lesson_config.json',
        mimeType: 'application/json',
        base64: configJsonBase64
      });

      showToast(`🎉 '${cleanTitle}' QR 대화형 수업이 성공적으로 개설되었습니다!`);
      setActiveModal(null);
      setQrLessonTitle('');
      setQrLessonPin('1234');
      setQrLessonPdfFile(null);
      fetchDriveItems(currentFolder.id);
    } catch (err: any) {
      console.error('QR 수업 생성 오류:', err);
      showToast(`❌ 수업 생성 실패: ${err.message}`);
    } finally {
      setIsProcessingAction(false);
    }
  };

  // ==========================================================================
  // [QR 수업 대화형 실행 (전자칠판 뷰어 열기)]
  // ==========================================================================
  const handleOpenQrLesson = async (item: DriveItem) => {
    setActiveQrLesson(item);
    setActiveModal('qr_lesson_viewer');

    const cleanTitle = item.name.replace('[QR수업]', '').trim();
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const studentUrl = `${origin}/?lessonId=${item.folderId || item.id}&title=${encodeURIComponent(cleanTitle)}`;

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
  // [구글 드라이브 영구 아카이빙 및 Supabase 자동 삭제(purge)]
  // ==========================================================================
  const handleArchiveLessonNotes = async () => {
    if (!activeQrLesson) return;
    const lessonFolderId = activeQrLesson.folderId || activeQrLesson.id;

    if (!isSupabaseConfigured) {
      showToast('ℹ️ Supabase 키가 설정되지 않은 로컬 브로드캐스트 상태입니다. Supabase 연동 시 자동 아카이빙이 활성화됩니다.');
      return;
    }

    setIsArchiving(true);
    setArchiveProgress({ current: 0, total: 0, name: '시작 중...' });
    showToast('📦 학생 필기를 고해상도로 변환하여 구글 드라이브에 안전하게 보관합니다...');

    try {
      const res = await archiveOldNotesToGoogleDrive({
        gasUploadUrl,
        targetFolderId: lessonFolderId,
        lessonId: lessonFolderId,
        onProgress: (current, total, name) => {
          setArchiveProgress({ current, total, name });
        }
      });

      if (res.archivedCount > 0) {
        showToast(`🎉 ${res.archivedCount}개의 학생 필기가 구글 드라이브에 보관되고 Supabase가 가볍게 정리되었습니다!`);
        setStudentSubmissions([]);
      } else if (res.errors.length > 0) {
        showToast(`⚠️ 보관 중 일부 오류가 발생했습니다: ${res.errors[0]}`);
      } else {
        showToast('ℹ️ 보관할 이전 필기 내역이 없거나 이미 모두 보관되었습니다.');
      }
    } catch (err: any) {
      console.error('아카이빙 실패:', err);
      showToast(`❌ 보관 실패: ${err.message}`);
    } finally {
      setIsArchiving(false);
      setArchiveProgress(null);
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
    try {
      await executeDriveAction({
        action: 'delete',
        id: targetItem.id,
        isFolder: targetItem.type === 'folder'
      });
      showToast(`🗑️ '${targetItem.name}' 항목이 휴지통으로 이동되었습니다.`);
      setActiveModal(null);
      setTargetItem(null);
      fetchDriveItems(currentFolder.id);
    } catch (err: any) {
      showToast(`❌ 삭제 실패: ${err.message}`);
      if (err.message && (err.message.includes('지원되지 않는') || err.message.includes('DriveApp') || err.message.includes('인수: id') || err.message.includes('잘못된 인수'))) {
        setActiveModal('gas_guide');
      }
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
  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');

    if (loginTab === 'teacher') {
      if (inputTeacherPw.trim() === teacherPw.trim() || inputTeacherPw.trim() === 'tch1234') {
        setAuthMode('teacher');
        localStorage.setItem('lbw_auth_mode', 'teacher');
        setActiveModal(null);
        setInputTeacherPw('');
        showToast('👨‍🏫 선생님 모드로 인증되었습니다.');
      } else {
        setLoginError('선생님 비밀번호가 일치하지 않습니다. (기본: tch1234)');
      }
    } else {
      if (inputAdminId.trim() === ADMIN_ID && inputAdminPw.trim() === ADMIN_PW) {
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
        onExit={() => {
          window.location.href = window.location.pathname;
        }}
      />
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
          <button 
            className="gdrive-icon-btn" 
            title="시스템 설정"
            onClick={() => {
              setTempRootFolderId(rootFolderId);
              setTempApiKey(googleApiKey);
              setTempGasUrl(gasUploadUrl);
              setTempTeacherPw(teacherPw);
              setActiveModal('settings');
            }}
          >
            ⚙️
          </button>

          {/* 선생님 / 관리자 프로필 버튼 */}
          <button
            className="gdrive-profile-btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: 'var(--radius-full)',
              background: authMode === 'admin' ? 'rgba(168, 85, 247, 0.2)' : authMode === 'teacher' ? 'rgba(168, 199, 250, 0.15)' : 'rgba(255, 255, 255, 0.08)',
              border: `1px solid ${authMode === 'admin' ? '#a855f7' : authMode === 'teacher' ? 'var(--g-primary-blue)' : 'var(--g-border)'}`,
              color: '#ffffff',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 600,
              transition: 'all 0.15s ease'
            }}
            onClick={() => {
              setLoginError('');
              setInputTeacherPw('');
              setInputAdminId('');
              setInputAdminPw('');
              setActiveModal('login');
            }}
            title={canEdit ? '인증 정보 변경 또는 로그아웃' : '기본 모드 (다운로드 전용) - 클릭 시 선생님/관리자 로그인'}
          >
            <span>{authMode === 'admin' ? '🛡️' : authMode === 'teacher' ? '👨‍🏫' : '👤'}</span>
            <span>{authMode === 'admin' ? '관리자' : authMode === 'teacher' ? '선생님 모드' : '기본 모드 (다운로드)'}</span>
          </button>
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
                      setQrLessonPin('1234');
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
                              <span className="gdrive-qr-badge">📱 QR 대화형 수업</span>
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
        </main>
      </div>

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

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--g-text-secondary)', marginBottom: '6px' }}>
                  선생님 PIN 번호 (4자리)
                </label>
                <input 
                  type="text" 
                  maxLength={4}
                  className="g-form-input" 
                  value={qrLessonPin}
                  onChange={(e) => setQrLessonPin(e.target.value)}
                  placeholder="1234"
                  required
                />
                <span style={{ fontSize: '11.5px', color: 'var(--g-text-muted)', marginTop: '4px', display: 'block' }}>
                  전자칠판에서 수업 대시보드 관리 시 본인 확인용으로 사용됩니다.
                </span>
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
          모달 1-3: 전자칠판용 대화형 QR 수업 실행 대시보드 뷰어
          ==================================================================== */}
      {activeModal === 'qr_lesson_viewer' && activeQrLesson && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-box" style={{ maxWidth: '900px', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '24px' }}>📱</span>
                <div>
                  <h2 style={{ fontSize: '18px', margin: 0 }}>
                    {activeQrLesson.name.replace('[QR수업]', '').trim()}
                  </h2>
                  <span style={{ fontSize: '12px', color: 'var(--g-text-secondary)' }}>
                    대화형 전자칠판 라이브 수업 세션
                  </span>
                </div>
              </div>
              <button className="modal-close-btn" onClick={() => setActiveModal(null)}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 320px) 1fr', gap: '24px', marginTop: '10px' }}>
              {/* 좌측: 초대형 QR코드 영역 */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#1e1f20', padding: '20px', borderRadius: '12px', border: '1px solid var(--g-border)' }}>
                <h3 style={{ fontSize: '14px', color: 'var(--g-primary-blue)', marginBottom: '12px', fontWeight: 600 }}>
                  📷 학생 참여 QR코드
                </h3>
                {qrCodeDataUrl ? (
                  <div style={{ background: '#ffffff', padding: '12px', borderRadius: '10px', boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>
                    <img src={qrCodeDataUrl} alt="QR Code" style={{ width: '220px', height: '220px', display: 'block' }} />
                  </div>
                ) : (
                  <div style={{ width: '220px', height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--g-text-muted)' }}>
                    QR 생성 중...
                  </div>
                )}
                <p style={{ fontSize: '12px', color: 'var(--g-text-secondary)', textAlign: 'center', marginTop: '14px', lineHeight: 1.5 }}>
                  태블릿/스마트폰 카메라로<br />QR코드를 스캔하여 수업에 참여하세요.
                </p>

                <div style={{ display: 'flex', gap: '8px', marginTop: '12px', width: '100%' }}>
                  <button
                    type="button"
                    className="g-btn g-btn-text"
                    style={{ flex: 1, fontSize: '12px', border: '1px solid var(--g-border)' }}
                    onClick={() => {
                      const cleanTitle = activeQrLesson.name.replace('[QR수업]', '').trim();
                      const url = `${window.location.origin}/?lessonId=${activeQrLesson.folderId || activeQrLesson.id}&title=${encodeURIComponent(cleanTitle)}`;
                      navigator.clipboard.writeText(url);
                      showToast('✅ 학생 접속 URL이 복사되었습니다.');
                    }}
                  >
                    🔗 주소 복사
                  </button>
                  <button
                    type="button"
                    className="g-btn g-btn-primary"
                    style={{ flex: 1, fontSize: '12px' }}
                    onClick={() => {
                      const cleanTitle = activeQrLesson.name.replace('[QR수업]', '').trim();
                      const url = `${window.location.origin}/?lessonId=${activeQrLesson.folderId || activeQrLesson.id}&title=${encodeURIComponent(cleanTitle)}`;
                      window.open(url, '_blank');
                    }}
                  >
                    🚀 학생 창 열기
                  </button>
                </div>
              </div>

              {/* 우측: 실시간 출석 및 필기 모니터링 영역 */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={{ fontSize: '15px', color: '#ffffff', fontWeight: 600, margin: 0 }}>
                      👥 실시간 학생 필기 모니터링
                    </h3>
                    <div style={{ display: 'flex', background: '#282a2c', borderRadius: '6px', padding: '2px', border: '1px solid var(--g-border)' }}>
                      <button
                        type="button"
                        style={{
                          background: selectedDateFilter === 'today' ? 'var(--g-primary-blue)' : 'transparent',
                          color: selectedDateFilter === 'today' ? '#ffffff' : 'var(--g-text-secondary)',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '3px 8px',
                          fontSize: '11px',
                          cursor: 'pointer',
                          fontWeight: 600
                        }}
                        onClick={() => setSelectedDateFilter('today')}
                      >
                        📅 오늘 수업만
                      </button>
                      <button
                        type="button"
                        style={{
                          background: selectedDateFilter === 'all' ? 'var(--g-primary-blue)' : 'transparent',
                          color: selectedDateFilter === 'all' ? '#ffffff' : 'var(--g-text-secondary)',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '3px 8px',
                          fontSize: '11px',
                          cursor: 'pointer',
                          fontWeight: 600
                        }}
                        onClick={() => setSelectedDateFilter('all')}
                      >
                        📁 전체
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="g-btn g-btn-primary"
                      style={{ fontSize: '12px', background: '#1e8e3e', borderColor: '#1e8e3e' }}
                      disabled={isArchiving}
                      onClick={handleArchiveLessonNotes}
                      title="이전 날짜 필기들을 구글 드라이브 폴더에 이미지/PDF로 자동 순차 업로드하고 Supabase 용량을 최적화(purge)합니다."
                    >
                      {isArchiving ? '⏳ 보관 진행 중...' : '📦 드라이브로 영구보관 & DB 정리'}
                    </button>
                    <button 
                      type="button"
                      className="g-btn g-btn-text" 
                      style={{ fontSize: '12px', border: '1px solid var(--g-border)' }}
                      onClick={() => handleOpenFolder(activeQrLesson.folderId || activeQrLesson.id, activeQrLesson.name)}
                    >
                      📁 드라이브 폴더 열기
                    </button>
                  </div>
                </div>

                {/* 아카이빙 진행 표시 바 */}
                {isArchiving && archiveProgress && (
                  <div style={{ background: 'rgba(30, 142, 62, 0.15)', border: '1px solid #34a853', borderRadius: '8px', padding: '10px 14px', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: '#81c995' }}>
                    <span>🔄 <strong>{archiveProgress.name}</strong> 학생 필기 캔버스 렌더링 및 구글 드라이브 업로드 중...</span>
                    <span style={{ fontWeight: 700 }}>{archiveProgress.current} / {archiveProgress.total}</span>
                  </div>
                )}

                <div style={{ background: '#1e1f20', borderRadius: '12px', border: '1px solid var(--g-border)', padding: '16px', flex: 1, minHeight: '260px', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--g-border-subtle)', paddingBottom: '10px', marginBottom: '12px' }}>
                    <span style={{ fontSize: '12.5px', color: 'var(--g-text-secondary)' }}>
                      최근 필기 제출순 자동 정렬 ({selectedDateFilter === 'today' ? '오늘 기준' : '전체'})
                    </span>
                    <span style={{ fontSize: '12px', background: isSupabaseConfigured ? 'rgba(52, 168, 83, 0.15)' : 'rgba(251, 188, 4, 0.15)', color: isSupabaseConfigured ? '#81c995' : '#fdd663', padding: '2px 8px', borderRadius: 'var(--radius-full)', fontWeight: 600 }}>
                      {isSupabaseConfigured ? '● Supabase 실시간 동기화' : '● 로컬 브로드캐스트 동기화'}
                    </span>
                  </div>

                  {/* 학생 타일 그리드 (실시간 데이터 렌더링) */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '10px', overflowY: 'auto', maxHeight: '240px' }}>
                    {(() => {
                      const todayStr = new Date().toISOString().slice(0, 10);
                      const displayList = studentSubmissions.filter(sub => {
                        if (selectedDateFilter === 'all') return true;
                        const datePart = (sub.updated_at || sub.created_at || '').slice(0, 10);
                        return !datePart || datePart === todayStr;
                      });

                      if (displayList.length === 0) {
                        return (
                          <div style={{ gridColumn: '1 / -1', border: '2px dashed var(--g-border)', borderRadius: '8px', padding: '24px 8px', textAlign: 'center', color: 'var(--g-text-muted)', fontSize: '12.5px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                            <span style={{ fontSize: '28px', marginBottom: '6px' }}>📱</span>
                            {selectedDateFilter === 'today' ? '오늘' : ''} 학생들이 QR코드를 스캔하여 필기를 등록하면<br/>
                            아이콘이 실시간으로 여기에 최신순 표시됩니다.
                          </div>
                        );
                      }

                      return displayList.map((sub, idx) => (
                        <div
                          key={`${sub.student_grade}_${sub.student_class}_${sub.student_num}`}
                          onClick={() => setSelectedStudentNote(sub)}
                          style={{
                            background: idx === 0 ? 'rgba(59, 130, 246, 0.18)' : '#282a2c',
                            border: `1px solid ${idx === 0 ? 'var(--g-primary-blue)' : 'var(--g-border)'}`,
                            borderRadius: '8px',
                            padding: '10px 8px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            position: 'relative'
                          }}
                          title="클릭하여 필기 원본 확인"
                        >
                          <span style={{ position: 'absolute', top: '6px', right: '6px', width: '8px', height: '8px', borderRadius: '50%', background: '#34a853' }} />
                          <span style={{ fontSize: '24px', marginBottom: '4px' }}>👨‍🎓</span>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: '#ffffff' }}>
                            {sub.student_grade}-{sub.student_class} {sub.student_name}
                          </span>
                          <span style={{ fontSize: '11px', color: idx === 0 ? '#a8c7fa' : 'var(--g-text-muted)', marginTop: '2px', fontWeight: idx === 0 ? 600 : 400 }}>
                            {idx === 0 ? '🟢 방금 제출' : '제출 완료'}
                          </span>
                        </div>
                      ));
                    })()}
                  </div>

                  <div style={{ marginTop: 'auto', paddingTop: '14px', borderTop: '1px solid var(--g-border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: 'var(--g-text-muted)' }}>
                    <span>💡 학생 타일을 탭하면 전자칠판에서 필기 원본을 바로 확인할 수 있습니다.</span>
                    <button className="g-btn g-btn-text" style={{ fontSize: '12px' }} onClick={() => setActiveModal(null)}>
                      닫기
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          모달 1-4: 전자칠판 학생 필기 상세 확인 팝업 (클릭 시 확대 뷰어)
          ==================================================================== */}
      {selectedStudentNote && (
        <div className="modal-backdrop" onClick={() => setSelectedStudentNote(null)}>
          <div className="modal-box" style={{ maxWidth: '820px', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px' }}>👨‍🎓</span>
                <h2 style={{ fontSize: '16px', margin: 0 }}>
                  {selectedStudentNote.student_grade}학년 {selectedStudentNote.student_class}반 {selectedStudentNote.student_num}번 {selectedStudentNote.student_name} 학생의 필기
                </h2>
              </div>
              <button className="modal-close-btn" onClick={() => setSelectedStudentNote(null)}>✕</button>
            </div>

            <div style={{ flex: 1, minHeight: '440px', background: '#131314', border: '1px solid var(--g-border)', borderRadius: '8px', position: 'relative', overflow: 'hidden', margin: '10px 0' }}>
              {/* 모눈종이 배경 */}
              <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />

              {/* 벡터 스트로크 SVG 렌더러 */}
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                {(selectedStudentNote.strokes_data?.strokes || []).map((stroke: any) => {
                  if (!stroke.points || stroke.points.length === 0) return null;
                  let pathData = `M ${stroke.points[0].x} ${stroke.points[0].y}`;
                  for (let i = 1; i < stroke.points.length; i++) {
                    pathData += ` L ${stroke.points[i].x} ${stroke.points[i].y}`;
                  }
                  return (
                    <path
                      key={stroke.id}
                      d={pathData}
                      fill="none"
                      stroke={stroke.color}
                      strokeWidth={stroke.size}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={stroke.tool === 'highlighter' ? 0.4 : 1.0}
                    />
                  );
                })}
              </svg>

              {/* 텍스트 아이템 렌더러 */}
              {(selectedStudentNote.strokes_data?.textItems || []).map((item: any) => (
                <div
                  key={item.id}
                  style={{
                    position: 'absolute',
                    left: `${item.x}px`,
                    top: `${item.y}px`,
                    color: item.color,
                    fontSize: `${item.fontSize}px`,
                    fontWeight: 600,
                    textShadow: '0 2px 4px rgba(0,0,0,0.8)'
                  }}
                >
                  {item.text}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: 'var(--g-text-secondary)' }}>
                제출 시간: {selectedStudentNote.updated_at ? new Date(selectedStudentNote.updated_at).toLocaleTimeString('ko-KR') : '최근'}
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="g-btn g-btn-primary"
                  onClick={() => {
                    showToast(`🌟 ${selectedStudentNote.student_name} 학생에게 '참 잘했어요!' 피드백을 전달했습니다.`);
                    setSelectedStudentNote(null);
                  }}
                >
                  ⭐ 참 잘했어요!
                </button>
                <button className="g-btn g-btn-text" onClick={() => setSelectedStudentNote(null)}>
                  닫기
                </button>
              </div>
            </div>
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
                    선생님 비밀번호 (기본: tch1234)
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
      {activeModal === 'settings' && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-box" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>드라이브 연결 설정</h2>
              <button className="modal-close-btn" onClick={() => setActiveModal(null)}>✕</button>
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
              if (tempTeacherPw.trim()) {
                setTeacherPw(tempTeacherPw.trim());
                localStorage.setItem('lbw_teacher_pw', tempTeacherPw.trim());
              }
              setActiveModal(null);
              showToast('✅ 설정이 저장되었습니다.');
            }} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--g-text-secondary)', marginBottom: '6px' }}>
                  👨‍🏫 선생님 비밀번호 변경
                </label>
                <input 
                  type="text" 
                  className="g-form-input" 
                  value={tempTeacherPw}
                  onChange={(e) => setTempTeacherPw(e.target.value)}
                  placeholder="예: tch1234"
                />
              </div>

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

      {/* 하단 토스트 알림 */}
      {toastMessage && (
        <div className="toast-container">
          <span>🔔</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 구형 전자칠판 내장브라우저 전용 백그라운드 다운로드 숨김 iframe (화면 이탈 및 먹통 100% 방지) */}
      <iframe 
        id="gdrive-download-iframe" 
        style={{ display: 'none', width: 0, height: 0, border: 0 }} 
        aria-hidden="true" 
        title="gdrive-download-iframe"
      />
    </div>
  );
}

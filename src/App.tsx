import React, { useState, useEffect, useMemo, useRef } from 'react';
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
}

const DEFAULT_ROOT_FOLDER_ID = '1Ew38nohOksBhypc2UjHYTmi6bSjbICmn';
const DEFAULT_GOOGLE_API_KEY = 'AIzaSyAmEvx5j8IFigp22Ujp1Cm8lF4wpi0xlFw';
const DEFAULT_GAS_UPLOAD_URL = (import.meta.env.VITE_GAS_UPLOAD_URL as string) || 'https://script.google.com/macros/s/AKfycbx_J2hdpXKy8iKFu8cxof4aKGYdhFO4ea93_E3a3KTeTNRbHMaaV4Fo7IkjbeDGUkli/exec';

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
  const [activeModal, setActiveModal] = useState<'new_folder' | 'rename' | 'delete' | 'settings' | 'gas_guide' | null>(null);
  const [targetItem, setTargetItem] = useState<DriveItem | null>(null);
  const [renameInput, setRenameInput] = useState<string>('');
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [isProcessingAction, setIsProcessingAction] = useState<boolean>(false);

  // 설정 폼 임시 상태
  const [tempRootFolderId, setTempRootFolderId] = useState(rootFolderId);
  const [tempApiKey, setTempApiKey] = useState(googleApiKey);
  const [tempGasUrl, setTempGasUrl] = useState(gasUploadUrl);

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
  // [파일 다운로드]
  // ==========================================================================
  const handleDownload = (item: DriveItem) => {
    showToast(`⚡ '${item.name}' 다운로드를 시작합니다...`);
    const proxyUrl = `/api/drive?action=download&fileId=${item.id}&fileName=${encodeURIComponent(item.name)}`;
    const link = document.createElement('a');
    link.href = proxyUrl;
    link.setAttribute('download', item.name);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ==========================================================================
  // [새 폴더 만들기]
  // ==========================================================================
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
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
  // [이름 바꾸기]
  // ==========================================================================
  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
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
              setActiveModal('settings');
            }}
          >
            ⚙️
          </button>
        </div>
      </header>

      {/* ====================================================================
          2. 바디 (사이드바 + 메인 뷰)
          ==================================================================== */}
      <div className="gdrive-body">
        {/* 좌측 사이드바 */}
        <aside className="gdrive-sidebar" onClick={(e) => e.stopPropagation()}>
          {/* [+ 새로 만들기] 버튼 */}
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
                {selectedItem.type !== 'folder' && (
                  <button 
                    className="gdrive-action-chip" 
                    onClick={() => handleDownload(selectedItem)}
                  >
                    <span>📥</span> 다운로드
                  </button>
                )}
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
                    return (
                      <tr 
                        key={item.id}
                        className={`gdrive-row ${item.type} ${isSelected ? 'selected' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedItemId(item.id);
                        }}
                        onDoubleClick={() => {
                          if (item.type === 'folder') {
                            handleOpenFolder(item.folderId || item.id, item.name);
                          } else {
                            handleDownload(item);
                          }
                        }}
                      >
                        <td>
                          <div className="gdrive-name-cell">
                            <span className="gdrive-item-icon">{getItemIcon(item)}</span>
                            <span className="gdrive-item-name" title={item.name}>{item.name}</span>
                          </div>
                        </td>
                        <td style={{ color: 'var(--g-text-secondary)', fontSize: '13px' }}>
                          {item.updatedAt}
                        </td>
                        <td style={{ color: 'var(--g-text-muted)', fontSize: '13px' }}>
                          {item.size}
                        </td>
                        <td>
                          {/* 마우스 호버 시 나타나는 빠른 액션 */}
                          <div className="gdrive-row-actions" onClick={(e) => e.stopPropagation()}>
                            {item.type !== 'folder' && (
                              <button 
                                className="gdrive-icon-btn" 
                                style={{ width: '32px', height: '32px', fontSize: '15px' }}
                                title="다운로드"
                                onClick={() => handleDownload(item)}
                              >
                                📥
                              </button>
                            )}
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
                      {filteredItems.filter(i => i.type === 'folder').map(folder => (
                        <div 
                          key={folder.id}
                          className={`gdrive-folder-card ${selectedItemId === folder.id ? 'selected' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedItemId(folder.id);
                          }}
                          onDoubleClick={() => handleOpenFolder(folder.folderId || folder.id, folder.name)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                            <span style={{ fontSize: '20px' }}>📁</span>
                            <span className="gdrive-card-title">{folder.name}</span>
                          </div>
                          <button 
                            className="gdrive-icon-btn"
                            style={{ width: '28px', height: '28px', fontSize: '13px' }}
                            title="더보기"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTargetItem(folder);
                              setRenameInput(folder.name);
                              setActiveModal('rename');
                            }}
                          >
                            ✏️
                          </button>
                        </div>
                      ))}
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
              <span style={{ fontSize: '48px' }}>⬆️</span>
              <h3>드라이브에 파일을 업로드하려면 여기에 놓으세요</h3>
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
              setActiveModal(null);
              showToast('✅ 설정이 저장되었습니다.');
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

      {/* 하단 토스트 알림 */}
      {toastMessage && (
        <div className="toast-container">
          <span>🔔</span>
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}

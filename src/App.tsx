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

type AuthMode = 'guest' | 'teacher' | 'admin';

const DEFAULT_ROOT_FOLDER_ID = '1Ew38nohOksBhypc2UjHYTmi6bSjbICmn';
const DEFAULT_TEACHER_PW = 'tch1234';
const DEFAULT_GOOGLE_API_KEY = 'AIzaSyAmEvx5j8IFigp22Ujp1Cm8lF4wpi0xlFw';
const ADMIN_ID = 'admin';
const ADMIN_PW = 'admin!@#$1234';

// 1분 Google Apps Script 표준 코드 템플릿
const GAS_CODE_TEMPLATE = `function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var folderId = data.folderId;
    var folder = DriveApp.getFolderById(folderId);
    var contentType = data.mimeType || 'application/octet-stream';
    var decoded = Utilities.base64Decode(data.base64);
    var blob = Utilities.newBlob(decoded, contentType, data.name);
    var file = folder.createFile(blob);
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      fileId: file.getId(),
      name: file.getName()
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}`;

export default function App() {
  // --- 권한 및 시스템 설정 상태 ---
  const [authMode, setAuthMode] = useState<AuthMode>('guest');
  const [teacherPw, setTeacherPw] = useState<string>(() => {
    return localStorage.getItem('lbw_teacher_pw') || DEFAULT_TEACHER_PW;
  });
  const [rootFolderId, setRootFolderId] = useState<string>(() => {
    return localStorage.getItem('lbw_root_folder_id') || DEFAULT_ROOT_FOLDER_ID;
  });
  const [googleApiKey, setGoogleApiKey] = useState<string>(() => {
    return localStorage.getItem('lbw_google_api_key') || DEFAULT_GOOGLE_API_KEY;
  });
  const [gasUploadUrl, setGasUploadUrl] = useState<string>(() => {
    return localStorage.getItem('lbw_gas_upload_url') || '';
  });

  // --- 드라이브 탐색 상태 ---
  const [folderHistory, setFolderHistory] = useState<{ id: string; name: string }[]>([
    { id: rootFolderId, name: '전자칠판 루트' }
  ]);
  const [items, setItems] = useState<DriveItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // --- 모달 팝업 상태 ---
  const [activeModal, setActiveModal] = useState<'login' | 'admin_settings' | 'gas_guide' | null>(null);
  
  // 로그인 폼 상태
  const [loginTab, setLoginTab] = useState<'teacher' | 'admin'>('teacher');
  const [inputTeacherPw, setInputTeacherPw] = useState('');
  const [inputAdminId, setInputAdminId] = useState('');
  const [inputAdminPw, setInputAdminPw] = useState('');
  const [loginError, setLoginError] = useState('');

  // 관리자 설정 폼 상태
  const [tempTeacherPw, setTempTeacherPw] = useState(teacherPw);
  const [tempRootFolderId, setTempRootFolderId] = useState(rootFolderId);
  const [tempApiKey, setTempApiKey] = useState(googleApiKey);
  const [tempGasUrl, setTempGasUrl] = useState(gasUploadUrl);

  // --- 업로드 관리 상태 (웹앱 내장 업로더) ---
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [isDragging, setIsDragging] = useState<boolean>(false);
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
  // [드라이브 폴더 데이터 실시간 로드 (캐시 0% - 100% 실시간)]
  // ==========================================================================
  const fetchDriveItems = async (folderId: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    setItems([]); // 폴더 전환 시 이전 목록 잔상 제거

    try {
      // 1. Vercel 통합 API 호출 (no-store 캐시 무력화 & 타임스탬프)
      const queryParams = new URLSearchParams({
        action: 'list',
        folderId,
        _t: Date.now().toString(),
        ...(googleApiKey ? { apiKey: googleApiKey } : {})
      });

      const endpoint = `/api/drive?${queryParams.toString()}`;
      const res = await fetch(endpoint, { cache: 'no-store' });

      if (res.ok) {
        const data = await res.json();
        if (data.items && Array.isArray(data.items)) {
          setItems(data.items);
          setIsLoading(false);
          return;
        }
      }
      throw new Error('API 응답 형식이 올바르지 않습니다.');
    } catch (err: any) {
      console.warn('Vercel API fetch failed, trying direct Google API if key available:', err);

      // 2. 만약 API 키가 설정되어 있다면 클라이언트 직통 Google API v3 실시간 시도
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

      setErrorMessage('구글 드라이브 실시간 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDriveItems(currentFolder.id);
  }, [currentFolder.id, googleApiKey]);

  // ==========================================================================
  // [폴더 이동 및 네비게이션]
  // ==========================================================================
  const handleOpenFolder = (folderId: string, folderName: string) => {
    setFolderHistory(prev => [...prev, { id: folderId, name: folderName }]);
    setSearchTerm('');
    setSelectedFiles([]);
  };

  const handleGoBack = () => {
    if (folderHistory.length > 1) {
      setFolderHistory(prev => prev.slice(0, prev.length - 1));
      setSearchTerm('');
      setSelectedFiles([]);
    }
  };

  const handleBreadcrumbClick = (index: number) => {
    setFolderHistory(prev => prev.slice(0, index + 1));
    setSearchTerm('');
    setSelectedFiles([]);
  };

  // ==========================================================================
  // [전자칠판 100% 안전 스트리밍 다운로드 (구글 로그인 / 바이러스 경고 100% 원천 차단)]
  // ==========================================================================
  const handleSmartDownload = (item: DriveItem) => {
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
  // [웹앱 내장 드래그앤드롭 파일 업로드 처리]
  // ==========================================================================
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setSelectedFiles(Array.from(e.dataTransfer.files));
    }
  };

  // 파일을 Base64로 변환하는 유틸
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // data:...;base64, 부분 제거하고 순수 base64 데이터만 추출
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  };

  // 실제 구글 드라이브 업로드 실행
  const handleUploadSubmit = async () => {
    if (selectedFiles.length === 0) {
      showToast('⚠️ 업로드할 파일을 먼저 선택해 주세요.');
      return;
    }

    // 만약 GAS 웹앱 URL이 아직 등록되지 않았다면 가이드 팝업 안내
    if (!gasUploadUrl.trim()) {
      setActiveModal('gas_guide');
      return;
    }

    setIsUploading(true);
    setUploadProgress(`0 / ${selectedFiles.length} 업로드 중...`);

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        setUploadProgress(`(${i + 1}/${selectedFiles.length}) '${file.name}' 전송 중...`);

        const base64 = await fileToBase64(file);
        const payload = {
          folderId: currentFolder.id,
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          base64: base64
        };

        const res = await fetch(gasUploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });

        const result = await res.json();
        if (!result.success) {
          throw new Error(result.error || `'${file.name}' 업로드 실패`);
        }
      }

      showToast(`🎉 총 ${selectedFiles.length}개 파일이 '${currentFolder.name}' 폴더에 정상 업로드되었습니다!`);
      setSelectedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      fetchDriveItems(currentFolder.id); // 업로드 즉시 실시간 목록 새로고침
    } catch (err: any) {
      console.error('Upload failed:', err);
      showToast(`❌ 업로드 실패: ${err.message || '네트워크 오류'}`);
    } finally {
      setIsUploading(false);
      setUploadProgress('');
    }
  };

  // ==========================================================================
  // [인증 처리: 선생님 / 최고 관리자 로그인]
  // ==========================================================================
  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');

    if (loginTab === 'teacher') {
      if (inputTeacherPw.trim() === teacherPw.trim()) {
        setAuthMode('teacher');
        setActiveModal(null);
        setInputTeacherPw('');
        showToast('👨‍🏫 선생님 모드로 로그인되었습니다. (웹앱 내장 업로드 패널 활성화)');
      } else {
        setLoginError('비밀번호가 올바르지 않습니다. (기본값: tch1234)');
      }
    } else {
      if (inputAdminId.trim() === ADMIN_ID && inputAdminPw.trim() === ADMIN_PW) {
        setAuthMode('admin');
        setActiveModal(null);
        setInputAdminId('');
        setInputAdminPw('');
        showToast('🛡️ 최고 관리자로 로그인되었습니다.');
      } else {
        setLoginError('관리자 ID 또는 비밀번호가 올바르지 않습니다.');
      }
    }
  };

  const handleLogout = () => {
    setAuthMode('guest');
    setSelectedFiles([]);
    showToast('🔒 로그아웃되었습니다. 전자칠판 게스트 모드로 전환합니다.');
  };

  // ==========================================================================
  // [관리자 설정 저장 처리]
  // ==========================================================================
  const handleSaveAdminSettings = (e: React.FormEvent) => {
    e.preventDefault();

    if (!tempTeacherPw.trim()) {
      showToast('⚠️ 선생님 비밀번호는 비어 있을 수 없습니다.');
      return;
    }

    setTeacherPw(tempTeacherPw.trim());
    localStorage.setItem('lbw_teacher_pw', tempTeacherPw.trim());

    if (tempRootFolderId.trim() && tempRootFolderId.trim() !== rootFolderId) {
      setRootFolderId(tempRootFolderId.trim());
      localStorage.setItem('lbw_root_folder_id', tempRootFolderId.trim());
      setFolderHistory([{ id: tempRootFolderId.trim(), name: '전자칠판 루트' }]);
    }

    setGoogleApiKey(tempApiKey.trim());
    localStorage.setItem('lbw_google_api_key', tempApiKey.trim());

    setGasUploadUrl(tempGasUrl.trim());
    localStorage.setItem('lbw_gas_upload_url', tempGasUrl.trim());

    setActiveModal(null);
    showToast('✅ 관리자 설정이 안전하게 저장되었습니다!');
  };

  // ==========================================================================
  // [검색 및 정렬 필터링]
  // ==========================================================================
  const filteredAndSortedItems = useMemo(() => {
    const filtered = items.filter(item => 
      item.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return [...filtered].sort((a, b) => {
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;

      if (a.type === 'folder' && b.type === 'folder') {
        return a.name.localeCompare(b.name, 'ko');
      }

      return a.name.localeCompare(b.name, 'ko');
    });
  }, [items, searchTerm]);

  return (
    <div className="app-wrapper">
      {/* ====================================================================
          상단 네비게이션 바
          ==================================================================== */}
      <header className="top-navbar">
        <div className="brand-section">
          <div className="brand-icon">🏫</div>
          <div className="brand-title-group">
            <h1>스마트 전자칠판 드라이브</h1>
            <p>교실 전자칠판 맞춤형 초고속 파일 허브</p>
          </div>
        </div>

        <div className="nav-controls">
          {authMode === 'guest' && (
            <span className="auth-badge guest">
              <span>🖥️</span> 전자칠판 모드 (다운로드 전용)
            </span>
          )}
          {authMode === 'teacher' && (
            <span className="auth-badge teacher">
              <span>👨‍🏫</span> 선생님 모드 (업로드 가능)
            </span>
          )}
          {authMode === 'admin' && (
            <span className="auth-badge admin">
              <span>🛡️</span> 최고 관리자 모드
            </span>
          )}

          {authMode === 'guest' ? (
            <button 
              className="btn btn-outline" 
              onClick={() => {
                setActiveModal('login');
                setLoginError('');
              }}
            >
              🔐 선생님 / 관리자 로그인
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {authMode === 'admin' && (
                <button 
                  className="btn btn-purple" 
                  onClick={() => {
                    setTempTeacherPw(teacherPw);
                    setTempRootFolderId(rootFolderId);
                    setTempApiKey(googleApiKey);
                    setTempGasUrl(gasUploadUrl);
                    setActiveModal('admin_settings');
                  }}
                >
                  ⚙️ 관리자 설정
                </button>
              )}
              <button className="btn btn-danger-outline" onClick={handleLogout}>
                로그아웃
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ====================================================================
          선생님/관리자 모드: 웹앱 내장 드래그앤드롭 파일 업로더
          ==================================================================== */}
      {(authMode === 'teacher' || authMode === 'admin') && (
        <section className="upload-card">
          <div className="upload-card-header">
            <div className="upload-info">
              <h3>
                <span>📤</span> 웹앱 내장 파일 업로드 (대상: '{currentFolder.name}' 폴더)
              </h3>
              <p>화면에 파일을 끌어다 놓거나 아래 버튼을 눌러 교재, PDF, 시험지를 즉시 업로드하세요.</p>
            </div>
            <div>
              {!gasUploadUrl && (
                <button 
                  className="btn btn-amber"
                  style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
                  onClick={() => setActiveModal('gas_guide')}
                >
                  ⚙️ 1분 자동 업로드 연동 설정
                </button>
              )}
            </div>
          </div>

          {/* 드래그 앤 드롭 영역 */}
          <div 
            style={{
              border: `2px dashed ${isDragging ? 'var(--accent-blue)' : 'rgba(16, 185, 129, 0.4)'}`,
              background: isDragging ? 'rgba(59, 130, 246, 0.1)' : 'rgba(255, 255, 255, 0.02)',
              borderRadius: 'var(--radius-md)',
              padding: '1.5rem',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input 
              type="file" 
              multiple 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              onChange={handleFileSelect}
            />
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📂</div>
            <p style={{ fontWeight: 700, fontSize: '1rem', color: '#ffffff' }}>
              여기로 파일을 끌어다 놓거나, 클릭하여 파일을 선택하세요
            </p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              PDF, HWP, HWPX, PPT, PPTX, 이미지, 동영상 등 지원
            </p>
          </div>

          {/* 선택된 파일 목록 및 업로드 버튼 */}
          {selectedFiles.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: '#34d399', fontSize: '0.95rem' }}>
                  선택된 파일 ({selectedFiles.length}개):
                </span>
                <button 
                  className="btn btn-outline" 
                  style={{ minHeight: '32px', padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}
                  onClick={() => setSelectedFiles([])}
                  disabled={isUploading}
                >
                  목록 비우기
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '140px', overflowY: 'auto' }}>
                {selectedFiles.map((file, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', color: '#cbd5e1', background: 'rgba(255,255,255,0.04)', padding: '0.4rem 0.8rem', borderRadius: '6px' }}>
                    <span>📄 {file.name}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{(file.size / (1024 * 1024)).toFixed(2)} MB</span>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button 
                  className="btn btn-success" 
                  onClick={handleUploadSubmit}
                  disabled={isUploading}
                  style={{ minHeight: '44px', padding: '0.6rem 1.5rem', fontWeight: 800 }}
                >
                  {isUploading ? (
                    <>
                      <span className="spinner" style={{ width: '16px', height: '16px' }} />
                      <span>{uploadProgress}</span>
                    </>
                  ) : (
                    <span>🚀 '{currentFolder.name}' 폴더로 즉시 업로드</span>
                  )}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ====================================================================
          탐색 컨트롤 바 (브레드크럼 + 검색 + 새로고침)
          ==================================================================== */}
      <div className="action-bar">
        <nav className="breadcrumb-nav">
          {folderHistory.length > 1 && (
            <button 
              className="btn btn-primary" 
              onClick={handleGoBack}
              style={{ minHeight: '38px', padding: '0.45rem 0.9rem', fontSize: '0.88rem' }}
            >
              ← 상위 폴더
            </button>
          )}
          {folderHistory.map((folder, index) => {
            const isLast = index === folderHistory.length - 1;
            return (
              <React.Fragment key={folder.id}>
                <button
                  className={`breadcrumb-item ${isLast ? 'active' : ''}`}
                  onClick={() => handleBreadcrumbClick(index)}
                  disabled={isLast}
                >
                  <span>{index === 0 ? '🏠' : '📁'}</span>
                  <span>{folder.name}</span>
                </button>
                {!isLast && <span style={{ color: 'var(--text-muted)' }}>/</span>}
              </React.Fragment>
            );
          })}
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%', maxWidth: '420px', justifyContent: 'flex-end' }}>
          <div className="search-container">
            <span style={{ color: 'var(--text-muted)' }}>🔍</span>
            <input 
              type="text" 
              placeholder="파일 / 폴더명 실시간 검색..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem' }}
              >
                ✕
              </button>
            )}
          </div>

          <button 
            className="btn btn-primary" 
            onClick={() => {
              showToast('🔄 실시간 목록을 다시 읽어옵니다...');
              fetchDriveItems(currentFolder.id);
            }}
            disabled={isLoading}
            style={{ padding: '0.7rem 1rem' }}
          >
            <span className={isLoading ? 'spinner' : ''}>{isLoading ? '' : '🔄'}</span>
            <span>{isLoading ? '로딩' : '새로고침'}</span>
          </button>
        </div>
      </div>

      {/* ====================================================================
          파일 목록 테이블 (전자칠판 최적화)
          ==================================================================== */}
      <main className="table-card">
        <div className="table-responsive">
          <table className="drive-table">
            <thead>
              <tr>
                <th style={{ width: '130px' }}>구분</th>
                <th>파일 / 폴더 이름</th>
                <th style={{ width: '130px' }}>용량</th>
                <th style={{ width: '140px' }}>수정일</th>
                <th style={{ width: '280px', textAlign: 'right' }}>조작 (진입 / 다운로드)</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '4rem 1rem', color: 'var(--accent-blue)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                      <div className="spinner" style={{ width: '36px', height: '36px', borderWidth: '3.5px', borderTopColor: 'var(--accent-blue)' }} />
                      <p style={{ fontSize: '1.1rem', fontWeight: 700 }}>구글 드라이브 실시간 목록을 조회 중입니다...</p>
                    </div>
                  </td>
                </tr>
              ) : errorMessage ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '4rem 1rem', color: '#fb7185' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                      <span style={{ fontSize: '2.5rem' }}>⚠️</span>
                      <p style={{ fontSize: '1.1rem', fontWeight: 700 }}>{errorMessage}</p>
                      <button className="btn btn-outline" onClick={() => fetchDriveItems(currentFolder.id)}>
                        🔄 다시 시도
                      </button>
                    </div>
                  </td>
                </tr>
              ) : filteredAndSortedItems.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '4rem 1rem', color: 'var(--text-muted)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.8rem' }}>
                      <span style={{ fontSize: '2.5rem' }}>📂</span>
                      <p style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9' }}>
                        '{currentFolder.name}' 폴더에 저장된 파일이나 하위 폴더가 없습니다.
                      </p>
                      {(authMode === 'teacher' || authMode === 'admin') && (
                        <p style={{ fontSize: '0.9rem', color: '#34d399' }}>
                          💡 상단의 파일 업로드 영역에 파일을 끌어다 놓아 첫 번째 교재를 업로드해 보세요!
                        </p>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredAndSortedItems.map((item) => {
                  const isFolder = item.type === 'folder';
                  return (
                    <tr key={item.id}>
                      <td>
                        <span className={`item-badge ${isFolder ? 'folder' : 'document'}`}>
                          <span>{isFolder ? '📁' : '📄'}</span>
                          <span>{isFolder ? '폴더' : '파일'}</span>
                        </span>
                      </td>

                      <td>
                        {isFolder ? (
                          <button 
                            className="item-name-btn folder-name"
                            onClick={() => handleOpenFolder(item.folderId || item.id, item.name)}
                          >
                            <span style={{ fontSize: '1.25rem' }}>📁</span>
                            <span style={{ color: '#fbbf24' }}>{item.name}</span>
                          </button>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <span style={{ fontSize: '1.25rem' }}>📄</span>
                            <span style={{ fontWeight: 700, color: '#f8fafc' }}>{item.name}</span>
                          </div>
                        )}
                      </td>

                      <td className="item-meta" style={{ fontWeight: 600, color: '#cbd5e1' }}>
                        {item.size || '-'}
                      </td>

                      <td className="item-meta">
                        {item.updatedAt || '-'}
                      </td>

                      <td>
                        <div className="action-btn-group">
                          {isFolder ? (
                            <button 
                              className="table-btn table-btn-enter"
                              onClick={() => handleOpenFolder(item.folderId || item.id, item.name)}
                            >
                              📂 폴더 진입
                            </button>
                          ) : (
                            <button 
                              className="table-btn table-btn-download"
                              onClick={() => handleSmartDownload(item)}
                            >
                              ⚡ 다운로드
                            </button>
                          )}

                          <a 
                            href={item.viewUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="table-btn table-btn-view"
                          >
                            👁️ 보기
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </main>

      {/* ====================================================================
          모달 1: 선생님 / 최고 관리자 로그인 모달
          ==================================================================== */}
      {activeModal === 'login' && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2><span>🔐</span> 로그인 인증</h2>
              <button className="modal-close-btn" onClick={() => setActiveModal(null)}>✕</button>
            </div>

            <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', padding: '4px' }}>
              <button 
                type="button"
                className="btn"
                style={{ 
                  flex: 1, 
                  background: loginTab === 'teacher' ? 'var(--accent-blue-gradient)' : 'transparent',
                  color: loginTab === 'teacher' ? '#fff' : 'var(--text-secondary)',
                  minHeight: '40px',
                  boxShadow: 'none'
                }}
                onClick={() => {
                  setLoginTab('teacher');
                  setLoginError('');
                }}
              >
                👨‍🏫 선생님 로그인
              </button>
              <button 
                type="button"
                className="btn"
                style={{ 
                  flex: 1, 
                  background: loginTab === 'admin' ? 'var(--accent-purple-gradient)' : 'transparent',
                  color: loginTab === 'admin' ? '#fff' : 'var(--text-secondary)',
                  minHeight: '40px',
                  boxShadow: 'none'
                }}
                onClick={() => {
                  setLoginTab('admin');
                  setLoginError('');
                }}
              >
                🛡️ 최고 관리자
              </button>
            </div>

            <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {loginTab === 'teacher' ? (
                <div className="form-group">
                  <label>선생님 간편 비밀번호</label>
                  <input 
                    type="password" 
                    className="form-input" 
                    placeholder="선생님 비밀번호를 입력하세요" 
                    value={inputTeacherPw}
                    onChange={(e) => setInputTeacherPw(e.target.value)}
                    autoFocus
                  />
                  <span className="form-helper">기본 비밀번호: <strong>tch1234</strong></span>
                </div>
              ) : (
                <>
                  <div className="form-group">
                    <label>관리자 아이디</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder="admin" 
                      value={inputAdminId}
                      onChange={(e) => setInputAdminId(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="form-group">
                    <label>관리자 비밀번호</label>
                    <input 
                      type="password" 
                      className="form-input" 
                      placeholder="admin!@#$1234" 
                      value={inputAdminPw}
                      onChange={(e) => setInputAdminPw(e.target.value)}
                    />
                  </div>
                </>
              )}

              {loginError && (
                <p style={{ color: '#fb7185', fontSize: '0.9rem', fontWeight: 700 }}>⚠️ {loginError}</p>
              )}

              <button type="submit" className={`btn ${loginTab === 'teacher' ? 'btn-primary' : 'btn-purple'}`} style={{ width: '100%', marginTop: '0.5rem' }}>
                로그인 완료
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          모달 2: 최고 관리자 설정 모달
          ==================================================================== */}
      {activeModal === 'admin_settings' && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-box" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2><span>⚙️</span> 시스템 관리자 설정</h2>
              <button className="modal-close-btn" onClick={() => setActiveModal(null)}>✕</button>
            </div>

            <form onSubmit={handleSaveAdminSettings} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="form-group">
                <label>👨‍🏫 선생님 간편 비밀번호 변경</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={tempTeacherPw}
                  onChange={(e) => setTempTeacherPw(e.target.value)}
                  placeholder="예: tch1234"
                  required
                />
              </div>

              <div className="form-group">
                <label>📂 구글 드라이브 루트 폴더 ID</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={tempRootFolderId}
                  onChange={(e) => setTempRootFolderId(e.target.value)}
                  placeholder="1Ew38nohOksBhypc2UjHYTmi6bSjbICmn"
                  required
                />
              </div>

              <div className="form-group">
                <label>🔑 Google Cloud API 키 (Drive v3)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                />
              </div>

              <div className="form-group">
                <label>🚀 Google Apps Script 웹앱 업로드 URL (100% 자동 업로더)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={tempGasUrl}
                  onChange={(e) => setTempGasUrl(e.target.value)}
                  placeholder="https://script.google.com/macros/s/.../exec"
                />
                <span className="form-helper">
                  구글 계정의 Apps Script 웹앱 URL을 입력하면 웹 화면에서 구글 드라이브로 파일이 1초 만에 자동 업로드됩니다.{' '}
                  <button 
                    type="button" 
                    style={{ background: 'none', border: 'none', color: '#60a5fa', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
                    onClick={() => setActiveModal('gas_guide')}
                  >
                    [1분 생성 가이드 보기]
                  </button>
                </span>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setActiveModal(null)}>
                  취소
                </button>
                <button type="submit" className="btn btn-purple" style={{ flex: 1 }}>
                  설정 저장 완료
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          모달 3: 1분 Google Apps Script 자동 업로더 생성 가이드
          ==================================================================== */}
      {activeModal === 'gas_guide' && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-box" style={{ maxWidth: '620px', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2><span>🚀</span> 1분 만에 끝내는 구글 드라이브 자동 업로더</h2>
              <button className="modal-close-btn" onClick={() => setActiveModal(null)}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.92rem', color: '#cbd5e1', lineHeight: 1.6 }}>
              <p>
                구글 공식 정책상 일반 API 키로는 쓰기(업로드)가 차단되어 있습니다.<br/>
                선생님 구글 계정에서 아래 <strong>간단한 15줄 스크립트</strong>를 한 번만 배포해 두면, <strong>웹앱 화면 안에서 드래그 앤 드롭으로 파일이 즉시 100% 자동 업로드</strong>됩니다!
              </p>

              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
                <strong>📌 생성 순서 (1분 컷):</strong>
                <ol style={{ paddingLeft: '1.25rem', marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <li><a href="https://script.google.com/home/start" target="_blank" rel="noreferrer" style={{ color: '#60a5fa', fontWeight: 700 }}>script.google.com</a>에 접속하여 <strong>[+ 새 프로젝트]</strong> 클릭</li>
                  <li>기존 내용을 지우고 아래의 코드를 그대로 복사하여 붙여넣기</li>
                  <li>우측 상단 <strong>[배포] ➡️ [새 배포]</strong> 클릭</li>
                  <li>유형: <strong>웹 앱(Web App)</strong> 선택</li>
                  <li>액세스 권한: <strong>'모든 사용자(Anyone)'</strong>로 설정 후 [배포] 클릭</li>
                  <li>발급된 <strong>웹 앱 URL (https://script.google.com/macros/s/.../exec)</strong>을 복사하여 아래에 붙여넣기!</li>
                </ol>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <span style={{ fontWeight: 700, color: '#f8fafc' }}>📋 복사할 스크립트 코드:</span>
                  <button 
                    className="btn btn-outline" 
                    style={{ minHeight: '30px', padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}
                    onClick={() => {
                      navigator.clipboard.writeText(GAS_CODE_TEMPLATE);
                      showToast('✅ 스크립트 코드가 클립보드에 복사되었습니다!');
                    }}
                  >
                    코드 복사하기
                  </button>
                </div>
                <pre style={{ background: '#020617', padding: '0.75rem', borderRadius: '8px', fontSize: '0.8rem', overflowX: 'auto', color: '#38bdf8' }}>
                  {GAS_CODE_TEMPLATE}
                </pre>
              </div>

              <div className="form-group" style={{ marginTop: '0.5rem' }}>
                <label style={{ color: '#34d399', fontWeight: 800 }}>🔗 발급받은 웹 앱 URL 등록:</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input 
                    type="text" 
                    className="form-input" 
                    style={{ flex: 1 }}
                    placeholder="https://script.google.com/macros/s/.../exec"
                    value={tempGasUrl}
                    onChange={(e) => setTempGasUrl(e.target.value)}
                  />
                  <button 
                    type="button" 
                    className="btn btn-success"
                    onClick={() => {
                      if (!tempGasUrl.trim()) {
                        showToast('URL을 입력해 주세요.');
                        return;
                      }
                      setGasUploadUrl(tempGasUrl.trim());
                      localStorage.setItem('lbw_gas_upload_url', tempGasUrl.trim());
                      setActiveModal(null);
                      showToast('🎉 자동 업로더 연동이 완료되었습니다! 이제 파일을 드롭하여 올려보세요.');
                    }}
                  >
                    등록 완료
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          하단 토스트 메시지
          ==================================================================== */}
      {toastMessage && (
        <aside className="toast-container">
          <span>🔔</span>
          <span>{toastMessage}</span>
        </aside>
      )}
    </div>
  );
}

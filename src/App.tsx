import React, { useState, useEffect, useMemo } from 'react';
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
const ADMIN_ID = 'admin';
const ADMIN_PW = 'admin!@#$1234';

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
    return localStorage.getItem('lbw_google_api_key') || '';
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
  const [activeModal, setActiveModal] = useState<'login' | 'admin_settings' | 'upload_helper' | null>(null);
  
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

  const currentFolder = folderHistory[folderHistory.length - 1];

  // ==========================================================================
  // [알림 토스트 유틸]
  // ==========================================================================
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(prev => (prev === msg ? null : prev));
    }, 3200);
  };

  // ==========================================================================
  // [드라이브 폴더 데이터 실시간 로드]
  // ==========================================================================
  const fetchDriveItems = async (folderId: string) => {
    setIsLoading(true);
    setErrorMessage(null);

    // 1. 세션 캐시 확인 (다중 교실 재방문 시 즉시 응답)
    const cacheKey = `lbw_cache_${folderId}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setItems(parsed);
          setIsLoading(false);
        }
      } catch (e) {
        sessionStorage.removeItem(cacheKey);
      }
    }

    try {
      // 2. Vercel 통합 API 호출 (공식 Drive API v3 및 스마트 프록시)
      const queryParams = new URLSearchParams({
        action: 'list',
        folderId,
        ...(googleApiKey ? { apiKey: googleApiKey } : {})
      });

      const endpoint = `/api/drive?${queryParams.toString()}`;
      const res = await fetch(endpoint);

      if (res.ok) {
        const data = await res.json();
        if (data.items && Array.isArray(data.items)) {
          setItems(data.items);
          sessionStorage.setItem(cacheKey, JSON.stringify(data.items));
          setIsLoading(false);
          return;
        }
      }
      throw new Error('API 응답 형식이 올바르지 않습니다.');
    } catch (err: any) {
      console.warn('Vercel API fetch failed, trying direct Google API if key available:', err);

      // 3. 만약 API 키가 설정되어 있다면 클라이언트 직통 Google API v3 시도
      if (googleApiKey) {
        try {
          const directUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=folder,name&key=${googleApiKey}`;
          const gRes = await fetch(directUrl);
          if (gRes.ok) {
            const gData = await gRes.json();
            const directItems: DriveItem[] = (gData.files || []).map((file: any) => {
              const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
              return {
                id: file.id,
                name: file.name,
                type: isFolder ? 'folder' : 'document',
                folderId: isFolder ? file.id : undefined,
                updatedAt: file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString('ko-KR') : '-',
                viewUrl: isFolder 
                  ? `https://drive.google.com/drive/folders/${file.id}?usp=sharing` 
                  : `https://drive.google.com/file/d/${file.id}/view?usp=sharing`,
                downloadUrl: `https://drive.google.com/uc?export=download&confirm=t&id=${file.id}`
              };
            });
            setItems(directItems);
            sessionStorage.setItem(cacheKey, JSON.stringify(directItems));
            setIsLoading(false);
            return;
          }
        } catch (clientErr) {
          console.error('Direct Google API failed:', clientErr);
        }
      }

      if (!cached) {
        setErrorMessage('구글 드라이브 실시간 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
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
  };

  const handleGoBack = () => {
    if (folderHistory.length > 1) {
      setFolderHistory(prev => prev.slice(0, prev.length - 1));
      setSearchTerm('');
    }
  };

  const handleBreadcrumbClick = (index: number) => {
    setFolderHistory(prev => prev.slice(0, index + 1));
    setSearchTerm('');
  };

  // ==========================================================================
  // [전자칠판 100% 안전 스트리밍 다운로드 (구글 로그인 / 바이러스 경고 100% 원천 차단)]
  // ==========================================================================
  const handleSmartDownload = (item: DriveItem) => {
    showToast(`⚡ '${item.name}' 다운로드를 시작합니다...`);

    // 우리 서버의 완전 바이트 스트리밍 엔드포인트 (구글 도메인으로 직접 이동하지 않음!)
    const proxyUrl = `/api/drive?action=download&fileId=${item.id}&fileName=${encodeURIComponent(item.name)}`;

    // 숨겨진 앵커 태그로 전자칠판 화면 먹통/이탈 없이 즉시 백그라운드 다운로드 트리거
    const link = document.createElement('a');
    link.href = proxyUrl;
    link.setAttribute('download', item.name);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
        showToast('👨‍🏫 선생님 모드로 로그인되었습니다. (업로드 패널 활성화)');
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

    // 1. 비밀번호 업데이트
    setTeacherPw(tempTeacherPw.trim());
    localStorage.setItem('lbw_teacher_pw', tempTeacherPw.trim());

    // 2. 루트 폴더 ID 업데이트
    if (tempRootFolderId.trim() && tempRootFolderId.trim() !== rootFolderId) {
      setRootFolderId(tempRootFolderId.trim());
      localStorage.setItem('lbw_root_folder_id', tempRootFolderId.trim());
      setFolderHistory([{ id: tempRootFolderId.trim(), name: '전자칠판 루트' }]);
    }

    // 3. 구글 API 키 업데이트
    setGoogleApiKey(tempApiKey.trim());
    localStorage.setItem('lbw_google_api_key', tempApiKey.trim());

    setActiveModal(null);
    showToast('✅ 관리자 설정이 안전하게 저장되었습니다!');
  };

  // ==========================================================================
  // [선생님 고용량 업로드 다이렉트 브리지]
  // ==========================================================================
  const handleOpenGoogleUpload = () => {
    const uploadUrl = `https://drive.google.com/drive/folders/${currentFolder.id}?usp=sharing`;
    window.open(uploadUrl, '_blank', 'noopener,noreferrer');
    showToast(`📂 현재 폴더('${currentFolder.name}') 업로드 창이 열렸습니다. 파일을 올리신 후 새로고침을 누르세요.`);
  };

  // ==========================================================================
  // [검색 및 정렬 필터링]
  // ==========================================================================
  const filteredAndSortedItems = useMemo(() => {
    const filtered = items.filter(item => 
      item.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // 정렬 규칙: 폴더 우선(가나다순) -> 파일(최신 날짜순)
    return [...filtered].sort((a, b) => {
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;

      if (a.type === 'folder' && b.type === 'folder') {
        return a.name.localeCompare(b.name, 'ko');
      }

      // 파일명 또는 날짜 기준 정렬
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
          {/* 권한 뱃지 */}
          {authMode === 'guest' && (
            <span className="auth-badge guest">
              <span>🖥️</span> 전자칠판 모드 (다운로드 전용)
            </span>
          )}
          {authMode === 'teacher' && (
            <span className="auth-badge teacher">
              <span>👨‍🏫</span> 선생님 모드 (업로드 활성화됨)
            </span>
          )}
          {authMode === 'admin' && (
            <span className="auth-badge admin">
              <span>🛡️</span> 최고 관리자 모드
            </span>
          )}

          {/* 버튼 컨트롤 */}
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
          선생님 모드 전용 업로드 대시보드
          ==================================================================== */}
      {(authMode === 'teacher' || authMode === 'admin') && (
        <section className="upload-card">
          <div className="upload-card-header">
            <div className="upload-info">
              <h3>
                <span>📤</span> 현재 폴더: '{currentFolder.name}' 파일 업로드 존
              </h3>
              <p>선생님 PC에서 대용량 PDF, 교재, 영상 파일을 제한 없이 드라이브에 직접 업로드하세요.</p>
            </div>
            <div className="upload-actions">
              <button className="btn btn-success" onClick={handleOpenGoogleUpload}>
                <span>⚡</span> 원클릭 대용량 업로드 창 열기
              </button>
              <button 
                className="btn btn-outline" 
                onClick={() => fetchDriveItems(currentFolder.id)}
              >
                <span>🔄</span> 업로드 후 목록 갱신
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ====================================================================
          탐색 컨트롤 바 (브레드크럼 + 검색 + 새로고침)
          ==================================================================== */}
      <div className="action-bar">
        {/* 브레드크럼 폴더 네비게이션 */}
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

        {/* 검색 및 새로고침 */}
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
                <th style={{ width: '140px' }}>수정일</th>
                <th style={{ width: '300px', textAlign: 'right' }}>조작 (진입 / 다운로드 / 보기)</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '4rem 1rem', color: 'var(--accent-blue)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                      <div className="spinner" style={{ width: '36px', height: '36px', borderWidth: '3.5px', borderTopColor: 'var(--accent-blue)' }} />
                      <p style={{ fontSize: '1.1rem', fontWeight: 700 }}>구글 드라이브 실시간 목록을 조회 중입니다...</p>
                    </div>
                  </td>
                </tr>
              ) : errorMessage ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '4rem 1rem', color: '#fb7185' }}>
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
                  <td colSpan={4} style={{ textAlign: 'center', padding: '4rem 1rem', color: 'var(--text-muted)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.8rem' }}>
                      <span style={{ fontSize: '2.5rem' }}>📂</span>
                      <p style={{ fontSize: '1.05rem', fontWeight: 600 }}>
                        {searchTerm ? `'${searchTerm}' 검색 결과가 없습니다.` : '이 폴더에 저장된 파일이나 하위 폴더가 없습니다.'}
                      </p>
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
                            onClick={() => handleOpenFolder(item.folderId!, item.name)}
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

                      <td className="item-meta">
                        {item.updatedAt || '-'}
                      </td>

                      <td>
                        <div className="action-btn-group">
                          {isFolder ? (
                            <button 
                              className="table-btn table-btn-enter"
                              onClick={() => handleOpenFolder(item.folderId!, item.name)}
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
                            👁️ 열기
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

            {/* 탭 전환 */}
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
          모달 2: 최고 관리자 설정 모달 (비밀번호 변경 및 시스템 키 관리)
          ==================================================================== */}
      {activeModal === 'admin_settings' && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-box" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2><span>⚙️</span> 최고 관리자 시스템 설정</h2>
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
                <span className="form-helper">선생님들이 로그인할 때 사용할 비밀번호입니다. (기본: tch1234)</span>
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
                <span className="form-helper">전자칠판의 기본 시작 공유 폴더 ID입니다.</span>
              </div>

              <div className="form-group">
                <label>🔑 Google Cloud API 키 (선택사항)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                />
                <span className="form-helper">구글 드라이브 v3 공식 API 키를 등록하면 더욱 빠르고 안정적인 통신이 가능합니다.</span>
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

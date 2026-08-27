import { useState, useRef } from 'react';
import './App.css';

const GOOGLE_DRIVE_FOLDER_URL = 'https://drive.google.com/drive/folders/1Ew38nohOksBhypc2UjHYTmi6bSjbICmn?usp=drive_link';
const DRIVE_FOLDER_ID = '1Ew38nohOksBhypc2UjHYTmi6bSjbICmn';

// 구글 공유드라이브 실제 파일 구조
interface DriveFile {
  id: string;
  name: string;
  category: 'document' | 'presentation' | 'image' | 'sheet' | 'archive' | 'folder';
  size: string;
  updatedAt: string;
  fileId?: string;
  viewUrl: string;
  downloadUrl: string;
}

// 실제 공유드라이브에 저장된 실제 데이터
const REAL_DRIVE_FILES: DriveFile[] = [
  {
    id: 'f-folder',
    name: 'LBW 공유드라이브 전체 폴더',
    category: 'folder',
    size: '공유 폴더',
    updatedAt: '2026-08-27',
    viewUrl: GOOGLE_DRIVE_FOLDER_URL,
    downloadUrl: GOOGLE_DRIVE_FOLDER_URL,
  },
  {
    id: '1CkMTYMEQWwM5KWYHPS4qlQAPPgazTFBK',
    fileId: '1CkMTYMEQWwM5KWYHPS4qlQAPPgazTFBK',
    name: '2026 자이스토리 고2 미적분 1 - L.pdf',
    category: 'document',
    size: 'PDF 교재',
    updatedAt: '8월 9일',
    viewUrl: 'https://drive.google.com/file/d/1CkMTYMEQWwM5KWYHPS4qlQAPPgazTFBK/view?usp=sharing',
    downloadUrl: 'https://drive.google.com/uc?export=download&confirm=no_antivirus&id=1CkMTYMEQWwM5KWYHPS4qlQAPPgazTFBK',
  },
  {
    id: '1BhPT-Z3OKUFd13m2mCfES7HWVFuscFZQ',
    fileId: '1BhPT-Z3OKUFd13m2mCfES7HWVFuscFZQ',
    name: '미래엔_미적분1_교과서.pdf',
    category: 'document',
    size: 'PDF 교과서',
    updatedAt: '3월 2일',
    viewUrl: 'https://drive.google.com/file/d/1BhPT-Z3OKUFd13m2mCfES7HWVFuscFZQ/view?usp=sharing',
    downloadUrl: 'https://drive.google.com/uc?export=download&confirm=no_antivirus&id=1BhPT-Z3OKUFd13m2mCfES7HWVFuscFZQ',
  }
];

const App = () => {
  const [files] = useState<DriveFile[]>(REAL_DRIVE_FILES);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [viewMode, setViewMode] = useState<'embedded' | 'grid' | 'list'>('embedded');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showSaveModal, setShowSaveModal] = useState<boolean>(false);
  const [activeSaveFile, setActiveSaveFile] = useState<DriveFile | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleCopyFolderLink = () => {
    navigator.clipboard.writeText(GOOGLE_DRIVE_FOLDER_URL);
    showToast('✨ 구글 드라이브 링크가 복사되었습니다!');
  };

  // 전자칠판 내장 브라우저 '연결 프로그램 선택' 팝업 없이 100% 직다운로드 트리거
  const handleSilentDownload = (file: DriveFile) => {
    showToast(`⚡ '${file.name}' 내장 브라우저 다운로드 시작!`);
    
    // 숨겨진 iframe으로 다운로드 스트림 전달 (안드로이드 앱 선택 팝업 우회)
    if (iframeRef.current) {
      iframeRef.current.src = file.downloadUrl;
    } else {
      const a = document.createElement('a');
      a.href = file.downloadUrl;
      a.target = '_self';
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  // 특정 폴더 지정 저장 / 강제 다운로드 핸들러
  const handleSaveFile = async (file: DriveFile) => {
    setActiveSaveFile(file);

    // 1. 최신 File System Access API 지원 시: 폴더 선택 팝업 열기
    if ('showSaveFilePicker' in window) {
      try {
        setIsSaving(true);
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: file.name,
          types: [{
            description: 'PDF 문서 및 파일',
            accept: { 'application/pdf': ['.pdf'], 'application/octet-stream': ['.*'] }
          }]
        });

        showToast('⏳ 다운로드 중입니다. 잠시만 기다려주세요...');
        const response = await fetch(file.downloadUrl);
        const blob = await response.blob();
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setIsSaving(false);
        showToast('🎉 지정한 폴더에 파일이 성공적으로 저장되었습니다!');
        return;
      } catch (err: any) {
        setIsSaving(false);
        if (err.name === 'AbortError') return; // 사용자가 팝업 취소
        console.warn('showSaveFilePicker fallback:', err);
      }
    }

    // 2. 내장 브라우저 직다운로드 실행
    handleSilentDownload(file);
  };

  const filteredFiles = files.filter(file => {
    return file.name.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const getCategoryIcon = (category: DriveFile['category']) => {
    switch (category) {
      case 'folder': return { badge: '📁 폴더', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' };
      case 'document': return { badge: '📄 PDF 문서', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' };
      case 'presentation': return { badge: '📊 PPT 발표', color: '#f97316', bg: 'rgba(249, 115, 22, 0.15)' };
      case 'sheet': return { badge: '📈 스프레드시트', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' };
      case 'image': return { badge: '🖼️ 미디어', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)' };
      case 'archive': return { badge: '📦 압축파일', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' };
      default: return { badge: '📁 기타', color: '#64748b', bg: 'rgba(100, 116, 139, 0.15)' };
    }
  };

  return (
    <div className="explorer-container">
      {/* 안드로이드 프로그램 선택 창 우회용 숨겨진 다운로드 iframe */}
      <iframe ref={iframeRef} title="silent_download_frame" style={{ display: 'none', width: 0, height: 0 }} />

      {/* 스마트 칠판 상단 네비게이션 헤더 */}
      <header className="explorer-header">
        <div className="header-brand">
          <div className="brand-icon">
            <svg width="32" height="32" viewBox="0 0 87.3 78" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6.6 66.85L22.25 39.75H80.7L65.05 66.85H6.6Z" fill="#0066DA"/>
              <path d="M43.65 11.15L59.3 38.25L29.9 89.25L14.25 62.15L43.65 11.15Z" fill="#00AC47"/>
              <path d="M73.5 11.15L89.15 38.25H57.85L42.2 11.15H73.5Z" fill="#EA4335"/>
              <path d="M43.65 11.15L28 38.25H59.3L43.65 11.15Z" fill="#FFBA00"/>
            </svg>
          </div>
          <div>
            <h1 className="header-title">LBW 구글 공유드라이브 실제 파일 센터</h1>
            <p className="header-sub">전자칠판 내장 브라우저 1초 원스톱 직접 다운로드 (폴더 ID: {DRIVE_FOLDER_ID})</p>
          </div>
        </div>

        <div className="header-actions">
          <a 
            href={GOOGLE_DRIVE_FOLDER_URL} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="btn-drive-main"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            구글 드라이브 새창 열기
          </a>

          <button onClick={handleCopyFolderLink} className="btn-secondary-touch">
            📋 링크 복사
          </button>
        </div>
      </header>

      {/* 툴바 */}
      <div className="explorer-toolbar">
        {/* 뷰 모드 토글 */}
        <div className="view-mode-toggle">
          <button 
            className={`view-btn ${viewMode === 'embedded' ? 'active' : ''}`}
            onClick={() => setViewMode('embedded')}
            title="구글 실시간 내장 뷰어"
          >
            🖥️ 구글 실시간 드라이브 뷰어
          </button>
          <button 
            className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => setViewMode('grid')}
            title="개별 파일 카드"
          >
            ▦ 개별 파일 카드
          </button>
          <button 
            className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
            title="파일 목록형"
          >
            ≡ 파일 목록형
          </button>
        </div>

        {/* 검색 창 */}
        <div className="search-box">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input 
            type="text" 
            placeholder="실제 파일명 검색..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button className="clear-search-btn" onClick={() => setSearchTerm('')}>✕</button>
          )}
        </div>
      </div>

      {/* 메인 영역 */}
      <main className="explorer-content">
        {viewMode === 'embedded' ? (
          /* 구글 실시간 드라이브 임베드 뷰어 */
          <div className="embedded-viewer-container">
            <iframe 
              src={`https://drive.google.com/embeddedfolderview?id=${DRIVE_FOLDER_ID}#list`}
              title="Google Drive Live Shared Folder"
              className="google-drive-iframe"
            />
          </div>
        ) : viewMode === 'grid' ? (
          /* 개별 파일 카드 뷰 */
          <div className="file-grid">
            {filteredFiles.map(file => {
              const meta = getCategoryIcon(file.category);
              return (
                <div key={file.id} className="file-card">
                  <div className="card-top-bar">
                    <span className="file-type-badge" style={{ backgroundColor: meta.bg, color: meta.color }}>
                      {meta.badge}
                    </span>
                    <span className="file-size">{file.size}</span>
                  </div>

                  <h3 className="file-name" title={file.name}>
                    {file.name}
                  </h3>

                  <div className="file-meta-date">
                    최종 수정: {file.updatedAt}
                  </div>

                  <div className="card-btn-group" style={{ flexDirection: 'column', gap: '0.5rem' }}>
                    <button 
                      onClick={() => handleSilentDownload(file)}
                      className="touch-btn touch-btn-download"
                      style={{ background: '#2563eb', color: '#fff', border: 'none' }}
                    >
                      ⚡ 내장브라우저 즉시 다운로드 (묻지 않음)
                    </button>

                    <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                      <a 
                        href={file.viewUrl} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="touch-btn touch-btn-open"
                      >
                        👁️ 열기
                      </a>

                      <button 
                        onClick={() => handleSaveFile(file)}
                        disabled={isSaving}
                        className="touch-btn touch-btn-open"
                        style={{ background: 'rgba(255,255,255,0.06)', color: '#fff' }}
                      >
                        💾 폴더 지정
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* 파일 목록 뷰 */
          <div className="file-list-wrapper">
            <table className="file-list-table">
              <thead>
                <tr>
                  <th>구분</th>
                  <th>실제 파일명</th>
                  <th>종류</th>
                  <th>수정일</th>
                  <th style={{ textAlign: 'center' }}>다운로드 / 열기</th>
                </tr>
              </thead>
              <tbody>
                {filteredFiles.map(file => {
                  const meta = getCategoryIcon(file.category);
                  return (
                    <tr key={file.id}>
                      <td>
                        <span className="file-type-badge" style={{ backgroundColor: meta.bg, color: meta.color }}>
                          {meta.badge}
                        </span>
                      </td>
                      <td className="table-filename">{file.name}</td>
                      <td>{file.size}</td>
                      <td>{file.updatedAt}</td>
                      <td>
                        <div className="table-btn-group">
                          <button 
                            onClick={() => handleSilentDownload(file)}
                            className="table-btn btn-download"
                            style={{ background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer' }}
                          >
                            ⚡ 내장브라우저 즉시 다운로드
                          </button>

                          <a 
                            href={file.viewUrl} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="table-btn btn-open"
                          >
                            👁️ 열기
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* 전자칠판 다운로드/저장 보완 안내 모달 */}
      {showSaveModal && activeSaveFile && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <button className="modal-close-btn" onClick={() => setShowSaveModal(false)}>✕</button>
            
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff', marginBottom: '0.75rem', display: 'flex', strokeLinecap: 'round', gap: '0.5rem' }}>
              ⚡ 내장 브라우저 직접 다운로드 안내
            </h3>

            <div style={{ background: 'rgba(255,255,255,0.04)', padding: '1.25rem', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', marginBottom: '1.25rem', fontSize: '0.9rem', color: '#cbd5e1', lineHeight: '1.6', textAlign: 'left' }}>
              <p style={{ marginBottom: '0.75rem', fontWeight: 700, color: '#60a5fa' }}>
                📌 '다른 앱으로 열기' 팝업 없이 바로 내장 브라우저에 파일 다운로드하는 방법:
              </p>
              
              <ul style={{ paddingLeft: '1.25rem', margin: 0 }}>
                <li style={{ marginBottom: '0.5rem' }}>
                  <strong>[⚡ 내장브라우저 즉시 다운로드]</strong> 버튼을 누르시면 연결 프로그램 선택 팝업 없이 내장 브라우저의 기본 다운로드 폴더로 바로 다운로드됩니다.
                </li>
                <li>
                  기존에 동일한 파일이 존재하는 경우, 브라우저가 자동으로 덮어쓰거나 최신 버전으로 즉시 다운로드를 완료합니다.
                </li>
              </ul>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button 
                onClick={() => {
                  setShowSaveModal(false);
                  handleSilentDownload(activeSaveFile);
                }}
                className="main-cta-btn"
                style={{ flex: 1, padding: '0.875rem', fontSize: '0.95rem' }}
              >
                ⚡ 즉시 다운로드 실행
              </button>

              <button 
                onClick={() => setShowSaveModal(false)}
                className="secondary-btn"
                style={{ padding: '0.875rem 1.25rem' }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 토스트 메시지 */}
      {toastMessage && (
        <div className="toast-container">
          {toastMessage}
        </div>
      )}
    </div>
  );
};

export default App;







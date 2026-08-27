import { useState } from 'react';
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
    downloadUrl: 'https://drive.google.com/uc?export=download&id=1CkMTYMEQWwM5KWYHPS4qlQAPPgazTFBK',
  },
  {
    id: '1BhPT-Z3OKUFd13m2mCfES7HWVFuscFZQ',
    fileId: '1BhPT-Z3OKUFd13m2mCfES7HWVFuscFZQ',
    name: '미래엔_미적분1_교과서.pdf',
    category: 'document',
    size: 'PDF 교과서',
    updatedAt: '3월 2일',
    viewUrl: 'https://drive.google.com/file/d/1BhPT-Z3OKUFd13m2mCfES7HWVFuscFZQ/view?usp=sharing',
    downloadUrl: 'https://drive.google.com/uc?export=download&id=1BhPT-Z3OKUFd13m2mCfES7HWVFuscFZQ',
  }
];

const App = () => {
  const [files] = useState<DriveFile[]>(REAL_DRIVE_FILES);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [viewMode, setViewMode] = useState<'embedded' | 'grid' | 'list'>('embedded');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleCopyFolderLink = () => {
    navigator.clipboard.writeText(GOOGLE_DRIVE_FOLDER_URL);
    showToast('✨ 구글 드라이브 링크가 복사되었습니다!');
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
            <p className="header-sub">실시간 공유드라이브 파일열기 및 다운로드 (폴더 ID: {DRIVE_FOLDER_ID})</p>
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

                  <div className="card-btn-group">
                    <a 
                      href={file.viewUrl} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="touch-btn touch-btn-open"
                    >
                      👁️ 열기
                    </a>

                    <a 
                      href={file.downloadUrl} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="touch-btn touch-btn-download"
                    >
                      📥 다운로드
                    </a>
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
                  <th style={{ textAlign: 'center' }}>조작 (열기 / 다운로드)</th>
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
                          <a 
                            href={file.viewUrl} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="table-btn btn-open"
                          >
                            👁️ 열기
                          </a>
                          <a 
                            href={file.downloadUrl} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="table-btn btn-download"
                          >
                            📥 다운로드
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





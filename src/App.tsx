import { useState } from 'react';
import './App.css';

const GOOGLE_DRIVE_FOLDER_URL = 'https://drive.google.com/drive/folders/1Ew38nohOksBhypc2UjHYTmi6bSjbICmn?usp=drive_link';
const DRIVE_FOLDER_ID = '1Ew38nohOksBhypc2UjHYTmi6bSjbICmn';

// 공유드라이브 샘플 및 파일 탐색기 데이터 구조
interface DriveFile {
  id: string;
  name: string;
  category: 'document' | 'presentation' | 'image' | 'sheet' | 'archive' | 'folder';
  size: string;
  updatedAt: string;
  fileId?: string; // 구글 드라이브 직개별 파일 ID (있는 경우)
  viewUrl: string;
  downloadUrl: string;
}

const INITIAL_FILES: DriveFile[] = [
  {
    id: 'f1',
    name: 'LBW 공유드라이브 전체 폴더',
    category: 'folder',
    size: '공유 폴더',
    updatedAt: '2026-08-27',
    viewUrl: GOOGLE_DRIVE_FOLDER_URL,
    downloadUrl: GOOGLE_DRIVE_FOLDER_URL,
  },
  {
    id: 'f2',
    name: '2026학년도 프로젝트 수업 기획안.pdf',
    category: 'document',
    size: '4.2 MB',
    updatedAt: '2026-08-25',
    viewUrl: GOOGLE_DRIVE_FOLDER_URL,
    downloadUrl: GOOGLE_DRIVE_FOLDER_URL,
  },
  {
    id: 'f3',
    name: '전자칠판 활용 시각자료 모음집.pptx',
    category: 'presentation',
    size: '18.5 MB',
    updatedAt: '2026-08-24',
    viewUrl: GOOGLE_DRIVE_FOLDER_URL,
    downloadUrl: GOOGLE_DRIVE_FOLDER_URL,
  },
  {
    id: 'f4',
    name: '수업용 데이터 분석 종합 서식.xlsx',
    category: 'sheet',
    size: '2.1 MB',
    updatedAt: '2026-08-20',
    viewUrl: GOOGLE_DRIVE_FOLDER_URL,
    downloadUrl: GOOGLE_DRIVE_FOLDER_URL,
  },
  {
    id: 'f5',
    name: '멀티미디어 포스터 및 그래픽 에셋.zip',
    category: 'archive',
    size: '45.8 MB',
    updatedAt: '2026-08-18',
    viewUrl: GOOGLE_DRIVE_FOLDER_URL,
    downloadUrl: GOOGLE_DRIVE_FOLDER_URL,
  },
  {
    id: 'f6',
    name: '학교 교육과정 안내 포스터.png',
    category: 'image',
    size: '3.7 MB',
    updatedAt: '2026-08-15',
    viewUrl: GOOGLE_DRIVE_FOLDER_URL,
    downloadUrl: GOOGLE_DRIVE_FOLDER_URL,
  }
];

const App = () => {
  const [files] = useState<DriveFile[]>(INITIAL_FILES);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'embedded'>('grid');
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
    const matchesSearch = file.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || file.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const getCategoryIcon = (category: DriveFile['category']) => {
    switch (category) {
      case 'folder': return { badge: '📁 폴더', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' };
      case 'document': return { badge: '📄 문서/PDF', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' };
      case 'presentation': return { badge: '📊 발표/PPT', color: '#f97316', bg: 'rgba(249, 115, 22, 0.15)' };
      case 'sheet': return { badge: '📈 스프레드시트', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' };
      case 'image': return { badge: '🖼️ 이미지/미디어', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)' };
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
            <h1 className="header-title">LBW 공유드라이브 스마트 파일 탐색기</h1>
            <p className="header-sub">전자칠판 터치 맞춤형 파일 열기 & 다운로드 센터 (폴더 ID: {DRIVE_FOLDER_ID})</p>
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
            구글 드라이브 직접 열기
          </a>

          <button onClick={handleCopyFolderLink} className="btn-secondary-touch">
            📋 링크 복사
          </button>
        </div>
      </header>

      {/* 필터 및 조작 툴바 */}
      <div className="explorer-toolbar">
        {/* 검색 창 */}
        <div className="search-box">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input 
            type="text" 
            placeholder="찾으시는 파일명을 입력하세요..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button className="clear-search-btn" onClick={() => setSearchTerm('')}>✕</button>
          )}
        </div>

        {/* 카테고리 필터 버튼 모음 */}
        <div className="category-filter">
          <button 
            className={`filter-chip ${selectedCategory === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('all')}
          >
            전체 보기 ({files.length})
          </button>
          <button 
            className={`filter-chip ${selectedCategory === 'document' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('document')}
          >
            📄 문서/PDF
          </button>
          <button 
            className={`filter-chip ${selectedCategory === 'presentation' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('presentation')}
          >
            📊 발표/PPT
          </button>
          <button 
            className={`filter-chip ${selectedCategory === 'sheet' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('sheet')}
          >
            📈 스프레드시트
          </button>
          <button 
            className={`filter-chip ${selectedCategory === 'image' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('image')}
          >
            🖼️ 미디어
          </button>
        </div>

        {/* 뷰 모드 토글 (바둑판 / 리스트 / 구글 내장 뷰어) */}
        <div className="view-mode-toggle">
          <button 
            className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => setViewMode('grid')}
            title="바둑판 보기"
          >
            ▦ 카드형
          </button>
          <button 
            className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
            title="목록 보기"
          >
            ≡ 목록형
          </button>
          <button 
            className={`view-btn ${viewMode === 'embedded' ? 'active' : ''}`}
            onClick={() => setViewMode('embedded')}
            title="구글 내장 뷰어"
          >
            🖥️ 구글 뷰어
          </button>
        </div>
      </div>

      {/* 메인 파일 탐색기 영역 */}
      <main className="explorer-content">
        {viewMode === 'embedded' ? (
          /* 구글 임베드 뷰어 탭 */
          <div className="embedded-viewer-container">
            <iframe 
              src={`https://drive.google.com/embeddedfolderview?id=${DRIVE_FOLDER_ID}#grid`}
              title="Google Drive Embedded Folder View"
              className="google-drive-iframe"
            />
          </div>
        ) : viewMode === 'grid' ? (
          /* 바둑판(카드) 뷰 */
          <div className="file-grid">
            {filteredFiles.length === 0 ? (
              <div className="empty-files-box">
                <p>🔍 검색 결과 조건에 일치하는 파일이 없습니다.</p>
              </div>
            ) : (
              filteredFiles.map(file => {
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
                      최종 수정일: {file.updatedAt}
                    </div>

                    {/* 전자칠판 대형 터치 열기 및 다운로드 버튼 */}
                    <div className="card-btn-group">
                      <a 
                        href={file.viewUrl} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="touch-btn touch-btn-open"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                        열기
                      </a>

                      <a 
                        href={file.downloadUrl} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="touch-btn touch-btn-download"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                          <polyline points="7 10 12 15 17 10"/>
                          <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        다운로드
                      </a>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          /* 리스트(목록) 뷰 */
          <div className="file-list-wrapper">
            <table className="file-list-table">
              <thead>
                <tr>
                  <th>구분</th>
                  <th>파일명</th>
                  <th>크기</th>
                  <th>최종 수정일</th>
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




import { useState, useEffect } from 'react';
import './App.css';

const ROOT_FOLDER_ID = '1Ew38nohOksBhypc2UjHYTmi6bSjbICmn';

// 구글 공유드라이브 아이템 구조
interface DriveItem {
  id: string;
  name: string;
  type: 'folder' | 'document';
  folderId?: string;
  updatedAt: string;
  viewUrl: string;
  downloadUrl: string;
}

// 구글 날짜 문자열 타임스탬프 변환 함수 (최신순 정렬용)
const parseDriveDateToTimestamp = (rawDate: string): number => {
  if (!rawDate) return 0;
  const d = rawDate.trim().toLowerCase();

  // 1. "10:12 pm", "11:13 am" 등 오늘 시간 데이터
  if (d.includes('am') || d.includes('pm')) {
    const timeMatch = d.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const isPm = timeMatch[3].toLowerCase() === 'pm';
      if (isPm && hours < 12) hours += 12;
      if (!isPm && hours === 12) hours = 0;
      const today = new Date();
      today.setHours(hours, minutes, 0, 0);
      return today.getTime();
    }
    return new Date().getTime();
  }

  // 2. "11/11/25", "3/2/24" 등 슬래시 날짜 데이터
  if (d.includes('/')) {
    const parts = d.split('/');
    if (parts.length === 3) {
      const month = parseInt(parts[0], 10) - 1;
      const day = parseInt(parts[1], 10);
      let year = parseInt(parts[2], 10);
      if (year < 100) year += 2000;
      return new Date(year, month, day).getTime();
    }
  }

  // 3. "Aug 9", "Mar 2" 등 월/일 데이터
  const parsedDate = Date.parse(`${rawDate}, 2026`);
  if (!isNaN(parsedDate)) {
    return parsedDate;
  }

  return 0;
};

const App = () => {
  const [folderHistory, setFolderHistory] = useState<{ id: string; name: string }[]>([
    { id: ROOT_FOLDER_ID, name: '전자칠판' }
  ]);
  const [items, setItems] = useState<DriveItem[]>([]);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const currentFolder = folderHistory[folderHistory.length - 1];

  useEffect(() => {
    fetchDriveFolderLive(currentFolder.id);
  }, [currentFolder.id]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const parseDriveHtml = (html: string): DriveItem[] => {
    const regex = /class="flip-entry" id="entry-([^"]+)"[\s\S]*?href="([^"]+)"[\s\S]*?class="flip-entry-title">([^<]+)<\/div>[\s\S]*?class="flip-entry-last-modified">\s*<div>([^<]+)<\/div>/g;
    const parsed: DriveItem[] = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
      const id = match[1];
      const href = match[2];
      const name = match[3].trim();
      const rawDate = match[4].trim();
      const isFolder = href.includes('/drive/folders/');

      parsed.push({
        id,
        name,
        type: isFolder ? 'folder' : 'document',
        folderId: isFolder ? id : undefined,
        updatedAt: rawDate,
        viewUrl: isFolder ? `https://drive.google.com/drive/folders/${id}?usp=sharing` : `https://drive.google.com/file/d/${id}/view?usp=sharing`,
        downloadUrl: isFolder ? `https://drive.google.com/drive/folders/${id}?usp=sharing` : `https://drive.google.com/uc?export=download&confirm=t&id=${id}`
      });
    }
    return parsed;
  };

  const fetchDriveFolderLive = async (folderId: string) => {
    setIsLoading(true);
    setFetchError(false);

    let scannedItems: DriveItem[] = [];
    let isSuccess = false;

    // 1. Vercel 서버리스 API 프록시로 구글 드라이브 실시간 HTML 파싱 (GitHub Pages 교차 출처 CORS 지원)
    try {
      const apiEndpoint = window.location.hostname.includes('vercel.app') 
        ? `/api/drive?id=${folderId}` 
        : `https://lbwtest.vercel.app/api/drive?id=${folderId}`;

      const res = await fetch(apiEndpoint);
      if (res.ok) {
        const html = await res.text();
        scannedItems = parseDriveHtml(html);
        if (scannedItems.length > 0) {
          isSuccess = true;
        }
      }
    } catch (e) {
      console.warn('Vercel API proxy fetch failed:', e);
    }

    // 2. 외부 프록시 백업 시도
    if (!isSuccess || scannedItems.length === 0) {
      try {
        const targetUrl = `https://drive.google.com/embeddedfolderview?id=${folderId}#list`;
        const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(targetUrl);
        const res = await fetch(proxyUrl);
        if (res.ok) {
          const html = await res.text();
          const backupItems = parseDriveHtml(html);
          if (backupItems.length > 0) {
            scannedItems = backupItems;
            isSuccess = true;
          }
        }
      } catch (e) {
        console.warn('Allorigins proxy failed:', e);
      }
    }

    setItems(scannedItems);
    setIsLoading(false);

    if (!isSuccess && scannedItems.length === 0) {
      setFetchError(true);
    } else {
      setFetchError(false);
    }
  };

  const handleRefresh = () => {
    showToast('🔄 구글 드라이브 실시간 검색을 재실행합니다...');
    fetchDriveFolderLive(currentFolder.id);
  };

  const handleOpenFolder = (folderId: string, folderName: string) => {
    setFolderHistory(prev => [...prev, { id: folderId, name: folderName }]);
  };

  const handleGoBack = () => {
    if (folderHistory.length > 1) {
      setFolderHistory(prev => prev.slice(0, prev.length - 1));
    }
  };

  const handleSmartDownload = async (item: DriveItem) => {
    showToast(`⚡ '${item.name}' 다운로드를 시작합니다...`);

    const standardDownloadUrl = `https://drive.google.com/uc?export=download&confirm=t&id=${item.id}`;

    try {
      const pageUrl = `https://drive.google.com/uc?export=download&id=${item.id}`;
      const res = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(pageUrl));
      if (res.ok) {
        const html = await res.text();
        const uuidMatch = html.match(/uuid=([^&"']+)/i) || html.match(/name="uuid" value="([^"]+)"/i);
        const confirmMatch = html.match(/confirm=([^&"']+)/i) || html.match(/name="confirm" value="([^"]+)"/i);
        if (uuidMatch) {
          const uuid = uuidMatch[1];
          const confirm = confirmMatch ? confirmMatch[1] : 't';
          const bypassUrl = `https://drive.usercontent.google.com/download?id=${item.id}&export=download&confirm=${confirm}&uuid=${uuid}`;
          window.location.href = bypassUrl;
          return;
        }
      }
    } catch (e) {
      console.warn('Smart token bypass check failed:', e);
    }

    window.location.href = standardDownloadUrl;
  };

  // 검색어 필터링
  const filteredItems = items.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // 정렬 규칙: 폴더 상단 나열 (폴더명 순 정렬) -> 파일 하단 나열 (최신 수정날짜 순 정렬)
  const sortedItems = [...filteredItems].sort((a, b) => {
    if (a.type === 'folder' && b.type !== 'folder') return -1;
    if (a.type !== 'folder' && b.type === 'folder') return 1;

    if (a.type === 'folder' && b.type === 'folder') {
      return a.name.localeCompare(b.name, 'ko');
    }

    const timeA = parseDriveDateToTimestamp(a.updatedAt);
    const timeB = parseDriveDateToTimestamp(b.updatedAt);
    return timeB - timeA;
  });

  return (
    <div className="explorer-container" style={{ padding: '1.25rem' }}>
      {/* 최상단 컨트롤 바: [상위 폴더 이동 / 현재 폴더명] + [검색창] + [🔄 실시간 다시 읽기] */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {folderHistory.length > 1 && (
            <button 
              onClick={handleGoBack}
              style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '0.65rem 1.25rem', borderRadius: '10px', fontWeight: '700', fontSize: '0.95rem', cursor: 'pointer' }}
            >
              ← 상위 폴더로 이동
            </button>
          )}
          <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            📂 {currentFolder.name}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div className="search-box" style={{ maxWidth: '280px', margin: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input 
              type="text" 
              placeholder="파일/하위폴더 검색..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button className="clear-search-btn" onClick={() => setSearchTerm('')}>✕</button>
            )}
          </div>

          <button 
            onClick={handleRefresh} 
            disabled={isLoading}
            className="btn-secondary-touch"
            style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: '#fff', border: 'none', padding: '0.65rem 1.25rem', fontWeight: 700, fontSize: '0.95rem' }}
          >
            <span className={isLoading ? 'spinning-icon' : ''}>🔄</span> {isLoading ? '검색 중...' : '실시간 다시 읽기'}
          </button>
        </div>
      </div>

      {/* 탐색기 폴더 구조 목록 테이블 */}
      <main className="explorer-content">
        <div className="file-list-wrapper">
          <table className="file-list-table">
            <thead>
              <tr>
                <th style={{ width: '130px' }}>구분</th>
                <th>파일 / 하위 폴더명</th>
                <th style={{ width: '150px' }}>수정 날짜</th>
                <th style={{ textAlign: 'center', width: '320px' }}>조작 (진입 / 다운로드 / 열기)</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '3rem', color: '#60a5fa', fontSize: '1.1rem' }}>
                    🔄 구글 드라이브 실시간 목록을 검색하여 불러오는 중입니다...
                  </td>
                </tr>
              ) : fetchError ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '3rem', color: '#ef4444', fontSize: '1.1rem', fontWeight: 700 }}>
                    ⚠️ 구글 드라이브 실시간 수집에 실패했습니다. 네트워크 상태를 확인하시거나 상단의 [🔄 실시간 다시 읽기] 버튼을 눌러주세요.
                  </td>
                </tr>
              ) : sortedItems.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                    📁 이 폴더에 저장된 파일이나 하위 폴더가 없습니다.
                  </td>
                </tr>
              ) : (
                sortedItems.map(item => {
                  const isFolder = item.type === 'folder';
                  return (
                    <tr key={item.id}>
                      <td>
                        <span className="file-type-badge" style={{ 
                          backgroundColor: isFolder ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)', 
                          color: isFolder ? '#f59e0b' : '#ef4444',
                          whiteSpace: 'nowrap'
                        }}>
                          {isFolder ? '📁 하위폴더' : '📄 PDF문서'}
                        </span>
                      </td>
                      <td className="table-filename">
                        {isFolder ? (
                          <button 
                            onClick={() => handleOpenFolder(item.folderId!, item.name)}
                            style={{ background: 'none', border: 'none', color: '#f59e0b', fontWeight: 700, fontSize: '1.05rem', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                          >
                            📁 {item.name}
                          </button>
                        ) : (
                          <span>📄 {item.name}</span>
                        )}
                      </td>
                      <td style={{ fontWeight: 500, color: '#94a3b8', fontSize: '0.95rem' }}>
                        {item.updatedAt ? item.updatedAt : '-'}
                      </td>
                      <td>
                        <div className="table-btn-group">
                          {isFolder ? (
                            <button 
                              onClick={() => handleOpenFolder(item.folderId!, item.name)}
                              className="table-btn"
                              style={{ background: '#f59e0b', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700 }}
                            >
                              📂 '{item.name}' 진입
                            </button>
                          ) : (
                            <button 
                              onClick={() => handleSmartDownload(item)}
                              className="table-btn btn-download"
                              style={{ background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700 }}
                            >
                              ⚡ 다운로드
                            </button>
                          )}

                          <a 
                            href={item.viewUrl} 
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
                })
              )}
            </tbody>
          </table>
        </div>
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















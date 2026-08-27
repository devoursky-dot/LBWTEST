import { useState, useEffect } from 'react';
import './App.css';

const GOOGLE_DRIVE_URL = 'https://drive.google.com/drive/folders/1Ew38nohOksBhypc2UjHYTmi6bSjbICmn?usp=drive_link';
const DRIVE_FOLDER_ID = '1Ew38nohOksBhypc2UjHYTmi6bSjbICmn';

const App = () => {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [autoRedirect, setAutoRedirect] = useState<boolean>(false);
  const [countdown, setCountdown] = useState<number>(3);

  // 자동 이동 선택 시 카운트다운 후 이동
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (autoRedirect && countdown > 0) {
      timer = setTimeout(() => setCountdown(prev => prev - 1), 1000);
    } else if (autoRedirect && countdown === 0) {
      window.location.href = GOOGLE_DRIVE_URL;
    }
    return () => clearTimeout(timer);
  }, [autoRedirect, countdown]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(GOOGLE_DRIVE_URL);
    showToast('✨ 구글 공유드라이브 링크가 복사되었습니다!');
  };

  return (
    <div className="minimal-container">
      {/* 100% 중앙 정렬된 미니멀 구글 공유드라이브 접속 카드 */}
      <div className="minimal-drive-card">
        <div className="drive-icon-large">
          <svg width="72" height="72" viewBox="0 0 87.3 78" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6.6 66.85L22.25 39.75H80.7L65.05 66.85H6.6Z" fill="#0066DA"/>
            <path d="M43.65 11.15L59.3 38.25L29.9 89.25L14.25 62.15L43.65 11.15Z" fill="#00AC47"/>
            <path d="M73.5 11.15L89.15 38.25H57.85L42.2 11.15H73.5Z" fill="#EA4335"/>
            <path d="M43.65 11.15L28 38.25H59.3L43.65 11.15Z" fill="#FFBA00"/>
          </svg>
        </div>

        <h1 className="minimal-title">LBW 구글 공유드라이브</h1>
        <p className="minimal-subtitle">
          폴더 ID: <code>{DRIVE_FOLDER_ID}</code>
        </p>

        {/* 메인 공유드라이브 접속 버튼 (HTML 순수 a 태그 적용으로 전자칠판 브라우저 100% 호환) */}
        <a 
          href={GOOGLE_DRIVE_URL} 
          className="direct-cta-btn"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          구글 공유드라이브 접속하기
        </a>

        {/* 새 탭에서 열기 & 링크 복사 액션 */}
        <div className="minimal-actions">
          <a 
            href={GOOGLE_DRIVE_URL} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="secondary-btn"
          >
            새 탭에서 열기
          </a>

          <button onClick={handleCopyLink} className="secondary-btn">
            링크 복사
          </button>
        </div>

        {/* 자동 이동 옵션 */}
        <div className="auto-redirect-box">
          <label className="toggle-label">
            <input 
              type="checkbox" 
              checked={autoRedirect} 
              onChange={(e) => {
                setAutoRedirect(e.target.checked);
                setCountdown(3);
              }} 
            />
            <span>접속 시 자동 이동 {autoRedirect && `(${countdown}초 후 이동)`}</span>
          </label>
        </div>
      </div>

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



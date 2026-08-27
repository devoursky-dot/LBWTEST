import { useState, useEffect, Suspense, Component, type ErrorInfo, type ReactNode, lazy, type LazyExoticComponent, type ComponentType } from 'react';
import './App.css';

const GOOGLE_DRIVE_URL = 'https://drive.google.com/drive/folders/1Ew38nohOksBhypc2UjHYTmi6bSjbICmn?usp=drive_link';
const DRIVE_FOLDER_ID = '1Ew38nohOksBhypc2UjHYTmi6bSjbICmn';

// 앱 정의 인터페이스
interface AppDefinition {
  name: string;
  component: LazyExoticComponent<ComponentType<any>>;
}

// import.meta.glob을 사용하여 apps 폴더의 모든 .tsx 파일 수집
const modules = import.meta.glob('./apps/*.tsx');
const APPS: Record<string, AppDefinition> = {};

for (const path in modules) {
  const name = path.match(/\.\/apps\/(.*)\.tsx$/)?.[1] || path;
  if (name === 'App') continue;

  APPS[name] = {
    name: name,
    component: lazy(modules[path] as any)
  };
}

// Error Boundary Component
class ErrorBoundary extends Component<{ children: ReactNode, onReset: () => void }, { hasError: boolean, error: any }> {
  constructor(props: { children: ReactNode, onReset: () => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: ErrorInfo) {
    console.error("App crashed:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px 20px', color: '#f87171', textAlign: 'center', height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', backgroundColor: '#07090e' }}>
          <h2 style={{ marginBottom: '15px', color: '#fff' }}>애플리케이션 실행 중 오류가 발생했습니다.</h2>
          <div style={{ maxWidth: '600px', maxHeight: '200px', overflow: 'auto', background: 'rgba(255,255,255,0.05)', padding: '15px', borderRadius: '12px', fontFamily: 'monospace', textAlign: 'left', fontSize: '13px', border: '1px solid rgba(255,255,255,0.1)' }}>
            {this.state.error?.message || String(this.state.error)}
          </div>
          <button 
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onReset();
            }}
            style={{ padding: '12px 24px', marginTop: '24px', cursor: 'pointer', fontSize: '1rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600 }}
          >
            메인 화면으로 돌아가기
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

const App = () => {
  const [currentApp, setCurrentApp] = useState<string>('');
  const [currentTime, setCurrentTime] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showQRModal, setShowQRModal] = useState<boolean>(false);
  const [showToolsModal, setShowToolsModal] = useState<boolean>(false);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(GOOGLE_DRIVE_URL);
    showToast('✨ 구글 드라이브 링크가 클립보드에 복사되었습니다!');
  };

  const handleCopyFolderId = () => {
    navigator.clipboard.writeText(DRIVE_FOLDER_ID);
    showToast('🔑 폴더 ID가 복사되었습니다!');
  };

  const resetApp = () => {
    setCurrentApp('');
  };

  const ActiveComponent = currentApp ? APPS[currentApp]?.component : null;

  // 특정 개발도구 서브앱이 선택된 경우
  if (currentApp && ActiveComponent) {
    return (
      <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', backgroundColor: '#0f172a' }}>
        <button 
          onClick={resetApp}
          style={{ 
            position: 'absolute', 
            top: '20px', 
            right: '20px', 
            zIndex: 9999, 
            padding: '10px 20px', 
            fontSize: '0.95rem', 
            backgroundColor: 'rgba(15, 23, 42, 0.85)', 
            color: 'white', 
            border: '1px solid rgba(255, 255, 255, 0.2)', 
            borderRadius: '12px',
            cursor: 'pointer',
            backdropFilter: 'blur(10px)',
            fontWeight: 600,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
          }}
        >
          ← 메인 홈으로
        </button>
        
        <div style={{ width: '100%', height: '100%', overflow: 'auto' }}>
          <ErrorBoundary onReset={resetApp} key={currentApp}>
            <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#94a3b8', fontSize: '1.2rem' }}>Loading application...</div>}>
              <ActiveComponent />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  // 메인 화면 (구글 공유 드라이브 허브)
  return (
    <div className="app-container">
      {/* 상단 네비게이션 바 */}
      <header className="navbar">
        <div className="brand-logo">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 17L12 22L22 17" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 12L12 17L22 12" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          LBW Cloud Workspace
          <span className="brand-badge">PRO</span>
        </div>

        <div className="nav-controls">
          <div className="time-widget">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            {currentTime || '00:00:00'}
          </div>

          <button className="nav-btn" onClick={() => setShowToolsModal(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
            개발도구 {Object.keys(APPS).length > 0 && `(${Object.keys(APPS).length})`}
          </button>
        </div>
      </header>

      {/* 메인 히어로 히어 히어 영역 */}
      <main className="hero-container">
        <div className="hero-tag">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          구글 클라우드 통합 공유드라이브 포털
        </div>

        <h1 className="hero-title">
          LBW <span>Shared Drive</span> Workspace
        </h1>
        <p className="hero-description">
          최신 프로젝트 자료, 공유 문서 및 팀 에셋을 실시간으로 확인하고 다운로드하실 수 있는 전용 공유 드라이브입니다.
        </p>

        {/* 구글 드라이브 메인 카드 */}
        <div className="drive-card">
          <div className="drive-card-bg-glow"></div>

          <div className="drive-header-badge">
            <span className="status-dot"></span>
            <span className="status-text">Google Drive 연결됨</span>
          </div>

          {/* Google Drive 공식 스타일 SVG 아이콘 */}
          <div className="drive-icon-wrapper">
            <svg width="48" height="48" viewBox="0 0 87.3 78" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6.6 66.85L22.25 39.75H80.7L65.05 66.85H6.6Z" fill="#0066DA"/>
              <path d="M43.65 11.15L59.3 38.25L29.9 89.25L14.25 62.15L43.65 11.15Z" fill="#00AC47"/>
              <path d="M73.5 11.15L89.15 38.25H57.85L42.2 11.15H73.5Z" fill="#EA4335"/>
              <path d="M43.65 11.15L28 38.25H59.3L43.65 11.15Z" fill="#FFBA00"/>
            </svg>
          </div>

          <h2 className="drive-title">LBW 공유 드라이브 바로가기</h2>
          <p className="drive-subtitle">
            폴더 ID: <code style={{ color: '#60a5fa', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '4px' }}>{DRIVE_FOLDER_ID}</code>
          </p>

          {/* 메인 접속 CTA 버튼 */}
          <a 
            href={GOOGLE_DRIVE_URL} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="main-cta-btn"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            구글 공유드라이브 접속하기
          </a>

          {/* 퀵 액션 버튼 모음 */}
          <div className="action-grid">
            <button className="action-btn" onClick={handleCopyLink}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              링크 복사
            </button>

            <button className="action-btn" onClick={() => setShowQRModal(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7"/>
                <rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/>
                <rect x="3" y="14" width="7" height="7"/>
              </svg>
              모바일 QR 스캔
            </button>

            <button className="action-btn" onClick={handleCopyFolderId}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
              </svg>
              폴더 ID 복사
            </button>
          </div>
        </div>
      </main>

      {/* 가상 숏컷 그리드 (클릭 시 공유드라이브로 이동) */}
      <section className="shortcuts-section">
        <div className="section-title">
          <span>📁 주요 카테고리 바로가기</span>
          <span style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 400 }}>Shared Drive Quick Links</span>
        </div>

        <div className="shortcuts-grid">
          <a href={GOOGLE_DRIVE_URL} target="_blank" rel="noopener noreferrer" className="shortcut-card">
            <div className="shortcut-icon-bar">
              <div className="shortcut-icon icon-blue">📄</div>
              <span className="shortcut-arrow">→</span>
            </div>
            <div className="shortcut-title">통합 문서 & 보고서</div>
            <div className="shortcut-desc">프로젝트 사양서, 회의록 및 기획안 문서 모음</div>
          </a>

          <a href={GOOGLE_DRIVE_URL} target="_blank" rel="noopener noreferrer" className="shortcut-card">
            <div className="shortcut-icon-bar">
              <div className="shortcut-icon icon-emerald">🎨</div>
              <span className="shortcut-arrow">→</span>
            </div>
            <div className="shortcut-title">디자인 & 미디어 자원</div>
            <div className="shortcut-desc">이미지, 원본 그래픽, 비디오 및 미디어 에셋</div>
          </a>

          <a href={GOOGLE_DRIVE_URL} target="_blank" rel="noopener noreferrer" className="shortcut-card">
            <div className="shortcut-icon-bar">
              <div className="shortcut-icon icon-purple">💾</div>
              <span className="shortcut-arrow">→</span>
            </div>
            <div className="shortcut-title">개발 소스 & 데이터</div>
            <div className="shortcut-desc">소프트웨어 빌드 파일, 패치 및 소스 백업</div>
          </a>

          <a href={GOOGLE_DRIVE_URL} target="_blank" rel="noopener noreferrer" className="shortcut-card">
            <div className="shortcut-icon-bar">
              <div className="shortcut-icon icon-amber">🔐</div>
              <span className="shortcut-arrow">→</span>
            </div>
            <div className="shortcut-title">보안 공유 보관함</div>
            <div className="shortcut-desc">권한 지정 팀원 전용 읽기/쓰기 공유 폴더</div>
          </a>
        </div>
      </section>

      {/* 모바일 QR 코드 팝업 모달 */}
      {showQRModal && (
        <div className="modal-overlay" onClick={() => setShowQRModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-btn" onClick={() => setShowQRModal(false)}>✕</button>
            <h3 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#fff', marginBottom: '0.5rem' }}>
              모바일 QR 코드 스캔
            </h3>
            <p style={{ fontSize: '0.9rem', color: '#94a3b8' }}>
              스마트폰 카메라로 아래 QR 코드를 스캔하면 구글 공유드라이브로 즉시 이동합니다.
            </p>

            <div className="qr-wrapper">
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(GOOGLE_DRIVE_URL)}`}
                alt="Google Drive QR Code" 
                className="qr-image"
              />
            </div>

            <button 
              className="main-cta-btn" 
              style={{ width: '100%', padding: '0.8rem', fontSize: '0.95rem' }}
              onClick={handleCopyLink}
            >
              링크 복사하기
            </button>
          </div>
        </div>
      )}

      {/* 개발도구 서브앱 목록 모달 (필요시 호출) */}
      {showToolsModal && (
        <div className="modal-overlay" onClick={() => setShowToolsModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '550px' }}>
            <button className="modal-close-btn" onClick={() => setShowToolsModal(false)}>✕</button>
            <h3 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#fff', marginBottom: '0.25rem' }}>
              개발도구 & 서브 테스트 앱
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
              기존 구현된 모듈 및 유틸리티 앱 목록입니다.
            </p>

            <div className="tools-grid">
              {Object.entries(APPS).map(([key, app]) => (
                <button 
                  key={key} 
                  className="tool-item-btn" 
                  onClick={() => {
                    setCurrentApp(key);
                    setShowToolsModal(false);
                  }}
                >
                  <span>{app.name}</span>
                  <span style={{ color: '#3b82f6' }}>▶</span>
                </button>
              ))}
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

      {/* 푸터 */}
      <footer className="footer">
        <p>© 2026 LBW Workspace. All rights reserved. Google Drive Integration</p>
      </footer>
    </div>
  );
};

export default App;


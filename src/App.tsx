import { useState, Suspense, Component, type ErrorInfo, type ReactNode, lazy, type LazyExoticComponent, type ComponentType, type ChangeEvent } from 'react';

// 앱 정의 인터페이스
interface AppDefinition {
  name: string;
  component: LazyExoticComponent<ComponentType<any>>;
}

// import.meta.glob을 사용하여 apps 폴더의 모든 .tsx 파일을 동적으로 로드
const modules = import.meta.glob('./apps/*.tsx');
const APPS: Record<string, AppDefinition> = {};

for (const path in modules) {
  // 파일명 추출 (예: ./apps/test.tsx -> test)
  const name = path.match(/\.\/apps\/(.*)\.tsx$/)?.[1] || path;

  // App.tsx가 apps 폴더에 있다면 제외 (런처 자신 혹은 중복 방지)
  if (name === 'App') continue;

  APPS[name] = {
    name: name,
    component: lazy(modules[path] as any)
  };
}

// 에러 바운더리 컴포넌트: 하위 컴포넌트에서 에러 발생 시 UI를 대체함
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
        <div style={{ padding: '20px', color: '#d32f2f', textAlign: 'center', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
          <h2 style={{ marginBottom: '10px' }}>앱 실행 중 오류가 발생했습니다.</h2>
          <div style={{ maxWidth: '90%', maxHeight: '300px', overflow: 'auto', background: '#f5f5f5', padding: '15px', borderRadius: '4px', fontFamily: 'monospace', textAlign: 'left', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
            <strong>Error:</strong> {this.state.error && this.state.error.message ? this.state.error.message : String(this.state.error)}
            <br /><br />
            <strong>Stack:</strong> {this.state.error && this.state.error.stack ? this.state.error.stack : 'No stack trace available'}
          </div>
          <button 
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onReset();
            }}
            style={{ padding: '10px 20px', marginTop: '20px', cursor: 'pointer', fontSize: '1rem', backgroundColor: '#1976d2', color: 'white', border: 'none', borderRadius: '4px' }}
          >
            메인으로 돌아가기
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

const App = () => {
  const [currentApp, setCurrentApp] = useState<string>('');

  const handleAppChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setCurrentApp(e.target.value);
  };

  const resetApp = () => {
    setCurrentApp('');
  };

  const ActiveComponent = currentApp ? APPS[currentApp]?.component : null;

  // 앱이 실행 중일 때 (전체 화면)
  if (currentApp && ActiveComponent) {
    return (
      <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', backgroundColor: '#fff' }}>
        <button 
          onClick={resetApp}
          style={{ 
            position: 'absolute', 
            top: '20px', 
            right: '20px', 
            zIndex: 9999, 
            padding: '8px 16px', 
            fontSize: '1rem', 
            backgroundColor: '#333', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            cursor: 'pointer',
            opacity: 0.8
          }}
        >
          홈으로
        </button>
        
        <div style={{ width: '100%', height: '100%', overflow: 'auto' }}>
          <ErrorBoundary onReset={resetApp} key={currentApp}>
            <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>Loading...</div>}>
              <ActiveComponent />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  // 메인 화면 (앱 선택)
  return (
    <div className="main-screen" style={{ padding: '20px', height: '100vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' }}>
      <div style={{ textAlign: 'center', padding: '40px', backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
        <h1 style={{ margin: '0 0 30px 0', fontSize: '2rem', color: '#333' }}>LBW Test Apps</h1>
        
        <div className="app-selector">
          <select 
            value={currentApp} 
            onChange={handleAppChange}
            style={{ 
              padding: '12px 20px', 
              fontSize: '1.1rem', 
              borderRadius: '6px', 
              border: '1px solid #ddd',
              minWidth: '250px',
              cursor: 'pointer',
              outline: 'none'
            }}
          >
            <option value="">앱을 선택하세요</option>
            {Object.entries(APPS).map(([key, app]) => (
              <option key={key} value={key}>
                {app.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};

export default App

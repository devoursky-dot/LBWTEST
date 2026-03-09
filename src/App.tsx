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
          <p style={{ maxWidth: '80%', overflow: 'auto', background: '#f5f5f5', padding: '15px', borderRadius: '4px', fontFamily: 'monospace', textAlign: 'left' }}>
            {this.state.error instanceof Error ? this.state.error.message : String(this.state.error)}
          </p>
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

  return (
    <div className="main-screen" style={{ padding: '20px', height: '100vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
      <header style={{ marginBottom: '20px', paddingBottom: '20px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>LBW Test Apps</h1>
        
        <div className="app-selector">
          <select 
            value={currentApp} 
            onChange={handleAppChange}
            style={{ 
              padding: '8px 12px', 
              fontSize: '1rem', 
              borderRadius: '4px', 
              border: '1px solid #ddd',
              minWidth: '200px'
            }}
          >
            <option value="">앱 선택...</option>
            {Object.entries(APPS).map(([key, app]) => (
              <option key={key} value={key}>
                {app.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      <main style={{ flex: 1, position: 'relative', overflow: 'auto' }}>
        <ErrorBoundary onReset={resetApp} key={currentApp}>
          {ActiveComponent ? (
            <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>Loading...</div>}>
              <ActiveComponent />
            </Suspense>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#999', flexDirection: 'column' }}>
              <p style={{ fontSize: '1.2rem' }}>드롭다운 메뉴에서 실행할 앱을 선택해주세요.</p>
            </div>
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
};

export default App

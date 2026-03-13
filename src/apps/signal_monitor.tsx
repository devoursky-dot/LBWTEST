import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

// [1] Supabase 클라이언트 초기화
// Vite 환경 변수를 사용합니다. (.env 파일에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 설정 필요)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://your-project-url.supabase.co';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default function SignalMonitor() {
  const [signals, setSignals] = useState<any[]>([]);
  const [connStatus, setStatus] = useState<string>('연결 대기 중...');

  useEffect(() => {
    // [2] 실시간 구독 설정
    // 'supabase_realtime' Publication 설정을 통해 'signal' 테이블의 변화를 감지합니다.
    const channel = supabase
      .channel('realtime-signal-changes') // 채널 이름 (임의 지정 가능)
      .on(
        'postgres_changes',
        {
          event: '*', // 모든 이벤트(INSERT, UPDATE, DELETE, TRUNCATE) 감지
          schema: 'public',
          table: 'signal',
        },
        (payload) => {
          console.log('데이터 변경 감지:', payload);

          // [3] payload에서 새 데이터(new) 추출 및 상태 업데이트
          // INSERT, UPDATE 시에는 payload.new에 데이터가 들어옵니다.
          // DELETE 시에는 payload.old에 삭제된 데이터의 ID 등이 들어옵니다.
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const newData = payload.new;
            setSignals((prev) => [newData, ...prev].slice(0, 20)); // 최신 20개만 유지 (메모리 관리)
          } else if (payload.eventType === 'DELETE') {
            setSignals((prev) => prev.filter(item => item.id !== payload.old.id));
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setStatus('✅ 실시간 구독 중');
        } else {
          setStatus(`⚠️ 상태: ${status}`);
        }
      });

    // [4] 언마운트 시 구독 해제 (메모리 누수 방지 필수)
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h3>📡 Signal 실시간 모니터링</h3>
      <p>상태: <strong>{connStatus}</strong></p>
      <div style={{ background: '#f0f0f0', padding: '10px', borderRadius: '8px', maxHeight: '400px', overflowY: 'auto' }}>
        {signals.length === 0 && <p>수신된 데이터가 없습니다.</p>}
        {signals.map((sig, idx) => (
          <pre key={idx} style={{ fontSize: '12px', borderBottom: '1px solid #ccc', padding: '5px' }}>
            {JSON.stringify(sig, null, 2)}
          </pre>
        ))}
      </div>
    </div>
  );
}
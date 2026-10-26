/**
 * OfflineStatusBadge.tsx
 * ============================================================================
 * 오프라인 상태 및 동기화 대기열 표시 배지 컴포넌트
 * 
 * - 메인 툴바 또는 헤더에 부착되어 실시간 네트워크 상태 표시
 * - 대기 중인 제출 건수 안내 및 원클릭 수동 동기화 지원
 * ============================================================================
 */

import React, { useState, useEffect } from 'react';
import {
  subscribeOfflineStatus,
  flushPendingSubmissions,
  type SyncStatus
} from './offlineSync';

export interface OfflineStatusBadgeProps {
  style?: React.CSSProperties;
}

export const OfflineStatusBadge: React.FC<OfflineStatusBadgeProps> = ({ style }) => {
  const [status, setStatus] = useState<SyncStatus>({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    pendingCount: 0,
    isSyncing: false,
    lastSyncedAt: null
  });
  const [popoverOpen, setPopoverOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeOfflineStatus((newStatus) => {
      setStatus(newStatus);
    });
    return unsubscribe;
  }, []);

  const handleManualSync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await flushPendingSubmissions();
  };

  // 평소 온라인이고 대기열이 없으면 미려한 콤팩트 상태 유지
  const isAllGood = status.isOnline && status.pendingCount === 0 && !status.isSyncing;

  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        userSelect: 'none',
        ...style
      }}
    >
      <button
        type="button"
        onClick={() => setPopoverOpen(prev => !prev)}
        style={{
          width: '32px',
          height: '32px',
          padding: 0,
          borderRadius: '50%',
          border: !status.isOnline
            ? '1.5px solid #f59e0b'
            : status.pendingCount > 0
            ? '1.5px solid #3b82f6'
            : '1px solid rgba(255, 255, 255, 0.15)',
          background: !status.isOnline
            ? 'rgba(245, 158, 11, 0.18)'
            : status.pendingCount > 0
            ? 'rgba(59, 130, 246, 0.18)'
            : 'rgba(255, 255, 255, 0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          backdropFilter: 'blur(4px)',
          transition: 'all 0.15s ease',
          position: 'relative'
        }}
        title={
          !status.isOnline
            ? '📡 네트워크 연결 끊김 (오프라인 모드: 기기에 안전하게 저장 중)'
            : status.isSyncing
            ? '🔄 전자칠판으로 필기 동기화 전송 중...'
            : status.pendingCount > 0
            ? `🔄 전송 대기 과제 ${status.pendingCount}건 (연결 시 자동 제출)`
            : '🟢 네트워크 연결됨 (온라인: 실시간 동기화 완료)'
        }
      >
        <span style={{ fontSize: '14px', lineHeight: 1 }}>
          {!status.isOnline ? '📡' : status.isSyncing ? '⏳' : status.pendingCount > 0 ? '🔄' : '🟢'}
        </span>

        {/* 대기열 건수 미니 뱃지 */}
        {status.pendingCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '-2px',
              right: '-2px',
              background: '#3b82f6',
              color: '#ffffff',
              fontSize: '9px',
              fontWeight: 900,
              padding: '1px 4px',
              borderRadius: '8px',
              border: '1px solid #131620',
              lineHeight: 1
            }}
          >
            {status.pendingCount}
          </span>
        )}
      </button>

      {/* 클릭 시 나타나는 상세 팝오버 */}
      {popoverOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: '240px',
            background: '#131620',
            border: '1.5px solid rgba(59, 130, 246, 0.35)',
            borderRadius: '12px',
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.8)',
            padding: '12px',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            fontFamily: '"Pretendard", "Apple SD Gothic Neo", sans-serif'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#ffffff' }}>
              📡 오프라인 동기화 상태
            </span>
            <button
              type="button"
              onClick={() => setPopoverOpen(false)}
              style={{
                background: 'none',
                border: 'none',
                color: '#64748b',
                fontSize: '14px',
                cursor: 'pointer'
              }}
            >
              ✕
            </button>
          </div>

          <div
            style={{
              padding: '8px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.04)',
              fontSize: '11.5px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>네트워크 연결:</span>
              <span style={{ fontWeight: 700, color: status.isOnline ? '#34d399' : '#f87171' }}>
                {status.isOnline ? '연결됨 (Online)' : '끊김 (Offline)'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>전송 대기 과제:</span>
              <span style={{ fontWeight: 700, color: status.pendingCount > 0 ? '#60a5fa' : '#94a3b8' }}>
                {status.pendingCount}건
              </span>
            </div>
          </div>

          <p style={{ margin: 0, fontSize: '11px', color: '#64748b', lineHeight: 1.4 }}>
            {!status.isOnline
              ? '💡 와이파이가 끊겨도 필기는 안전하게 기기에 저장되며, 다시 연결되면 선생님께 자동으로 제출됩니다.'
              : isAllGood
              ? '✨ 모든 필기 데이터가 실시간으로 안전하게 동기화되어 있습니다.'
              : '인터넷 연결이 확인되면 대기 중인 과제를 자동으로 제출합니다.'}
          </p>

          {status.pendingCount > 0 && (
            <button
              type="button"
              disabled={!status.isOnline || status.isSyncing}
              onClick={handleManualSync}
              style={{
                marginTop: '4px',
                background: status.isOnline && !status.isSyncing ? '#2563eb' : '#334155',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 10px',
                fontSize: '11.5px',
                fontWeight: 700,
                cursor: status.isOnline && !status.isSyncing ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px'
              }}
            >
              {status.isSyncing ? '전송 중...' : '지금 바로 전송 시도'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * VersionUpdateOverlay.tsx
 * ============================================================================
 * 최신 버전 감지 시 자동 업데이트 진행 상태를 안내하는 전체화면 오버레이
 * ============================================================================
 */

import React from 'react';
import { createPortal } from 'react-dom';

export interface VersionUpdateOverlayProps {
  isOpen: boolean;
  newVersionTime?: string;
}

export const VersionUpdateOverlay: React.FC<VersionUpdateOverlayProps> = ({
  isOpen,
  newVersionTime
}) => {
  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 11000,
        background: 'rgba(5, 7, 12, 0.94)',
        backdropFilter: 'blur(16px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        fontFamily: '"Pretendard", "Apple SD Gothic Neo", sans-serif'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '400px',
          background: '#131826',
          borderRadius: '24px',
          border: '1.5px solid #38bdf8',
          boxShadow: '0 25px 70px rgba(0, 0, 0, 0.95), 0 0 40px rgba(56, 189, 248, 0.35)',
          padding: '28px 24px',
          textAlign: 'center',
          color: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}
      >
        {/* 회전 로딩 아이콘 */}
        <div
          style={{
            fontSize: '44px',
            marginBottom: '16px',
            animation: 'spin 1.5s infinite linear'
          }}
        >
          🔄
        </div>

        <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 800, color: '#ffffff' }}>
          최신 버전으로 자동 업데이트 중...
        </h3>

        {newVersionTime && (
          <div
            style={{
              background: 'rgba(56, 189, 248, 0.15)',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              borderRadius: '12px',
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 700,
              color: '#38bdf8',
              marginBottom: '14px'
            }}
          >
            배포 일시: {newVersionTime}
          </div>
        )}

        <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', lineHeight: 1.5 }}>
          새로 수정된 기능과 안정화 패치를 적용하고 있습니다.<br />
          잠시 후 화면이 자동으로 새로고침됩니다.
        </p>

        {/* 진행 바 게이지 */}
        <div
          style={{
            width: '100%',
            height: '4px',
            background: 'rgba(255, 255, 255, 0.1)',
            borderRadius: '2px',
            marginTop: '20px',
            overflow: 'hidden',
            position: 'relative'
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              bottom: 0,
              width: '100%',
              background: 'linear-gradient(90deg, #38bdf8, #818cf8)',
              animation: 'updateProgress 1.2s infinite ease-in-out'
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes updateProgress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>,
    document.body
  );
};

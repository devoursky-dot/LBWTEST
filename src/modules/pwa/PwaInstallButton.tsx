/**
 * PwaInstallButton.tsx
 * ============================================================================
 * 태블릿 홈 화면에 학생필기앱 설치를 돕는 원터치 배지/버튼
 * 
 * - 이미 PWA로 설치되어 실행 중(Standalone)일 때는 완전히 자동 숨김
 * - 브라우저 탭에서 실행 중일 때만 세련된 배지로 노출
 * ============================================================================
 */

import React, { useState } from 'react';
import { usePwaInstall } from './usePwaInstall';

export interface PwaInstallButtonProps {
  style?: React.CSSProperties;
  className?: string;
}

export const PwaInstallButton: React.FC<PwaInstallButtonProps> = ({ style, className }) => {
  const { isStandalone, canInstall, isIos, promptInstall } = usePwaInstall();
  const [showIosTooltip, setShowIosTooltip] = useState(false);

  // 이미 독립형 앱으로 실행 중이면 버튼을 표시하지 않음 (공간 절약)
  if (isStandalone) return null;

  const handleClick = async () => {
    if (isIos) {
      setShowIosTooltip(prev => !prev);
      return;
    }

    const installed = await promptInstall();
    if (!installed && !canInstall) {
      alert('브라우저 메뉴(⋮)에서 [앱 설치] 또는 [홈 화면에 추가]를 선택해주세요.');
    }
  };

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        type="button"
        onClick={handleClick}
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          padding: '4px 9px',
          borderRadius: '14px',
          border: '1px solid rgba(56, 189, 248, 0.45)',
          background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.2) 0%, rgba(37, 99, 235, 0.25) 100%)',
          color: '#38bdf8',
          fontSize: '11.5px',
          fontWeight: 700,
          cursor: 'pointer',
          backdropFilter: 'blur(4px)',
          boxShadow: '0 2px 8px rgba(14, 165, 233, 0.2)',
          transition: 'all 0.15s ease',
          userSelect: 'none',
          ...style
        }}
        title="학생 태블릿 홈 화면에 앱으로 설치하여 전체화면으로 사용"
      >
        <span>📲</span>
        <span>앱 설치</span>
      </button>

      {/* iOS 사파리 안내 팝오버 */}
      {showIosTooltip && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: '260px',
            background: '#131826',
            border: '1.5px solid #38bdf8',
            borderRadius: '12px',
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.85)',
            padding: '12px',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            fontFamily: '"Pretendard", "Apple SD Gothic Neo", sans-serif'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '13px', fontWeight: 800, color: '#ffffff' }}>
              📲 아이패드 홈 화면에 추가
            </span>
            <button
              type="button"
              onClick={() => setShowIosTooltip(false)}
              style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '14px', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
          <p style={{ margin: 0, fontSize: '12px', color: '#cbd5e1', lineHeight: 1.5 }}>
            사파리 하단(또는 상단)의 <strong>공유 버튼(⎋ / [↑])</strong>을 누른 후, <strong>[홈 화면에 추가]</strong>를 누르시면 주소창 없는 전체화면 앱으로 실행됩니다.
          </p>
        </div>
      )}
    </div>
  );
};

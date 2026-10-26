/**
 * FullscreenButton.tsx
 * ============================================================================
 * 깔끔한 전체화면 토글 버튼 컴포넌트
 * ============================================================================
 */

import React from 'react';
import { useFullscreen } from './useFullscreen';

export interface FullscreenButtonProps {
  style?: React.CSSProperties;
  className?: string;
}

export const FullscreenButton: React.FC<FullscreenButtonProps> = ({ style, className }) => {
  const { isFullscreen, isSupported, toggleFullscreen } = useFullscreen();

  if (!isSupported) return null;

  return (
    <button
      type="button"
      onClick={toggleFullscreen}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '5px 8px',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        background: isFullscreen ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.06)',
        color: isFullscreen ? '#60a5fa' : '#cbd5e1',
        fontSize: '12px',
        fontWeight: 700,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        ...style
      }}
      title={isFullscreen ? '전체화면 종료 (ESC)' : '전체화면으로 보기'}
    >
      <span>{isFullscreen ? '🗗' : '⛶'}</span>
      <span style={{ marginLeft: '4px' }}>{isFullscreen ? '창모드' : '전체화면'}</span>
    </button>
  );
};

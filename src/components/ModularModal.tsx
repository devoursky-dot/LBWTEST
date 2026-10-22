/**
 * ModularModal.tsx
 * ============================================================================
 * 앱 전역 모듈형 모달 컴포넌트
 * 
 * 1. createPortal을 사용하여 부모(캔버스/앱 컨테이너)의 touch-action: none 영향 원천 차단
 * 2. 태블릿/스마트폰 터치스크린 전용 다이렉트 터치 드래그 스크롤 엔진 내장
 * 3. 뷰포트 높이 초과 시 상단 헤더 sticky 고정 & 본체 부드러운 스크롤
 * 4. 가상 키보드 가림 방지 및 모달 바닥 안전 패딩 확보
 * ============================================================================
 */

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { bindDirectTouchScroll } from '../lib/scrollModule';

export interface ModularModalProps {
  isOpen: boolean;
  onClose?: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: string;
  zIndex?: number;
  showCloseButton?: boolean;
  className?: string;
}

export const ModularModal: React.FC<ModularModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = '460px',
  zIndex = 10001,
  showCloseButton = true,
  className = ''
}) => {
  const modalBoxRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);

  // 태블릿 터치 드래그 스크롤 바인딩
  useEffect(() => {
    if (!isOpen) return;

    const modalBox = modalBoxRef.current;
    if (!modalBox) return;

    // 모달 박스 내부 터치 드래그 스크롤 활성화
    const unbindBox = bindDirectTouchScroll(modalBox, { direction: 'y' });

    // 배경 백드롭 터치 드래그 스크롤 활성화
    const backdrop = backdropRef.current;
    let unbindBackdrop = () => {};
    if (backdrop) {
      unbindBackdrop = bindDirectTouchScroll(backdrop, { direction: 'y' });
    }

    // ESC 키로 닫기
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      unbindBox();
      unbindBackdrop();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  const content = (
    <div
      ref={backdropRef}
      className={`modal-backdrop ${className}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) {
          onClose();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex,
        background: 'rgba(5, 7, 12, 0.78)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'max(16px, env(safe-area-inset-top, 16px)) 14px max(24px, env(safe-area-inset-bottom, 24px)) 14px',
        boxSizing: 'border-box',
        overflowY: 'auto',
        overflowX: 'hidden',
        touchAction: 'pan-y',
        WebkitOverflowScrolling: 'touch'
      }}
    >
      <div
        ref={modalBoxRef}
        className="modal-box"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth,
          maxHeight: 'min(calc(100dvh - 36px), 88vh)',
          background: '#1a1d26',
          border: '1px solid rgba(255, 255, 255, 0.16)',
          borderRadius: '20px',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.08)',
          display: 'flex',
          flexDirection: 'column',
          color: '#ffffff',
          boxSizing: 'border-box',
          margin: 'auto 0',
          overflowY: 'auto',
          overflowX: 'hidden',
          touchAction: 'pan-y',
          WebkitOverflowScrolling: 'touch',
          userSelect: 'auto',
          WebkitUserSelect: 'auto'
        }}
      >
        {/* 상단 고정 헤더 (제목이 있는 경우) */}
        {(title || showCloseButton) && (
          <div
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 10,
              background: '#1a1d26',
              padding: '20px 24px 14px 24px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px'
            }}
          >
            <div>
              {typeof title === 'string' ? (
                <h2 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: '#ffffff' }}>{title}</h2>
              ) : (
                title
              )}
              {subtitle && (
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '3px' }}>
                  {subtitle}
                </div>
              )}
            </div>
            {showCloseButton && onClose && (
              <button
                type="button"
                className="modal-close-btn"
                onClick={onClose}
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#94a3b8',
                  fontSize: '16px',
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
                title="닫기"
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* 모달 본문 (충분한 하단 여백 제공) */}
        <div style={{ padding: '20px 24px 28px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {children}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
};

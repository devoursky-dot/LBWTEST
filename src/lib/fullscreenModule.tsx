/**
 * fullscreenModule.ts
 * ============================================================================
 * 모듈화된 인앱 확인 다이얼로그 및 브라우저 Fullscreen 안전 유틸리티
 * 
 * 1. 브라우저/OS별 Fullscreen API 크로스플랫폼 안전 가드 (WebKit / Safari / Chrome)
 * 2. 전체화면을 파괴하는 브라우저 네이티브 window.confirm/alert를 100% 대체하는 인앱 다이얼로그 시스템
 * ============================================================================
 */

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * 1. 크로스플랫폼 전체화면 진입 안전 헬퍼
 */
export async function requestFullscreenSafe(targetElement?: HTMLElement | null): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  const doc = document as any;
  if (doc.fullscreenElement || doc.webkitFullscreenElement) {
    return true; // 이미 전체화면 상태
  }

  const el = (targetElement || document.documentElement) as any;

  try {
    if (typeof el.requestFullscreen === 'function') {
      await el.requestFullscreen();
      return true;
    } else if (typeof el.webkitRequestFullscreen === 'function') {
      el.webkitRequestFullscreen();
      return true;
    }
  } catch (err) {
    console.warn('[FullscreenModule] requestFullscreen 예외 (User Gesture 권한 만료 등):', err);
  }
  return false;
}

/**
 * 2. 크로스플랫폼 전체화면 해제 안전 헬퍼
 */
export async function exitFullscreenSafe(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  const doc = document as any;
  if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
    return true; // 이미 풀린 상태
  }

  try {
    if (typeof doc.exitFullscreen === 'function') {
      await doc.exitFullscreen();
      return true;
    } else if (typeof doc.webkitExitFullscreen === 'function') {
      doc.webkitExitFullscreen();
      return true;
    }
  } catch (err) {
    console.warn('[FullscreenModule] exitFullscreen 예외:', err);
  }
  return false;
}

/**
 * 3. 현재 실제 전체화면 활성 여부 확인
 */
export function checkIsFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as any;
  return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
}

/**
 * 4. 인앱 확인 다이얼로그 시스템 (useAppConfirm & AppConfirmModal)
 * 
 * 브라우저의 전체화면을 강제로 파괴하는 window.confirm()을 100% 대체합니다.
 * 비동기 Promise 패턴으로 작동하며 React DOM 포털로 렌더링되어 풀스크린이 절대 풀리지 않습니다.
 */
export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
}

export function useAppConfirm() {
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);

  const confirm = useCallback((options: ConfirmOptions | string): Promise<boolean> => {
    const normalizedOptions: ConfirmOptions = typeof options === 'string'
      ? { message: options }
      : options;

    return new Promise<boolean>((resolve) => {
      setConfirmState({
        isOpen: true,
        options: normalizedOptions,
        resolve
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    if (confirmState) {
      confirmState.resolve(true);
      setConfirmState(null);
    }
  }, [confirmState]);

  const handleCancel = useCallback(() => {
    if (confirmState) {
      confirmState.resolve(false);
      setConfirmState(null);
    }
  }, [confirmState]);

  const confirmModalElement = confirmState?.isOpen && typeof document !== 'undefined'
    ? createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.72)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            padding: '16px',
            touchAction: 'none'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCancel();
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '380px',
              backgroundColor: '#18191c',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '20px',
              padding: '24px 20px',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.1)',
              color: '#ffffff',
              textAlign: 'center',
              animation: 'fsConfirmPopIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
          >
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '14px',
              background: confirmState.options.isDanger ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.15)',
              color: confirmState.options.isDanger ? '#f87171' : '#60a5fa',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px',
              marginBottom: '14px'
            }}>
              {confirmState.options.isDanger ? '⚠️' : '💬'}
            </div>

            {confirmState.options.title && (
              <h3 style={{ fontSize: '17px', fontWeight: 700, margin: '0 0 8px 0', letterSpacing: '-0.01em' }}>
                {confirmState.options.title}
              </h3>
            )}

            <p style={{
              fontSize: '13.5px',
              color: '#cbd5e1',
              margin: '0 0 20px 0',
              lineHeight: 1.55,
              whiteSpace: 'pre-line'
            }}>
              {confirmState.options.message}
            </p>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={handleCancel}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  backgroundColor: 'rgba(255, 255, 255, 0.06)',
                  color: '#94a3b8',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {confirmState.options.cancelText || '취소'}
              </button>
              <button
                type="button"
                autoFocus
                onClick={handleConfirm}
                style={{
                  flex: 1.2,
                  padding: '12px',
                  borderRadius: '12px',
                  border: 'none',
                  backgroundColor: confirmState.options.isDanger ? '#ef4444' : '#3b82f6',
                  color: '#ffffff',
                  fontSize: '13.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: confirmState.options.isDanger
                    ? '0 4px 14px rgba(239, 68, 68, 0.4)'
                    : '0 4px 14px rgba(59, 130, 246, 0.4)'
                }}
              >
                {confirmState.options.confirmText || '확인'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  return {
    confirm,
    confirmModalElement
  };
}

/**
 * fullscreenModule.ts
 * ============================================================================
 * 앱 전역 전체화면 관리 및 자동 복구 모듈
 * 
 * 1. 브라우저/OS별 Fullscreen API 크로스플랫폼 안전 가드 (WebKit / Safari / Chrome)
 * 2. 전체화면 이탈 이벤트 자동 감지 및 사용자 터치 기반 무소음 재진입 루틴 (Zero-Hardcoding)
 * 3. 전체화면을 파괴하는 브라우저 네이티브 window.confirm/alert를 100% 대체하는 인앱 다이얼로그 시스템
 * ============================================================================
 */

import { useState, useEffect, useCallback, useRef } from 'react';
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
 * 4. 모듈화된 전체화면 관리 & 자동 복구 훅 (useFullscreenManager)
 * 
 * 특정 이벤트(파일 선택, 페이지 지우기 등)를 하드코딩하지 않고,
 * 브라우저에서 전체화면이 풀리는 모든 사건을 이벤트 기반으로 100% 자동 감지하여
 * 사용자의 다음 터치 시 무소음 전체화면 복구를 처리합니다.
 */
export function useFullscreenManager(options?: {
  enabled?: boolean;
  suspended?: boolean; // PDF 피커, 이미지 크롭 등 모달 작업 중 팝업 방해 금지
  onFullscreenChange?: (isFullscreen: boolean) => void;
}) {
  const isEnabled = options?.enabled ?? true;
  const isSuspended = options?.suspended ?? false;
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => checkIsFullscreen());
  const [showReentryPrompt, setShowReentryPrompt] = useState<boolean>(false);
  const wasEverFullscreenRef = useRef<boolean>(false);

  // 모달이 열려있는 동안은 전체화면 복구 팝업을 즉시 숨김
  useEffect(() => {
    if (isSuspended) {
      setShowReentryPrompt(false);
    }
  }, [isSuspended]);

  // 전체화면 상태 동기화 및 이탈 자동 감지 리스너
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleFsChange = () => {
      const isCurrentlyFull = checkIsFullscreen();
      setIsFullscreen(isCurrentlyFull);
      if (options?.onFullscreenChange) {
        options.onFullscreenChange(isCurrentlyFull);
      }

      if (isCurrentlyFull) {
        wasEverFullscreenRef.current = true;
        setShowReentryPrompt(false);
      } else {
        // 이전에 한 번이라도 전체화면이었는데 풀렸다면 복구 대기 상태로 전환 (단, 모달 작업 중이 아닐 때만)
        if (wasEverFullscreenRef.current && isEnabled && !isSuspended) {
          setShowReentryPrompt(true);
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);

    // [기회주의적 무소음 자동 재진입]: 모달이 닫힌 상태에서 사용자가 화면 어디든 다음 터치를 하는 순간 캡처
    const handleGlobalPointer = () => {
      if (!checkIsFullscreen() && wasEverFullscreenRef.current && isEnabled && !isSuspended) {
        requestFullscreenSafe().then((success) => {
          if (success) {
            setShowReentryPrompt(false);
          }
        });
      }
    };

    window.addEventListener('pointerdown', handleGlobalPointer, { capture: true, passive: true });

    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
      window.removeEventListener('pointerdown', handleGlobalPointer, { capture: true } as any);
    };
  }, [isEnabled, isSuspended, options]);

  const enterFullscreen = useCallback(async () => {
    const success = await requestFullscreenSafe();
    if (success) {
      wasEverFullscreenRef.current = true;
      setIsFullscreen(true);
      setShowReentryPrompt(false);
    }
    return success;
  }, []);

  const exitFullscreen = useCallback(async () => {
    wasEverFullscreenRef.current = false;
    setShowReentryPrompt(false);
    const success = await exitFullscreenSafe();
    if (success) {
      setIsFullscreen(false);
    }
    return success;
  }, []);

  const dismissPrompt = useCallback(() => {
    setShowReentryPrompt(false);
  }, []);

  return {
    isFullscreen,
    showReentryPrompt,
    enterFullscreen,
    exitFullscreen,
    dismissPrompt
  };
}

/**
 * 5. 인앱 확인 다이얼로그 시스템 (useAppConfirm & AppConfirmModal)
 * 
 * 브라우저의 전체화면을 강제로 파괴하는 window.confirm()을 100% 대체합니다.
 * 비동기 Promise 패턴으로 작동하며 React DOM 포털로 렌더링되어 풀스크린이 절대 풀리지 않습니다.
 */
interface ConfirmOptions {
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

/**
 * 6. 전체화면 자동 복귀 플로팅 가이드 오버레이 (FullscreenReentryModal)
 */
export function FullscreenReentryModal({
  isOpen,
  onReenter,
  onDismiss
}: {
  isOpen: boolean;
  onReenter: () => void;
  onDismiss?: () => void;
}) {
  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        padding: '16px',
        touchAction: 'none'
      }}
      onClick={() => {
        // 배경을 터치하더라도 전체화면으로 재진입 유도
        onReenter();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '400px',
          backgroundColor: '#111318',
          border: '1px solid rgba(255, 255, 255, 0.18)',
          borderRadius: '22px',
          padding: '28px 24px 22px 24px',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.9), 0 0 30px rgba(59, 130, 246, 0.25)',
          color: '#ffffff',
          textAlign: 'center',
          animation: 'fsConfirmPopIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          width: '56px',
          height: '56px',
          borderRadius: '16px',
          background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.25) 0%, rgba(99, 102, 241, 0.25) 100%)',
          border: '1px solid rgba(99, 102, 241, 0.35)',
          color: '#ffffff',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '28px',
          marginBottom: '16px'
        }}>
          📺
        </div>

        <h3 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 8px 0', letterSpacing: '-0.02em' }}>
          수업 필기로 복귀합니다
        </h3>

        <p style={{
          fontSize: '13px',
          color: '#94a3b8',
          margin: '0 0 22px 0',
          lineHeight: 1.6
        }}>
          외부 작업 후 주소창이 나타났습니다.<br />
          아래 버튼을 터치하시면 <strong>주소창 울렁거림 없이 쾌적한 전체화면</strong>으로 바로 복귀합니다.
        </p>

        <button
          type="button"
          autoFocus
          onClick={onReenter}
          style={{
            width: '100%',
            padding: '14px',
            borderRadius: '12px',
            border: 'none',
            background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
            color: '#ffffff',
            fontSize: '15px',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(59, 130, 246, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}
        >
          <span>🚀</span>
          <span>전체화면으로 계속하기</span>
        </button>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            style={{
              marginTop: '12px',
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              fontSize: '12px',
              cursor: 'pointer',
              padding: '4px'
            }}
          >
            창 유지하기 (창모드로 진행)
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

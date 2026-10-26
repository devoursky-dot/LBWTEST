/**
 * PwaLaunchPromptModal.tsx
 * ============================================================================
 * 학생필기앱 실행 시 최적 환경 안내 및 설치/전체화면 시작 모달
 * 
 * - 브라우저 탭으로 접속했을 때만 진입 팝업으로 노출
 * - [홈 화면에 앱 설치하기] 및 [전체화면으로 바로 시작] 원클릭 제공
 * - 이미 태블릿에 설치된 PWA(Standalone)로 실행된 경우 자동 비활성화
 * ============================================================================
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { usePwaInstall } from './usePwaInstall';

export interface PwaLaunchPromptModalProps {
  onStartFullscreen: () => void;
}

export const PwaLaunchPromptModal: React.FC<PwaLaunchPromptModalProps> = ({
  onStartFullscreen
}) => {
  const { isStandalone, canInstall, isIos, promptInstall } = usePwaInstall();
  const [isOpen, setIsOpen] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    // 1. 이미 PWA로 설치되어 실행 중(Standalone)이면 팝업을 띄우지 않음
    if (isStandalone) return;

    // 2. 세션/오늘 하루 닫기 여부 확인
    try {
      const dismissedUntil = localStorage.getItem('lbw_pwa_prompt_dismissed');
      if (dismissedUntil && Number(dismissedUntil) > Date.now()) {
        return;
      }
    } catch {}

    // 페이지 로드 후 0.6초 뒤 부드럽게 팝업 오픈
    const timer = setTimeout(() => {
      setIsOpen(true);
    }, 600);

    return () => clearTimeout(timer);
  }, [isStandalone]);

  if (!isOpen || isStandalone || typeof document === 'undefined') return null;

  const handleInstallClick = async () => {
    if (isIos) {
      setShowIosGuide(true);
      return;
    }

    const success = await promptInstall();
    if (success) {
      setIsOpen(false);
    } else if (!canInstall) {
      alert('브라우저 메뉴(⋮)에서 [앱 설치] 또는 [홈 화면에 추가]를 선택해주세요.');
    }
  };

  const handleStartFullscreen = () => {
    setIsOpen(false);
    onStartFullscreen();
  };

  const handleDismissToday = () => {
    try {
      // 24시간 동안 다시 보지 않기
      localStorage.setItem('lbw_pwa_prompt_dismissed', String(Date.now() + 24 * 60 * 60 * 1000));
    } catch {}
    setIsOpen(false);
  };

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10999,
        background: 'rgba(5, 7, 12, 0.82)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        fontFamily: '"Pretendard", "Apple SD Gothic Neo", sans-serif'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) setIsOpen(false);
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          background: '#131622',
          borderRadius: '24px',
          border: '1.5px solid rgba(56, 189, 248, 0.45)',
          boxShadow: '0 25px 70px rgba(0, 0, 0, 0.95), 0 0 40px rgba(37, 99, 235, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: '24px 20px',
          textAlign: 'center',
          color: '#ffffff',
          position: 'relative'
        }}
      >
        {/* 우측 상단 닫기 버튼 */}
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          style={{
            position: 'absolute',
            top: '14px',
            right: '14px',
            background: 'none',
            border: 'none',
            color: '#94a3b8',
            fontSize: '18px',
            cursor: 'pointer',
            padding: '4px 8px'
          }}
          title="닫기"
        >
          ✕
        </button>

        {/* 상단 앱 로고 아이콘 */}
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '18px',
            background: 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
            margin: '0 auto 16px auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '32px',
            boxShadow: '0 8px 24px rgba(37, 99, 235, 0.45)'
          }}
        >
          📱
        </div>

        <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 800, color: '#ffffff' }}>
          학생필기앱 최적화 실행
        </h3>
        <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#94a3b8', lineHeight: 1.5 }}>
          태블릿 홈 화면에 앱으로 설치하시면 브라우저 주소창 없이 시원하고 넓은 <strong>전체화면</strong>으로 필기할 수 있습니다.
        </p>

        {/* iOS 사파리 가이드 메시지 */}
        {showIosGuide && (
          <div
            style={{
              background: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              borderRadius: '12px',
              padding: '10px 14px',
              marginBottom: '16px',
              textAlign: 'left',
              fontSize: '12px',
              color: '#bae6fd',
              lineHeight: 1.5
            }}
          >
            📌 <strong>아이패드 설치 방법:</strong><br />
            사파리 브라우저의 <strong>공유 버튼(□↑)</strong>을 누른 후, <strong>[홈 화면에 추가]</strong>를 누르시면 전용 앱으로 등록됩니다!
          </div>
        )}

        {/* 액션 버튼 그룹 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* 1. 홈 화면에 앱 설치하기 버튼 */}
          <button
            type="button"
            onClick={handleInstallClick}
            style={{
              width: '100%',
              padding: '13px',
              borderRadius: '14px',
              border: 'none',
              background: 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
              color: '#ffffff',
              fontSize: '14.5px',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 4px 18px rgba(37, 99, 235, 0.45)'
            }}
          >
            <span>📲</span>
            <span>홈 화면에 앱으로 설치하기</span>
          </button>

          {/* 2. 전체화면으로 바로 시작 버튼 */}
          <button
            type="button"
            onClick={handleStartFullscreen}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '14px',
              border: '1.5px solid rgba(255, 255, 255, 0.18)',
              background: 'rgba(255, 255, 255, 0.08)',
              color: '#ffffff',
              fontSize: '13.5px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            <span>▶</span>
            <span>전체화면으로 바로 시작</span>
          </button>
        </div>

        {/* 하단 오늘 하루 보지 않기 */}
        <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <button
            type="button"
            onClick={handleDismissToday}
            style={{
              background: 'none',
              border: 'none',
              color: '#64748b',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            오늘 하루 이 안내 보지 않기
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

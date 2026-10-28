/**
 * QrScannerModal.tsx
 * ============================================================================
 * 카메라 기반 전자칠판 수업 QR 코드 스캐너 모달
 * 
 * - 태블릿 후면(환경) 카메라 우선 활성화 및 전/후면 전환 지원
 * - 뷰파인더 가이드 박스 및 실시간 스캔 애니메이션
 * - QR 코드 인식 즉시 성공 콜백 발행
 * ============================================================================
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { decodeQrFromImageData } from './qrDecoder';

export interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (scannedText: string) => void;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  // 카메라 정지
  const stopCamera = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraReady(false);
    setIsScanning(false);
  }, []);

  // 카메라 시작
  const startCamera = useCallback(async (mode: 'environment' | 'user') => {
    stopCamera();
    setErrorMessage(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('이 기기나 브라우저에서는 카메라를 사용할 수 없습니다.');
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
        setIsCameraReady(true);
        setIsScanning(true);
      }
    } catch (err: any) {
      console.error('[QrScanner] 카메라 접근 오류:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMessage('카메라 접근 권한이 거부되었습니다. 브라우저 설정에서 카메라 권한을 허용해주세요.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setErrorMessage('기기에 사용 가능한 카메라를 찾을 수 없습니다.');
      } else {
        setErrorMessage('카메라를 실행하는 중 오류가 발생했습니다: ' + (err.message || '알 수 없는 오류'));
      }
    }
  }, [stopCamera]);

  // 프레임 루프 스캔
  useEffect(() => {
    if (!isScanning || !isCameraReady) return;

    let isDone = false;

    const scanFrame = async () => {
      if (isDone) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          try {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const decoded = await decodeQrFromImageData(imageData, video);

            if (decoded) {
              isDone = true;
              stopCamera();
              onScanSuccess(decoded);
              return;
            }
          } catch {
            // 프레임 스캔 실패 시 다음 프레임 계속
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(scanFrame);
    };

    animFrameRef.current = requestAnimationFrame(scanFrame);

    return () => {
      isDone = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isScanning, isCameraReady, onScanSuccess, stopCamera]);

  // 모달 열림/닫힘 감지
  useEffect(() => {
    if (isOpen) {
      startCamera(facingMode);
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [isOpen, facingMode, startCamera, stopCamera]);

  // 전/후면 카메라 전환
  const handleToggleFacingMode = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    startCamera(nextMode);
  };

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10600,
        background: 'rgba(5, 7, 12, 0.92)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        fontFamily: '"Pretendard", "Apple SD Gothic Neo", sans-serif'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          background: '#131622',
          borderRadius: '20px',
          border: '1.5px solid rgba(56, 189, 248, 0.4)',
          boxShadow: '0 25px 70px rgba(0, 0, 0, 0.9)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* 상단 헤더 */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.6) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '22px' }}>📷</span>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#ffffff' }}>
              전자칠판 QR코드 스캔
            </h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: '20px',
              cursor: 'pointer',
              padding: '4px 8px'
            }}
          >
            ✕
          </button>
        </div>

        {/* 카메라 비디오 뷰파인더 본문 */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '360px',
            background: '#000000',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {/* 실제 웹캠 비디오 */}
          <video
            ref={videoRef}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover'
            }}
            playsInline
            muted
          />

          {/* 오프스크린 캡처 캔버스 (숨김) */}
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {/* 뷰파인더 사각 프레임 가이드 */}
          {isCameraReady && (
            <div
              style={{
                position: 'absolute',
                width: '240px',
                height: '240px',
                border: '2px solid rgba(56, 189, 248, 0.8)',
                borderRadius: '16px',
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
                pointerEvents: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {/* 4개 코너 장식 */}
              <div style={{ position: 'absolute', top: '-2px', left: '-2px', width: '20px', height: '20px', borderTop: '4px solid #38bdf8', borderLeft: '4px solid #38bdf8', borderTopLeftRadius: '16px' }} />
              <div style={{ position: 'absolute', top: '-2px', right: '-2px', width: '20px', height: '20px', borderTop: '4px solid #38bdf8', borderRight: '4px solid #38bdf8', borderTopRightRadius: '16px' }} />
              <div style={{ position: 'absolute', bottom: '-2px', left: '-2px', width: '20px', height: '20px', borderBottom: '4px solid #38bdf8', borderLeft: '4px solid #38bdf8', borderBottomLeftRadius: '16px' }} />
              <div style={{ position: 'absolute', bottom: '-2px', right: '-2px', width: '20px', height: '20px', borderBottom: '4px solid #38bdf8', borderRight: '4px solid #38bdf8', borderBottomRightRadius: '16px' }} />

              {/* 스캐닝 레이저 가이드 라인 */}
              <div
                style={{
                  width: '90%',
                  height: '2px',
                  background: 'linear-gradient(90deg, transparent, #38bdf8, transparent)',
                  boxShadow: '0 0 8px #38bdf8',
                  animation: 'qrScanLaser 2s infinite ease-in-out'
                }}
              />
            </div>
          )}

          {/* 카메라 준비 중 로딩 스피너 */}
          {!isCameraReady && !errorMessage && (
            <div style={{ position: 'absolute', textAlign: 'center', color: '#60a5fa' }}>
              <div style={{ fontSize: '36px' }}>⏳</div>
              <p style={{ marginTop: '10px', fontSize: '13px', fontWeight: 600 }}>
                카메라를 준비하고 있습니다...
              </p>
            </div>
          )}

          {/* 에러 메시지 표시 */}
          {errorMessage && (
            <div
              style={{
                position: 'absolute',
                padding: '20px',
                textAlign: 'center',
                color: '#f87171',
                background: 'rgba(15, 23, 42, 0.95)',
                margin: '16px',
                borderRadius: '12px',
                border: '1px solid #ef4444'
              }}
            >
              <div style={{ fontSize: '32px' }}>⚠️</div>
              <p style={{ marginTop: '8px', fontSize: '13px', lineHeight: 1.5 }}>
                {errorMessage}
              </p>
            </div>
          )}
        </div>

        {/* 하단 제어 및 안내 바 */}
        <div
          style={{
            padding: '14px 18px',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'rgba(15, 23, 42, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px'
          }}
        >
          <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8', lineHeight: 1.4 }}>
            💡 칠판의 QR코드를 화면 중앙 사각형 안에 비춰주세요.
          </p>

          <button
            type="button"
            onClick={handleToggleFacingMode}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              background: 'rgba(255, 255, 255, 0.08)',
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              flexShrink: 0
            }}
            title="카메라 방향 전환"
          >
            <span>🔄</span>
            <span>{facingMode === 'environment' ? '전면 카메라' : '후면 카메라'}</span>
          </button>
        </div>
      </div>

      <style>{`
        @keyframes qrScanLaser {
          0% { transform: translateY(-90px); opacity: 0.2; }
          50% { transform: translateY(90px); opacity: 1; }
          100% { transform: translateY(-90px); opacity: 0.2; }
        }
      `}</style>
    </div>,
    document.body
  );
};

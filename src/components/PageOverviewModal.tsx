/**
 * PageOverviewModal.tsx
 * ============================================================================
 * 전체 페이지 모아보기 그리드 팝업 모달
 * 
 * - 공책의 모든 페이지(1쪽~N쪽)를 반응형 카드 썸네일 그리드로 한눈에 표시
 * - 페이지 수가 많아져도 절대 겹치거나 깨지지 않는 완벽한 CSS Grid & Aspect Ratio 구조
 * - 원하는 페이지 터치 시 0.01초 즉시 해당 쪽으로 이동
 * - 새 쪽 추가 및 불필요한 쪽 삭제 기능 내장
 * ============================================================================
 */

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { drawSingleStroke } from '../lib/drawingGeometry';

export interface PageOverviewItem {
  id: string;
  strokes?: any[];
  textItems?: any[];
  fullPageBackground?: string | null;
  images?: any[];
}

export interface PageOverviewModalProps {
  isOpen: boolean;
  pages: PageOverviewItem[];
  currentPageIndex: number;
  onSelectPage: (index: number) => void;
  onAddPage: () => void;
  onDeletePage: (index: number) => void;
  onClose: () => void;
}

/**
 * 필기 스트로크가 있는 페이지를 위한 고속 미니 캔버스 프리뷰
 */
const PageStrokeThumbnail: React.FC<{
  strokes?: any[];
  fullPageBackground?: string | null;
}> = ({ strokes, fullPageBackground }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (strokes && strokes.length > 0) {
      ctx.save();
      // A4 기준(약 1200x1700)에서 썸네일 해상도(140x198)로 스케일 다운
      const scale = canvas.width / 1200;
      ctx.scale(scale, scale);

      for (const s of strokes) {
        try {
          drawSingleStroke(ctx, s, false);
        } catch {}
      }
      ctx.restore();
    }
  }, [strokes]);

  return (
    <canvas
      ref={canvasRef}
      width={140}
      height={198}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        objectFit: 'contain',
        zIndex: fullPageBackground ? 2 : 1
      }}
    />
  );
};

export const PageOverviewModal: React.FC<PageOverviewModalProps> = ({
  isOpen,
  pages,
  currentPageIndex,
  onSelectPage,
  onAddPage,
  onDeletePage,
  onClose
}) => {
  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10500,
        background: 'rgba(5, 7, 12, 0.85)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '920px',
          height: '86vh',
          maxHeight: '86vh',
          background: '#11141e',
          borderRadius: '20px',
          border: '1.5px solid rgba(59, 130, 246, 0.4)',
          boxShadow: '0 25px 70px rgba(0, 0, 0, 0.95)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: '"Pretendard", "Apple SD Gothic Neo", sans-serif'
        }}
      >
        {/* 상단 헤더 */}
        <div
          style={{
            flexShrink: 0,
            padding: '14px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.6) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '24px' }}>📑</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '16.5px', fontWeight: 800, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>공책 전체 페이지 모아보기</span>
                <span
                  style={{
                    fontSize: '11.5px',
                    fontWeight: 700,
                    background: 'rgba(59, 130, 246, 0.2)',
                    color: '#60a5fa',
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                    padding: '2px 8px',
                    borderRadius: '12px'
                  }}
                >
                  총 {pages.length}쪽
                </span>
              </h3>
              <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                페이지를 터치하면 해당 쪽으로 즉시 이동합니다.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={onAddPage}
              style={{
                background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '7px 14px',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                boxShadow: '0 2px 8px rgba(37, 99, 235, 0.4)'
              }}
            >
              <span>+</span>
              <span>새 쪽 추가</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                fontSize: '20px',
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: '6px'
              }}
              title="닫기"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 메인 페이지 카드 그리드 (완벽한 반응형 및 세로 스크롤 방어) */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '20px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
            gridAutoRows: 'max-content',
            gap: '16px',
            alignContent: 'start'
          }}
        >
          {pages.map((p, idx) => {
            const isCurrent = idx === currentPageIndex;
            const strokeCount = p.strokes?.length || 0;
            const hasBackground = Boolean(p.fullPageBackground);

            return (
              <div
                key={p.id || idx}
                onClick={() => {
                  onSelectPage(idx);
                  onClose();
                }}
                style={{
                  position: 'relative',
                  width: '100%',
                  aspectRatio: '1 / 1.414',
                  minWidth: 0,
                  minHeight: 0,
                  boxSizing: 'border-box',
                  background: hasBackground ? '#ffffff' : '#181b24',
                  border: isCurrent ? '2.5px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  userSelect: 'none',
                  transition: 'transform 0.12s ease, box-shadow 0.12s ease',
                  boxShadow: isCurrent
                    ? '0 0 20px rgba(59, 130, 246, 0.5), 0 8px 16px rgba(0, 0, 0, 0.5)'
                    : '0 4px 12px rgba(0, 0, 0, 0.35)'
                }}
                title={`${idx + 1}쪽으로 이동`}
              >
                {/* 썸네일 내용 레이어 (절대좌표로 카드 내부에 100% 핏) */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: hasBackground ? '#ffffff' : '#181b24'
                  }}
                >
                  {hasBackground && (
                    <img
                      src={p.fullPageBackground!}
                      alt={`${idx + 1}쪽`}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        display: 'block',
                        background: '#ffffff',
                        zIndex: 1
                      }}
                    />
                  )}

                  {strokeCount > 0 && (
                    <PageStrokeThumbnail
                      strokes={p.strokes}
                      fullPageBackground={p.fullPageBackground}
                    />
                  )}

                  {!hasBackground && strokeCount === 0 && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#64748b'
                      }}
                    >
                      <span style={{ fontSize: '28px', opacity: 0.6 }}>📝</span>
                      <span style={{ fontSize: '11px', marginTop: '4px', fontWeight: 600 }}>
                        빈 쪽
                      </span>
                    </div>
                  )}
                </div>

                {/* 쪽수 배지 (좌측 상단) */}
                <div
                  style={{
                    position: 'absolute',
                    top: '6px',
                    left: '6px',
                    background: 'rgba(15, 23, 42, 0.88)',
                    backdropFilter: 'blur(4px)',
                    color: isCurrent ? '#38bdf8' : '#ffffff',
                    padding: '2px 7px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 800,
                    border: isCurrent ? '1px solid rgba(56, 189, 248, 0.6)' : '1px solid rgba(255, 255, 255, 0.2)',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
                    zIndex: 10
                  }}
                >
                  {idx + 1}쪽
                </div>

                {/* 현재 보는 쪽 배지 (우측 상단) */}
                {isCurrent && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '6px',
                      right: '6px',
                      background: '#2563eb',
                      color: '#ffffff',
                      padding: '2px 6px',
                      borderRadius: '5px',
                      fontSize: '10px',
                      fontWeight: 800,
                      boxShadow: '0 2px 6px rgba(37, 99, 235, 0.5)',
                      zIndex: 10
                    }}
                  >
                    현재 쪽
                  </div>
                )}

                {/* 하단 쪽 삭제 버튼 (2쪽 이상일 때만 표시, 카드 우측 하단 컴팩트 배치) */}
                {pages.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeletePage(idx);
                    }}
                    style={{
                      position: 'absolute',
                      bottom: '6px',
                      right: '6px',
                      background: 'rgba(239, 68, 68, 0.9)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '3px 6px',
                      fontSize: '10.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      zIndex: 10,
                      boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '2px'
                    }}
                    title={`${idx + 1}쪽 삭제`}
                  >
                    <span>🗑️</span>
                    <span>삭제</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
};

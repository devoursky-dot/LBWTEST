/**
 * PageOverviewModal.tsx
 * ============================================================================
 * 전체 페이지 모아보기 그리드 팝업 모달
 * 
 * - 공책의 모든 페이지(1쪽~N쪽)를 작은 카드 썸네일 그리드로 한눈에 표시
 * - 원하는 페이지 터치 시 0.01초 즉시 해당 쪽으로 이동
 * - 새 쪽 추가 및 불필요한 쪽 삭제 기능 내장
 * ============================================================================
 */

import React from 'react';
import { createPortal } from 'react-dom';

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
          maxWidth: '880px',
          maxHeight: '90vh',
          background: '#131620',
          borderRadius: '18px',
          border: '1.5px solid rgba(59, 130, 246, 0.35)',
          boxShadow: '0 25px 70px rgba(0, 0, 0, 0.9)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: '"Pretendard", "Apple SD Gothic Neo", sans-serif'
        }}
      >
        {/* 상단 헤더 */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.5) 0%, rgba(15, 23, 42, 0.5) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap'
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

        {/* 메인 페이지 카드 그리드 */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: '16px'
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
                  aspectRatio: '1 / 1.414',
                  background: hasBackground ? '#ffffff' : '#181b24',
                  border: isCurrent ? '3px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.16)',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  userSelect: 'none',
                  transition: 'transform 0.12s ease, box-shadow 0.12s ease',
                  boxShadow: isCurrent
                    ? '0 0 24px rgba(59, 130, 246, 0.6), 0 8px 16px rgba(0, 0, 0, 0.5)'
                    : '0 4px 14px rgba(0, 0, 0, 0.35)',
                  display: 'flex',
                  flexDirection: 'column'
                }}
                title={`${idx + 1}쪽으로 이동`}
              >
                {/* 썸네일 콘텐츠 */}
                {hasBackground ? (
                  <img
                    src={p.fullPageBackground!}
                    alt={`${idx + 1}쪽`}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      display: 'block',
                      background: '#ffffff'
                    }}
                  />
                ) : (
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '12px',
                      color: '#94a3b8'
                    }}
                  >
                    <span style={{ fontSize: '30px', opacity: 0.7 }}>📝</span>
                    <span style={{ fontSize: '11px', marginTop: '6px', color: '#64748b' }}>
                      {strokeCount > 0 ? `${strokeCount}개 필기` : '빈 쪽'}
                    </span>
                  </div>
                )}

                {/* 쪽수 배지 (좌측 상단) */}
                <div
                  style={{
                    position: 'absolute',
                    top: '6px',
                    left: '6px',
                    background: 'rgba(15, 23, 42, 0.88)',
                    backdropFilter: 'blur(4px)',
                    color: isCurrent ? '#38bdf8' : '#ffffff',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    fontSize: '11.5px',
                    fontWeight: 800,
                    border: isCurrent ? '1px solid rgba(56, 189, 248, 0.6)' : '1px solid rgba(255, 255, 255, 0.2)',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
                    zIndex: 3
                  }}
                >
                  {idx + 1}쪽
                </div>

                {/* 현재 보는 쪽 배지 */}
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
                      zIndex: 3
                    }}
                  >
                    현재 쪽
                  </div>
                )}

                {/* 하단 쪽 삭제 버튼 (2쪽 이상일 때만 표시) */}
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
                      background: 'rgba(239, 68, 68, 0.85)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '5px',
                      padding: '3px 7px',
                      fontSize: '10.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      zIndex: 4,
                      boxShadow: '0 2px 6px rgba(0,0,0,0.4)'
                    }}
                    title={`${idx + 1}쪽 삭제`}
                  >
                    🗑️ 삭제
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

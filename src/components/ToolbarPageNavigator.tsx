/**
 * ToolbarPageNavigator.tsx
 * ============================================================================
 * 메인 툴바용 컴팩트 일체형 페이지 내비게이션 위젯 (삼성노트 / 굿노트 스타일)
 * 
 * - 가로 폭 최소화(약 105px)로 툴바 가로 공간 오버플로우 방지
 * - [◀] [ 1 / N 쪽 ] [▶] 세그먼트 알약 캡슐 구조
 * - 중앙 쪽수([ 1 / N 쪽 ]) 터치 시 전체 페이지 썸네일 그리드 모달 즉시 오픈
 * - [+] 원터치 새 쪽 추가 버튼
 * - 엄격한 모듈화로 어떤 툴바에든 독립적으로 플러그인 가능
 * ============================================================================
 */

import React from 'react';

export interface ToolbarPageNavigatorProps {
  currentPageIndex: number;
  totalPages: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  onOpenOverview: () => void;
  onAddPage: () => void;
}

export const ToolbarPageNavigator: React.FC<ToolbarPageNavigatorProps> = ({
  currentPageIndex,
  totalPages,
  onPrevPage,
  onNextPage,
  onOpenOverview,
  onAddPage
}) => {
  const isFirst = currentPageIndex <= 0;
  const isLast = currentPageIndex >= totalPages - 1;

  return (
    <div
      id="toolbar-page-navigator-module"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        flexShrink: 0
      }}
    >
      {/* 1. 컴팩트 세그먼트 캡슐 [ ◀ | 1 / N 쪽 | ▶ ] */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: '34px',
          background: 'rgba(255, 255, 255, 0.06)',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          borderRadius: '8px',
          overflow: 'hidden',
          padding: '0 2px'
        }}
      >
        {/* 이전 쪽 버튼 */}
        <button
          type="button"
          id="btn-nav-prev-page"
          disabled={isFirst}
          onClick={(e) => {
            e.stopPropagation();
            onPrevPage();
          }}
          style={{
            width: '26px',
            height: '28px',
            border: 'none',
            background: 'transparent',
            color: isFirst ? 'rgba(255, 255, 255, 0.2)' : '#cbd5e1',
            cursor: isFirst ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            borderRadius: '5px',
            fontSize: '11px',
            transition: 'background 0.12s ease'
          }}
          title={isFirst ? '첫 번째 페이지입니다' : '이전 쪽 (◀)'}
        >
          ◀
        </button>

        {/* 중앙 쪽수 버튼: 클릭 시 썸네일 모아보기 모달 즉시 오픈 */}
        <button
          type="button"
          id="btn-nav-page-overview"
          onClick={(e) => {
            e.stopPropagation();
            onOpenOverview();
          }}
          style={{
            height: '28px',
            padding: '0 8px',
            border: 'none',
            background: 'rgba(59, 130, 246, 0.15)',
            color: '#93c5fd',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 700,
            letterSpacing: '0.2px',
            transition: 'all 0.12s ease',
            whiteSpace: 'nowrap'
          }}
          title="클릭하여 공책 전체 페이지 모아보기 및 빠른 이동"
        >
          <span style={{ color: '#ffffff' }}>{currentPageIndex + 1}</span>
          <span style={{ color: '#64748b', fontSize: '11px' }}>/</span>
          <span style={{ color: '#94a3b8' }}>{totalPages}</span>
          <span style={{ fontSize: '10px', color: '#60a5fa', marginLeft: '1px' }}>쪽</span>
        </button>

        {/* 다음 쪽 버튼 */}
        <button
          type="button"
          id="btn-nav-next-page"
          disabled={isLast}
          onClick={(e) => {
            e.stopPropagation();
            onNextPage();
          }}
          style={{
            width: '26px',
            height: '28px',
            border: 'none',
            background: 'transparent',
            color: isLast ? 'rgba(255, 255, 255, 0.2)' : '#cbd5e1',
            cursor: isLast ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            borderRadius: '5px',
            fontSize: '11px',
            transition: 'background 0.12s ease'
          }}
          title={isLast ? '마지막 페이지입니다' : '다음 쪽 (▶)'}
        >
          ▶
        </button>
      </div>

      {/* 2. 원터치 새 쪽 추가 [+] 버튼 */}
      <button
        type="button"
        id="btn-nav-add-page"
        onClick={(e) => {
          e.stopPropagation();
          onAddPage();
        }}
        style={{
          width: '34px',
          height: '34px',
          padding: 0,
          borderRadius: '8px',
          border: '1px solid rgba(59, 130, 246, 0.45)',
          background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.22) 0%, rgba(59, 130, 246, 0.15) 100%)',
          color: '#60a5fa',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '16px',
          fontWeight: 700,
          transition: 'all 0.12s ease'
        }}
        title="새 쪽 추가 (+)"
      >
        +
      </button>
    </div>
  );
};

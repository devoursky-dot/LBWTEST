import React, { useState, useEffect } from 'react';

export interface PdfThumbnail {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
}

interface PdfPagePickerModalProps {
  isOpen: boolean;
  fileName: string;
  thumbnails: PdfThumbnail[];
  totalPages?: number;
  isLoading: boolean;
  onSelectPage: (pageNumber: number, mode: 'full_page' | 'crop') => void;
  onClose: () => void;
}

export const PdfPagePickerModal: React.FC<PdfPagePickerModalProps> = ({
  isOpen,
  fileName,
  thumbnails,
  totalPages = 0,
  isLoading,
  onSelectPage,
  onClose
}) => {
  const [selectedPage, setSelectedPage] = useState<number>(1);

  // 모달이 열릴 때 기본 선택 페이지를 1쪽으로 초기화
  useEffect(() => {
    if (isOpen) {
      setSelectedPage(1);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const totalPageCount = Math.max(totalPages, thumbnails.length, 1);
  const pageNumbers = Array.from({ length: totalPageCount }, (_, i) => i + 1);
  const thumbMap = new Map(thumbnails.map(t => [t.pageNumber, t]));

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
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
          maxWidth: '740px',
          maxHeight: '90vh',
          background: '#181a20',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.8)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* 헤더 */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(255, 255, 255, 0.03)'
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>📑</span> PDF 학습지 페이지 선택
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94a3b8' }}>
              {fileName} (총 {totalPageCount}쪽 / 썸네일 {thumbnails.length}개 로딩됨)
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* ⚡ 1페이지 즉시 배경 삽입 퀵 버튼 (기다림 0초) */}
            <button
              type="button"
              onClick={() => onSelectPage(1, 'full_page')}
              style={{
                background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                color: '#ffffff',
                border: '1px solid #3b82f6',
                borderRadius: '8px',
                padding: '6px 13px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                boxShadow: '0 2px 8px rgba(37, 99, 235, 0.4)'
              }}
              title="썸네일 생성을 기다리지 않고 1페이지를 즉시 현재 배경으로 삽입합니다"
            >
              <span>⚡</span> 1쪽 바로 배경 넣기
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
            >
              ✕
            </button>
          </div>
        </div>

        {/* 바디 (스트리밍 썸네일 그리드) */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}
        >
          {isLoading && thumbnails.length === 0 && totalPageCount <= 1 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px', animation: 'spin 1s infinite linear' }}>⏳</div>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>PDF 문서를 빠르게 분석하고 있습니다...</p>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: '14px'
              }}
            >
              {pageNumbers.map((pNum) => {
                const thumb = thumbMap.get(pNum);
                const isSelected = selectedPage === pNum;

                return (
                  <div
                    key={pNum}
                    onClick={() => setSelectedPage(pNum)}
                    style={{
                      cursor: 'pointer',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      border: isSelected ? '2px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.12)',
                      background: isSelected ? 'rgba(59, 130, 246, 0.12)' : '#111317',
                      boxShadow: isSelected ? '0 0 0 3px rgba(59, 130, 246, 0.35)' : 'none',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center'
                    }}
                  >
                    <div style={{ width: '100%', height: '175px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0c10', padding: '6px' }}>
                      {thumb ? (
                        <img
                          src={thumb.dataUrl}
                          alt={`Page ${pNum}`}
                          style={{
                            maxWidth: '100%',
                            maxHeight: '100%',
                            objectFit: 'contain',
                            borderRadius: '4px',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.5)'
                          }}
                        />
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', color: '#64748b' }}>
                          <span style={{ fontSize: '20px', animation: 'spin 1.2s linear infinite' }}>⏳</span>
                          <span style={{ fontSize: '11px', fontWeight: 600 }}>{pNum}쪽 생성 중...</span>
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        textAlign: 'center',
                        fontSize: '12px',
                        fontWeight: 700,
                        color: isSelected ? '#93c5fd' : '#cbd5e1',
                        background: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                        borderTop: '1px solid rgba(255, 255, 255, 0.08)'
                      }}
                    >
                      {pNum}쪽 {isSelected ? '✓ 선택됨' : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 액션 푸터 */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'rgba(255, 255, 255, 0.02)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px'
          }}
        >
          <div style={{ fontSize: '13px', color: selectedPage ? '#38bdf8' : '#94a3b8', fontWeight: 700 }}>
            {selectedPage ? `선택된 페이지: ${selectedPage}쪽` : '불러올 페이지를 선택하세요'}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              disabled={!selectedPage}
              onClick={() => {
                if (selectedPage) onSelectPage(selectedPage, 'full_page');
              }}
              style={{
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: 700,
                borderRadius: '8px',
                background: selectedPage ? '#2563eb' : 'rgba(255, 255, 255, 0.1)',
                color: selectedPage ? '#ffffff' : '#64748b',
                border: 'none',
                cursor: selectedPage ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: selectedPage ? '0 2px 10px rgba(37, 99, 235, 0.3)' : 'none'
              }}
            >
              <span>📄</span> {selectedPage}쪽 전체 배경으로 넣기
            </button>

            <button
              type="button"
              disabled={!selectedPage}
              onClick={() => {
                if (selectedPage) onSelectPage(selectedPage, 'crop');
              }}
              style={{
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: 700,
                borderRadius: '8px',
                background: selectedPage ? '#059669' : 'rgba(255, 255, 255, 0.1)',
                color: selectedPage ? '#ffffff' : '#64748b',
                border: 'none',
                cursor: selectedPage ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: selectedPage ? '0 2px 10px rgba(5, 150, 105, 0.3)' : 'none'
              }}
            >
              <span>✂️</span> {selectedPage}쪽 잘라 넣기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

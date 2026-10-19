import React, { useState } from 'react';

interface PdfThumbnail {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
}

interface PdfPagePickerModalProps {
  isOpen: boolean;
  fileName: string;
  thumbnails: PdfThumbnail[];
  isLoading: boolean;
  onSelectPage: (pageNumber: number, mode: 'full_page' | 'crop') => void;
  onClose: () => void;
}

export const PdfPagePickerModal: React.FC<PdfPagePickerModalProps> = ({
  isOpen,
  fileName,
  thumbnails,
  isLoading,
  onSelectPage,
  onClose
}) => {
  const [selectedPage, setSelectedPage] = useState<number | null>(null);

  if (!isOpen) return null;

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
          maxWidth: '720px',
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
              <span>📑</span> PDF 페이지 선택
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94a3b8' }}>
              {fileName} (총 {thumbnails.length}페이지)
            </p>
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
              padding: '4px 8px',
              borderRadius: '6px'
            }}
          >
            ✕
          </button>
        </div>

        {/* 바디 (썸네일 그리드) */}
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
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px', animation: 'spin 1s infinite linear' }}>⏳</div>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>PDF 페이지들을 고해상도로 분석하고 있습니다...</p>
            </div>
          ) : thumbnails.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
              페이지를 불러올 수 없습니다.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: '16px'
              }}
            >
              {thumbnails.map((thumb) => {
                const isSelected = selectedPage === thumb.pageNumber;
                return (
                  <div
                    key={thumb.pageNumber}
                    onClick={() => setSelectedPage(thumb.pageNumber)}
                    style={{
                      cursor: 'pointer',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      border: isSelected ? '2px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.12)',
                      background: isSelected ? 'rgba(59, 130, 246, 0.1)' : '#111317',
                      boxShadow: isSelected ? '0 0 0 3px rgba(59, 130, 246, 0.3)' : 'none',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center'
                    }}
                  >
                    <div style={{ width: '100%', height: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0c10', padding: '8px' }}>
                      <img
                        src={thumb.dataUrl}
                        alt={`Page ${thumb.pageNumber}`}
                        style={{
                          maxWidth: '100%',
                          maxHeight: '100%',
                          objectFit: 'contain',
                          borderRadius: '4px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.5)'
                        }}
                      />
                    </div>
                    <div
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        textAlign: 'center',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: isSelected ? '#93c5fd' : '#cbd5e1',
                        borderTop: '1px solid rgba(255, 255, 255, 0.08)'
                      }}
                    >
                      {thumb.pageNumber}쪽
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
          <div style={{ fontSize: '13px', color: selectedPage ? '#38bdf8' : '#94a3b8', fontWeight: 600 }}>
            {selectedPage ? `선택된 페이지: ${selectedPage}쪽` : '불러올 페이지를 클릭하세요'}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              disabled={!selectedPage}
              onClick={() => {
                if (selectedPage) onSelectPage(selectedPage, 'full_page');
              }}
              style={{
                padding: '8px 14px',
                fontSize: '13px',
                fontWeight: 600,
                borderRadius: '8px',
                background: selectedPage ? '#2563eb' : 'rgba(255, 255, 255, 0.1)',
                color: selectedPage ? '#ffffff' : '#64748b',
                border: 'none',
                cursor: selectedPage ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>📄</span> 전체 배경으로 넣기
            </button>

            <button
              type="button"
              disabled={!selectedPage}
              onClick={() => {
                if (selectedPage) onSelectPage(selectedPage, 'crop');
              }}
              style={{
                padding: '8px 14px',
                fontSize: '13px',
                fontWeight: 600,
                borderRadius: '8px',
                background: selectedPage ? '#059669' : 'rgba(255, 255, 255, 0.1)',
                color: selectedPage ? '#ffffff' : '#64748b',
                border: 'none',
                cursor: selectedPage ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>✂️</span> 특정 영역 잘라 넣기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

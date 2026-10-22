import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { renderPdfPageToDataUrl } from '../lib/pdfImporter';

export interface PdfThumbnail {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
}

export interface PdfPagePickerModalProps {
  isOpen: boolean;
  fileName: string;
  pdfDocProxy?: any;
  totalPages?: number;
  thumbnails?: PdfThumbnail[];
  isLoading?: boolean;
  fileObject?: File | null;
  downloadUrl?: string | null;
  onSelectPage: (pageNumber: number, mode: 'full_page' | 'crop') => void;
  onBatchInsertPages?: (pageNumbers: number[]) => void;
  onClose: () => void;
}

export const PdfPagePickerModal: React.FC<PdfPagePickerModalProps> = ({
  isOpen,
  fileName,
  pdfDocProxy,
  totalPages = 0,
  fileObject,
  downloadUrl,
  onSelectPage,
  onBatchInsertPages,
  onClose
}) => {
  // 총 페이지 수 계산 (0.01초 즉시 계산)
  const totalPageCount = Math.max(pdfDocProxy?.numPages || 0, totalPages, 1);
  const pageNumbers = Array.from({ length: totalPageCount }, (_, i) => i + 1);

  // 모달 상태
  const [isSelectionMode, setIsSelectionMode] = useState<boolean>(false);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());

  // 범위 지정 상태
  const [isRangeOpen, setIsRangeOpen] = useState<boolean>(false);
  const [rangeStart, setRangeStart] = useState<number>(1);
  const [rangeEnd, setRangeEnd] = useState<number>(Math.min(5, totalPageCount));

  // 단일 페이지 상세 미리보기 팝업 상태 (온디맨드)
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);

  // 롱프레스 / 더블클릭 빠른 액션 팝업
  const [quickActionPage, setQuickActionPage] = useState<number | null>(null);

  // 롱프레스 터치 감지 타이머 ref
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressTriggeredRef = useRef<boolean>(false);

  // 모달 오픈 시 초기화
  useEffect(() => {
    if (isOpen) {
      setIsSelectionMode(false);
      setSelectedPages(new Set());
      setIsRangeOpen(false);
      setPreviewPage(null);
      setPreviewDataUrl(null);
      setQuickActionPage(null);
      setRangeStart(1);
      setRangeEnd(Math.min(5, totalPageCount));
    }
  }, [isOpen, totalPageCount]);

  // 미리보기 페이지 변경 시 온디맨드 1페이지 렌더링
  useEffect(() => {
    let isCancelled = false;
    if (previewPage !== null && pdfDocProxy) {
      setIsPreviewLoading(true);
      setPreviewDataUrl(null);

      renderPdfPageToDataUrl(pdfDocProxy, previewPage, 1600)
        .then(({ dataUrl }) => {
          if (!isCancelled) {
            setPreviewDataUrl(dataUrl);
            setIsPreviewLoading(false);
          }
        })
        .catch((err) => {
          console.error('페이지 미리보기 렌더링 실패:', err);
          if (!isCancelled) setIsPreviewLoading(false);
        });
    }
    return () => {
      isCancelled = true;
    };
  }, [previewPage, pdfDocProxy]);

  if (!isOpen) return null;

  // --------------------------------------------------------------------------
  // 핸들러: 터치 / 더블클릭 / 롱프레스
  // --------------------------------------------------------------------------
  const handlePageClick = (pNum: number) => {
    if (isLongPressTriggeredRef.current) {
      isLongPressTriggeredRef.current = false;
      return;
    }

    if (isSelectionMode) {
      // 다중 선택 모드: 토글
      setSelectedPages(prev => {
        const next = new Set(prev);
        if (next.has(pNum)) next.delete(pNum);
        else next.add(pNum);
        return next;
      });
    } else {
      // 일반 모드: 단일 페이지 미리보기 팝업 열기
      setPreviewPage(pNum);
    }
  };

  const handlePageDoubleClick = (pNum: number) => {
    setQuickActionPage(pNum);
  };

  const handlePointerDown = (pNum: number) => {
    isLongPressTriggeredRef.current = false;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      isLongPressTriggeredRef.current = true;
      setQuickActionPage(pNum);
    }, 450); // 0.45초 롱탭 시 액션 메뉴
  };

  const handlePointerUp = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  // --------------------------------------------------------------------------
  // 핸들러: 원본 PDF 파일 기기 다운로드
  // --------------------------------------------------------------------------
  const handleDownloadOriginalPdf = () => {
    if (fileObject) {
      const url = URL.createObjectURL(fileObject);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || '수업자료.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else if (downloadUrl) {
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = fileName || '수업자료.pdf';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  // --------------------------------------------------------------------------
  // 핸들러: 범위 지정 일괄 생성 실행
  // --------------------------------------------------------------------------
  const handleApplyRange = () => {
    const start = Math.max(1, Math.min(rangeStart, rangeEnd));
    const end = Math.min(totalPageCount, Math.max(rangeStart, rangeEnd));
    const pagesToBatch: number[] = [];
    for (let p = start; p <= end; p++) {
      pagesToBatch.push(p);
    }
    if (onBatchInsertPages && pagesToBatch.length > 0) {
      onBatchInsertPages(pagesToBatch);
      onClose();
    }
  };

  // --------------------------------------------------------------------------
  // 핸들러: 다중 선택 일괄 생성 실행
  // --------------------------------------------------------------------------
  const handleApplySelectedBatch = () => {
    const sorted = Array.from(selectedPages).sort((a, b) => a - b);
    if (onBatchInsertPages && sorted.length > 0) {
      onBatchInsertPages(sorted);
      onClose();
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(5, 7, 12, 0.85)',
        backdropFilter: 'blur(10px)',
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
          maxWidth: '860px',
          maxHeight: '92vh',
          background: '#13161f',
          borderRadius: '18px',
          border: '1.5px solid rgba(59, 130, 246, 0.3)',
          boxShadow: '0 25px 70px rgba(0, 0, 0, 0.85)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: '"Pretendard", "Apple SD Gothic Neo", sans-serif'
        }}
      >
        {/* ====================================================================
            [1. 상단 헤더 & 핵심 도구 바]
            ==================================================================== */}
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
              <h3 style={{ margin: 0, fontSize: '16.5px', fontWeight: 700, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>{fileName || 'PDF 문서'}</span>
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
                  총 {totalPageCount}쪽
                </span>
              </h3>
              <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                💡 페이지 터치: 미리보기 | 길게누름/더블클릭: 즉시 삽입 | 다중/범위 선택 가능
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {/* 1. 다중 선택 모드 토글 */}
            <button
              type="button"
              onClick={() => {
                setIsSelectionMode(prev => !prev);
                setIsRangeOpen(false);
              }}
              style={{
                background: isSelectionMode ? '#2563eb' : 'rgba(255, 255, 255, 0.08)',
                color: isSelectionMode ? '#ffffff' : '#cbd5e1',
                border: isSelectionMode ? '1px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
              title="여러 페이지를 콕콕 선택하여 공책에 한 번에 넣습니다."
            >
              <span>☑️</span>
              <span>{isSelectionMode ? '선택 모드 해제' : '다중 선택 모드'}</span>
            </button>

            {/* 2. 페이지 범위 지정 모달 열기 */}
            <button
              type="button"
              onClick={() => {
                setIsRangeOpen(prev => !prev);
                setIsSelectionMode(false);
              }}
              style={{
                background: isRangeOpen ? '#8b5cf6' : 'rgba(255, 255, 255, 0.08)',
                color: isRangeOpen ? '#ffffff' : '#cbd5e1',
                border: isRangeOpen ? '1px solid #a855f7' : '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
              title="예: 3쪽부터 7쪽까지 특정 범위를 공책에 일괄 생성합니다."
            >
              <span>🔢</span>
              <span>범위 지정</span>
            </button>

            {/* 3. 원본 PDF 기기 파일 다운로드 */}
            {(fileObject || downloadUrl) && (
              <button
                type="button"
                onClick={handleDownloadOriginalPdf}
                style={{
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: '#6ee7b7',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  borderRadius: '8px',
                  padding: '6px 12px',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
                title="기기에 원본 PDF 파일을 파일 형태로 저장합니다."
              >
                <span>📥</span>
                <span>PDF 파일 저장</span>
              </button>
            )}

            {/* 4. 닫기 버튼 */}
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

        {/* ====================================================================
            [1-1. 범위 지정 인라인 제어 바 (열렸을 때)]
            ==================================================================== */}
        {isRangeOpen && (
          <div
            style={{
              padding: '12px 20px',
              background: 'rgba(139, 92, 246, 0.12)',
              borderBottom: '1px solid rgba(139, 92, 246, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#e2e8f0', fontWeight: 600 }}>
              <span>🔢 범위 설정:</span>
              <input
                type="number"
                min={1}
                max={totalPageCount}
                value={rangeStart}
                onChange={(e) => setRangeStart(Math.max(1, parseInt(e.target.value) || 1))}
                style={{
                  width: '60px',
                  padding: '4px 8px',
                  background: '#0f172a',
                  border: '1px solid #6366f1',
                  borderRadius: '6px',
                  color: '#ffffff',
                  fontSize: '13px',
                  textAlign: 'center',
                  fontWeight: 700
                }}
              />
              <span>쪽부터</span>
              <input
                type="number"
                min={1}
                max={totalPageCount}
                value={rangeEnd}
                onChange={(e) => setRangeEnd(Math.min(totalPageCount, parseInt(e.target.value) || 1))}
                style={{
                  width: '60px',
                  padding: '4px 8px',
                  background: '#0f172a',
                  border: '1px solid #6366f1',
                  borderRadius: '6px',
                  color: '#ffffff',
                  fontSize: '13px',
                  textAlign: 'center',
                  fontWeight: 700
                }}
              />
              <span>쪽까지 (총 {Math.max(0, Math.min(totalPageCount, rangeEnd) - Math.max(1, rangeStart) + 1)}페이지)</span>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={handleApplyRange}
                style={{
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '7px 16px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 2px 10px rgba(139, 92, 246, 0.4)'
                }}
              >
                🚀 {Math.min(rangeStart, rangeEnd)}~{Math.max(rangeStart, rangeEnd)}쪽 공책에 일괄 생성
              </button>
              <button
                type="button"
                onClick={() => setIsRangeOpen(false)}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: '#cbd5e1',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '7px 12px',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                취소
              </button>
            </div>
          </div>
        )}

        {/* ====================================================================
            [2. 메인 페이지 번호 그리드 (대기시간 0초 인덱스)]
            ==================================================================== */}
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
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(95px, 1fr))',
              gap: '12px'
            }}
          >
            {pageNumbers.map((pNum) => {
              const isChecked = selectedPages.has(pNum);

              return (
                <div
                  key={pNum}
                  onClick={() => handlePageClick(pNum)}
                  onDoubleClick={() => handlePageDoubleClick(pNum)}
                  onPointerDown={() => handlePointerDown(pNum)}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                  style={{
                    position: 'relative',
                    aspectRatio: '1 / 1.414', // A4 황금 비율
                    background: isChecked ? 'rgba(37, 99, 235, 0.25)' : '#1a1e28',
                    border: isChecked ? '2px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    userSelect: 'none',
                    transition: 'all 0.12s ease',
                    boxShadow: isChecked
                      ? '0 0 16px rgba(59, 130, 246, 0.45)'
                      : '0 4px 12px rgba(0, 0, 0, 0.3)'
                  }}
                  title={`${pNum}쪽 (탭: 미리보기 / 길게누름: 배경/자르기)`}
                >
                  {/* 다중 선택 모드 체크박스 */}
                  {isSelectionMode && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '6px',
                        left: '6px',
                        width: '20px',
                        height: '20px',
                        borderRadius: '4px',
                        background: isChecked ? '#3b82f6' : 'rgba(0, 0, 0, 0.5)',
                        border: '1.5px solid #ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        color: '#ffffff',
                        fontWeight: 900
                      }}
                    >
                      {isChecked ? '✓' : ''}
                    </div>
                  )}

                  {/* 문서 아이콘 장식 */}
                  <span style={{ fontSize: '18px', opacity: 0.5, marginBottom: '2px' }}>📄</span>

                  {/* 큼직한 페이지 번호 */}
                  <span
                    style={{
                      fontSize: '22px',
                      fontWeight: 800,
                      color: isChecked ? '#60a5fa' : '#f8fafc'
                    }}
                  >
                    {pNum}
                  </span>

                  <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, marginTop: '2px' }}>
                    PAGE
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ====================================================================
            [3. 다중 선택 모드 활성화 시 하단 제어 바]
            ==================================================================== */}
        {isSelectionMode && (
          <div
            style={{
              padding: '12px 20px',
              borderTop: '1px solid rgba(59, 130, 246, 0.3)',
              background: 'rgba(30, 41, 59, 0.8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '13.5px', color: '#93c5fd', fontWeight: 700 }}>
                선택된 페이지: 총 {selectedPages.size}쪽
              </span>
              <button
                type="button"
                onClick={() => setSelectedPages(new Set(pageNumbers))}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: '#cbd5e1',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '11.5px',
                  cursor: 'pointer'
                }}
              >
                전체 선택
              </button>
              <button
                type="button"
                onClick={() => setSelectedPages(new Set())}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: '#cbd5e1',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '11.5px',
                  cursor: 'pointer'
                }}
              >
                선택 해제
              </button>
            </div>

            <button
              type="button"
              disabled={selectedPages.size === 0}
              onClick={handleApplySelectedBatch}
              style={{
                background: selectedPages.size > 0 ? 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)' : '#334155',
                color: selectedPages.size > 0 ? '#ffffff' : '#64748b',
                border: 'none',
                borderRadius: '8px',
                padding: '8px 18px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: selectedPages.size > 0 ? 'pointer' : 'not-allowed',
                boxShadow: selectedPages.size > 0 ? '0 2px 10px rgba(37, 99, 235, 0.4)' : 'none'
              }}
            >
              🖼️ 선택한 {selectedPages.size}개 페이지를 공책에 일괄 생성
            </button>
          </div>
        )}

        {/* ====================================================================
            [4. 팝업 1: 단일 페이지 고화질 미리보기 팝업 모달]
            ==================================================================== */}
        {previewPage !== null && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 10000,
              background: 'rgba(0, 0, 0, 0.85)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px'
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setPreviewPage(null);
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '680px',
                maxHeight: '92vh',
                background: '#181b24',
                borderRadius: '16px',
                border: '1.5px solid #3b82f6',
                boxShadow: '0 25px 70px rgba(0, 0, 0, 0.9)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}
            >
              {/* 미리보기 헤더 */}
              <div
                style={{
                  padding: '12px 18px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'rgba(255, 255, 255, 0.03)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '20px' }}>🔍</span>
                  <span style={{ fontSize: '15px', fontWeight: 700, color: '#ffffff' }}>
                    {previewPage}쪽 상세 미리보기
                  </span>
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                    ({previewPage} / {totalPageCount}쪽)
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setPreviewPage(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    fontSize: '18px',
                    cursor: 'pointer'
                  }}
                >
                  ✕
                </button>
              </div>

              {/* 캔버스 이미지 미리보기 본문 */}
              <div
                style={{
                  flex: 1,
                  minHeight: '380px',
                  maxHeight: '60vh',
                  background: '#090b10',
                  padding: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'auto'
                }}
              >
                {isPreviewLoading ? (
                  <div style={{ textAlign: 'center', color: '#60a5fa' }}>
                    <div style={{ fontSize: '32px', animation: 'spin 1s infinite linear' }}>⏳</div>
                    <p style={{ marginTop: '10px', fontSize: '13px', fontWeight: 600 }}>
                      {previewPage}페이지를 고해상도로 렌더링하고 있습니다...
                    </p>
                  </div>
                ) : previewDataUrl ? (
                  <img
                    src={previewDataUrl}
                    alt={`Preview Page ${previewPage}`}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '58vh',
                      objectFit: 'contain',
                      borderRadius: '4px',
                      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.8)'
                    }}
                  />
                ) : (
                  <div style={{ color: '#94a3b8', fontSize: '13px' }}>미리보기를 불러올 수 없습니다.</div>
                )}
              </div>

              {/* 미리보기 하단 액션 바 (이전/다음 + 배경넣기 + 자르기) */}
              <div
                style={{
                  padding: '12px 18px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  flexWrap: 'wrap'
                }}
              >
                {/* 이전 / 다음 쪽 네비게이션 */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    disabled={previewPage <= 1}
                    onClick={() => setPreviewPage(prev => (prev ? Math.max(1, prev - 1) : 1))}
                    style={{
                      background: previewPage <= 1 ? '#1e293b' : '#334155',
                      color: previewPage <= 1 ? '#64748b' : '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '6px 12px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: previewPage <= 1 ? 'not-allowed' : 'pointer'
                    }}
                  >
                    ◀ 이전 쪽
                  </button>
                  <button
                    type="button"
                    disabled={previewPage >= totalPageCount}
                    onClick={() => setPreviewPage(prev => (prev ? Math.min(totalPageCount, prev + 1) : 1))}
                    style={{
                      background: previewPage >= totalPageCount ? '#1e293b' : '#334155',
                      color: previewPage >= totalPageCount ? '#64748b' : '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '6px 12px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: previewPage >= totalPageCount ? 'not-allowed' : 'pointer'
                    }}
                  >
                    다음 쪽 ▶
                  </button>
                </div>

                {/* 이 페이지 삽입 액션 */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectPage(previewPage, 'full_page');
                      setPreviewPage(null);
                    }}
                    style={{
                      background: '#2563eb',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '7px 16px',
                      fontSize: '12.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      boxShadow: '0 2px 8px rgba(37, 99, 235, 0.4)'
                    }}
                  >
                    <span>🖼️</span> {previewPage}쪽 전체 배경 넣기
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectPage(previewPage, 'crop');
                      setPreviewPage(null);
                    }}
                    style={{
                      background: '#059669',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '7px 16px',
                      fontSize: '12.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      boxShadow: '0 2px 8px rgba(5, 150, 105, 0.4)'
                    }}
                  >
                    <span>✂️</span> {previewPage}쪽 문제 자르기
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ====================================================================
            [5. 팝업 2: 더블클릭 / 롱프레스 즉시 액션 팝업]
            ==================================================================== */}
        {quickActionPage !== null && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 10001,
              background: 'rgba(0, 0, 0, 0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px'
            }}
            onClick={() => setQuickActionPage(null)}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '360px',
                background: '#1e2430',
                borderRadius: '16px',
                border: '1.5px solid #3b82f6',
                padding: '20px',
                boxShadow: '0 20px 50px rgba(0, 0, 0, 0.9)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ textAlign: 'center', marginBottom: '4px' }}>
                <span style={{ fontSize: '28px' }}>📑</span>
                <h4 style={{ margin: '6px 0 0', fontSize: '16px', fontWeight: 700, color: '#ffffff' }}>
                  {quickActionPage}페이지 작업 선택
                </h4>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                  원하시는 삽입 방식을 선택해 주세요.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  onSelectPage(quickActionPage, 'full_page');
                  setQuickActionPage(null);
                }}
                style={{
                  background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '11px',
                  fontSize: '13.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  boxShadow: '0 4px 12px rgba(37, 99, 235, 0.35)'
                }}
              >
                <span>🖼️</span> 현재 쪽 전체 배경으로 넣기
              </button>

              <button
                type="button"
                onClick={() => {
                  onSelectPage(quickActionPage, 'crop');
                  setQuickActionPage(null);
                }}
                style={{
                  background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '11px',
                  fontSize: '13.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  boxShadow: '0 4px 12px rgba(5, 150, 105, 0.35)'
                }}
              >
                <span>✂️</span> 특정 문제 영역 잘라서 넣기
              </button>

              <button
                type="button"
                onClick={() => setQuickActionPage(null)}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: '#94a3b8',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginTop: '4px'
                }}
              >
                취소
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

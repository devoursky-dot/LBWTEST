import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cropImageDataUrl, type CropRect } from '../lib/pdfImporter';

interface ImageCropModalProps {
  isOpen: boolean;
  imageSrc: string;
  initialCrop?: CropRect;
  onConfirmCrop: (croppedDataUrl: string, cropRect: CropRect) => void;
  onSetAsBackground?: (imageSrc: string) => void;
  onClose: () => void;
}

export const ImageCropModal: React.FC<ImageCropModalProps> = ({
  isOpen,
  imageSrc,
  initialCrop,
  onConfirmCrop,
  onSetAsBackground,
  onClose
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // 이미지 원본 크기
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // 화면에 렌더링된 이미지의 rect (offset, scale)
  const [displayedRect, setDisplayedRect] = useState<{ left: number; top: number; width: number; height: number }>({
    left: 0,
    top: 0,
    width: 0,
    height: 0
  });

  // 크롭 사각형 (0~1 정규화 비율: x, y, width, height)
  // 예: x: 0.1, y: 0.1, w: 0.8, h: 0.8
  const [normCrop, setNormCrop] = useState<{ x: number; y: number; w: number; h: number }>({
    x: 0.05,
    y: 0.05,
    w: 0.9,
    h: 0.9
  });

  const [isDragging, setIsDragging] = useState<string | null>(null); // 'move' | 'nw' | 'ne' | 'se' | 'sw' | 'n' | 's' | 'e' | 'w'
  const dragStartRef = useRef<{ clientX: number; clientY: number; initialNorm: { x: number; y: number; w: number; h: number } }>({
    clientX: 0,
    clientY: 0,
    initialNorm: { x: 0, y: 0, w: 0, h: 0 }
  });

  // 이미지 로드 시 크롭 초기화
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const nw = img.naturalWidth || img.width;
    const nh = img.naturalHeight || img.height;
    setNaturalSize({ width: nw, height: nh });

    if (initialCrop && nw > 0 && nh > 0) {
      setNormCrop({
        x: Math.max(0, Math.min(0.9, initialCrop.x / nw)),
        y: Math.max(0, Math.min(0.9, initialCrop.y / nh)),
        w: Math.max(0.1, Math.min(1, initialCrop.width / nw)),
        h: Math.max(0.1, Math.min(1, initialCrop.height / nh))
      });
    } else {
      setNormCrop({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
    }
  };

  // 컨테이너 크기 및 렌더링된 이미지 영역 재계산
  const updateDisplayedRect = useCallback(() => {
    if (!imgRef.current || !containerRef.current) return;
    const img = imgRef.current;
    const container = containerRef.current;

    const contRect = container.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();

    setDisplayedRect({
      left: imgRect.left - contRect.left,
      top: imgRect.top - contRect.top,
      width: imgRect.width,
      height: imgRect.height
    });
  }, []);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(updateDisplayedRect, 60);
      window.addEventListener('resize', updateDisplayedRect);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('resize', updateDisplayedRect);
      };
    }
  }, [isOpen, updateDisplayedRect, naturalSize]);

  // 마우스/터치 드래그 시작
  const handleDragStart = (e: React.PointerEvent, handleType: string) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(handleType);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      initialNorm: { ...normCrop }
    };
  };

  // 마우스/터치 드래그 이동
  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e: PointerEvent) => {
      if (!isDragging || displayedRect.width === 0 || displayedRect.height === 0) return;

      const dx = (e.clientX - dragStartRef.current.clientX) / displayedRect.width;
      const dy = (e.clientY - dragStartRef.current.clientY) / displayedRect.height;
      const init = dragStartRef.current.initialNorm;

      setNormCrop(prev => {
        let nx = prev.x;
        let ny = prev.y;
        let nw = prev.w;
        let nh = prev.h;

        const MIN_SIZE = 0.05;

        if (isDragging === 'move') {
          nx = Math.max(0, Math.min(1 - init.w, init.x + dx));
          ny = Math.max(0, Math.min(1 - init.h, init.y + dy));
          nw = init.w;
          nh = init.h;
        } else if (isDragging === 'se') {
          nw = Math.max(MIN_SIZE, Math.min(1 - init.x, init.w + dx));
          nh = Math.max(MIN_SIZE, Math.min(1 - init.y, init.h + dy));
        } else if (isDragging === 'sw') {
          const maxLeftShift = init.w - MIN_SIZE;
          const shiftX = Math.max(-init.x, Math.min(maxLeftShift, dx));
          nx = init.x + shiftX;
          nw = init.w - shiftX;
          nh = Math.max(MIN_SIZE, Math.min(1 - init.y, init.h + dy));
        } else if (isDragging === 'ne') {
          const maxUpShift = init.h - MIN_SIZE;
          const shiftY = Math.max(-init.y, Math.min(maxUpShift, dy));
          ny = init.y + shiftY;
          nh = init.h - shiftY;
          nw = Math.max(MIN_SIZE, Math.min(1 - init.x, init.w + dx));
        } else if (isDragging === 'nw') {
          const maxLeftShift = init.w - MIN_SIZE;
          const shiftX = Math.max(-init.x, Math.min(maxLeftShift, dx));
          const maxUpShift = init.h - MIN_SIZE;
          const shiftY = Math.max(-init.y, Math.min(maxUpShift, dy));
          nx = init.x + shiftX;
          nw = init.w - shiftX;
          ny = init.y + shiftY;
          nh = init.h - shiftY;
        } else if (isDragging === 'e') {
          nw = Math.max(MIN_SIZE, Math.min(1 - init.x, init.w + dx));
        } else if (isDragging === 's') {
          nh = Math.max(MIN_SIZE, Math.min(1 - init.y, init.h + dy));
        } else if (isDragging === 'w') {
          const maxLeftShift = init.w - MIN_SIZE;
          const shiftX = Math.max(-init.x, Math.min(maxLeftShift, dx));
          nx = init.x + shiftX;
          nw = init.w - shiftX;
        } else if (isDragging === 'n') {
          const maxUpShift = init.h - MIN_SIZE;
          const shiftY = Math.max(-init.y, Math.min(maxUpShift, dy));
          ny = init.y + shiftY;
          nh = init.h - shiftY;
        }

        return { x: nx, y: ny, w: nw, h: nh };
      });
    };

    const handlePointerUp = () => {
      setIsDragging(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isDragging, displayedRect]);

  // 크롭 확정
  const handleConfirm = async () => {
    if (naturalSize.width === 0 || naturalSize.height === 0) return;

    const cropPixelRect: CropRect = {
      x: Math.round(normCrop.x * naturalSize.width),
      y: Math.round(normCrop.y * naturalSize.height),
      width: Math.round(normCrop.w * naturalSize.width),
      height: Math.round(normCrop.h * naturalSize.height)
    };

    try {
      const croppedDataUrl = await cropImageDataUrl(imageSrc, cropPixelRect);
      onConfirmCrop(croppedDataUrl, cropPixelRect);
    } catch (err) {
      console.error('크롭 실패:', err);
    }
  };

  // 프리셋 자르기 비율
  const setPresetRatio = (ratio: 'all' | '1:1' | 'a4') => {
    if (ratio === 'all') {
      setNormCrop({ x: 0, y: 0, w: 1, h: 1 });
    } else if (ratio === '1:1') {
      const size = Math.min(normCrop.w, normCrop.h);
      setNormCrop(prev => ({ ...prev, w: size, h: size }));
    } else if (ratio === 'a4') {
      // A4 가로:세로 = 1 : 1.414
      const targetH = Math.min(1 - normCrop.y, normCrop.w * 1.414);
      setNormCrop(prev => ({ ...prev, h: targetH }));
    }
  };

  if (!isOpen) return null;

  // 화면 픽셀 기준 크롭 박스 좌표
  const cropBoxLeft = displayedRect.left + normCrop.x * displayedRect.width;
  const cropBoxTop = displayedRect.top + normCrop.y * displayedRect.height;
  const cropBoxWidth = normCrop.w * displayedRect.width;
  const cropBoxHeight = normCrop.h * displayedRect.height;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '900px',
          height: '88vh',
          background: '#181a20',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.9)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* 상단 툴바 */}
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(255, 255, 255, 0.03)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>✂️</span>
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#ffffff' }}>영역 자르기 (Crop)</span>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>- 문제나 필요한 부분을 박스로 지정하세요</span>
          </div>

          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              onClick={() => setPresetRatio('all')}
              style={{ padding: '4px 10px', fontSize: '11.5px', borderRadius: '6px', background: 'rgba(255,255,255,0.08)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer' }}
            >
              전체 선택
            </button>
            <button
              type="button"
              onClick={() => setPresetRatio('1:1')}
              style={{ padding: '4px 10px', fontSize: '11.5px', borderRadius: '6px', background: 'rgba(255,255,255,0.08)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer' }}
            >
              1:1 정방형
            </button>
            <button
              type="button"
              onClick={() => setPresetRatio('a4')}
              style={{ padding: '4px 10px', fontSize: '11.5px', borderRadius: '6px', background: 'rgba(255,255,255,0.08)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer' }}
            >
              A4 비율
            </button>
          </div>
        </div>

        {/* 메인 뷰포트 (이미지 + 인터랙티브 크롭 박스) */}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            position: 'relative',
            background: '#090b10',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            userSelect: 'none',
            touchAction: 'none'
          }}
        >
          <img
            ref={imgRef}
            src={imageSrc}
            alt="Crop target"
            onLoad={handleImageLoad}
            style={{
              maxWidth: '92%',
              maxHeight: '92%',
              objectFit: 'contain',
              display: 'block',
              pointerEvents: 'none'
            }}
          />

          {/* 4방향 어두운 마스크 레이어 */}
          {displayedRect.width > 0 && (
            <>
              {/* 위쪽 마스크 */}
              <div
                style={{
                  position: 'absolute',
                  left: displayedRect.left,
                  top: displayedRect.top,
                  width: displayedRect.width,
                  height: Math.max(0, cropBoxTop - displayedRect.top),
                  background: 'rgba(0, 0, 0, 0.65)',
                  pointerEvents: 'none'
                }}
              />
              {/* 아래쪽 마스크 */}
              <div
                style={{
                  position: 'absolute',
                  left: displayedRect.left,
                  top: cropBoxTop + cropBoxHeight,
                  width: displayedRect.width,
                  height: Math.max(0, displayedRect.top + displayedRect.height - (cropBoxTop + cropBoxHeight)),
                  background: 'rgba(0, 0, 0, 0.65)',
                  pointerEvents: 'none'
                }}
              />
              {/* 왼쪽 마스크 */}
              <div
                style={{
                  position: 'absolute',
                  left: displayedRect.left,
                  top: cropBoxTop,
                  width: Math.max(0, cropBoxLeft - displayedRect.left),
                  height: cropBoxHeight,
                  background: 'rgba(0, 0, 0, 0.65)',
                  pointerEvents: 'none'
                }}
              />
              {/* 오른쪽 마스크 */}
              <div
                style={{
                  position: 'absolute',
                  left: cropBoxLeft + cropBoxWidth,
                  top: cropBoxTop,
                  width: Math.max(0, displayedRect.left + displayedRect.width - (cropBoxLeft + cropBoxWidth)),
                  height: cropBoxHeight,
                  background: 'rgba(0, 0, 0, 0.65)',
                  pointerEvents: 'none'
                }}
              />

              {/* 활성 크롭 박스 (테두리 + 이동 영역 + 8개 조절 핸들) */}
              <div
                onPointerDown={(e) => handleDragStart(e, 'move')}
                style={{
                  position: 'absolute',
                  left: `${cropBoxLeft}px`,
                  top: `${cropBoxTop}px`,
                  width: `${cropBoxWidth}px`,
                  height: `${cropBoxHeight}px`,
                  border: '2px solid #38bdf8',
                  boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.8), 0 8px 32px rgba(0,0,0,0.5)',
                  cursor: isDragging === 'move' ? 'grabbing' : 'grab',
                  boxSizing: 'border-box'
                }}
              >
                {/* 3분할 가이드라인 (Rule of Thirds) */}
                <div style={{ position: 'absolute', left: '33.3%', top: 0, bottom: 0, width: '1px', background: 'rgba(255, 255, 255, 0.3)', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', left: '66.6%', top: 0, bottom: 0, width: '1px', background: 'rgba(255, 255, 255, 0.3)', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', top: '33.3%', left: 0, right: 0, height: '1px', background: 'rgba(255, 255, 255, 0.3)', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', top: '66.6%', left: 0, right: 0, height: '1px', background: 'rgba(255, 255, 255, 0.3)', pointerEvents: 'none' }} />

                {/* 모서리 핸들 4개 (크고 터치하기 편하게 22x22px) */}
                <div
                  onPointerDown={(e) => handleDragStart(e, 'nw')}
                  style={{ position: 'absolute', left: -7, top: -7, width: 16, height: 16, background: '#38bdf8', border: '2px solid #ffffff', borderRadius: '4px', cursor: 'nwse-resize' }}
                />
                <div
                  onPointerDown={(e) => handleDragStart(e, 'ne')}
                  style={{ position: 'absolute', right: -7, top: -7, width: 16, height: 16, background: '#38bdf8', border: '2px solid #ffffff', borderRadius: '4px', cursor: 'nesw-resize' }}
                />
                <div
                  onPointerDown={(e) => handleDragStart(e, 'se')}
                  style={{ position: 'absolute', right: -7, bottom: -7, width: 16, height: 16, background: '#38bdf8', border: '2px solid #ffffff', borderRadius: '4px', cursor: 'nwse-resize' }}
                />
                <div
                  onPointerDown={(e) => handleDragStart(e, 'sw')}
                  style={{ position: 'absolute', left: -7, bottom: -7, width: 16, height: 16, background: '#38bdf8', border: '2px solid #ffffff', borderRadius: '4px', cursor: 'nesw-resize' }}
                />

                {/* 변 핸들 4개 */}
                <div
                  onPointerDown={(e) => handleDragStart(e, 'n')}
                  style={{ position: 'absolute', left: '50%', top: -6, transform: 'translateX(-50%)', width: 24, height: 10, background: '#38bdf8', border: '1px solid #ffffff', borderRadius: '3px', cursor: 'ns-resize' }}
                />
                <div
                  onPointerDown={(e) => handleDragStart(e, 's')}
                  style={{ position: 'absolute', left: '50%', bottom: -6, transform: 'translateX(-50%)', width: 24, height: 10, background: '#38bdf8', border: '1px solid #ffffff', borderRadius: '3px', cursor: 'ns-resize' }}
                />
                <div
                  onPointerDown={(e) => handleDragStart(e, 'w')}
                  style={{ position: 'absolute', top: '50%', left: -6, transform: 'translateY(-50%)', width: 10, height: 24, background: '#38bdf8', border: '1px solid #ffffff', borderRadius: '3px', cursor: 'ew-resize' }}
                />
                <div
                  onPointerDown={(e) => handleDragStart(e, 'e')}
                  style={{ position: 'absolute', top: '50%', right: -6, transform: 'translateY(-50%)', width: 10, height: 24, background: '#38bdf8', border: '1px solid #ffffff', borderRadius: '3px', cursor: 'ew-resize' }}
                />
              </div>
            </>
          )}
        </div>

        {/* 푸터 액션 버튼 */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'rgba(255, 255, 255, 0.02)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: 600,
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.08)',
              color: '#94a3b8',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              cursor: 'pointer'
            }}
          >
            취소
          </button>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {onSetAsBackground && !initialCrop && (
              <button
                type="button"
                onClick={() => onSetAsBackground(imageSrc)}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: 600,
                  borderRadius: '8px',
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                title="자르지 않고 현재 쪽 전체 배경으로 설정"
              >
                <span>📄</span> 전체 배경으로 넣기
              </button>
            )}

            <button
              type="button"
              onClick={handleConfirm}
              style={{
                padding: '8px 20px',
                fontSize: '13.5px',
                fontWeight: 700,
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
                color: '#ffffff',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)'
              }}
            >
              <span>✂️</span> 잘라낸 영역 공책에 삽입
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

import React, { useState, useRef, useEffect } from 'react';
import type { CropRect } from '../lib/pdfImporter';

export interface EmbeddedImageItem {
  id: string;
  src: string; // 잘라낸 표시용 DataURL
  originalSrc: string; // 언제든 재자르기 가능한 원본 DataURL
  x: number; // A4 좌표계 기준 X
  y: number; // A4 좌표계 기준 Y
  width: number; // A4 좌표계 기준 너비
  height: number; // A4 좌표계 기준 높이
  crop?: CropRect;
}

interface EmbeddedImageLayerProps {
  images: EmbeddedImageItem[];
  selectedImageId: string | null;
  onSelectImage: (id: string | null) => void;
  onUpdateImage: (id: string, updates: Partial<EmbeddedImageItem>) => void;
  onDeleteImage: (id: string) => void;
  onEditCrop: (image: EmbeddedImageItem) => void;
  isDrawingToolActive: boolean;
  A4_WIDTH: number;
  A4_HEIGHT: number;
}

export const EmbeddedImageLayer: React.FC<EmbeddedImageLayerProps> = ({
  images,
  selectedImageId,
  onSelectImage,
  onUpdateImage,
  onDeleteImage,
  onEditCrop,
  isDrawingToolActive,
  A4_WIDTH,
  A4_HEIGHT
}) => {
  const [draggingHandle, setDraggingHandle] = useState<string | null>(null); // 'move' | 'nw' | 'ne' | 'se' | 'sw'

  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    initialImg: EmbeddedImageItem;
    scaleRatio: number; // 캔버스 화면 픽셀 대비 A4 좌표계 비율
  }>({
    clientX: 0,
    clientY: 0,
    initialImg: { id: '', src: '', originalSrc: '', x: 0, y: 0, width: 0, height: 0 },
    scaleRatio: 1
  });

  const handlePointerDown = (
    e: React.PointerEvent,
    img: EmbeddedImageItem,
    handleType: string,
    element: HTMLElement
  ) => {
    e.preventDefault();
    e.stopPropagation();

    onSelectImage(img.id);
    setDraggingHandle(handleType);

    const rect = element.getBoundingClientRect();
    const scale = img.width > 0 ? img.width / rect.width : 1;

    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      initialImg: { ...img },
      scaleRatio: scale
    };
  };

  useEffect(() => {
    if (!draggingHandle || !selectedImageId) return;

    const handlePointerMove = (e: PointerEvent) => {
      const { clientX, clientY, initialImg, scaleRatio } = dragStartRef.current;
      const dx = (e.clientX - clientX) * scaleRatio;
      const dy = (e.clientY - clientY) * scaleRatio;

      let nextX = initialImg.x;
      let nextY = initialImg.y;
      let nextW = initialImg.width;
      let nextH = initialImg.height;

      const MIN_W = 60;
      const aspect = initialImg.width / Math.max(1, initialImg.height);

      if (draggingHandle === 'move') {
        nextX = Math.max(0, Math.min(A4_WIDTH - initialImg.width, initialImg.x + dx));
        nextY = Math.max(0, Math.min(A4_HEIGHT - initialImg.height, initialImg.y + dy));
      } else if (draggingHandle === 'se') {
        nextW = Math.max(MIN_W, Math.min(A4_WIDTH - initialImg.x, initialImg.width + dx));
        nextH = nextW / aspect;
      } else if (draggingHandle === 'sw') {
        const deltaW = -dx;
        nextW = Math.max(MIN_W, initialImg.width + deltaW);
        nextX = initialImg.x + (initialImg.width - nextW);
        nextH = nextW / aspect;
      } else if (draggingHandle === 'ne') {
        nextW = Math.max(MIN_W, Math.min(A4_WIDTH - initialImg.x, initialImg.width + dx));
        nextH = nextW / aspect;
        nextY = initialImg.y + (initialImg.height - nextH);
      } else if (draggingHandle === 'nw') {
        const deltaW = -dx;
        nextW = Math.max(MIN_W, initialImg.width + deltaW);
        nextX = initialImg.x + (initialImg.width - nextW);
        nextH = nextW / aspect;
        nextY = initialImg.y + (initialImg.height - nextH);
      }

      onUpdateImage(selectedImageId, {
        x: Math.round(nextX),
        y: Math.round(nextY),
        width: Math.round(nextW),
        height: Math.round(nextH)
      });
    };

    const handlePointerUp = () => {
      setDraggingHandle(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [draggingHandle, selectedImageId, onUpdateImage, A4_WIDTH, A4_HEIGHT]);

  return (
    <>
      {images.map(img => {
        const isSelected = selectedImageId === img.id;
        const leftPct = (img.x / A4_WIDTH) * 100;
        const topPct = (img.y / A4_HEIGHT) * 100;
        const widthPct = (img.width / A4_WIDTH) * 100;
        const heightPct = (img.height / A4_HEIGHT) * 100;

        return (
          <div
            key={img.id}
            id={`embedded-img-${img.id}`}
            style={{
              position: 'absolute',
              left: `${leftPct}%`,
              top: `${topPct}%`,
              width: `${widthPct}%`,
              height: `${heightPct}%`,
              zIndex: isSelected ? 12 : 2,
              // 그리기 도구(펜/형광펜/지우개) 사용 중에는 캔버스로 필기 이벤트가 통과하도록 설정
              pointerEvents: isDrawingToolActive && !isSelected ? 'none' : 'auto',
              userSelect: 'none',
              touchAction: 'none'
            }}
          >
            {/* 실제 잘라낸 이미지 */}
            <img
              src={img.src}
              alt="Embedded Problem/Worksheet"
              onPointerDown={(e) => {
                if (!isDrawingToolActive || isSelected) {
                  handlePointerDown(e, img, 'move', e.currentTarget);
                }
              }}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'fill',
                display: 'block',
                borderRadius: '4px',
                boxShadow: isSelected
                  ? '0 0 0 2px #38bdf8, 0 8px 24px rgba(0,0,0,0.5)'
                  : '0 2px 8px rgba(0, 0, 0, 0.4)',
                cursor: isDrawingToolActive && !isSelected ? 'default' : 'move'
              }}
            />

            {/* 선택 시 나타나는 인터랙티브 조절 핸들러 및 플로팅 툴바 */}
            {isSelected && (
              <>
                {/* 상단 플로팅 액션 메뉴 */}
                <div
                  style={{
                    position: 'absolute',
                    top: '-38px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: '#1e222b',
                    padding: '3px 6px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.6)',
                    zIndex: 20,
                    whiteSpace: 'nowrap'
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => onEditCrop(img)}
                    style={{
                      background: 'rgba(56, 189, 248, 0.2)',
                      color: '#38bdf8',
                      border: '1px solid rgba(56, 189, 248, 0.4)',
                      padding: '3px 8px',
                      fontSize: '11px',
                      fontWeight: 600,
                      borderRadius: '4px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px'
                    }}
                    title="자르기 영역 다시 수정"
                  >
                    <span>✂️</span> 다시 자르기
                  </button>

                  <button
                    type="button"
                    onClick={() => onDeleteImage(img.id)}
                    style={{
                      background: 'rgba(239, 68, 68, 0.2)',
                      color: '#f87171',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      padding: '3px 8px',
                      fontSize: '11px',
                      fontWeight: 600,
                      borderRadius: '4px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px'
                    }}
                    title="이미지 삭제"
                  >
                    <span>🗑️</span> 삭제
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelectImage(null)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.1)',
                      color: '#cbd5e1',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      padding: '3px 8px',
                      fontSize: '11px',
                      fontWeight: 600,
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                    title="선택 완료 (필기 모드로 전환)"
                  >
                    ✓ 완료
                  </button>
                </div>

                {/* 4방향 모서리 리사이즈 핸들 */}
                <div
                  onPointerDown={(e) => handlePointerDown(e, img, 'nw', e.currentTarget)}
                  style={{ position: 'absolute', left: -6, top: -6, width: 14, height: 14, background: '#38bdf8', border: '2px solid #ffffff', borderRadius: '3px', cursor: 'nwse-resize', zIndex: 15 }}
                />
                <div
                  onPointerDown={(e) => handlePointerDown(e, img, 'ne', e.currentTarget)}
                  style={{ position: 'absolute', right: -6, top: -6, width: 14, height: 14, background: '#38bdf8', border: '2px solid #ffffff', borderRadius: '3px', cursor: 'nesw-resize', zIndex: 15 }}
                />
                <div
                  onPointerDown={(e) => handlePointerDown(e, img, 'se', e.currentTarget)}
                  style={{ position: 'absolute', right: -6, bottom: -6, width: 14, height: 14, background: '#38bdf8', border: '2px solid #ffffff', borderRadius: '3px', cursor: 'nwse-resize', zIndex: 15 }}
                />
                <div
                  onPointerDown={(e) => handlePointerDown(e, img, 'sw', e.currentTarget)}
                  style={{ position: 'absolute', left: -6, bottom: -6, width: 14, height: 14, background: '#38bdf8', border: '2px solid #ffffff', borderRadius: '3px', cursor: 'nesw-resize', zIndex: 15 }}
                />
              </>
            )}
          </div>
        );
      })}
    </>
  );
};

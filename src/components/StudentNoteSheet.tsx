import React from 'react';

export interface StudentNoteSheetPage {
  fullPageBackground?: string | null;
  images?: Array<{
    id?: string;
    src?: string;
    dataUrl?: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  strokes?: Array<{
    id?: string;
    tool?: string;
    color?: string;
    size?: number;
    points: Array<{ x: number; y: number }>;
  }>;
  textItems?: Array<{
    id?: string;
    text: string;
    x: number;
    y: number;
    fontSize?: number;
    color?: string;
  }>;
}

export interface StudentNoteSheetProps {
  page: StudentNoteSheetPage;
  orientation?: 'portrait' | 'landscape';
  className?: string;
  style?: React.CSSProperties;
}

/**
 * 학생 필기앱(StudentLessonView)과 100% 동일한 DOM 레이어 구조 및 좌표계로 렌더링하는 공통 뷰어 시트.
 * 임의의 오프셋 계산, 비율 레터박스 연산 없이 A4 용지 규격(세로 1130x1600 / 가로 1600x1130)에
 * 배경 이미지(objectFit: 'fill')와 손글씨 스트로크를 1:1 완벽 정합시킵니다.
 */
export const StudentNoteSheet: React.FC<StudentNoteSheetProps> = ({
  page,
  orientation = 'landscape',
  className,
  style
}) => {
  const isPortrait = orientation === 'portrait';
  const docWidth = isPortrait ? 1130 : 1600;
  const docHeight = isPortrait ? 1600 : 1130;

  const hasBackground = Boolean(page.fullPageBackground);
  const images = page.images || [];
  const strokes = page.strokes || [];
  const textItems = page.textItems || [];

  const isEmpty =
    !hasBackground &&
    images.length === 0 &&
    strokes.length === 0 &&
    textItems.length === 0;

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        aspectRatio: `${docWidth} / ${docHeight}`,
        background: '#131314',
        overflow: 'hidden',
        boxSizing: 'border-box',
        ...style
      }}
    >
      {/* Layer 0: A4 전체 배경 (학습지/PDF/이미지) - 학생 필기앱과 동일한 HTML img 렌더링 (A4 100% 밀착) */}
      {hasBackground && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            zIndex: 1,
            pointerEvents: 'none',
            overflow: 'hidden'
          }}
        >
          <img
            src={page.fullPageBackground!}
            alt="Worksheet Background"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'fill',
              display: 'block'
            }}
          />
        </div>
      )}

      {/* Layer 1: 임베드된 문제/스티커 이미지들 - 학생 필기앱과 100% 동일한 백분율 좌표 */}
      {images.map((img, idx) => {
        const src = img.src || img.dataUrl;
        if (!src) return null;
        return (
          <div
            key={img.id || idx}
            style={{
              position: 'absolute',
              left: `${(img.x / docWidth) * 100}%`,
              top: `${(img.y / docHeight) * 100}%`,
              width: `${(img.width / docWidth) * 100}%`,
              height: `${(img.height / docHeight) * 100}%`,
              zIndex: 2,
              pointerEvents: 'none'
            }}
          >
            <img
              src={src}
              alt="Embedded Problem"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'fill',
                display: 'block',
                borderRadius: '4px'
              }}
            />
          </div>
        );
      })}

      {/* Layer 2: 벡터 스트로크 (학생 손글씨 필기) - 투명 SVG 오버레이로 A4 전면 1:1 직결 */}
      <svg
        viewBox={`0 0 ${docWidth} ${docHeight}`}
        preserveAspectRatio="none"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          pointerEvents: 'none',
          zIndex: 3
        }}
      >
        {/* 모눈종이 패턴 그리드 (배경 이미지가 없을 때만 표시) */}
        {!hasBackground && (
          <g>
            <defs>
              <pattern
                id={`grid-sheet-${docWidth}-${docHeight}`}
                width="32"
                height="32"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 32 0 L 0 0 0 32"
                  fill="none"
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth="1"
                />
              </pattern>
            </defs>
            <rect
              width={docWidth}
              height={docHeight}
              fill={`url(#grid-sheet-${docWidth}-${docHeight})`}
            />
          </g>
        )}

        {/* 완료된 필기 스트로크 렌더링 */}
        {strokes.map((stroke, idx) => {
          if (!stroke.points || stroke.points.length === 0 || stroke.tool === 'eraser') return null;

          let strokeColor = stroke.color;
          // 과거 검정 펜으로 필기한 내용도 다크 모드 칠판에서 선명하게 보이도록 화이트 분필색(#f8fafc)으로 자동 보정
          if (strokeColor === '#000000' || strokeColor === '#0f172a' || strokeColor === '#1e293b') {
            strokeColor = '#f8fafc';
          }

          if (stroke.points.length === 1) {
            return (
              <circle
                key={stroke.id || idx}
                cx={stroke.points[0].x}
                cy={stroke.points[0].y}
                r={(stroke.size || 3) / 2}
                fill={strokeColor || '#ffffff'}
                opacity={stroke.tool === 'highlighter' ? 0.4 : 1.0}
              />
            );
          }

          let pathData = `M ${stroke.points[0].x} ${stroke.points[0].y}`;
          for (let i = 1; i < stroke.points.length; i++) {
            pathData += ` L ${stroke.points[i].x} ${stroke.points[i].y}`;
          }

          return (
            <path
              key={stroke.id || idx}
              d={pathData}
              fill="none"
              stroke={strokeColor || '#ffffff'}
              strokeWidth={stroke.size || 3}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={stroke.tool === 'highlighter' ? 0.4 : 1.0}
            />
          );
        })}
      </svg>

      {/* Layer 3: 텍스트 아이템들 (학생 필기앱과 동일한 백분율 좌표) */}
      {textItems.map((item, idx) => {
        let textColor = item.color;
        if (textColor === '#000000' || textColor === '#0f172a') textColor = '#f8fafc';
        return (
          <div
            key={item.id || idx}
            style={{
              position: 'absolute',
              left: `${(item.x / docWidth) * 100}%`,
              top: `${(item.y / docHeight) * 100}%`,
              color: textColor || '#ffffff',
              fontSize: `${item.fontSize || 16}px`,
              fontWeight: 600,
              zIndex: 4,
              pointerEvents: 'none',
              userSelect: 'none'
            }}
          >
            {item.text}
          </div>
        );
      })}

      {/* 빈 페이지 안내 메시지 */}
      {isEmpty && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#94a3b8',
            fontSize: '13px',
            zIndex: 5,
            textAlign: 'center',
            pointerEvents: 'none',
            gap: '6px'
          }}
        >
          <span style={{ fontSize: '22px' }}>✍️</span>
          <span style={{ fontWeight: 600 }}>학생이 아직 이 쪽에 필기를 작성하지 않았습니다.</span>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            학생이 태블릿에서 펜 필기를 진행하면 실시간으로 자동 반영됩니다.
          </span>
        </div>
      )}
    </div>
  );
};

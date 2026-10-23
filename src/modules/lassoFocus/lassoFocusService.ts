/**
 * lassoFocusService.ts
 * ============================================================================
 * 올가미 집중 풀이 코어 연산 엔진 (Zero React Dependency)
 * 
 * 1. 올가미 다각형 기하학 계산 (Bounding Box, 둘레, 자석 스냅)
 * 2. 원본 화면 합성 (배경 + 이미지 + 필기 획 + 텍스트)
 * 3. 지능형 배경색 자동 스포이드 추출 (경계면 픽셀 샘플링)
 * 4. 상단 중앙 자동 스케일링 & 클린 풀이 백지 페이지 생성
 * ============================================================================
 */

import { defaultLassoFocusConfig, type LassoFocusConfig } from './lassoFocusConfig';
import { type Stroke, drawSingleStroke } from '../../lib/drawingGeometry';

export interface Point {
  x: number;
  y: number;
}

export interface PolygonBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface CreateFocusPageOptions {
  /** 현재 페이지 배경 이미지/PDF dataUrl (null인 경우 백지) */
  fullPageBackground?: string | null;
  /** 현재 페이지에 배치된 스티커 이미지들 */
  embeddedImages?: Array<{
    id: string;
    src: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  /** 현재 페이지 필기 스트로크 */
  strokes?: Stroke[];
  /** 현재 페이지 텍스트 아이템들 */
  textItems?: Array<{
    id: string;
    x: number;
    y: number;
    text: string;
    color: string;
    fontSize: number;
  }>;
  /** 용지 테마 */
  paperTheme?: 'white' | 'dark' | 'ivory';
  /** 올가미 궤적 좌표 리스트 */
  lassoPoints: Point[];
  /** 캔버스 너비/높이 */
  A4_WIDTH: number;
  A4_HEIGHT: number;
  /** 배치 모드: 상단 중앙(권장) 또는 원본 위치 */
  placement?: 'top_center' | 'original';
  /** 플러그인 커스텀 옵션 */
  config?: Partial<LassoFocusConfig>;
}

export interface FocusPageResult {
  dataUrl: string;
  bgColor: string;
  bounds: PolygonBounds;
  placement: 'top_center' | 'original';
}

/**
 * 1. 다각형 바운딩 박스 및 중심점 계산
 */
export function getPolygonBounds(points: Point[]): PolygonBounds {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  return {
    minX: Math.round(minX),
    minY: Math.round(minY),
    maxX: Math.round(maxX),
    maxY: Math.round(maxY),
    width: Math.round(width),
    height: Math.round(height),
    centerX: Math.round(minX + width / 2),
    centerY: Math.round(minY + height / 2)
  };
}

/**
 * 2. 시작점과 현재 점 사이의 거리 계산 (자석 스냅 감지용)
 */
export function getPointDistance(p1: Point, p2: Point): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

/**
 * 3. 지능형 배경색 자동 스포이드 추출
 * 올가미 둘레와 바운딩 박스 모서리 픽셀의 색상을 표본 추출하여 가장 주도적인 배경색을 산출합니다.
 */
export function sampleBackgroundColor(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  bounds: PolygonBounds
): string {
  try {
    const samplePoints: Point[] = [];

    // 바운딩 박스 4개 모서리
    samplePoints.push({ x: bounds.minX + 2, y: bounds.minY + 2 });
    samplePoints.push({ x: bounds.maxX - 2, y: bounds.minY + 2 });
    samplePoints.push({ x: bounds.minX + 2, y: bounds.maxY - 2 });
    samplePoints.push({ x: bounds.maxX - 2, y: bounds.maxY - 2 });

    // 올가미 곡선 둘레에서 8~12개 균등 표본점
    const step = Math.max(1, Math.floor(points.length / 8));
    for (let i = 0; i < points.length; i += step) {
      samplePoints.push(points[i]);
    }

    let totalR = 0;
    let totalG = 0;
    let totalB = 0;
    let validSamples = 0;

    for (const sp of samplePoints) {
      const px = Math.max(0, Math.min(ctx.canvas.width - 1, Math.round(sp.x)));
      const py = Math.max(0, Math.min(ctx.canvas.height - 1, Math.round(sp.y)));
      const pixel = ctx.getImageData(px, py, 1, 1).data;
      if (pixel[3] > 100) { // 투명이 아닌 경우
        totalR += pixel[0];
        totalG += pixel[1];
        totalB += pixel[2];
        validSamples++;
      }
    }

    if (validSamples === 0) return '#ffffff';

    const avgR = Math.round(totalR / validSamples);
    const avgG = Math.round(totalG / validSamples);
    const avgB = Math.round(totalB / validSamples);

    // 종이가 매우 밝은 백색에 가까운 경우(RGB 각 235 이상) 완벽한 백색(#ffffff)으로 깔끔하게 정규화
    if (avgR >= 238 && avgG >= 238 && avgB >= 238) {
      return '#ffffff';
    }

    return `rgb(${avgR}, ${avgG}, ${avgB})`;
  } catch (err) {
    console.warn('[LassoFocusService] 배경색 추출 실패, 기본 백색 적용:', err);
    return '#ffffff';
  }
}

/**
 * 4. 현재 페이지의 모든 시각 요소(배경, 이미지, 필기획, 텍스트)를 단일 캔버스로 정밀 합성
 */
export async function renderCurrentPageToCompositeCanvas(
  options: CreateFocusPageOptions
): Promise<HTMLCanvasElement> {
  const {
    fullPageBackground,
    embeddedImages = [],
    strokes = [],
    textItems = [],
    paperTheme = 'white',
    A4_WIDTH,
    A4_HEIGHT
  } = options;

  const canvas = document.createElement('canvas');
  canvas.width = A4_WIDTH;
  canvas.height = A4_HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Composite canvas context2D 생성 실패');

  // 1) 기본 종이 배경 채우기
  let baseFill = '#ffffff';
  if (paperTheme === 'dark') baseFill = '#12141a';
  else if (paperTheme === 'ivory') baseFill = '#fdfbf7';
  ctx.fillStyle = baseFill;
  ctx.fillRect(0, 0, A4_WIDTH, A4_HEIGHT);

  // 2) 전체 배경 이미지/PDF
  if (fullPageBackground) {
    try {
      const bgImg = await loadImageElement(fullPageBackground);
      ctx.drawImage(bgImg, 0, 0, A4_WIDTH, A4_HEIGHT);
    } catch (e) {
      console.warn('[LassoFocusService] 배경 이미지 로드 실패:', e);
    }
  }

  // 3) 스티커/임베드된 이미지들
  for (const imgItem of embeddedImages) {
    try {
      const img = await loadImageElement(imgItem.src);
      ctx.drawImage(img, imgItem.x, imgItem.y, imgItem.width, imgItem.height);
    } catch (e) {
      console.warn('[LassoFocusService] 임베드 이미지 로드 실패:', e);
    }
  }

  // 4) 필기 획 (Strokes)
  for (const stroke of strokes) {
    drawSingleStroke(ctx, stroke);
  }

  // 5) 텍스트 아이템들
  for (const item of textItems) {
    ctx.save();
    ctx.fillStyle = item.color || '#0f172a';
    ctx.font = `bold ${item.fontSize || 18}px "Pretendard", sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(item.text, item.x, item.y);
    ctx.restore();
  }

  return canvas;
}

/**
 * 5. 집중 풀이 페이지 배경 최종 생성 (상단 중앙 재배치 & 여백 자동 구성)
 */
export async function createFocusedPageBackground(
  options: CreateFocusPageOptions
): Promise<FocusPageResult> {
  const cfg: LassoFocusConfig = { ...defaultLassoFocusConfig, ...options.config };
  const placement = options.placement || 'top_center';
  const { lassoPoints, A4_WIDTH, A4_HEIGHT } = options;

  // 바운딩 박스 계산
  const bounds = getPolygonBounds(lassoPoints);
  if (bounds.width < cfg.minDimension || bounds.height < cfg.minDimension) {
    throw new Error('선택된 영역이 너무 작습니다. 문제를 조금 더 넉넉하게 둘러싸주세요.');
  }

  // 1. 현재 화면 종합 캔버스 렌더링
  const sourceCanvas = await renderCurrentPageToCompositeCanvas(options);
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx) throw new Error('Source context 실패');

  // 2. 배경색 지능형 자동 추출
  const detectedBgColor = sampleBackgroundColor(sourceCtx, lassoPoints, bounds);

  // 3. 올가미 영역만 클리핑하여 별도 캔버스에 추출
  const segmentCanvas = document.createElement('canvas');
  segmentCanvas.width = bounds.width;
  segmentCanvas.height = bounds.height;
  const segCtx = segmentCanvas.getContext('2d');
  if (!segCtx) throw new Error('Segment context 실패');

  // 클리핑 패스 생성 (오프셋: -bounds.minX, -bounds.minY)
  segCtx.save();
  segCtx.beginPath();
  const startP = lassoPoints[0];
  segCtx.moveTo(startP.x - bounds.minX, startP.y - bounds.minY);
  for (let i = 1; i < lassoPoints.length; i++) {
    segCtx.lineTo(lassoPoints[i].x - bounds.minX, lassoPoints[i].y - bounds.minY);
  }
  segCtx.closePath();
  segCtx.clip();

  // 소스 캔버스에서 해당 바운딩 박스 영역 그대로 복사
  segCtx.drawImage(
    sourceCanvas,
    bounds.minX,
    bounds.minY,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height
  );
  segCtx.restore();

  // 4. 새로운 집중 풀이 페이지(타겟 캔버스) 생성
  const targetCanvas = document.createElement('canvas');
  targetCanvas.width = A4_WIDTH;
  targetCanvas.height = A4_HEIGHT;
  const targetCtx = targetCanvas.getContext('2d');
  if (!targetCtx) throw new Error('Target context 실패');

  // 4-1) 전체 캔버스를 추출한 배경색으로 도색 (이질감 제로)
  targetCtx.fillStyle = detectedBgColor;
  targetCtx.fillRect(0, 0, A4_WIDTH, A4_HEIGHT);

  if (placement === 'top_center') {
    // ------------------------------------------------------------------------
    // [A안 (추천)]: 상단 중앙 스마트 재배치 & 하단 광활한 풀이 백지 확보
    // ------------------------------------------------------------------------
    const maxAllowedWidth = Math.round(A4_WIDTH * cfg.maxWidthRatio);
    const maxAllowedHeight = Math.round(A4_HEIGHT * cfg.maxHeightRatio);

    // 작은 문제는 1.05배 약간 확대, 큰 문제는 상단 40% 내에 맞게 비율 축소
    const scale = Math.min(
      1.1,
      maxAllowedWidth / bounds.width,
      maxAllowedHeight / bounds.height
    );

    const destW = Math.round(bounds.width * scale);
    const destH = Math.round(bounds.height * scale);
    const destX = Math.round((A4_WIDTH - destW) / 2);
    const destY = cfg.topMargin;

    // 문제 이미지 그리기
    targetCtx.drawImage(segmentCanvas, destX, destY, destW, destH);

    // 4-2) 문제와 풀이 공간을 구분하는 우아한 시각적 디바이더 렌더링
    if (cfg.showDividerBadge) {
      const dividerY = destY + destH + 28;
      targetCtx.save();

      // 은은한 점선 구분선
      targetCtx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
      targetCtx.lineWidth = 1.5;
      targetCtx.setLineDash([8, 8]);
      targetCtx.beginPath();
      targetCtx.moveTo(40, dividerY);
      targetCtx.lineTo(A4_WIDTH - 40, dividerY);
      targetCtx.stroke();

      // 중앙 세련된 뱃지: "✍️ [집중 풀이 공간] 아래 여백에 자유롭게 풀이하세요"
      const badgeText = '✍️ 집중 풀이 공간 (아래 여백에 자유롭게 풀이하세요)';
      targetCtx.font = 'bold 13px "Pretendard", -apple-system, sans-serif';
      const textMetrics = targetCtx.measureText(badgeText);
      const textW = textMetrics.width;
      const badgeW = textW + 28;
      const badgeH = 24;
      const badgeX = Math.round((A4_WIDTH - badgeW) / 2);
      const badgeY = Math.round(dividerY - badgeH / 2);

      // 뱃지 배경
      targetCtx.fillStyle = detectedBgColor;
      targetCtx.fillRect(badgeX, badgeY, badgeW, badgeH);

      targetCtx.fillStyle = 'rgba(99, 102, 241, 0.08)';
      targetCtx.strokeStyle = 'rgba(99, 102, 241, 0.35)';
      targetCtx.lineWidth = 1;
      targetCtx.setLineDash([]);
      targetCtx.beginPath();
      targetCtx.roundRect(badgeX, badgeY, badgeW, badgeH, 12);
      targetCtx.fill();
      targetCtx.stroke();

      // 뱃지 글씨
      targetCtx.fillStyle = '#6366f1';
      targetCtx.textBaseline = 'middle';
      targetCtx.textAlign = 'center';
      targetCtx.fillText(badgeText, A4_WIDTH / 2, dividerY);

      targetCtx.restore();
    }
  } else {
    // ------------------------------------------------------------------------
    // [B안]: 원래 위치 그대로 유지하고 나머지 영역만 마스킹
    // ------------------------------------------------------------------------
    targetCtx.drawImage(
      segmentCanvas,
      bounds.minX,
      bounds.minY,
      bounds.width,
      bounds.height
    );
  }

  const dataUrl = targetCanvas.toDataURL('image/jpeg', 0.92);

  return {
    dataUrl,
    bgColor: detectedBgColor,
    bounds,
    placement
  };
}

/**
 * 헬퍼: Image 엘리먼트 비동기 로더
 */
function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

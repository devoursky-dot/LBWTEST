/**
 * lassoFocusService.ts
 * ============================================================================
 * 올가미 집중 풀이 코어 연산 엔진 (Zero React Dependency)
 * 
 * 1. 올가미 다각형 기하학 계산 (Bounding Box, 둘레, 자석 스냅)
 * 2. 원본 화면 고해상도 슈퍼샘플링 합성 (2x High-DPI Super-sampling)
 * 3. 지능형 배경색 자동 스포이드 추출 (경계면 픽셀 샘플링)
 * 4. 고해상도 업스케일링(High-DPI Bicubic Upscaling) & 상단 중앙 스마트 재배치
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
  /** 사용자 지정 확대 배율 (0.8x ~ 2.5x) */
  userScale?: number;
  /** 사용자가 드래그 핸들로 조절한 커스텀 바운딩 박스 */
  customBounds?: PolygonBounds;
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
  scaleApplied: number;
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
 * 3. 지능형 배경색 자동 추출 (영역 내 가장 많은 색깔 - Dominant Color 알고리즘)
 * - 사용자 피드백 반영: 선택 영역 내에서 가장 빈도수가 높은 최빈 색상(Mode Color)을 배경색으로 자동 지정
 * - 글씨(검은색)나 그래프, 테두리 등 소수의 전경 픽셀에 오염되지 않고 순수 종이/문서 배경색을 100% 정확하게 추출
 */
export function sampleBackgroundColor(
  ctx: CanvasRenderingContext2D,
  _points: Point[] = [],
  bounds: PolygonBounds,
  superSample = 1.0
): string {
  try {
    const sx = Math.max(0, Math.min(ctx.canvas.width - 1, Math.round(bounds.minX * superSample)));
    const sy = Math.max(0, Math.min(ctx.canvas.height - 1, Math.round(bounds.minY * superSample)));
    const sw = Math.max(1, Math.min(ctx.canvas.width - sx, Math.round(bounds.width * superSample)));
    const sh = Math.max(1, Math.min(ctx.canvas.height - sy, Math.round(bounds.height * superSample)));

    const imgData = ctx.getImageData(sx, sy, sw, sh);
    const data = imgData.data;

    // 색상 양자화(Quantization) 히스토그램: 8단위 버킷
    const colorBuckets = new Map<number, { count: number; sumR: number; sumG: number; sumB: number }>();

    // 표본 추출 스텝: 성능을 위해 약 5,000~10,000개 픽셀 수준으로 샘플링
    const step = Math.max(1, Math.floor(Math.sqrt((sw * sh) / 10000)));

    for (let y = 0; y < sh; y += step) {
      for (let x = 0; x < sw; x += step) {
        const idx = (y * sw + x) * 4;
        const a = data[idx + 3];
        if (a < 128) continue; // 투명 픽셀 제외

        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // 8단위 양자화
        const qr = (r >> 3) << 3;
        const qg = (g >> 3) << 3;
        const qb = (b >> 3) << 3;
        const key = (qr << 16) | (qg << 8) | qb;

        const bucket = colorBuckets.get(key);
        if (bucket) {
          bucket.count++;
          bucket.sumR += r;
          bucket.sumG += g;
          bucket.sumB += b;
        } else {
          colorBuckets.set(key, { count: 1, sumR: r, sumG: g, sumB: b });
        }
      }
    }

    if (colorBuckets.size === 0) return '#ffffff';

    // 가장 많은 빈도수(최빈색) 탐색
    let maxCount = 0;
    let dominantBucket = { count: 1, sumR: 255, sumG: 255, sumB: 255 };

    for (const b of colorBuckets.values()) {
      if (b.count > maxCount) {
        maxCount = b.count;
        dominantBucket = b;
      }
    }

    const avgR = Math.round(dominantBucket.sumR / dominantBucket.count);
    const avgG = Math.round(dominantBucket.sumG / dominantBucket.count);
    const avgB = Math.round(dominantBucket.sumB / dominantBucket.count);

    // 거의 백색(RGB >= 238)이면 순백색(#ffffff)으로 깔끔하게 매칭
    if (avgR >= 238 && avgG >= 238 && avgB >= 238) {
      return '#ffffff';
    }

    return `rgb(${avgR}, ${avgG}, ${avgB})`;
  } catch (err) {
    console.warn('[LassoFocusService] 최빈 배경색 추출 실패, 기본 백색 적용:', err);
    return '#ffffff';
  }
}

/**
 * 4. 현재 페이지 시각 요소를 [2.0x 고해상도 슈퍼샘플링] 캔버스로 정밀 합성
 * 확대 시 글씨와 수식이 깨지지 않도록 원본을 2배 해상도로 렌더링합니다.
 */
export async function renderCurrentPageToCompositeCanvas(
  options: CreateFocusPageOptions,
  superSample = 2.0
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
  canvas.width = Math.round(A4_WIDTH * superSample);
  canvas.height = Math.round(A4_HEIGHT * superSample);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Composite canvas context2D 생성 실패');

  // 고화질 업스케일링 안티앨리어싱 활성화
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 2x 스케일 좌표계 설정
  ctx.save();
  ctx.scale(superSample, superSample);

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

  ctx.restore();
  return canvas;
}

/**
 * 5. 집중 풀이 페이지 배경 최종 생성 (상단 중앙 재배치 & 고해상도 업스케일링)
 */
export async function createFocusedPageBackground(
  options: CreateFocusPageOptions
): Promise<FocusPageResult> {
  const cfg: LassoFocusConfig = { ...defaultLassoFocusConfig, ...options.config };
  const placement = options.placement || 'top_center';
  const userScale = options.userScale || 1.0;
  const { lassoPoints, A4_WIDTH, A4_HEIGHT } = options;

  // 바운딩 박스 계산 (사용자가 핸들로 조절한 customBounds가 있으면 우선 적용)
  const baseBounds = getPolygonBounds(lassoPoints);
  const bounds = options.customBounds || baseBounds;

  if (bounds.width < cfg.minDimension || bounds.height < cfg.minDimension) {
    throw new Error('선택된 영역이 너무 작습니다. 문제를 조금 더 넉넉하게 둘러싸주세요.');
  }

  // 1. [고해상도 업스케일링 대비]: 2.0x 슈퍼샘플링 소스 캔버스 렌더링
  const superSample = 2.0;
  const sourceCanvas = await renderCurrentPageToCompositeCanvas(options, superSample);
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx) throw new Error('Source context 실패');

  // 2. 배경색 지능형 자동 추출
  const detectedBgColor = sampleBackgroundColor(sourceCtx, lassoPoints, bounds, superSample);

  // 3. 올가미 영역만 클리핑하여 2x 고해상도 세그먼트 캔버스에 추출
  const segmentCanvas = document.createElement('canvas');
  segmentCanvas.width = Math.round(bounds.width * superSample);
  segmentCanvas.height = Math.round(bounds.height * superSample);
  const segCtx = segmentCanvas.getContext('2d');
  if (!segCtx) throw new Error('Segment context 실패');

  segCtx.imageSmoothingEnabled = true;
  segCtx.imageSmoothingQuality = 'high';

  // 클리핑 패스 생성 (2x 스케일 적용)
  segCtx.save();
  segCtx.scale(superSample, superSample);
  segCtx.beginPath();
  const startP = lassoPoints[0];
  segCtx.moveTo(startP.x - bounds.minX, startP.y - bounds.minY);
  for (let i = 1; i < lassoPoints.length; i++) {
    segCtx.lineTo(lassoPoints[i].x - bounds.minX, lassoPoints[i].y - bounds.minY);
  }
  segCtx.closePath();
  segCtx.clip();

  // 소스 캔버스(2x)에서 해당 바운딩 박스(2x) 영역 정밀 복사
  segCtx.drawImage(
    sourceCanvas,
    Math.round(bounds.minX * superSample),
    Math.round(bounds.minY * superSample),
    Math.round(bounds.width * superSample),
    Math.round(bounds.height * superSample),
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

  targetCtx.imageSmoothingEnabled = true;
  targetCtx.imageSmoothingQuality = 'high';

  // 4-1) 전체 캔버스를 추출한 배경색으로 도색 (이질감 제로)
  targetCtx.fillStyle = detectedBgColor;
  targetCtx.fillRect(0, 0, A4_WIDTH, A4_HEIGHT);

  let appliedScale = 1.0;

  if (placement === 'top_center') {
    // ------------------------------------------------------------------------
    // [A안 (상단 중앙 재배치 + 고해상도 업스케일링)]:
    // ------------------------------------------------------------------------
    // 확대 시 상단 최대 55%까지 허용, 너비는 최대 92%까지 허용
    const maxAllowedWidth = Math.round(A4_WIDTH * 0.92);
    const maxAllowedHeight = Math.round(A4_HEIGHT * 0.52);

    // 기본 가로폭 맞춤 배율
    const baseFitScale = Math.min(
      maxAllowedWidth / bounds.width,
      maxAllowedHeight / bounds.height
    );

    // 사용자 요청 배율(userScale)을 적용하되 용지 한계선 보호
    appliedScale = Math.min(baseFitScale, (baseFitScale * userScale));
    // 단, 원본 대비 최소 0.7x ~ 최대 2.2x 클램프
    appliedScale = Math.max(0.65, Math.min(2.2, appliedScale));

    const destW = Math.round(bounds.width * appliedScale);
    const destH = Math.round(bounds.height * appliedScale);
    const destX = Math.round((A4_WIDTH - destW) / 2);
    const destY = cfg.topMargin;

    // 2x 슈퍼샘플링 세그먼트로부터 고품질 바이큐빅 업스케일 렌더링
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
      const scaleStr = userScale > 1.05 ? ` (${Math.round(userScale * 100)}% 확대)` : '';
      const badgeText = `✍️ 집중 풀이 공간${scaleStr} - 아래 여백에 자유롭게 풀이하세요`;
      targetCtx.font = 'bold 13px "Pretendard", -apple-system, sans-serif';
      const textMetrics = targetCtx.measureText(badgeText);
      const textW = textMetrics.width;
      const badgeW = textW + 30;
      const badgeH = 26;
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
      targetCtx.roundRect(badgeX, badgeY, badgeW, badgeH, 13);
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
    // [B안]: 원래 위치 그대로 유지
    // ------------------------------------------------------------------------
    targetCtx.drawImage(
      segmentCanvas,
      bounds.minX,
      bounds.minY,
      bounds.width,
      bounds.height
    );
  }

  const dataUrl = targetCanvas.toDataURL('image/jpeg', 0.94);

  return {
    dataUrl,
    bgColor: detectedBgColor,
    bounds,
    placement,
    scaleApplied: appliedScale
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

export interface ExtractedLassoItem {
  /** 크롭된 고해상도(2x) 문제 이미지 DataURL (투명/클리핑) */
  imageDataUrl: string;
  /** 영역 내 가장 많은 최빈 배경색 */
  detectedBgColor: string;
  /** 배경색으로 칠해진 A4 전체 배경 이미지 DataURL */
  bgCanvasDataUrl: string;
  /** 원본 바운딩 박스 (A4 좌표계) */
  bounds: PolygonBounds;
  /** 새 페이지에 기본 배치될 권장 크기 및 위치 */
  defaultPlacement: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * 6. 올가미 선택 영역을 독립 이미지 객체로 추출하고 최빈 배경색을 가진 새 페이지 캔버스 생성
 * - 사용자 요청: 선택 즉시 새 페이지를 삽입하고, 거기에서 이미지 크기/위치를 자유롭게 조절
 */
export async function extractLassoImageAndBackground(
  options: CreateFocusPageOptions
): Promise<ExtractedLassoItem> {
  const { lassoPoints, A4_WIDTH, A4_HEIGHT } = options;
  const bounds = options.customBounds || getPolygonBounds(lassoPoints);

  if (bounds.width < 10 || bounds.height < 10) {
    throw new Error('선택된 영역이 너무 작습니다.');
  }

  // 1. 고해상도(2.0x) 원본 페이지 렌더링
  const superSample = 2.0;
  const sourceCanvas = await renderCurrentPageToCompositeCanvas(options, superSample);
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx) throw new Error('Source context 실패');

  // 2. 최빈 배경색 자동 감지 (가장 많은 색깔 알고리즘)
  const detectedBgColor = sampleBackgroundColor(sourceCtx, lassoPoints, bounds, superSample);

  // 3. 올가미 영역만 클리핑하여 2x 고해상도 투명 PNG 생성
  const segmentCanvas = document.createElement('canvas');
  segmentCanvas.width = Math.round(bounds.width * superSample);
  segmentCanvas.height = Math.round(bounds.height * superSample);
  const segCtx = segmentCanvas.getContext('2d');
  if (!segCtx) throw new Error('Segment context 실패');

  segCtx.imageSmoothingEnabled = true;
  segCtx.imageSmoothingQuality = 'high';

  segCtx.save();
  segCtx.scale(superSample, superSample);
  segCtx.beginPath();
  const startP = lassoPoints[0];
  segCtx.moveTo(startP.x - bounds.minX, startP.y - bounds.minY);
  for (let i = 1; i < lassoPoints.length; i++) {
    segCtx.lineTo(lassoPoints[i].x - bounds.minX, lassoPoints[i].y - bounds.minY);
  }
  segCtx.closePath();
  segCtx.clip();

  segCtx.drawImage(
    sourceCanvas,
    Math.round(bounds.minX * superSample),
    Math.round(bounds.minY * superSample),
    Math.round(bounds.width * superSample),
    Math.round(bounds.height * superSample),
    0,
    0,
    bounds.width,
    bounds.height
  );
  segCtx.restore();

  const croppedImageDataUrl = segmentCanvas.toDataURL('image/png');

  // 4. 추출된 최빈 배경색으로 칠해진 A4 전체 배경 캔버스 생성
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = A4_WIDTH;
  bgCanvas.height = A4_HEIGHT;
  const bgCtx = bgCanvas.getContext('2d');
  if (bgCtx) {
    bgCtx.fillStyle = detectedBgColor;
    bgCtx.fillRect(0, 0, A4_WIDTH, A4_HEIGHT);
  }
  const bgCanvasDataUrl = bgCanvas.toDataURL('image/png');

  // 5. 새 페이지 상단 중앙 기본 권장 배치 좌표 계산
  // 너비는 A4 너비의 80% 수준으로 시원하게 기본 배치
  const maxW = Math.round(A4_WIDTH * 0.80);
  const maxH = Math.round(A4_HEIGHT * 0.45);
  const scale = Math.min(maxW / bounds.width, maxH / bounds.height, 1.8);
  const defaultW = Math.round(bounds.width * Math.max(0.7, scale));
  const defaultH = Math.round(bounds.height * Math.max(0.7, scale));
  const defaultX = Math.round((A4_WIDTH - defaultW) / 2);
  const defaultY = 60; // 상단 여백 60px

  return {
    imageDataUrl: croppedImageDataUrl,
    detectedBgColor,
    bgCanvasDataUrl,
    bounds,
    defaultPlacement: {
      x: defaultX,
      y: defaultY,
      width: defaultW,
      height: defaultH
    }
  };
}

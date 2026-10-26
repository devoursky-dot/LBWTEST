/**
 * shapeRecognizer.ts
 * ============================================================================
 * 선을 긋고 터치를 유지할 때 직선, 정원, 타원을 자동 인식 및 변환하는 퀵셰이프(QuickShape) 코어 모듈
 * (GoodNotes / Samsung Notes / Procreate 알고리즘)
 * ============================================================================
 */

import type { StrokePoint } from './drawingGeometry';

export interface RecognizedShape {
  type: 'line' | 'circle' | 'ellipse';
  points: StrokePoint[];
  center?: { x: number; y: number };
  radius?: number;
  radiusX?: number;
  radiusY?: number;
}

/**
 * 점 p에서 선분 a-b까지의 수직 거리
 */
function perpendicularDistance(p: StrokePoint, a: StrokePoint, b: StrokePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/**
 * 획 전체의 누적 이동 거리(패스 길이) 계산
 */
function calculatePathLength(points: StrokePoint[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return len;
}

/**
 * 정원(Circle) 보정 점 배열 생성 (36개 세그먼트 매끄러운 곡선)
 */
export function generateCirclePoints(
  cx: number,
  cy: number,
  radius: number,
  pressure: number = 0.5,
  steps: number = 40
): StrokePoint[] {
  const pts: StrokePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    pts.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      pressure
    });
  }
  return pts;
}

/**
 * 타원(Ellipse) 보정 점 배열 생성
 */
export function generateEllipsePoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  pressure: number = 0.5,
  steps: number = 40
): StrokePoint[] {
  const pts: StrokePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    pts.push({
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
      pressure
    });
  }
  return pts;
}

/**
 * 직선(Line) 보정 점 배열 생성
 */
export function generateLinePoints(
  start: StrokePoint,
  end: StrokePoint,
  pressure: number = 0.5
): StrokePoint[] {
  // 시작점, 중간점, 끝점 3개로 구성하여 베지에/리본 렌더링 호환 보장
  const mid: StrokePoint = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
    pressure: (start.pressure + end.pressure) / 2
  };
  return [
    { ...start, pressure },
    mid,
    { ...end, pressure }
  ];
}

/**
 * 획(StrokePoint 배열)을 분석하여 직선, 정원, 타원 중 최적의 기하학적 도형으로 자동 인식
 */
export function recognizeShape(points: StrokePoint[]): RecognizedShape | null {
  if (!points || points.length < 5) return null;

  const start = points[0];
  const end = points[points.length - 1];
  const directDistance = Math.hypot(end.x - start.x, end.y - start.y);
  const totalPathLength = calculatePathLength(points);

  if (totalPathLength < 25) return null; // 너무 작은 획은 무시

  const avgPressure = points.reduce((acc, p) => acc + (p.pressure || 0.5), 0) / points.length;

  // --------------------------------------------------------------------------
  // 1. 원(Circle) & 타원(Ellipse) 판별
  // 시작점과 끝점이 충분히 가깝거나 맞닿아 있는 경우 (폐곡선)
  // --------------------------------------------------------------------------
  const closureRatio = directDistance / totalPathLength;
  if (closureRatio < 0.28 && points.length >= 10) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let sumX = 0, sumY = 0;

    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      sumX += p.x;
      sumY += p.y;
    }

    const cx = sumX / points.length;
    const cy = sumY / points.length;
    const rx = (maxX - minX) / 2;
    const ry = (maxY - minY) / 2;

    if (rx > 10 && ry > 10) {
      // 각 점과 중심 간의 거리 분산도(원형 균일도) 검사
      const distances = points.map(p => Math.hypot(p.x - cx, p.y - cy));
      const avgR = distances.reduce((a, b) => a + b, 0) / distances.length;
      const variance = distances.reduce((acc, d) => acc + Math.pow(d - avgR, 2), 0) / distances.length;
      const stdDev = Math.sqrt(variance);
      const circularity = stdDev / avgR; // 0에 가까울수록 완벽한 원

      const aspectRatio = rx / ry;

      // 원형 균일도가 높고 가로/세로 비율이 0.78 ~ 1.28 사이면 가급적 [정원]으로 강력 보정!
      if (aspectRatio >= 0.78 && aspectRatio <= 1.28 && circularity < 0.32) {
        const radius = (rx + ry) / 2;
        return {
          type: 'circle',
          center: { x: cx, y: cy },
          radius,
          points: generateCirclePoints(cx, cy, radius, avgPressure)
        };
      }

      // 가로/세로 비율이 다르면 [타원]으로 보정
      if (circularity < 0.40) {
        return {
          type: 'ellipse',
          center: { x: cx, y: cy },
          radiusX: rx,
          radiusY: ry,
          points: generateEllipsePoints(cx, cy, rx, ry, avgPressure)
        };
      }
    }
  }

  // --------------------------------------------------------------------------
  // 2. 직선(Line) 판별
  // 시작점과 끝점을 잇는 직선과 중간 점들의 최대 수직 편차 검사
  // --------------------------------------------------------------------------
  if (directDistance > 25) {
    let maxDeviation = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const dev = perpendicularDistance(points[i], start, end);
      if (dev > maxDeviation) {
        maxDeviation = dev;
      }
    }

    const deviationRatio = maxDeviation / directDistance;
    // 오차 비율이 12% 미만이고 직선에 가깝다면 직선으로 스냅!
    if (deviationRatio < 0.12 && (directDistance / totalPathLength) > 0.88) {
      return {
        type: 'line',
        points: generateLinePoints(start, end, avgPressure)
      };
    }
  }

  return null;
}

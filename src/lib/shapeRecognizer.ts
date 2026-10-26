/**
 * shapeRecognizer.ts
 * ============================================================================
 * 선을 긋고 터치를 유지(Hold)할 때 직선, 정원, 타원을 사람의 손떨림에 맞춰
 * 똑똑하고 자연스럽게 인식하여 변환하는 퀵셰이프(QuickShape) 코어 모듈
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
  startPoint?: { x: number; y: number };
  endPoint?: { x: number; y: number };
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
 * 정원(Circle) 보정 점 배열 생성 (48개 세그먼트 매끄러운 곡선)
 */
export function generateCirclePoints(
  cx: number,
  cy: number,
  radius: number,
  pressure: number = 0.5,
  steps: number = 48
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
  steps: number = 48
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
 * 직선(Line) 보정 점 배열 생성 (시작점, 1/4, 2/4, 3/4, 끝점 세그먼트)
 */
export function generateLinePoints(
  start: StrokePoint,
  end: StrokePoint,
  pressure: number = 0.5
): StrokePoint[] {
  const pts: StrokePoint[] = [];
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
      pressure
    });
  }
  return pts;
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

  if (totalPathLength < 20) return null; // 너무 작은 획은 무시

  const avgPressure = points.reduce((acc, p) => acc + (p.pressure || 0.5), 0) / points.length;

  // --------------------------------------------------------------------------
  // 1. 원(Circle) & 타원(Ellipse) 판별
  // 시작점과 끝점이 만나는 폐곡선이거나, 회전각이 1바퀴에 가까운 경우
  // --------------------------------------------------------------------------
  const closureRatio = directDistance / totalPathLength;

  // 원 경계 박스 계산
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
  const rx = Math.max(5, (maxX - minX) / 2);
  const ry = Math.max(5, (maxY - minY) / 2);

  // 원형 궤적 검사 (점 수가 8개 이상이고 둘레 길이가 충분한 경우)
  if (points.length >= 8 && totalPathLength > 40 && (rx + ry) > 20) {
    // 시작점-끝점 간격이 둘레의 48% 이하이면 원형 후보 (손으로 그리다 덜 닫혀도 허용)
    if (closureRatio < 0.48) {
      // 중심점으로부터 각 점까지의 거리 계산
      const distances = points.map(p => Math.hypot(p.x - cx, p.y - cy));
      const avgR = distances.reduce((a, b) => a + b, 0) / distances.length;
      const variance = distances.reduce((acc, d) => acc + Math.pow(d - avgR, 2), 0) / distances.length;
      const stdDev = Math.sqrt(variance);
      const circularity = stdDev / (avgR || 1); // 0에 가까울수록 이상적인 원

      const aspectRatio = rx / ry;

      // 사용자 요청: "가급적 원(정원)으로 만들어주는 기능"
      // 가로/세로 비율이 0.65 ~ 1.54 사이이고 circularity < 0.42이면 [정원]으로 강력 보정!
      if (aspectRatio >= 0.65 && aspectRatio <= 1.54 && circularity < 0.42) {
        const radius = (rx + ry) / 2;
        return {
          type: 'circle',
          center: { x: cx, y: cy },
          radius,
          points: generateCirclePoints(cx, cy, radius, avgPressure)
        };
      }

      // 가로 또는 세로로 납작한 경우 [타원]으로 보정
      if (circularity < 0.48) {
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
  if (directDistance > 20) {
    let maxDeviation = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const dev = perpendicularDistance(points[i], start, end);
      if (dev > maxDeviation) {
        maxDeviation = dev;
      }
    }

    const deviationRatio = maxDeviation / directDistance;
    // 오차 비율이 25% 미만이고 직선 뻗음 비율이 80% 이상이면 직선으로 스냅! (손떨림 관대하게 허용)
    if (deviationRatio < 0.25 && (directDistance / totalPathLength) > 0.80) {
      return {
        type: 'line',
        startPoint: { x: start.x, y: start.y },
        endPoint: { x: end.x, y: end.y },
        points: generateLinePoints(start, end, avgPressure)
      };
    }
  }

  return null;
}

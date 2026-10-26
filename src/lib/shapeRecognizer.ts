/**
 * shapeRecognizer.ts
 * ============================================================================
 * 선을 긋고 터치를 유지(Hold)할 때 직선, 정원, 타원을 사람의 손떨림에 맞춰
 * 똑똑하고 자연스럽게 인식하여 변환하는 퀵셰이프(QuickShape) 코어 모듈
 * (GoodNotes / Samsung Notes / Procreate 알고리즘)
 * 
 * [혁신적 사용자 경험 설계]
 * 1. 멈춘 지점(Hold Point)을 원주 접점(지름의 한쪽 끝)으로 하여 직관적 중심/지름 생성
 * 2. 큰 지름과 작은 지름의 비율(55% 이상)을 고려한 정원(Circle) 우선 생성
 * 3. 기하학적 도형 변환 시 선 굵기를 균일하고 반듯한 중간 필압(0.5)으로 정돈
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
  oppositePoint?: { x: number; y: number }; // 멈춘 지점의 반대편 지름 끝점 (접점 피벗)
}

/**
 * 점 p에서 선분 a-b까지의 부호 있는 수직 거리 (좌/우 판별 포함)
 */
function signedPerpendicularDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len === 0) return 0;
  // 외적(Cross Product)을 통해 좌(+) / 우(-) 부호 있는 수직 거리 산출
  return ((px - ax) * dy - (py - ay) * dx) / len;
}

/**
 * 점 p에서 선분 a-b까지의 수직 절대 거리
 */
function perpendicularDistance(p: StrokePoint, a: StrokePoint, b: StrokePoint): number {
  return Math.abs(signedPerpendicularDistance(p.x, p.y, a.x, a.y, b.x, b.y));
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
 * - 기하 도형의 완성도를 위해 균일한 중간 필압(0.5) 적용
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
      pressure // 중간 크기 균일 필압
    });
  }
  return pts;
}

/**
 * 타원(Ellipse) 보정 점 배열 생성
 * - 기하 도형의 완성도를 위해 균일한 중간 필압(0.5) 적용
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
      pressure // 중간 크기 균일 필압
    });
  }
  return pts;
}

/**
 * 직선(Line) 보정 점 배열 생성
 * - 기하 도형의 완성도를 위해 균일한 중간 필압(0.5) 적용
 */
export function generateLinePoints(
  start: StrokePoint,
  end: StrokePoint,
  pressure: number = 0.5
): StrokePoint[] {
  const pts: StrokePoint[] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
      pressure // 중간 크기 균일 필압
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
  const end = points[points.length - 1]; // 멈춘 지점 (Hold Point)
  const directDistance = Math.hypot(end.x - start.x, end.y - start.y);
  const totalPathLength = calculatePathLength(points);

  if (totalPathLength < 20) return null; // 너무 작은 획은 무시

  // 도형으로 스냅될 때는 들쭉날쭉한 필압 대신 단정하고 깨끗한 중간 굵기(0.5)로 통일
  const uniformPressure = 0.5;

  // --------------------------------------------------------------------------
  // 1. 원(Circle) & 타원(Ellipse) 판별
  // --------------------------------------------------------------------------
  const closureRatio = directDistance / totalPathLength;

  if (points.length >= 7 && totalPathLength > 35) {
    // 멈춘 지점(end)에서 궤적 상 가장 먼 반대편 점(oppositePoint) 탐색
    let maxDistFromEnd = 0;
    let oppositePoint = start;
    let oppIndex = 0;

    for (let i = 0; i < points.length; i++) {
      const d = Math.hypot(points[i].x - end.x, points[i].y - end.y);
      if (d > maxDistFromEnd) {
        maxDistFromEnd = d;
        oppositePoint = points[i];
        oppIndex = i;
      }
    }

    // 반대편 점이 너무 시작/끝에 치우치지 않고 중간 영역에 있을 때 원형 궤적 성립
    const isLoopLike = closureRatio < 0.55 && oppIndex > 1 && oppIndex < points.length - 1;

    if (isLoopLike && maxDistFromEnd > 20) {
      // 멈춘 지점(end)과 반대편 점(oppositePoint)을 잇는 축 = 주요 지름 (Major Diameter)
      const majorDiameter = maxDistFromEnd;

      // 축에 수직인 방향의 폭(Minor Diameter) 계산
      let maxLeftDist = 0;
      let maxRightDist = 0;

      for (const p of points) {
        const dist = signedPerpendicularDistance(
          p.x,
          p.y,
          end.x,
          end.y,
          oppositePoint.x,
          oppositePoint.y
        );
        if (dist > maxLeftDist) maxLeftDist = dist;
        if (-dist > maxRightDist) maxRightDist = -dist;
      }

      const minorDiameter = maxLeftDist + maxRightDist;

      // 큰 지름과 작은 지름의 비율 (0.0 ~ 1.0)
      const diameterRatio = majorDiameter > 0 ? minorDiameter / majorDiameter : 1.0;

      // [원 vs 타원 황금 분기점]:
      // 사람이 손으로 동그라미를 그릴 때 단축/장축 비율이 55% 이상이면
      // 99% 의도는 정원(Circle)입니다! 찌그러진 손떨림을 완벽한 정원으로 보정!
      if (diameterRatio >= 0.52) {
        // [사용자 제안]: 멈춘 지점(end)을 접점(원주 상의 한 점)으로 하여 지름 형성!
        // 중심 C는 end와 oppositePoint의 정확한 중점
        const cx = (end.x + oppositePoint.x) / 2;
        const cy = (end.y + oppositePoint.y) / 2;
        const radius = majorDiameter / 2;

        return {
          type: 'circle',
          center: { x: cx, y: cy },
          radius,
          oppositePoint: { x: oppositePoint.x, y: oppositePoint.y },
          endPoint: { x: end.x, y: end.y },
          points: generateCirclePoints(cx, cy, radius, uniformPressure)
        };
      }

      // 단축이 장축의 52% 미만으로 확연하게 납작하고 길쭉할 때만 [타원(Ellipse)]으로 생성
      if (diameterRatio < 0.52 && minorDiameter > 10) {
        const cx = (end.x + oppositePoint.x) / 2;
        const cy = (end.y + oppositePoint.y) / 2;
        const rx = majorDiameter / 2;
        const ry = Math.max(8, minorDiameter / 2);

        return {
          type: 'ellipse',
          center: { x: cx, y: cy },
          radiusX: rx,
          radiusY: ry,
          oppositePoint: { x: oppositePoint.x, y: oppositePoint.y },
          endPoint: { x: end.x, y: end.y },
          points: generateEllipsePoints(cx, cy, rx, ry, uniformPressure)
        };
      }
    }
  }

  // --------------------------------------------------------------------------
  // 2. 직선(Line) 판별
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
    // 오차 비율이 24% 미만이고 직선 뻗음 비율이 80% 이상이면 직선으로 스냅!
    if (deviationRatio < 0.24 && (directDistance / totalPathLength) > 0.80) {
      return {
        type: 'line',
        startPoint: { x: start.x, y: start.y },
        endPoint: { x: end.x, y: end.y },
        points: generateLinePoints(start, end, uniformPressure)
      };
    }
  }

  return null;
}

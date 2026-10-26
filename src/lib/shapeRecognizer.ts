/**
 * shapeRecognizer.ts
 * ============================================================================
 * 선을 긋고 터치를 유지(Hold)할 때 직선, 정원, 회전 타원, 매끄러운 베지에 곡선을
 * 사람의 손떨림에 맞춰 똑똑하고 자연스럽게 인식하여 변환하는 퀵셰이프(QuickShape) 코어 모듈
 * (GoodNotes / Samsung Notes / Procreate 알고리즘)
 * 
 * [혁신적 사용자 경험 설계]
 * 1. 둥근 궤적은 99% 사용자가 의도한 "완벽한 정원(Circle)"으로 즉각 보정 (타원으로 빠지는 현상 원천 차단)
 * 2. 멈춘 지점(Hold Point)과 가장 먼 지점(Opposite Point)을 정확한 큰 지름 축으로 연결
 * 3. 직선 판별을 엄격화(오차 6% 미만)하여, 완만한 곡선이 억지로 직선으로 둔갑하는 버그 완전 차단
 * 4. 직선/원이 아닌 모든 곡선은 멈춘 지점에 매끄러운 3차 베지에(Smooth Bezier) 곡선으로 그대로 고정
 * 5. 모든 도형은 정갈하고 균일한 중간 필압(0.5)으로 제도선처럼 완성
 * ============================================================================
 */

import type { StrokePoint } from './drawingGeometry';

export interface RecognizedShape {
  type: 'line' | 'circle' | 'ellipse' | 'curve';
  points: StrokePoint[];
  center?: { x: number; y: number };
  radius?: number;
  radiusX?: number;
  radiusY?: number;
  angle?: number; // 타원의 회전각 (라디안)
  startPoint?: { x: number; y: number };
  endPoint?: { x: number; y: number };
  oppositePoint?: { x: number; y: number }; // 멈춘 지점의 반대편 지름 끝점 (접점 피벗)
}

/**
 * 점 p에서 선분 a-b까지의 수직 절대 거리
 */
function perpendicularDistance(p: StrokePoint, a: StrokePoint, b: StrokePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(((p.x - a.x) * dy - (p.y - a.y) * dx) / len);
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
 * 정원(Circle) 보정 점 배열 생성
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
 * 회전각(Angle)이 반영된 회전 타원(Rotated Ellipse) 보정 점 배열 생성
 * - 멈춘 지점과 반대편 점을 잇는 축(Angle)이 정확하게 타원의 큰 지름(장축)이 됨!
 */
export function generateRotatedEllipsePoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  angle: number = 0,
  pressure: number = 0.5,
  steps: number = 48
): StrokePoint[] {
  const pts: StrokePoint[] = [];
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  for (let i = 0; i <= steps; i++) {
    const phi = (i / steps) * Math.PI * 2;
    const localX = rx * Math.cos(phi);
    const localY = ry * Math.sin(phi);

    // 2D 회전 변환
    const rotX = localX * cosA - localY * sinA;
    const rotY = localX * sinA + localY * cosA;

    pts.push({
      x: cx + rotX,
      y: cy + rotY,
      pressure
    });
  }
  return pts;
}

/**
 * 기존 타원 생성 호환 래퍼
 */
export function generateEllipsePoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  pressure: number = 0.5,
  steps: number = 48
): StrokePoint[] {
  return generateRotatedEllipsePoints(cx, cy, rx, ry, 0, pressure, steps);
}

/**
 * 직선(Line) 보정 점 배열 생성
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
      pressure
    });
  }
  return pts;
}

/**
 * 일반 곡선을 멈춘 지점까지 매끄러운 3차 베지에 곡선으로 스무딩 생성
 */
export function generateSmoothBezierCurve(
  points: StrokePoint[],
  pressure: number = 0.5,
  sampleCount: number = 40
): StrokePoint[] {
  if (points.length < 3) return points;

  // 1) 획에서 균등하게 4~6개의 핵심 제어점(Key Control Points) 추출
  const keyIndices: number[] = [0];
  const step = Math.max(1, Math.floor((points.length - 1) / 4));
  for (let idx = step; idx < points.length - 1; idx += step) {
    keyIndices.push(idx);
  }
  keyIndices.push(points.length - 1);

  const keyPoints = keyIndices.map(i => points[i]);

  // 2) 캣멀-롬 스플라인(Catmull-Rom Spline)으로 부드러운 3차 곡선 보간
  const result: StrokePoint[] = [];

  for (let i = 0; i < keyPoints.length - 1; i++) {
    const p0 = keyPoints[Math.max(0, i - 1)];
    const p1 = keyPoints[i];
    const p2 = keyPoints[i + 1];
    const p3 = keyPoints[Math.min(keyPoints.length - 1, i + 2)];

    const stepsPerSegment = Math.max(6, Math.floor(sampleCount / (keyPoints.length - 1)));

    for (let s = 0; s < stepsPerSegment; s++) {
      const t = s / stepsPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;

      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      );
      const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
      );

      result.push({ x, y, pressure });
    }
  }

  // 마지막 멈춘 지점 부착
  const lastKey = keyPoints[keyPoints.length - 1];
  result.push({ x: lastKey.x, y: lastKey.y, pressure });

  return result;
}

/**
 * 획(StrokePoint 배열)을 분석하여 직선, 정원, 타원, 스무스 베지에 곡선 중 최적의 도형으로 자동 인식
 */
export function recognizeShape(points: StrokePoint[]): RecognizedShape | null {
  if (!points || points.length < 5) return null;

  const start = points[0];
  const end = points[points.length - 1]; // 멈춘 지점 (Hold Point)
  const directDistance = Math.hypot(end.x - start.x, end.y - start.y);
  const totalPathLength = calculatePathLength(points);

  if (totalPathLength < 16) return null; // 너무 작은 점은 무시

  const uniformPressure = 0.5;

  // --------------------------------------------------------------------------
  // 1. 직선(Line) 판별 (오차 4.5% 미만, 직선 비율 96% 이상의 명확한 직선만 인식)
  // [사용자 피드백 반영: 완만한 곡선이나 휜 선이 억지로 직선으로 둔갑하는 현상 원천 차단]
  // --------------------------------------------------------------------------
  if (directDistance > 28) {
    let maxDeviation = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const dev = perpendicularDistance(points[i], start, end);
      if (dev > maxDeviation) maxDeviation = dev;
    }

    const deviationRatio = maxDeviation / directDistance;
    if (deviationRatio < 0.045 && (directDistance / totalPathLength) > 0.96) {
      return {
        type: 'line',
        startPoint: { x: start.x, y: start.y },
        endPoint: { x: end.x, y: end.y },
        points: generateLinePoints(start, end, uniformPressure)
      };
    }
  }

  // --------------------------------------------------------------------------
  // 2. 원(Circle) & 회전 타원(Ellipse) 판별
  // [사용자 피드백 반영: 대충 그려도 99% 정원으로 인식 & 타원은 접점-반대점 축으로 큰 지름 형성]
  // --------------------------------------------------------------------------
  const closureRatio = directDistance / totalPathLength;

  // 바운딩 박스 계산
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const boxWidth = maxX - minX;
  const boxHeight = maxY - minY;
  const boxRatio = Math.min(boxWidth, boxHeight) / Math.max(boxWidth, boxHeight, 1);

  if (points.length >= 7 && totalPathLength > 28) {
    // 멈춘 지점(end)에서 궤적 상 가장 거리가 먼 반대편 점(oppositePoint) 탐색
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

    // [원형/타원 궤적 성립 조건]:
    // 시작점-끝점 간격이 패스 길이의 72% 이하이고, 반대편 점이 궤적 안쪽에 존재하는 루프 형태
    const isLoopLike = closureRatio < 0.72 && oppIndex >= 1 && oppIndex <= points.length - 2;

    if (isLoopLike && maxDistFromEnd > 18) {
      const majorDiameter = maxDistFromEnd;
      // 주요 큰 지름 축의 각도 (라디안)
      const axisAngle = Math.atan2(end.y - oppositePoint.y, end.x - oppositePoint.x);

      // 큰 지름 축(oppositePoint <-> end)에 대한 중간 점들의 최대 수직 편차(단축 반경) 계산
      let maxPerpDist = 0;
      for (const p of points) {
        const perp = Math.abs(
          -(p.x - oppositePoint.x) * (end.y - oppositePoint.y) +
          (p.y - oppositePoint.y) * (end.x - oppositePoint.x)
        ) / majorDiameter;
        if (perp > maxPerpDist) maxPerpDist = perp;
      }

      const diameterRatio = (2 * maxPerpDist) / majorDiameter;

      // [원 vs 타원 판별 혁신]:
      // 사람이 손으로 그린 둥근 궤적은 95% 정원(Circle)을 의도한 것입니다.
      // diameterRatio >= 0.40 또는 boxRatio >= 0.45이면 무조건 [완벽한 정원(Circle)]으로 강력 스냅!
      const isCircle = diameterRatio >= 0.40 || boxRatio >= 0.45;

      if (isCircle) {
        // [멈춘 지점(end)을 원주 접점으로 하고 반대편 점(oppositePoint)을 지름의 반대쪽 끝으로 하는 정원]
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

      // 확연하게 납작하고 길쭉하게 의도된 타원인 경우 [회전 타원(Ellipse)]으로 생성
      // 멈춘 지점(end)과 반대편 점(oppositePoint)을 잇는 축이 100% 큰 지름(장축)이 됨
      const cx = (end.x + oppositePoint.x) / 2;
      const cy = (end.y + oppositePoint.y) / 2;
      const rx = majorDiameter / 2;
      // 단축 반경 ry는 장축 rx보다 항상 작도록 보장 (최대 0.85 * rx)
      const ry = Math.max(6, Math.min(rx * 0.85, maxPerpDist));

      return {
        type: 'ellipse',
        center: { x: cx, y: cy },
        radiusX: rx,
        radiusY: ry,
        angle: axisAngle, // 큰 지름 축의 회전각 적용
        oppositePoint: { x: oppositePoint.x, y: oppositePoint.y },
        endPoint: { x: end.x, y: end.y },
        points: generateRotatedEllipsePoints(cx, cy, rx, ry, axisAngle, uniformPressure)
      };
    }
  }

  // --------------------------------------------------------------------------
  // 3. 일반 곡선 -> 매끄러운 3차 베지에 곡선(Smooth Bezier)으로 스무딩!
  // [사용자 피드백 반영: 멈춘 지점에 그대로 고정(Freeze)]
  // --------------------------------------------------------------------------
  if (points.length >= 6 && totalPathLength > 20) {
    const smoothPoints = generateSmoothBezierCurve(points, uniformPressure);
    return {
      type: 'curve',
      startPoint: { x: start.x, y: start.y },
      endPoint: { x: end.x, y: end.y },
      points: smoothPoints
    };
  }

  return null;
}

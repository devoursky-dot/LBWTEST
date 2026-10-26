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

export type RecognizedShapeType = 'line' | 'circle' | 'ellipse' | 'curve' | 'circular_arc' | 'elliptic_arc' | 'bezier';

export interface CircularArcFit {
  cx: number;
  cy: number;
  radius: number;
  startAngle: number;
  sweepAngle: number;
  apex: { x: number; y: number };
  errorRatio: number;
  aspectRatio: number;
}

export interface RecognizedShape {
  type: RecognizedShapeType;
  points: StrokePoint[];
  center?: { x: number; y: number };
  radius?: number;
  radiusX?: number;
  radiusY?: number;
  angle?: number; // 타원의 회전각 (라디안)
  startPoint?: { x: number; y: number };
  endPoint?: { x: number; y: number };
  oppositePoint?: { x: number; y: number }; // 멈춘 지점의 반대편 지름 끝점 (접점 피벗)
  apexPoint?: { x: number; y: number }; // 호의 정점 (최대 편차점)
  arcData?: CircularArcFit;
}

export interface EditableArcSegment {
  start: { x: number; y: number };
  end: { x: number; y: number };
  apex: { x: number; y: number };
}

export interface EditableShape {
  type: 'line' | 'arc' | 'circle';
  vertices?: { x: number; y: number }[];
  arcSegments?: EditableArcSegment[];
  circle?: {
    cx: number;
    cy: number;
    radius: number;
    pivotX: number;
    pivotY: number;
  };
  strokeProps: {
    color: string;
    size: number;
    tool: 'pen' | 'highlighter';
  };
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
  start: { x: number; y: number; pressure?: number },
  end: { x: number; y: number; pressure?: number },
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
 * 시작점, 끝점, 정점(Apex)을 지나는 '한 번 휘어진 호(Single Curved Arc)' 보정 점 배열 생성
 * - 불필요한 다중 굴곡이나 S자 왜곡 없이, 사용자가 그린 궤적의 휨 정도를 그대로 반영하는 단일 2차 베지에 호
 */
export function generateSingleArcPoints(
  start: { x: number; y: number; pressure?: number },
  end: { x: number; y: number; pressure?: number },
  apex: { x: number; y: number; pressure?: number },
  pressure: number = 0.5,
  steps: number = 36
): StrokePoint[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lenSq = dx * dx + dy * dy;

  let t0 = 0.5;
  if (lenSq > 0) {
    t0 = ((apex.x - start.x) * dx + (apex.y - start.y) * dy) / lenSq;
    t0 = Math.max(0.15, Math.min(0.85, t0));
  }

  const denom = 2 * t0 * (1 - t0);
  const pcX = (apex.x - (1 - t0) * (1 - t0) * start.x - t0 * t0 * end.x) / denom;
  const pcY = (apex.y - (1 - t0) * (1 - t0) * start.y - t0 * t0 * end.y) / denom;

  const pts: StrokePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const invT = 1 - t;
    const x = invT * invT * start.x + 2 * invT * t * pcX + t * t * end.x;
    const y = invT * invT * start.y + 2 * invT * t * pcY + t * t * end.y;
    pts.push({ x, y, pressure });
  }

  return pts;
}

/**
 * 2차 베지에 호의 시작점, 끝점, 정점(Apex)으로부터 제어점(Control Point) 역산
 */
export function getArcControlPoint(
  start: { x: number; y: number },
  end: { x: number; y: number },
  apex: { x: number; y: number }
): { x: number; y: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lenSq = dx * dx + dy * dy;

  let t0 = 0.5;
  if (lenSq > 0) {
    t0 = ((apex.x - start.x) * dx + (apex.y - start.y) * dy) / lenSq;
    t0 = Math.max(0.15, Math.min(0.85, t0));
  }

  const denom = 2 * t0 * (1 - t0);
  const pcX = (apex.x - (1 - t0) * (1 - t0) * start.x - t0 * t0 * end.x) / denom;
  const pcY = (apex.y - (1 - t0) * (1 - t0) * start.y - t0 * t0 * end.y) / denom;

  return { x: pcX, y: pcY };
}

/**
 * 이전 호의 끝점과 제어점을 바탕으로, 새 호의 시작점에서의 접선 방향을 유지하는 새 apex 계산 ($C^1$ 연속성)
 */
export function calculateTangentArcApex(
  prevCtrl: { x: number; y: number },
  prevEnd: { x: number; y: number },
  currEnd: { x: number; y: number }
): { x: number; y: number } {
  const tx = prevEnd.x - prevCtrl.x;
  const ty = prevEnd.y - prevCtrl.y;
  const tLen = Math.hypot(tx, ty);

  const dx = currEnd.x - prevEnd.x;
  const dy = currEnd.y - prevEnd.y;
  const dLen = Math.hypot(dx, dy);

  if (tLen < 0.001 || dLen < 1) {
    return { x: (prevEnd.x + currEnd.x) / 2, y: (prevEnd.y + currEnd.y) / 2 };
  }

  const ux = tx / tLen;
  const uy = ty / tLen;

  // 새 호의 시작 제어점을 접선 연장선상에 배치 ($C^1$ 연속성)
  const ctrlDist = Math.max(8, dLen * 0.5);
  const pcX = prevEnd.x + ux * ctrlDist;
  const pcY = prevEnd.y + uy * ctrlDist;

  // 2차 베지에 곡선에서 t = 0.5일 때의 위치: B(0.5) = 0.25*P0 + 0.5*Pc + 0.25*P1
  const apexX = 0.25 * prevEnd.x + 0.5 * pcX + 0.25 * currEnd.x;
  const apexY = 0.25 * prevEnd.y + 0.5 * pcY + 0.25 * currEnd.y;

  return { x: apexX, y: apexY };
}

/**
 * 편집 모드 도형(EditableShape)으로부터 렌더링용 StrokePoint 배열 재생성
 */
export function generateStrokePointsFromEditableShape(shape: EditableShape): StrokePoint[] {
  if (shape.type === 'line' && shape.vertices && shape.vertices.length >= 2) {
    const pts: StrokePoint[] = [];
    for (let i = 0; i < shape.vertices.length - 1; i++) {
      const segPts = generateLinePoints(
        { ...shape.vertices[i], pressure: 0.5 },
        { ...shape.vertices[i + 1], pressure: 0.5 },
        0.5
      );
      if (i > 0 && segPts.length > 0) {
        pts.push(...segPts.slice(1));
      } else {
        pts.push(...segPts);
      }
    }
    return pts;
  }

  if (shape.type === 'arc' && shape.arcSegments && shape.arcSegments.length > 0) {
    const pts: StrokePoint[] = [];
    for (let i = 0; i < shape.arcSegments.length; i++) {
      const seg = shape.arcSegments[i];
      const segPts = generateSingleArcPoints(
        { ...seg.start, pressure: 0.5 },
        { ...seg.end, pressure: 0.5 },
        { ...seg.apex, pressure: 0.5 },
        0.5,
        32
      );
      if (i > 0 && segPts.length > 0) {
        pts.push(...segPts.slice(1));
      } else {
        pts.push(...segPts);
      }
    }
    return pts;
  }

  if (shape.type === 'circle' && shape.circle) {
    return generateCirclePoints(shape.circle.cx, shape.circle.cy, shape.circle.radius, 0.5);
  }

  return [];
}

/**
 * 3개 점(시작점, 정점, 끝점)을 정확히 지나는 외접 원호(Circumcircle Arc) 파라미터 계산
 */
export function fitCircularArcFrom3Points(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
): { cx: number; cy: number; radius: number; startAngle: number; sweepAngle: number } | null {
  const D = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
  if (Math.abs(D) < 0.0001) return null;

  const p1Sq = p1.x * p1.x + p1.y * p1.y;
  const p2Sq = p2.x * p2.x + p2.y * p2.y;
  const p3Sq = p3.x * p3.x + p3.y * p3.y;

  const cx = (p1Sq * (p2.y - p3.y) + p2Sq * (p3.y - p1.y) + p3Sq * (p1.y - p2.y)) / D;
  const cy = (p1Sq * (p3.x - p2.x) + p2Sq * (p1.x - p3.x) + p3Sq * (p2.x - p1.x)) / D;
  const radius = Math.hypot(p1.x - cx, p1.y - cy);

  if (radius < 1 || radius > 50000) return null;

  const theta1 = Math.atan2(p1.y - cy, p1.x - cx);
  const theta2 = Math.atan2(p2.y - cy, p2.x - cx);
  const theta3 = Math.atan2(p3.y - cy, p3.x - cx);

  // CCW sweep from theta1 to theta3
  let sweepCCW = (theta3 - theta1) % (Math.PI * 2);
  if (sweepCCW <= 0) sweepCCW += Math.PI * 2;

  // CCW position of p2
  let sweepApex = (theta2 - theta1) % (Math.PI * 2);
  if (sweepApex <= 0) sweepApex += Math.PI * 2;

  let sweepAngle = sweepCCW;
  if (sweepApex > 0 && sweepApex < sweepCCW) {
    sweepAngle = sweepCCW;
  } else {
    sweepAngle = -(Math.PI * 2 - sweepCCW);
  }

  return { cx, cy, radius, startAngle: theta1, sweepAngle };
}

/**
 * 가상 중심(cx, cy), 반지름, 시작각, 회전각(sweepAngle) 기반의 원호(Circular Arc) 점 배열 생성
 * - 항아리 모양(스윕 180° ~ 330°의 열린 원형 호), 말굽, C자형 곡선을 찌그러짐 없이 완벽히 지원!
 */
export function generateCircularArcPoints(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  sweepAngle: number,
  pressure: number = 0.5,
  steps?: number
): StrokePoint[] {
  const actualSteps = steps || Math.max(16, Math.min(64, Math.round(48 * Math.abs(sweepAngle) / Math.PI)));
  const pts: StrokePoint[] = [];

  for (let i = 0; i <= actualSteps; i++) {
    const t = i / actualSteps;
    const angle = startAngle + t * sweepAngle;
    pts.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      pressure
    });
  }

  return pts;
}

/**
 * 시작점에서의 접선(Tangent) 방향을 100% 만족하는 완벽한 $C^1$ 연속 접선 원호(Tangent Arc) 점 생성
 * - 이전 호/선의 진행 접선 벡터 Tin을 상속받아 꺾임 없이 부드러운 연결 호 생성
 */
export function generateTangentArcPoints(
  startPt: { x: number; y: number },
  tangent: { x: number; y: number },
  endPt: { x: number; y: number },
  pressure: number = 0.5
): StrokePoint[] {
  const tLen = Math.hypot(tangent.x, tangent.y);
  if (tLen < 0.001) {
    return generateLinePoints(startPt, endPt, pressure);
  }
  const tx = tangent.x / tLen;
  const ty = tangent.y / tLen;

  const vx = endPt.x - startPt.x;
  const vy = endPt.y - startPt.y;
  const vDistSq = vx * vx + vy * vy;
  const vDist = Math.sqrt(vDistSq);

  if (vDist < 4) {
    return [
      { x: startPt.x, y: startPt.y, pressure },
      { x: endPt.x, y: endPt.y, pressure }
    ];
  }

  // 접선에 수직인 법선 단위벡터 (좌측 법선: N = (-ty, tx))
  const nx = -ty;
  const ny = tx;

  // vDotN = V . N
  const vDotN = vx * nx + vy * ny;

  // 드래그 방향이 접선 방향과 거의 일치하면 곡률 0인 직선으로 부드럽게 전개
  if (Math.abs(vDotN) < 0.8) {
    return generateLinePoints(startPt, endPt, pressure);
  }

  // 중심 C = startPt + r * N, 여기서 r = |V|^2 / (2 * (V . N))
  const r = vDistSq / (2 * vDotN);
  const cx = startPt.x + r * nx;
  const cy = startPt.y + r * ny;
  const radius = Math.abs(r);

  if (radius > 10000 || radius < 2) {
    return generateLinePoints(startPt, endPt, pressure);
  }

  const theta0 = Math.atan2(startPt.y - cy, startPt.x - cx);
  const theta1 = Math.atan2(endPt.y - cy, endPt.x - cx);

  // r > 0이면 startPt에서 CCW, r < 0이면 CW
  let sweepAngle = 0;
  if (r > 0) {
    let dTheta = (theta1 - theta0) % (Math.PI * 2);
    if (dTheta <= 0) dTheta += Math.PI * 2;
    sweepAngle = dTheta;
  } else {
    let dTheta = (theta0 - theta1) % (Math.PI * 2);
    if (dTheta <= 0) dTheta += Math.PI * 2;
    sweepAngle = -dTheta;
  }

  const arcPts = generateCircularArcPoints(cx, cy, radius, theta0, sweepAngle, pressure);
  if (arcPts.length > 0) {
    arcPts[0].x = startPt.x;
    arcPts[0].y = startPt.y;
    arcPts[arcPts.length - 1].x = endPt.x;
    arcPts[arcPts.length - 1].y = endPt.y;
  }

  return arcPts;
}

/**
 * 궤적 점들을 일정한 경로 간격으로 균등 리샘플링
 */
function resamplePoints(points: StrokePoint[], targetCount: number): { x: number; y: number }[] {
  if (points.length <= targetCount) {
    return points.map(p => ({ x: p.x, y: p.y }));
  }
  const totalLen = calculatePathLength(points);
  if (totalLen <= 0) {
    return points.slice(0, targetCount).map(p => ({ x: p.x, y: p.y }));
  }

  const result: { x: number; y: number }[] = [{ x: points[0].x, y: points[0].y }];
  const stepDist = totalLen / (targetCount - 1);
  let currentDist = 0;
  let targetDist = stepDist;

  for (let i = 1; i < points.length; i++) {
    const pPrev = points[i - 1];
    const pCurr = points[i];
    const segLen = Math.hypot(pCurr.x - pPrev.x, pCurr.y - pPrev.y);
    if (segLen === 0) continue;

    while (currentDist + segLen >= targetDist && result.length < targetCount - 1) {
      const ratio = (targetDist - currentDist) / segLen;
      result.push({
        x: pPrev.x + (pCurr.x - pPrev.x) * ratio,
        y: pPrev.y + (pCurr.y - pPrev.y) * ratio
      });
      targetDist += stepDist;
    }
    currentDist += segLen;
  }

  while (result.length < targetCount - 1) {
    result.push({ x: points[points.length - 1].x, y: points[points.length - 1].y });
  }
  result.push({ x: points[points.length - 1].x, y: points[points.length - 1].y });
  return result;
}

/**
 * 궤적 내에 2D 외적 부호 반전(Inflection Point, 변곡점)이 존재하는지 강건하게 검사
 * - S자 곡선, 물결선 등은 변곡점이 존재하므로 베지에 스플라인으로 처리
 */
export function hasInflectionPoints(points: StrokePoint[]): boolean {
  if (points.length < 8) return false;

  const totalLen = calculatePathLength(points);
  if (totalLen < 30) return false;

  // 손떨림 오차를 배제하기 위해 전체 길이에 따라 16개 점으로 균등 다운샘플링
  const samples = resamplePoints(points, 16);

  let posTurns = 0;
  let negTurns = 0;
  let signChanges = 0;
  let lastSign = 0;

  for (let i = 1; i < samples.length - 1; i++) {
    const v1x = samples[i].x - samples[i - 1].x;
    const v1y = samples[i].y - samples[i - 1].y;
    const v2x = samples[i + 1].x - samples[i].x;
    const v2y = samples[i + 1].y - samples[i].y;

    const cross = v1x * v2y - v1y * v2x;
    const dot = v1x * v2x + v1y * v2y;
    const angle = Math.atan2(cross, dot);

    // 9도(~0.15 rad) 이상의 유의미한 회전각만 분석
    if (Math.abs(angle) > 0.15) {
      const sign = angle > 0 ? 1 : -1;
      if (sign > 0) posTurns += angle;
      else negTurns += Math.abs(angle);

      if (lastSign !== 0 && sign !== lastSign) {
        signChanges++;
      }
      lastSign = sign;
    }
  }

  // 양방향으로 각각 20도(0.35 rad) 이상 뚜렷한 굴곡이 있고 부호 반전이 발생한 경우만 S자 곡선으로 판정
  return signChanges >= 1 && posTurns > 0.35 && negTurns > 0.35;
}

/**
 * 궤적 점들을 분석하여 원호(Circular Arc) 피팅 및 상대오차, 종횡비 계산
 */
export function fitCircularArc(points: StrokePoint[]): CircularArcFit | null {
  if (points.length < 6) return null;

  const start = points[0];
  const end = points[points.length - 1];
  const chordDist = Math.hypot(end.x - start.x, end.y - start.y);
  if (chordDist < 10) return null;

  // 시작점-끝점 현에서 가장 멀리 솟아오른 정점(Apex) 탐색
  let maxPerp = 0;
  let apex = points[Math.floor(points.length / 2)];

  for (let i = 1; i < points.length - 1; i++) {
    const dev = perpendicularDistance(points[i], start, end);
    if (dev > maxPerp) {
      maxPerp = dev;
      apex = points[i];
    }
  }

  if (maxPerp < 5) return null;

  const arcFit = fitCircularArcFrom3Points(start, apex, end);
  if (!arcFit) return null;

  // 반지름 대비 표준 편차(RMSE) 계산
  let sumSqErr = 0;
  const sampleStep = Math.max(1, Math.floor(points.length / 20));
  let count = 0;

  let minX = points[0].x, maxX = points[0].x;
  let minY = points[0].y, maxY = points[0].y;

  for (let i = 0; i < points.length; i += sampleStep) {
    const pt = points[i];
    const distToCenter = Math.hypot(pt.x - arcFit.cx, pt.y - arcFit.cy);
    const err = distToCenter - arcFit.radius;
    sumSqErr += err * err;
    count++;

    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }

  const rmse = Math.sqrt(sumSqErr / Math.max(1, count));
  const errorRatio = rmse / arcFit.radius;

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const aspectRatio = Math.min(width, height) / Math.max(width, height);

  return {
    cx: arcFit.cx,
    cy: arcFit.cy,
    radius: arcFit.radius,
    startAngle: arcFit.startAngle,
    sweepAngle: arcFit.sweepAngle,
    apex: { x: apex.x, y: apex.y },
    errorRatio,
    aspectRatio
  };
}

/**
 * 원호 드래그 시 고정 시작점과 이동 끝점에 맞춰 원호 점 재계산
 */
export function updateCircularArcPoints(
  shape: RecognizedShape,
  fixedStart: { x: number; y: number },
  targetEnd: { x: number; y: number }
): StrokePoint[] {
  const origStart = shape.startPoint || fixedStart;
  const origEnd = shape.endPoint || targetEnd;
  const origApex = shape.apexPoint || { x: (origStart.x + origEnd.x) / 2, y: (origStart.y + origEnd.y) / 2 };
  const dynamicApex = calculateUpdatedArcApex(origStart, origEnd, origApex, fixedStart, targetEnd);

  const arcFit = fitCircularArcFrom3Points(fixedStart, dynamicApex, targetEnd);
  if (arcFit) {
    const pts = generateCircularArcPoints(arcFit.cx, arcFit.cy, arcFit.radius, arcFit.startAngle, arcFit.sweepAngle, 0.5);
    if (pts.length > 0) {
      pts[0].x = fixedStart.x;
      pts[0].y = fixedStart.y;
      pts[pts.length - 1].x = targetEnd.x;
      pts[pts.length - 1].y = targetEnd.y;
    }
    return pts;
  }
  return generateSingleArcPoints(fixedStart, targetEnd, dynamicApex, 0.5);
}

/**
 * 베지에 곡선 드래그 시 고정 시작점과 이동 끝점에 맞춰 비례 아핀 변환
 */
export function updateBezierPoints(
  origPoints: StrokePoint[],
  fixedStart: { x: number; y: number },
  targetEnd: { x: number; y: number }
): StrokePoint[] {
  if (origPoints.length < 2) {
    return generateLinePoints(fixedStart, targetEnd, 0.5);
  }

  const origStart = origPoints[0];
  const origEnd = origPoints[origPoints.length - 1];

  const origDx = origEnd.x - origStart.x;
  const origDy = origEnd.y - origStart.y;
  const origLen = Math.hypot(origDx, origDy);

  const newDx = targetEnd.x - fixedStart.x;
  const newDy = targetEnd.y - fixedStart.y;
  const newLen = Math.hypot(newDx, newDy);

  if (origLen < 1 || newLen < 1) {
    return generateLinePoints(fixedStart, targetEnd, 0.5);
  }

  const origAngle = Math.atan2(origDy, origDx);
  const newAngle = Math.atan2(newDy, newDx);
  const deltaAngle = newAngle - origAngle;
  const scale = newLen / origLen;

  const cosA = Math.cos(deltaAngle);
  const sinA = Math.sin(deltaAngle);

  return origPoints.map((pt, idx) => {
    if (idx === 0) return { x: fixedStart.x, y: fixedStart.y, pressure: 0.5 };
    if (idx === origPoints.length - 1) return { x: targetEnd.x, y: targetEnd.y, pressure: 0.5 };

    const lx = pt.x - origStart.x;
    const ly = pt.y - origStart.y;

    const rotX = (lx * cosA - ly * sinA) * scale;
    const rotY = (lx * sinA + ly * cosA) * scale;

    return {
      x: fixedStart.x + rotX,
      y: fixedStart.y + rotY,
      pressure: 0.5
    };
  });
}

/**
 * 획(StrokePoint 배열)을 분석하여 직선, 정원, 베지에, 원호, 타원호로 지능형 5단계 자동 인식
 * ============================================================================
 * 1. 직선(Line): 오차 7.5% 미만, 직선 비율 90% 이상
 * 2. 원(Circle): 시작점과 끝점이 28px 이내로 닫힌 폐곡선
 * 3. 베지에 곡선(Bezier): 변곡점이 있는 S자 곡선, 물결선
 * 4. 원호(Circular Arc): 항아리 모양(열린 원), 말굽, 둥근 호 (오차 14% 이내 & 종횡비 0.70 이상)
 * 5. 타원호(Elliptic Arc): 변곡점이 없는 단일 볼록 호이나 납작하거나 길쭉한 형태
 * ============================================================================
 */
export function recognizeShape(points: StrokePoint[], _strokeSize: number = 3): RecognizedShape | null {
  if (!points || points.length < 5) return null;

  const start = points[0];
  const end = points[points.length - 1]; // 멈춘 지점 (Hold Point)
  const directDistance = Math.hypot(end.x - start.x, end.y - start.y);
  const totalPathLength = calculatePathLength(points);

  if (totalPathLength < 16) return null;

  const uniformPressure = 0.5;

  // 1. 직선(Line) 판별: 오차 7.5% 미만, 직선 비율 90% 이상
  if (directDistance > 25) {
    let maxDeviation = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const dev = perpendicularDistance(points[i], start, end);
      if (dev > maxDeviation) maxDeviation = dev;
    }

    const deviationRatio = maxDeviation / directDistance;
    if (deviationRatio < 0.075 && (directDistance / totalPathLength) > 0.90) {
      return {
        type: 'line',
        startPoint: { x: start.x, y: start.y },
        endPoint: { x: end.x, y: end.y },
        points: generateLinePoints(start, end, uniformPressure)
      };
    }
  }

  // 2. 완전한 닫힌 원(Circle) 판별: 시작점과 끝점이 28px 이내로 닫힌 경우만 원으로 인식
  const maxClosureGap = 28;
  const isClosedLoop = directDistance <= maxClosureGap &&
                       (directDistance / totalPathLength <= 0.14) &&
                       totalPathLength >= 45;

  if (isClosedLoop) {
    let maxDistFromEnd = 0;
    let oppositePoint = start;

    for (let i = 0; i < points.length; i++) {
      const d = Math.hypot(points[i].x - end.x, points[i].y - end.y);
      if (d > maxDistFromEnd) {
        maxDistFromEnd = d;
        oppositePoint = points[i];
      }
    }

    if (maxDistFromEnd > 14) {
      const radius = maxDistFromEnd / 2;
      const cx = (end.x + oppositePoint.x) / 2;
      const cy = (end.y + oppositePoint.y) / 2;

      return {
        type: 'circle',
        center: { x: cx, y: cy },
        radius,
        oppositePoint: { x: oppositePoint.x, y: oppositePoint.y },
        endPoint: { x: end.x, y: end.y },
        points: generateCirclePoints(cx, cy, radius, uniformPressure)
      };
    }
  }

  // 3. 베지에 곡선(Bezier): 변곡점(Inflection Point)이 있는 S자 곡선, 물결선
  if (hasInflectionPoints(points)) {
    return {
      type: 'bezier',
      startPoint: { x: start.x, y: start.y },
      endPoint: { x: end.x, y: end.y },
      points: generateSmoothBezierCurve(points, uniformPressure)
    };
  }

  // 4. 원호(Circular Arc): 항아리 모양(열린 원), 말굽, 둥근 호
  // - 입구는 열려있으나 원 피팅 오차가 14% 이내이고 종횡비가 0.70 이상인 경우
  // - 180도를 넘는 항아리 모양도 원 둘레를 온전히 유지하며 완벽하게 인식!
  const arcFit = fitCircularArc(points);
  if (arcFit && arcFit.errorRatio <= 0.14 && arcFit.aspectRatio >= 0.70 && Math.abs(arcFit.sweepAngle) >= 0.35) {
    const circularArcPoints = generateCircularArcPoints(
      arcFit.cx,
      arcFit.cy,
      arcFit.radius,
      arcFit.startAngle,
      arcFit.sweepAngle,
      uniformPressure
    );

    if (circularArcPoints.length > 0) {
      circularArcPoints[0].x = start.x;
      circularArcPoints[0].y = start.y;
      circularArcPoints[circularArcPoints.length - 1].x = end.x;
      circularArcPoints[circularArcPoints.length - 1].y = end.y;
    }

    return {
      type: 'circular_arc',
      startPoint: { x: start.x, y: start.y },
      endPoint: { x: end.x, y: end.y },
      apexPoint: arcFit.apex,
      arcData: arcFit,
      points: circularArcPoints
    };
  }

  // 5. 타원호(Elliptic Arc): 변곡점이 없는 단일 볼록 호이나 납작하거나 길쭉한 형태
  if (points.length >= 6 && totalPathLength > 18) {
    let maxPerp = 0;
    let apex = points[Math.floor(points.length / 2)];

    for (let i = 1; i < points.length - 1; i++) {
      const dev = perpendicularDistance(points[i], start, end);
      if (dev > maxPerp) {
        maxPerp = dev;
        apex = points[i];
      }
    }

    const arcPoints = generateSingleArcPoints(start, end, apex, uniformPressure);
    return {
      type: 'elliptic_arc',
      startPoint: { x: start.x, y: start.y },
      endPoint: { x: end.x, y: end.y },
      apexPoint: { x: apex.x, y: apex.y },
      points: arcPoints
    };
  }

  return null;
}

export interface EndpointMatch {
  x: number;
  y: number;
  strokeId: string;
  isStart: boolean;
  dist: number;
  tangent?: { x: number; y: number };
}

/**
 * 스트로크 시작점/끝점에서의 진행 접선 단위벡터 계산
 */
function computeStrokeEndTangent(points: StrokePoint[], fromEnd: boolean): { x: number; y: number } | undefined {
  if (!points || points.length < 2) return undefined;

  if (fromEnd) {
    const endPt = points[points.length - 1];
    let targetIdx = points.length - 2;
    for (let i = points.length - 2; i >= 0; i--) {
      const d = Math.hypot(endPt.x - points[i].x, endPt.y - points[i].y);
      targetIdx = i;
      if (d >= 16) break;
    }
    const dx = endPt.x - points[targetIdx].x;
    const dy = endPt.y - points[targetIdx].y;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return undefined;
    return { x: dx / len, y: dy / len };
  } else {
    const startPt = points[0];
    let targetIdx = 1;
    for (let i = 1; i < points.length; i++) {
      const d = Math.hypot(points[i].x - startPt.x, points[i].y - startPt.y);
      targetIdx = i;
      if (d >= 16) break;
    }
    const dx = startPt.x - points[targetIdx].x;
    const dy = startPt.y - points[targetIdx].y;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return undefined;
    return { x: dx / len, y: dy / len };
  }
}

/**
 * 기존 스트로크들에서 (targetX, targetY)에 가장 가까운 시작점/끝점 탐색 및 접선 방향 추출
 */
export function findNearestEndpoint(
  strokes: Array<{ id: string; points: StrokePoint[]; tool?: string }>,
  targetX: number,
  targetY: number,
  maxRadius: number = 24
): EndpointMatch | null {
  let nearest: EndpointMatch | null = null;
  let minDist = maxRadius;

  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    if (!s.points || s.points.length === 0) continue;
    if (s.tool === 'eraser') continue;

    const startPt = s.points[0];
    const endPt = s.points[s.points.length - 1];

    const distStart = Math.hypot(targetX - startPt.x, targetY - startPt.y);
    if (distStart <= minDist) {
      minDist = distStart;
      const tangent = computeStrokeEndTangent(s.points, false);
      nearest = { x: startPt.x, y: startPt.y, strokeId: s.id, isStart: true, dist: distStart, tangent };
    }

    const distEnd = Math.hypot(targetX - endPt.x, targetY - endPt.y);
    if (distEnd <= minDist) {
      minDist = distEnd;
      const tangent = computeStrokeEndTangent(s.points, true);
      nearest = { x: endPt.x, y: endPt.y, strokeId: s.id, isStart: false, dist: distEnd, tangent };
    }
  }

  return nearest;
}

/**
 * 2차 베지에 호의 끝점 이동 시 기존 곡률 비율을 유지하여 새 apex 계산
 */
export function calculateUpdatedArcApex(
  origStart: { x: number; y: number },
  origEnd: { x: number; y: number },
  origApex: { x: number; y: number },
  newStart: { x: number; y: number },
  newEnd: { x: number; y: number }
): { x: number; y: number } {
  const origDx = origEnd.x - origStart.x;
  const origDy = origEnd.y - origStart.y;
  const origLen = Math.hypot(origDx, origDy);

  if (origLen < 1) {
    return { x: (newStart.x + newEnd.x) / 2, y: (newStart.y + newEnd.y) / 2 };
  }

  // 현(Chord) 상의 투영 비율 t0를 보존하여 비대칭/기울어진 호 곡률 유지
  const t0 = ((origApex.x - origStart.x) * origDx + (origApex.y - origStart.y) * origDy) / (origLen * origLen);
  const clampedT0 = Math.max(0.05, Math.min(0.95, t0));

  const origProjX = origStart.x + clampedT0 * origDx;
  const origProjY = origStart.y + clampedT0 * origDy;

  const origNormX = -origDy / origLen;
  const origNormY = origDx / origLen;

  const origHeight = (origApex.x - origProjX) * origNormX + (origApex.y - origProjY) * origNormY;
  // 항아리 형태(180도 초과)의 깊은 호도 찌그러짐 없이 보존되도록 클램프 범위를 4.0으로 대폭 확장
  const curvatureRatio = Math.max(-4.0, Math.min(4.0, origHeight / origLen));

  const newDx = newEnd.x - newStart.x;
  const newDy = newEnd.y - newStart.y;
  const newLen = Math.hypot(newDx, newDy);

  if (newLen < 1) {
    return { x: newStart.x, y: newStart.y };
  }

  const newProjX = newStart.x + clampedT0 * newDx;
  const newProjY = newStart.y + clampedT0 * newDy;
  const newNormX = -newDy / newLen;
  const newNormY = newDx / newLen;

  const newHeight = curvatureRatio * newLen;
  return {
    x: newProjX + newHeight * newNormX,
    y: newProjY + newHeight * newNormY
  };
}

/**
 * 캔버스에 청록색/에메랄드빛 자석 스냅 앵커 링 렌더링
 */
export function drawMagneticAnchorRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string = '#06b6d4'
): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;

  // 외곽 원형 링
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.stroke();

  // 내부 앵커 코어
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

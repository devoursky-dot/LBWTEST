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
  apexPoint?: { x: number; y: number }; // 호의 정점 (최대 편차점)
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
 * 획(StrokePoint 배열)을 분석하여 직선, 정원, 한번 휘어진 호로 자동 인식
 * ============================================================================
 * [사용자 정의 3대 직관 규칙]
 * 1. 직선: 오차 7.5% 미만, 직선 비율 90% 이상 -> 직선으로 즉각 스냅 및 드래그 조절 ("직선 인식 확률 상향")
 * 2. 원: 시작점과 끝점의 거리가 펜 크기의 5배 이내인 폐곡선 -> 정원(Circle)으로 스냅 ("시작점과 끝점의 거리가 펜 크기의 5배 이내이면 곡선을 원으로")
 * 3. 곡선: 열린 곡선 -> 시작점과 끝점을 잇는 단일 곡률의 '한 번 휘어진 호(Single Curved Arc)'로 표시 ("곡선은 한번 휘어진 호로 표시를 하고")
 * ============================================================================
 */
export function recognizeShape(points: StrokePoint[], strokeSize: number = 3): RecognizedShape | null {
  if (!points || points.length < 5) return null;

  const start = points[0];
  const end = points[points.length - 1]; // 멈춘 지점 (Hold Point)
  const directDistance = Math.hypot(end.x - start.x, end.y - start.y);
  const totalPathLength = calculatePathLength(points);

  if (totalPathLength < 16) return null; // 너무 작은 점은 무시

  const uniformPressure = 0.5;

  // --------------------------------------------------------------------------
  // 1. 직선(Line) 판별: 오차 7.5% 미만, 직선 비율 90% 이상 (자연스러운 손필기 직선 즉각 인식)
  // [사용자 요청: 직선으로 인식할 확률 상향!]
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // 2. 원(Circle) 판별: 시작점과 끝점의 거리가 펜 크기의 5배 이내인 경우
  // "시작점과 끝점의 거리가 펜 크기의 5배 이내이면 곡선을 원으로"
  // --------------------------------------------------------------------------
  const maxClosureGap = Math.max(25, (strokeSize || 3) * 5);
  // 시작점과 끝점 간격이 펜 크기의 5배 이내이거나, 닫힌 루프 형태(패스 길이의 22% 이내)인 경우
  const isClosedLoop = (directDistance <= maxClosureGap || (directDistance / totalPathLength < 0.22)) && totalPathLength > 28;

  if (isClosedLoop) {
    // 멈춘 지점(end)에서 궤적 상 가장 거리가 먼 반대편 점(oppositePoint) 탐색
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

  // --------------------------------------------------------------------------
  // 3. 곡선(Curve / Arc): 한번 휘어진 호로 표시
  // "곡선은 한번 휘어진 호로 표시를 하고"
  // --------------------------------------------------------------------------
  if (points.length >= 6 && totalPathLength > 18) {
    // 시작점과 끝점을 잇는 직선에서 가장 멀리 솟아오른 정점(Apex) 탐색
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
      type: 'curve',
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
}

/**
 * 기존 스트로크들에서 (targetX, targetY)에 가장 가까운 시작점/끝점 탐색
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
      nearest = { x: startPt.x, y: startPt.y, strokeId: s.id, isStart: true, dist: distStart };
    }

    const distEnd = Math.hypot(targetX - endPt.x, targetY - endPt.y);
    if (distEnd <= minDist) {
      minDist = distEnd;
      nearest = { x: endPt.x, y: endPt.y, strokeId: s.id, isStart: false, dist: distEnd };
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

  const origMidX = (origStart.x + origEnd.x) / 2;
  const origMidY = (origStart.y + origEnd.y) / 2;

  const origNormX = -origDy / origLen;
  const origNormY = origDx / origLen;

  const origHeight = (origApex.x - origMidX) * origNormX + (origApex.y - origMidY) * origNormY;
  const curvatureRatio = Math.max(-1.0, Math.min(1.0, origHeight / origLen));

  const newDx = newEnd.x - newStart.x;
  const newDy = newEnd.y - newStart.y;
  const newLen = Math.hypot(newDx, newDy);

  if (newLen < 1) {
    return { x: newStart.x, y: newStart.y };
  }

  const newMidX = (newStart.x + newEnd.x) / 2;
  const newMidY = (newStart.y + newEnd.y) / 2;
  const newNormX = -newDy / newLen;
  const newNormY = newDx / newLen;

  const newHeight = curvatureRatio * newLen;
  return {
    x: newMidX + newHeight * newNormX,
    y: newMidY + newHeight * newNormY
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

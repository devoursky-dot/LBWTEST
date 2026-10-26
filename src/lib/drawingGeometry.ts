// ============================================================================
// [필기 기하학 및 캔버스 스트로크 렌더링 코어 모듈]
// - GoodNotes / Procreate 방식 벡터 보간 및 충돌 검사
// ============================================================================

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}

export interface Stroke {
  id: string;
  tool: 'pen' | 'highlighter' | 'eraser';
  color: string;
  size: number;
  points: StrokePoint[];
}

/**
 * 점 (px, py)에서 선분 (x1, y1)-(x2, y2)까지의 최단 거리 계산
 */
export function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

/**
 * 스트로크와 지우개 터치 반경 간의 충돌 검사 (획 단위 지우개)
 */
export function isStrokeHit(
  stroke: Stroke,
  px: number,
  py: number,
  eraserRadius: number
): boolean {
  if (!stroke.points || stroke.points.length === 0) return false;
  const threshold = eraserRadius + (stroke.size || 3) / 2;

  if (stroke.points.length === 1) {
    return Math.hypot(px - stroke.points[0].x, py - stroke.points[0].y) <= threshold;
  }

  for (let i = 0; i < stroke.points.length - 1; i++) {
    const p1 = stroke.points[i];
    const p2 = stroke.points[i + 1];
    if (distToSegment(px, py, p1.x, p1.y, p2.x, p2.y) <= threshold) {
      return true;
    }
  }
  return false;
}

/**
 * 압력 수치를 기반으로 한 자연스럽고 뚜렷한 가변 선 두께 계산
 * (살살 그으면 원래의 0.25배, 중간 1.0배, 꾹 누르면 최대 2.4배)
 */
export function calculateDynamicStrokeWidth(baseSize: number, pressure: number = 0.5): number {
  const p = Math.max(0.02, Math.min(1.0, pressure));
  const factor = 0.25 + 2.15 * Math.pow(p, 1.15);
  return Math.max(1, baseSize * factor);
}

/**
 * 단일 스트로크를 2D 캔버스 컨텍스트에 고품질로 렌더링
 * (갤럭시 S펜 & 아이패드 애플펜슬 가변 필압 지원)
 */
export function drawSingleStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  enablePressure: boolean = true
): void {
  if (!stroke.points || stroke.points.length === 0) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (stroke.tool === 'highlighter') {
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.size;
  } else if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = stroke.size;
  } else {
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.size;
  }

  const pts = stroke.points;
  const isPenWithPressure = stroke.tool === 'pen' && enablePressure;

  if (pts.length === 1) {
    const p = pts[0];
    const r = (isPenWithPressure ? calculateDynamicStrokeWidth(stroke.size, p.pressure) : stroke.size) / 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.5, r), 0, Math.PI * 2);
    ctx.fillStyle = stroke.color;
    ctx.fill();
  } else if (isPenWithPressure && pts.length > 2) {
    // 🖊️ 필압(Pressure) 지원 가변 두께 렌더링 (Galaxy S Pen & iPad Apple Pencil)
    for (let i = 1; i < pts.length; i++) {
      const p1 = pts[i - 1];
      const p2 = pts[i];
      const avgPressure = ((p1.pressure || 0.5) + (p2.pressure || 0.5)) / 2;
      const segWidth = calculateDynamicStrokeWidth(stroke.size, avgPressure);

      ctx.lineWidth = segWidth;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
  } else if (pts.length === 2) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);

    for (let i = 1; i < pts.length - 1; i++) {
      const midX = (pts[i].x + pts[i + 1].x) / 2;
      const midY = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 전체 캔버스 배경 그리드 및 모든 스트로크를 렌더링
 */
export function renderCanvasGridAndStrokes(
  canvas: HTMLCanvasElement,
  strokes: Stroke[],
  fullPageBackground: string | null,
  paperTheme: 'white' | 'dark' | 'ivory' = 'white',
  enablePressure: boolean = true
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 모눈종이 그리드 배경 (전체 배경 PDF/이미지가 없을 때만 모눈종이 표시)
  if (!fullPageBackground) {
    ctx.save();
    if (paperTheme === 'white') {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
    } else if (paperTheme === 'ivory') {
      ctx.strokeStyle = 'rgba(180, 83, 9, 0.08)';
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    }
    ctx.lineWidth = 1;
    const gridSize = 32;

    for (let x = gridSize; x < canvas.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = gridSize; y < canvas.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 완료된 모든 스트로크 렌더링
  for (const stroke of strokes) {
    drawSingleStroke(ctx, stroke, enablePressure);
  }
}

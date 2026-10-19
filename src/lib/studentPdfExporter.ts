import { jsPDF } from 'jspdf';
import { type Stroke, drawSingleStroke } from './drawingGeometry';
import type { EmbeddedImageItem } from '../components/EmbeddedImageLayer';

export interface TextItem {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
}

export interface StudentPdfExportPage {
  id: string;
  strokes: Stroke[];
  textItems: TextItem[];
  fullPageBackground?: string | null;
  images?: EmbeddedImageItem[];
}

export interface StudentPdfExportOptions {
  lessonTitle: string;
  studentInfo: {
    grade: string;
    classNum: string;
    studentNum: string;
    name: string;
  } | null;
  pages: StudentPdfExportPage[];
  orientation: 'portrait' | 'landscape';
  A4_WIDTH: number;
  A4_HEIGHT: number;
}

/**
 * 이미지 소스를 안전하게 로드하는 비동기 헬퍼
 */
function loadImageSafely(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * [학생 필기 로컬 PDF 내보내기 모듈]
 * - 다중 페이지 공책(A4 표준)을 고해상도 PDF로 렌더링하여 학생 기기(태블릿/PC)에 즉시 저장
 * - 한글 폰트 100% 보존, 전체 배경 PDF/이미지 및 임베드 스티커 이미지 완벽 합성
 * - 다크 모드 펜 색상 자동 보정(흰색 펜 -> 선명한 다크 네이비 잉크 변환)
 */
export async function exportStudentNotebookToPdf(
  options: StudentPdfExportOptions
): Promise<{ success: boolean; fileName: string }> {
  const {
    lessonTitle,
    studentInfo,
    pages,
    orientation,
    A4_WIDTH,
    A4_HEIGHT
  } = options;

  const isLandscape = orientation === 'landscape';
  const pageWidthMm = isLandscape ? 297 : 210;
  const pageHeightMm = isLandscape ? 210 : 297;

  // A4 PDF 문서 객체 생성
  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: 'a4',
    compress: true
  });

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const dateTimeStr = `${year}${month}${day}_${hours}${minutes}`;

  const studentNameStr = (studentInfo && studentInfo.name)
    ? `${studentInfo.grade}학년${studentInfo.classNum}반_${studentInfo.name}`
    : '학생필기';
  const cleanTitle = (lessonTitle || '수업필기').replace(/[/\\?%*:|"<>]/g, '_').trim();
  const fileName = `[필기저장]_${cleanTitle}_${studentNameStr}_${dateTimeStr}.pdf`;

  const totalPages = Math.max(1, pages.length);

  for (let pIdx = 0; pIdx < totalPages; pIdx++) {
    const page = pages[pIdx] || { strokes: [], textItems: [] };
    if (pIdx > 0) {
      doc.addPage('a4', orientation);
    }

    // 1. A4 고해상도 오프스크린 캔버스 생성
    const offCanvas = document.createElement('canvas');
    offCanvas.width = A4_WIDTH;
    offCanvas.height = A4_HEIGHT;
    const ctx = offCanvas.getContext('2d');
    if (!ctx) continue;

    // 2. 배경 렌더링
    let hasCustomBackground = false;
    if (page.fullPageBackground) {
      const bgImg = await loadImageSafely(page.fullPageBackground);
      if (bgImg) {
        ctx.drawImage(bgImg, 0, 0, A4_WIDTH, A4_HEIGHT);
        hasCustomBackground = true;
      }
    }

    // 전체 배경이 없는 경우: 인쇄/보관에 최적화된 깨끗한 화이트 페이퍼 및 미세 그리드 렌더링
    if (!hasCustomBackground) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, A4_WIDTH, A4_HEIGHT);

      // 모눈종이 격자
      ctx.save();
      ctx.strokeStyle = '#f1f5f9';
      ctx.lineWidth = 1;
      const gridSize = 32;
      for (let x = gridSize; x < A4_WIDTH; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, A4_HEIGHT);
        ctx.stroke();
      }
      for (let y = gridSize; y < A4_HEIGHT; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(A4_WIDTH, y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. 임베드 이미지(문제 스티커) 렌더링
    if (page.images && page.images.length > 0) {
      for (const imgItem of page.images) {
        const loadedImg = await loadImageSafely(imgItem.src);
        if (loadedImg) {
          ctx.save();
          ctx.drawImage(loadedImg, imgItem.x, imgItem.y, imgItem.width, imgItem.height);
          ctx.restore();
        }
      }
    }

    // 4. 필기 스트로크 렌더링
    // 다크 모드 캔버스에서 작성된 흰색 펜은 흰색 배경에서 검은색으로 자동 전환하여 선명하게 인쇄
    const strokesToRender: Stroke[] = (page.strokes || []).map((s) => {
      let strokeColor = s.color;
      if (!hasCustomBackground) {
        if (s.color === '#ffffff' || s.color === '#f8fafc' || s.color === '#e2e8f0') {
          strokeColor = '#0f172a'; // 선명한 다크 네이비/블랙으로 전환
        } else if (s.color === '#fde047' && s.tool === 'pen') {
          strokeColor = '#b45309'; // 펜으로 쓴 연노랑은 황토색으로 가독성 보정
        }
      }
      return {
        ...s,
        color: strokeColor
      };
    });

    for (const stroke of strokesToRender) {
      drawSingleStroke(ctx, stroke);
    }

    // 5. 텍스트 입력 아이템 렌더링
    if (page.textItems && page.textItems.length > 0) {
      for (const item of page.textItems) {
        ctx.save();
        ctx.font = `bold ${Math.max(16, item.fontSize || 18) * 1.4}px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
        ctx.fillStyle = (!hasCustomBackground && (item.color === '#ffffff' || item.color === '#fff'))
          ? '#0f172a'
          : item.color || '#0f172a';
        ctx.textBaseline = 'top';
        ctx.fillText(item.text, item.x, item.y);
        ctx.restore();
      }
    }

    // 6. 상단 학습 헤더 및 하단 페이지 번호 뱃지 렌더링
    ctx.save();
    // 상단 반투명 헤더 바
    ctx.fillStyle = hasCustomBackground ? 'rgba(15, 23, 42, 0.85)' : 'rgba(248, 250, 252, 0.95)';
    ctx.fillRect(0, 0, A4_WIDTH, 48);
    ctx.strokeStyle = hasCustomBackground ? 'rgba(255, 255, 255, 0.2)' : '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, A4_WIDTH, 48);

    ctx.font = 'bold 18px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    ctx.fillStyle = hasCustomBackground ? '#ffffff' : '#1e293b';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const studentLabel = (studentInfo && studentInfo.name)
      ? `${studentInfo.grade}학년 ${studentInfo.classNum}반 ${studentInfo.studentNum}번 ${studentInfo.name}`
      : '학생 필기';
    ctx.fillText(`📚 ${cleanTitle} | ${studentLabel}`, 20, 24);

    ctx.font = '14px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    ctx.fillStyle = hasCustomBackground ? '#cbd5e1' : '#64748b';
    ctx.textAlign = 'right';
    ctx.fillText(`${pIdx + 1} / ${totalPages} 쪽  (${year}-${month}-${day} ${hours}:${minutes})`, A4_WIDTH - 20, 24);
    ctx.restore();

    // 7. 캔버스 이미지를 jsPDF에 추가
    const imgDataUrl = offCanvas.toDataURL('image/jpeg', 0.92);
    doc.addImage(imgDataUrl, 'JPEG', 0, 0, pageWidthMm, pageHeightMm, undefined, 'FAST');
  }

  // 8. 브라우저 로컬 기기 다운로드 트리거
  doc.save(fileName);

  return { success: true, fileName };
}

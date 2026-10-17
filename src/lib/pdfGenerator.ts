import { jsPDF } from 'jspdf';
import type { ClassNoteRecord } from './supabase';

/**
 * 표지(Cover Page)를 Canvas 2D로 렌더링하여 CJK 한글 폰트가 100% 깨지지 않고
 * 선명하게 출력되도록 DataURL로 반환합니다.
 */
function renderCoverPageDataUrl(
  title: string,
  totalStudents: number,
  dateFormatted: string,
  width = 1600,
  height = 1130
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // 1. 다크 네이비 그라데이션 배경
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(0.5, '#1e293b');
  grad.addColorStop(1, '#090d16');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // 2. 골드/블루 프리미엄 장식 테두리
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 6;
  ctx.strokeRect(40, 40, width - 80, height - 80);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 2;
  ctx.strokeRect(54, 54, width - 108, height - 108);

  // 3. 중앙 원형 심볼
  ctx.fillStyle = '#2563eb';
  ctx.beginPath();
  ctx.arc(width / 2, 230, 64, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = '54px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🏫', width / 2, 230);

  // 4. 메인 타이틀 (수업 학생 필기 모음집)
  ctx.font = 'bold 56px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('수업 학생 필기 모음집', width / 2, 370);

  // 5. 세부 수업 제목
  ctx.font = 'bold 42px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.fillStyle = '#93c5fd';
  ctx.fillText(title, width / 2, 470);

  // 6. 장식 구분선
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 260, 540);
  ctx.lineTo(width / 2 + 260, 540);
  ctx.stroke();

  // 7. 메타 정보 박스
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.beginPath();
  // roundRect 호환
  const bx = width / 2 - 320;
  const by = 600;
  const bw = 640;
  const bh = 180;
  const br = 16;
  ctx.moveTo(bx + br, by);
  ctx.lineTo(bx + bw - br, by);
  ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + br);
  ctx.lineTo(bx + bw, by + bh - br);
  ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - br, by + bh);
  ctx.lineTo(bx + br, by + bh);
  ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - br);
  ctx.lineTo(bx, by + br);
  ctx.quadraticCurveTo(bx, by, bx + br, by);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.font = 'bold 28px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(`👥 제출 학생 수: 총 ${totalStudents}명`, width / 2, 655);

  ctx.font = '500 24px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(`📅 생성 일시: ${dateFormatted}`, width / 2, 725);

  // 8. 하단 라벨
  ctx.font = '500 22px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('전자칠판 스마트 드라이브 포털 (Smart Classroom System)', width / 2, 980);

  return canvas.toDataURL('image/png', 0.95);
}

/**
 * 학생 개별 필기(특정 페이지)를 오프스크린 Canvas에 고해상도로 렌더링하여 DataURL로 반환합니다.
 */
function renderStudentCanvasPageDataUrl(
  note: ClassNoteRecord,
  strokes: any[],
  textItems: any[],
  pageNumber = 1,
  totalPages = 1,
  orientation: 'landscape' | 'portrait' = 'landscape'
): string {
  const isLandscape = orientation === 'landscape';
  const width = isLandscape ? 1600 : 1130;
  const height = isLandscape ? 1130 : 1600;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // 1. 깨끗한 흰색 종이 배경
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // 2. 학습지 모눈종이 격자
  ctx.strokeStyle = '#f1f5f9';
  ctx.lineWidth = 1.5;
  const gridSize = 40;
  for (let x = gridSize; x < width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = gridSize; y < height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // 3. 학생 정보 헤더 배너 (한글 100% 렌더링)
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, 90);
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, width, 90);

  ctx.fillStyle = '#1e293b';
  ctx.font = 'bold 32px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const pageLabel = totalPages > 1 ? ` (${pageNumber}/${totalPages}p)` : '';
  ctx.fillText(
    `[학생 필기] ${note.student_grade}학년 ${note.student_class}반 ${note.student_num}번 ${note.student_name}${pageLabel}`,
    36,
    45
  );

  const dateStr = note.updated_at || note.created_at || new Date().toISOString();
  const dateFormatted = new Date(dateStr).toLocaleString('ko-KR');
  ctx.fillStyle = '#64748b';
  ctx.font = '22px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`제출 시간: ${dateFormatted}`, width - 36, 45);

  // 4. 필기 스트로크 렌더링 (Catmull-Rom 곡선)
  const offsetY = 90;

  for (const stroke of strokes) {
    if (!stroke.points || stroke.points.length === 0) continue;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 다크 모드 캔버스에서 작성된 흰색/밝은 펜을 PDF(흰 종이)에 맞게 가독성 보정
    let strokeColor = stroke.color || '#1e293b';
    if (strokeColor === '#ffffff' || strokeColor === '#f8fafc') {
      strokeColor = '#0f172a'; // 흰색 펜은 선명한 검은색으로 변환
    } else if (strokeColor === '#facc15') {
      strokeColor = '#d97706'; // 연노랑은 황토/주황 계열로 가독성 강화
    }

    if (stroke.tool === 'highlighter') {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = (stroke.size || 3) * 4;
    } else if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = (stroke.size || 3) * 5;
    } else {
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = Math.max((stroke.size || 3) * 1.5, 2.5);
    }

    if (stroke.points.length === 1) {
      ctx.beginPath();
      ctx.arc(stroke.points[0].x, stroke.points[0].y + offsetY, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = strokeColor;
      ctx.fill();
    } else if (stroke.points.length === 2) {
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y + offsetY);
      ctx.lineTo(stroke.points[1].x, stroke.points[1].y + offsetY);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y + offsetY);

      for (let i = 1; i < stroke.points.length - 1; i++) {
        const midX = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
        const midY = (stroke.points[i].y + stroke.points[i + 1].y) / 2 + offsetY;
        ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y + offsetY, midX, midY);
      }
      const last = stroke.points[stroke.points.length - 1];
      ctx.lineTo(last.x, last.y + offsetY);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 5. 텍스트 아이템 그리기
  for (const item of textItems) {
    ctx.save();
    let textColor = item.color || '#0f172a';
    if (textColor === '#ffffff' || textColor === '#f8fafc') {
      textColor = '#0f172a';
    }
    ctx.fillStyle = textColor;
    ctx.font = `600 ${(item.fontSize || 16) * 1.5}px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(item.text, item.x, item.y + offsetY + 24);
    ctx.restore();
  }

  return canvas.toDataURL('image/png', 0.95);
}

export interface GeneratePdfOptions {
  lessonTitle: string;
  customTitle?: string;
  notes: ClassNoteRecord[];
  orientation?: 'landscape' | 'portrait';
  onProgress?: (current: number, total: number, studentName: string) => void;
}

export interface GeneratedPdfResult {
  fileName: string;
  pdfBase64: string;
  pdfBlob: Blob;
  totalStudents: number;
}

/**
 * 제출된 전체 학생들의 필기를 모아 한글 깨짐이 전혀 없는 고화질 멀티페이지 PDF 파일로 생성합니다.
 */
export async function generateClassSubmissionPdf(options: GeneratePdfOptions): Promise<GeneratedPdfResult> {
  const { lessonTitle, customTitle, notes, orientation = 'landscape', onProgress } = options;

  if (!notes || notes.length === 0) {
    throw new Error('저장할 학생 필기 내역이 없습니다.');
  }

  // 날짜시간 포맷: YYYY-MM-DD_HHmm
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const dateTimeStr = `${year}-${month}-${day}_${hours}${minutes}`;

  const baseTitle = (customTitle && customTitle.trim()) ? customTitle.trim() : lessonTitle.trim();
  const cleanTitle = baseTitle.replace(/[/\\?%*:|"<>]/g, '_');
  const fileName = `${cleanTitle}_${dateTimeStr}.pdf`;

  const isLandscape = orientation === 'landscape';
  const pageWidth = isLandscape ? 297 : 210;
  const pageHeight = isLandscape ? 210 : 297;
  const margin = 8;
  const contentWidth = pageWidth - (margin * 2);
  const contentHeight = pageHeight - (margin * 2);

  // A4 PDF 문서 생성
  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: 'a4',
    compress: true
  });

  // 1. 표지 (한글 깨짐 없는 Canvas 고화질 이미지 렌더링)
  const coverImgData = renderCoverPageDataUrl(baseTitle, notes.length, now.toLocaleString('ko-KR'));
  if (coverImgData) {
    doc.addImage(coverImgData, 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
  }

  // 2. 학생별 페이지 생성 (멀티페이지 지원)
  let pageCounter = 0;
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    if (onProgress) {
      onProgress(i + 1, notes.length, note.student_name);
    }

    // 학생 데이터가 멀티페이지({ pages: [...] }) 구조인지 확인
    const strokesData = note.strokes_data || {};
    let pagesList: Array<{ strokes: any[]; textItems: any[] }> = [];

    if (strokesData.pages && Array.isArray(strokesData.pages) && strokesData.pages.length > 0) {
      pagesList = strokesData.pages;
    } else {
      // 기존 단일 페이지 호환
      pagesList = [{
        strokes: strokesData.strokes || [],
        textItems: strokesData.textItems || []
      }];
    }

    const studentOrientation = strokesData.orientation || orientation;

    for (let pIdx = 0; pIdx < pagesList.length; pIdx++) {
      pageCounter++;
      const pageData = pagesList[pIdx];

      doc.addPage('a4', studentOrientation);

      const pageImg = renderStudentCanvasPageDataUrl(
        note,
        pageData.strokes || [],
        pageData.textItems || [],
        pIdx + 1,
        pagesList.length,
        studentOrientation
      );

      if (pageImg) {
        doc.addImage(pageImg, 'PNG', margin, margin, contentWidth, contentHeight, undefined, 'FAST');
      }
    }
  }

  // 3. Base64 및 Blob 추출
  const pdfOutput = doc.output('datauristring');
  const pdfBase64 = pdfOutput.split(',')[1];
  const pdfBlob = doc.output('blob');

  return {
    fileName,
    pdfBase64,
    pdfBlob,
    totalStudents: notes.length
  };
}

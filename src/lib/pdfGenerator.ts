import { jsPDF } from 'jspdf';
import type { ClassNoteRecord } from './supabase';

/**
 * 학생 개별 필기를 오프스크린 Canvas에 고해상도로 렌더링하여 DataURL로 반환합니다.
 */
function renderStudentCanvasDataUrl(note: ClassNoteRecord, width = 1600, height = 1100): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // 1. 깨끗한 흰색 배경
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

  // 3. 학생 정보 헤더 배너
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, 90);
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, width, 90);

  ctx.fillStyle = '#1e293b';
  ctx.font = 'bold 32px sans-serif';
  ctx.fillText(
    `[학생 필기] ${note.student_grade}학년 ${note.student_class}반 ${note.student_num}번  ${note.student_name}`,
    36,
    58
  );

  const dateStr = note.updated_at || note.created_at || new Date().toISOString();
  const dateFormatted = new Date(dateStr).toLocaleString('ko-KR');
  ctx.fillStyle = '#64748b';
  ctx.font = '22px sans-serif';
  ctx.fillText(`제출 시간: ${dateFormatted}`, width - 420, 58);

  // 4. 필기 스트로크 렌더링 (Catmull-Rom 곡선)
  const strokes = note.strokes_data?.strokes || [];
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
  const textItems = note.strokes_data?.textItems || [];
  for (const item of textItems) {
    ctx.save();
    let textColor = item.color || '#0f172a';
    if (textColor === '#ffffff' || textColor === '#f8fafc') {
      textColor = '#0f172a';
    }
    ctx.fillStyle = textColor;
    ctx.font = `600 ${(item.fontSize || 16) * 1.5}px sans-serif`;
    ctx.fillText(item.text, item.x, item.y + offsetY + 24);
    ctx.restore();
  }

  return canvas.toDataURL('image/png', 0.95);
}

export interface GeneratePdfOptions {
  lessonTitle: string;
  customTitle?: string;
  notes: ClassNoteRecord[];
  onProgress?: (current: number, total: number, studentName: string) => void;
}

export interface GeneratedPdfResult {
  fileName: string;
  pdfBase64: string;
  pdfBlob: Blob;
  totalStudents: number;
}

/**
 * 제출된 전체 학생들의 필기를 모아 하나의 고화질 멀티페이지 PDF 파일로 생성합니다.
 */
export async function generateClassSubmissionPdf(options: GeneratePdfOptions): Promise<GeneratedPdfResult> {
  const { lessonTitle, customTitle, notes, onProgress } = options;

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

  // A4 가로 규격: 297mm x 210mm
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
    compress: true
  });

  const pageWidth = 297;
  const pageHeight = 210;
  const margin = 10;
  const contentWidth = pageWidth - (margin * 2);
  const contentHeight = pageHeight - (margin * 2);

  // 1. 표지 (Cover Page)
  doc.setFillColor(30, 41, 59); // 딥 네이비 슬레이트
  doc.rect(0, 0, pageWidth, pageHeight, 'F');

  // 표지 장식 테두리
  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(1.5);
  doc.rect(margin, margin, contentWidth, contentHeight);

  // 표지 텍스트
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(32);
  doc.text('수업 학생 필기 모음집', pageWidth / 2, 60, { align: 'center' });

  doc.setFontSize(22);
  doc.setTextColor(147, 197, 253);
  doc.text(baseTitle, pageWidth / 2, 85, { align: 'center' });

  doc.setFontSize(14);
  doc.setTextColor(203, 213, 225);
  doc.text(`총 제출 학생: ${notes.length}명`, pageWidth / 2, 120, { align: 'center' });
  doc.text(`생성 일시: ${now.toLocaleString('ko-KR')}`, pageWidth / 2, 132, { align: 'center' });

  doc.setFontSize(11);
  doc.setTextColor(148, 163, 184);
  doc.text('전자칠판 스마트 드라이브 시스템 자동 생성', pageWidth / 2, 180, { align: 'center' });

  // 2. 학생별 개별 페이지 생성
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    if (onProgress) {
      onProgress(i + 1, notes.length, note.student_name);
    }

    doc.addPage('a4', 'landscape');

    // 캔버스 렌더링 이미지 획득
    const imgData = renderStudentCanvasDataUrl(note);
    if (imgData) {
      doc.addImage(imgData, 'PNG', margin, margin, contentWidth, contentHeight, undefined, 'FAST');
    }

    // 하단 페이지 번호
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(9);
    doc.text(`${i + 1} / ${notes.length}`, pageWidth - margin - 5, pageHeight - 5, { align: 'right' });
  }

  // 3. Data URL 및 Base64 생성
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

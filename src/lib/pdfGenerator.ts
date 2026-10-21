import { jsPDF } from 'jspdf';
import type { ClassNoteRecord } from './supabase';

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
 * 표지(Cover Page)를 Canvas 2D로 렌더링하여 CJK 한글 폰트가 100% 깨지지 않고
 * 선명하게 출력되도록 DataURL로 반환합니다.
 */
/**
 * 표지(Cover Page)를 Canvas 2D로 렌더링하여 CJK 한글 폰트가 100% 깨지지 않고
 * 선명하게 출력되도록 DataURL로 반환합니다.
 */
function renderCoverPageDataUrl(
  title: string,
  totalStudents: number,
  dateFormatted: string,
  sortedNotes: ClassNoteRecord[] = [],
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
  grad.addColorStop(0, '#0a0e17');
  grad.addColorStop(0.5, '#131926');
  grad.addColorStop(1, '#070a10');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // 2. 골드/블루 프리미엄 장식 테두리
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 6;
  ctx.strokeRect(36, 36, width - 72, height - 72);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(48, 48, width - 96, height - 96);

  // 3. 중앙 원형 심볼
  ctx.fillStyle = '#2563eb';
  ctx.beginPath();
  ctx.arc(width / 2, 190, 56, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = '48px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🏫', width / 2, 190);

  // 4. 메인 타이틀 (수업 학생 필기 모음집)
  ctx.font = 'bold 50px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('수업 학생 필기 모음집', width / 2, 310);

  // 5. 세부 수업 제목
  ctx.font = 'bold 38px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.fillStyle = '#60a5fa';
  ctx.fillText(title, width / 2, 390);

  // 6. 장식 구분선
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 280, 440);
  ctx.lineTo(width / 2 + 280, 440);
  ctx.stroke();

  // 7. 메타 정보 박스
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1.5;
  const bx = width / 2 - 360;
  const by = 480;
  const bw = 720;
  const bh = 140;
  ctx.strokeRect(bx, by, bw, bh);
  ctx.fillRect(bx, by, bw, bh);

  ctx.font = 'bold 26px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(`👥 제출 학생 수: 총 ${totalStudents}명 (엄격 학번순 정렬)`, width / 2, 530);

  ctx.font = '500 22px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(`📅 생성 일시: ${dateFormatted}`, width / 2, 580);

  // 8. 제출 학생 명단 목록 (2줄 컴팩트 프리뷰)
  if (sortedNotes.length > 0) {
    const studentNames = sortedNotes
      .map(n => `${n.student_num}번 ${n.student_name}`)
      .join(', ');

    ctx.font = '500 19px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    ctx.fillStyle = '#94a3b8';

    // 텍스트 자르기 처리
    let line1 = studentNames;
    let line2 = '';
    if (studentNames.length > 60) {
      const splitIdx = studentNames.lastIndexOf(',', 60);
      if (splitIdx !== -1) {
        line1 = studentNames.substring(0, splitIdx);
        line2 = studentNames.substring(splitIdx + 1).trim();
        if (line2.length > 65) {
          line2 = line2.substring(0, 65) + '... 외';
        }
      }
    }

    ctx.fillText(line1, width / 2, 690);
    if (line2) {
      ctx.fillText(line2, width / 2, 730);
    }
  }

  // 9. 하단 라벨
  ctx.font = '500 20px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('전자칠판 스마트 드라이브 포털 (Smart Classroom System)', width / 2, 1020);

  return canvas.toDataURL('image/png', 0.95);
}

/**
 * 학생 개별 필기(특정 페이지)를 오프스크린 Canvas에 고해상도로 렌더링하여 DataURL로 반환합니다.
 * (다크모드 #131314 100% 유지, 배경 PDF/이미지 및 임베디드 스티커 이미지 무왜곡 1:1 합성 지원)
 */
async function renderStudentCanvasPageDataUrl(
  note: ClassNoteRecord,
  pageData: {
    strokes?: any[];
    textItems?: any[];
    fullPageBackground?: string | null;
    images?: any[];
  },
  pageNumber = 1,
  totalPages = 1,
  orientation: 'landscape' | 'portrait' = 'landscape'
): Promise<string> {
  const isLandscape = orientation === 'landscape';
  const width = isLandscape ? 1600 : 1130;
  const height = isLandscape ? 1130 : 1600;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // 1. 배경 처리 (전체 배경 이미지가 있으면 1:1 전체 배치, 없으면 다크 칠판 배경 #131314 유지)
  let hasCustomBg = false;
  if (pageData.fullPageBackground) {
    const bgImg = await loadImageSafely(pageData.fullPageBackground);
    if (bgImg) {
      // 상단 배너 없이 1:1 캔버스 전체에 무왜곡 배치
      ctx.drawImage(bgImg, 0, 0, width, height);
      hasCustomBg = true;
    }
  }

  if (!hasCustomBg) {
    // 칠판 기본 다크 테마 배경 (#131314)
    ctx.fillStyle = '#131314';
    ctx.fillRect(0, 0, width, height);

    // 미세한 모눈 격자 (다크 모드용 은은한 선)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
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
  }

  // 2. 임베디드 스티커/사진 이미지들 렌더링 (오프셋 없이 1:1 배치)
  const images = pageData.images || [];
  for (const imgItem of images) {
    if (imgItem.dataUrl) {
      const stickerImg = await loadImageSafely(imgItem.dataUrl);
      if (stickerImg) {
        ctx.save();
        ctx.drawImage(
          stickerImg,
          imgItem.x || 0,
          imgItem.y || 0,
          imgItem.width || 200,
          imgItem.height || 200
        );
        ctx.restore();
      }
    }
  }

  // 3. 필기 스트로크 렌더링 (원래 다크모드 색상 100% 보존: 흰색/형광색 왜곡 없음)
  const strokes = pageData.strokes || [];
  for (const stroke of strokes) {
    if (!stroke.points || stroke.points.length === 0) continue;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 원래 펜 색상 그대로 유지 (흰색 분필, 노란 형광펜 등 원본 충실도 100%)
    const strokeColor = stroke.color || '#ffffff';

    if (stroke.tool === 'highlighter') {
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = (stroke.size || 4) * 3.5;
    } else if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = (stroke.size || 5) * 5;
    } else {
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = Math.max((stroke.size || 3) * 1.5, 2.5);
    }

    if (stroke.points.length === 1) {
      ctx.beginPath();
      ctx.arc(stroke.points[0].x, stroke.points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = strokeColor;
      ctx.fill();
    } else if (stroke.points.length === 2) {
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      ctx.lineTo(stroke.points[1].x, stroke.points[1].y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

      for (let i = 1; i < stroke.points.length - 1; i++) {
        const midX = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
        const midY = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
        ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, midX, midY);
      }
      const last = stroke.points[stroke.points.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 4. 텍스트 아이템 그리기
  const textItems = pageData.textItems || [];
  for (const item of textItems) {
    ctx.save();
    const textColor = item.color || '#ffffff';
    ctx.fillStyle = textColor;
    ctx.font = `600 ${(item.fontSize || 16) * 1.5}px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(item.text, item.x, item.y + 24);
    ctx.restore();
  }

  // 5. 우측 하단 학생 식별 미니 뱃지 (학습지 영역을 침범하지 않고 1:1 풀화면 유지)
  ctx.save();
  const pageLabel = totalPages > 1 ? ` (${pageNumber}/${totalPages}p)` : '';
  const tagText = `${note.student_grade}학년 ${note.student_class}반 ${note.student_num}번 ${note.student_name}${pageLabel}`;
  ctx.font = 'bold 20px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  const textWidth = ctx.measureText(tagText).width;
  const tagPadding = 14;
  const tagH = 36;
  const tagW = textWidth + tagPadding * 2;
  const tagX = width - tagW - 24;
  const tagY = height - tagH - 20;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if ((ctx as any).roundRect) {
    (ctx as any).roundRect(tagX, tagY, tagW, tagH, 10);
  } else {
    ctx.rect(tagX, tagY, tagW, tagH);
  }
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f1f5f9';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(tagText, tagX + tagPadding, tagY + tagH / 2);
  ctx.restore();

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
 * 제출된 전체 학생들의 필기를 모아 [학번순 오름차순(1번~35번)]으로 정렬하고,
 * 배경 이미지 및 스트로크를 완벽 합성하여 고화질 멀티페이지 PDF 파일로 생성합니다.
 */
export async function generateClassSubmissionPdf(options: GeneratePdfOptions): Promise<GeneratedPdfResult> {
  const { lessonTitle, customTitle, notes, orientation = 'landscape', onProgress } = options;

  if (!notes || notes.length === 0) {
    throw new Error('저장할 학생 필기 내역이 없습니다.');
  }

  // 💥 학번순 엄격 자연 정렬 (학년 -> 반 -> 번호(숫자 1, 2, 10...) -> 이름)
  const sortedNotes = [...notes].sort((a, b) => {
    const gradeA = parseInt(a.student_grade || '0', 10);
    const gradeB = parseInt(b.student_grade || '0', 10);
    if (gradeA !== gradeB) return gradeA - gradeB;

    const classA = parseInt(a.student_class || '0', 10);
    const classB = parseInt(b.student_class || '0', 10);
    if (classA !== classB) return classA - classB;

    const numA = parseInt(a.student_num || '0', 10);
    const numB = parseInt(b.student_num || '0', 10);
    if (numA !== numB) return numA - numB;

    return (a.student_name || '').localeCompare(b.student_name || '', 'ko-KR');
  });

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
  const fileName = `[학번순모음집]_${cleanTitle}_${dateTimeStr}.pdf`;

  const isLandscape = orientation === 'landscape';
  const pageWidth = isLandscape ? 297 : 210;
  const pageHeight = isLandscape ? 210 : 297;

  // A4 PDF 문서 생성
  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: 'a4',
    compress: true
  });

  // 1. 표지 (한글 깨짐 없는 Canvas 1페이지 고화질 리포트 표지 렌더링)
  const coverImgData = renderCoverPageDataUrl(
    baseTitle,
    sortedNotes.length,
    now.toLocaleString('ko-KR'),
    sortedNotes,
    1600,
    1130
  );
  if (coverImgData) {
    doc.addImage(coverImgData, 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
  }

  // 2. 학생별 페이지 생성 (학번순 순회 & 비동기 고화질 합성, 여백 없이 1:1 풀화면 다크 캔버스 저장)
  for (let i = 0; i < sortedNotes.length; i++) {
    const note = sortedNotes[i];
    if (onProgress) {
      onProgress(i + 1, sortedNotes.length, `${note.student_num}번 ${note.student_name}`);
    }

    const strokesData = note.strokes_data || {};
    let pagesList: Array<{
      strokes?: any[];
      textItems?: any[];
      fullPageBackground?: string | null;
      images?: any[];
    }> = [];

    if (strokesData.pages && Array.isArray(strokesData.pages) && strokesData.pages.length > 0) {
      pagesList = strokesData.pages;
    } else {
      pagesList = [{
        strokes: strokesData.strokes || [],
        textItems: strokesData.textItems || [],
        fullPageBackground: strokesData.fullPageBackground || null,
        images: strokesData.images || []
      }];
    }

    const studentOrientation = strokesData.orientation || orientation;
    const isStudentLandscape = studentOrientation === 'landscape';
    const sPageWidth = isStudentLandscape ? 297 : 210;
    const sPageHeight = isStudentLandscape ? 210 : 297;

    for (let pIdx = 0; pIdx < pagesList.length; pIdx++) {
      const pageData = pagesList[pIdx];

      doc.addPage('a4', studentOrientation);

      const pageImg = await renderStudentCanvasPageDataUrl(
        note,
        pageData,
        pIdx + 1,
        pagesList.length,
        studentOrientation
      );

      if (pageImg) {
        doc.addImage(pageImg, 'PNG', 0, 0, sPageWidth, sPageHeight, undefined, 'FAST');
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
    totalStudents: sortedNotes.length
  };
}

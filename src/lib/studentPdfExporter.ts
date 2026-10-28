import { jsPDF } from 'jspdf';
import { type Stroke, drawSingleStroke, loadImageSafely } from './drawingGeometry';
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
 * [1페이지 전용 고화질 리포트 표지 Canvas 렌더러]
 * - 맨 앞 1페이지에 세련된 다크 테마 표지(제목, 학생/작성자 정보, 저장일시, 설명)를 배치
 * - 가로/세로(Orientation) 비율에 따라 자동 비율 조정
 */
function renderStudentCoverPageDataUrl(
  title: string,
  studentLabel: string,
  totalPages: number,
  dateFormatted: string,
  width: number,
  height: number
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

  // 2. 우아한 블루/실버 프리미엄 장식 테두리
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 6;
  ctx.strokeRect(36, 36, width - 72, height - 72);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(48, 48, width - 96, height - 96);

  // 3. 중앙 원형 아이콘
  const centerY = Math.round(height * 0.17);
  ctx.fillStyle = '#2563eb';
  ctx.beginPath();
  ctx.arc(width / 2, centerY, 52, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = '46px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('📓', width / 2, centerY);

  // 4. 메인 제목
  const titleY = Math.round(height * 0.27);
  ctx.font = 'bold 46px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('수업 필기 공책', width / 2, titleY);

  // 5. 수업 상세 제목
  const subTitleY = Math.round(height * 0.35);
  ctx.font = 'bold 36px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.fillStyle = '#60a5fa';
  ctx.fillText(title, width / 2, subTitleY);

  // 6. 구분선
  const divY = Math.round(height * 0.40);
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 240, divY);
  ctx.lineTo(width / 2 + 240, divY);
  ctx.stroke();

  // 7. 메타 정보 카드 박스
  const boxW = Math.min(width - 120, 700);
  const boxH = 220;
  const boxX = (width - boxW) / 2;
  const boxY = Math.round(height * 0.45);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(boxX, boxY, boxW, boxH);
  ctx.fillRect(boxX, boxY, boxW, boxH);

  // 메타 정보 텍스트 (4줄)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = 'bold 26px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(`👤 작성자: ${studentLabel}`, width / 2, boxY + 45);

  ctx.font = '500 22px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.fillStyle = '#cbd5e1';
  ctx.fillText(`📄 페이지 구성: 총 ${totalPages}쪽 필기 노트`, width / 2, boxY + 95);

  ctx.fillText(`📅 저장 일시: ${dateFormatted}`, width / 2, boxY + 140);

  ctx.font = '500 19px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.fillStyle = '#38bdf8';
  ctx.fillText(`✨ 칠판 다크모드 원본 필기 100% 보존`, width / 2, boxY + 182);

  // 8. 하단 설명 푸터
  ctx.font = '500 19px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('전자칠판 스마트 드라이브 포털 (Smart Classroom System)', width / 2, height - 64);

  return canvas.toDataURL('image/png', 0.95);
}

/**
 * [학생 필기 로컬 PDF 내보내기 모듈]
 * - 1페이지: 제목 및 메타정보가 담긴 독립 표지(Cover Page) 생성
 * - 2페이지부터: 상단 제목줄(헤더)을 일체 제거하고 1:1 풀화면 원본 다크모드 필기 보존
 * - 한글 폰트 100% 보존, 전체 배경 PDF/이미지 및 임베드 스티커 이미지 완벽 무왜곡 합성
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
  const dateFormatted = `${year}-${month}-${day} ${hours}:${minutes}`;

  const studentNameStr = (studentInfo && studentInfo.name)
    ? `${studentInfo.grade}학년${studentInfo.classNum}반_${studentInfo.name}`
    : '학생필기';
  const studentLabel = (studentInfo && studentInfo.name)
    ? `${studentInfo.grade}학년 ${studentInfo.classNum}반 ${studentInfo.studentNum}번 ${studentInfo.name}`
    : '선생님 전자칠판 필기 공책';

  const cleanTitle = (lessonTitle || '수업필기').replace(/[/\\?%*:|"<>]/g, '_').trim();
  const fileName = `[필기저장]_${cleanTitle}_${studentNameStr}_${dateTimeStr}.pdf`;

  const totalPages = Math.max(1, pages.length);

  // =========================================================================
  // 1. 맨 앞 1페이지: 독립 표지(Cover Page) 생성 (제목, 작성자, 일시, 설명 수록)
  // =========================================================================
  const coverImgData = renderStudentCoverPageDataUrl(
    cleanTitle,
    studentLabel,
    totalPages,
    dateFormatted,
    A4_WIDTH,
    A4_HEIGHT
  );
  if (coverImgData) {
    doc.addImage(coverImgData, 'PNG', 0, 0, pageWidthMm, pageHeightMm, undefined, 'FAST');
  }

  // =========================================================================
  // 2. 2페이지부터: 각 필기 페이지 렌더링 (상단 제목줄 없이 1:1 풀화면 다크 캔버스)
  // =========================================================================
  for (let pIdx = 0; pIdx < totalPages; pIdx++) {
    const page = pages[pIdx] || { strokes: [], textItems: [] };
    
    // 항상 새 페이지 추가 (1페이지는 표지이므로)
    doc.addPage('a4', orientation);

    // A4 고해상도 오프스크린 캔버스 생성
    const offCanvas = document.createElement('canvas');
    offCanvas.width = A4_WIDTH;
    offCanvas.height = A4_HEIGHT;
    const ctx = offCanvas.getContext('2d');
    if (!ctx) continue;

    // (1) 배경 렌더링 (상단 제목줄 없이 0, 0부터 1:1 전체 배치)
    let hasCustomBackground = false;
    if (page.fullPageBackground) {
      const bgImg = await loadImageSafely(page.fullPageBackground);
      if (bgImg) {
        ctx.drawImage(bgImg, 0, 0, A4_WIDTH, A4_HEIGHT);
        hasCustomBackground = true;
      }
    }

    // 전체 배경이 없는 경우: 칠판 기본 다크 테마 배경 (#131314) 및 미세 그리드 렌더링
    if (!hasCustomBackground) {
      ctx.fillStyle = '#131314';
      ctx.fillRect(0, 0, A4_WIDTH, A4_HEIGHT);

      // 모눈종이 격자 (다크 모드용 미세 선)
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
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

    // (2) 임베드 이미지(문제 스티커) 렌더링
    if (page.images && page.images.length > 0) {
      for (const imgItem of page.images) {
        const imgUrl = imgItem.src || (imgItem as any).dataUrl;
        if (!imgUrl) continue;
        const loadedImg = await loadImageSafely(imgUrl);
        if (loadedImg) {
          ctx.save();
          ctx.drawImage(loadedImg, imgItem.x, imgItem.y, imgItem.width, imgItem.height);
          ctx.restore();
        }
      }
    }

    // (3) 필기 스트로크 렌더링 (다크 모드 원본 색상 100% 보존)
    for (const stroke of (page.strokes || [])) {
      drawSingleStroke(ctx, stroke);
    }

    // (4) 텍스트 입력 아이템 렌더링 (다크모드 원본 색상 보존)
    if (page.textItems && page.textItems.length > 0) {
      for (const item of page.textItems) {
        ctx.save();
        ctx.font = `bold ${Math.max(16, item.fontSize || 18) * 1.4}px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
        ctx.fillStyle = item.color || '#ffffff';
        ctx.textBaseline = 'top';
        ctx.fillText(item.text, item.x, item.y);
        ctx.restore();
      }
    }

    // (5) 상단 제목줄은 완전히 제거!
    // 대신 학습지를 침범하지 않도록 우측 하단에 초소형 미니 식별 태그만 은은하게 렌더링
    ctx.save();
    const tagText = `${pIdx + 1} / ${totalPages} 쪽 | ${studentLabel}`;
    ctx.font = 'bold 16px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    const textWidth = ctx.measureText(tagText).width;
    const tagPadding = 12;
    const tagH = 32;
    const tagW = textWidth + tagPadding * 2;
    const tagX = A4_WIDTH - tagW - 20;
    const tagY = A4_HEIGHT - tagH - 16;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if ((ctx as any).roundRect) {
      (ctx as any).roundRect(tagX, tagY, tagW, tagH, 8);
    } else {
      ctx.rect(tagX, tagY, tagW, tagH);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(tagText, tagX + tagPadding, tagY + tagH / 2);
    ctx.restore();

    // (6) 캔버스 이미지를 jsPDF에 추가 (1:1 풀 해상도)
    const imgDataUrl = offCanvas.toDataURL('image/jpeg', 0.92);
    doc.addImage(imgDataUrl, 'JPEG', 0, 0, pageWidthMm, pageHeightMm, undefined, 'FAST');
  }

  // 3. 브라우저 로컬 기기 다운로드 트리거
  doc.save(fileName);

  return { success: true, fileName };
}

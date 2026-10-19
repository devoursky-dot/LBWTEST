import type { Stroke } from './drawingGeometry';
import type { EmbeddedImageItem } from '../components/EmbeddedImageLayer';

export interface TextItem {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
}

export interface LessonPage {
  id: string;
  strokes: Stroke[];
  textItems: TextItem[];
  fullPageBackground?: string | null;
  images?: EmbeddedImageItem[];
}

export interface StudentNotebookFile {
  fileType: 'lbw_student_notebook';
  version: 'a4_v3';
  exportedAt: string;
  lessonTitle: string;
  studentInfo: {
    grade: string;
    classNum: string;
    studentNum: string;
    name: string;
  } | null;
  pages: LessonPage[];
  currentPageIndex: number;
  orientation: 'portrait' | 'landscape';
  A4_WIDTH: number;
  A4_HEIGHT: number;
}

/**
 * 학생 공책 전체(모든 쪽, 획, 텍스트, 이미지, 배경)를 다시 편집 가능한 .lbwnote 파일로 로컬 저장
 */
export function exportNotebookToFile(params: {
  lessonTitle: string;
  studentInfo: {
    grade: string;
    classNum: string;
    studentNum: string;
    name: string;
  } | null;
  pages: LessonPage[];
  currentPageIndex: number;
  orientation: 'portrait' | 'landscape';
  A4_WIDTH: number;
  A4_HEIGHT: number;
}): { success: boolean; fileName: string } {
  const { lessonTitle, studentInfo, pages, currentPageIndex, orientation, A4_WIDTH, A4_HEIGHT } = params;

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
  const fileName = `[필기파일]_${cleanTitle}_${studentNameStr}_${dateTimeStr}.lbwnote`;

  const notebookData: StudentNotebookFile = {
    fileType: 'lbw_student_notebook',
    version: 'a4_v3',
    exportedAt: now.toISOString(),
    lessonTitle: cleanTitle,
    studentInfo,
    pages,
    currentPageIndex: Math.max(0, Math.min(currentPageIndex, pages.length - 1)),
    orientation,
    A4_WIDTH,
    A4_HEIGHT
  };

  const jsonString = JSON.stringify(notebookData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

  return { success: true, fileName };
}

/**
 * 로컬 기기에서 선택한 .lbwnote 또는 .json 필기 파일을 파싱하여 복원 가능한 데이터로 변환
 */
export async function importNotebookFromFile(file: File): Promise<StudentNotebookFile> {
  const text = await file.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('올바른 JSON 또는 .lbwnote 파일 형식이 아닙니다.');
  }

  // 멀티페이지 데이터 정규화 및 구버전 호환 검증
  let pages: LessonPage[] = [];
  if (Array.isArray(parsed.pages) && parsed.pages.length > 0) {
    pages = parsed.pages.map((p: any, idx: number) => ({
      id: p.id || `page_${idx + 1}`,
      strokes: Array.isArray(p.strokes) ? p.strokes : [],
      textItems: Array.isArray(p.textItems) ? p.textItems : [],
      fullPageBackground: p.fullPageBackground || null,
      images: Array.isArray(p.images) ? p.images : []
    }));
  } else if (Array.isArray(parsed.strokes)) {
    // 1쪽 단일 레거시 호환
    pages = [{
      id: 'page_1',
      strokes: parsed.strokes,
      textItems: Array.isArray(parsed.textItems) ? parsed.textItems : [],
      fullPageBackground: parsed.fullPageBackground || null,
      images: Array.isArray(parsed.images) ? parsed.images : []
    }];
  } else {
    throw new Error('파일 내에 필기 공책 페이지 데이터가 존재하지 않습니다.');
  }

  const orientation = parsed.orientation === 'landscape' ? 'landscape' : 'portrait';
  const a4Width = parsed.A4_WIDTH || (orientation === 'landscape' ? 3508 : 2480);
  const a4Height = parsed.A4_HEIGHT || (orientation === 'landscape' ? 2480 : 3508);

  return {
    fileType: 'lbw_student_notebook',
    version: 'a4_v3',
    exportedAt: parsed.exportedAt || new Date().toISOString(),
    lessonTitle: parsed.lessonTitle || '',
    studentInfo: parsed.studentInfo || null,
    pages,
    currentPageIndex: typeof parsed.currentPageIndex === 'number' ? parsed.currentPageIndex : 0,
    orientation,
    A4_WIDTH: a4Width,
    A4_HEIGHT: a4Height
  };
}

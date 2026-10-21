/**
 * 학생 세션 및 수업별 독립 공책 저장소 통합 관리 모듈
 * 
 * - 핵심 아키텍처:
 *   1. 공용 태블릿 완벽 대비: [수업 ID(lessonId) + 학생 학번(studentId)] 복합 키로 독립 저장.
 *   2. 학생 자율권: [공책 새로 쓰기] 및 로컬 캐시 초기화 지원.
 *   3. QR 수업 접속 파라미터 표준화 및 중복 파싱 제거.
 *   4. 레거시(구버전) 단독 키에 대한 100% 무손실 하위 호환성 유지.
 */

import { parseStudentId } from './auth';

export interface StudentInfo {
  grade: string;
  classNum: string;
  studentNum: string;
  name: string;
}

export interface LessonParam {
  lessonId: string;
  title: string;
  pdfId?: string;
  pdfName?: string;
}

const STORAGE_KEY_STUDENT_INFO = 'lbw_student_info';

/**
 * 1. 학생 기본 세션 정보 읽기
 */
export function getSavedStudentInfo(): StudentInfo | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_STUDENT_INFO);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.grade && parsed.classNum && parsed.studentNum) {
      return parsed as StudentInfo;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 2. 학생 기본 세션 정보 저장
 */
export function saveSavedStudentInfo(info: StudentInfo): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_STUDENT_INFO, JSON.stringify(info));
  } catch (err) {
    console.warn('saveSavedStudentInfo warning:', err);
  }
}

/**
 * 3. 학생 기본 세션 정보 삭제 (로그아웃 / 다른 학생으로 전환)
 */
export function clearSavedStudentInfo(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY_STUDENT_INFO);
  } catch {}
}

/**
 * 4. StudentInfo -> 4자리 학번(예: "1101", "2315") 변환
 */
export function studentInfoToId(info: StudentInfo): string {
  const numInt = parseInt(info.studentNum, 10);
  const numPad = isNaN(numInt) ? '01' : (numInt < 10 ? '0' + numInt : String(numInt));
  return `${info.grade}${info.classNum}${numPad}`;
}

/**
 * 5. 4자리 학번 + 이름 -> StudentInfo 변환
 */
export function idToStudentInfo(id: string, name: string): StudentInfo | null {
  const parsed = parseStudentId(id);
  if (!parsed.valid) return null;
  return {
    grade: parsed.grade,
    classNum: parsed.classNum,
    studentNum: parsed.studentNum,
    name: name.trim() || `${parsed.grade}-${parsed.classNum} ${parsed.studentNum}번`
  };
}

/**
 * 6. 학생별 + 수업별 독립 공책 저장 키 생성 (공용 태블릿 완벽 대응)
 */
export function getStudentDraftKey(lessonId: string, studentId?: string | null): string {
  const cleanStudent = studentId?.trim() || 'guest';
  return `lbw_active_draft_${lessonId}_${cleanStudent}_v3`;
}

export function getStudentBackupKey(lessonId: string, studentId?: string | null): string {
  const cleanStudent = studentId?.trim() || 'guest';
  return `lbw_lesson_${lessonId}_${cleanStudent}_note_v3`;
}

/**
 * 7. 공책 드래프트 로드 (하위 호환성: 학생별 키 우선 -> 없을 경우 레거시 단독 키 폴백)
 */
export function loadStudentDraft(lessonId: string, studentId?: string | null): { draft: any; isLegacy: boolean } | null {
  if (typeof window === 'undefined') return null;
  try {
    const studentDraftKey = getStudentDraftKey(lessonId, studentId);
    let raw = localStorage.getItem(studentDraftKey) || sessionStorage.getItem(studentDraftKey);

    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.pages) && parsed.pages.length > 0) {
        return { draft: parsed, isLegacy: false };
      }
    }

    // 하위 호환성: 이전 버전 레거시 키 확인 (수업 ID 단독 키)
    const legacyDraftKey = `lbw_active_draft_${lessonId}_v3`;
    const legacySessionKey = `lbw_session_draft_${lessonId}`;
    raw = localStorage.getItem(legacyDraftKey) || sessionStorage.getItem(legacySessionKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.pages) && parsed.pages.length > 0) {
        return { draft: parsed, isLegacy: true };
      }
    }

    return null;
  } catch (err) {
    console.warn('loadStudentDraft err:', err);
    return null;
  }
}

/**
 * 8. 공책 드래프트 저장 (학생별 + 수업별 독립 키로 보관)
 */
export function saveStudentDraft(lessonId: string, studentId: string | null, draft: any): void {
  if (typeof window === 'undefined') return;
  try {
    const studentDraftKey = getStudentDraftKey(lessonId, studentId);
    const draftJson = JSON.stringify(draft);
    localStorage.setItem(studentDraftKey, draftJson);
    sessionStorage.setItem(studentDraftKey, draftJson);
  } catch (err) {
    console.warn('saveStudentDraft err:', err);
  }
}

/**
 * 9. 공책 드래프트 삭제 (학생의 "공책 새로 쓰기" 시 해당 학생+수업의 임시 저장 초기화)
 */
export function clearStudentDraft(lessonId: string, studentId?: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    const studentDraftKey = getStudentDraftKey(lessonId, studentId);
    localStorage.removeItem(studentDraftKey);
    sessionStorage.removeItem(studentDraftKey);
    // 레거시 키도 함께 정리
    localStorage.removeItem(`lbw_active_draft_${lessonId}_v3`);
    sessionStorage.removeItem(`lbw_session_draft_${lessonId}`);
  } catch {}
}

/**
 * 10. URL 쿼리 스트링에서 수업 파라미터 파싱 (중복 코드 제거)
 */
export function parseLessonParam(search: string): LessonParam | null {
  if (!search) return null;
  try {
    const params = new URLSearchParams(search);
    const lessonId = params.get('lessonId');
    if (!lessonId) return null;

    let title = params.get('title') || '';
    try {
      title = decodeURIComponent(title);
    } catch {}

    const pdfId = params.get('pdfId') || undefined;
    let pdfName = params.get('pdfName') || undefined;
    if (pdfName) {
      try {
        pdfName = decodeURIComponent(pdfName);
      } catch {}
    }

    return {
      lessonId,
      title: title || '디지털 스마트 수업',
      pdfId,
      pdfName
    };
  } catch (err) {
    console.warn('parseLessonParam err:', err);
    return null;
  }
}

/**
 * 11. 수업 URL 생성 헬퍼
 */
export function buildLessonUrl(baseOrigin: string, param: LessonParam): string {
  let url = `${baseOrigin}/?lessonId=${encodeURIComponent(param.lessonId)}&title=${encodeURIComponent(param.title)}`;
  if (param.pdfId) {
    url += `&pdfId=${encodeURIComponent(param.pdfId)}`;
    if (param.pdfName) {
      url += `&pdfName=${encodeURIComponent(param.pdfName)}`;
    }
  }
  return url;
}

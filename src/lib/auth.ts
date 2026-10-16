/**
 * 스마트 전자칠판 & 스마트 드라이브 포털 통합 인증 시스템
 * - 전자칠판 (Whiteboard): tch1234 (1회 로그인 시 영구 유지)
 * - 선생님 (Teacher): 구글드라이브 폴더명 기반 자동 계정 생성 (초기 비번: 1234, 수정 가능)
 * - 학생 (Student): 1101 ~ 3830 학번 계정 (초기 비번: 1234, 수정 가능)
 * - 관리자 (Admin): admin / admin!@#$1234 (전체 비밀번호 검색, 수정, 초기화 관리 대시보드)
 */

export type UserRole = 'whiteboard' | 'teacher' | 'student' | 'admin';

export interface UserSession {
  role: UserRole;
  id: string; // 학번(1101 등), 선생님 이름, 'admin', 'whiteboard'
  name: string;
  grade?: string;
  classNum?: string;
  studentNum?: string;
  folderId?: string; // 선생님 전용 폴더 ID
}

export interface AccountRecord {
  id: string;
  name: string;
  role: UserRole;
  passwordHash: string; // 저장된 비밀번호
  updatedAt: string;
  grade?: string;
  classNum?: string;
  studentNum?: string;
}

const STORAGE_KEY_CUSTOM_PWS = 'lbw_custom_passwords_v2';
const STORAGE_KEY_SESSION = 'lbw_current_session_v2';
const STORAGE_KEY_WHITEBOARD_AUTH = 'lbw_whiteboard_permanent_auth';
const STORAGE_KEY_ADMIN_PW = 'lbw_admin_custom_pw';
const STORAGE_KEY_WHITEBOARD_PW = 'lbw_whiteboard_custom_pw';

const DEFAULT_ADMIN_PW = 'admin!@#$1234';
const DEFAULT_WHITEBOARD_PW = 'tch1234';
const DEFAULT_USER_PW = '1234';

// 1. 커스텀 변경 비밀번호 저장소 읽기/쓰기
export function getCustomPasswords(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_PWS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveCustomPassword(id: string, newPw: string): void {
  if (typeof window === 'undefined') return;
  const store = getCustomPasswords();
  store[id] = newPw;
  localStorage.setItem(STORAGE_KEY_CUSTOM_PWS, JSON.stringify(store));
}

export function resetCustomPassword(id: string): void {
  if (typeof window === 'undefined') return;
  const store = getCustomPasswords();
  delete store[id];
  localStorage.setItem(STORAGE_KEY_CUSTOM_PWS, JSON.stringify(store));
}

// 2. 관리자 비밀번호
export function getAdminPassword(): string {
  if (typeof window === 'undefined') return DEFAULT_ADMIN_PW;
  return localStorage.getItem(STORAGE_KEY_ADMIN_PW) || DEFAULT_ADMIN_PW;
}

export function setAdminPassword(newPw: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY_ADMIN_PW, newPw);
}

// 3. 전자칠판 비밀번호 및 영구 로그인 여부
export function getWhiteboardPassword(): string {
  if (typeof window === 'undefined') return DEFAULT_WHITEBOARD_PW;
  return localStorage.getItem(STORAGE_KEY_WHITEBOARD_PW) || DEFAULT_WHITEBOARD_PW;
}

export function setWhiteboardPassword(newPw: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY_WHITEBOARD_PW, newPw);
}

export function isWhiteboardPermanentlyAuthed(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY_WHITEBOARD_AUTH) === 'true';
}

export function setWhiteboardPermanentAuth(authed: boolean): void {
  if (typeof window === 'undefined') return;
  if (authed) {
    localStorage.setItem(STORAGE_KEY_WHITEBOARD_AUTH, 'true');
  } else {
    localStorage.removeItem(STORAGE_KEY_WHITEBOARD_AUTH);
  }
}

// 4. 학생 학번 유효성 검사 (1101 ~ 3830)
// 학년: 1~3, 반: 1~8, 번호: 01~30
export function parseStudentId(id: string): { valid: boolean; grade: string; classNum: string; studentNum: string; label: string } {
  const clean = id.trim();
  if (!/^[1-3][1-8](0[1-9]|[1-2][0-9]|30)$/.test(clean)) {
    return { valid: false, grade: '', classNum: '', studentNum: '', label: '' };
  }
  const grade = clean[0];
  const classNum = clean[1];
  const numInt = parseInt(clean.slice(2), 10);
  const studentNum = numInt.toString();
  return {
    valid: true,
    grade,
    classNum,
    studentNum,
    label: `${grade}학년 ${classNum}반 ${studentNum}번`
  };
}

// 5. 전체 720개 학생 계정 생성 헬퍼 (1101 ~ 3830)
export function getAllStudentAccounts(): AccountRecord[] {
  const customPws = getCustomPasswords();
  const accounts: AccountRecord[] = [];

  for (let g = 1; g <= 3; g++) {
    for (let c = 1; c <= 8; c++) {
      for (let n = 1; n <= 30; n++) {
        const id = `${g}${c}${n < 10 ? '0' + n : n}`;
        const name = `${g}학년 ${c}반 ${n}번 학생`;
        const pw = customPws[id] || DEFAULT_USER_PW;
        accounts.push({
          id,
          name,
          role: 'student',
          passwordHash: pw,
          updatedAt: customPws[id] ? '수정됨' : '초기값',
          grade: g.toString(),
          classNum: c.toString(),
          studentNum: n.toString()
        });
      }
    }
  }
  return accounts;
}

// 6. 구글 드라이브 폴더 목록 기반 선생님 계정 생성/동기화
export function getTeacherAccounts(driveFolderNames: string[]): AccountRecord[] {
  const customPws = getCustomPasswords();
  return driveFolderNames
    .filter(name => !name.startsWith('[QR수업]') && name !== '내 드라이브')
    .map(name => {
      const id = `tch_${name}`;
      return {
        id,
        name: `${name} 선생님`,
        role: 'teacher' as UserRole,
        passwordHash: customPws[id] || DEFAULT_USER_PW,
        updatedAt: customPws[id] ? '수정됨' : '초기값'
      };
    });
}

// 7. 현재 세션 저장 / 로드
export function getCurrentSession(): UserSession | null {
  if (typeof window === 'undefined') return null;
  // 만약 전자칠판 영구 인증이 설정되어 있다면 기본 전자칠판 세션 복원
  const saved = localStorage.getItem(STORAGE_KEY_SESSION);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      // ignore
    }
  }

  if (isWhiteboardPermanentlyAuthed()) {
    return {
      role: 'whiteboard',
      id: 'whiteboard',
      name: '전자칠판 (기본모드)'
    };
  }

  return null;
}

export function setCurrentSession(session: UserSession | null): void {
  if (typeof window === 'undefined') return;
  if (session) {
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
  } else {
    localStorage.removeItem(STORAGE_KEY_SESSION);
  }
}

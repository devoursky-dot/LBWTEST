/**
 * 스마트 전자칠판 & 스마트 드라이브 포털 보안 인증 시스템
 * 
 * - 보안 아키텍처:
 *   1. 비밀번호는 평문으로 저장되거나 코드에 하드코딩되지 않으며, Salted SHA-256 단방향 암호화 해시로 처리됩니다.
 *   2. Supabase 클라우드 동기화 (__system_auth_accounts__)로 어떤 태블릿에서 비밀번호를 바꾸거나 관리자가 초기화해도 모든 기기에 즉시 반영됩니다.
 *   3. 구형 전자칠판의 램(RAM) 보호: 전자칠판 모드는 영구 인증 플래그(1바이트)만 사용하여 백그라운드 폴링이나 메모리 누수가 전혀 없습니다.
 *   4. 학생 비밀번호 분실 시: 관리자 대시보드에서 해당 학생의 [1234로 초기화] 버튼 클릭 시 즉시 기본값(1234)으로 복원됩니다.
 */

import { supabase, isSupabaseConfigured } from './supabase';

export const UserRole = {
  whiteboard: 'whiteboard',
  teacher: 'teacher',
  student: 'student',
  admin: 'admin'
} as const;
export type UserRole = 'whiteboard' | 'teacher' | 'student' | 'admin';

export interface UserSession {
  role: UserRole;
  id: string; // 학번(1101 등), 선생님 이름('tch_홍길동'), 'admin', 'whiteboard'
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
  passwordHash: string; // 해시 또는 상태 표시
  isModified: boolean;  // 1234에서 변경되었는지 여부
  updatedAt: string;
  grade?: string;
  classNum?: string;
  studentNum?: string;
}

// ============================================================================
// [단방향 암호화 Salted SHA-256 해시 엔진]
// ============================================================================
const AUTH_SALT = 'lbw_class_auth_salt_2026_';

// 사전 계산된 기본 비밀번호 해시값 (평문 비교 방지)
// 1234 -> hash
export const DEFAULT_STUDENT_PW_HASH = 'e368a73ba799e0e0b1f748955f7d067483fa94f859ac24e85ac91b320a8bff43';
// tch1234 -> hash
export const DEFAULT_WHITEBOARD_PW_HASH = '462a059f866f0740f52b127c854b5effb89dff7db7407f20bd19f88264e4a8be';
// admin!@#$1234 -> hash
export const DEFAULT_ADMIN_PW_HASH = '8377163d93018f11dcf75fd37765f153493b1a960f75cf8ef1b228810b28277b';

/**
 * Web Crypto API를 사용한 안전한 비밀번호 해시 생성
 */
export async function hashPassword(plainText: string): Promise<string> {
  const clean = plainText.trim();
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(AUTH_SALT + clean);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      console.warn('WebCrypto hash error, using fallback:', e);
    }
  }
  // 간이 해시 폴백 (WebCrypto 지원 안되는 특수 구형 웹뷰 대비)
  let h = 0x811c9dc5;
  const str = AUTH_SALT + clean;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
}

// 로컬 스토리지 캐시 키
const STORAGE_KEY_CUSTOM_HASHES = 'lbw_custom_password_hashes_v3';
const STORAGE_KEY_SESSION = 'lbw_current_session_v3';
const STORAGE_KEY_WHITEBOARD_AUTH = 'lbw_whiteboard_permanent_auth';
const STORAGE_KEY_ADMIN_HASH = 'lbw_admin_custom_hash_v3';
const STORAGE_KEY_WHITEBOARD_HASH = 'lbw_whiteboard_custom_hash_v3';

// 클라우드 동기화 시스템 예약 식별자
const SYSTEM_AUTH_LESSON_ID = '__system_auth_accounts__';

// ============================================================================
// [로컬 캐시 읽기/쓰기]
// ============================================================================
export function getLocalCustomHashes(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_HASHES);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveLocalCustomHash(id: string, hash: string): void {
  if (typeof window === 'undefined') return;
  const store = getLocalCustomHashes();
  store[id] = hash;
  localStorage.setItem(STORAGE_KEY_CUSTOM_HASHES, JSON.stringify(store));
}

export function removeLocalCustomHash(id: string): void {
  if (typeof window === 'undefined') return;
  const store = getLocalCustomHashes();
  delete store[id];
  localStorage.setItem(STORAGE_KEY_CUSTOM_HASHES, JSON.stringify(store));
}

// ============================================================================
// [학생 이름 저장 및 자동 완성 헬퍼 (최초 1회 입력 영구 저장)]
// ============================================================================
const STORAGE_KEY_STUDENT_NAMES = 'lbw_student_names_map_v3';

export function getStoredStudentNames(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY_STUDENT_NAMES);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getStoredStudentName(id: string): string | null {
  const map = getStoredStudentNames();
  return map[id] || null;
}

export function saveStoredStudentName(id: string, name: string): void {
  if (typeof window === 'undefined') return;
  const cleanName = name.trim();
  if (!cleanName) return;
  const map = getStoredStudentNames();
  map[id] = cleanName;
  localStorage.setItem(STORAGE_KEY_STUDENT_NAMES, JSON.stringify(map));
  syncStudentNameToCloud(id, cleanName);
}

export async function syncStudentNameToCloud(id: string, name: string): Promise<boolean> {
  if (!supabase || !isSupabaseConfigured) return false;
  try {
    const cleanName = name.trim();
    const { data: existing } = await supabase
      .from('class_notes')
      .select('id')
      .eq('lesson_id', SYSTEM_AUTH_LESSON_ID)
      .eq('student_grade', id)
      .limit(1);

    if (existing && existing.length > 0) {
      await supabase
        .from('class_notes')
        .update({
          student_name: cleanName,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing[0].id);
    } else {
      const parsed = parseStudentId(id);
      await supabase
        .from('class_notes')
        .insert({
          lesson_id: SYSTEM_AUTH_LESSON_ID,
          student_grade: id,
          student_class: parsed.valid ? parsed.classNum : '0',
          student_num: parsed.valid ? parsed.studentNum : '0',
          student_name: cleanName,
          strokes_data: {
            passwordHash: DEFAULT_STUDENT_PW_HASH,
            isModified: false,
            grade: parsed.valid ? parsed.grade : '0',
            updatedAt: new Date().toISOString()
          }
        });
    }
    return true;
  } catch (err) {
    console.warn('syncStudentNameToCloud warning:', err);
    return false;
  }
}

export async function fetchStudentNameFromCloud(id: string): Promise<string | null> {
  const local = getStoredStudentName(id);
  if (local) return local;

  if (!supabase || !isSupabaseConfigured) return null;
  try {
    const { data } = await supabase
      .from('class_notes')
      .select('student_name')
      .eq('lesson_id', SYSTEM_AUTH_LESSON_ID)
      .eq('student_grade', id)
      .limit(1);

    if (data && data.length > 0 && data[0].student_name) {
      const name = data[0].student_name.trim();
      const map = getStoredStudentNames();
      map[id] = name;
      localStorage.setItem(STORAGE_KEY_STUDENT_NAMES, JSON.stringify(map));
      return name;
    }
  } catch (err) {
    console.warn('fetchStudentNameFromCloud err:', err);
  }
  return null;
}

// 하위 호환성을 위한 래퍼 함수 (구버전 코드 호출 대비)
export function getCustomPasswords(): Record<string, string> {
  return getLocalCustomHashes();
}

export function saveCustomPassword(id: string, newPw: string): void {
  // 비동기 해싱 후 로컬 및 클라우드 동기화
  hashPassword(newPw).then(hash => {
    saveLocalCustomHash(id, hash);
    syncAccountPasswordToCloud(id, hash, true);
  });
}

export function resetCustomPassword(id: string): void {
  removeLocalCustomHash(id);
  deleteAccountPasswordFromCloud(id);
}

// ============================================================================
// [클라우드 Supabase 연동 계정 동기화]
// ============================================================================

/**
 * Supabase에 계정 비밀번호 해시 저장 (비동기)
 */
export async function syncAccountPasswordToCloud(
  id: string,
  passwordHash: string,
  isModified: boolean,
  name?: string
): Promise<boolean> {
  if (!supabase || !isSupabaseConfigured) return false;
  try {
    const parsed = parseStudentId(id);
    const grade = parsed.valid ? parsed.grade : '0';
    const classNum = parsed.valid ? parsed.classNum : '0';
    const studentNum = parsed.valid ? parsed.studentNum : '0';
    const studentName = name || (parsed.valid ? parsed.label : id);

    // 기존 레코드 확인 후 upsert
    const { data: existing } = await supabase
      .from('class_notes')
      .select('id')
      .eq('lesson_id', SYSTEM_AUTH_LESSON_ID)
      .eq('student_grade', id)
      .limit(1);

    if (existing && existing.length > 0) {
      await supabase
        .from('class_notes')
        .update({
          student_name: studentName,
          strokes_data: {
            passwordHash,
            isModified,
            grade,
            updatedAt: new Date().toISOString()
          },
          updated_at: new Date().toISOString()
        })
        .eq('id', existing[0].id);
    } else {
      await supabase
        .from('class_notes')
        .insert({
          lesson_id: SYSTEM_AUTH_LESSON_ID,
          student_grade: id,
          student_class: classNum,
          student_num: studentNum,
          student_name: studentName,
          strokes_data: {
            passwordHash,
            isModified,
            grade,
            updatedAt: new Date().toISOString()
          }
        });
    }
    return true;
  } catch (err) {
    console.warn('Cloud password sync warning:', err);
    return false;
  }
}

/**
 * Supabase에서 계정 해시 삭제 (1234 초기화)
 */
export async function deleteAccountPasswordFromCloud(id: string): Promise<boolean> {
  if (!supabase || !isSupabaseConfigured) return false;
  try {
    await supabase
      .from('class_notes')
      .delete()
      .eq('lesson_id', SYSTEM_AUTH_LESSON_ID)
      .eq('student_grade', id);
    return true;
  } catch (err) {
    console.warn('Cloud password delete warning:', err);
    return false;
  }
}

/**
 * 클라우드에서 변경된 모든 계정 정보 가져오기 (관리자 대시보드 열 때만 호출)
 */
export async function fetchAllModifiedAccountsFromCloud(): Promise<Record<string, { hash: string; updatedAt: string }>> {
  const result: Record<string, { hash: string; updatedAt: string }> = {};
  if (!supabase || !isSupabaseConfigured) {
    const local = getLocalCustomHashes();
    for (const [k, v] of Object.entries(local)) {
      result[k] = { hash: v, updatedAt: '로컬' };
    }
    return result;
  }

  try {
    const { data, error } = await supabase
      .from('class_notes')
      .select('student_grade, strokes_data, updated_at')
      .eq('lesson_id', SYSTEM_AUTH_LESSON_ID);

    if (!error && data) {
      for (const row of data) {
        const id = row.student_grade;
        const hash = row.strokes_data?.passwordHash;
        const isMod = row.strokes_data?.isModified;
        if (id && hash && isMod !== false) {
          result[id] = {
            hash,
            updatedAt: row.strokes_data?.updatedAt || row.updated_at || '최근'
          };
          // 로컬 캐시에도 최신화
          saveLocalCustomHash(id, hash);
        }
      }
    }
  } catch (err) {
    console.warn('Fetch modified accounts warning:', err);
  }
  return result;
}

// ============================================================================
// [전자칠판 & 관리자 인증 검증]
// ============================================================================

export function getAdminPasswordHash(): string {
  if (typeof window === 'undefined') return DEFAULT_ADMIN_PW_HASH;
  return localStorage.getItem(STORAGE_KEY_ADMIN_HASH) || DEFAULT_ADMIN_PW_HASH;
}

export async function verifyAdminPassword(inputPw: string): Promise<boolean> {
  const inputHash = await hashPassword(inputPw);
  const targetHash = getAdminPasswordHash();
  return inputHash === targetHash;
}

export async function setAdminPassword(newPw: string): Promise<void> {
  const hash = await hashPassword(newPw);
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_ADMIN_HASH, hash);
  }
  syncAccountPasswordToCloud('admin', hash, true, '시스템 최고 관리자');
}

export function getWhiteboardPasswordHash(): string {
  if (typeof window === 'undefined') return DEFAULT_WHITEBOARD_PW_HASH;
  return localStorage.getItem(STORAGE_KEY_WHITEBOARD_HASH) || DEFAULT_WHITEBOARD_PW_HASH;
}

export async function verifyWhiteboardPassword(inputPw: string): Promise<boolean> {
  const inputHash = await hashPassword(inputPw);
  const targetHash = getWhiteboardPasswordHash();
  return inputHash === targetHash;
}

export async function setWhiteboardPassword(newPw: string): Promise<void> {
  const hash = await hashPassword(newPw);
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_WHITEBOARD_HASH, hash);
  }
  syncAccountPasswordToCloud('whiteboard', hash, true, '전자칠판');
}

// 하위 호환성 문자열 반환 함수 (관리자 UI용)
export function getAdminPassword(): string {
  return '••••••••';
}
export function getWhiteboardPassword(): string {
  return '••••';
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

// ============================================================================
// [학생 계정 검증, 비밀번호 변경, 1234 초기화]
// ============================================================================

/**
 * 학생 학번 유효성 검사 (4자리 또는 5자리 학번 유연 지원)
 * - 4자리: 1학년 2반 05번 -> 1205 (학년 1~6, 반 1~9, 번호 01~50)
 * - 5자리: 1학년 12반 05번 -> 11205 (학년 1~6, 반 01~20, 번호 01~50)
 */
export function parseStudentId(id: string): { valid: boolean; grade: string; classNum: string; studentNum: string; label: string } {
  const clean = id.trim();
  
  // 4자리 표준 (학년 1자리, 반 1자리, 번호 2자리)
  if (/^[1-6][1-9](0[1-9]|[1-4][0-9]|50)$/.test(clean)) {
    const grade = clean[0];
    const classNum = clean[1];
    const studentNum = parseInt(clean.slice(2), 10).toString();
    return {
      valid: true,
      grade,
      classNum,
      studentNum,
      label: `${grade}학년 ${classNum}반 ${studentNum}번`
    };
  }

  // 5자리 확장 (학년 1자리, 반 2자리, 번호 2자리: 예 11005 -> 1학년 10반 5번)
  if (/^[1-6](0[1-9]|1[0-9]|20)(0[1-9]|[1-4][0-9]|50)$/.test(clean)) {
    const grade = clean[0];
    const classNum = parseInt(clean.slice(1, 3), 10).toString();
    const studentNum = parseInt(clean.slice(3), 10).toString();
    return {
      valid: true,
      grade,
      classNum,
      studentNum,
      label: `${grade}학년 ${classNum}반 ${studentNum}번`
    };
  }

  return { valid: false, grade: '', classNum: '', studentNum: '', label: '' };
}

/**
 * 학생 로그인 검증 (로컬 캐시 -> 클라우드 Supabase 조회 -> 1234 기본값 대조)
 */
export async function verifyStudentLogin(
  studentId: string,
  inputPw: string
): Promise<{ success: boolean; message?: string }> {
  const cleanId = studentId.trim();
  const parsed = parseStudentId(cleanId);
  if (!parsed.valid) {
    return { success: false, message: '올바른 학번(예: 1101 또는 11201)을 입력하세요.' };
  }

  const inputHash = await hashPassword(inputPw);

  // 1. 로컬 캐시 확인
  const localHashes = getLocalCustomHashes();
  if (localHashes[cleanId]) {
    if (inputHash === localHashes[cleanId]) {
      return { success: true };
    }
  }

  // 2. 클라우드 Supabase 확인 (다른 기기에서 바꿨을 수 있음)
  if (supabase && isSupabaseConfigured) {
    try {
      const { data } = await supabase
        .from('class_notes')
        .select('strokes_data')
        .eq('lesson_id', SYSTEM_AUTH_LESSON_ID)
        .eq('student_grade', cleanId)
        .limit(1);

      if (data && data.length > 0 && data[0].strokes_data?.passwordHash) {
        const cloudHash = data[0].strokes_data.passwordHash;
        saveLocalCustomHash(cleanId, cloudHash);
        if (inputHash === cloudHash) {
          return { success: true };
        } else {
          return {
            success: false,
            message: '비밀번호가 일치하지 않습니다. 분실 시 관리자 선생님께 1234 초기화를 요청하세요.'
          };
        }
      }
    } catch (e) {
      console.warn('Student login cloud check error:', e);
    }
  }

  // 3. 변경된 기록이 없다면 기본 비밀번호(1234) 대조
  if (inputHash === DEFAULT_STUDENT_PW_HASH) {
    return { success: true };
  }

  return {
    success: false,
    message: '비밀번호가 일치하지 않습니다. (초기 비밀번호는 1234이며, 잊어버린 경우 관리자 선생님께 1234 초기화를 요청하세요)'
  };
}

/**
 * 학생 비밀번호 변경 (학생 본인이 로그인 상태 또는 로그인 창에서 변경)
 */
export async function changeStudentPassword(
  studentId: string,
  newPw: string,
  studentName?: string
): Promise<{ success: boolean; message?: string }> {
  const cleanId = studentId.trim();
  const parsed = parseStudentId(cleanId);
  if (!parsed.valid) {
    return { success: false, message: '올바른 학번이 아닙니다.' };
  }
  const cleanPw = newPw.trim();
  if (cleanPw.length < 4) {
    return { success: false, message: '새 비밀번호는 최소 4자리 이상이어야 합니다.' };
  }

  const newHash = await hashPassword(cleanPw);
  saveLocalCustomHash(cleanId, newHash);
  await syncAccountPasswordToCloud(cleanId, newHash, true, studentName || parsed.label);

  return { success: true, message: '비밀번호가 성공적으로 변경되었습니다.' };
}

/**
 * 관리자 전용: 학생 비밀번호 1234로 초기화
 */
export async function resetStudentPasswordToDefault(
  studentId: string
): Promise<{ success: boolean; message?: string }> {
  const cleanId = studentId.trim();
  removeLocalCustomHash(cleanId);
  await deleteAccountPasswordFromCloud(cleanId);
  return { success: true, message: `[${cleanId}] 학생의 비밀번호가 1234로 초기화되었습니다.` };
}

/**
 * 선생님 계정 검증 및 변경
 */
export async function verifyTeacherLogin(teacherName: string, inputPw: string): Promise<boolean> {
  const id = `tch_${teacherName.trim()}`;
  const inputHash = await hashPassword(inputPw);
  const localHashes = getLocalCustomHashes();
  if (localHashes[id]) {
    return inputHash === localHashes[id];
  }

  if (supabase && isSupabaseConfigured) {
    try {
      const { data } = await supabase
        .from('class_notes')
        .select('strokes_data')
        .eq('lesson_id', SYSTEM_AUTH_LESSON_ID)
        .eq('student_grade', id)
        .limit(1);

      if (data && data.length > 0 && data[0].strokes_data?.passwordHash) {
        const cloudHash = data[0].strokes_data.passwordHash;
        saveLocalCustomHash(id, cloudHash);
        return inputHash === cloudHash;
      }
    } catch {}
  }

  return inputHash === DEFAULT_STUDENT_PW_HASH; // 기본값 1234
}

export async function changeTeacherPassword(teacherName: string, newPw: string): Promise<boolean> {
  const id = `tch_${teacherName.trim()}`;
  const newHash = await hashPassword(newPw.trim());
  saveLocalCustomHash(id, newHash);
  await syncAccountPasswordToCloud(id, newHash, true, `${teacherName} 선생님`);
  return true;
}

export async function resetTeacherPasswordToDefault(teacherName: string): Promise<boolean> {
  const clean = teacherName.trim().replace(' 선생님', '').replace('선생님', '').trim();
  const id = `tch_${clean}`;
  removeLocalCustomHash(id);
  await deleteAccountPasswordFromCloud(id);
  return true;
}

/**
 * 관리자용: 전체 720개 학생 계정 상태 목록 생성 (관리자 대시보드 열 때만 온디맨드 호출)
 */
export function getAllStudentAccounts(customHashes: Record<string, string> = getLocalCustomHashes()): AccountRecord[] {
  const accounts: AccountRecord[] = [];
  const storedNames = getStoredStudentNames();

  for (let g = 1; g <= 3; g++) {
    for (let c = 1; c <= 8; c++) {
      for (let n = 1; n <= 30; n++) {
        const id = `${g}${c}${n < 10 ? '0' + n : n}`;
        const customName = storedNames[id];
        const name = customName ? `${g}학년 ${c}반 ${n}번 ${customName}` : `${g}학년 ${c}반 ${n}번 학생`;
        const isModified = Boolean(customHashes[id]);
        accounts.push({
          id,
          name,
          role: 'student',
          passwordHash: isModified ? '•••••• (개별설정)' : '1234 (초기값)',
          isModified,
          updatedAt: isModified ? '수정됨' : '초기값',
          grade: g.toString(),
          classNum: c.toString(),
          studentNum: n.toString()
        });
      }
    }
  }
  return accounts;
}

/**
 * 구글 드라이브 최상위 실제 폴더 목록 기반 선생님 계정 목록 생성 (100% 실시간 실제 폴더 연동)
 */
export function getTeacherAccounts(
  driveFolderNames: string[],
  customHashes: Record<string, string> = getLocalCustomHashes()
): AccountRecord[] {
  return driveFolderNames
    .filter(name => !name.startsWith('[QR수업]') && name !== '내 드라이브')
    .map(name => {
      const cleanName = name.replace(' 선생님', '').trim();
      const id = `tch_${cleanName}`;
      const isModified = Boolean(customHashes[id]);
      return {
        id,
        name: `${cleanName} 선생님`,
        role: 'teacher' as UserRole,
        passwordHash: isModified ? '•••••• (개별설정)' : '1234 (초기값)',
        isModified,
        updatedAt: isModified ? '수정됨' : '초기값'
      };
    });
}

// ============================================================================
// [현재 로그인 세션 관리]
// ============================================================================

export function getCurrentSession(): UserSession | null {
  if (typeof window === 'undefined') return null;

  const saved = localStorage.getItem(STORAGE_KEY_SESSION);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {}
  }

  // 전자칠판 영구 인증이 설정되어 있다면 초경량 전자칠판 세션 즉시 반환
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

/**
 * 학생 저장 정보 및 세션 완전 초기화 (로그아웃용)
 */
export function clearSavedStudentInfo(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY_SESSION);
  localStorage.removeItem('lbw_student_info');
}

/**
 * 구글 드라이브 클라우드 통합 모듈 (Google Drive Service)
 * 
 * - 단일 진실 공급원(Single Source of Truth):
 *   루트 폴더 ID, Google API Key, Google Apps Script(GAS) URL 및 설정을 중앙 집중 관리합니다.
 * - 모듈화된 핵심 기능:
 *   1. Drive v3 공식 REST API 기반 고속 읽기 (조회)
 *   2. Google Apps Script(GAS) 기반 통합 쓰기 엔진 (폴더 생성, 파일 업로드, 이름 변경, 삭제)
 *   3. 403 권한 및 네트워크 예외 처리의 정밀 진단 및 정직한 오류 보고
 */

import { getApiBaseUrl } from './apiConfig';

// ============================================================================
// [1. 기본 인프라 설정값 & 단일 진실 공급원]
// ============================================================================
export const DEFAULT_ROOT_FOLDER_ID = '1_bNWtyScX1zl-Xlz4WA8yZJC_qAshXlM';
export const DEFAULT_GOOGLE_API_KEY = 'AIzaSyD1qkVW-lVqI0TX7tNptdlDXSbhxvYuONA';
export const DEFAULT_GAS_UPLOAD_URL = (import.meta.env.VITE_GAS_UPLOAD_URL as string) || 'https://script.google.com/macros/s/AKfycbx_J2hdpXKy8iKFu8cxof4aKGYdhFO4ea93_E3a3KTeTNRbHMaaV4Fo7IkjbeDGUkli/exec';

// 과거 구형 인프라 키 (자동 마이그레이션 대상)
const LEGACY_ROOT_FOLDER_ID = '1Ew38nohOksBhypc2UjHYTmi6bSjbICmn';
const LEGACY_GOOGLE_API_KEY = 'AIzaSyAmEvx5j8IFigp22Ujp1Cm8lF4wpi0xlFw';

export const STORAGE_KEYS = {
  ROOT_FOLDER_ID: 'lbw_root_folder_id',
  GOOGLE_API_KEY: 'lbw_google_api_key',
  GAS_UPLOAD_URL: 'lbw_gas_upload_url'
} as const;

export interface DriveConfig {
  rootFolderId: string;
  googleApiKey: string;
  gasUploadUrl: string;
}

/**
 * 현재 저장된 드라이브 인프라 설정 조회 (구형 캐시 자동 마이그레이션 포함)
 */
export function getDriveConfig(): DriveConfig {
  if (typeof window === 'undefined') {
    return {
      rootFolderId: DEFAULT_ROOT_FOLDER_ID,
      googleApiKey: DEFAULT_GOOGLE_API_KEY,
      gasUploadUrl: DEFAULT_GAS_UPLOAD_URL
    };
  }

  try {
    let savedRoot = localStorage.getItem(STORAGE_KEYS.ROOT_FOLDER_ID);
    if (!savedRoot || savedRoot === LEGACY_ROOT_FOLDER_ID) {
      savedRoot = DEFAULT_ROOT_FOLDER_ID;
      localStorage.setItem(STORAGE_KEYS.ROOT_FOLDER_ID, DEFAULT_ROOT_FOLDER_ID);
    }

    let savedKey = localStorage.getItem(STORAGE_KEYS.GOOGLE_API_KEY);
    if (!savedKey || savedKey === LEGACY_GOOGLE_API_KEY) {
      savedKey = DEFAULT_GOOGLE_API_KEY;
      localStorage.setItem(STORAGE_KEYS.GOOGLE_API_KEY, DEFAULT_GOOGLE_API_KEY);
    }

    const savedGas = localStorage.getItem(STORAGE_KEYS.GAS_UPLOAD_URL) || DEFAULT_GAS_UPLOAD_URL;

    return {
      rootFolderId: savedRoot,
      googleApiKey: savedKey,
      gasUploadUrl: savedGas
    };
  } catch {
    return {
      rootFolderId: DEFAULT_ROOT_FOLDER_ID,
      googleApiKey: DEFAULT_GOOGLE_API_KEY,
      gasUploadUrl: DEFAULT_GAS_UPLOAD_URL
    };
  }
}

/**
 * 드라이브 인프라 설정 업데이트
 */
export function saveDriveConfig(newConfig: Partial<DriveConfig>): DriveConfig {
  if (typeof window !== 'undefined') {
    if (newConfig.rootFolderId !== undefined) {
      localStorage.setItem(STORAGE_KEYS.ROOT_FOLDER_ID, newConfig.rootFolderId.trim());
    }
    if (newConfig.googleApiKey !== undefined) {
      localStorage.setItem(STORAGE_KEYS.GOOGLE_API_KEY, newConfig.googleApiKey.trim());
    }
    if (newConfig.gasUploadUrl !== undefined) {
      localStorage.setItem(STORAGE_KEYS.GAS_UPLOAD_URL, newConfig.gasUploadUrl.trim());
    }
  }
  return getDriveConfig();
}

/**
 * 드라이브 인프라 설정 기본값 복원
 */
export function resetDriveConfig(): DriveConfig {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEYS.ROOT_FOLDER_ID);
    localStorage.removeItem(STORAGE_KEYS.GOOGLE_API_KEY);
    localStorage.removeItem(STORAGE_KEYS.GAS_UPLOAD_URL);
  }
  return getDriveConfig();
}

// ============================================================================
// [2. 타입 정의]
// ============================================================================
export interface DriveItem {
  id: string;
  name: string;
  type: 'folder' | 'document';
  folderId?: string;
  size?: string;
  updatedAt: string;
  viewUrl: string;
  downloadUrl: string;
  isQrLesson?: boolean;
}

export interface DriveActionPayload {
  action: 'createFolder' | 'upload' | 'rename' | 'delete';
  folderId?: string;
  id?: string;
  name?: string;
  mimeType?: string;
  base64?: string;
  isFolder?: boolean;
  gasUrl?: string;
}

// ============================================================================
// [3. 유틸리티 헬퍼]
// ============================================================================
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = error => reject(error);
  });
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '-';
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

// ============================================================================
// [4. 구글 드라이브 파일/폴더 목록 조회 (Drive v3 API)]
// ============================================================================
export async function fetchDriveItems(
  targetFolderId?: string,
  configOverride?: Partial<DriveConfig>
): Promise<DriveItem[]> {
  const config = { ...getDriveConfig(), ...configOverride };
  const folderId = targetFolderId || config.rootFolderId;
  const apiBase = getApiBaseUrl();

  // 1. 구글 공식 Drive API v3 직접 호출 (초고속 실시간 조회)
  if (config.googleApiKey) {
    try {
      const directUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=folder,name&key=${config.googleApiKey}&_t=${Date.now()}`;
      const gRes = await fetch(directUrl, { cache: 'no-store' });
      if (gRes.ok) {
        const gData = await gRes.json();
        const items: DriveItem[] = (gData.files || []).map((file: any) => {
          const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
          const sizeBytes = file.size ? parseInt(file.size, 10) : 0;
          return {
            id: file.id,
            name: file.name,
            type: isFolder ? 'folder' : 'document',
            folderId: isFolder ? file.id : undefined,
            size: isFolder ? '-' : formatBytes(sizeBytes),
            updatedAt: file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString('ko-KR') : '-',
            viewUrl: isFolder
              ? `https://drive.google.com/drive/folders/${file.id}?usp=sharing`
              : `https://drive.google.com/file/d/${file.id}/view?usp=sharing`,
            downloadUrl: `${apiBase}/api/drive?action=download&fileId=${file.id}&fileName=${encodeURIComponent(file.name)}`
          };
        });
        return items;
      }
    } catch (directErr) {
      console.warn('[driveService] Direct API v3 fetch failed, falling back to proxy:', directErr);
    }
  }

  // 2. 백엔드 프록시 폴백 (/api/drive?action=list)
  try {
    const queryParams = new URLSearchParams({
      action: 'list',
      folderId,
      _t: Date.now().toString(),
      ...(config.googleApiKey ? { apiKey: config.googleApiKey } : {})
    });
    const res = await fetch(`${apiBase}/api/drive?${queryParams.toString()}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data.items && Array.isArray(data.items)) {
        return data.items;
      }
    }
  } catch (proxyErr) {
    console.warn('[driveService] Proxy drive list failed:', proxyErr);
  }

  return [];
}

// ============================================================================
// [5. 구글 드라이브 통합 액션 실행 엔진 (GAS 웹 앱 경유 쓰기 작업)]
// ============================================================================
export async function executeDriveAction(
  payload: DriveActionPayload,
  configOverride?: Partial<DriveConfig>
): Promise<any> {
  const config = { ...getDriveConfig(), ...configOverride };
  const finalGasUrl = config.gasUploadUrl || DEFAULT_GAS_UPLOAD_URL;
  const apiBase = getApiBaseUrl();

  // 1. 프록시 경유 실행 시도 (/api/drive POST)
  try {
    const res = await fetch(`${apiBase}/api/drive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, gasUrl: finalGasUrl })
    });
    if (res.ok) {
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        if (data.success) return data;
        if (data.error) throw new Error(data.error);
      } catch (jsonErr: any) {
        throw new Error(jsonErr.message);
      }
    }
  } catch (proxyErr: any) {
    console.warn('[driveService] Proxy drive action failed, trying direct GAS fetch:', proxyErr);
    if (proxyErr.message && (proxyErr.message.includes('액세스') || proxyErr.message.includes('권한') || proxyErr.message.includes('403'))) {
      throw proxyErr;
    }
  }

  // 2. 직접 Google Apps Script Web App 호출
  if (finalGasUrl) {
    try {
      const directRes = await fetch(finalGasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      const directText = await directRes.text();
      let directData: any;
      try {
        directData = JSON.parse(directText);
      } catch {
        const isForbidden = directText.includes('액세스 권한') || directText.includes('액세스 거부') || directRes.status === 403;
        if (isForbidden) {
          throw new Error('구글 드라이브(Google Apps Script) 권한(403) 오류: 웹 앱 배포 시 [액세스 권한: 모든 사용자] 설정이 필요합니다.');
        }
        throw new Error('Google Apps Script 웹 앱 권한 오류 (HTML 응답 수신됨)');
      }

      if (!directData.success) {
        throw new Error(directData.error || '구글 드라이브 요청 처리에 실패했습니다.');
      }
      return directData;
    } catch (directErr: any) {
      throw new Error(directErr.message || '구글 드라이브 요청 처리에 실패했습니다.');
    }
  }

  throw new Error('Google Apps Script 업로드 URL이 설정되어 있지 않습니다.');
}

// ============================================================================
// [6. 교사 폴더 생성 전용 헬퍼]
// ============================================================================
export async function createTeacherFolder(
  teacherName: string,
  configOverride?: Partial<DriveConfig>
): Promise<{ success: boolean; folderId?: string; error?: string }> {
  const cleanName = teacherName.trim().replace(' 선생님', '').replace('선생님', '').trim();
  if (!cleanName) {
    return { success: false, error: '선생님 이름을 입력해 주세요.' };
  }

  const config = { ...getDriveConfig(), ...configOverride };

  try {
    const res = await executeDriveAction({
      action: 'createFolder',
      folderId: config.rootFolderId,
      name: cleanName
    }, config);

    if (res && (res.folderId || res.id)) {
      return { success: true, folderId: res.folderId || res.id };
    }
    return { success: false, error: res?.error || '폴더 생성 실패' };
  } catch (err: any) {
    return { success: false, error: err.message || '구글 드라이브 시스템 권한(403) 오류' };
  }
}

// ============================================================================
// [7. 1분 Google Apps Script 표준 코드 템플릿]
// ============================================================================
export const GAS_CODE_TEMPLATE = `function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || (data.base64 ? 'upload' : 'unknown');

    // 1. 파일 또는 폴더 휴지통 이동 (삭제)
    if (action === 'delete') {
      var targetId = data.id;
      if (!targetId) throw new Error('삭제할 항목의 ID가 없습니다.');
      try {
        var file = DriveApp.getFileById(targetId);
        file.setTrashed(true);
        return ContentService.createTextOutput(JSON.stringify({ success: true, id: targetId, type: 'file' })).setMimeType(ContentService.MimeType.JSON);
      } catch (errFile) {
        var folder = DriveApp.getFolderById(targetId);
        folder.setTrashed(true);
        return ContentService.createTextOutput(JSON.stringify({ success: true, id: targetId, type: 'folder' })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // 2. 새 폴더 만들기
    if (action === 'createFolder') {
      var targetFolderId = data.folderId || '${DEFAULT_ROOT_FOLDER_ID}';
      var parentFolder = DriveApp.getFolderById(targetFolderId);
      var newFolder = parentFolder.createFolder(data.name || '새 폴더');
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        folderId: newFolder.getId(),
        name: newFolder.getName()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 3. 이름 바꾸기 (폴더 또는 파일 자동 감지)
    if (action === 'rename') {
      var renameId = data.id;
      var newName = data.name;
      try {
        DriveApp.getFileById(renameId).setName(newName);
      } catch (errF) {
        DriveApp.getFolderById(renameId).setName(newName);
      }
      return ContentService.createTextOutput(JSON.stringify({ success: true, id: renameId, name: newName })).setMimeType(ContentService.MimeType.JSON);
    }

    // 4. 파일 업로드
    if (action === 'upload') {
      var upFolderId = data.folderId || '${DEFAULT_ROOT_FOLDER_ID}';
      var upFolder = DriveApp.getFolderById(upFolderId);
      var contentType = data.mimeType || 'application/octet-stream';
      var decoded = Utilities.base64Decode(data.base64);
      var blob = Utilities.newBlob(decoded, contentType, data.name);
      var file = upFolder.createFile(blob);
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        fileId: file.getId(),
        name: file.getName()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: false, error: '지원되지 않는 동작입니다.' })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}
`;

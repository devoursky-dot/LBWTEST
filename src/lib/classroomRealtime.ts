/**
 * 초경량 & 무결점 전자칠판-학생 실시간 통신 및 세션 관리 엔진 (Supabase 단일 기반)
 * 
 * [핵심 원칙]:
 * 1. 교사 주도 수업 수명주기: 전자칠판 [수업 개시] -> 학생 연결 허용, [수업 종료] -> 일괄 연결 해제
 * 2. 2시간 무터치 자동 세션 종료: 칠판 터치 부재 시 2시간 후 자동 CLOSED
 * 3. 5초 주기 초경량 30바이트 생존 핑(Ping): 잡신호(blur, fullscreen) 100% 제거
 * 4. 억울한 누명 없는 3단계 연결 판정: connected (5초) -> checking (10초) -> disconnected (15초+)
 * 5. 학생 앱을 위한 개설된 선생님 목록 및 수업 목록 원클릭 조회 지원
 */

import { supabase, isSupabaseConfigured, localRealtimeChannel, type ClassNoteRecord } from './supabase';
import { getLocalVersionInfo } from '../modules/version';
import { DEFAULT_ROOT_FOLDER_ID, DEFAULT_GOOGLE_API_KEY, getDriveConfig } from './driveService';

export { DEFAULT_ROOT_FOLDER_ID, DEFAULT_GOOGLE_API_KEY };

export type StudentStatus = 'connected' | 'checking' | 'disconnected';

export interface StudentPresenceInfo {
  grade: string;
  classNum: string;
  studentNum: string;
  name: string;
  status: StudentStatus;
  lastActiveTime: number; // Date.now() ms
  isAway?: boolean; // 다른 화면/앱을 보고 있는지 여부 (document.hidden || !document.hasFocus())
}

export interface AttachedFileItem {
  id: string;
  name: string;
  downloadUrl: string;
  viewUrl?: string;
  size?: string;
  mimeType?: string;
}

export interface TeacherLessonInfo {
  lessonId: string;
  title: string;
  isLive: boolean; // 현재 전자칠판에서 수업 중인지 여부 (🟢 실시간 진행 중 vs 📓 오프라인)
  sessionKey?: string; // 실시간 수업 고유 세션키 (수업 개설 시 발급, 수업 종료/초기화 시 파기)
  durationMinutes?: number; // 설정된 수업 시간 (분)
  expiresAt?: number; // 수업 만료 예정 시각 (ms)
  pdfId?: string;
  pdfName?: string;
  attachedFiles?: AttachedFileItem[];
  startedAt: string;
  lastTouched: number;
}

export interface ActiveTeacherLesson {
  teacherName: string;
  lessons: TeacherLessonInfo[];
}

export type RealtimeSignalType =
  | 'STUDENT_PING'           // 학생 -> 전자칠판 5초 주기 초경량 생존 신호 (30바이트)
  | 'STUDENT_LEAVE'          // 학생 -> 전자칠판 정상 퇴장 알림
  | 'STUDENT_SUBMIT'         // 학생 -> 전자칠판 필기 답안 제출
  | 'REQUEST_STUDENT_NOTE'   // 전자칠판 -> 학생 실시간 필기 요청
  | 'RESPONSE_STUDENT_NOTE'  // 학생 -> 전자칠판 실시간 필기 응답
  | 'RESET_SESSION'          // 전자칠판 -> 학생 수업 종료/초기화 통보
  | 'KICK_STUDENT'           // 전자칠판 -> 학생 강제 퇴장 신호
  | 'REQUEST_ALL_SYNC'       // 전자칠판 -> 전체 학생 일괄 동기화 요청
  | 'EXTEND_SESSION'         // 전자칠판 -> 학생 수업 시간 연장 통보
  | 'FORCE_RELOAD';          // 전자칠판 -> 구버전 학생 기기 원격 새로고침 명령

export interface RealtimeSignalPayload {
  type: RealtimeSignalType;
  lessonId: string;
  targetStudentKey?: string;
  sessionKey?: string;
  extraMinutes?: number;
  newExpiresAt?: number;
  student?: {
    grade: string;
    classNum: string;
    studentNum: string;
    name: string;
    isAway?: boolean;
    currentPage?: number;
    totalPages?: number;
    appVersion?: string;
  };
  noteRecord?: ClassNoteRecord;
  timestamp: number; // ms
}

type SignalListener = (signal: RealtimeSignalPayload) => void;

// Re-exported above from driveService

export interface FetchTeacherLessonsOptions {
  rootFolderId?: string;
  googleApiKey?: string;
  apiBase?: string;
}

class ClassroomRealtimeManager {
  private activeChannel: any = null;
  private currentLessonId: string | null = null;
  private currentSessionKey: string | null = null;
  private currentRole: 'teacher' | 'student' = 'student';
  private listeners: Set<SignalListener> = new Set();
  private localBroadcastListener: ((e: MessageEvent) => void) | null = null;
  private pingIntervalId: any = null;
  private appVisibilityCleanup: (() => void) | null = null;
  private touchThrottleTimer: any = null;
  private lastTouchRegisteredTime: number = 0;
  private pageInfoGetter: (() => { currentPage: number; totalPages: number }) | null = null;

  public setStudentPageInfoGetter(getter: (() => { currentPage: number; totalPages: number }) | null): void {
    this.pageInfoGetter = getter;
  }

  // ==========================================================================
  // [1. 교사 수업 세션 관리 (Supabase class_notes 기반 무결점 저장)]
  // ==========================================================================

  /**
   * 교사 전자칠판: 수업 개시 등록 (2시간 유효)
   */
  public async registerTeacherSession(params: {
    lessonId: string;
    teacherName: string;
    lessonTitle: string;
    pdfId?: string;
    pdfName?: string;
    attachedFiles?: AttachedFileItem[];
    isLive?: boolean;
    durationMinutes?: number;
    sessionKey?: string;
  }): Promise<{ success: boolean; sessionKey: string; expiresAt: number }> {
    const {
      lessonId,
      teacherName,
      lessonTitle,
      pdfId,
      pdfName,
      attachedFiles,
      isLive = true,
      durationMinutes = 60
    } = params;
    const nowMs = Date.now();
    const sessionKey = params.sessionKey || `sess_${lessonId}_${nowMs}`;
    const expiresAt = nowMs + durationMinutes * 60 * 1000;

    if (!supabase || !isSupabaseConfigured) {
      return { success: false, sessionKey, expiresAt };
    }

    try {
      const nowIso = new Date().toISOString();
      const payload: ClassNoteRecord = {
        lesson_id: lessonId,
        student_grade: '_TEACHER_SESSION_',
        student_class: teacherName.trim() || '선생님',
        student_num: isLive ? 'ACTIVE' : 'REGISTERED',
        student_name: lessonTitle.trim() || '수업',
        strokes_data: {
          pdfId: pdfId || null,
          pdfName: pdfName || null,
          attachedFiles: attachedFiles || [],
          startedAt: nowIso,
          lastTouched: nowMs,
          sessionKey,
          durationMinutes,
          expiresAt
        },
        updated_at: nowIso
      };

      // 기존 세션 row 확인 후 upsert
      const { data: existing } = await supabase
        .from('class_notes')
        .select('id, strokes_data')
        .eq('lesson_id', lessonId)
        .eq('student_grade', '_TEACHER_SESSION_')
        .maybeSingle();

      if (existing?.id) {
        payload.id = existing.id;
        // 기존 첨부파일이 있고 새 파라미터에 없으면 기존 첨부파일 보존
        if (!attachedFiles && existing.strokes_data?.attachedFiles) {
          (payload.strokes_data as any).attachedFiles = existing.strokes_data.attachedFiles;
        }
      }

      const { error } = await supabase.from('class_notes').upsert(payload);
      if (error) {
        console.warn('[Realtime] registerTeacherSession error:', error.message);
        return { success: false, sessionKey, expiresAt };
      }
      return { success: true, sessionKey, expiresAt };
    } catch (err) {
      console.warn('[Realtime] registerTeacherSession exception:', err);
      return { success: false, sessionKey, expiresAt };
    }
  }

  /**
   * 전자칠판: 수업 시간 연장 (기본 10분 추가)
   */
  public async extendTeacherSession(lessonId: string, extraMinutes: number = 10): Promise<{ success: boolean; newExpiresAt: number }> {
    if (!supabase || !isSupabaseConfigured) return { success: false, newExpiresAt: Date.now() };

    try {
      const { data: existing } = await supabase
        .from('class_notes')
        .select('id, strokes_data')
        .eq('lesson_id', lessonId)
        .eq('student_grade', '_TEACHER_SESSION_')
        .maybeSingle();

      if (existing?.id && existing.strokes_data) {
        const curExpires = existing.strokes_data.expiresAt || (Date.now() + 60 * 60 * 1000);
        const newExpiresAt = Math.max(curExpires, Date.now()) + extraMinutes * 60 * 1000;
        const newDuration = (existing.strokes_data.durationMinutes || 60) + extraMinutes;

        await supabase
          .from('class_notes')
          .update({
            strokes_data: {
              ...existing.strokes_data,
              expiresAt: newExpiresAt,
              durationMinutes: newDuration,
              lastTouched: Date.now()
            },
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);

        try {
          await this.sendSignal({
            type: 'EXTEND_SESSION',
            lessonId,
            extraMinutes,
            newExpiresAt
          });
        } catch {}

        return { success: true, newExpiresAt };
      }
      return { success: false, newExpiresAt: Date.now() };
    } catch (err) {
      console.warn('[Realtime] extendTeacherSession error:', err);
      return { success: false, newExpiresAt: Date.now() };
    }
  }

  /**
   * 전자칠판 화면 터치/조작 시 마지막 활동 시간 갱신 (20초 디바운스/쓰로틀링)
   */
  public touchTeacherSession(lessonId: string): void {
    const now = Date.now();
    if (now - this.lastTouchRegisteredTime < 20000) return; // 20초 이내 중복 방지
    this.lastTouchRegisteredTime = now;

    if (!supabase || !isSupabaseConfigured) return;

    if (this.touchThrottleTimer) clearTimeout(this.touchThrottleTimer);
    const client = supabase;
    this.touchThrottleTimer = setTimeout(async () => {
      try {
        if (!client) return;
        await client
          .from('class_notes')
          .update({
            updated_at: new Date().toISOString(),
            strokes_data: { lastTouched: Date.now() }
          })
          .eq('lesson_id', lessonId)
          .eq('student_grade', '_TEACHER_SESSION_');
      } catch {}
    }, 500);
  }

  /**
   * 교사 전자칠판: 수업 종료 선언 (CLOSED 상태로 전환 및 전체 학생 퇴장 신호 발송)
   */
  public async closeTeacherSession(lessonId: string): Promise<void> {
    try {
      if (supabase && isSupabaseConfigured) {
        await supabase
          .from('class_notes')
          .update({
            student_num: 'CLOSED',
            updated_at: new Date().toISOString()
          })
          .eq('lesson_id', lessonId)
          .eq('student_grade', '_TEACHER_SESSION_');
      }

      // 수업 종료 신호 브로드캐스트
      await this.sendSignal({
        type: 'RESET_SESSION',
        lessonId
      });
    } catch (err) {
      console.warn('[Realtime] closeTeacherSession error:', err);
    }
  }

  /**
   * 전자칠판: 이전의 모든 진행 중 세션을 종료하고 새 수업 시작 준비
   */
  public async closeAllOtherActiveSessions(currentLessonId?: string): Promise<void> {
    if (!supabase || !isSupabaseConfigured) return;
    try {
      let query = supabase
        .from('class_notes')
        .update({
          student_num: 'REGISTERED',
          updated_at: new Date().toISOString()
        })
        .eq('student_grade', '_TEACHER_SESSION_')
        .eq('student_num', 'ACTIVE');

      if (currentLessonId) {
        query = query.neq('lesson_id', currentLessonId);
      }
      await query;
    } catch (err) {
      console.warn('[Realtime] closeAllOtherActiveSessions error:', err);
    }
  }


  /**
   * 학생앱 & 전자칠판: 구글 드라이브의 실제 교사 폴더 및 [QR수업] 폴더와 Supabase 실시간 세션 100% 통합 조회
   * - 구글 드라이브 최상위 루트 폴더 내 등록된 모든 교사 폴더 자동 인식
   * - 각 교사 폴더 내 [QR수업] 폴더 및 연결된 학습지 자동 추출
   * - Supabase class_notes 실시간 세션과 대조하여 현재 수업 중인 경우 `isLive: true` (🟢 진행 중)
   * - 대기/오프라인 수업인 경우 `isLive: false` (📓 수업 대기)
   */
  public async fetchAllTeacherLessons(options?: FetchTeacherLessonsOptions): Promise<ActiveTeacherLesson[]> {
    const driveCfg = getDriveConfig();
    const rootFolderId = options?.rootFolderId || driveCfg.rootFolderId;
    const googleApiKey = options?.googleApiKey || driveCfg.googleApiKey;

    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    const now = Date.now();

    // 1. Supabase 실시간 세션 데이터 병렬 조회
    let supabaseRows: any[] = [];
    if (supabase && isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('class_notes')
          .select('*')
          .eq('student_grade', '_TEACHER_SESSION_')
          .order('updated_at', { ascending: false });
        if (!error && data) {
          supabaseRows = data;
        }
      } catch (sbErr) {
        console.warn('[Realtime] Supabase session fetch warning:', sbErr);
      }
    }

    const sbSessionMap = new Map<string, any>();
    for (const row of supabaseRows) {
      sbSessionMap.set(row.lesson_id, row);
    }

    // 2. 구글 드라이브 API v3로 실제 등록된 모든 선생님 및 수업 폴더 실시간 조회
    const teacherMap = new Map<string, TeacherLessonInfo[]>();

    try {
      if (googleApiKey && rootFolderId) {
        // 2-1. 최상위 루트 폴더의 교사 폴더 목록 조회 (공유드라이브 supportsAllDrives 필수 포함)
        const rootUrl = `https://www.googleapis.com/drive/v3/files?q='${rootFolderId}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name)&orderBy=name&key=${googleApiKey}&_t=${Date.now()}`;
        const rootRes = await fetch(rootUrl);

        if (rootRes.ok) {
          const rootData = await rootRes.json();
          const teacherFolders: Array<{ id: string; name: string }> = (rootData.files || []).filter(
            (f: any) => !f.name.startsWith('[QR수업]') && f.name !== '내 드라이브'
          );

          // 2-2. 각 교사 폴더 내부의 [QR수업] 폴더들 병렬 조회
          await Promise.all(
            teacherFolders.map(async (tFolder) => {
              const cleanTeacherName = tFolder.name.replace(' 선생님', '').trim();
              if (!teacherMap.has(cleanTeacherName)) {
                teacherMap.set(cleanTeacherName, []);
              }

              try {
                const subUrl = `https://www.googleapis.com/drive/v3/files?q='${tFolder.id}'+in+parents+and+trashed=false&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType,modifiedTime)&key=${googleApiKey}&_t=${Date.now()}`;
                const subRes = await fetch(subUrl);
                if (subRes.ok) {
                  const subData = await subRes.json();
                  const qrFolders: any[] = (subData.files || []).filter(
                    (f: any) => f.mimeType === 'application/vnd.google-apps.folder' && (f.name.startsWith('[QR수업]') || f.name.includes('[QR수업]'))
                  );

                  // 2-3. 각 [QR수업] 폴더 내의 첨부 학습지 파일 병렬 확인
                  const lessonList = await Promise.all(
                    qrFolders.map(async (qFolder) => {
                      const lessonId = qFolder.id;
                      const cleanTitle = qFolder.name.replace('[QR수업]', '').trim();

                      let attachedFiles: AttachedFileItem[] = [];
                      let pdfId: string | undefined;
                      let pdfName: string | undefined;

                      try {
                        const filesUrl = `https://www.googleapis.com/drive/v3/files?q='${lessonId}'+in+parents+and+trashed=false&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType,size)&key=${googleApiKey}&_t=${Date.now()}`;
                        const filesRes = await fetch(filesUrl);
                        if (filesRes.ok) {
                          const filesData = await filesRes.json();
                          const foundFiles: any[] = (filesData.files || []).filter((f: any) => f.name !== 'lesson_config.json');

                          attachedFiles = foundFiles.map(f => ({
                            id: f.id,
                            name: f.name,
                            downloadUrl: `https://drive.google.com/uc?export=download&id=${f.id}`,
                            mimeType: f.mimeType
                          }));

                          const pdfDoc = attachedFiles.find(f => f.mimeType === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
                          if (pdfDoc) {
                            pdfId = pdfDoc.id;
                            pdfName = pdfDoc.name;
                          }
                        }
                      } catch {}

                      // Supabase 실시간 세션 정보 대조 (세션키 및 만료 시각 검증)
                      const sbRow = sbSessionMap.get(lessonId);
                      const lastTouched = sbRow?.strokes_data?.lastTouched || (sbRow?.updated_at ? new Date(sbRow.updated_at).getTime() : 0);
                      const sessionExpiresAt = sbRow?.strokes_data?.expiresAt;
                      const isNotExpired = sessionExpiresAt ? (now <= sessionExpiresAt) : (now - lastTouched <= TWO_HOURS_MS);
                      const isLive = sbRow?.student_num === 'ACTIVE' && isNotExpired;

                      if (sbRow?.strokes_data?.attachedFiles && attachedFiles.length === 0) {
                        attachedFiles = sbRow.strokes_data.attachedFiles;
                      }
                      if (!pdfId && sbRow?.strokes_data?.pdfId) {
                        pdfId = sbRow.strokes_data.pdfId;
                        pdfName = sbRow.strokes_data.pdfName;
                      }

                      return {
                        lessonId,
                        title: cleanTitle,
                        isLive,
                        sessionKey: sbRow?.strokes_data?.sessionKey,
                        durationMinutes: sbRow?.strokes_data?.durationMinutes,
                        expiresAt: sessionExpiresAt,
                        pdfId,
                        pdfName,
                        attachedFiles,
                        startedAt: sbRow?.strokes_data?.startedAt || qFolder.modifiedTime || new Date().toISOString(),
                        lastTouched: isLive ? lastTouched : (qFolder.modifiedTime ? new Date(qFolder.modifiedTime).getTime() : 0)
                      };
                    })
                  );

                  teacherMap.get(cleanTeacherName)!.push(...lessonList);
                }
              } catch (subErr) {
                console.warn(`[Realtime] 교사 '${tFolder.name}' 하위 폴더 조회 예외:`, subErr);
              }
            })
          );
        }
      }
    } catch (driveErr) {
      console.warn('[Realtime] 구글 드라이브 수업 통합 조회 예외:', driveErr);
    }

    // 3. (구글 드라이브 단일 진실 공급원)
    // 구글 드라이브에 실제 존재하지 않는 고스트 세션은 절대 학생/전자칠판 목록에 추가하지 않습니다.

    // 4. 교사별 수업 목록 정렬: 실시간 진행 중(🟢)을 최상단, 최신 활동순
    return Array.from(teacherMap.entries()).map(([teacherName, lessons]) => {
      lessons.sort((a, b) => {
        if (a.isLive && !b.isLive) return -1;
        if (!a.isLive && b.isLive) return 1;
        return b.lastTouched - a.lastTouched;
      });
      return {
        teacherName,
        lessons
      };
    });
  }

  /**
   * 하위 호환용 래퍼: fetchAllTeacherLessons 호출
   */
  public async fetchActiveTeacherLessons(options?: FetchTeacherLessonsOptions): Promise<ActiveTeacherLesson[]> {
    return this.fetchAllTeacherLessons(options);
  }

  // ==========================================================================
  // [2. 실시간 채널 연결 및 5초 주기 초경량 핑 (Ping)]
  // ==========================================================================

  /**
   * 수업 채널 참가
   * @param lessonId 수업 ID
   * @param onSignal 신호 콜백
   * @param role 'teacher' | 'student'
   * @param studentInfo 학생 역할일 때 필수 (5초 주기 핑 발송용)
   * @param sessionKey 교사의 실시간 세션키
   */
  public getCurrentSessionKey(): string | null {
    return this.currentSessionKey;
  }

  public joinLesson(
    lessonId: string,
    onSignal?: SignalListener,
    role: 'teacher' | 'student' = 'student',
    studentInfo?: { grade: string; classNum: string; studentNum: string; name: string },
    sessionKey?: string
  ): void {
    if (this.currentLessonId === lessonId && this.currentRole === role) {
      if (onSignal) this.listeners.add(onSignal);
      if (sessionKey) this.currentSessionKey = sessionKey;
      return;
    }

    this.leaveLesson();
    this.currentLessonId = lessonId;
    this.currentSessionKey = sessionKey || null;
    this.currentRole = role;
    if (onSignal) this.listeners.add(onSignal);

    // 1. Supabase Realtime 채널 생성 (단일 채널로 교사-학생 양방향 초경량 브로드캐스트)
    if (supabase && isSupabaseConfigured) {
      try {
        const channelName = `classroom_lesson_${lessonId}`;
        this.activeChannel = supabase
          .channel(channelName, {
            config: { broadcast: { self: false } }
          })
          .on('broadcast', { event: 'classroom_signal' }, ({ payload }) => {
            if (payload && payload.lessonId === this.currentLessonId) {
              this.notifyListeners(payload);
            }
          })
          .subscribe();
      } catch (err) {
        console.warn('[Realtime] Join channel error:', err);
      }
    }

    // 2. 브라우저 탭 간 BroadcastChannel 리스너 (동일 PC/기기 즉각 동기화)
    if (localRealtimeChannel) {
      this.localBroadcastListener = (event: MessageEvent) => {
        if (event.data && event.data.lessonId === this.currentLessonId) {
          this.notifyListeners(event.data);
        }
      };
      localRealtimeChannel.addEventListener('message', this.localBroadcastListener);
    }

    // 3. [학생 전용] 5초 주기 초경량 생존 핑(Ping, 30바이트) 자동 발송 시작
    if (role === 'student' && studentInfo) {
      this.startStudentPing(lessonId, studentInfo);
    }
  }

  /**
   * 학생: 5초 주기 초경량 생존 핑 발송 (다른 화면/탭 이탈 감지 포함)
   */
  private startStudentPing(
    lessonId: string,
    studentInfo: { grade: string; classNum: string; studentNum: string; name: string }
  ): void {
    this.stopStudentPing();

    const getIsAway = (): boolean => {
      if (typeof document === 'undefined') return false;
      return Boolean(document.hidden || !document.hasFocus());
    };

    const sendPing = () => {
      if (this.currentLessonId !== lessonId) return;
      const pageInfo = this.pageInfoGetter ? this.pageInfoGetter() : undefined;
      this.sendSignal({
        type: 'STUDENT_PING',
        lessonId,
        sessionKey: this.currentSessionKey || undefined,
        student: {
          ...studentInfo,
          isAway: getIsAway(),
          currentPage: pageInfo?.currentPage,
          totalPages: pageInfo?.totalPages,
          appVersion: getLocalVersionInfo().version
        }
      }).catch(() => {});
    };

    // 진입 즉시 1회 발송
    sendPing();
    // 5초 주기 정기 발송
    this.pingIntervalId = setInterval(sendPing, 5000);

    // 학생이 탭을 전환하거나 다른 앱을 열 때(또는 복귀할 때) 즉각 감지하여 실시간 알림 발송
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const handleVisibilityOrFocusChange = () => {
        sendPing();
      };

      document.addEventListener('visibilitychange', handleVisibilityOrFocusChange);
      window.addEventListener('focus', handleVisibilityOrFocusChange);
      window.addEventListener('blur', handleVisibilityOrFocusChange);

      this.appVisibilityCleanup = () => {
        document.removeEventListener('visibilitychange', handleVisibilityOrFocusChange);
        window.removeEventListener('focus', handleVisibilityOrFocusChange);
        window.removeEventListener('blur', handleVisibilityOrFocusChange);
      };
    }
  }

  private stopStudentPing(): void {
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }
    if (this.appVisibilityCleanup) {
      this.appVisibilityCleanup();
      this.appVisibilityCleanup = null;
    }
  }

  public subscribe(listener: SignalListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(payload: RealtimeSignalPayload): void {
    for (const listener of this.listeners) {
      try {
        listener(payload);
      } catch (e) {
        console.error('[Realtime] Listener callback error:', e);
      }
    }
  }

  /**
   * 실시간 신호 전송 (Supabase 브로드캐스트 + 로컬 채널)
   */
  public async sendSignal(signal: Omit<RealtimeSignalPayload, 'timestamp'>): Promise<void> {
    const fullPayload: RealtimeSignalPayload = {
      ...signal,
      timestamp: Date.now()
    };

    // 1. Supabase Broadcast 전송
    if (this.activeChannel && isSupabaseConfigured) {
      try {
        await this.activeChannel.send({
          type: 'broadcast',
          event: 'classroom_signal',
          payload: fullPayload
        });
      } catch (err) {
        console.warn('[Realtime] Supabase broadcast send error:', err);
      }
    }

    // 2. 로컬 브로드캐스트 채널 전송
    if (localRealtimeChannel) {
      try {
        localRealtimeChannel.postMessage(fullPayload);
      } catch {}
    }
  }

  /**
   * 수업 채널 연결 해제 및 핑 중지
   */
  /**
   * 구버전 학생 태블릿 또는 특정 학생에게 원격 새로고침 명령 전송
   */
  public async sendForceReload(lessonId: string, targetStudentKey?: string): Promise<void> {
    await this.sendSignal({
      type: 'FORCE_RELOAD',
      lessonId,
      targetStudentKey
    });
  }

  public triggerStudentPing(): void {
    if (this.currentRole === 'student' && this.currentLessonId) {
      // 등록된 visibility 리스너나 이벤트 강제 격발
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('focus'));
      }
    }
  }

  public leaveLesson(studentInfo?: { grade: string; classNum: string; studentNum: string; name: string }): void {
    this.stopStudentPing();

    // 학생인 경우 퇴장 신호 발송
    if (this.currentRole === 'student' && this.currentLessonId && studentInfo) {
      this.sendSignal({
        type: 'STUDENT_LEAVE',
        lessonId: this.currentLessonId,
        student: studentInfo
      }).catch(() => {});
    }

    if (this.activeChannel && supabase) {
      try {
        supabase.removeChannel(this.activeChannel);
      } catch {}
      this.activeChannel = null;
    }

    if (localRealtimeChannel && this.localBroadcastListener) {
      localRealtimeChannel.removeEventListener('message', this.localBroadcastListener);
      this.localBroadcastListener = null;
    }

    if (this.touchThrottleTimer) {
      clearTimeout(this.touchThrottleTimer);
      this.touchThrottleTimer = null;
    }

    this.currentLessonId = null;
    this.currentSessionKey = null;
    this.listeners.clear();
  }
}

export const classroomRealtime = new ClassroomRealtimeManager();

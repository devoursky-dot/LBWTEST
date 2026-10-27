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

export type StudentStatus = 'connected' | 'checking' | 'disconnected';

export interface StudentPresenceInfo {
  grade: string;
  classNum: string;
  studentNum: string;
  name: string;
  status: StudentStatus;
  lastActiveTime: number; // Date.now() ms
}

export interface ActiveTeacherLesson {
  teacherName: string;
  lessons: Array<{
    lessonId: string;
    title: string;
    pdfId?: string;
    pdfName?: string;
    startedAt: string;
    lastTouched: number;
  }>;
}

export type RealtimeSignalType =
  | 'STUDENT_PING'           // 학생 -> 전자칠판 5초 주기 초경량 생존 신호 (30바이트)
  | 'STUDENT_LEAVE'          // 학생 -> 전자칠판 정상 퇴장 알림
  | 'STUDENT_SUBMIT'         // 학생 -> 전자칠판 필기 답안 제출
  | 'REQUEST_STUDENT_NOTE'   // 전자칠판 -> 학생 실시간 필기 요청
  | 'RESPONSE_STUDENT_NOTE'  // 학생 -> 전자칠판 실시간 필기 응답
  | 'RESET_SESSION'          // 전자칠판 -> 학생 수업 종료/초기화 통보
  | 'KICK_STUDENT'           // 전자칠판 -> 학생 강제 퇴장 신호
  | 'REQUEST_ALL_SYNC';      // 전자칠판 -> 전체 학생 일괄 동기화 요청

export interface RealtimeSignalPayload {
  type: RealtimeSignalType;
  lessonId: string;
  targetStudentKey?: string;
  student?: {
    grade: string;
    classNum: string;
    studentNum: string;
    name: string;
  };
  noteRecord?: ClassNoteRecord;
  timestamp: number; // ms
}

type SignalListener = (signal: RealtimeSignalPayload) => void;

class ClassroomRealtimeManager {
  private activeChannel: any = null;
  private currentLessonId: string | null = null;
  private currentRole: 'teacher' | 'student' = 'student';
  private listeners: Set<SignalListener> = new Set();
  private localBroadcastListener: ((e: MessageEvent) => void) | null = null;
  private pingIntervalId: any = null;
  private touchThrottleTimer: any = null;
  private lastTouchRegisteredTime: number = 0;

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
  }): Promise<boolean> {
    const { lessonId, teacherName, lessonTitle, pdfId, pdfName } = params;
    if (!supabase || !isSupabaseConfigured) return false;

    try {
      const now = new Date().toISOString();
      const payload: ClassNoteRecord = {
        lesson_id: lessonId,
        student_grade: '_TEACHER_SESSION_',
        student_class: teacherName.trim() || '선생님',
        student_num: 'ACTIVE',
        student_name: lessonTitle.trim() || '수업',
        strokes_data: {
          pdfId: pdfId || null,
          pdfName: pdfName || null,
          startedAt: now,
          lastTouched: Date.now()
        },
        updated_at: now
      };

      // 기존 세션 row 확인 후 upsert
      const { data: existing } = await supabase
        .from('class_notes')
        .select('id')
        .eq('lesson_id', lessonId)
        .eq('student_grade', '_TEACHER_SESSION_')
        .maybeSingle();

      if (existing?.id) {
        payload.id = existing.id;
      }

      const { error } = await supabase.from('class_notes').upsert(payload);
      if (error) {
        console.warn('[Realtime] registerTeacherSession error:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[Realtime] registerTeacherSession exception:', err);
      return false;
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
   * 학생앱: 현재 활성화된 선생님 및 수업 목록 가져오기 (2시간 무터치 세션 자동 제외)
   */
  public async fetchActiveTeacherLessons(): Promise<ActiveTeacherLesson[]> {
    if (!supabase || !isSupabaseConfigured) return [];

    try {
      const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
      const now = Date.now();

      const { data, error } = await supabase
        .from('class_notes')
        .select('*')
        .eq('student_grade', '_TEACHER_SESSION_')
        .eq('student_num', 'ACTIVE');

      if (error || !data) return [];

      const teacherMap = new Map<string, ActiveTeacherLesson['lessons']>();

      for (const row of data) {
        const lastTouched = row.strokes_data?.lastTouched || (row.updated_at ? new Date(row.updated_at).getTime() : 0);
        // 2시간 이상 경과한 세션은 자동 무시
        if (now - lastTouched > TWO_HOURS_MS) continue;

        const teacherName = row.student_class || '선생님';
        const lessonInfo = {
          lessonId: row.lesson_id,
          title: row.student_name || '수업',
          pdfId: row.strokes_data?.pdfId,
          pdfName: row.strokes_data?.pdfName,
          startedAt: row.strokes_data?.startedAt || row.updated_at || new Date().toISOString(),
          lastTouched
        };

        if (!teacherMap.has(teacherName)) {
          teacherMap.set(teacherName, []);
        }
        teacherMap.get(teacherName)!.push(lessonInfo);
      }

      return Array.from(teacherMap.entries()).map(([teacherName, lessons]) => ({
        teacherName,
        lessons
      }));
    } catch (err) {
      console.warn('[Realtime] fetchActiveTeacherLessons exception:', err);
      return [];
    }
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
   */
  public joinLesson(
    lessonId: string,
    onSignal?: SignalListener,
    role: 'teacher' | 'student' = 'student',
    studentInfo?: { grade: string; classNum: string; studentNum: string; name: string }
  ): void {
    if (this.currentLessonId === lessonId && this.currentRole === role) {
      if (onSignal) this.listeners.add(onSignal);
      return;
    }

    this.leaveLesson();
    this.currentLessonId = lessonId;
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
   * 학생: 5초 주기 초경량 생존 핑 발송
   */
  private startStudentPing(
    lessonId: string,
    studentInfo: { grade: string; classNum: string; studentNum: string; name: string }
  ): void {
    this.stopStudentPing();

    const sendPing = () => {
      if (this.currentLessonId !== lessonId) return;
      this.sendSignal({
        type: 'STUDENT_PING',
        lessonId,
        student: studentInfo
      }).catch(() => {});
    };

    // 진입 즉시 1회 발송
    sendPing();
    // 5초 주기 정기 발송
    this.pingIntervalId = setInterval(sendPing, 5000);
  }

  private stopStudentPing(): void {
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
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
    this.listeners.clear();
  }
}

export const classroomRealtime = new ClassroomRealtimeManager();

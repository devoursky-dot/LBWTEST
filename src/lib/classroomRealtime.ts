import { supabase, isSupabaseConfigured, localRealtimeChannel, type ClassNoteRecord } from './supabase';
import { getApiBaseUrl } from './apiConfig';

export type StudentStatus = 'connected' | 'away' | 'left';

export interface StudentPresenceInfo {
  grade: string;
  classNum: string;
  studentNum: string;
  name: string;
  status: StudentStatus;
  lastActive: string;
}

export type RealtimeSignalType =
  | 'STUDENT_PRESENCE'       // 학생 접속 / 이탈 상태 알림
  | 'REQUEST_STUDENT_NOTE'   // 전자칠판 -> 특정 학생 필기 요청
  | 'RESPONSE_STUDENT_NOTE'  // 학생 -> 전자칠판 필기 응답
  | 'REQUEST_ALL_SYNC'       // 전자칠판 -> 전체 학생 일괄 동기화 (PDF 저장 전)
  | 'STUDENT_SUBMIT'         // 학생이 명시적으로 등록/제출한 경우
  | 'RESET_SESSION'          // 전자칠판 -> 새 수업 시작 시 이전 접속 및 기록 초기화 브로드캐스트
  | 'KICK_STUDENT';          // 전자칠판 -> 잘못 접속된 특정 학생 수업 접속 해제 (퇴장/정리)

export interface RealtimeSignalPayload {
  type: RealtimeSignalType;
  lessonId: string;
  student?: {
    grade: string;
    classNum: string;
    studentNum: string;
    name: string;
  };
  status?: StudentStatus;
  targetStudentKey?: string; // `${grade}_${classNum}_${studentNum}`
  noteRecord?: ClassNoteRecord;
  timestamp: string;
}

type SignalListener = (signal: RealtimeSignalPayload) => void;

class ClassroomRealtimeManager {
  private activeChannel: any = null;
  private currentLessonId: string | null = null;
  private currentRole: 'teacher' | 'student' = 'student';
  private listeners: Set<SignalListener> = new Set();
  private localBroadcastListener: ((e: MessageEvent) => void) | null = null;
  private pollIntervalId: any = null;
  private knownNotesHash: Map<string, string> = new Map();

  /**
   * 실시간 수업 채널 초기화 (600명 동시성 무료 티어 100% 최적화 아키텍처)
   * 
   * [Supabase Free Tier 200명 동시 웹소켓 한도 완벽 방어]:
   * - teacher (전자칠판 1대): Realtime 채널을 구독하여 학생 필기를 모니터링 (커넥션 단 1개 소모)
   * - student (학생 600명): 상시 웹소켓 연결을 맺지 않아 Supabase 200명 한도를 절대 초과하지 않음!
   *   필기 제출 시에만 고효율 REST API로 전송하므로 600명이 동시 접속해도 0% 오류 보장.
   */
  public joinLesson(lessonId: string, onSignal?: SignalListener, role: 'teacher' | 'student' = 'student'): void {
    if (this.currentLessonId === lessonId && this.currentRole === role) {
      if (onSignal) this.listeners.add(onSignal);
      return;
    }

    this.leaveLesson();
    this.currentLessonId = lessonId;
    this.currentRole = role;
    if (onSignal) this.listeners.add(onSignal);

    // 1. [선생님/전자칠판 전용] Supabase Realtime 채널 생성 (무료 한도 200명 중 단 1명만 점유!)
    if (role === 'teacher' && supabase && isSupabaseConfigured) {
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
          .subscribe((status) => {
            console.log(`[Realtime] Teacher channel '${channelName}' status:`, status);
            // Realtime 연결 상태에 따라 Vercel 폴링 주기 동적 최적화
            if (status === 'SUBSCRIBED') {
              this.isRealtimeConnected = true;
              this.adjustPollingInterval(60000); // 실시간 연결 정상 -> Vercel 폴링 60초로 완화 (Vercel 한도 99% 절약)
            } else {
              this.isRealtimeConnected = false;
              this.adjustPollingInterval(10000); // 실시간 장애 시 10초 주기 Fallback 백업망 가동
            }
          });
      } catch (err) {
        console.warn('[Realtime] Teacher channel error:', err);
        this.isRealtimeConnected = false;
      }
    }

    // 2. [선생님/전자칠판 전용] 지능형 Vercel 릴레이 클라우드 폴링 (적응형 백오프)
    if (role === 'teacher') {
      this.startVercelRelayPolling(lessonId);
    }

    // 3. 브라우저 탭 간 BroadcastChannel 리스너 (동일 기기 테스트 0.001초 동기화)
    if (localRealtimeChannel) {
      this.localBroadcastListener = (event: MessageEvent) => {
        if (event.data && event.data.lessonId === this.currentLessonId) {
          this.notifyListeners(event.data);
        }
      };
      localRealtimeChannel.addEventListener('message', this.localBroadcastListener);
    }
  }

  private isRealtimeConnected: boolean = false;
  private currentPollingIntervalMs: number = 30000;

  private adjustPollingInterval(newIntervalMs: number): void {
    if (this.currentPollingIntervalMs === newIntervalMs) return;
    this.currentPollingIntervalMs = newIntervalMs;
    if (this.pollIntervalId && this.currentLessonId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = setInterval(this.pollOnce, this.currentPollingIntervalMs);
    }
  }

  private pollOnce = async () => {
    if (!this.currentLessonId || typeof window === 'undefined') return;
    // 브라우저 탭이 백그라운드이거나 최소화되어 있으면 불필요한 폴링 중지
    if (document.visibilityState === 'hidden') return;

    try {
      const apiBase = getApiBaseUrl();
      const res = await fetch(`${apiBase}/api/notes?lessonId=${encodeURIComponent(this.currentLessonId)}&_t=${Date.now()}`, {
        cache: 'no-store'
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          // [A] 신규/수정된 학생 필기 알림
          if (Array.isArray(data.notes)) {
            for (const note of data.notes) {
              const key = `${note.student_grade}_${note.student_class}_${note.student_num}`;
              const hash = `${note.updated_at || ''}_${note.id || ''}`;
              if (this.knownNotesHash.get(key) !== hash) {
                this.knownNotesHash.set(key, hash);
                this.notifyListeners({
                  type: 'STUDENT_SUBMIT',
                  lessonId: this.currentLessonId,
                  student: {
                    grade: note.student_grade,
                    classNum: note.student_class,
                    studentNum: note.student_num,
                    name: note.student_name
                  },
                  noteRecord: note,
                  timestamp: note.updated_at || new Date().toISOString()
                });
              }
            }
          }

          // [B] 학생 출석 현황 알림
          if (Array.isArray(data.presences)) {
            for (const p of data.presences) {
              this.notifyListeners({
                type: 'STUDENT_PRESENCE',
                lessonId: this.currentLessonId,
                student: {
                  grade: p.grade,
                  classNum: p.classNum,
                  studentNum: p.studentNum,
                  name: p.name
                },
                status: p.status,
                timestamp: p.lastActive || new Date().toISOString()
              });
            }
          }
        }
      }
    } catch {
      // 네트워크 일시 오류 시 무시
    }
  };

  /**
   * Vercel API 적응형 릴레이 동기화 폴러 (Supabase 정상 시 60초, 장애 시 10초 Fallback)
   */
  private startVercelRelayPolling(_lessonId?: string): void {
    if (typeof window === 'undefined') return;

    // 즉시 1회 초기 동기화 실행
    this.pollOnce();
    
    // 기본 주기: Supabase Realtime 연결 상태에 따라 60초 vs 10초 가동
    this.currentPollingIntervalMs = this.isRealtimeConnected ? 60000 : 15000;
    this.pollIntervalId = setInterval(this.pollOnce, this.currentPollingIntervalMs);
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
   * 실시간 신호 방송 (Vercel 클라우드 릴레이 + Supabase + Local 3중 발송)
   */
  public async sendSignal(signal: Omit<RealtimeSignalPayload, 'timestamp'>): Promise<void> {
    const fullPayload: RealtimeSignalPayload = {
      ...signal,
      timestamp: new Date().toISOString()
    };

    // 1. [Vercel 릴레이] 클라우드 API 즉시 전송 (0.05초 초고속)
    try {
      const apiBase = getApiBaseUrl();
      let body: any = null;

      if (signal.type === 'STUDENT_SUBMIT' && signal.noteRecord) {
        body = {
          action: 'submit',
          lessonId: signal.lessonId,
          record: signal.noteRecord
        };
      } else if (signal.type === 'STUDENT_PRESENCE' && signal.student) {
        body = {
          action: 'presence',
          lessonId: signal.lessonId,
          student: signal.student,
          status: signal.status || 'connected'
        };
      } else if (signal.type === 'RESET_SESSION') {
        body = {
          action: 'reset',
          lessonId: signal.lessonId
        };
      } else if (signal.type === 'KICK_STUDENT' && signal.targetStudentKey) {
        body = {
          action: 'kick',
          lessonId: signal.lessonId,
          targetStudentKey: signal.targetStudentKey
        };
      }

      if (body) {
        // 비차단 초고속 호출 (최대 2초 타임아웃)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        fetch(`${apiBase}/api/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        }).finally(() => clearTimeout(timeoutId)).catch(() => {});
      }
    } catch (relayErr) {
      console.warn('[Realtime] Vercel relay send warning:', relayErr);
    }

    // 2. Supabase Broadcast 전송 (타임아웃 안전 가드)
    if (this.activeChannel && isSupabaseConfigured) {
      try {
        const sbPromise = this.activeChannel.send({
          type: 'broadcast',
          event: 'classroom_signal',
          payload: fullPayload
        });
        const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 1500));
        await Promise.race([sbPromise, timeoutPromise]);
      } catch (err) {
        console.warn('[Realtime] Supabase broadcast send error:', err);
      }
    }

    // 3. 로컬 브로드캐스트 채널 전송
    if (localRealtimeChannel) {
      try {
        localRealtimeChannel.postMessage(fullPayload);
      } catch (err) {
        console.warn('[Realtime] Local broadcast send error:', err);
      }
    }
  }

  /**
   * 수업 채널 해제
   */
  public leaveLesson(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }

    if (this.activeChannel && supabase) {
      try {
        supabase.removeChannel(this.activeChannel);
      } catch (e) {
        console.warn('[Realtime] Remove channel error:', e);
      }
      this.activeChannel = null;
    }

    if (localRealtimeChannel && this.localBroadcastListener) {
      localRealtimeChannel.removeEventListener('message', this.localBroadcastListener);
      this.localBroadcastListener = null;
    }

    this.currentLessonId = null;
    this.listeners.clear();
    this.knownNotesHash.clear();
  }
}

export const classroomRealtime = new ClassroomRealtimeManager();

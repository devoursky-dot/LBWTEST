import { supabase, isSupabaseConfigured, localRealtimeChannel, type ClassNoteRecord } from './supabase';

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
  | 'RESET_SESSION';         // 전자칠판 -> 새 수업 시작 시 이전 접속 및 기록 초기화 브로드캐스트

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
  private listeners: Set<SignalListener> = new Set();
  private localBroadcastListener: ((e: MessageEvent) => void) | null = null;

  /**
   * 실시간 수업 채널 초기화 (Supabase Realtime + Local BroadcastChannel 지원)
   */
  public joinLesson(lessonId: string, onSignal?: SignalListener): void {
    if (this.currentLessonId === lessonId && this.activeChannel) {
      if (onSignal) this.listeners.add(onSignal);
      return;
    }

    this.leaveLesson();
    this.currentLessonId = lessonId;
    if (onSignal) this.listeners.add(onSignal);

    // 1. Supabase Realtime 채널 생성
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
          .subscribe((status) => {
            console.log(`[Realtime] Supabase channel '${channelName}' status:`, status);
          });
      } catch (err) {
        console.warn('[Realtime] Supabase channel error:', err);
      }
    }

    // 2. 브라우저 탭 간 BroadcastChannel 리스너
    if (localRealtimeChannel) {
      this.localBroadcastListener = (event: MessageEvent) => {
        if (event.data && event.data.lessonId === this.currentLessonId) {
          this.notifyListeners(event.data);
        }
      };
      localRealtimeChannel.addEventListener('message', this.localBroadcastListener);
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
   * 실시간 신호 방송 (Broadcast)
   */
  public async sendSignal(signal: Omit<RealtimeSignalPayload, 'timestamp'>): Promise<void> {
    const fullPayload: RealtimeSignalPayload = {
      ...signal,
      timestamp: new Date().toISOString()
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
      } catch (err) {
        console.warn('[Realtime] Local broadcast send error:', err);
      }
    }
  }

  /**
   * 수업 채널 해제
   */
  public leaveLesson(): void {
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
  }
}

export const classroomRealtime = new ClassroomRealtimeManager();

import { createClient } from '@supabase/supabase-js';

// 선생님의 Supabase 프로젝트 lbw_trans URL
const DEFAULT_SUPABASE_URL = 'https://pfaxpqkmnrpocuamtnot.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_qbInPtEifr7EmUgn8NjhRw_F1jBdsNm';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) || (import.meta.env.NEXT_PUBLIC_SUPABASE_URL as string) || DEFAULT_SUPABASE_URL;
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || (import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string) || DEFAULT_SUPABASE_KEY;

export interface ClassNoteRecord {
  id?: string;
  lesson_id: string;
  student_grade: string;
  student_class: string;
  student_num: string;
  student_name: string;
  strokes_data: any;
  created_at?: string;
  updated_at?: string;
  is_archived?: boolean;
}

// Supabase 클라이언트 초기화 (Key가 아직 없어도 오류가 나지 않도록 안전하게 가드)
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_ANON_KEY.length > 20);

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// 로컬 환경 및 브라우저 탭 간 실시간 통신 채널 (Supabase Key 입력 전에도 로컬 테스트 100% 가능)
export const localRealtimeChannel = typeof window !== 'undefined' && 'BroadcastChannel' in window
  ? new BroadcastChannel('lbw_class_notes_local')
  : null;

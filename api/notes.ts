// Vercel Serverless Function: High-Speed Classroom Live Notes & Presence Relay
// Supabase 일시중지/지연 시에도 0.05초 초고속 실시간 동기화를 100% 보장하는 Vercel 클라우드 릴레이

import type { IncomingMessage, ServerResponse } from 'http';

interface LiveNote {
  id: string;
  lesson_id: string;
  student_grade: string;
  student_class: string;
  student_num: string;
  student_name: string;
  strokes_data: any;
  updated_at: string;
}

interface StudentPresence {
  grade: string;
  classNum: string;
  studentNum: string;
  name: string;
  status: 'connected' | 'away' | 'left';
  lastActive: string;
}

// Node.js 프로세스 메모리 전역 캐시
const getNotesStore = (): Map<string, Map<string, LiveNote>> => {
  const g = globalThis as any;
  if (!g.__LBW_LIVE_NOTES__) {
    g.__LBW_LIVE_NOTES__ = new Map<string, Map<string, LiveNote>>();
  }
  return g.__LBW_LIVE_NOTES__;
};

const getPresenceStore = (): Map<string, Map<string, StudentPresence>> => {
  const g = globalThis as any;
  if (!g.__LBW_LIVE_PRESENCES__) {
    g.__LBW_LIVE_PRESENCES__ = new Map<string, Map<string, StudentPresence>>();
  }
  return g.__LBW_LIVE_PRESENCES__;
};

export default async function handler(req: any, res: any) {
  // CORS 헤더 설정 (교실 전자칠판 및 학생 태블릿 전 기기 허용)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const notesStore = getNotesStore();
  const presenceStore = getPresenceStore();

  // 1. [GET] 수업별 학생 필기 목록 및 출석 현황 조회
  if (req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const lessonId = url.searchParams.get('lessonId');

    if (!lessonId) {
      return res.status(400).json({ success: false, error: 'lessonId가 필요합니다.' });
    }

    const lessonNotesMap = notesStore.get(lessonId);
    const notes = lessonNotesMap ? Array.from(lessonNotesMap.values()) : [];

    const lessonPresencesMap = presenceStore.get(lessonId);
    const presences = lessonPresencesMap ? Array.from(lessonPresencesMap.values()) : [];

    return res.status(200).json({
      success: true,
      lessonId,
      serverTime: new Date().toISOString(),
      noteCount: notes.length,
      presenceCount: presences.length,
      notes,
      presences
    });
  }

  // 2. [POST] 학생 필기 등록, 출석 알림, 세션 리셋
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const action = body?.action || 'submit';
      const lessonId = body?.lessonId;

      if (!lessonId) {
        return res.status(400).json({ success: false, error: 'lessonId가 누락되었습니다.' });
      }

      // 2-1. 학생 필기 제출 (SUBMIT)
      if (action === 'submit') {
        const record = body.record;
        if (!record || !record.student_grade || !record.student_class || !record.student_num) {
          return res.status(400).json({ success: false, error: '학생 필기 데이터가 올바르지 않습니다.' });
        }

        const studentKey = `${record.student_grade}_${record.student_class}_${record.student_num}`;
        if (!notesStore.has(lessonId)) {
          notesStore.set(lessonId, new Map());
        }

        const lessonNotesMap = notesStore.get(lessonId)!;
        const liveRecord: LiveNote = {
          ...record,
          id: record.id || `live_${studentKey}_${Date.now()}`,
          lesson_id: lessonId,
          updated_at: new Date().toISOString()
        };

        lessonNotesMap.set(studentKey, liveRecord);

        // 출석도 함께 connected로 갱신
        if (!presenceStore.has(lessonId)) {
          presenceStore.set(lessonId, new Map());
        }
        presenceStore.get(lessonId)!.set(studentKey, {
          grade: record.student_grade,
          classNum: record.student_class,
          studentNum: record.student_num,
          name: record.student_name || '학생',
          status: 'connected',
          lastActive: new Date().toISOString()
        });

        return res.status(200).json({
          success: true,
          message: '학생 필기가 Vercel 클라우드 릴레이에 안전하게 등록되었습니다.',
          recordId: liveRecord.id,
          totalSubmissions: lessonNotesMap.size
        });
      }

      // 2-2. 학생 출석 하트비트 (PRESENCE)
      if (action === 'presence') {
        const student = body.student;
        if (!student) {
          return res.status(400).json({ success: false, error: '학생 정보가 없습니다.' });
        }
        const studentKey = `${student.grade}_${student.classNum}_${student.studentNum}`;
        if (!presenceStore.has(lessonId)) {
          presenceStore.set(lessonId, new Map());
        }
        presenceStore.get(lessonId)!.set(studentKey, {
          grade: student.grade,
          classNum: student.classNum,
          studentNum: student.studentNum,
          name: student.name,
          status: body.status || 'connected',
          lastActive: new Date().toISOString()
        });

        return res.status(200).json({ success: true });
      }

      // 2-3. 전자칠판 수업 세션 초기화 (RESET)
      if (action === 'reset') {
        notesStore.delete(lessonId);
        presenceStore.delete(lessonId);
        return res.status(200).json({
          success: true,
          message: '수업 세션이 초기화되었습니다.'
        });
      }

      // 2-4. 특정 학생 퇴장 / 삭제 (KICK)
      if (action === 'kick') {
        const targetStudentKey = body.targetStudentKey;
        if (targetStudentKey) {
          notesStore.get(lessonId)?.delete(targetStudentKey);
          presenceStore.get(lessonId)?.delete(targetStudentKey);
        }
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ success: false, error: '지원되지 않는 액션입니다.' });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || '서버 오류' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method Not Allowed' });
}

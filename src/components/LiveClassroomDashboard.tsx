import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase, isSupabaseConfigured, type ClassNoteRecord } from '../lib/supabase';
import { classroomRealtime, type StudentPresenceInfo, type RealtimeSignalPayload } from '../lib/classroomRealtime';
import { getLocalVersionInfo } from '../modules/version';
import { getApiBaseUrl } from '../lib/apiConfig';
import { getDriveConfig, fetchDriveItems } from '../lib/driveService';
import { generateClassSubmissionPdf } from '../lib/pdfGenerator';
import { StudentNoteFullscreenViewer } from './StudentNoteFullscreenViewer';

export interface LiveClassroomDashboardProps {
  lesson: {
    id: string;
    folderId?: string;
    name: string;
    teacherPin?: string;
  };
  initialClear?: boolean;
  onExit: () => void;
  onOpenFolder?: (folderId: string, folderName: string) => void;
  executeDriveAction: (payload: any) => Promise<any>;
  showToast: (msg: string) => void;
}

export const LiveClassroomDashboard: React.FC<LiveClassroomDashboardProps> = ({
  lesson,
  initialClear = false,
  onExit,
  onOpenFolder: _onOpenFolder,
  executeDriveAction,
  showToast
}) => {
  const currentLessonId = lesson.folderId || lesson.id;
  const cleanLessonTitle = lesson.name.replace('[QR수업]', '').trim();
  const boardVersion = useMemo(() => getLocalVersionInfo().version, []);

  // 학생 접속 URL 상태
  const [studentUrl, setStudentUrl] = useState<string>('');

  // 실시간 학생 접속 및 제출 목록 상태
  const [_studentPresences, setStudentPresences] = useState<Map<string, StudentPresenceInfo>>(new Map());
  const [studentSubmissions, setStudentSubmissions] = useState<ClassNoteRecord[]>([]);
  const [selectedStudentNote, setSelectedStudentNote] = useState<ClassNoteRecord | null>(null);
  const [selectedStudentPageIdx, setSelectedStudentPageIdx] = useState<number>(0);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);
  const selectedStudentKeyRef = useRef<string | null>(null);

  // PDF 일괄 컴파일 상태
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  const [pdfProgress, setPdfProgress] = useState<{ current: number; total: number; name: string } | null>(null);

  // 25명 한화면 자동배치 보기 모드 ('auto' | 'scroll')
  const [viewMode, setViewMode] = useState<'auto' | 'scroll'>('auto');

  // 수업자료 목록 및 다운로드 모달 상태 (본 수업에 공식 등록된 자료만 엄격히 관리)
  const [lessonMaterials, setLessonMaterials] = useState<Array<{ id: string; name: string; mimeType?: string; size?: string; updatedAt?: string; sourceTag?: string; modifiedTime?: string; viewUrl?: string }>>([]);
  const [isLoadingMaterials, setIsLoadingMaterials] = useState<boolean>(false);
  const [materialSearchTerm, setMaterialSearchTerm] = useState<string>('');
  const [isMaterialModalOpen, setIsMaterialModalOpen] = useState<boolean>(false);

  // 본 수업에 공식 등록된 수업자료(대표 PDF 및 첨부 학습지)만 엄격히 동기화 (학생 필기 파일 원천 차단)
  const fetchRegisteredLessonMaterials = useCallback(async () => {
    setIsLoadingMaterials(true);
    const materialsMap = new Map<string, any>();
    const apiBase = getApiBaseUrl();

    // 1) lesson prop에 이미 등록된 attachedFiles 및 pdfFileId 최우선 수집
    if ((lesson as any).attachedFiles && Array.isArray((lesson as any).attachedFiles)) {
      (lesson as any).attachedFiles.forEach((f: any) => {
        if (f && f.id) {
          materialsMap.set(f.id, {
            id: f.id,
            name: f.name,
            mimeType: f.mimeType || 'application/pdf',
            size: f.size,
            sourceTag: '수업 등록 자료'
          });
        }
      });
    }
    if ((lesson as any).pdfFileId) {
      materialsMap.set((lesson as any).pdfFileId, {
        id: (lesson as any).pdfFileId,
        name: (lesson as any).pdfFileName || `${cleanLessonTitle}.pdf`,
        mimeType: 'application/pdf',
        sourceTag: '수업 대표 교재'
      });
    }

    // 2) Supabase 교사 세션 row에서 공식 등록된 첨부자료 동기화
    if (supabase && isSupabaseConfigured && currentLessonId) {
      try {
        const { data: sessData } = await supabase
          .from('class_notes')
          .select('strokes_data')
          .eq('lesson_id', currentLessonId)
          .eq('student_grade', '_TEACHER_SESSION_')
          .maybeSingle();

        if (sessData?.strokes_data) {
          if (sessData.strokes_data.attachedFiles && Array.isArray(sessData.strokes_data.attachedFiles)) {
            sessData.strokes_data.attachedFiles.forEach((f: any) => {
              if (f && f.id && !materialsMap.has(f.id)) {
                materialsMap.set(f.id, {
                  id: f.id,
                  name: f.name,
                  mimeType: f.mimeType || 'application/pdf',
                  size: f.size,
                  sourceTag: '수업 등록 자료'
                });
              }
            });
          }
          if (sessData.strokes_data.pdfId && !materialsMap.has(sessData.strokes_data.pdfId)) {
            materialsMap.set(sessData.strokes_data.pdfId, {
              id: sessData.strokes_data.pdfId,
              name: sessData.strokes_data.pdfName || `${cleanLessonTitle}.pdf`,
              mimeType: 'application/pdf',
              sourceTag: '수업 대표 교재'
            });
          }
        }
      } catch (err) {
        console.warn('Supabase registered materials fetch error:', err);
      }
    }

    // 3) 구글 드라이브 수업 폴더(currentLessonId) 내의 실제 파일 목록 직접 조회
    if (currentLessonId) {
      try {
        const driveFiles = await fetchDriveItems(currentLessonId);
        for (const item of driveFiles) {
          if (item.type === 'folder') continue;
          if (item.name === 'lesson_config.json') continue;
          if (item.name.toLowerCase().endsWith('.png') && item.name.toLowerCase().includes('qr')) continue;
          if (!materialsMap.has(item.id)) {
            const isPdf = item.name.toLowerCase().endsWith('.pdf');
            materialsMap.set(item.id, {
              id: item.id,
              name: item.name,
              mimeType: isPdf ? 'application/pdf' : undefined,
              size: item.size,
              sourceTag: isPdf ? '수업 등록 교재' : '수업 등록 자료'
            });
          }
        }
      } catch (driveErr) {
        console.warn('LiveClassroomDashboard fetchDriveItems error:', driveErr);
      }
    }

    // 4) 구글 드라이브 lesson_config.json에서 외부 등록된 첨부자료 보충 확인
    if (currentLessonId) {
      try {
        const apiKey = getDriveConfig().googleApiKey;
        const directUrl = `https://www.googleapis.com/drive/v3/files?q='${currentLessonId}'+in+parents+and+name='lesson_config.json'+and+trashed=false&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name)&key=${apiKey}&_t=${Date.now()}`;
        const cRes = await fetch(directUrl);
        if (cRes.ok) {
          const cData = await cRes.json();
          const cfgFile = (cData.files || [])[0];
          if (cfgFile) {
            const dlRes = await fetch(`${apiBase}/api/drive?action=download&fileId=${cfgFile.id}&fileName=lesson_config.json`);
            if (dlRes.ok) {
              const cfgJson = await dlRes.json();
              if (cfgJson.attachedFiles && Array.isArray(cfgJson.attachedFiles)) {
                cfgJson.attachedFiles.forEach((f: any) => {
                  if (f && f.id && !materialsMap.has(f.id)) {
                    materialsMap.set(f.id, {
                      id: f.id,
                      name: f.name,
                      mimeType: f.mimeType || 'application/pdf',
                      size: f.size,
                      sourceTag: '수업 등록 자료'
                    });
                  }
                });
              }
              if (cfgJson.pdfId && !materialsMap.has(cfgJson.pdfId)) {
                materialsMap.set(cfgJson.pdfId, {
                  id: cfgJson.pdfId,
                  name: cfgJson.pdfName || `${cleanLessonTitle}.pdf`,
                  mimeType: 'application/pdf',
                  sourceTag: '수업 대표 교재'
                });
              }
            }
          }
        }
      } catch (cfgErr) {
        console.warn('lesson_config.json fetch error:', cfgErr);
      }
    }

    setLessonMaterials(Array.from(materialsMap.values()));
    setIsLoadingMaterials(false);
  }, [currentLessonId, cleanLessonTitle, (lesson as any).attachedFiles, (lesson as any).pdfFileId, (lesson as any).pdfFileName]);

  // 전자칠판 수업자료 스트리밍 다운로드 엔진 (구글 로그인/바이러스 경고 0%)
  const handleDownloadMaterial = (file: { id: string; name: string }) => {
    showToast(`📥 '${file.name}' 수업자료 다운로드를 시작합니다...`);
    const apiBase = getApiBaseUrl();
    const downloadUrl = `${apiBase}/api/drive?action=download&fileId=${file.id}&fileName=${encodeURIComponent(file.name)}`;

    try {
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute('download', file.name);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        try {
          if (document.body.contains(link)) document.body.removeChild(link);
        } catch {}
      }, 800);
    } catch (aErr) {
      console.warn('Material download fallback warning:', aErr);
      window.open(downloadUrl, '_blank');
    }
  };

  // 1. 학생 전용 접속 URL 생성 & 수업자료 일괄 수집
  useEffect(() => {
    const currentPath = window.location.pathname.replace(/\/$/, '');
    const baseOrigin = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'https://devoursky-dot.github.io/LBWTEST'
      : `${window.location.origin}${currentPath}`;
    let generatedUrl = `${baseOrigin}/?lessonId=${currentLessonId}&title=${encodeURIComponent(cleanLessonTitle)}`;
    if ((lesson as any).pdfFileId) {
      generatedUrl += `&pdfId=${encodeURIComponent((lesson as any).pdfFileId)}`;
      if ((lesson as any).pdfFileName) {
        generatedUrl += `&pdfName=${encodeURIComponent((lesson as any).pdfFileName)}`;
      }
    }
    setStudentUrl(generatedUrl);

    // 1-2. 본 수업에 공식 등록된 수업자료 즉시 동기화
    fetchRegisteredLessonMaterials();
  }, [currentLessonId, cleanLessonTitle, (lesson as any).pdfFileId, (lesson as any).pdfFileName, (lesson as any).attachedFiles, fetchRegisteredLessonMaterials]);

  // 2. 초기 DB 제출 목록 조회 (Vercel 클라우드 릴레이 + Supabase 1.5초 가드)
  const fetchSubmissionsFromDb = async () => {
    // 2-1. Vercel 클라우드 릴레이 즉시 조회 (0.05초)
    try {
      const apiBase = getApiBaseUrl();
      const res = await fetch(`${apiBase}/api/notes?lessonId=${encodeURIComponent(currentLessonId)}&_t=${Date.now()}`, {
        cache: 'no-store'
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.notes) && data.notes.length > 0) {
          const studentOnlyNotes = (data.notes as ClassNoteRecord[]).filter(
            n => n.student_grade !== '_TEACHER_SESSION_' && !n.student_grade?.startsWith('_TEACHER')
          );
          setStudentSubmissions(studentOnlyNotes);
        }
      }
    } catch {}

    // 2-2. Supabase 1.5초 타임아웃 가드 (DB 장애 시 화면 멈춤 원천 차단)
    if (!supabase || !isSupabaseConfigured) return;
    try {
      const sbPromise = supabase
        .from('class_notes')
        .select('*')
        .eq('lesson_id', currentLessonId)
        .neq('student_grade', '_TEACHER_SESSION_')
        .order('updated_at', { ascending: false });
      const timeoutPromise = new Promise<any>((resolve) =>
        setTimeout(() => resolve({ data: null, error: new Error('TIMEOUT') }), 1500)
      );
      const { data, error } = await Promise.race([sbPromise, timeoutPromise]);

      if (!error && data && data.length > 0) {
        const studentOnlyNotes = (data as ClassNoteRecord[]).filter(
          n => n.student_grade !== '_TEACHER_SESSION_' && !n.student_grade?.startsWith('_TEACHER')
        );
        setStudentSubmissions(studentOnlyNotes);
      }
    } catch (e) {
      console.warn('초기 제출 목록 로드 오류:', e);
    }
  };

  // 세션 전체 초기화 함수 (새로운 반 또는 새 수업 시작 시)
  const handleResetSession = async () => {
    if (!window.confirm('정말 현재 수업의 모든 학생 출석 및 필기 기록을 초기화하시겠습니까?\n새로운 반 학생들의 등록을 깨끗하게 새로 받습니다.')) {
      return;
    }
    try {
      // 1. Vercel 릴레이 초기화
      try {
        const apiBase = getApiBaseUrl();
        fetch(`${apiBase}/api/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reset', lessonId: currentLessonId })
        }).catch(() => {});
      } catch {}

      // 2. Supabase 학생 필기만 비동기 삭제 (교사 세션 row 보존)
      if (supabase && isSupabaseConfigured) {
        const delPromise = supabase.from('class_notes').delete().eq('lesson_id', currentLessonId).neq('student_grade', '_TEACHER_SESSION_');
        const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 1500));
        Promise.race([delPromise, timeoutPromise]).catch(() => {});
      }

      kickedStudentKeysRef.current.clear();
      setStudentSubmissions([]);
      setStudentPresences(new Map());
      setStudentHeartbeats(new Map());
      setSelectedStudentNote(null);
      selectedStudentKeyRef.current = null;

      // 연결되어 있던 학생 기기들에 세션 리셋 신호 전파
      classroomRealtime.sendSignal({
        type: 'RESET_SESSION',
        lessonId: currentLessonId
      });

      showToast('✨ 수업 세션 및 출석 기록이 깨끗이 초기화되었습니다.');
    } catch (e: any) {
      console.error('초기화 오류:', e);
      showToast('❌ 초기화 중 오류가 발생했습니다.');
    }
  };

  useEffect(() => {
    if (initialClear) {
      setStudentSubmissions([]);
      setStudentPresences(new Map());
      if (supabase && isSupabaseConfigured) {
        supabase.from('class_notes').delete().eq('lesson_id', currentLessonId).then(() => {
          classroomRealtime.sendSignal({
            type: 'RESET_SESSION',
            lessonId: currentLessonId
          });
        });
      }
    } else {
      fetchSubmissionsFromDb();
    }
  }, [currentLessonId, initialClear]);

  // 4. 학생별 실시간 핑 상태 추적 Map: key -> { student, lastPingTime, status, isAway }
  // 🚨 선생님이 칠판에서 강제 삭제한 학생 키 목록 (구버전 클라이언트의 자동 재핑 무한 부활 100% 원천 차단)
  const kickedStudentKeysRef = useRef<Set<string>>(new Set());

  const [studentHeartbeats, setStudentHeartbeats] = useState<Map<string, {
    grade: string;
    classNum: string;
    studentNum: string;
    name: string;
    lastPingTime: number;
    status: 'connected' | 'checking' | 'disconnected';
    isAway?: boolean;
    currentPage?: number;
    totalPages?: number;
    appVersion?: string;
  }>>(new Map());

  // 1시간 절대 세션 타이머 (수업 시작 기준 60분 후 자동 종료)
  // 수업 타이머 (설정된 시간 후 자동 종료 & 10분 연장 지원)
  const initialDuration = (lesson as any).sessionDurationMinutes || 60;
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number>(() => {
    return Date.now() + initialDuration * 60 * 1000;
  });
  const [remainingMinutes, setRemainingMinutes] = useState<number>(initialDuration);
  const lastInteractionTimeRef = useRef<number>(Date.now());

  // 10분 연장 핸들러
  const handleExtendSession = async () => {
    const nextExpires = Math.max(sessionExpiresAt, Date.now()) + 10 * 60 * 1000;
    setSessionExpiresAt(nextExpires);
    setRemainingMinutes(Math.max(1, Math.ceil((nextExpires - Date.now()) / 60000)));
    await classroomRealtime.extendTeacherSession(currentLessonId, 10);
    showToast('⏱️ 수업 시간이 10분 연장되었습니다.');
  };

  // 화면 터치/클릭 발생 시 마지막 조작 시간 갱신 & Supabase 세션 터치
  const handleUserInteraction = useCallback(() => {
    lastInteractionTimeRef.current = Date.now();
    classroomRealtime.touchTeacherSession(currentLessonId);
  }, [currentLessonId]);

  // 1초 주기로 학생 생존 핑 및 수업 만료 검사
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();

      // [A] 설정된 수업 시간 경과 시 자동 세션 종료
      if (now >= sessionExpiresAt) {
        clearInterval(timer);
        showToast('⏱️ 수업 시간이 경과하여 수업이 안전하게 자동 종료되었습니다.');
        classroomRealtime.closeTeacherSession(currentLessonId);
        onExit();
        return;
      }
      setRemainingMinutes(Math.max(1, Math.ceil((sessionExpiresAt - now) / 60000)));

      // [B] 학생 5초 핑 상태 정밀 판정 (8초 이내: 정상, 8~15초: 확인 중, 15초 초과: 끊김)
      setStudentHeartbeats((prev) => {
        let changed = false;
        const next = new Map(prev);

        for (const [key, info] of next.entries()) {
          const diff = now - info.lastPingTime;
          let newStatus = info.status;

          if (diff <= 8000) {
            newStatus = 'connected';
          } else if (diff <= 15000) {
            newStatus = 'checking';
          } else {
            newStatus = 'disconnected';
          }

          if (newStatus !== info.status) {
            next.set(key, { ...info, status: newStatus });
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [currentLessonId, onExit]);

  // 3. 실시간 신호 채널 구독 (Supabase Realtime)
  useEffect(() => {
    classroomRealtime.joinLesson(currentLessonId, undefined, 'teacher');

    const unsubscribe = classroomRealtime.subscribe((signal: RealtimeSignalPayload) => {
      if (signal.lessonId !== currentLessonId) return;

      // [1] 학생 5초 주기 생존 핑(PING) 수신
      if (signal.type === 'STUDENT_PING' && signal.student) {
        // 교사 실시간 세션키 검증: 이전 수업 유령 핑이 새 수업 출석부에 유입되는 것 100% 방지
        const currentTeacherSessionKey = (lesson as any).sessionKey;
        if (currentTeacherSessionKey && signal.sessionKey && signal.sessionKey !== currentTeacherSessionKey) {
          return;
        }

        const key = `${signal.student.grade}_${signal.student.classNum}_${signal.student.studentNum}`;

        // 🚨 만약 선생님이 칠판에서 삭제한 학생이라면 핑을 100% 폐기하여 타일에 절대 다시 띄우지 않음!
        if (kickedStudentKeysRef.current.has(key)) {
          return;
        }

        const now = Date.now();

        setStudentHeartbeats((prev) => {
          const next = new Map(prev);
          const wasExisting = next.has(key);
          const prevStatus = next.get(key)?.status;

          next.set(key, {
            ...signal.student!,
            lastPingTime: now,
            status: 'connected',
            isAway: Boolean(signal.student?.isAway),
            currentPage: signal.student?.currentPage,
            totalPages: signal.student?.totalPages,
            appVersion: signal.student?.appVersion
          });

          // 처음 접속하거나 복귀했을 때만 토스트 알림 1회
          if (!wasExisting || prevStatus === 'disconnected') {
            showToast(`🟢 ${signal.student!.grade}-${signal.student!.classNum} ${signal.student!.name} 학생 접속됨`);
          }
          return next;
        });
      }

      // [2] 학생 정상 퇴장(LEAVE) 수신
      if (signal.type === 'STUDENT_LEAVE' && signal.student) {
        const key = `${signal.student.grade}_${signal.student.classNum}_${signal.student.studentNum}`;
        setStudentHeartbeats((prev) => {
          const next = new Map(prev);
          const existing = next.get(key);
          if (existing) {
            next.set(key, { ...existing, status: 'disconnected' });
          }
          return next;
        });
        showToast(`🚪 ${signal.student.name} 학생 퇴장`);
      }

      // [3] 학생 필기 등록 / 제출
      if (signal.type === 'STUDENT_SUBMIT' && signal.noteRecord) {
        const record = signal.noteRecord;
        const recKey = `${record.student_grade}_${record.student_class}_${record.student_num}`;
        setStudentSubmissions((prev) => {
          const filtered = prev.filter(p => !(
            p.student_grade === record.student_grade &&
            p.student_class === record.student_class &&
            p.student_num === record.student_num
          ));
          return [record, ...filtered];
        });
        if (selectedStudentKeyRef.current === recKey) {
          setSelectedStudentNote(record);
          setIsLoadingDetail(false);
        }
        showToast(`📝 ${record.student_grade}-${record.student_class} ${record.student_name} 학생 답안 제출!`);
      }

      // [4] 온디맨드 필기 응답 수신 (웹소켓 데이터 직접 반영 + DB 동기화 2중 안전망)
      if (signal.type === 'RESPONSE_STUDENT_NOTE') {
        const student = signal.student || (signal.noteRecord ? {
          grade: signal.noteRecord.student_grade,
          classNum: signal.noteRecord.student_class,
          studentNum: signal.noteRecord.student_num,
          name: signal.noteRecord.student_name
        } : null);

        if (student) {
          const recKey = `${student.grade}_${student.classNum}_${student.studentNum}`;

          // 1) 웹소켓 페이로드에 noteRecord가 실려온 경우 즉각 반영
          if (signal.noteRecord) {
            if (selectedStudentKeyRef.current === recKey) {
              setSelectedStudentNote(signal.noteRecord);
              setIsLoadingDetail(false);
            }
            setStudentSubmissions((prev) => {
              const filtered = prev.filter(p => !(
                p.student_grade === student.grade &&
                p.student_class === student.classNum &&
                p.student_num === student.studentNum
              ));
              return [signal.noteRecord!, ...filtered];
            });
            showToast(`⚡ ${student.name} 학생 최신 필기 실시간 동기화 완료!`);
          }

          // 2) 웹소켓 페이로드 256KB 한계로 noteRecord가 생략된 경우를 대비해 DB 즉각 보충 조회
          if (supabase && isSupabaseConfigured) {
            supabase
              .from('class_notes')
              .select('*')
              .eq('lesson_id', currentLessonId)
              .eq('student_grade', student.grade)
              .eq('student_class', student.classNum)
              .eq('student_num', student.studentNum)
              .order('updated_at', { ascending: false })
              .maybeSingle()
              .then(({ data }) => {
                if (data) {
                  if (selectedStudentKeyRef.current === recKey) {
                    setSelectedStudentNote(data);
                    setIsLoadingDetail(false);
                  }
                  setStudentSubmissions(prev => [data, ...prev.filter(p => !(p.student_grade === student.grade && p.student_class === student.classNum && p.student_num === student.studentNum))]);
                  showToast(`⚡ ${student.name} 학생 최신 필기 실시간 동기화 완료!`);
                }
              });
          }
        }
      }
    });

    return () => {
      unsubscribe();
      classroomRealtime.leaveLesson();
    };
  }, [currentLessonId]);

  // 4. 통합 학생 목록 생성 (접속자 + 제출자 병합 후 [학번순] 정렬)
  const sortedStudentRoster = useMemo(() => {
    const studentMap = new Map<string, {
      key: string;
      grade: string;
      classNum: string;
      studentNum: string;
      name: string;
      status: 'connected' | 'checking' | 'disconnected';
      isAway?: boolean;
      currentPage?: number;
      totalPages?: number;
      appVersion?: string;
      submission?: ClassNoteRecord;
    }>();

    // 1) 제출 기록이 있는 학생 추가 (교사 세션 row 원천 제외)
    for (const sub of studentSubmissions) {
      if (sub.student_grade === '_TEACHER_SESSION_' || sub.student_grade?.startsWith('_TEACHER')) continue;
      const key = `${sub.student_grade}_${sub.student_class}_${sub.student_num}`;
      studentMap.set(key, {
        key,
        grade: sub.student_grade,
        classNum: sub.student_class,
        studentNum: sub.student_num,
        name: sub.student_name,
        status: 'disconnected',
        isAway: false,
        submission: sub
      });
    }

    // 2) 실시간 핑 접속자 상태 병합 (교사 세션 row 원천 제외)
    for (const [key, hb] of studentHeartbeats.entries()) {
      if (hb.grade === '_TEACHER_SESSION_' || hb.grade?.startsWith('_TEACHER')) continue;
      const existing = studentMap.get(key);
      if (existing) {
        existing.status = hb.status;
        existing.name = hb.name;
        existing.isAway = hb.isAway;
        existing.currentPage = hb.currentPage;
        existing.totalPages = hb.totalPages;
        existing.appVersion = hb.appVersion;
      } else {
        studentMap.set(key, {
          key,
          grade: hb.grade,
          classNum: hb.classNum,
          studentNum: hb.studentNum,
          name: hb.name,
          status: hb.status,
          isAway: hb.isAway,
          currentPage: hb.currentPage,
          totalPages: hb.totalPages,
          appVersion: hb.appVersion
        });
      }
    }

    // 3) 학번순 정렬
    const list = Array.from(studentMap.values());
    const parseNum = (val?: string) => {
      if (!val) return 999;
      const m = String(val).match(/\d+/);
      return m ? parseInt(m[0], 10) : 999;
    };

    list.sort((a, b) => {
      const gradeA = parseNum(a.grade);
      const gradeB = parseNum(b.grade);
      if (gradeA !== gradeB) return gradeA - gradeB;

      const classA = parseNum(a.classNum);
      const classB = parseNum(b.classNum);
      if (classA !== classB) return classA - classB;

      const numA = parseNum(a.studentNum);
      const numB = parseNum(b.studentNum);
      if (numA !== numB) return numA - numB;

      return a.name.localeCompare(b.name, 'ko-KR');
    });

    return list;
  }, [studentSubmissions, studentHeartbeats]);

  // 실시간 출석 카운트
  const activeCount = sortedStudentRoster.filter(s => s.status === 'connected' || s.status === 'checking').length;

  // 실시간 다른 화면(앱 이탈/딴짓) 보고 있는 학생 목록
  const awayStudents = useMemo(() => {
    return sortedStudentRoster.filter(s =>
      (s.status === 'connected' || s.status === 'checking') && s.isAway
    );
  }, [sortedStudentRoster]);

  // 구버전 앱을 실행 중인 학생 목록 (원격 자동 새로고침 대상)
  const outdatedStudents = useMemo(() => {
    return sortedStudentRoster.filter(s =>
      (s.status === 'connected' || s.status === 'checking') &&
      (!s.appVersion || s.appVersion !== boardVersion)
    );
  }, [sortedStudentRoster, boardVersion]);

  // 구버전 학생 전체 원격 새로고침 신호 전파
  const handleReloadOutdatedStudents = async () => {
    if (outdatedStudents.length === 0) {
      showToast('✅ 모든 학생이 최신 버전 앱을 실행 중입니다.');
      return;
    }
    const ok = window.confirm(`구버전 앱을 실행 중인 학생 ${outdatedStudents.length}명의 화면을 원격으로 새로고침하시겠습니까?\n(작성 중이던 필기는 기기에 안전하게 보존됩니다.)`);
    if (!ok) return;

    for (const student of outdatedStudents) {
      await classroomRealtime.sendForceReload(currentLessonId, student.key);
    }
    showToast(`🚀 ${outdatedStudents.length}명의 학생 화면에 원격 새로고침 신호를 전송했습니다.`);
  };

  // 실시간 미접속 학생 목록 (오늘 접속했던 학생 중 잠금/절전/퇴장으로 끊긴 학생만 추적)
  const disconnectedStudents = useMemo(() => {
    return sortedStudentRoster.filter(s => 
      studentHeartbeats.has(s.key) && s.status === 'disconnected'
    );
  }, [sortedStudentRoster, studentHeartbeats]);

  // ==========================================================================
  // [미니 플로팅 모니터 (Document PiP 및 Always-On-Top 팝업)]
  // ==========================================================================
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);

  // 컴포넌트 언마운트 시 열려있는 PiP 창 닫기
  useEffect(() => {
    return () => {
      if (pipWindow && !pipWindow.closed) {
        pipWindow.close();
      }
    };
  }, [pipWindow]);

  const toggleMiniMonitor = useCallback(async () => {
    if (pipWindow && !pipWindow.closed) {
      pipWindow.close();
      setPipWindow(null);
      setPipContainer(null);
      return;
    }

    const PIP_WIDTH = 320;
    const PIP_HEIGHT = 40;

    // 1) 최신 크롬/엣지 Document Picture-in-Picture 지원 시 (OS 레벨 Always-on-Top 고정)
    if (typeof window !== 'undefined' && 'documentPictureInPicture' in window && (window as any).documentPictureInPicture?.requestWindow) {
      try {
        const newPipWindow = await (window as any).documentPictureInPicture.requestWindow({
          width: PIP_WIDTH,
          height: PIP_HEIGHT,
        });

        newPipWindow.addEventListener('pagehide', () => {
          setPipWindow(null);
          setPipContainer(null);
        });

        const style = newPipWindow.document.createElement('style');
        style.textContent = `
          * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          body { background: #0f172a; color: #f8fafc; overflow: hidden; height: 100vh; width: 100vw; user-select: none; }
        `;
        newPipWindow.document.head.appendChild(style);

        const container = newPipWindow.document.createElement('div');
        container.id = 'mini-monitor-root';
        container.style.width = '100%';
        container.style.height = '100%';
        newPipWindow.document.body.appendChild(container);

        setPipWindow(newPipWindow);
        setPipContainer(container);
        showToast('🖥️ 플로팅 미니 모니터가 켜졌습니다. (모든 앱 위에 고정)');
        return;
      } catch (err) {
        console.warn('[PiP] Document PiP failed, fallback to window.open', err);
      }
    }

    // 2) Document PiP 미지원 구형 브라우저 fallback: window.open 팝업
    const screenW = typeof window !== 'undefined' ? window.screen.availWidth : 1920;
    const left = screenW - PIP_WIDTH - 20;
    const top = 60;
    const popup = window.open(
      '',
      'LBW_MiniClassMonitor',
      `width=${PIP_WIDTH},height=${PIP_HEIGHT},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes`
    );

    if (popup) {
      popup.document.title = '실시간 출석 & 화면 모니터링';
      const style = popup.document.createElement('style');
      style.textContent = `
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        body { background: #0f172a; color: #f8fafc; overflow: hidden; height: 100vh; width: 100vw; user-select: none; }
      `;
      popup.document.head.appendChild(style);

      const container = popup.document.createElement('div');
      container.id = 'mini-monitor-root';
      container.style.width = '100%';
      container.style.height = '100%';
      popup.document.body.appendChild(container);

      popup.addEventListener('beforeunload', () => {
        setPipWindow(null);
        setPipContainer(null);
      });

      setPipWindow(popup);
      setPipContainer(container);
      showToast('🖥️ 미니 모니터 팝업창이 열렸습니다.');
    } else {
      showToast('⚠️ 팝업창 열기가 차단되었습니다. 브라우저 팝업 허용을 켜주세요.');
    }
  }, [pipWindow, showToast]);

  // 5. 학생 타일 클릭 시 온디맨드 필기 상세 열람
  const handleSelectStudent = async (studentItem: typeof sortedStudentRoster[0]) => {
    setIsLoadingDetail(true);
    const targetPage = (studentItem.currentPage && studentItem.currentPage > 0)
      ? studentItem.currentPage - 1
      : 0;
    setSelectedStudentPageIdx(targetPage);
    selectedStudentKeyRef.current = studentItem.key;

    // 학생이 열람 중인 전체 쪽수(totalPages)에 맞춰 기본 페이지 배열 구성
    const totalP = Math.max(studentItem.totalPages || 1, targetPage + 1);
    const placeholderPages = Array.from({ length: totalP }).map(() => ({
      strokes: [],
      textItems: [],
      images: []
    }));

    // 만약 이미 메모리에 strokes_data가 있는 경우 우선 표시
    if (studentItem.submission?.strokes_data?.pages || studentItem.submission?.strokes_data?.strokes) {
      setSelectedStudentNote(studentItem.submission);
      setIsLoadingDetail(false);
    } else {
      // 학생이 열람 중인 쪽수(예: 4쪽)를 온전히 반영한 기본 placeholder 생성
      setSelectedStudentNote({
        lesson_id: currentLessonId,
        student_grade: studentItem.grade,
        student_class: studentItem.classNum,
        student_num: studentItem.studentNum,
        student_name: studentItem.name,
        strokes_data: { pages: placeholderPages }
      });
    }

    // 학생이 실시간 연결(online) 상태인 경우 원격 온디맨드 동기화 요청 신호 전송
    if (studentItem.status === 'connected') {
      await classroomRealtime.sendSignal({
        type: 'REQUEST_STUDENT_NOTE',
        lessonId: currentLessonId,
        targetStudentKey: studentItem.key
      });
    }

    // 학생 기기가 최신 필기를 클라우드에 업서트할 수 있도록 0.35초 대기 후 DB 조회
    setTimeout(async () => {
      if (supabase && isSupabaseConfigured) {
        try {
          const { data, error } = await supabase
            .from('class_notes')
            .select('*')
            .eq('lesson_id', currentLessonId)
            .eq('student_grade', studentItem.grade)
            .eq('student_class', studentItem.classNum)
            .eq('student_num', studentItem.studentNum)
            .order('updated_at', { ascending: false })
            .maybeSingle();

          if (!error && data) {
            setSelectedStudentNote(data);
            setStudentSubmissions((prev) => {
              const filtered = prev.filter(p => !(
                p.student_grade === data.student_grade &&
                p.student_class === data.student_class &&
                p.student_num === data.student_num
              ));
              return [data, ...filtered];
            });
          }
        } catch (err) {
          console.warn('학생 상세 필기 조회 오류:', err);
        } finally {
          setIsLoadingDetail(false);
        }
      } else {
        setIsLoadingDetail(false);
      }
    }, 350);
  };

  // [잘못 접속된 학생 삭제 및 연결 해제]
  const handleDisconnectStudent = async (studentItem: typeof sortedStudentRoster[0]) => {
    const studentLabel = `${studentItem.grade}-${studentItem.classNum} ${studentItem.studentNum}번 ${studentItem.name}`;
    const confirmed = window.confirm(`'${studentLabel}' 학생의 연결을 해제하고 칠판 목록에서 삭제하시겠습니까?\n\n(해당 학생 태블릿의 필기는 안전하게 보존되며, 칠판 연결만 종료됩니다.)`);
    if (!confirmed) return;

    try {
      const studentKey = studentItem.key;

      // 0. 강제 삭제 학생 차단 목록에 등록 (이후 날아오는 생존 핑 100% 원천 무시)
      kickedStudentKeysRef.current.add(studentKey);

      // 1. 만약 현재 이 학생의 필기를 전체화면으로 열람 중이었다면 닫기
      if (selectedStudentKeyRef.current === studentKey) {
        setSelectedStudentNote(null);
        selectedStudentKeyRef.current = null;
      }

      // 2. 실시간 출석 목록(Presence) 및 실시간 핑 목록(Heartbeats)에서 즉시 완전 제거
      setStudentPresences((prev) => {
        const next = new Map(prev);
        next.delete(studentKey);
        return next;
      });
      setStudentHeartbeats((prev) => {
        const next = new Map(prev);
        next.delete(studentKey);
        return next;
      });

      // 3. 메모리 내 제출 목록(Submissions)에서 즉시 제거
      setStudentSubmissions((prev) =>
        prev.filter(
          (sub) =>
            !(
              sub.student_grade === studentItem.grade &&
              sub.student_class === studentItem.classNum &&
              sub.student_num === studentItem.studentNum
            )
        )
      );

      // 4. 클라우드 DB(Supabase)에 제출된 기록이 있다면 삭제
      if (supabase && isSupabaseConfigured) {
        try {
          await supabase
            .from('class_notes')
            .delete()
            .eq('lesson_id', currentLessonId)
            .eq('student_grade', studentItem.grade)
            .eq('student_class', studentItem.classNum)
            .eq('student_num', studentItem.studentNum);
        } catch (dbErr) {
          console.warn('DB 제출 기록 삭제 오류:', dbErr);
        }
      }

      // 5. 해당 학생 태블릿으로 원격 연결 해제(KICK_STUDENT) 신호 전파
      await classroomRealtime.sendSignal({
        type: 'KICK_STUDENT',
        lessonId: currentLessonId,
        targetStudentKey: studentKey,
        student: {
          grade: studentItem.grade,
          classNum: studentItem.classNum,
          studentNum: studentItem.studentNum,
          name: studentItem.name
        }
      });

      showToast(`🗑️ '${studentLabel}' 학생의 연결을 해제하고 칠판에서 삭제했습니다.`);
    } catch (e) {
      console.error('학생 연결 해제 오류:', e);
      showToast('❌ 학생 연결 해제 중 오류가 발생했습니다.');
    }
  };

  // 6. 전체 학생 필기 모음집 학번순 PDF 생성 및 구글 드라이브 업로드
  const handleCompileAndSavePdf = async () => {
    if (sortedStudentRoster.length === 0) {
      showToast('⚠️ 모음집으로 저장할 학생이 없습니다.');
      return;
    }

    setIsGeneratingPdf(true);
    setPdfProgress({ current: 0, total: sortedStudentRoster.length, name: '학생 전체 동기화 신호 전송 중...' });

    try {
      // 1) 전체 학생 태블릿에 최신 필기 일괄 동기화 신호 브로드캐스트 (병렬 1.5초)
      await classroomRealtime.sendSignal({
        type: 'REQUEST_ALL_SYNC',
        lessonId: currentLessonId
      });

      // 학생 장치들이 백그라운드 압축 및 저장을 마칠 수 있도록 1.5초 대기
      await new Promise(res => setTimeout(res, 1500));

      // 2) 최신 필기 데이터 일괄 보충 조회
      let notesToCompile: ClassNoteRecord[] = [];
      if (supabase && isSupabaseConfigured) {
        const { data: fullNotes } = await supabase
          .from('class_notes')
          .select('*')
          .eq('lesson_id', currentLessonId);

        if (fullNotes && fullNotes.length > 0) {
          notesToCompile = fullNotes;
        }
      }

      if (notesToCompile.length === 0) {
        // DB 조회가 비어있으면 현재 로컬 캐시 사용
        notesToCompile = sortedStudentRoster
          .map(s => s.submission)
          .filter(Boolean) as ClassNoteRecord[];
      }

      if (notesToCompile.length === 0) {
        showToast('⚠️ 제출된 필기 데이터가 없습니다.');
        setIsGeneratingPdf(false);
        setPdfProgress(null);
        return;
      }

      // 3) 학번순 고화질 통합 PDF 생성
      const result = await generateClassSubmissionPdf({
        lessonTitle: cleanLessonTitle,
        notes: notesToCompile,
        onProgress: (current, total, name) => {
          setPdfProgress({ current, total, name });
        }
      });

      // 4) 내 컴퓨터 즉시 다운로드 백업
      const url = URL.createObjectURL(result.pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 500);

      // 5) 구글 드라이브 해당 수업 폴더로 1회 업로드
      showToast(`☁️ 구글 드라이브에 '${result.fileName}' 업로드 중...`);
      await executeDriveAction({
        action: 'upload',
        folderId: currentLessonId,
        name: result.fileName,
        mimeType: 'application/pdf',
        base64: result.pdfBase64
      });

      showToast(`🎉 '${result.fileName}' (${result.totalStudents}명) 학번순 PDF가 드라이브에 저장되었습니다!`);
    } catch (err: any) {
      console.error('PDF 생성 및 업로드 실패:', err);
      showToast(`❌ PDF 생성 실패: ${err.message || '오류 발생'}`);
    } finally {
      setIsGeneratingPdf(false);
      setPdfProgress(null);
    }
  };

  return (
    <div
      id="live-classroom-dashboard"
      onPointerDown={handleUserInteraction}
      onTouchStart={handleUserInteraction}
      onClick={handleUserInteraction}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#0d1117',
        color: '#f0f6fc',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '"Pretendard", "Apple SD Gothic Neo", sans-serif',
        userSelect: 'none'
      }}
    >
      {/* 1. 상단 글로벌 네비게이션 헤더 */}
      <header
        style={{
          height: '64px',
          background: '#161b22',
          borderBottom: '1px solid #30363d',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              boxShadow: '0 2px 8px rgba(37, 99, 235, 0.4)'
            }}
          >
            🏫
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 
                style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: '#ffffff' }}
                title="전자칠판 실시간 관제 및 학생 필기 모니터링"
              >
                {cleanLessonTitle}
              </h1>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: 'rgba(37, 99, 235, 0.2)',
                  color: '#93c5fd',
                  border: '1px solid rgba(59, 130, 246, 0.4)'
                }}
              >
                대화형 라이브 수업 세션
              </span>
            </div>
          </div>
        </div>

        {/* 우측 글로벌 툴바: 아이콘 중심 초슬림 미니멀 버튼 (설명은 풍부한 툴팁으로 제공) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* 출석 카운터 (숫자는 필수 정보이므로 컴팩트 칩으로 표시) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: '#21262d',
              padding: '6px 12px',
              borderRadius: '20px',
              border: '1px solid #30363d',
              fontSize: '12px'
            }}
            title="현재 참여 중인 학생 수 / 전체 등록된 학생 수"
          >
            <span style={{ color: '#3fb950', fontWeight: 800 }}>● {activeCount}</span>
            <span style={{ color: '#8b949e' }}>/{sortedStudentRoster.length}</span>
          </div>

          {/* 수업 타이머 & 10분 연장 칩 (남은 분수는 필수 정보) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                background: '#21262d',
                padding: '6px 10px',
                borderRadius: '20px',
                border: '1px solid #30363d',
                fontSize: '12px',
                color: remainingMinutes <= 5 ? '#f87171' : '#cbd5e1'
              }}
              title="설정된 수업 시간이 경과하면 수업이 안전하게 자동 종료됩니다"
            >
              <span>⏱️</span>
              <span style={{ fontWeight: 700 }}>{remainingMinutes}m</span>
            </div>

            <button
              type="button"
              onClick={handleExtendSession}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'rgba(59, 130, 246, 0.15)',
                border: '1px solid rgba(59, 130, 246, 0.4)',
                color: '#93c5fd',
                fontSize: '15px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0
              }}
              title="수업 시간을 10분 연장합니다"
            >
              ➕
            </button>
          </div>

          {outdatedStudents.length > 0 && (
            <button
              type="button"
              onClick={handleReloadOutdatedStudents}
              style={{
                height: '36px',
                padding: '0 8px',
                borderRadius: '10px',
                background: 'rgba(234, 179, 8, 0.2)',
                border: '1px solid #eab308',
                color: '#fde047',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
              title={`구버전 앱 학생 ${outdatedStudents.length}명 감지. 클릭 시 최신 버전으로 원격 자동 새로고침합니다.`}
            >
              <span>🚀</span>
              <span style={{ fontSize: '11px', background: '#ca8a04', color: '#fff', padding: '1px 5px', borderRadius: '6px' }}>
                {outdatedStudents.length}
              </span>
            </button>
          )}

          <div style={{ width: '1px', height: '20px', background: 'rgba(255, 255, 255, 0.12)', margin: '0 2px' }} />

          {/* 1. 미니 모니터 토글 아이콘 버튼 */}
          <button
            type="button"
            onClick={toggleMiniMonitor}
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: pipWindow
                ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.3) 0%, rgba(22, 163, 74, 0.45) 100%)'
                : '#21262d',
              border: pipWindow ? '1.5px solid #22c55e' : '1px solid #30363d',
              color: pipWindow ? '#4ade80' : '#c9d1d9',
              fontSize: '16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative'
            }}
            title={pipWindow ? '미니 플로팅 모니터 닫기' : '미니 플로팅 모니터 켜기 (다른 앱 위 항상 표시)'}
          >
            🖥️
            {awayStudents.length > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '-3px',
                  right: '-3px',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#ef4444',
                  boxShadow: '0 0 6px #ef4444'
                }}
              />
            )}
          </button>

          {/* 2. 수업자료 다운로드 아이콘 버튼 (첨부 개수 칩 포함) */}
          <button
            type="button"
            style={{
              height: '38px',
              padding: lessonMaterials.length > 0 ? '0 10px' : '0',
              width: lessonMaterials.length > 0 ? 'auto' : '38px',
              borderRadius: '10px',
              background: 'rgba(56, 189, 248, 0.15)',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              color: '#38bdf8',
              fontSize: '16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px'
            }}
            onClick={() => {
              setIsMaterialModalOpen(true);
              fetchRegisteredLessonMaterials();
            }}
            title="본 수업에 등록된 학습자료(PDF, 활동지 등)를 전자칠판에 다운로드합니다"
          >
            <span>📥</span>
            {lessonMaterials.length > 0 && (
              <span style={{ fontSize: '11px', background: '#0284c7', color: '#ffffff', padding: '1px 6px', borderRadius: '8px', fontWeight: 800 }}>
                {lessonMaterials.length}
              </span>
            )}
          </button>

          {/* 3. 학생 필기 일괄 PDF 저장 아이콘 버튼 */}
          <button
            type="button"
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.25) 0%, rgba(29, 78, 216, 0.35) 100%)',
              border: '1px solid #3b82f6',
              color: '#93c5fd',
              fontSize: '16px',
              cursor: isGeneratingPdf ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            disabled={isGeneratingPdf}
            onClick={handleCompileAndSavePdf}
            title="모든 학생의 필기를 학번순 단일 PDF 파일로 일괄 저장합니다"
          >
            {isGeneratingPdf ? '⏳' : '📑'}
          </button>

          {/* 4. 수업 초기화 아이콘 버튼 */}
          <button
            type="button"
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              color: '#fca5a5',
              fontSize: '16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onClick={handleResetSession}
            title="현재 수업의 모든 학생 등록 및 필기 기록을 초기화합니다"
          >
            🔄
          </button>

          {/* 5. 학생 접속 주소 복사 아이콘 버튼 */}
          <button
            type="button"
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: '#21262d',
              border: '1px solid #30363d',
              color: '#c9d1d9',
              fontSize: '16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onClick={() => {
              if (studentUrl) {
                navigator.clipboard.writeText(studentUrl);
                showToast('✅ 학생 접속 URL이 복사되었습니다.');
              }
            }}
            title="학생 접속 URL 주소를 클립보드에 복사합니다"
          >
            🔗
          </button>

          {/* 6. 수업 나가기 아이콘 버튼 */}
          <button
            type="button"
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid #30363d',
              color: '#94a3b8',
              fontSize: '16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onClick={onExit}
            title="라이브 수업 화면을 종료하고 스마트 드라이브 포털로 나갑니다"
          >
            ✕
          </button>
        </div>
      </header>

      {/* 2. PDF 생성 진행 바 */}
      {isGeneratingPdf && pdfProgress && (
        <div
          style={{
            background: 'rgba(37, 99, 235, 0.15)',
            borderBottom: '1px solid #3b82f6',
            padding: '10px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '13px',
            color: '#93c5fd'
          }}
        >
          <span>🔄 <strong>{pdfProgress.name}</strong> 학생 필기 고해상도 합성 및 PDF 병합 중...</span>
          <span style={{ fontWeight: 700 }}>{pdfProgress.current} / {pdfProgress.total}</span>
        </div>
      )}

      {/* 3. 대시보드 본문 (전체 화면 학생 타일 그리드 전면 렌더링) */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 전체 학생 타일 배치 그리드 */}
        <main
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            padding: '16px 24px',
            overflow: viewMode === 'auto' ? 'hidden' : 'auto',
            height: '100%',
            boxSizing: 'border-box'
          }}
        >
              {/* 타이틀 및 정렬 안내 바 */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '12px',
                  flexWrap: 'wrap',
                  gap: '12px',
                  flexShrink: 0
                }}
              >
                <div>
                  <h2 
                    style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: '#ffffff' }}
                    title="학번순 자동 정렬 • 타일을 터치하면 학생 필기를 전체화면으로 열람합니다."
                  >
                    👥 실시간 출석 및 필기 모니터링
                  </h2>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {/* 보기 모드: 25명 자동배치 vs 큰 타일(스크롤) 토글 */}
                  <div
                    style={{
                      display: 'flex',
                      background: '#21262d',
                      padding: '2px',
                      borderRadius: '8px',
                      border: '1px solid #30363d'
                    }}
                    title="전자칠판 학생 타일 배치 모드 선택"
                  >
                    <button
                      type="button"
                      style={{
                        background: viewMode === 'auto' ? '#388bfd' : 'transparent',
                        color: viewMode === 'auto' ? '#ffffff' : '#8b949e',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                      onClick={() => setViewMode('auto')}
                      title="25명 전체 학생을 스크롤 없이 한 화면에 자동 배치"
                    >
                      📱 25명 자동배치 (한 화면)
                    </button>
                    <button
                      type="button"
                      style={{
                        background: viewMode === 'scroll' ? '#388bfd' : 'transparent',
                        color: viewMode === 'scroll' ? '#ffffff' : '#8b949e',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                      onClick={() => setViewMode('scroll')}
                      title="타일을 크게 보고 스크롤"
                    >
                      🔍 큰 타일 (스크롤)
                    </button>
                  </div>

                  <button
                    type="button"
                    style={{
                      background: '#21262d',
                      border: '1px solid #30363d',
                      color: '#c9d1d9',
                      borderRadius: '6px',
                      padding: '5px 12px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                    onClick={fetchSubmissionsFromDb}
                  >
                    <span>🔄</span> 새로고침
                  </button>
                </div>
              </div>

              {/* 30인 고정 타일 그리드 (화면 울렁임 0% 보장, 30명 초과 시 아래로 스크롤) */}
              <div
                style={{
                  flex: 1,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                  gap: '10px',
                  overflowY: 'auto',
                  paddingRight: '4px',
                  alignContent: 'start'
                }}
              >
                {Array.from({ length: Math.max(30, sortedStudentRoster.length) }).map((_, seatIdx) => {
                  const studentItem = sortedStudentRoster[seatIdx];

                  // [A] 빈 자리 슬롯 (화면 울렁임 방지용 고정 자리)
                  if (!studentItem) {
                    return (
                      <div
                        key={`seat-empty-${seatIdx}`}
                        style={{
                          height: '92px',
                          background: 'rgba(22, 27, 34, 0.4)',
                          border: '1.5px dashed rgba(48, 54, 61, 0.7)',
                          borderRadius: '10px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          color: '#484f58',
                          userSelect: 'none'
                        }}
                      >
                        <span style={{ fontSize: '16px', opacity: 0.5 }}>🪑</span>
                        <span style={{ fontSize: '11px', fontWeight: 600 }}>자리 {seatIdx + 1}</span>
                      </div>
                    );
                  }

                  // [B] 접속한 학생 자리 카드
                  const isOnline = studentItem.status === 'connected';
                  const isChecking = studentItem.status === 'checking';
                  const hasNote = Boolean(studentItem.submission);
                  const hasEverConnectedToday = studentHeartbeats.has(studentItem.key);

                  let badgeBg = '#30363d';
                  let badgeLabel = hasEverConnectedToday ? '🔴 연결 끊김' : (hasNote ? '제출 완료' : '미접속');
                  let borderColor = '#30363d';
                  let cardBg = '#161b22';

                  if (isOnline) {
                    if (studentItem.isAway) {
                      badgeBg = '#dc2626';
                      badgeLabel = '🚨 다른 화면';
                      borderColor = '#ef4444';
                      cardBg = 'rgba(239, 68, 68, 0.16)';
                    } else {
                      badgeBg = '#238636';
                      badgeLabel = '🟢 연결됨';
                      borderColor = '#388bfd';
                      cardBg = 'rgba(56, 139, 253, 0.12)';
                    }
                  } else if (isChecking) {
                    badgeBg = '#d29922';
                    badgeLabel = '🟡 확인 중';
                    borderColor = '#d29922';
                    cardBg = 'rgba(210, 153, 34, 0.12)';
                  } else if (hasEverConnectedToday) {
                    badgeBg = 'rgba(239, 68, 68, 0.3)';
                    badgeLabel = '🔴 연결 끊김';
                    borderColor = 'rgba(239, 68, 68, 0.6)';
                  } else if (hasNote) {
                    badgeBg = '#1f6feb';
                    badgeLabel = '제출 완료';
                  }

                  return (
                    <div
                      key={studentItem.key}
                      onClick={() => handleSelectStudent(studentItem)}
                      style={{
                        height: '92px',
                        background: cardBg,
                        border: `1.5px solid ${borderColor}`,
                        borderRadius: '10px',
                        padding: '8px 10px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        position: 'relative',
                        boxShadow: isOnline ? '0 4px 14px rgba(56, 139, 253, 0.2)' : 'none',
                        boxSizing: 'border-box'
                      }}
                      title={`${studentItem.grade}학년 ${studentItem.classNum}반 ${studentItem.studentNum}번 ${studentItem.name} (클릭하여 필기 보기)`}
                    >
                      {/* 학생 접속 상태 뱃지 & 연결 해제 버튼 */}
                      <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                          <span
                            style={{
                              fontSize: '9.5px',
                              fontWeight: 700,
                              padding: '1px 6px',
                              borderRadius: '10px',
                              background: badgeBg,
                              color: '#ffffff'
                            }}
                          >
                            {badgeLabel}
                          </span>
                          {isOnline && (!studentItem.appVersion || studentItem.appVersion !== boardVersion) && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                classroomRealtime.sendForceReload(currentLessonId, studentItem.key);
                                showToast(`🚀 ${studentItem.name} 학생 기기에 원격 새로고침 신호를 보냈습니다.`);
                              }}
                              style={{
                                background: 'rgba(234, 179, 8, 0.25)',
                                border: '1px solid #eab308',
                                color: '#fde047',
                                fontSize: '8.5px',
                                fontWeight: 800,
                                padding: '1px 4px',
                                borderRadius: '6px',
                                cursor: 'pointer'
                              }}
                              title={`구버전 앱 실행 중 (v${studentItem.appVersion || '미확인'}). 클릭하면 최신 버전으로 원격 새로고침합니다.`}
                            >
                              ⚠️ 구버전 ↺
                            </button>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDisconnectStudent(studentItem);
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#484f58',
                            fontSize: '11px',
                            cursor: 'pointer',
                            padding: '0 2px'
                          }}
                          title="학생 연결 끊기"
                        >
                          ✕
                        </button>
                      </div>

                      {/* 학번 및 이름 */}
                      <div style={{ textAlign: 'center', width: '100%', overflow: 'hidden' }}>
                        <div style={{ fontSize: '11px', color: '#8b949e', fontWeight: 600 }}>
                          {studentItem.grade}-{studentItem.classNum} {studentItem.studentNum}번
                        </div>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: '#f0f6fc', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                          {studentItem.name}
                        </div>
                      </div>

                      {/* 필기 작성/제출 여부 및 실시간 열람 중인 쪽수 */}
                      <div style={{ fontSize: '10.5px', color: isOnline ? '#38bdf8' : hasNote ? '#58a6ff' : '#8b949e', fontWeight: isOnline ? 700 : 500 }}>
                        {isOnline && studentItem.currentPage
                          ? `📖 ${studentItem.currentPage}${studentItem.totalPages ? `/${studentItem.totalPages}` : ''}쪽 열람 중`
                          : hasNote ? '📝 필기 있음' : '작성 중...'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </main>
      </div>

      {/* 4. 전자칠판 전체화면 학생 필기 뷰어 (나가기 버튼 + 쪽 이동 + 확대축소/팬) */}
      {selectedStudentNote && (
        <StudentNoteFullscreenViewer
          noteRecord={selectedStudentNote}
          initialPageIdx={selectedStudentPageIdx}
          isLoading={isLoadingDetail}
          onClose={() => {
            setSelectedStudentNote(null);
            selectedStudentKeyRef.current = null;
          }}
          onSendFeedback={(studentName) => {
            showToast(`🌟 ${studentName} 학생에게 '참 잘했어요!' 피드백을 전달했습니다.`);
          }}
        />
      )}

      {/* 5. 전자칠판 수업자료 다운로드 센터 모달 (구글 드라이브 통합) */}
      {isMaterialModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setIsMaterialModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.78)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10001
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#161b22',
              border: '1.5px solid #30363d',
              borderRadius: '20px',
              padding: '24px 28px',
              width: '94%',
              maxWidth: '680px',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 24px 48px rgba(0, 0, 0, 0.85)'
            }}
          >
            {/* 1. 모달 헤더 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '26px' }}>📥</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#ffffff' }}>
                    수업자료 다운로드 센터
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                    구글 드라이브에 등록된 학습자료를 전자칠판 기기로 즉시 다운로드합니다.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMaterialModalOpen(false)}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: 'none',
                  color: '#94a3b8',
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  fontSize: '16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ✕
              </button>
            </div>

            {/* 2. 자료 검색창 & 새로고침 버튼 */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
              <input
                type="text"
                className="g-form-input"
                placeholder="🔍 파일명 검색 (예: 삼각비, 형성평가, 1단원...)"
                value={materialSearchTerm}
                onChange={(e) => setMaterialSearchTerm(e.target.value)}
                style={{ flex: 1, padding: '10px 14px', fontSize: '13.5px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '10px' }}
                autoFocus
              />
              <button
                type="button"
                onClick={fetchRegisteredLessonMaterials}
                disabled={isLoadingMaterials}
                style={{
                  background: '#21262d',
                  border: '1px solid #30363d',
                  color: '#c9d1d9',
                  borderRadius: '10px',
                  padding: '0 16px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                title="수업자료 목록 새로고침"
              >
                {isLoadingMaterials ? '🔄 확인 중...' : '🔄 새로고침'}
              </button>
            </div>

            {/* 3. 파일 목록 컨테이너 (본 수업 공식 등록 자료만 표시) */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
              {(() => {
                // 본 수업에 공식 등록된 자료 목록 필터링
                const filtered = lessonMaterials.filter(f =>
                  f.name.toLowerCase().includes(materialSearchTerm.trim().toLowerCase())
                );

                if (isLoadingMaterials && filtered.length === 0) {
                  return (
                    <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                      <span style={{ fontSize: '28px', display: 'block', marginBottom: '8px' }}>🔄</span>
                      등록된 수업자료를 확인하는 중입니다...
                    </div>
                  );
                }

                if (filtered.length === 0) {
                  return (
                    <div style={{ padding: '36px 16px', textAlign: 'center', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '12px', border: '1px dashed #30363d' }}>
                      <span style={{ fontSize: '32px', display: 'block', marginBottom: '8px' }}>📂</span>
                      <p style={{ margin: '0 0 6px', fontSize: '15px', fontWeight: 700, color: '#ffffff' }}>
                        {materialSearchTerm ? `'${materialSearchTerm}' 검색 결과가 없습니다.` : '본 수업에 등록된 수업자료가 없습니다.'}
                      </p>
                      <p style={{ margin: 0, fontSize: '12.5px', color: '#8b949e', lineHeight: 1.6 }}>
                        {materialSearchTerm
                          ? '검색어를 변경하여 다시 시도해 주세요.'
                          : '선생님 드라이브 포털의 [✏️ 자료 수정] 메뉴에서 수업에 사용할 교재나 학습지(PDF/문서)를 등록해 주세요.'}
                      </p>
                    </div>
                  );
                }

                return filtered.map((file) => {
                  const isPdf = file.mimeType?.includes('pdf') || file.name.toLowerCase().endsWith('.pdf');
                  const isImage = file.mimeType?.includes('image') || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
                  const isDoc = file.mimeType?.includes('word') || file.mimeType?.includes('document') || /\.(hwp|hwpx|docx?|pptx?)$/i.test(file.name);
                  const icon = isPdf ? '📄' : isImage ? '🖼️' : isDoc ? '📝' : '📁';

                  return (
                    <div
                      key={file.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        borderRadius: '12px',
                        background: 'rgba(56, 189, 248, 0.08)',
                        border: '1px solid rgba(56, 189, 248, 0.35)',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1, paddingRight: '12px' }}>
                        <span style={{ fontSize: '26px', flexShrink: 0 }}>{icon}</span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '14px', fontWeight: 700, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {file.name}
                            </span>
                            <span style={{ fontSize: '10.5px', background: 'rgba(56, 189, 248, 0.25)', color: '#7dd3fc', border: '1px solid rgba(56, 189, 248, 0.45)', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                              📌 {file.sourceTag || '수업 등록 자료'}
                            </span>
                          </div>
                          <div style={{ fontSize: '11.5px', color: '#8b949e', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span>
                              {file.size 
                                ? (typeof file.size === 'string' && file.size.includes('B') 
                                    ? file.size 
                                    : `${(parseInt(file.size, 10) / (1024 * 1024)).toFixed(1)} MB`) 
                                : '구글 드라이브 문서'}
                            </span>
                            {(file.updatedAt || file.modifiedTime) && (
                              <span>• {file.updatedAt || (file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString('ko-KR') : '')}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        {/* 1. 직접 스트리밍 다운로드 (전자칠판 원클릭 파일 수신) */}
                        <a
                          href={`${getApiBaseUrl()}/api/drive?action=download&fileId=${file.id}&fileName=${encodeURIComponent(file.name)}`}
                          download={file.name}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            handleDownloadMaterial(file);
                          }}
                          style={{
                            background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                            border: '1px solid #38bdf8',
                            color: '#ffffff',
                            padding: '9px 18px',
                            borderRadius: '8px',
                            fontSize: '13px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            boxShadow: '0 2px 8px rgba(2, 132, 199, 0.35)',
                            textDecoration: 'none'
                          }}
                          title={`전자칠판 [다운로드] 폴더에 '${file.name}' 저장`}
                        >
                          <span>📥 다운로드</span>
                        </a>

                        {/* 2. 구글 드라이브 뷰어 미리보기 */}
                        <button
                          type="button"
                          onClick={() => {
                            const viewUrl = file.viewUrl || `https://drive.google.com/file/d/${file.id}/view?usp=sharing`;
                            window.open(viewUrl, '_blank', 'noopener,noreferrer');
                          }}
                          style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid #30363d',
                            color: '#c9d1d9',
                            padding: '9px 12px',
                            borderRadius: '8px',
                            fontSize: '12.5px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap'
                          }}
                          title="구글 드라이브 뷰어로 새 창 열기"
                        >
                          👁️ 미리보기
                        </button>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            {/* 4. 모달 하단 푸터 */}
            <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                💡 다운로드된 파일은 전자칠판의 <strong>[다운로드]</strong> 폴더에서 바로 열어 판서에 활용하실 수 있습니다.
              </span>
              <button
                type="button"
                onClick={() => setIsMaterialModalOpen(false)}
                style={{
                  background: '#21262d',
                  border: '1px solid #30363d',
                  color: '#c9d1d9',
                  padding: '8px 18px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          미니 플로팅 모니터 (Document PiP / Always-On-Top 윈도우 포털)
          ==================================================================== */}
      {pipContainer && createPortal(
        <MiniMonitorContent
          lessonTitle={cleanLessonTitle}
          activeCount={activeCount}
          totalCount={sortedStudentRoster.length}
          awayStudents={awayStudents}
          disconnectedStudents={disconnectedStudents}
          onClose={() => {
            if (pipWindow && !pipWindow.closed) {
              pipWindow.close();
            }
            setPipWindow(null);
            setPipContainer(null);
          }}
        />,
        pipContainer
      )}
    </div>
  );
};

// ============================================================================
// [플로팅 미니 모니터 컴포넌트: 접속 인원수 및 다른 화면 보는 학생 실시간 관제]
// ============================================================================
interface MiniMonitorContentProps {
  lessonTitle: string;
  activeCount: number;
  totalCount: number;
  awayStudents: Array<{
    key: string;
    grade: string;
    classNum: string;
    studentNum: string;
    name: string;
  }>;
  disconnectedStudents?: Array<{
    key: string;
    grade: string;
    classNum: string;
    studentNum: string;
    name: string;
  }>;
  onClose: () => void;
}

const MiniMonitorContent: React.FC<MiniMonitorContentProps> = ({
  lessonTitle,
  activeCount,
  totalCount,
  awayStudents,
  disconnectedStudents = [],
  onClose
}) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: '100%',
        width: '100%',
        padding: '0 8px',
        background: '#090d16',
        color: '#f8fafc',
        boxSizing: 'border-box',
        overflow: 'hidden',
        userSelect: 'none',
        gap: '8px'
      }}
    >
      {/* 1. 접속 인원수 아이콘 뱃지 */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          background: 'rgba(30, 41, 59, 0.95)',
          border: '1px solid rgba(56, 189, 248, 0.35)',
          borderRadius: '6px',
          padding: '3px 7px',
          fontSize: '12px',
          fontWeight: 800,
          color: '#4ade80',
          flexShrink: 0
        }}
        title={`[${lessonTitle}] 접속 학생: ${activeCount}명 / 전체 ${totalCount}명`}
      >
        <span style={{ fontSize: '10px' }}>🟢</span>
        <span>{activeCount}</span>
        <span style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 600 }}>/{totalCount}</span>
      </div>

      {/* 2. 구분선 */}
      <div style={{ width: '1px', height: '18px', background: 'rgba(148, 163, 184, 0.25)', flexShrink: 0 }} />

      {/* 3. 이탈 학생 영역 (가로 스크롤 가능) */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          overflowX: 'auto',
          scrollbarWidth: 'none',
          padding: '2px 0'
        }}
      >
        {awayStudents.length === 0 && disconnectedStudents.length === 0 ? (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              color: '#4ade80',
              fontSize: '11px',
              fontWeight: 600,
              whiteSpace: 'nowrap'
            }}
            title="모든 학생이 정상 접속하여 수업 화면을 보고 있습니다"
          >
            <span>✨</span>
            <span>전원 정상</span>
          </div>
        ) : (
          <>
            {/* 이탈 학생 경고 뱃지 */}
            {awayStudents.map(student => (
              <span
                key={`away-${student.key}`}
                style={{
                  background: 'rgba(239, 68, 68, 0.3)',
                  border: '1px solid #ef4444',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#fee2e2',
                  whiteSpace: 'nowrap',
                  flexShrink: 0
                }}
                title={`${student.grade}-${student.classNum} ${student.studentNum}번 ${student.name} (다른 화면 감지)`}
              >
                🚨 ${student.studentNum}번 ${student.name} 이탈
              </span>
            ))}
            {/* 미접속 학생 경고 뱃지 */}
            {disconnectedStudents.map(student => (
              <span
                key={`disc-${student.key}`}
                style={{
                  background: 'rgba(244, 63, 94, 0.2)',
                  border: '1px solid rgba(244, 63, 94, 0.5)',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#fda4af',
                  whiteSpace: 'nowrap',
                  flexShrink: 0
                }}
                title={`${student.grade}-${student.classNum} ${student.studentNum}번 ${student.name} (미접속)`}
              >
                🔴 ${student.studentNum}번 ${student.name} 미접속
              </span>
            ))}
          </>
        )}
      </div>

      {/* 4. 닫기 버튼 */}
      <button
        onClick={onClose}
        type="button"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#94a3b8',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: 800,
          padding: '2px 4px',
          flexShrink: 0
        }}
        title="미니 모니터 닫기"
      >
        ✕
      </button>
    </div>
  );
};
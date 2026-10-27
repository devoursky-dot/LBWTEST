import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import QRCode from 'qrcode';
import { supabase, isSupabaseConfigured, type ClassNoteRecord } from '../lib/supabase';
import { classroomRealtime, type StudentPresenceInfo, type RealtimeSignalPayload } from '../lib/classroomRealtime';
import { getApiBaseUrl } from '../lib/apiConfig';
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
  onOpenFolder,
  executeDriveAction,
  showToast
}) => {
  const currentLessonId = lesson.folderId || lesson.id;
  const cleanLessonTitle = lesson.name.replace('[QR수업]', '').trim();

  // QR 코드 상태
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
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

  // 사이드바 접힘 상태 및 25명 한화면 자동배치 보기 모드 ('auto' | 'scroll')
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
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

    // 3) 구글 드라이브 lesson_config.json에서 공식 등록된 첨부자료 보충 확인
    if (materialsMap.size === 0 && currentLessonId) {
      try {
        const directUrl = `https://www.googleapis.com/drive/v3/files?q='${currentLessonId}'+in+parents+and+name='lesson_config.json'+and+trashed=false&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name)&key=AIzaSyD1qkVW-lVqI0TX7tNptdlDXSbhxvYuONA&_t=${Date.now()}`;
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

  // 1. 학생 참여 QR 코드 및 전용 접속 URL 생성 & 수업자료 일괄 수집
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

    QRCode.toDataURL(generatedUrl, {
      width: 400,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' }
    }).then(setQrCodeDataUrl).catch((err) => {
      console.error('QR 생성 실패:', err);
    });

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
          setStudentSubmissions(data.notes as ClassNoteRecord[]);
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
        .order('updated_at', { ascending: false });
      const timeoutPromise = new Promise<any>((resolve) =>
        setTimeout(() => resolve({ data: null, error: new Error('TIMEOUT') }), 1500)
      );
      const { data, error } = await Promise.race([sbPromise, timeoutPromise]);

      if (!error && data && data.length > 0) {
        setStudentSubmissions(data as ClassNoteRecord[]);
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

      // 2. Supabase 비동기 삭제 (1.5초 가드)
      if (supabase && isSupabaseConfigured) {
        const delPromise = supabase.from('class_notes').delete().eq('lesson_id', currentLessonId);
        const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 1500));
        Promise.race([delPromise, timeoutPromise]).catch(() => {});
      }

      setStudentSubmissions([]);
      setStudentPresences(new Map());
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

  // 4. 학생별 실시간 핑 상태 추적 Map: key -> { student, lastPingTime, status }
  const [studentHeartbeats, setStudentHeartbeats] = useState<Map<string, {
    grade: string;
    classNum: string;
    studentNum: string;
    name: string;
    lastPingTime: number;
    status: 'connected' | 'checking' | 'disconnected';
  }>>(new Map());

  // 2시간 무터치 자동 종료 감지용 마지막 터치 시간 (ms)
  const lastInteractionTimeRef = useRef<number>(Date.now());

  // 화면 터치/클릭 발생 시 마지막 조작 시간 갱신 & Supabase 세션 터치
  const handleUserInteraction = useCallback(() => {
    lastInteractionTimeRef.current = Date.now();
    classroomRealtime.touchTeacherSession(currentLessonId);
  }, [currentLessonId]);

  // 1초 주기로 학생 생존 핑 및 2시간 무터치 검사
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();

      // [A] 2시간(7200초) 무터치 시 자동 세션 종료
      if (now - lastInteractionTimeRef.current > 2 * 60 * 60 * 1000) {
        clearInterval(timer);
        showToast('⚠️ 2시간 동안 조작이 없어 수업 세션이 자동으로 종료되었습니다.');
        classroomRealtime.closeTeacherSession(currentLessonId);
        onExit();
        return;
      }

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
        const key = `${signal.student.grade}_${signal.student.classNum}_${signal.student.studentNum}`;
        const now = Date.now();

        setStudentHeartbeats((prev) => {
          const next = new Map(prev);
          const wasExisting = next.has(key);
          const prevStatus = next.get(key)?.status;

          next.set(key, {
            ...signal.student!,
            lastPingTime: now,
            status: 'connected'
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

      // [4] 온디맨드 필기 응답 수신
      if (signal.type === 'RESPONSE_STUDENT_NOTE' && signal.noteRecord) {
        const record = signal.noteRecord;
        const recKey = `${record.student_grade}_${record.student_class}_${record.student_num}`;
        if (selectedStudentKeyRef.current === recKey) {
          setSelectedStudentNote(record);
          setIsLoadingDetail(false);
          showToast(`⚡ ${record.student_name} 학생 최신 필기 동기화됨`);
        }
        setStudentSubmissions((prev) => {
          const filtered = prev.filter(p => !(
            p.student_grade === record.student_grade &&
            p.student_class === record.student_class &&
            p.student_num === record.student_num
          ));
          return [record, ...filtered];
        });
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
      submission?: ClassNoteRecord;
    }>();

    // 1) 제출 기록이 있는 학생 추가
    for (const sub of studentSubmissions) {
      const key = `${sub.student_grade}_${sub.student_class}_${sub.student_num}`;
      studentMap.set(key, {
        key,
        grade: sub.student_grade,
        classNum: sub.student_class,
        studentNum: sub.student_num,
        name: sub.student_name,
        status: 'disconnected',
        submission: sub
      });
    }

    // 2) 실시간 핑 접속자 상태 병합
    for (const [key, hb] of studentHeartbeats.entries()) {
      const existing = studentMap.get(key);
      if (existing) {
        existing.status = hb.status;
        existing.name = hb.name;
      } else {
        studentMap.set(key, {
          key,
          grade: hb.grade,
          classNum: hb.classNum,
          studentNum: hb.studentNum,
          name: hb.name,
          status: hb.status
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

  // 5. 학생 타일 클릭 시 온디맨드 필기 상세 열람
  const handleSelectStudent = async (studentItem: typeof sortedStudentRoster[0]) => {
    setIsLoadingDetail(true);
    setSelectedStudentPageIdx(0);
    selectedStudentKeyRef.current = studentItem.key;

    // 만약 이미 메모리에 strokes_data가 있는 경우 즉시 표시 및 첫 비어있지 않은 쪽으로 포커스
    if (studentItem.submission?.strokes_data?.pages || studentItem.submission?.strokes_data?.strokes) {
      setSelectedStudentNote(studentItem.submission);
      const pages = (Array.isArray(studentItem.submission.strokes_data.pages) && studentItem.submission.strokes_data.pages.length > 0)
        ? studentItem.submission.strokes_data.pages
        : [{ strokes: studentItem.submission.strokes_data.strokes || [], textItems: studentItem.submission.strokes_data.textItems || [] }];
      const firstNonEmpty = pages.findIndex((p: any) => (p.strokes?.length || 0) > 0 || (p.textItems?.length || 0) > 0 || p.fullPageBackground);
      setSelectedStudentPageIdx(firstNonEmpty >= 0 ? firstNonEmpty : 0);
      setIsLoadingDetail(false);
    } else {
      // 임시 placeholder 설정
      setSelectedStudentNote({
        lesson_id: currentLessonId,
        student_grade: studentItem.grade,
        student_class: studentItem.classNum,
        student_num: studentItem.studentNum,
        student_name: studentItem.name,
        strokes_data: { pages: [] }
      });
    }

    // C. 학생이 실시간 연결(online) 상태인 경우 원격 온디맨드 동기화 요청 신호 전송
    if (studentItem.status === 'connected') {
      await classroomRealtime.sendSignal({
        type: 'REQUEST_STUDENT_NOTE',
        lessonId: currentLessonId,
        targetStudentKey: studentItem.key
      });
    }

    // D. Supabase DB에서 최신 데이터 조회 (학번 기준 단건 조회)
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
          const pages = (Array.isArray(data.strokes_data?.pages) && data.strokes_data.pages.length > 0)
            ? data.strokes_data.pages
            : [{ strokes: data.strokes_data?.strokes || [], textItems: data.strokes_data?.textItems || [] }];
          const firstNonEmpty = pages.findIndex((p: any) => (p.strokes?.length || 0) > 0 || (p.textItems?.length || 0) > 0 || p.fullPageBackground);
          setSelectedStudentPageIdx(firstNonEmpty >= 0 ? firstNonEmpty : 0);

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
      setTimeout(() => setIsLoadingDetail(false), 300);
    }
  };

  // [잘못 접속된 학생 삭제 및 연결 해제]
  const handleDisconnectStudent = async (studentItem: typeof sortedStudentRoster[0]) => {
    const studentLabel = `${studentItem.grade}-${studentItem.classNum} ${studentItem.studentNum}번 ${studentItem.name}`;
    const confirmed = window.confirm(`'${studentLabel}' 학생의 연결을 해제하고 칠판 목록에서 삭제하시겠습니까?\n\n(해당 학생 태블릿의 필기는 안전하게 보존되며, 칠판 연결만 종료됩니다.)`);
    if (!confirmed) return;

    try {
      const studentKey = studentItem.key;

      // 1. 만약 현재 이 학생의 필기를 전체화면으로 열람 중이었다면 닫기
      if (selectedStudentKeyRef.current === studentKey) {
        setSelectedStudentNote(null);
        selectedStudentKeyRef.current = null;
      }

      // 2. 실시간 출석 목록(Presence)에서 즉시 제거
      setStudentPresences((prev) => {
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
              <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: '#ffffff' }}>
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
            <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '2px' }}>
              전자칠판 실시간 관제 및 학생 필기 모니터링
            </div>
          </div>
        </div>

        {/* 출석 카운터 뱃지 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: '#21262d',
              padding: '6px 14px',
              borderRadius: '20px',
              border: '1px solid #30363d',
              fontSize: '12.5px'
            }}
          >
            <span style={{ color: '#3fb950', fontWeight: 700 }}>● 참여 중: {activeCount}명</span>
            <span style={{ color: '#8b949e', marginLeft: '6px' }}>
              / 총 {sortedStudentRoster.length}명
            </span>
          </div>

          {/* 수업자료 다운로드 버튼 */}
          <button
            type="button"
            style={{
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.22) 0%, rgba(14, 165, 233, 0.35) 100%)',
              border: '1.5px solid #38bdf8',
              color: '#ffffff',
              borderRadius: '8px',
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 2px 10px rgba(56, 189, 248, 0.25)'
            }}
            onClick={() => {
              setIsMaterialModalOpen(true);
              fetchRegisteredLessonMaterials();
            }}
            title="본 수업에 등록된 학습자료(PDF, 활동지 등)를 전자칠판 기기에 다운로드합니다."
          >
            <span style={{ fontSize: '15px' }}>📥</span>
            <span>수업자료 다운로드</span>
            {lessonMaterials.length > 0 && (
              <span style={{ fontSize: '11px', background: '#0284c7', color: '#ffffff', padding: '1px 7px', borderRadius: '10px', fontWeight: 800 }}>
                {lessonMaterials.length}
              </span>
            )}
          </button>

          {/* 학번순 PDF 저장 버튼 */}
          <button
            type="button"
            className="g-btn g-btn-primary"
            style={{
              fontSize: '13px',
              fontWeight: 700,
              padding: '8px 18px',
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
              border: '1px solid #3b82f6',
              boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)'
            }}
            disabled={isGeneratingPdf}
            onClick={handleCompileAndSavePdf}
            title="현재까지 참여한 모든 학생의 필기를 학번순으로 자동 정렬하여 단일 A4 PDF 파일로 만들어 구글드라이브에 저장합니다."
          >
            {isGeneratingPdf ? '⏳ PDF 모음집 생성 중...' : '📑 학생 필기 모음집 PDF로 저장'}
          </button>

          {onOpenFolder && (
            <button
              type="button"
              style={{
                background: '#21262d',
                border: '1px solid #30363d',
                color: '#c9d1d9',
                borderRadius: '8px',
                padding: '8px 14px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
              onClick={() => onOpenFolder(currentLessonId, lesson.name)}
              title="구글 드라이브 해당 수업 폴더를 엽니다."
            >
              📁 드라이브 폴더
            </button>
          )}

          {/* 수업 초기화 버튼 (원터치 초기화) */}
          <button
            type="button"
            style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#f87171',
              borderRadius: '8px',
              padding: '8px 14px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
            onClick={handleResetSession}
            title="현재 수업의 모든 학생 등록 및 필기 기록을 초기화합니다."
          >
            🔄 수업 초기화
          </button>

          {/* 수업 나가기 버튼 */}
          <button
            type="button"
            style={{
              background: 'transparent',
              border: '1px solid #30363d',
              color: '#c9d1d9',
              borderRadius: '8px',
              padding: '8px 14px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            onClick={onExit}
            title="라이브 수업 화면을 종료하고 스마트 드라이브 포털로 돌아갑니다."
          >
            <span>✕ 수업 나가기</span>
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

      {/* 3. 대시보드 본문 (좌측: QR패널 / 우측: 전체 학생 타일 그리드) */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 좌측 패널 (대형 QR코드 및 접속 안내) */}
        {!sidebarCollapsed && (
          <aside
            style={{
              width: '320px',
              background: '#161b22',
              borderRight: '1px solid #30363d',
              padding: '24px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              flexShrink: 0,
              overflowY: 'auto'
            }}
          >
            <h2 style={{ fontSize: '15px', color: '#58a6ff', marginBottom: '14px', fontWeight: 700, textAlign: 'center' }}>
              📷 학생 참여 초대형 QR코드
            </h2>

            {qrCodeDataUrl ? (
              <div
                style={{
                  background: '#ffffff',
                  padding: '14px',
                  borderRadius: '16px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.6)'
                }}
              >
                <img
                  src={qrCodeDataUrl}
                  alt="Student QR Code"
                  style={{ width: '230px', height: '230px', display: 'block' }}
                />
              </div>
            ) : (
              <div style={{ width: '230px', height: '230px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b949e' }}>
                QR코드 생성 중...
              </div>
            )}

            <p style={{ fontSize: '12.5px', color: '#8b949e', textAlign: 'center', marginTop: '12px', lineHeight: 1.5 }}>
              태블릿 카메라로 QR을 스캔한 뒤<br />
              <strong>[📡 전자칠판 연결]</strong>을 누르면<br />
              우측에 실시간 출석으로 표시됩니다.
            </p>

            <div style={{ display: 'flex', gap: '8px', marginTop: '12px', width: '100%' }}>
              <button
                type="button"
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  fontSize: '12px',
                  background: '#21262d',
                  color: '#c9d1d9',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
                onClick={() => {
                  navigator.clipboard.writeText(studentUrl);
                  showToast('✅ 학생 접속 URL이 복사되었습니다.');
                }}
              >
                🔗 주소 복사
              </button>
              <button
                type="button"
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  fontSize: '12px',
                  background: '#1f6feb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
                onClick={() => window.open(studentUrl, '_blank')}
              >
                🚀 학생 창 열기
              </button>
            </div>

            <div style={{ marginTop: 'auto', paddingTop: '16px', width: '100%', borderTop: '1px solid #30363d', textAlign: 'center' }}>
              <button
                type="button"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#8b949e',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
                onClick={() => setSidebarCollapsed(true)}
              >
                ◀ QR 패널 접기 (학생 타일 넓게 보기)
              </button>
            </div>
          </aside>
        )}

        {/* 사이드바 접혔을 때 펼치기 토글 버튼 */}
        {sidebarCollapsed && (
          <button
            type="button"
            style={{
              width: '32px',
              background: '#161b22',
              border: 'none',
              borderRight: '1px solid #30363d',
              color: '#8b949e',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              writingMode: 'vertical-rl'
            }}
            onClick={() => setSidebarCollapsed(false)}
            title="QR 패널 펼치기"
          >
            ▶ QR 패널 열기
          </button>
        )}

        {/* 우측 메인 영역: 30석 고정 타일 배치 그리드 */}
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
                  <h2 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: '#ffffff' }}>
                    👥 전체 학생 실시간 출석 및 필기 모니터링
                  </h2>
                  <span style={{ fontSize: '12px', color: '#8b949e', marginTop: '3px', display: 'block' }}>
                    학번순(1번~35번) 자동 정렬 • 타일을 터치하면 학생 필기를 전체화면으로 즉시 열람합니다.
                  </span>
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

                  let badgeBg = '#30363d';
                  let badgeLabel = '미접속';
                  let borderColor = '#30363d';
                  let cardBg = '#161b22';

                  if (isOnline) {
                    badgeBg = '#238636';
                    badgeLabel = '🟢 연결됨';
                    borderColor = '#388bfd';
                    cardBg = 'rgba(56, 139, 253, 0.12)';
                  } else if (isChecking) {
                    badgeBg = '#d29922';
                    badgeLabel = '🟡 확인 중';
                    borderColor = '#d29922';
                    cardBg = 'rgba(210, 153, 34, 0.12)';
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

                      {/* 필기 작성/제출 여부 */}
                      <div style={{ fontSize: '10px', color: hasNote ? '#58a6ff' : '#8b949e' }}>
                        {hasNote ? '📝 필기 있음' : '작성 중...'}
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
    </div>
  );
};

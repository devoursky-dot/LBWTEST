import React, { useState, useMemo, useEffect } from 'react';
import {
  getAllStudentAccounts,
  getTeacherAccounts,
  setWhiteboardPassword,
  setAdminPassword,
  resetStudentPasswordToDefault,
  changeStudentPassword,
  resetTeacherPasswordToDefault,
  changeTeacherPassword,
  getLocalCustomHashes,
  fetchAllModifiedAccountsFromCloud
} from './lib/auth';

interface AdminDashboardModalProps {
  driveFolderNames: string[];
  onClose: () => void;
  onToast: (msg: string) => void;
  onAddTeacher?: (name: string) => Promise<any>;
  onRefreshDriveFolders?: () => Promise<any>;
}

export function AdminDashboardModal({ 
  driveFolderNames, 
  onClose, 
  onToast,
  onAddTeacher,
  onRefreshDriveFolders
}: AdminDashboardModalProps) {
  const [activeTab, setActiveTab] = useState<'students' | 'teachers' | 'whiteboard' | 'admin'>('students');

  // 모달 내부 상단 피드백 알림 배너
  const [inModalAlert, setInModalAlert] = useState<{
    type: 'success' | 'warning' | 'info' | 'error';
    message: string;
    subtext?: string;
  } | null>(null);

  // 선생님 추가 인라인 상태
  const [isAddingTeacherOpen, setIsAddingTeacherOpen] = useState(false);
  const [newTeacherNameInput, setNewTeacherNameInput] = useState('');
  const [isAddingTeacher, setIsAddingTeacher] = useState(false);
  const [isRefreshingDrive, setIsRefreshingDrive] = useState(false);

  // 학생 검색 및 필터 상태
  const [studentSearch, setStudentSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState<'all' | '1' | '2' | '3' | 'modified'>('all');

  // 수정 모달/인라인 상태
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editPasswordInput, setEditPasswordInput] = useState('');

  // 전자칠판 및 관리자 비밀번호 변경 입력 상태
  const [newWbPw, setNewWbPw] = useState('');
  const [newAdminPw, setNewAdminPw] = useState('');

  // 로컬/클라우드 해시 저장소 상태
  const [cloudHashes, setCloudHashes] = useState<Record<string, string>>(() => getLocalCustomHashes());
  const [isCloudSyncing, setIsCloudSyncing] = useState<boolean>(false);

  // 새로고침 트리거
  const [refreshKey, setRefreshKey] = useState(0);

  // 1. 모달 열릴 때 클라우드 Supabase에서 최신 변경 계정 및 등록 선생님 목록 일괄 동기화
  useEffect(() => {
    let isMounted = true;
    setIsCloudSyncing(true);
    fetchAllModifiedAccountsFromCloud()
      .then(records => {
        if (!isMounted) return;
        const hashMap: Record<string, string> = {};
        for (const [id, info] of Object.entries(records)) {
          hashMap[id] = info.hash;
        }
        setCloudHashes(hashMap);
      })
      .catch(err => {
        console.warn('Admin fetch cloud accounts err:', err);
      })
      .finally(() => {
        if (isMounted) setIsCloudSyncing(false);
      });

    return () => {
      isMounted = false;
    };
  }, [refreshKey]);

  // 2. 전체 학생 계정 (720명)
  const allStudents = useMemo(() => {
    return getAllStudentAccounts(cloudHashes);
  }, [cloudHashes, refreshKey]);

  // 3. 전체 선생님 계정 (구글 드라이브 최상위 실제 폴더 기반 100% 실시간 연동)
  const allTeachers = useMemo(() => {
    return getTeacherAccounts(driveFolderNames, cloudHashes);
  }, [driveFolderNames, cloudHashes, refreshKey]);

  // 4. 필터링된 학생 계정 목록
  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();

    return allStudents.filter(acc => {
      // 학년 필터
      if (gradeFilter === '1' && acc.grade !== '1') return false;
      if (gradeFilter === '2' && acc.grade !== '2') return false;
      if (gradeFilter === '3' && acc.grade !== '3') return false;
      if (gradeFilter === 'modified' && !acc.isModified) return false;

      // 검색어 필터 (학번 또는 이름)
      if (q) {
        return acc.id.includes(q) || acc.name.toLowerCase().includes(q);
      }
      return true;
    });
  }, [allStudents, studentSearch, gradeFilter]);

  // 개별 계정 비밀번호 직접 설정
  const handleSavePassword = async (id: string, name: string) => {
    if (!editPasswordInput.trim() || editPasswordInput.trim().length < 4) {
      onToast('⚠️ 비밀번호는 최소 4자리 이상이어야 합니다.');
      return;
    }
    const cleanPw = editPasswordInput.trim();
    if (id.startsWith('tch_')) {
      const tchName = id.replace('tch_', '');
      await changeTeacherPassword(tchName, cleanPw);
    } else {
      await changeStudentPassword(id, cleanPw, name);
    }
    setEditingAccountId(null);
    setEditPasswordInput('');
    setRefreshKey(k => k + 1);
    onToast(`✅ [${name || id}] 비밀번호가 새로 설정되었습니다.`);
  };

  // 학생 계정 1234로 초기화
  const handleResetStudentToDefault = async (id: string, label: string) => {
    if (window.confirm(`[${label}] 학생의 비밀번호를 초기값(1234)으로 초기화하시겠습니까?\n초기화 즉시 학생은 1234로 다시 로그인할 수 있습니다.`)) {
      await resetStudentPasswordToDefault(id);
      setRefreshKey(k => k + 1);
      onToast(`🔄 [${label}] 비밀번호가 1234로 초기화되었습니다.`);
    }
  };

  // 선생님 계정 1234로 초기화
  const handleResetTeacherToDefault = async (teacherId: string, label: string) => {
    if (window.confirm(`[${label}] 비밀번호를 초기값(1234)으로 초기화하시겠습니까?`)) {
      const tchName = teacherId.replace('tch_', '');
      await resetTeacherPasswordToDefault(tchName);
      setRefreshKey(k => k + 1);
      onToast(`🔄 [${label}] 비밀번호가 1234로 초기화되었습니다.`);
    }
  };

  // 학생 학년 전체 일괄 1234 초기화
  const handleBulkResetStudents = async (targetGrade?: string) => {
    const label = targetGrade ? `${targetGrade}학년 전체 학생` : '전체 학생(720명)';
    if (window.confirm(`정말로 ${label}의 비밀번호를 모두 '1234'로 일괄 초기화하시겠습니까?\n이 작업은 클라우드 및 모든 태블릿에 즉시 반영됩니다.`)) {
      const accountsToReset = targetGrade
        ? allStudents.filter(s => s.grade === targetGrade && s.isModified)
        : allStudents.filter(s => s.isModified);

      for (const s of accountsToReset) {
        await resetStudentPasswordToDefault(s.id);
      }
      setRefreshKey(k => k + 1);
      onToast(`🎉 ${label}의 변경된 비밀번호가 모두 1234로 일괄 초기화되었습니다.`);
    }
  };

  // 전자칠판 비밀번호 변경
  const handleUpdateWhiteboardPw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWbPw.trim() || newWbPw.trim().length < 4) {
      onToast('⚠️ 전자칠판 새 비밀번호는 최소 4자리 이상이어야 합니다.');
      return;
    }
    await setWhiteboardPassword(newWbPw.trim());
    setNewWbPw('');
    setRefreshKey(k => k + 1);
    onToast(`✅ 전자칠판 비밀번호가 안전하게 변경되었습니다.`);
  };

  // 관리자 비밀번호 변경
  const handleUpdateAdminPw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminPw.trim() || newAdminPw.trim().length < 6) {
      onToast('⚠️ 관리자 비밀번호는 최소 6자리 이상이어야 합니다.');
      return;
    }
    await setAdminPassword(newAdminPw.trim());
    setNewAdminPw('');
    setRefreshKey(k => k + 1);
    onToast('✅ 관리자 비밀번호가 안전하게 변경되었습니다.');
  };

  // 새 선생님 추가 핸들러: 구글 드라이브 최상위 폴더에 실제 폴더 생성 시도
  const handleCreateTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newTeacherNameInput.trim().replace(' 선생님', '').replace('선생님', '').trim();
    if (!cleanName) {
      setInModalAlert({
        type: 'warning',
        message: '⚠️ 추가할 선생님 이름을 입력해 주세요.'
      });
      return;
    }
    if (driveFolderNames.some(name => name.trim() === cleanName || name.trim() === `${cleanName} 선생님`)) {
      setInModalAlert({
        type: 'warning',
        message: `⚠️ 이미 구글 드라이브에 '${cleanName}' 선생님 폴더가 존재합니다.`
      });
      return;
    }

    setIsAddingTeacher(true);
    setInModalAlert(null);
    try {
      if (onAddTeacher) {
        const result = await onAddTeacher(cleanName);
        if (result && result.success) {
          setIsAddingTeacherOpen(false);
          setNewTeacherNameInput('');
          setRefreshKey(k => k + 1);
          setInModalAlert({
            type: 'success',
            message: `🎉 [${cleanName} 선생님] 구글 드라이브 폴더가 정상 생성되었습니다!`,
            subtext: '초기 비밀번호는 1234이며 지금 바로 연동되었습니다.'
          });
          onToast(`🎉 [${cleanName} 선생님] 드라이브 폴더 생성 완료! (초기 비밀번호: 1234)`);
        } else {
          // 구글 드라이브 폴더 생성이 실패한 경우 억지로 등록하지 않고 정직하게 안내
          setInModalAlert({
            type: 'error',
            message: `❌ 구글 드라이브 폴더 자동 생성 실패 (시스템 연동 오류)`,
            subtext: `구글 드라이브 시스템 권한/통신 오류(403)로 인해 폴더를 자동 생성하지 못했습니다. 구글 드라이브 시스템 문제가 해결될 때까지, 구글 드라이브 웹 화면에서 직접 '${cleanName}' 폴더를 생성하시고 [새로고침]을 누르시면 100% 정상 연동됩니다.`
          });
          onToast(`⚠️ 구글 드라이브 시스템 오류로 폴더를 생성하지 못했습니다.`);
        }
      }
    } catch (err: any) {
      setInModalAlert({
        type: 'error',
        message: `❌ 구글 드라이브 폴더 생성 실패: ${err.message}`,
        subtext: `구글 드라이브 웹에서 직접 '${cleanName}' 폴더를 만드시고 [새로고침]을 누르시면 자동 연동됩니다.`
      });
      onToast(`❌ 폴더 생성 실패: ${err.message}`);
    } finally {
      setIsAddingTeacher(false);
    }
  };

  // 구글 드라이브 최상위 폴더 실시간 재동기화
  const handleManualRefreshDrive = async () => {
    setIsRefreshingDrive(true);
    try {
      if (onRefreshDriveFolders) {
        await onRefreshDriveFolders();
      }
      setRefreshKey(k => k + 1);
      onToast('🔄 구글 드라이브 선생님 폴더 목록을 최신 상태로 동기화했습니다.');
    } catch (err: any) {
      onToast(`⚠️ 동기화 실패: ${err.message}`);
    } finally {
      setIsRefreshingDrive(false);
    }
  };

  const modifiedStudentCount = useMemo(() => {
    return allStudents.filter(s => s.isModified).length;
  }, [allStudents]);

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 9999 }}>
      <div
        className="modal-box"
        style={{
          maxWidth: '1000px',
          width: '94vw',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          background: '#161922',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: '20px',
          padding: '24px 28px',
          color: '#ffffff',
          boxShadow: '0 30px 90px rgba(0,0,0,0.8)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 모달 헤더 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '26px' }}>🛡️</span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>
                  통합 계정 & 비밀번호 보안 관리 센터
                </h2>
                {isCloudSyncing && (
                  <span style={{ fontSize: '11px', background: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', padding: '2px 8px', borderRadius: '4px' }}>
                    클라우드 동기화 중...
                  </span>
                )}
              </div>
              <span style={{ fontSize: '12.5px', color: '#94a3b8' }}>
                전자칠판, 선생님, 1101~3830 학생들의 비밀번호를 검색하고 분실 시 1234로 초기화합니다
              </span>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} style={{ fontSize: '18px' }}>✕</button>
        </div>

        {/* 상단 4대 메트릭 요약 배너 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', margin: '18px 0' }}>
          <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.25)', borderRadius: '12px', padding: '12px 14px' }}>
            <span style={{ fontSize: '11px', color: '#93c5fd', fontWeight: 600 }}>🖥️ 전자칠판 인증 보안</span>
            <div style={{ fontSize: '15px', fontWeight: 700, marginTop: '4px', color: '#ffffff' }}>
              보안 암호화 저장됨
            </div>
          </div>

          <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: '12px', padding: '12px 14px' }}>
            <span style={{ fontSize: '11px', color: '#86efac', fontWeight: 600 }}>👨‍🏫 등록된 선생님 계정</span>
            <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '4px', color: '#ffffff' }}>
              {allTeachers.length} 명
            </div>
          </div>

          <div style={{ background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.25)', borderRadius: '12px', padding: '12px 14px' }}>
            <span style={{ fontSize: '11px', color: '#fde047', fontWeight: 600 }}>👨‍🎓 학생 계정 (1101~3830)</span>
            <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '4px', color: '#ffffff' }}>
              {allStudents.length} 명 (기본값: 1234)
            </div>
          </div>

          <div style={{ background: 'rgba(168, 85, 247, 0.1)', border: '1px solid rgba(168, 85, 247, 0.25)', borderRadius: '12px', padding: '12px 14px' }}>
            <span style={{ fontSize: '11px', color: '#d8b4fe', fontWeight: 600 }}>🔑 비밀번호 변경 학생</span>
            <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '4px', color: '#ffffff' }}>
              {modifiedStudentCount} 명
            </div>
          </div>
        </div>

        {/* 탭 네비게이션 */}
        <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '10px' }}>
          {[
            { id: 'students', label: `👨‍🎓 학생 계정 관리 (${allStudents.length})` },
            { id: 'teachers', label: `👨‍🏫 선생님 계정 관리 (${allTeachers.length})` },
            { id: 'whiteboard', label: '🖥️ 전자칠판 비밀번호 설정' },
            { id: 'admin', label: '🛡️ 관리자 보안 설정' }
          ].map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                style={{
                  background: isActive ? 'var(--g-primary-blue)' : 'rgba(255, 255, 255, 0.05)',
                  border: 'none',
                  color: isActive ? '#ffffff' : '#94a3b8',
                  padding: '8px 16px',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: isActive ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* 탭 1: 학생 계정 관리 (1101 ~ 3830) */}
        {activeTab === 'students' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, marginTop: '14px' }}>
            {/* 검색 및 필터 컨트롤 바 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flex: 1, minWidth: '280px' }}>
                <input
                  type="text"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  placeholder="🔍 학번(예: 1101, 2315) 또는 이름으로 실시간 검색..."
                  style={{
                    flex: 1,
                    padding: '9px 14px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    background: 'rgba(15, 23, 42, 0.6)',
                    color: '#ffffff',
                    fontSize: '13px',
                    outline: 'none'
                  }}
                />
                {studentSearch && (
                  <button
                    type="button"
                    onClick={() => setStudentSearch('')}
                    style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '13px' }}
                  >
                    초기화
                  </button>
                )}
              </div>

              {/* 학년 필터 버튼군 */}
              <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.05)', padding: '2px', borderRadius: '8px', gap: '2px' }}>
                {[
                  { id: 'all', label: '전체 (720)' },
                  { id: '1', label: '1학년' },
                  { id: '2', label: '2학년' },
                  { id: '3', label: '3학년' },
                  { id: 'modified', label: `비번 변경됨 (${modifiedStudentCount})` }
                ].map(f => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setGradeFilter(f.id as any)}
                    style={{
                      background: gradeFilter === f.id ? 'var(--g-primary-blue)' : 'transparent',
                      color: gradeFilter === f.id ? '#ffffff' : '#94a3b8',
                      border: 'none',
                      padding: '5px 10px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {/* 일괄 초기화 버튼 */}
              {modifiedStudentCount > 0 && (
                <button
                  type="button"
                  onClick={() => handleBulkResetStudents(gradeFilter === 'all' || gradeFilter === 'modified' ? undefined : gradeFilter)}
                  style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#fca5a5',
                    padding: '7px 12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                  title="해당 학생들의 변경된 비밀번호를 모두 1234로 초기화합니다"
                >
                  🔄 {gradeFilter === 'all' || gradeFilter === 'modified' ? '전체' : `${gradeFilter}학년`} 1234로 일괄초기화
                </button>
              )}
            </div>

            {/* 학생 계정 테이블 */}
            <div style={{ flex: 1, minHeight: '340px', maxHeight: '420px', overflowY: 'auto', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '12px', background: 'rgba(15, 23, 42, 0.4)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#1c202c', borderBottom: '1px solid rgba(255, 255, 255, 0.12)', zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '10px 14px', width: '90px' }}>학번</th>
                    <th style={{ padding: '10px 14px', width: '180px' }}>학생 정보</th>
                    <th style={{ padding: '10px 14px', width: '180px' }}>비밀번호 보안 상태</th>
                    <th style={{ padding: '10px 14px', width: '120px' }}>상태</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right' }}>관리 작업</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: '36px', textAlign: 'center', color: '#94a3b8' }}>
                        검색 조건에 맞는 학생 계정이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredStudents.map(student => {
                      const isEditing = editingAccountId === student.id;

                      return (
                        <tr
                          key={student.id}
                          style={{
                            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                            background: isEditing ? 'rgba(59, 130, 246, 0.1)' : 'transparent'
                          }}
                        >
                          <td style={{ padding: '10px 14px', fontWeight: 700, color: '#38bdf8' }}>
                            {student.id}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            {student.name}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            {isEditing ? (
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <input
                                  type="text"
                                  value={editPasswordInput}
                                  onChange={(e) => setEditPasswordInput(e.target.value)}
                                  placeholder="새 비번 (4자리 이상)"
                                  style={{
                                    width: '120px',
                                    padding: '5px 8px',
                                    borderRadius: '6px',
                                    border: '1px solid #3b82f6',
                                    background: '#0f172a',
                                    color: '#ffffff',
                                    fontSize: '12px',
                                    outline: 'none'
                                  }}
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  onClick={() => handleSavePassword(student.id, student.name)}
                                  style={{ background: '#22c55e', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                                >
                                  저장
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingAccountId(null)}
                                  style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #475569', borderRadius: '6px', padding: '4px 6px', fontSize: '11px', cursor: 'pointer' }}
                                >
                                  취소
                                </button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '12.5px', color: student.isModified ? '#38bdf8' : '#94a3b8' }}>
                                  {student.isModified ? '🔒 개별 암호화됨' : '초기 비밀번호 (1234)'}
                                </span>
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '3px 8px',
                                borderRadius: '6px',
                                fontSize: '11px',
                                fontWeight: 600,
                                background: student.isModified ? 'rgba(234, 179, 8, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                                color: student.isModified ? '#facc15' : '#94a3b8'
                              }}
                            >
                              {student.isModified ? '🔑 비번 변경됨' : '초기값'}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: '6px' }}>
                              {!isEditing && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingAccountId(student.id);
                                    setEditPasswordInput('');
                                  }}
                                  style={{
                                    background: 'rgba(59, 130, 246, 0.15)',
                                    border: '1px solid rgba(59, 130, 246, 0.3)',
                                    color: '#93c5fd',
                                    borderRadius: '6px',
                                    padding: '5px 10px',
                                    fontSize: '11.5px',
                                    cursor: 'pointer',
                                    fontWeight: 600
                                  }}
                                  title="학생의 비밀번호를 직접 새로 지정합니다"
                                >
                                  ✏️ 비번 설정
                                </button>
                              )}
                              {student.isModified ? (
                                <button
                                  type="button"
                                  onClick={() => handleResetStudentToDefault(student.id, student.name)}
                                  style={{
                                    background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.3) 0%, rgba(220, 38, 38, 0.4) 100%)',
                                    border: '1px solid #ef4444',
                                    color: '#ffffff',
                                    borderRadius: '6px',
                                    padding: '5px 10px',
                                    fontSize: '11.5px',
                                    cursor: 'pointer',
                                    fontWeight: 700,
                                    boxShadow: '0 2px 6px rgba(239, 68, 68, 0.3)'
                                  }}
                                  title="학생이 비밀번호를 잊어버린 경우 1234로 초기화합니다"
                                >
                                  🔄 1234로 초기화
                                </button>
                              ) : (
                                <span style={{ fontSize: '11px', color: '#64748b', alignSelf: 'center', padding: '0 6px' }}>
                                  1234 유지
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 탭 2: 선생님 계정 관리 (구글 드라이브 폴더 + 클라우드 등록 교사 통합) */}
        {activeTab === 'teachers' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: '340px', marginTop: '14px' }}>
            {/* 상단 안내 배너 */}
            {inModalAlert && (
              <div
                style={{
                  background:
                    inModalAlert.type === 'success' ? 'rgba(34, 197, 94, 0.15)' :
                    inModalAlert.type === 'error' ? 'rgba(239, 68, 68, 0.15)' :
                    inModalAlert.type === 'warning' ? 'rgba(234, 179, 8, 0.15)' :
                    'rgba(59, 130, 246, 0.15)',
                  border: `1px solid ${
                    inModalAlert.type === 'success' ? '#22c55e' :
                    inModalAlert.type === 'error' ? '#ef4444' :
                    inModalAlert.type === 'warning' ? '#eab308' :
                    '#3b82f6'
                  }`,
                  borderRadius: '10px',
                  padding: '12px 16px',
                  marginBottom: '14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '10px'
                }}
              >
                <div>
                  <div style={{ color: '#ffffff', fontSize: '13px', fontWeight: 700, marginBottom: inModalAlert.subtext ? '4px' : '0' }}>
                    {inModalAlert.message}
                  </div>
                  {inModalAlert.subtext && (
                    <div style={{ color: '#cbd5e1', fontSize: '12px', lineHeight: 1.4 }}>
                      {inModalAlert.subtext}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setInModalAlert(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '14px',
                    padding: '2px 6px'
                  }}
                >
                  ✕
                </button>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
              <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', padding: '10px 14px', borderRadius: '12px', fontSize: '12.5px', color: '#93c5fd', flex: 1, minWidth: '280px' }}>
                📁 <strong>선생님 계정 연동:</strong> 구글 드라이브 최상위 폴더 및 클라우드에 등록된 모든 교사 계정입니다. (초기 비밀번호: <code>1234</code>)
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={handleManualRefreshDrive}
                  disabled={isRefreshingDrive}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    background: 'rgba(255, 255, 255, 0.06)',
                    color: '#e2e8f0',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                  title="구글 드라이브 루트 폴더의 선생님 폴더를 다시 조회합니다"
                >
                  <span>🔄</span>
                  <span>{isRefreshingDrive ? '동기화 중...' : '새로고침'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddingTeacherOpen(prev => !prev)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '10px',
                    border: '1px solid #3b82f6',
                    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                    color: '#ffffff',
                    fontSize: '12.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 4px 12px rgba(37, 99, 235, 0.35)'
                  }}
                >
                  <span>➕</span>
                  <span>선생님 추가</span>
                </button>
              </div>
            </div>

            {/* 선생님 추가 폼 */}
            {isAddingTeacherOpen && (
              <form
                onSubmit={handleCreateTeacher}
                style={{
                  background: 'rgba(30, 41, 59, 0.85)',
                  border: '1px solid rgba(59, 130, 246, 0.4)',
                  padding: '14px 16px',
                  borderRadius: '12px',
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  flexWrap: 'wrap'
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#ffffff', whiteSpace: 'nowrap' }}>
                  👨‍🏫 새 선생님 성함:
                </span>
                <input
                  type="text"
                  value={newTeacherNameInput}
                  onChange={(e) => setNewTeacherNameInput(e.target.value)}
                  placeholder="예: 홍길동 (또는 김선생)"
                  style={{
                    flex: 1,
                    minWidth: '180px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    background: '#0f172a',
                    color: '#ffffff',
                    fontSize: '13px',
                    outline: 'none'
                  }}
                  disabled={isAddingTeacher}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={isAddingTeacher}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  {isAddingTeacher ? '⏳ 등록 및 연동 중...' : '📁 드라이브 폴더 생성 및 1234 등록'}
                </button>
                <button
                  type="button"
                  onClick={() => { setIsAddingTeacherOpen(false); setNewTeacherNameInput(''); }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    background: 'transparent',
                    color: '#94a3b8',
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  취소
                </button>
              </form>
            )}

            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '12px', background: 'rgba(15, 23, 42, 0.4)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#1c202c', borderBottom: '1px solid rgba(255, 255, 255, 0.12)', zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '10px 14px' }}>선생님 이름 (폴더명)</th>
                    <th style={{ padding: '10px 14px' }}>계정 ID</th>
                    <th style={{ padding: '10px 14px' }}>비밀번호 보안 상태</th>
                    <th style={{ padding: '10px 14px' }}>상태</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right' }}>관리 작업</th>
                  </tr>
                </thead>
                <tbody>
                  {allTeachers.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: '36px', textAlign: 'center', color: '#94a3b8' }}>
                        구글 드라이브에 등록된 선생님 폴더가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    allTeachers.map(teacher => {
                      const isEditing = editingAccountId === teacher.id;

                      return (
                        <tr key={teacher.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                          <td style={{ padding: '12px 14px', fontWeight: 600 }}>
                            📁 {teacher.name}
                          </td>
                          <td style={{ padding: '12px 14px', color: '#94a3b8', fontFamily: 'monospace' }}>
                            {teacher.id}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            {isEditing ? (
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <input
                                  type="text"
                                  value={editPasswordInput}
                                  onChange={(e) => setEditPasswordInput(e.target.value)}
                                  placeholder="새 비밀번호 (4자리 이상)"
                                  style={{
                                    width: '120px',
                                    padding: '5px 8px',
                                    borderRadius: '6px',
                                    border: '1px solid #3b82f6',
                                    background: '#0f172a',
                                    color: '#ffffff',
                                    fontSize: '12px',
                                    outline: 'none'
                                  }}
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  onClick={() => handleSavePassword(teacher.id, teacher.name)}
                                  style={{ background: '#22c55e', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                                >
                                  저장
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingAccountId(null)}
                                  style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #475569', borderRadius: '6px', padding: '4px 6px', fontSize: '11px', cursor: 'pointer' }}
                                >
                                  취소
                                </button>
                              </div>
                            ) : (
                              <span style={{ fontSize: '12.5px', color: teacher.isModified ? '#38bdf8' : '#94a3b8' }}>
                                {teacher.isModified ? '🔒 개별 암호화됨' : '초기 비밀번호 (1234)'}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '3px 8px',
                                borderRadius: '6px',
                                fontSize: '11px',
                                fontWeight: 600,
                                background: teacher.isModified ? 'rgba(234, 179, 8, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                                color: teacher.isModified ? '#facc15' : '#94a3b8'
                              }}
                            >
                              {teacher.isModified ? '🔑 수정됨' : '초기값'}
                            </span>
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: '6px' }}>
                              {!isEditing && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingAccountId(teacher.id);
                                    setEditPasswordInput('');
                                  }}
                                  style={{
                                    background: 'rgba(59, 130, 246, 0.15)',
                                    border: '1px solid rgba(59, 130, 246, 0.3)',
                                    color: '#93c5fd',
                                    borderRadius: '6px',
                                    padding: '5px 10px',
                                    fontSize: '11.5px',
                                    cursor: 'pointer',
                                    fontWeight: 600
                                  }}
                                >
                                  ✏️ 수정
                                </button>
                              )}
                              {teacher.isModified && (
                                <button
                                  type="button"
                                  onClick={() => handleResetTeacherToDefault(teacher.id, teacher.name)}
                                  style={{
                                    background: 'rgba(239, 68, 68, 0.15)',
                                    border: '1px solid rgba(239, 68, 68, 0.3)',
                                    color: '#fca5a5',
                                    borderRadius: '6px',
                                    padding: '5px 10px',
                                    fontSize: '11.5px',
                                    cursor: 'pointer',
                                    fontWeight: 600
                                  }}
                                >
                                  🔄 1234 초기화
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 탭 3: 전자칠판 비밀번호 설정 */}
        {activeTab === 'whiteboard' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: '340px', marginTop: '14px', maxWidth: '520px' }}>
            <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', padding: '12px 14px', borderRadius: '12px', fontSize: '12.5px', color: '#93c5fd', marginBottom: '18px', lineHeight: 1.6 }}>
              🖥️ <strong>전자칠판 마스터 비밀번호:</strong> 전자칠판에서 한 번 입력하면 영구 유지되는 비밀번호입니다.
            </div>

            <div style={{ background: 'rgba(255, 255, 255, 0.04)', padding: '16px', borderRadius: '12px', marginBottom: '20px' }}>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>전자칠판 보안 상태</span>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#38bdf8', marginTop: '4px' }}>
                🔒 SHA-256 단방향 암호화 적용 중
              </div>
            </div>

            <form onSubmit={handleUpdateWhiteboardPw} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
                  새 전자칠판 비밀번호 입력
                </label>
                <input
                  type="password"
                  value={newWbPw}
                  onChange={(e) => setNewWbPw(e.target.value)}
                  placeholder="새 전자칠판 비밀번호 입력 (4자리 이상)"
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    background: 'rgba(15, 23, 42, 0.6)',
                    color: '#ffffff',
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <button
                type="submit"
                style={{
                  padding: '12px',
                  borderRadius: '10px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                  color: '#ffffff',
                  fontSize: '13.5px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                💾 전자칠판 새 비밀번호 저장
              </button>
            </form>
          </div>
        )}

        {/* 탭 4: 관리자 보안 설정 */}
        {activeTab === 'admin' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: '340px', marginTop: '14px', maxWidth: '520px' }}>
            <div style={{ background: 'rgba(234, 179, 8, 0.08)', border: '1px solid rgba(234, 179, 8, 0.25)', padding: '12px 14px', borderRadius: '12px', fontSize: '12.5px', color: '#fde047', marginBottom: '18px', lineHeight: 1.6 }}>
              🛡️ <strong>최고 관리자 계정 보안:</strong> 관리자 ID는 <code>admin</code>이며, 관리자 비밀번호를 안전하게 변경할 수 있습니다.
            </div>

            <div style={{ background: 'rgba(255, 255, 255, 0.04)', padding: '16px', borderRadius: '12px', marginBottom: '20px' }}>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>관리자 계정 보안 상태</span>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#facc15', marginTop: '4px' }}>
                🔒 SHA-256 단방향 솔트 암호화 보호 중
              </div>
            </div>

            <form onSubmit={handleUpdateAdminPw} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
                  새 관리자 비밀번호 입력 (6자리 이상)
                </label>
                <input
                  type="password"
                  value={newAdminPw}
                  onChange={(e) => setNewAdminPw(e.target.value)}
                  placeholder="새 관리자 비밀번호 입력"
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    background: 'rgba(15, 23, 42, 0.6)',
                    color: '#ffffff',
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <button
                type="submit"
                style={{
                  padding: '12px',
                  borderRadius: '10px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)',
                  color: '#1e293b',
                  fontSize: '13.5px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                💾 관리자 새 비밀번호 저장
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useState, useMemo } from 'react';
import {
  getAllStudentAccounts,
  getTeacherAccounts,
  getWhiteboardPassword,
  setWhiteboardPassword,
  getAdminPassword,
  setAdminPassword,
  saveCustomPassword,
  resetCustomPassword,
  getCustomPasswords
} from './lib/auth';

interface AdminDashboardModalProps {
  driveFolderNames: string[];
  onClose: () => void;
  onToast: (msg: string) => void;
}

export function AdminDashboardModal({ driveFolderNames, onClose, onToast }: AdminDashboardModalProps) {
  const [activeTab, setActiveTab] = useState<'students' | 'teachers' | 'whiteboard' | 'admin'>('students');

  // 학생 검색 및 필터 상태
  const [studentSearch, setStudentSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState<'all' | '1' | '2' | '3' | 'modified'>('all');
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});

  // 수정 모달/인라인 상태
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editPasswordInput, setEditPasswordInput] = useState('');

  // 전자칠판 및 관리자 비밀번호 변경 입력 상태
  const [newWbPw, setNewWbPw] = useState('');
  const [newAdminPw, setNewAdminPw] = useState('');

  // 새로고침 트리거
  const [refreshKey, setRefreshKey] = useState(0);

  // 1. 전체 학생 계정 (720명)
  const allStudents = useMemo(() => {
    return getAllStudentAccounts();
  }, [refreshKey]);

  // 2. 전체 선생님 계정 (구글 드라이브 폴더 기반)
  const allTeachers = useMemo(() => {
    return getTeacherAccounts(driveFolderNames);
  }, [driveFolderNames, refreshKey]);

  // 3. 필터링된 학생 계정 목록
  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    const customPws = getCustomPasswords();

    return allStudents.filter(acc => {
      // 학년 필터
      if (gradeFilter === '1' && acc.grade !== '1') return false;
      if (gradeFilter === '2' && acc.grade !== '2') return false;
      if (gradeFilter === '3' && acc.grade !== '3') return false;
      if (gradeFilter === 'modified' && !customPws[acc.id]) return false;

      // 검색어 필터 (학번 또는 이름)
      if (q) {
        return acc.id.includes(q) || acc.name.toLowerCase().includes(q);
      }
      return true;
    });
  }, [allStudents, studentSearch, gradeFilter, refreshKey]);

  // 비밀번호 가시성 토글
  const togglePasswordVisibility = (id: string) => {
    setVisiblePasswords(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // 개별 계정 비밀번호 수정 저장
  const handleSavePassword = (id: string) => {
    if (!editPasswordInput.trim() || editPasswordInput.trim().length < 4) {
      onToast('⚠️ 비밀번호는 최소 4자리 이상이어야 합니다.');
      return;
    }
    saveCustomPassword(id, editPasswordInput.trim());
    setEditingAccountId(null);
    setEditPasswordInput('');
    setRefreshKey(k => k + 1);
    onToast(`✅ [${id}] 비밀번호가 성공적으로 수정되었습니다.`);
  };

  // 개별 계정 1234로 초기화
  const handleResetToDefault = (id: string, label: string) => {
    if (window.confirm(`[${label}] 비밀번호를 초기값(1234)으로 초기화하시겠습니까?`)) {
      resetCustomPassword(id);
      setRefreshKey(k => k + 1);
      onToast(`🔄 [${label}] 비밀번호가 1234로 초기화되었습니다.`);
    }
  };

  // 학생 학년 전체 일괄 1234 초기화
  const handleBulkResetStudents = (targetGrade?: string) => {
    const label = targetGrade ? `${targetGrade}학년 전체 학생` : '전체 학생(720명)';
    if (window.confirm(`정말로 ${label}의 비밀번호를 모두 '1234'로 일괄 초기화하시겠습니까?`)) {
      const customPws = getCustomPasswords();
      const accountsToReset = targetGrade
        ? allStudents.filter(s => s.grade === targetGrade)
        : allStudents;

      accountsToReset.forEach(s => {
        delete customPws[s.id];
      });
      localStorage.setItem('lbw_custom_passwords_v2', JSON.stringify(customPws));
      setRefreshKey(k => k + 1);
      onToast(`🎉 ${label}의 비밀번호가 1234로 일괄 초기화되었습니다.`);
    }
  };

  // 전자칠판 비밀번호 변경
  const handleUpdateWhiteboardPw = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWbPw.trim() || newWbPw.trim().length < 4) {
      onToast('⚠️ 전자칠판 새 비밀번호는 최소 4자리 이상이어야 합니다.');
      return;
    }
    setWhiteboardPassword(newWbPw.trim());
    setNewWbPw('');
    setRefreshKey(k => k + 1);
    onToast(`✅ 전자칠판 비밀번호가 '${newWbPw.trim()}'(으)로 변경되었습니다.`);
  };

  // 관리자 비밀번호 변경
  const handleUpdateAdminPw = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminPw.trim() || newAdminPw.trim().length < 6) {
      onToast('⚠️ 관리자 비밀번호는 최소 6자리 이상이어야 합니다.');
      return;
    }
    setAdminPassword(newAdminPw.trim());
    setNewAdminPw('');
    setRefreshKey(k => k + 1);
    onToast('✅ 관리자 비밀번호가 성공적으로 변경되었습니다.');
  };

  const modifiedStudentCount = useMemo(() => {
    const customPws = getCustomPasswords();
    return allStudents.filter(s => Boolean(customPws[s.id])).length;
  }, [allStudents, refreshKey]);

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
              <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>
                통합 계정 & 비밀번호 관리 센터
              </h2>
              <span style={{ fontSize: '12.5px', color: '#94a3b8' }}>
                전자칠판, 선생님, 1101~3830 학생들의 모든 비밀번호를 한눈에 검색 및 수정합니다
              </span>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} style={{ fontSize: '18px' }}>✕</button>
        </div>

        {/* 상단 4대 메트릭 요약 배너 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', margin: '18px 0' }}>
          <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.25)', borderRadius: '12px', padding: '12px 14px' }}>
            <span style={{ fontSize: '11px', color: '#93c5fd', fontWeight: 600 }}>🖥️ 전자칠판 비밀번호</span>
            <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '4px', color: '#ffffff', letterSpacing: '1px' }}>
              {getWhiteboardPassword()}
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
              {allStudents.length} 명 (초기값: 1234)
            </div>
          </div>

          <div style={{ background: 'rgba(168, 85, 247, 0.1)', border: '1px solid rgba(168, 85, 247, 0.25)', borderRadius: '12px', padding: '12px 14px' }}>
            <span style={{ fontSize: '11px', color: '#d8b4fe', fontWeight: 600 }}>🔑 수정된 학생 비밀번호</span>
            <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '4px', color: '#ffffff' }}>
              {modifiedStudentCount} 건
            </div>
          </div>
        </div>

        {/* 탭 네비게이션 */}
        <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '10px' }}>
          {[
            { id: 'students', label: `👨‍🎓 학생 계정 관리 (${allStudents.length})` },
            { id: 'teachers', label: `👨‍🏫 선생님 계정 관리 (${allTeachers.length})` },
            { id: 'whiteboard', label: '🖥️ 전자칠판 비밀번호' },
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
                  { id: 'modified', label: `비번 수정됨 (${modifiedStudentCount})` }
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
                title="해당 학생들의 비밀번호를 모두 1234로 되돌립니다"
              >
                🔄 {gradeFilter === 'all' || gradeFilter === 'modified' ? '전체' : `${gradeFilter}학년`} 1234로 일괄초기화
              </button>
            </div>

            {/* 학생 계정 테이블 */}
            <div style={{ flex: 1, minHeight: '340px', maxHeight: '420px', overflowY: 'auto', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '12px', background: 'rgba(15, 23, 42, 0.4)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#1c202c', borderBottom: '1px solid rgba(255, 255, 255, 0.12)', zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '10px 14px', width: '90px' }}>학번</th>
                    <th style={{ padding: '10px 14px', width: '160px' }}>학생 정보</th>
                    <th style={{ padding: '10px 14px', width: '150px' }}>현재 비밀번호</th>
                    <th style={{ padding: '10px 14px', width: '100px' }}>상태</th>
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
                      const isVisible = visiblePasswords[student.id];
                      const isModified = student.updatedAt === '수정됨';

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
                                  onClick={() => handleSavePassword(student.id)}
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
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontFamily: 'monospace', fontSize: '14px', letterSpacing: isVisible ? '1px' : '3px', color: isModified ? '#facc15' : '#cbd5e1' }}>
                                  {isVisible ? student.passwordHash : '••••'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => togglePasswordVisibility(student.id)}
                                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '13px', padding: 0 }}
                                  title={isVisible ? '비밀번호 숨기기' : '비밀번호 보기'}
                                >
                                  {isVisible ? '🙈' : '👁️'}
                                </button>
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
                                background: isModified ? 'rgba(234, 179, 8, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                                color: isModified ? '#facc15' : '#94a3b8'
                              }}
                            >
                              {isModified ? '🔑 수정됨' : '초기값(1234)'}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: '6px' }}>
                              {!isEditing && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingAccountId(student.id);
                                    setEditPasswordInput(student.passwordHash);
                                  }}
                                  style={{
                                    background: 'rgba(59, 130, 246, 0.15)',
                                    border: '1px solid rgba(59, 130, 246, 0.3)',
                                    color: '#93c5fd',
                                    borderRadius: '6px',
                                    padding: '4px 8px',
                                    fontSize: '11.5px',
                                    cursor: 'pointer',
                                    fontWeight: 600
                                  }}
                                >
                                  ✏️ 수정
                                </button>
                              )}
                              {isModified && (
                                <button
                                  type="button"
                                  onClick={() => handleResetToDefault(student.id, student.name)}
                                  style={{
                                    background: 'rgba(239, 68, 68, 0.15)',
                                    border: '1px solid rgba(239, 68, 68, 0.3)',
                                    color: '#fca5a5',
                                    borderRadius: '6px',
                                    padding: '4px 8px',
                                    fontSize: '11.5px',
                                    cursor: 'pointer',
                                    fontWeight: 600
                                  }}
                                  title="1234로 초기화"
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

        {/* 탭 2: 선생님 계정 관리 (구글 드라이브 폴더 기반) */}
        {activeTab === 'teachers' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: '340px', marginTop: '14px' }}>
            <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', padding: '12px 14px', borderRadius: '12px', fontSize: '12.5px', color: '#93c5fd', marginBottom: '14px' }}>
              📁 <strong>선생님 폴더 자동 연동:</strong> 구글 드라이브 최상위에 생성된 폴더 이름이 곧 선생님 계정으로 자동 등록됩니다. (초기 비밀번호: <code>1234</code>)
            </div>

            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '12px', background: 'rgba(15, 23, 42, 0.4)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#1c202c', borderBottom: '1px solid rgba(255, 255, 255, 0.12)', zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '10px 14px' }}>선생님 이름 (폴더명)</th>
                    <th style={{ padding: '10px 14px' }}>계정 ID</th>
                    <th style={{ padding: '10px 14px' }}>현재 비밀번호</th>
                    <th style={{ padding: '10px 14px' }}>상태</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right' }}>관리 작업</th>
                  </tr>
                </thead>
                <tbody>
                  {allTeachers.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: '36px', textAlign: 'center', color: '#94a3b8' }}>
                        구글 드라이브에 생성된 선생님 폴더가 없습니다. (새로만들기로 폴더를 생성하면 자동 계정이 생성됩니다)
                      </td>
                    </tr>
                  ) : (
                    allTeachers.map(teacher => {
                      const isEditing = editingAccountId === teacher.id;
                      const isVisible = visiblePasswords[teacher.id];
                      const isModified = teacher.updatedAt === '수정됨';

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
                                  placeholder="새 비밀번호"
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
                                  onClick={() => handleSavePassword(teacher.id)}
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
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontFamily: 'monospace', fontSize: '14px', letterSpacing: isVisible ? '1px' : '3px', color: isModified ? '#facc15' : '#cbd5e1' }}>
                                  {isVisible ? teacher.passwordHash : '••••'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => togglePasswordVisibility(teacher.id)}
                                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '13px', padding: 0 }}
                                >
                                  {isVisible ? '🙈' : '👁️'}
                                </button>
                              </div>
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
                                background: isModified ? 'rgba(234, 179, 8, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                                color: isModified ? '#facc15' : '#94a3b8'
                              }}
                            >
                              {isModified ? '🔑 수정됨' : '초기값(1234)'}
                            </span>
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: '6px' }}>
                              {!isEditing && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingAccountId(teacher.id);
                                    setEditPasswordInput(teacher.passwordHash);
                                  }}
                                  style={{
                                    background: 'rgba(59, 130, 246, 0.15)',
                                    border: '1px solid rgba(59, 130, 246, 0.3)',
                                    color: '#93c5fd',
                                    borderRadius: '6px',
                                    padding: '4px 8px',
                                    fontSize: '11.5px',
                                    cursor: 'pointer',
                                    fontWeight: 600
                                  }}
                                >
                                  ✏️ 수정
                                </button>
                              )}
                              {isModified && (
                                <button
                                  type="button"
                                  onClick={() => handleResetToDefault(teacher.id, teacher.name)}
                                  style={{
                                    background: 'rgba(239, 68, 68, 0.15)',
                                    border: '1px solid rgba(239, 68, 68, 0.3)',
                                    color: '#fca5a5',
                                    borderRadius: '6px',
                                    padding: '4px 8px',
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
              🖥️ <strong>전자칠판 마스터 비밀번호:</strong> 전자칠판에서 한 번 입력하면 영구 유지되는 비밀번호입니다. (기본값: <code>tch1234</code>)
            </div>

            <div style={{ background: 'rgba(255, 255, 255, 0.04)', padding: '16px', borderRadius: '12px', marginBottom: '20px' }}>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>현재 전자칠판 비밀번호</span>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#38bdf8', marginTop: '4px', letterSpacing: '1px' }}>
                {getWhiteboardPassword()}
              </div>
            </div>

            <form onSubmit={handleUpdateWhiteboardPw} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
                  새 전자칠판 비밀번호 입력
                </label>
                <input
                  type="text"
                  value={newWbPw}
                  onChange={(e) => setNewWbPw(e.target.value)}
                  placeholder="예: tch1234, lbw2026"
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
                💾 전자칠판 비밀번호 저장
              </button>
            </form>
          </div>
        )}

        {/* 탭 4: 관리자 보안 설정 */}
        {activeTab === 'admin' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: '340px', marginTop: '14px', maxWidth: '520px' }}>
            <div style={{ background: 'rgba(234, 179, 8, 0.08)', border: '1px solid rgba(234, 179, 8, 0.25)', padding: '12px 14px', borderRadius: '12px', fontSize: '12.5px', color: '#fde047', marginBottom: '18px', lineHeight: 1.6 }}>
              🛡️ <strong>최고 관리자 계정 보안:</strong> 관리자 ID는 <code>admin</code>이며, 관리자 비밀번호를 변경할 수 있습니다. (기본값: <code>admin!@#$1234</code>)
            </div>

            <div style={{ background: 'rgba(255, 255, 255, 0.04)', padding: '16px', borderRadius: '12px', marginBottom: '20px' }}>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>현재 관리자 비밀번호</span>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#facc15', marginTop: '4px', letterSpacing: '1px' }}>
                {getAdminPassword()}
              </div>
            </div>

            <form onSubmit={handleUpdateAdminPw} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
                  새 관리자 비밀번호 입력 (6자리 이상)
                </label>
                <input
                  type="text"
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
                💾 관리자 비밀번호 변경 저장
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

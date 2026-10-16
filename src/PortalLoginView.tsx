import React, { useState } from 'react';
import {
  type UserRole,
  type UserSession,
  getWhiteboardPassword,
  getAdminPassword,
  getCustomPasswords,
  saveCustomPassword,
  setWhiteboardPermanentAuth,
  parseStudentId,
  setCurrentSession
} from './lib/auth';

interface PortalLoginViewProps {
  driveTeacherFolders: string[]; // 구글 드라이브에서 가져온 선생님 폴더 목록
  onLoginSuccess: (session: UserSession) => void;
}

export function PortalLoginView({ driveTeacherFolders, onLoginSuccess }: PortalLoginViewProps) {
  const [activeTab, setActiveTab] = useState<UserRole>('whiteboard');

  // 전자칠판 폼 상태
  const [wbPassword, setWbPassword] = useState('');
  const [wbRemember, setWbRemember] = useState(true);

  // 선생님 폼 상태
  const [teacherName, setTeacherName] = useState('');
  const [teacherPw, setTeacherPw] = useState('');
  const [isChangingTeacherPw, setIsChangingTeacherPw] = useState(false);
  const [newTeacherPw, setNewTeacherPw] = useState('');

  // 학생 폼 상태
  const [studentId, setStudentId] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentPw, setStudentPw] = useState('');
  const [isChangingStudentPw, setIsChangingStudentPw] = useState(false);
  const [newStudentPw, setNewStudentPw] = useState('');

  // 관리자 폼 상태
  const [adminId, setAdminId] = useState('admin');
  const [adminPw, setAdminPw] = useState('');

  // 공통 오류/성공 메시지
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // 1. 전자칠판 로그인 핸들러
  const handleWhiteboardLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const correctWbPw = getWhiteboardPassword();
    if (wbPassword !== correctWbPw) {
      setErrorMsg('❌ 전자칠판 비밀번호가 일치하지 않습니다.');
      return;
    }

    if (wbRemember) {
      setWhiteboardPermanentAuth(true);
    }

    const session: UserSession = {
      role: 'whiteboard',
      id: 'whiteboard',
      name: '전자칠판 (기본모드)'
    };
    setCurrentSession(session);
    onLoginSuccess(session);
  };

  // 2. 선생님 로그인 핸들러
  const handleTeacherLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    const cleanName = teacherName.trim();
    if (!cleanName) {
      setErrorMsg('⚠️ 선생님 이름을 입력하거나 선택해 주세요.');
      return;
    }

    const customPws = getCustomPasswords();
    const correctPw = customPws[`tch_${cleanName}`] || '1234';

    if (teacherPw !== correctPw) {
      setErrorMsg('❌ 비밀번호가 올바르지 않습니다. (초기 비밀번호: 1234)');
      return;
    }

    // 비밀번호 변경 요청이 있는 경우
    if (isChangingTeacherPw) {
      if (!newTeacherPw.trim() || newTeacherPw.trim().length < 4) {
        setErrorMsg('⚠️ 새 비밀번호는 4자리 이상이어야 합니다.');
        return;
      }
      saveCustomPassword(`tch_${cleanName}`, newTeacherPw.trim());
      setSuccessMsg('🎉 비밀번호가 성공적으로 변경되었습니다!');
    }

    const session: UserSession = {
      role: 'teacher',
      id: `tch_${cleanName}`,
      name: `${cleanName} 선생님`
    };
    setCurrentSession(session);
    onLoginSuccess(session);
  };

  // 3. 학생 로그인 핸들러 (1101 ~ 3830)
  const studentParsed = parseStudentId(studentId);

  const handleStudentLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!studentParsed.valid) {
      setErrorMsg('⚠️ 올바른 4자리 학번을 입력하세요 (예: 1101 ~ 3830, 1학년 1반 1번 = 1101)');
      return;
    }

    const cleanName = studentName.trim() || `${studentParsed.grade}-${studentParsed.classNum} ${studentParsed.studentNum}번`;
    const customPws = getCustomPasswords();
    const correctPw = customPws[studentId.trim()] || '1234';

    if (studentPw !== correctPw) {
      setErrorMsg('❌ 비밀번호가 일치하지 않습니다. (초기 비밀번호: 1234)');
      return;
    }

    // 비밀번호 변경 요청
    if (isChangingStudentPw) {
      if (!newStudentPw.trim() || newStudentPw.trim().length < 4) {
        setErrorMsg('⚠️ 새 비밀번호는 4자리 이상이어야 합니다.');
        return;
      }
      saveCustomPassword(studentId.trim(), newStudentPw.trim());
      setSuccessMsg('🎉 비밀번호가 변경되었습니다!');
    }

    // 학생 브라우저 로컬 스토리지에 정보 영구 저장
    localStorage.setItem(
      'lbw_student_info',
      JSON.stringify({
        grade: studentParsed.grade,
        classNum: studentParsed.classNum,
        studentNum: studentParsed.studentNum,
        name: cleanName
      })
    );

    const session: UserSession = {
      role: 'student',
      id: studentId.trim(),
      name: cleanName,
      grade: studentParsed.grade,
      classNum: studentParsed.classNum,
      studentNum: studentParsed.studentNum
    };
    setCurrentSession(session);
    onLoginSuccess(session);
  };

  // 4. 관리자 로그인 핸들러
  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const correctAdminPw = getAdminPassword();

    if (adminId.trim() !== 'admin' || adminPw !== correctAdminPw) {
      setErrorMsg('❌ 관리자 아이디 또는 비밀번호가 일치하지 않습니다.');
      return;
    }

    const session: UserSession = {
      role: 'admin',
      id: 'admin',
      name: '시스템 최고 관리자'
    };
    setCurrentSession(session);
    onLoginSuccess(session);
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(circle at 50% 20%, #1f293d 0%, #0f1319 70%, #090b0e 100%)',
      padding: '20px',
      fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      color: '#ffffff'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '480px',
        background: 'rgba(28, 32, 42, 0.75)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '24px',
        padding: '36px 32px',
        boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* 상단 장식 빛 */}
        <div style={{
          position: 'absolute',
          top: '-60px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '260px',
          height: '120px',
          background: 'radial-gradient(ellipse at center, rgba(59, 130, 246, 0.35), transparent 70%)',
          pointerEvents: 'none'
        }} />

        {/* 서비스 타이틀 */}
        <div style={{ textAlign: 'center', marginBottom: '28px', position: 'relative' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '56px',
            height: '56px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
            boxShadow: '0 8px 24px rgba(59, 130, 246, 0.4)',
            fontSize: '28px',
            marginBottom: '14px'
          }}>
            🏫
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, margin: '0 0 6px 0', letterSpacing: '-0.02em' }}>
            스마트 전자칠판 포털
          </h1>
          <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
            원하시는 사용자 역할을 선택하여 로그인하세요
          </p>
        </div>

        {/* 4대 역할 탭 셀렉터 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          background: 'rgba(15, 23, 42, 0.6)',
          padding: '4px',
          borderRadius: '14px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          marginBottom: '24px'
        }}>
          {[
            { role: 'whiteboard', label: '전자칠판', icon: '🖥️' },
            { role: 'teacher', label: '선생님', icon: '👨‍🏫' },
            { role: 'student', label: '학생', icon: '👨‍🎓' },
            { role: 'admin', label: '관리자', icon: '🛡️' }
          ].map(tab => {
            const isActive = activeTab === tab.role;
            return (
              <button
                key={tab.role}
                type="button"
                onClick={() => {
                  setActiveTab(tab.role as UserRole);
                  setErrorMsg(null);
                  setSuccessMsg(null);
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: '8px 4px',
                  borderRadius: '10px',
                  border: 'none',
                  background: isActive ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)' : 'transparent',
                  color: isActive ? '#ffffff' : '#94a3b8',
                  fontSize: '11.5px',
                  fontWeight: isActive ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: isActive ? '0 4px 12px rgba(37, 99, 235, 0.35)' : 'none'
                }}
              >
                <span style={{ fontSize: '16px', marginBottom: '2px' }}>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* 에러 / 성공 메시지 표시 */}
        {errorMsg && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#fca5a5',
            padding: '10px 14px',
            borderRadius: '10px',
            fontSize: '12.5px',
            marginBottom: '18px',
            textAlign: 'center'
          }}>
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div style={{
            background: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            color: '#86efac',
            padding: '10px 14px',
            borderRadius: '10px',
            fontSize: '12.5px',
            marginBottom: '18px',
            textAlign: 'center'
          }}>
            {successMsg}
          </div>
        )}

        {/* 탭 1: 전자칠판 로그인 (tch1234 -> 영구 유지) */}
        {activeTab === 'whiteboard' && (
          <form onSubmit={handleWhiteboardLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', padding: '12px 14px', borderRadius: '12px', fontSize: '12px', color: '#93c5fd', lineHeight: 1.5 }}>
              💡 <strong>전자칠판 모드:</strong> 교실 칠판용 간편 접속입니다. 한 번 비밀번호를 입력하면 영구 유지되어 매번 다시 묻지 않습니다. (기본 비번: <code>tch1234</code>)
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
                전자칠판 접속 비밀번호
              </label>
              <input
                type="password"
                value={wbPassword}
                onChange={(e) => setWbPassword(e.target.value)}
                placeholder="기본 비밀번호: tch1234"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(15, 23, 42, 0.6)',
                  color: '#ffffff',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
                autoFocus
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: '#94a3b8', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={wbRemember}
                onChange={(e) => setWbRemember(e.target.checked)}
                style={{ accentColor: '#3b82f6', width: '16px', height: '16px' }}
              />
              이 전자칠판 브라우저에서 영구 로그인 유지
            </label>

            <button
              type="submit"
              style={{
                marginTop: '8px',
                padding: '13px',
                borderRadius: '12px',
                border: 'none',
                background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                color: '#ffffff',
                fontSize: '14px',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 8px 20px rgba(59, 130, 246, 0.4)'
              }}
            >
              🖥️ 전자칠판 시작하기
            </button>
          </form>
        )}

        {/* 탭 2: 선생님 로그인 (구글드라이브 폴더명 기반 자동 계정, 초기 비번: 1234) */}
        {activeTab === 'teacher' && (
          <form onSubmit={handleTeacherLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', padding: '10px 14px', borderRadius: '12px', fontSize: '12px', color: '#93c5fd', lineHeight: 1.5 }}>
              📂 <strong>선생님 계정:</strong> 구글 드라이브의 선생님 폴더 이름으로 자동 계정이 생성됩니다. (초기 비번: <code>1234</code>)
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
                선생님 이름 (구글 드라이브 폴더명)
              </label>
              {driveTeacherFolders && driveTeacherFolders.length > 0 ? (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <select
                    value={teacherName}
                    onChange={(e) => setTeacherName(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '12px 14px',
                      borderRadius: '12px',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      background: 'rgba(15, 23, 42, 0.6)',
                      color: '#ffffff',
                      fontSize: '13px',
                      outline: 'none'
                    }}
                  >
                    <option value="">선생님 폴더 선택 (또는 직접 입력)</option>
                    {driveTeacherFolders.map(folder => (
                      <option key={folder} value={folder} style={{ background: '#1e293b' }}>
                        📁 {folder} 선생님
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={teacherName}
                    onChange={(e) => setTeacherName(e.target.value)}
                    placeholder="직접 입력"
                    style={{
                      width: '120px',
                      padding: '12px 10px',
                      borderRadius: '12px',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      background: 'rgba(15, 23, 42, 0.6)',
                      color: '#ffffff',
                      fontSize: '13px',
                      outline: 'none'
                    }}
                  />
                </div>
              ) : (
                <input
                  type="text"
                  value={teacherName}
                  onChange={(e) => setTeacherName(e.target.value)}
                  placeholder="예: 홍길동 (드라이브 폴더 이름)"
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    background: 'rgba(15, 23, 42, 0.6)',
                    color: '#ffffff',
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                  autoFocus
                />
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
                비밀번호
              </label>
              <input
                type="password"
                value={teacherPw}
                onChange={(e) => setTeacherPw(e.target.value)}
                placeholder="초기 비밀번호: 1234"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(15, 23, 42, 0.6)',
                  color: '#ffffff',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {/* 비밀번호 변경 토글 */}
            <div style={{ borderTop: '1px dashed rgba(255,255,255,0.1)', paddingTop: '10px' }}>
              <button
                type="button"
                onClick={() => setIsChangingTeacherPw(!isChangingTeacherPw)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#60a5fa',
                  fontSize: '12px',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <span>{isChangingTeacherPw ? '▲ 비밀번호 변경 취소' : '🔑 비밀번호 변경하기'}</span>
              </button>

              {isChangingTeacherPw && (
                <div style={{ marginTop: '8px' }}>
                  <input
                    type="password"
                    value={newTeacherPw}
                    onChange={(e) => setNewTeacherPw(e.target.value)}
                    placeholder="새 비밀번호 입력 (4자리 이상)"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '10px',
                      border: '1px solid rgba(96, 165, 250, 0.4)',
                      background: 'rgba(15, 23, 42, 0.8)',
                      color: '#ffffff',
                      fontSize: '13px',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              )}
            </div>

            <button
              type="submit"
              style={{
                marginTop: '6px',
                padding: '13px',
                borderRadius: '12px',
                border: 'none',
                background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                color: '#ffffff',
                fontSize: '14px',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 8px 20px rgba(59, 130, 246, 0.4)'
              }}
            >
              👨‍🏫 선생님 로그인
            </button>
          </form>
        )}

        {/* 탭 3: 학생 로그인 (1101 ~ 3830, 초기 비번: 1234) */}
        {activeTab === 'student' && (
          <form onSubmit={handleStudentLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', padding: '10px 14px', borderRadius: '12px', fontSize: '12px', color: '#93c5fd', lineHeight: 1.5 }}>
              🎒 <strong>학생 계정:</strong> 1101(1학년 1반 1번)부터 3830(3학년 8반 30번)까지 숫자로만 입력합니다. (초기 비번: <code>1234</code>)
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 600 }}>
                  학번 (4자리 숫자)
                </label>
                {studentParsed.valid && (
                  <span style={{ fontSize: '11.5px', color: '#86efac', fontWeight: 600 }}>
                    ✓ {studentParsed.label}
                  </span>
                )}
              </div>
              <input
                type="text"
                maxLength={4}
                value={studentId}
                onChange={(e) => setStudentId(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="예: 1101, 2315, 3830"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  border: studentParsed.valid ? '1px solid #22c55e' : '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(15, 23, 42, 0.6)',
                  color: '#ffffff',
                  fontSize: '15px',
                  fontWeight: 600,
                  letterSpacing: '1px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
                autoFocus
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
                학생 이름
              </label>
              <input
                type="text"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="예: 홍길동"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(15, 23, 42, 0.6)',
                  color: '#ffffff',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
                비밀번호
              </label>
              <input
                type="password"
                value={studentPw}
                onChange={(e) => setStudentPw(e.target.value)}
                placeholder="초기 비밀번호: 1234"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(15, 23, 42, 0.6)',
                  color: '#ffffff',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {/* 학생 비밀번호 변경 토글 */}
            <div style={{ borderTop: '1px dashed rgba(255,255,255,0.1)', paddingTop: '10px' }}>
              <button
                type="button"
                onClick={() => setIsChangingStudentPw(!isChangingStudentPw)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#60a5fa',
                  fontSize: '12px',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <span>{isChangingStudentPw ? '▲ 비밀번호 변경 취소' : '🔑 비밀번호 변경하기'}</span>
              </button>

              {isChangingStudentPw && (
                <div style={{ marginTop: '8px' }}>
                  <input
                    type="password"
                    value={newStudentPw}
                    onChange={(e) => setNewStudentPw(e.target.value)}
                    placeholder="새 비밀번호 입력 (4자리 이상)"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '10px',
                      border: '1px solid rgba(96, 165, 250, 0.4)',
                      background: 'rgba(15, 23, 42, 0.8)',
                      color: '#ffffff',
                      fontSize: '13px',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              )}
            </div>

            <button
              type="submit"
              style={{
                marginTop: '6px',
                padding: '13px',
                borderRadius: '12px',
                border: 'none',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: '#ffffff',
                fontSize: '14px',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 8px 20px rgba(16, 185, 129, 0.4)'
              }}
            >
              👨‍🎓 학생 수업 참여하기
            </button>
          </form>
        )}

        {/* 탭 4: 관리자 로그인 (admin / admin!@#$1234) */}
        {activeTab === 'admin' && (
          <form onSubmit={handleAdminLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.25)', padding: '10px 14px', borderRadius: '12px', fontSize: '12px', color: '#fde047', lineHeight: 1.5 }}>
              🛡️ <strong>시스템 최고 관리자:</strong> 전자칠판, 선생님, 720개 학생 계정의 모든 비밀번호를 한눈에 검색하고 수정/초기화할 수 있습니다.
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
                관리자 아이디
              </label>
              <input
                type="text"
                value={adminId}
                onChange={(e) => setAdminId(e.target.value)}
                placeholder="admin"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(15, 23, 42, 0.6)',
                  color: '#ffffff',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
                관리자 비밀번호
              </label>
              <input
                type="password"
                value={adminPw}
                onChange={(e) => setAdminPw(e.target.value)}
                placeholder="admin!@#$1234"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(15, 23, 42, 0.6)',
                  color: '#ffffff',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
                autoFocus
              />
            </div>

            <button
              type="submit"
              style={{
                marginTop: '10px',
                padding: '13px',
                borderRadius: '12px',
                border: 'none',
                background: 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)',
                color: '#1e293b',
                fontSize: '14px',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 8px 20px rgba(234, 179, 8, 0.4)'
              }}
            >
              🛡️ 관리자 대시보드 열기
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

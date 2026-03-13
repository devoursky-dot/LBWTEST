/*
# 기존 패키지 삭제
npm uninstall pdfjs-dist

# 저사양 기기용 안정 버전 설치
npm install pdfjs-dist@2.16.105

버전을 반드시 맞추고 실행해야한다는 것을 항상 체크해주세요
*/
import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

// ============================================================================
// [1] 환경 설정 (Supabase 시그널링 서버)
// 실제 프로젝트에서는 .env 파일로 빼는 것이 좋습니다. 테스트용으로 여기에 직접 입력하세요.
// ============================================================================
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://pfaxpqkmnrpocuamtnot.supabase.co';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_qbInPtEifr7EmUgn8NjhRw_F1jBdsNm';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 파일 조각(Chunk) 크기: 64KB (저사양 전자칠판 메모리 과부하 방지 최적값)
const CHUNK_SIZE = 64 * 1024; 

export default function FileTransferApp() {
  // --- UI 상태 관리 ---
  const [roomId, setRoomId] = useState<string>('');
  const [role, setRole] = useState<'host' | 'guest' | null>(null);
  const [status, setStatus] = useState<string>('방 번호를 입력하고 역할을 선택하세요.');
  const [networkType, setNetworkType] = useState<string>('연결 대기 중...');
  const [progress, setProgress] = useState<number>(0);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [transferMetrics, setTransferMetrics] = useState<{ speed: string; eta: string }>({ speed: '0 KB/s', eta: '' });
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState<boolean>(false);

  // --- WebRTC 및 파일 처리 Ref ---
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const channelSubRef = useRef<any>(null); // Supabase 구독 취소용

  // --- 수신용 버퍼 (Guest 전용) ---
  const receiveBufferRef = useRef<ArrayBuffer[]>([]);
  const receivedSizeRef = useRef<number>(0);
  const fileMetaRef = useRef<{ name: string; size: number } | null>(null);
  const transferStartRef = useRef<number>(0);

  const addLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugLogs(prev => [`[${timestamp}] ${msg}`, ...prev]);
    console.log(`[DEBUG] ${msg}`);
  };

  // 컴포넌트 마운트 시 공용 IP를 가져와 기본 방 이름으로 설정 (같은 학교 필터링)
  useEffect(() => {
    fetch('https://api.ipify.org?format=json')
      .then(res => res.json())
      .then(data => setRoomId(data.ip.replace(/\./g, '_')))
      .catch(() => setRoomId('local-room-1'));
      
    // 언마운트 시 정리
    return () => {
      pcRef.current?.close();
      channelSubRef.current?.unsubscribe();
    };
  }, []);

  // ============================================================================
  // [2] WebRTC 초기화 및 시그널링 로직
  // ============================================================================
  const initWebRTC = async (isHost: boolean) => {
    if (!roomId) return alert('방 번호를 입력해주세요.');
    setRole(isHost ? 'host' : 'guest');
    setStatus('시그널링 서버 연결 중...');
    addLog(`WebRTC 초기화 시작 (역할: ${isHost ? 'Host' : 'Guest'}, 방: ${roomId})`);

    // 1. RTCPeerConnection 생성 (구글 무료 STUN 서버 장착)
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    pcRef.current = pc;
    addLog('RTCPeerConnection 객체 생성됨');

    // 2. 망 이원화 자동 감지 (Local vs STUN vs TURN)
    pc.onconnectionstatechange = async () => {
      addLog(`연결 상태 변경: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        setIsConnected(true);
        setStatus('✅ P2P 연결 성공!');
        
        // 어떤 망으로 연결되었는지 분석
        const stats = await pc.getStats();
        stats.forEach(report => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            const local = stats.get(report.localCandidateId);
            if (local?.candidateType === 'host') setNetworkType('🟢 로컬 네트워크 (초고속/직접연결)');
            else if (local?.candidateType === 'relay') setNetworkType('🔴 외부 릴레이망 (저속/TURN 우회)');
            else setNetworkType('🔵 외부 인터넷망 (일반/STUN 연결)');
          }
        });
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setIsConnected(false);
        setStatus('❌ 연결이 끊어졌습니다.');
        setNetworkType('연결 끊김');
      }
    };

    pc.oniceconnectionstatechange = () => {
      addLog(`ICE 연결 상태: ${pc.iceConnectionState}`);
    };

    pc.onsignalingstatechange = () => {
      addLog(`시그널링 상태: ${pc.signalingState}`);
    };

    // 3. ICE Candidate 생성 시 상대방에게 전송
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        addLog(`ICE Candidate 생성됨: ${candidate.candidate.substring(0, 40)}...`);
        sendSignal({ type: 'candidate', candidate, sender: isHost ? 'host' : 'guest' });
      }
    };

    // 4. 데이터 채널 설정
    if (isHost) {
      // Host: 채널 생성
      addLog('데이터 채널 생성 중...');
      const channel = pc.createDataChannel('fileTransfer');
      setupDataChannel(channel);
    } else {
      // Guest: 채널 수신 대기
      pc.ondatachannel = (event) => setupDataChannel(event.channel);
    }

    // 5. Supabase를 통한 실시간 시그널링(Offer/Answer) 구독
    const channel = supabase.channel(`room_${roomId}`);
    channelSubRef.current = channel;

    channel.on('broadcast', { event: 'webrtc-signal' }, async (payload) => {
      const signal = payload.payload;
      if (signal.sender === (isHost ? 'host' : 'guest')) return; // 내가 보낸 건 무시

      addLog(`시그널 수신: ${signal.type} (보낸이: ${signal.sender})`);

      try {
        if (signal.type === 'offer' && !isHost) {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.offer));
          addLog('Remote Offer 설정 완료');
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          addLog('Local Answer 생성 및 설정 완료');
          sendSignal({ type: 'answer', answer, sender: 'guest' });
        } else if (signal.type === 'answer' && isHost) {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.answer));
          addLog('Remote Answer 설정 완료');
        } else if (signal.type === 'candidate') {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          addLog('ICE Candidate 추가 완료');
        }
      } catch (err) {
        addLog(`시그널링 처리 오류: ${err}`);
      }
    }).subscribe(async (status) => {
      addLog(`Supabase 채널 상태: ${status}`);
      if (status === 'SUBSCRIBED') {
        setStatus('채널 입장 완료. 상대방을 기다립니다...');
        // Host가 먼저 Offer를 생성하여 전송
        if (isHost) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          addLog('Local Offer 생성 및 설정 완료');
          sendSignal({ type: 'offer', offer, sender: 'host' });
        }
      }
    });

    const sendSignal = (data: any) => {
      channel.send({ type: 'broadcast', event: 'webrtc-signal', payload: data });
    };
  };

  // ============================================================================
  // [3] 파일 송수신 코어 로직
  // ============================================================================
  
  // 데이터 채널 이벤트 연결
  const setupDataChannel = (channel: RTCDataChannel) => {
    channel.binaryType = 'arraybuffer';
    channelRef.current = channel;

    channel.onopen = () => {
      addLog('데이터 채널 열림 (Open)');
    };

    channel.onclose = () => {
      addLog('데이터 채널 닫힘 (Closed)');
    };

    channel.onerror = (err) => {
      addLog(`데이터 채널 오류: ${err}`);
    };

    channel.onmessage = (event) => {
      const data = event.data;
      if (typeof data === 'string') {
        const msg = JSON.parse(data);
        if (msg.type === 'meta') {
          fileMetaRef.current = msg;
          receiveBufferRef.current = [];
          receivedSizeRef.current = 0;
          transferStartRef.current = Date.now();
          setProgress(0);
          setStatus(`파일 수신 중: ${msg.name}`);
          addLog(`파일 메타데이터 수신: ${msg.name} (${msg.size} bytes)`);
        } else if (msg.type === 'end') {
          saveReceivedFile();
        }
      } else {
        // 바이너리 데이터(조각) 수신
        receiveBufferRef.current.push(data);
        receivedSizeRef.current += data.byteLength;
        
        // 속도 계산 (수신측)
        const now = Date.now();
        const duration = (now - transferStartRef.current) / 1000;
        if (duration > 0.5) {
          const bps = receivedSizeRef.current / duration;
          const speedStr = bps > 1024 * 1024 
            ? `${(bps / (1024 * 1024)).toFixed(2)} MB/s` 
            : `${(bps / 1024).toFixed(2)} KB/s`;
          setTransferMetrics({ speed: speedStr, eta: '' });
        }

        if (fileMetaRef.current) {
          const percent = Math.round((receivedSizeRef.current / fileMetaRef.current.size) * 100);
          setProgress(percent);
        }
      }
    };
  };

  // 수신 완료된 파일 브라우저에서 다운로드 처리 및 메모리 해제
  const saveReceivedFile = () => {
    if (!fileMetaRef.current) return;
    const blob = new Blob(receiveBufferRef.current);
    receiveBufferRef.current = []; // Blob 생성 직후 버퍼 비우기 (메모리 확보)
    addLog(`파일 수신 완료. Blob 생성됨 (${blob.size} bytes)`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileMetaRef.current.name;
    a.click();
    
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
    
    setStatus('다운로드 완료!');
    setTransferMetrics({ speed: '0 KB/s', eta: '' });
  };

  // 파일 보내기 로직 (발신자)
  const handleSendFile = () => {
    const file = fileInputRef.current?.files?.[0];
    const channel = channelRef.current;
    if (!file || !channel || channel.readyState !== 'open') return alert('연결이 안되었거나 파일이 없습니다.');

    const reader = new FileReader();
    let offset = 0;

    setStatus(`파일 전송 시작: ${file.name}`);
    addLog(`파일 전송 시작: ${file.name} (${file.size} bytes)`);
    transferStartRef.current = Date.now();
    channel.send(JSON.stringify({ type: 'meta', name: file.name, size: file.size }));

    reader.onload = (e) => {
      if (!e.target?.result) return;
      channel.send(e.target.result as ArrayBuffer);
      offset += (e.target.result as ArrayBuffer).byteLength;
      setProgress(Math.round((offset / file.size) * 100));

      // 속도 계산 (발신측)
      const now = Date.now();
      const duration = (now - transferStartRef.current) / 1000;
      if (duration > 0.5) {
        const bps = offset / duration;
        const speedStr = bps > 1024 * 1024 
          ? `${(bps / (1024 * 1024)).toFixed(2)} MB/s` 
          : `${(bps / 1024).toFixed(2)} KB/s`;
        setTransferMetrics({ speed: speedStr, eta: '' });
      }

      if (offset < file.size) {
        // 백프레셔 처리: 버퍼가 1MB 이상이면 100ms 대기 (저사양 기기 안정성 강화)
        if (channel.bufferedAmount > 1024 * 1024) {
          setTimeout(readSlice, 100);
        } else {
          readSlice();
        }
      } else {
        channel.send(JSON.stringify({ type: 'end' }));
        setStatus('전송 완료!');
        setTransferMetrics({ speed: '0 KB/s', eta: '' });
        addLog('파일 전송 완료 신호 보냄');
      }
    };

    const readSlice = () => {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    };
    
    readSlice(); // 첫 조각 전송 시작
  };

  const copyLogs = () => {
    const text = debugLogs.join('\n');
    navigator.clipboard.writeText(text);
    alert('로그가 복사되었습니다.');
  };

  // ============================================================================
  // [4] 메인 UI 렌더링
  // ============================================================================
  return (
    <div style={{ maxWidth: '600px', margin: '40px auto', padding: '20px', fontFamily: 'sans-serif', backgroundColor: '#f9f9f9', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
      <h2 style={{ textAlign: 'center', color: '#333' }}>⚡ P2P 듀얼망 파일 전송기</h2>
      
      <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #ddd' }}>
        <label style={{ fontWeight: 'bold' }}>방 번호 (같은 학교/교실끼리 맞추세요): </label>
        <input 
          type="text" 
          value={roomId} 
          onChange={(e) => setRoomId(e.target.value)}
          disabled={role !== null}
          style={{ width: '100%', padding: '8px', marginTop: '8px', boxSizing: 'border-box' }}
        />
      </div>

      {!role ? (
        <div style={{ display: 'flex', gap: '10px' }}>
          <button 
            onClick={() => initWebRTC(true)}
            style={{ flex: 1, padding: '15px', fontSize: '16px', backgroundColor: '#007BFF', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
            📤 서버 되기 (보내기)
          </button>
          <button 
            onClick={() => initWebRTC(false)}
            style={{ flex: 1, padding: '15px', fontSize: '16px', backgroundColor: '#28A745', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
            📥 클라이언트 (받기)
          </button>
        </div>
      ) : (
        <div style={{ padding: '20px', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #ddd' }}>
          <h3 style={{ marginTop: 0 }}>역할: {role === 'host' ? '서버 (발신)' : '클라이언트 (수신)'}</h3>
          <p><strong>상태:</strong> {status}</p>
          <p><strong>망 타입:</strong> <span style={{ fontWeight: 'bold', color: isConnected ? 'green' : 'red' }}>{networkType}</span></p>

          <button 
            onClick={() => setShowDebug(true)}
            style={{ padding: '5px 10px', fontSize: '12px', cursor: 'pointer', marginBottom: '10px', backgroundColor: '#f0f0f0', border: '1px solid #ccc', borderRadius: '4px' }}>
            🔍 디버깅 로그 보기
          </button>

          {role === 'host' && isConnected && (
            <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#eef', borderRadius: '8px' }}>
              <input type="file" ref={fileInputRef} style={{ display: 'block', marginBottom: '10px' }} />
              <button 
                onClick={handleSendFile}
                style={{ padding: '10px 20px', backgroundColor: '#007BFF', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
                파일 전송 시작
              </button>
            </div>
          )}

          <div style={{ marginTop: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
              <span>진행률 ({transferMetrics.speed})</span>
              <span>{progress}%</span>
            </div>
            <div style={{ width: '100%', backgroundColor: '#eee', borderRadius: '4px', height: '20px', overflow: 'hidden' }}>
              <div style={{ width: `${progress}%`, height: '100%', backgroundColor: '#28A745', transition: 'width 0.2s' }}></div>
            </div>
          </div>
        </div>
      )}

      {/* 디버깅 팝업 */}
      {showDebug && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000
        }}>
          <div style={{
            width: '90%', maxWidth: '500px', backgroundColor: '#fff', padding: '20px', borderRadius: '8px', maxHeight: '80%', display: 'flex', flexDirection: 'column'
          }}>
            <h3 style={{ marginTop: 0 }}>🛠️ 디버깅 로그</h3>
            <div style={{ flex: 1, overflowY: 'auto', background: '#222', color: '#0f0', padding: '10px', fontFamily: 'monospace', fontSize: '12px', borderRadius: '4px', marginBottom: '15px' }}>
              {debugLogs.length === 0 ? '로그가 없습니다.' : debugLogs.map((log, i) => <div key={i}>{log}</div>)}
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={copyLogs} style={{ flex: 1, padding: '10px', cursor: 'pointer', backgroundColor: '#007BFF', color: '#fff', border: 'none', borderRadius: '4px' }}>
                📋 로그 복사
              </button>
              <button onClick={() => setShowDebug(false)} style={{ flex: 1, padding: '10px', cursor: 'pointer', backgroundColor: '#6c757d', color: '#fff', border: 'none', borderRadius: '4px' }}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
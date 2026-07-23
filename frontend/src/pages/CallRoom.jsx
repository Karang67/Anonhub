/**
 * @file CallRoom.jsx
 * @description Dedicated, full-screen real-time Video Call & Screen Sharing room.
 * Features WebRTC mesh grid, glassmorphism controls, integrated text chat sidebar,
 * live user roster, and secure access-key gating overlay.
 *
 * Architecture:
 * - WebRTC mesh: peer connections via Socket.IO signaling on the existing room socket.
 * - Signaling events: webrtc-join-call, webrtc-leave-call, webrtc-user-joined,
 *   webrtc-user-left, webrtc-signal (same as WebRTCCallWidget protocol).
 * - Chat events: 'send chat message', 'chat message' (same as ChatRoom protocol).
 * - Access gating: Loads access key from sessionStorage/cookie; shows AccessKeyModal
 *   if missing or rejected.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Video, VideoOff, Mic, MicOff, MonitorUp, PhoneOff,
  Users, MessageSquare, X, Send, ChevronRight, Home
} from 'lucide-react';
import { initSocket, getCookie, setCookie } from '../services/socket';
import AccessKeyModal from '../components/AccessKeyModal';
import './CallRoom.css';

// ─── WebRTC ICE configuration ─────────────────────────────────────────────────
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelay',
      credential: 'openrelay'
    }
  ]
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length > 1
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name[0].toUpperCase();
}

// ─── Remote Video Tile ────────────────────────────────────────────────────────
function RemoteVideoTile({ peer, micMutedMap }) {
  const videoRef = useRef(null);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    const stream = peer.stream;
    const videoEl = videoRef.current;

    const checkVideoTrack = () => {
      if (stream) {
        const vTracks = stream.getVideoTracks();
        const active = vTracks.some(t => t.enabled && t.readyState === 'live');
        setHasVideo(active);
      } else {
        setHasVideo(false);
      }
    };

    const attachStream = () => {
      if (videoEl && stream) {
        if (videoEl.srcObject !== stream) {
          videoEl.srcObject = stream;
        }
        videoEl.play().catch(() => {});
      }
      checkVideoTrack();
    };

    attachStream();

    if (stream) {
      stream.addEventListener('addtrack', attachStream);
      stream.addEventListener('removetrack', attachStream);
    }

    return () => {
      if (stream) {
        stream.removeEventListener('addtrack', attachStream);
        stream.removeEventListener('removetrack', attachStream);
      }
    };
  }, [peer.stream]);

  const isMuted = micMutedMap?.[peer.socketId];

  return (
    <div className="callroom-video-tile remote-tile" style={{ position: 'relative' }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: hasVideo ? 'block' : 'none',
          background: '#0d0f1a',
          position: 'absolute',
          inset: 0,
        }}
      />
      {!hasVideo && (
        <div className="callroom-video-avatar" style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', background: '#0d0f1a' }}>
          <div className="callroom-avatar-circle">{getInitials(peer.username)}</div>
          <div className="callroom-avatar-name">{peer.username}</div>
        </div>
      )}
      <div className="callroom-participant-badge" style={{ zIndex: 3 }}>
        <span className={`callroom-mic-indicator ${isMuted ? 'muted' : ''}`}>
          {isMuted ? <MicOff size={10} /> : <Mic size={10} />}
        </span>
        {peer.username}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CallRoom() {
  const { roomName } = useParams();
  const navigate = useNavigate();

  // ── Auth state ──────────────────────────────────────────────────────────────
  const [isAuthed, setIsAuthed] = useState(false);
  const [authError, setAuthError] = useState('');
  const [username, setUsername] = useState('');

  // ── Socket / connection ──────────────────────────────────────────────────────
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected'); // connected | reconnecting | reconnection-failed

  // ── WebRTC ───────────────────────────────────────────────────────────────────
  const [inCall, setInCall] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [peers, setPeers] = useState([]); // [{ socketId, username, stream }]
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const peersRef = useRef({});    // { socketId: RTCPeerConnection }
  const streamsRef = useRef({});   // { socketId: MediaStream }
  const screenStreamRef = useRef(null);
  const candidateQueues = useRef({}); // { socketId: [RTCIceCandidate] }

  // ── Attach local stream via ref callback — fires the moment the DOM node mounts ─
  const localVideoRefCallback = useCallback((node) => {
    localVideoRef.current = node;
    if (node && localStreamRef.current) {
      node.srcObject = localStreamRef.current;
    }
  }, []);

  // ── Chat sidebar ─────────────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // ── Roster ───────────────────────────────────────────────────────────────────
  const [roster, setRoster] = useState([]); // [{ socketId, username }]
  const [micMutedMap, setMicMutedMap] = useState({}); // { socketId: boolean }

  // ─── Auth on mount ────────────────────────────────────────────────────────────
  useEffect(() => {
    const tryAutoAuth = async () => {
      const savedKey = sessionStorage.getItem(`accesskey_project_${roomName}`) ||
        getCookie(`accesskey_project_${roomName}`);
      if (!savedKey) return;

      try {
        const res = await fetch('/create-project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: roomName, accessKey: savedKey })
        });
        if (res.ok) {
          const data = await res.json();
          const uname = sessionStorage.getItem('anonhub-username') || getCookie('anonhub-username') || 'Anonymous';
          setUsername(uname);
          if (data.ownerToken) localStorage.setItem(`owner_token_${roomName}`, data.ownerToken);
          setIsAuthed(true);
        }
      } catch {
        // Fall through to show modal
      }
    };
    tryAutoAuth();
  }, [roomName]);

  // ─── Manual auth ─────────────────────────────────────────────────────────────
  const handleAuthSubmit = async (rName, accessKey) => {
    setAuthError('');
    try {
      const res = await fetch('/create-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: rName, accessKey })
      });
      const data = await res.json();
      if (res.ok) {
        sessionStorage.setItem(`accesskey_project_${rName}`, accessKey);
        setCookie(`accesskey_project_${rName}`, accessKey);
        setCookie(`anonhub-active-call-room`, rName);
        if (data.ownerToken) localStorage.setItem(`owner_token_${rName}`, data.ownerToken);
        const uname = sessionStorage.getItem('anonhub-username') || getCookie('anonhub-username') || 'Anonymous';
        setUsername(uname);
        setIsAuthed(true);
      } else {
        setAuthError(data.error || 'Invalid access key or room name.');
      }
    } catch {
      setAuthError('Network error. Please try again.');
    }
  };

  // ─── Create peer connection ───────────────────────────────────────────────────
  const createPeerConnection = (peerSocketId, peerName, isInitiator, socket) => {
    const pc = new RTCPeerConnection(RTC_CONFIG);

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('webrtc-signal', { targetId: peerSocketId, signal: { candidate: event.candidate } });
      }
    };

    pc.ontrack = (event) => {
      if (!streamsRef.current[peerSocketId]) {
        streamsRef.current[peerSocketId] = new MediaStream();
      }
      streamsRef.current[peerSocketId].addTrack(event.track);
      const liveStream = new MediaStream(streamsRef.current[peerSocketId].getTracks());

      setPeers(prev => {
        const idx = prev.findIndex(p => p.socketId === peerSocketId);
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], username: peerName || updated[idx].username, stream: liveStream };
          return updated;
        }
        return [...prev, { socketId: peerSocketId, username: peerName || 'Participant', stream: liveStream }];
      });
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        if (track.readyState === 'live') {
          pc.addTrack(track, localStreamRef.current);
        }
      });
    }

    if (isInitiator) {
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
          if (socket) {
            socket.emit('webrtc-signal', { targetId: peerSocketId, signal: { sdp: pc.localDescription } });
          }
        })
        .catch(err => console.error('Error creating offer:', err));
    }

    return pc;
  };

  // ─── End Call Cleanup ────────────────────────────────────────────────────────
  const endCallCleanup = useCallback(() => {
    socketRef.current?.emit('webrtc-leave-call', { projectName: roomName });
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    Object.values(peersRef.current).forEach(pc => { try { pc.close(); } catch { } });
    peersRef.current = {};
    streamsRef.current = {};
    candidateQueues.current = {};
    setPeers([]);
    setInCall(false);
    setScreenSharing(false);
    setVideoMuted(false);
    setMicMuted(false);
  }, [roomName]);

  // ─── Socket setup after auth ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthed) return;

    const socket = initSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setConnectionStatus('connected');
      const savedKey = sessionStorage.getItem(`accesskey_project_${roomName}`) || getCookie(`accesskey_project_${roomName}`);
      socket.emit('join room', { room: roomName, accessKey: savedKey });
      setRoster(prev => {
        const selfId = socket.id;
        const already = prev.find(r => r.socketId === selfId);
        if (already) return prev;
        return [...prev, { socketId: selfId, username: username || 'You' }];
      });
    });

    socket.on('disconnect', () => {
      setConnected(false);
      setConnectionStatus('reconnecting');
    });

    socket.on('reconnect', () => {
      setConnectionStatus('connected');
      setConnected(true);
    });

    socket.on('reconnect_failed', () => {
      setConnectionStatus('reconnection-failed');
    });

    socket.on('set username', (name) => {
      setUsername(name);
      sessionStorage.setItem('anonhub-username', name);
      document.cookie = `anonhub-username=${encodeURIComponent(name)}; path=/; SameSite=Lax`;
    });

    socket.on('username updated', (name) => {
      setUsername(name);
      sessionStorage.setItem('anonhub-username', name);
      document.cookie = `anonhub-username=${encodeURIComponent(name)}; path=/; SameSite=Lax`;
    });

    socket.on('user-joined', ({ username: u, socketId: sid }) => {
      setRoster(prev => {
        if (prev.find(r => r.socketId === sid)) return prev;
        return [...prev, { socketId: sid, username: u }];
      });
      setMessages(prev => [...prev, {
        id: `sys-${Date.now()}-${sid}`,
        type: 'system',
        text: `${u} joined the room`,
        ts: Date.now()
      }]);
    });

    socket.on('user-left', ({ username: u, socketId: sid }) => {
      setRoster(prev => prev.filter(r => r.socketId !== sid));
      setMessages(prev => [...prev, {
        id: `sys-${Date.now()}-${sid}`,
        type: 'system',
        text: `${u} left the room`,
        ts: Date.now()
      }]);
    });

    socket.on('chat message', ({ username: u, msg, timestamp }) => {
      const isSelf = u === username;
      setMessages(prev => {
        const id = `msg-${timestamp || Date.now()}-${Math.random()}`;
        return [...prev, {
          id,
          type: 'message',
          author: u,
          text: msg,
          ts: timestamp || Date.now(),
          isSelf
        }];
      });
      if (!sidebarOpen) {
        setUnreadCount(c => c + 1);
      }
    });

    socket.on('load messages', (msgs) => {
      setMessages(msgs.map(m => ({
        id: m._id || `hist-${m.timestamp}-${Math.random()}`,
        type: 'message',
        author: m.username,
        text: m.msg,
        ts: m.timestamp || Date.now(),
        isSelf: false
      })));
    });

    // ── WebRTC signaling events ──
    socket.on('webrtc-user-joined', ({ socketId: sid, username: peerName }) => {
      if (!peersRef.current[sid]) {
        const pc = createPeerConnection(sid, peerName || 'Participant', true, socket);
        peersRef.current[sid] = pc;
      }
      setRoster(prev => {
        if (prev.find(r => r.socketId === sid)) return prev;
        return [...prev, { socketId: sid, username: peerName || 'Participant' }];
      });
    });

    socket.on('webrtc-signal', async ({ senderId, senderUsername, signal }) => {
      const peerName = senderUsername || 'Participant';
      let pc = peersRef.current[senderId];
      if (!pc) {
        pc = createPeerConnection(senderId, peerName, false, socket);
        peersRef.current[senderId] = pc;
      } else if (senderUsername) {
        setPeers(prev => prev.map(p => p.socketId === senderId ? { ...p, username: senderUsername } : p));
        setRoster(prev => prev.map(r => r.socketId === senderId ? { ...r, username: senderUsername } : r));
      }

      try {
        if (signal.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

          const queue = candidateQueues.current[senderId] || [];
          while (queue.length > 0) {
            const cand = queue.shift();
            await pc.addIceCandidate(cand).catch(() => { });
          }
          candidateQueues.current[senderId] = [];

          if (signal.sdp.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('webrtc-signal', { targetId: senderId, signal: { sdp: pc.localDescription } });
          }
        } else if (signal.candidate) {
          const candidate = new RTCIceCandidate(signal.candidate);
          if (pc.remoteDescription && pc.remoteDescription.type) {
            await pc.addIceCandidate(candidate).catch(() => { });
          } else {
            if (!candidateQueues.current[senderId]) {
              candidateQueues.current[senderId] = [];
            }
            candidateQueues.current[senderId].push(candidate);
          }
        }
      } catch (err) {
        console.error('Signal processing error:', err);
      }
    });

    socket.on('webrtc-user-left', ({ socketId: sid }) => {
      if (peersRef.current[sid]) {
        try { peersRef.current[sid].close(); } catch { }
        delete peersRef.current[sid];
      }
      delete streamsRef.current[sid];
      delete candidateQueues.current[sid];
      setPeers(prev => prev.filter(p => p.socketId !== sid));
      setRoster(prev => prev.filter(r => r.socketId !== sid));
    });

    // ── Mic mute status from peers ──
    socket.on('peer-mic-status', ({ socketId: sid, muted }) => {
      setMicMutedMap(prev => ({ ...prev, [sid]: muted }));
    });

    socket.connect();

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('reconnect');
      socket.off('reconnect_failed');
      socket.off('set username');
      socket.off('username updated');
      socket.off('user-joined');
      socket.off('user-left');
      socket.off('chat message');
      socket.off('load messages');
      socket.off('webrtc-user-joined');
      socket.off('webrtc-signal');
      socket.off('webrtc-user-left');
      socket.off('peer-mic-status');
      endCallCleanup();
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, roomName]);

  // ─── Auto-scroll chat ────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ─── Reset unread on open ────────────────────────────────────────────────────
  useEffect(() => {
    if (sidebarOpen) setUnreadCount(0);
  }, [sidebarOpen]);

  // ─── Start Call ──────────────────────────────────────────────────────────────
  const startCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      setVideoMuted(false);
      setMicMuted(false);
      setInCall(true);
      // Fallback: ensure srcObject is set after React commits the video element
      requestAnimationFrame(() => {
        if (localVideoRef.current && localStreamRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
          localVideoRef.current.play().catch(() => { });
        }
      });
      socketRef.current?.emit('webrtc-join-call', { projectName: roomName }, (response) => {
        if (response && Array.isArray(response.existingPeers)) {
          response.existingPeers.forEach(({ socketId: sid, username: peerName }) => {
            if (socketRef.current && !peersRef.current[sid]) {
              const pc = createPeerConnection(sid, peerName || 'Participant', false, socketRef.current);
              peersRef.current[sid] = pc;
            }
          });
        }
      });
    } catch (err) {
      console.error('getUserMedia error:', err);
      alert('Camera/microphone access is required to start the call.');
    }
  };

  const leaveCall = () => {
    endCallCleanup();
    navigate('/');
  };

  // ─── Mic Toggle ──────────────────────────────────────────────────────────────
  const toggleMic = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      const nowMuted = !track.enabled;
      setMicMuted(nowMuted);
      // Broadcast mute state to WebRTC room peers
      socketRef.current?.emit('mic-status', { projectName: roomName, muted: nowMuted });
    }
  };

  // ─── Video Toggle ────────────────────────────────────────────────────────────
  const toggleVideo = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setVideoMuted(!track.enabled);
    }
  };

  // ─── Screen Share Toggle ─────────────────────────────────────────────────────
  const replaceVideoTrack = (newTrack) => {
    Object.values(peersRef.current).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(newTrack).catch(() => { });
    });
    if (localVideoRef.current?.srcObject) {
      const stream = localVideoRef.current.srcObject;
      const old = stream.getVideoTracks()[0];
      if (old) stream.removeTrack(old);
      stream.addTrack(newTrack);
      localVideoRef.current.srcObject = stream;
    }
  };

  const toggleScreenShare = async () => {
    if (screenSharing) {
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
      setScreenSharing(false);
      const camTrack = localStreamRef.current?.getVideoTracks()[0];
      if (camTrack) replaceVideoTrack(camTrack);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = stream;
        setScreenSharing(true);
        const screenTrack = stream.getVideoTracks()[0];
        replaceVideoTrack(screenTrack);
        screenTrack.onended = () => {
          setScreenSharing(false);
          const camTrack = localStreamRef.current?.getVideoTracks()[0];
          if (camTrack) replaceVideoTrack(camTrack);
        };
      } catch (err) {
        if (err.name !== 'AbortError') alert('Failed to start screen sharing.');
      }
    }
  };

  // ─── Send Chat Message ────────────────────────────────────────────────────────
  const sendMessage = () => {
    const text = inputText.trim();
    if (!text || !socketRef.current) return;
    // Backend event: 'room message', payload: { room, msg }
    socketRef.current.emit('room message', { room: roomName, msg: text });
    setInputText('');
    inputRef.current?.focus();
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ─── Total tile count ────────────────────────────────────────────────────────
  const totalTiles = 1 + peers.length; // local + remote

  // ─── If not authed, show gate ─────────────────────────────────────────────────
  if (!isAuthed) {
    return (
      <div className="callroom-access-overlay">
        <AccessKeyModal
          title="Video Call Room"
          subtitle="Enter the room name and access key to join this call session."
          showRoomInput={false}
          initialRoomName={roomName}
          errorMessage={authError}
          onSubmit={(_, key) => handleAuthSubmit(roomName, key)}
        />
      </div>
    );
  }

  return (
    <div className={`callroom-root${!sidebarOpen ? ' no-sidebar' : ''}`}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="callroom-header">
        <div className="callroom-header-left">
          <button
            onClick={() => {
              endCallCleanup();
              navigate('/');
            }}
            className="callroom-home-btn"
            title="Go to Homepage"
          >
            <Home size={16} />
          </button>
          <div className="callroom-logo-dot" />
          <span className="callroom-title">AnonHub Call</span>
          <span className="callroom-room-name">#{roomName}</span>
        </div>
        <div className="callroom-header-right">
          {inCall && (
            <div className="callroom-live-badge">
              <div className="callroom-live-dot" />
              LIVE
            </div>
          )}
          <div className="callroom-user-count">
            <Users size={12} />
            {roster.length || 1} online
          </div>
        </div>
      </header>

      {/* ── Video Grid ─────────────────────────────────────────────────────── */}
      <main className="callroom-grid">
        {/* Connection banners */}
        {connectionStatus === 'reconnecting' && (
          <div className="callroom-reconnecting-banner">
            <span>🔄</span> Reconnecting…
          </div>
        )}
        {connectionStatus === 'reconnection-failed' && (
          <div className="callroom-error-banner">
            ⚠️ Connection lost.
            <button className="callroom-reconnect-btn" onClick={() => socketRef.current?.connect()}>Retry</button>
          </div>
        )}

        {!inCall ? (
          /* Pre-call waiting state */
          <div className="callroom-waiting-overlay">
            <div className="callroom-waiting-icon">
              <Video size={36} color="rgba(124, 77, 255, 0.7)" />
            </div>
            <h3>Ready to join the call?</h3>
            <p>Click the camera button below to start your video &amp; audio.</p>
            <button
              id="callroom-start-btn"
              onClick={startCall}
              style={{
                marginTop: '8px',
                padding: '12px 32px',
                borderRadius: '28px',
                background: 'linear-gradient(135deg, #7c4dff, #5c35cc)',
                border: 'none',
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: 'pointer',
                boxShadow: '0 8px 28px rgba(124, 77, 255, 0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                letterSpacing: '0.05em',
                transition: 'all 0.2s',
              }}
            >
              <Video size={18} /> Join Call
            </button>
          </div>
        ) : (
          /* Active call video mesh */
          <div
            className={`callroom-video-mesh${totalTiles >= 5 ? ' many-participants' : ''}`}
            data-count={Math.min(totalTiles, 4)}
          >
            {/* Local video tile */}
            <div className={`callroom-video-tile local-tile ${screenSharing ? 'sharing-screen' : ''}`}>
              <video
                ref={localVideoRefCallback}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: videoMuted ? 'none' : 'block',
                  background: '#0d0f1a',
                  position: 'absolute',
                  inset: 0,
                }}
              />
              {videoMuted && (
                <div className="callroom-video-avatar">
                  <div className="callroom-avatar-circle">{getInitials(username)}</div>
                  <div className="callroom-avatar-name">{username} (You)</div>
                </div>
              )}
              {screenSharing && (
                <div className="callroom-screen-share-badge">
                  <MonitorUp size={11} /> Sharing Screen
                </div>
              )}
              <div className="callroom-participant-badge">
                <span className={`callroom-mic-indicator${micMuted ? ' muted' : ''}`}>
                  {micMuted ? <MicOff size={10} /> : <Mic size={10} />}
                </span>
                {username} (You)
              </div>
            </div>

            {/* Remote video tiles */}
            {peers.map(peer => (
              <RemoteVideoTile key={peer.socketId} peer={peer} micMutedMap={micMutedMap} />
            ))}
          </div>
        )}
      </main>

      {/* ── Controls Bar ───────────────────────────────────────────────────── */}
      <footer className="callroom-controls">
        {!inCall ? (
          <button id="callroom-join-btn" className="callroom-ctrl-btn" onClick={startCall} title="Join Call">
            <Video size={20} />
            <span className="callroom-ctrl-btn-label">Join</span>
          </button>
        ) : (
          <>
            {/* Mic */}
            <button
              id="callroom-mic-btn"
              className={`callroom-ctrl-btn${micMuted ? ' muted' : ''}`}
              onClick={toggleMic}
              title={micMuted ? 'Unmute Mic' : 'Mute Mic'}
            >
              {micMuted ? <MicOff size={20} /> : <Mic size={20} />}
              <span className="callroom-ctrl-btn-label">{micMuted ? 'Unmuted' : 'Mute'}</span>
            </button>

            {/* Camera */}
            <button
              id="callroom-cam-btn"
              className={`callroom-ctrl-btn${videoMuted ? ' muted' : ''}`}
              onClick={toggleVideo}
              title={videoMuted ? 'Turn Camera On' : 'Turn Camera Off'}
            >
              {videoMuted ? <VideoOff size={20} /> : <Video size={20} />}
              <span className="callroom-ctrl-btn-label">{videoMuted ? 'Cam Off' : 'Camera'}</span>
            </button>

            {/* Screen share */}
            <button
              id="callroom-screen-btn"
              className={`callroom-ctrl-btn${screenSharing ? ' screen-active' : ''}`}
              onClick={toggleScreenShare}
              title={screenSharing ? 'Stop Screen Share' : 'Share Screen'}
            >
              <MonitorUp size={20} />
              <span className="callroom-ctrl-btn-label">{screenSharing ? 'Stop Share' : 'Share'}</span>
            </button>

            <div className="callroom-ctrl-divider" />

            {/* Leave */}
            <button
              id="callroom-leave-btn"
              className="callroom-ctrl-btn leave-btn"
              onClick={leaveCall}
              title="Leave Call"
            >
              <PhoneOff size={20} />
              <span className="callroom-ctrl-btn-label">Leave</span>
            </button>
          </>
        )}

        <div className="callroom-ctrl-divider" />

        {/* Chat toggle */}
        <button
          id="callroom-chat-toggle-btn"
          className={`callroom-chat-toggle-btn${sidebarOpen ? ' chat-open' : ''}`}
          onClick={() => setSidebarOpen(o => !o)}
        >
          <MessageSquare size={16} />
          Chat
          {unreadCount > 0 && !sidebarOpen && (
            <span className="callroom-unread-badge">{unreadCount}</span>
          )}
          {sidebarOpen ? <ChevronRight size={14} /> : <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />}
        </button>
      </footer>

      {/* ── Sidebar (Chat + Roster) ─────────────────────────────────────────── */}
      {sidebarOpen && (
        <aside className="callroom-sidebar">
          <div className="callroom-sidebar-header">
            <h4>In-Call Chat</h4>
            <button
              className="callroom-sidebar-close-btn"
              onClick={() => setSidebarOpen(false)}
              title="Close Sidebar"
            >
              <X size={14} />
            </button>
          </div>

          {/* Live Roster */}
          <div className="callroom-roster">
            <div className="callroom-roster-header">Participants</div>
            {roster.length === 0 ? (
              <div style={{ fontSize: '0.72rem', color: 'rgba(197,179,255,0.3)', fontStyle: 'italic' }}>
                Only you — waiting for others…
              </div>
            ) : (
              roster.map(r => (
                <div key={r.socketId} className="callroom-roster-item">
                  <span className="callroom-roster-dot" />
                  {r.username}
                </div>
              ))
            )}
          </div>

          {/* Messages */}
          <div className="callroom-messages" id="callroom-messages-list">
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', color: 'rgba(197,179,255,0.25)', fontSize: '0.75rem', marginTop: '20px' }}>
                No messages yet. Say hello! 👋
              </div>
            )}
            {messages.map(msg =>
              msg.type === 'system' ? (
                <div key={msg.id} className="callroom-msg-system">{msg.text}</div>
              ) : (
                <div key={msg.id} className={`callroom-msg-item${msg.isSelf ? ' own-msg' : ''}`}>
                  <div className="callroom-msg-meta">
                    <span className="callroom-msg-author">{msg.isSelf ? 'You' : msg.author}</span>
                    <span className="callroom-msg-time">{formatTime(msg.ts)}</span>
                  </div>
                  <div className="callroom-msg-bubble">{msg.text}</div>
                </div>
              )
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="callroom-msg-input-area">
            <textarea
              ref={inputRef}
              id="callroom-msg-input"
              className="callroom-msg-input"
              placeholder="Message…"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleInputKeyDown}
              rows={1}
            />
            <button
              id="callroom-msg-send-btn"
              className="callroom-msg-send-btn"
              onClick={sendMessage}
              disabled={!inputText.trim()}
              title="Send message"
            >
              <Send size={15} />
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}

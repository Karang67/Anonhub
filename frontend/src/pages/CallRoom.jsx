/**
 * @file CallRoom.jsx
 * @description Dedicated full-screen real-time Video Call & Screen Sharing room for AnonHub.
 * Powered by high-speed browser-native WebRTC mesh with persistent CallSessionManager.
 * Features:
 * - Sub-100ms ultra-low latency peer-to-peer video & audio
 * - Hardware-accelerated VP8/H.264 video and Opus echo-cancelled audio
 * - Screen sharing with auto-aspect scaling
 * - Full route persistence (seamless transitions between /projects, /call, /chat)
 * - In-call sidebar with live text chat and participant roster
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Video, VideoOff, Mic, MicOff, MonitorUp, PhoneOff,
  Users, MessageSquare, X, Send, ChevronRight, Home, RefreshCw, Info, HelpCircle
} from 'lucide-react';
import { getApiUrl } from '../config';
import { initSocket, getCookie, setCookie } from '../services/socket';
import { globalCallSession } from '../services/callSession';
import AccessKeyModal from '../components/AccessKeyModal';
import './CallRoom.css';

// Helpers
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

const AVATAR_COLORS = [
  '#7c4dff', '#f50057', '#00bcd4', '#4caf50', '#ff5722', '#2196f3', '#e91e63', '#009688'
];

function getAvatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/**
 * Remote Video Tile (Hardware-accelerated Native Video)
 */
function RemoteVideoTile({ peer, stream }) {
  const videoRef = useRef(null);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    if (!videoRef.current || !stream) return;
    videoRef.current.srcObject = stream;
    videoRef.current.play().catch(() => {});

    const updateTracks = () => {
      const v = stream.getVideoTracks();
      setHasVideo(v.length > 0 && v[0].enabled);
    };

    updateTracks();
    stream.onaddtrack = updateTracks;
    stream.onremovetrack = updateTracks;
  }, [stream]);

  return (
    <div className="callroom-video-tile remote-tile" style={{ position: 'relative' }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          background: '#000000',
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          display: hasVideo ? 'block' : 'none'
        }}
      />
      {!hasVideo && (
        <div className="callroom-video-avatar" style={{ zIndex: 2 }}>
          <div className="callroom-avatar-circle" style={{ background: getAvatarColor(peer.username) }}>
            {getInitials(peer.username)}
          </div>
          <div className="callroom-avatar-name">{peer.username}</div>
        </div>
      )}
      <div className="callroom-participant-badge" style={{ zIndex: 3 }}>
        <span className={`callroom-mic-indicator ${peer.micMuted ? 'muted' : ''}`}>
          {peer.micMuted ? <MicOff size={10} /> : <Mic size={10} />}
        </span>
        {peer.username}
      </div>
    </div>
  );
}

export default function CallRoom() {
  const { roomName } = useParams();
  const navigate = useNavigate();

  // ── Auth state ──────────────────────────────────────────────────────────────
  const [isAuthed, setIsAuthed] = useState(false);
  const [authError, setAuthError] = useState('');
  const [username, setUsername] = useState('');

  // ── Global Call Session State ───────────────────────────────────────────────
  const [callState, setCallState] = useState(() => globalCallSession.getState());
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  // ── Chat sidebar ───────────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth > 768);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const [roster, setRoster] = useState([]);
  const [tourStep, setTourStep] = useState(-1);
  const localVideoRef = useRef(null);

  // Auto-hiding Navbar on scroll
  const [navVisible, setNavVisible] = useState(true);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY || document.documentElement.scrollTop;
      setNavVisible(currentScrollY <= lastScrollY.current || currentScrollY <= 40);
      lastScrollY.current = currentScrollY;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Subscribe to globalCallSession
  useEffect(() => {
    const unsubscribe = globalCallSession.subscribe((newState) => {
      setCallState({ ...newState });
    });
    return () => unsubscribe();
  }, []);

  // Bind local video element
  const localVideoRefCallback = useCallback((node) => {
    localVideoRef.current = node;
    if (node) {
      const stream = callState.screenSharing && callState.screenStream 
        ? callState.screenStream 
        : callState.localStream;
      if (stream && node.srcObject !== stream) {
        node.srcObject = stream;
        node.play().catch(() => {});
      }
    }
  }, [callState.localStream, callState.screenStream, callState.screenSharing]);

  // Ensure local video element stays attached when streams change dynamically
  useEffect(() => {
    if (localVideoRef.current) {
      const stream = callState.screenSharing && callState.screenStream 
        ? callState.screenStream 
        : callState.localStream;
      if (stream && localVideoRef.current.srcObject !== stream) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(() => {});
      }
    }
  }, [callState.localStream, callState.screenStream, callState.screenSharing]);

  // Auth verification on mount
  useEffect(() => {
    const tryAutoAuth = async () => {
      const savedKey = sessionStorage.getItem(`accesskey_project_${roomName}`) ||
        getCookie(`accesskey_project_${roomName}`) || '';
      
      try {
        const res = await fetch(getApiUrl('/create-project'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: roomName, accessKey: savedKey })
        });
        if (res.ok) {
          const data = await res.json();
          const uname = sessionStorage.getItem('trinetra-username') || sessionStorage.getItem('anonhub-username') || getCookie('trinetra-username') || getCookie('anonhub-username') || 'Anonymous';
          setUsername(uname);
          if (data.ownerToken) localStorage.setItem(`owner_token_${roomName}`, data.ownerToken);
          setIsAuthed(true);
        }
      } catch {
        // Fallback for open rooms
        setIsAuthed(true);
      }
    };
    tryAutoAuth();
  }, [roomName]);

  const handleAuthSubmit = async (rName, accessKey) => {
    setAuthError('');
    try {
      const res = await fetch(getApiUrl('/create-project'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: rName, accessKey })
      });
      const data = await res.json();
      if (res.ok) {
        sessionStorage.setItem(`accesskey_project_${rName}`, accessKey);
        setCookie(`accesskey_project_${rName}`, accessKey);
        setCookie(`trinetra-active-call-room`, rName);
        if (data.ownerToken) localStorage.setItem(`owner_token_${rName}`, data.ownerToken);
        const uname = sessionStorage.getItem('trinetra-username') || sessionStorage.getItem('anonhub-username') || getCookie('trinetra-username') || getCookie('anonhub-username') || 'Anonymous';
        setUsername(uname);
        setIsAuthed(true);
      } else {
        setAuthError(data.error || 'Invalid access key or room name.');
      }
    } catch {
      setAuthError('Network error. Please try again.');
    }
  };

  // Socket setup after auth
  useEffect(() => {
    if (!isAuthed || !roomName) return;

    const socket = initSocket();
    socketRef.current = socket;
    globalCallSession.attachSocket(socket);

    const savedKey = sessionStorage.getItem(`accesskey_project_${roomName}`) || getCookie(`accesskey_project_${roomName}`) || '';

    const doJoinRoom = () => {
      setConnected(true);
      socket.emit('join-call-room', { room: roomName, accessKey: savedKey });
    };

    socket.on('connect', doJoinRoom);
    socket.on('disconnect', () => setConnected(false));
    socket.on('set username', (name) => setUsername(name));
    socket.on('room users', (users) => {
      setRoster(users.map(u => ({ socketId: u.id, username: u.username })));
    });

    socket.on('chat message', ({ username: u, msg, timestamp }) => {
      const isSelf = u === username;
      setMessages(prev => [...prev, {
        id: `msg-${timestamp || Date.now()}-${Math.random()}`,
        type: 'message',
        author: u,
        text: msg,
        ts: timestamp || Date.now(),
        isSelf
      }]);
      if (!sidebarOpen) setUnreadCount(c => c + 1);
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

    socket.connect();
    if (socket.connected) doJoinRoom();

    return () => {
      socket.off('connect', doJoinRoom);
      socket.off('set username');
      socket.off('room users');
      socket.off('chat message');
      socket.off('load messages');
    };
  }, [isAuthed, roomName, sidebarOpen, username]);

  // Auto-restore / Re-join call session if persisted
  useEffect(() => {
    if (!isAuthed || !roomName) return;
    const persisted = globalCallSession.getPersistedCallState(roomName);
    if (persisted && persisted.active && !callState.inCall) {
      startCall();
    }
  }, [isAuthed, roomName]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (sidebarOpen) setUnreadCount(0);
  }, [sidebarOpen]);

  // ── Call Actions ───────────────────────────────────────────────────────────
  const startCall = async (preferScreen = false) => {
    try {
      await globalCallSession.startCall({
        roomName,
        username: username || 'Participant',
        socket: socketRef.current,
        preferScreen
      });
    } catch (err) {
      console.error('startCall error:', err);
      alert('Microphone and camera access is required to join the call.');
    }
  };

  const leaveCall = () => {
    globalCallSession.endCall();
    navigate(`/projects/${encodeURIComponent(roomName)}`);
  };

  const sendMessage = () => {
    const text = inputText.trim();
    if (!text || !socketRef.current) return;
    socketRef.current.emit('room message', { room: roomName, msg: text });
    setInputText('');
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!isAuthed) {
    return (
      <AccessKeyModal
        isOpen={true}
        roomName={roomName}
        roomType="call"
        onSubmit={handleAuthSubmit}
        errorMessage={authError}
        onCancel={() => navigate('/')}
      />
    );
  }

  const {
    inCall,
    micMuted,
    videoMuted,
    screenSharing,
    facingMode,
    peers,
    remoteStreams
  } = callState;

  const totalTiles = (inCall ? 1 : 0) + peers.length;

  return (
    <div className={`callroom-root ${!sidebarOpen ? 'no-sidebar' : ''} ${!inCall ? 'not-in-call' : ''}`}>
      {/* Top Navbar */}
      <header className="callroom-header">
        <div className="callroom-header-left">
          <button className="callroom-nav-btn" onClick={() => navigate(`/projects/${encodeURIComponent(roomName)}`)} title="Back to Project Workspace">
            <Home size={18} />
            <span>Workspace</span>
          </button>
          <div className="callroom-title-badge">
            <span className="callroom-room-tag">Room:</span>
            <span className="callroom-room-name">{roomName}</span>
          </div>
          <span className="callroom-protocol-badge">WebRTC P2P • Ultra-Fast</span>
        </div>

        <div className="callroom-header-right">
          <button
            className={`callroom-chat-btn${unreadCount > 0 ? ' has-unread' : ''}`}
            onClick={() => setSidebarOpen(o => !o)}
            title="Toggle In-Call Chat"
          >
            <MessageSquare size={16} />
            <span>Chat</span>
            {unreadCount > 0 && <span className="callroom-unread-badge">{unreadCount}</span>}
          </button>
        </div>
      </header>

      {/* Main Video Viewport */}
      <main className="callroom-grid">
        {!inCall ? (
          <div className="callroom-waiting-overlay">
            <div className="callroom-waiting-icon">
              <Video size={42} color="var(--primary-color, #7c4dff)" />
            </div>
            <h3>High-Performance WebRTC Video Call</h3>
            <p>Connect with sub-100ms ultra-low latency, crisp audio, and seamless screen sharing.</p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
              <button
                id="callroom-start-btn"
                onClick={() => startCall(false)}
                className="callroom-ctrl-btn"
                style={{ padding: '10px 24px', background: 'var(--primary-gradient, #7c4dff)', color: '#fff', borderRadius: '8px', border: 'none', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <Video size={18} />
                <span>Join Video Call</span>
              </button>
              <button
                onClick={() => startCall(true)}
                className="callroom-ctrl-btn"
                style={{ padding: '10px 24px', background: '#0284c7', color: '#fff', borderRadius: '8px', border: 'none', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <MonitorUp size={18} />
                <span>Share Screen</span>
              </button>
            </div>
          </div>
        ) : (
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
                  objectFit: screenSharing ? 'contain' : 'cover',
                  display: (videoMuted && !screenSharing) ? 'none' : 'block',
                  background: '#0d0f1a',
                  position: 'absolute',
                  inset: 0,
                }}
              />
              {videoMuted && !screenSharing && (
                <div className="callroom-video-avatar">
                  <div className="callroom-avatar-circle" style={{ background: getAvatarColor(username) }}>
                    {getInitials(username)}
                  </div>
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
                {username} (You) {screenSharing ? '(Screen)' : ''}
              </div>
            </div>

            {/* Remote video tiles */}
            {peers.map(peer => (
              <RemoteVideoTile
                key={peer.socketId}
                peer={peer}
                stream={remoteStreams.get(peer.socketId)}
              />
            ))}
          </div>
        )}
      </main>

      {/* In-Call Bottom Controls Bar */}
      {inCall && (
        <footer className="callroom-controls">
          <button
            id="callroom-mic-btn"
            className={`callroom-ctrl-btn${micMuted ? ' muted' : ''}`}
            onClick={() => globalCallSession.toggleMic()}
            title={micMuted ? 'Unmute Mic' : 'Mute Mic'}
          >
            {micMuted ? <MicOff size={20} /> : <Mic size={20} />}
            <span className="callroom-ctrl-btn-label">{micMuted ? 'Muted' : 'Mic'}</span>
          </button>

          <button
            id="callroom-cam-btn"
            className={`callroom-ctrl-btn${videoMuted ? ' muted' : ''}`}
            onClick={() => globalCallSession.toggleVideo()}
            title={videoMuted ? 'Turn Camera On' : 'Turn Camera Off'}
          >
            {videoMuted ? <VideoOff size={20} /> : <Video size={20} />}
            <span className="callroom-ctrl-btn-label">{videoMuted ? 'Cam Off' : 'Camera'}</span>
          </button>

          <button
            id="callroom-switch-cam-btn"
            className="callroom-ctrl-btn"
            onClick={() => globalCallSession.switchCamera()}
            title={`Switch to ${facingMode === 'user' ? 'Back' : 'Front'} Camera`}
          >
            <RefreshCw size={20} />
            <span className="callroom-ctrl-btn-label">Flip</span>
          </button>

          <button
            id="callroom-screen-btn"
            className={`callroom-ctrl-btn${screenSharing ? ' screen-active' : ''}`}
            onClick={() => globalCallSession.toggleScreenShare()}
            title={screenSharing ? 'Stop Screen Share' : 'Share Screen'}
          >
            <MonitorUp size={20} />
            <span className="callroom-ctrl-btn-label">{screenSharing ? 'Stop Share' : 'Share'}</span>
          </button>

          <div className="callroom-ctrl-divider" />

          <button
            id="callroom-leave-btn"
            className="callroom-ctrl-btn leave-btn"
            onClick={leaveCall}
            title="Leave Call"
          >
            <PhoneOff size={20} />
            <span className="callroom-ctrl-btn-label">Leave</span>
          </button>
        </footer>
      )}

      {/* In-Call Chat Drawer */}
      {sidebarOpen && (
        <aside className="callroom-sidebar">
          <div className="callroom-sidebar-header">
            <h4>In-Call Chat</h4>
            <button
              className="callroom-sidebar-close-btn"
              onClick={() => setSidebarOpen(false)}
              title="Close Chat"
            >
              <X size={20} />
            </button>
          </div>

          <div className="callroom-roster">
            <div className="callroom-roster-header">Participants ({roster.length})</div>
            {roster.map(r => (
              <div key={r.socketId} className="callroom-roster-item">
                <span className="callroom-roster-dot" />
                {r.username} {r.socketId === socketRef.current?.id ? '(You)' : ''}
              </div>
            ))}
          </div>

          <div className="callroom-messages" id="callroom-messages-list">
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', color: 'rgba(197,179,255,0.25)', fontSize: '0.75rem', marginTop: '20px' }}>
                No messages yet. Say hello! 👋
              </div>
            )}
            {messages.map(msg => (
              <div key={msg.id} className={`callroom-msg-item${msg.isSelf ? ' own-msg' : ''}`}>
                <div className="callroom-msg-meta">
                  <span className="callroom-msg-author">{msg.isSelf ? 'You' : msg.author}</span>
                  <span className="callroom-msg-time">{formatTime(msg.ts)}</span>
                </div>
                <div className="callroom-msg-bubble">{msg.text}</div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

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

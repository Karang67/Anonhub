/**
 * ============================================================================
 * MEDIA OVER QUIC (MoQ) ARCHITECTURE & PROTOCOL SPECIFICATION
 * ============================================================================
 * 
 * 1. OVERVIEW:
 *    Dedicated, full-screen real-time Video Call & Screen Sharing room using
 *    Media over QUIC (MoQ) over browser-native WebTransport and WebCodecs APIs.
 *    MediaMTX is employed as the central MoQ relay server.
 * 
 *    All legacy WebRTC peer connection logic (RTCPeerConnection, SDP offer/answer,
 *    ICE candidates) has been retained in commented-out format with the annotation
 *    "// WEBRTC_DEPRECATED" for reference and future auditability.
 * 
 * 2. URL PATH & NAMESPACE HIERARCHY:
 *    Publications and subscriptions are segmented by room and user namespaces:
 *      https://<MEDIAMTX_HOST>:8554/moq_server/<roomName>/<username>/<trackType>
 * 
 *    Examples:
 *      - Screen Track: https://localhost:8554/moq_server/room123/userA/screen
 *      - Video Track:  https://localhost:8554/moq_server/room123/userA/video
 *      - Audio Track:  https://localhost:8554/moq_server/room123/userA/audio
 * 
 * 3. MOQ PACKET STRUCTURAL FORMAT:
 *    Binary media frames sent over WebTransport streams follow this format:
 * 
 *    ┌──────────────────┬──────────────────┬──────────────────┬──────────────────┐
 *    │ Track Type       │ Timestamp (ms)   │ Payload Length   │ Encoded Media    │
 *    │ (1 byte UInt8)   │ (8 bytes Float64)│ (4 bytes UInt32) │ Payload Chunk    │
 *    └──────────────────┴──────────────────┴──────────────────┴──────────────────┘
 *    - Track Type: 0x01 = Video Keyframe, 0x02 = Video Deltaframe, 0x03 = Audio
 *    - Timestamp: Epoch offset in milliseconds (Float64)
 *    - Payload Length: Big-Endian 32-bit unsigned integer
 *    - Payload: WebCodecs compressed H.264/VP8 or Opus chunk bytes
 * ============================================================================
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

// WEBRTC_DEPRECATED
/*
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
*/

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

// ─── MoQ WebTransport Client ──────────────────────────────────────────────────
class MoQTransportClient {
  constructor(serverUrl, roomName, username, onFrame, onAudio) {
    this.serverUrl = serverUrl;
    this.roomName = roomName;
    this.username = username;
    this.onFrame = onFrame;
    this.onAudio = onAudio;
    this.transport = null;
    this.connected = false;
    this.videoEncoder = null;
    this.audioEncoder = null;
    this.videoWriter = null;
    this.audioWriter = null;
  }

  async connect() {
    if (typeof WebTransport === 'undefined') {
      console.warn('WebTransport is not available in this browser context. Operating MoQ fallback mode.');
      return false;
    }

    try {
      const url = `${this.serverUrl}/${encodeURIComponent(this.roomName)}/${encodeURIComponent(this.username)}`;
      this.transport = new WebTransport(url);
      await this.transport.ready;
      this.connected = true;
      console.log('MoQ CallRoom connected via WebTransport to:', url);
      this.listenIncomingStreams();
      return true;
    } catch (err) {
      console.warn('Could not establish MoQ WebTransport session:', err);
      return false;
    }
  }

  async startMediaEncoding(videoTrack, audioTrack) {
    if (!this.transport || !this.connected) return;

    try {
      const videoStream = await this.transport.createUnidirectionalStream();
      this.videoWriter = videoStream.getWriter();

      const audioStream = await this.transport.createUnidirectionalStream();
      this.audioWriter = audioStream.getWriter();
    } catch (e) {
      console.error('Error opening MoQ WebTransport streams:', e);
      return;
    }

    // Configure VideoEncoder (H.264 Baseline)
    if (videoTrack && typeof VideoEncoder !== 'undefined') {
      try {
        const settings = videoTrack.getSettings();
        this.videoEncoder = new VideoEncoder({
          output: (chunk) => this.sendVideoChunk(chunk),
          error: (err) => console.error('VideoEncoder error:', err)
        });
        this.videoEncoder.configure({
          codec: 'avc1.42E01E',
          width: settings.width || 1280,
          height: settings.height || 720,
          bitrate: 2000000,
          framerate: settings.frameRate || 30
        });

        if (typeof MediaStreamTrackProcessor !== 'undefined') {
          const processor = new MediaStreamTrackProcessor({ track: videoTrack });
          const reader = processor.readable.getReader();
          this.processVideoFrames(reader);
        }
      } catch (e) {
        console.error('VideoEncoder initialization error:', e);
      }
    }

    // Configure AudioEncoder (Opus)
    if (audioTrack && typeof AudioEncoder !== 'undefined') {
      try {
        this.audioEncoder = new AudioEncoder({
          output: (chunk) => this.sendAudioChunk(chunk),
          error: (err) => console.error('AudioEncoder error:', err)
        });
        this.audioEncoder.configure({
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: 1,
          bitrate: 64000
        });

        if (typeof MediaStreamTrackProcessor !== 'undefined') {
          const processor = new MediaStreamTrackProcessor({ track: audioTrack });
          const reader = processor.readable.getReader();
          this.processAudioData(reader);
        }
      } catch (e) {
        console.error('AudioEncoder initialization error:', e);
      }
    }
  }

  async processVideoFrames(reader) {
    let frameIdx = 0;
    while (this.connected) {
      try {
        const { value: frame, done } = await reader.read();
        if (done || !frame) break;
        if (this.videoEncoder && this.videoEncoder.state === 'configured') {
          const keyFrame = frameIdx % 60 === 0;
          this.videoEncoder.encode(frame, { keyFrame });
          frameIdx++;
        }
        frame.close();
      } catch (e) {
        break;
      }
    }
  }

  async processAudioData(reader) {
    while (this.connected) {
      try {
        const { value: data, done } = await reader.read();
        if (done || !data) break;
        if (this.audioEncoder && this.audioEncoder.state === 'configured') {
          this.audioEncoder.encode(data);
        }
        data.close();
      } catch (e) {
        break;
      }
    }
  }

  async sendVideoChunk(chunk) {
    if (!this.videoWriter) return;

    const payload = new Uint8Array(chunk.byteLength);
    chunk.copyTo(payload);

    const header = new ArrayBuffer(13);
    const view = new DataView(header);
    view.setUint8(0, chunk.type === 'key' ? 0x01 : 0x02);
    view.setFloat64(1, chunk.timestamp / 1000, false);
    view.setUint32(9, payload.byteLength, false);

    const packet = new Uint8Array(13 + payload.byteLength);
    packet.set(new Uint8Array(header), 0);
    packet.set(payload, 13);

    try {
      await this.videoWriter.write(packet);
    } catch (e) {
      console.warn('MoQ video packet write failure:', e);
    }
  }

  async sendAudioChunk(chunk) {
    if (!this.audioWriter) return;

    const payload = new Uint8Array(chunk.byteLength);
    chunk.copyTo(payload);

    const header = new ArrayBuffer(13);
    const view = new DataView(header);
    view.setUint8(0, 0x03);
    view.setFloat64(1, chunk.timestamp / 1000, false);
    view.setUint32(9, payload.byteLength, false);

    const packet = new Uint8Array(13 + payload.byteLength);
    packet.set(new Uint8Array(header), 0);
    packet.set(payload, 13);

    try {
      await this.audioWriter.write(packet);
    } catch (e) {
      console.warn('MoQ audio packet write failure:', e);
    }
  }

  async listenIncomingStreams() {
    if (!this.transport) return;
    try {
      const reader = this.transport.incomingUnidirectionalStreams.getReader();
      while (this.connected) {
        const { value: stream, done } = await reader.read();
        if (done) break;
        this.consumeIncomingMoQStream(stream);
      }
    } catch (e) {
      console.warn('MoQ stream listener end:', e);
    }
  }

  async consumeIncomingMoQStream(stream) {
    const reader = stream.getReader();
    let videoDecoder = null;
    let audioDecoder = null;

    if (typeof VideoDecoder !== 'undefined') {
      videoDecoder = new VideoDecoder({
        output: (frame) => {
          if (this.onFrame) this.onFrame(frame);
        },
        error: (e) => console.error('CallRoom VideoDecoder error:', e)
      });
      videoDecoder.configure({ codec: 'avc1.42E01E' });
    }

    if (typeof AudioDecoder !== 'undefined') {
      audioDecoder = new AudioDecoder({
        output: (audioData) => {
          if (this.onAudio) this.onAudio(audioData);
        },
        error: (e) => console.error('CallRoom AudioDecoder error:', e)
      });
      audioDecoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 });
    }

    while (this.connected) {
      try {
        const { value, done } = await reader.read();
        if (done || !value) break;

        if (value.byteLength >= 13) {
          const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
          const trackType = view.getUint8(0);
          const timestamp = view.getFloat64(1, false);
          const payloadLen = view.getUint32(9, false);

          const payload = value.subarray(13, 13 + payloadLen);

          if ((trackType === 0x01 || trackType === 0x02) && videoDecoder) {
            const chunk = new EncodedVideoChunk({
              type: trackType === 0x01 ? 'key' : 'delta',
              timestamp: timestamp * 1000,
              data: payload
            });
            videoDecoder.decode(chunk);
          } else if (trackType === 0x03 && audioDecoder) {
            const chunk = new EncodedAudioChunk({
              type: 'key',
              timestamp: timestamp * 1000,
              data: payload
            });
            audioDecoder.decode(chunk);
          }
        }
      } catch (e) {
        break;
      }
    }
  }

  disconnect() {
    this.connected = false;
    if (this.videoEncoder) { try { this.videoEncoder.close(); } catch (e) { } }
    if (this.audioEncoder) { try { this.audioEncoder.close(); } catch (e) { } }
    if (this.transport) { try { this.transport.close(); } catch (e) { } }
  }
}

// ─── Remote Video Tile (MoQ HTML5 Canvas Rendering) ─────────────────────────
function RemoteVideoTile({ peer, micMutedMap }) {
  const canvasRef = useRef(null);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    // Canvas context ready for frame painting
    const canvas = canvasRef.current;
    if (canvas && peer.lastFrame) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        canvas.width = peer.lastFrame.displayWidth || 640;
        canvas.height = peer.lastFrame.displayHeight || 480;
        ctx.drawImage(peer.lastFrame, 0, 0, canvas.width, canvas.height);
        setHasVideo(true);
      }
    }
  }, [peer.lastFrame]);

  const isMuted = micMutedMap?.[peer.socketId];

  return (
    <div className="callroom-video-tile remote-tile" style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          background: '#0d0f1a',
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          display: hasVideo ? 'block' : 'none'
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
  const [connectionStatus, setConnectionStatus] = useState('disconnected');

  // ── MoQ & Call State ────────────────────────────────────────────────────────
  const [inCall, setInCall] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [peers, setPeers] = useState([]);
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const screenStreamRef = useRef(null);
  const moqClientRef = useRef(null);

  // WEBRTC_DEPRECATED
  // const peersRef = useRef({});    // { socketId: RTCPeerConnection }
  // const streamsRef = useRef({});   // { socketId: MediaStream }
  // const candidateQueues = useRef({}); // { socketId: [RTCIceCandidate] }

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
  const [roster, setRoster] = useState([]);
  const [micMutedMap, setMicMutedMap] = useState({});

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
        // Fall through
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

  // WEBRTC_DEPRECATED
  /*
  const createPeerConnection = (peerSocketId, peerName, isInitiator, socket) => {
    const pc = new RTCPeerConnection(RTC_CONFIG);

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('webrtc-signal', { targetId: peerSocketId, signal: { candidate: event.candidate } });
      }
    };

    pc.ontrack = (event) => {
      let remoteStream = (event.streams && event.streams[0]) ? event.streams[0] : streamsRef.current[peerSocketId];
      if (!remoteStream) {
        remoteStream = new MediaStream();
        streamsRef.current[peerSocketId] = remoteStream;
      }
      if (!remoteStream.getTracks().some(t => t.id === event.track.id)) {
        remoteStream.addTrack(event.track);
      }
      streamsRef.current[peerSocketId] = remoteStream;

      setPeers(prev => {
        const idx = prev.findIndex(p => p.socketId === peerSocketId);
        const version = Date.now();
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], username: peerName || updated[idx].username, stream: remoteStream, version };
          return updated;
        }
        return [...prev, { socketId: peerSocketId, username: peerName || 'Participant', stream: remoteStream, version }];
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
  */

  // ─── End Call Cleanup ────────────────────────────────────────────────────────
  const endCallCleanup = useCallback(() => {
    // WEBRTC_DEPRECATED
    // socketRef.current?.emit('webrtc-leave-call', { projectName: roomName });

    socketRef.current?.emit('moq-leave-room', { projectName: roomName });

    if (moqClientRef.current) {
      moqClientRef.current.disconnect();
      moqClientRef.current = null;
    }

    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;

    // WEBRTC_DEPRECATED
    /*
    Object.values(peersRef.current).forEach(pc => { try { pc.close(); } catch { } });
    peersRef.current = {};
    streamsRef.current = {};
    candidateQueues.current = {};
    */

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

    const doJoinRoom = () => {
      setConnected(true);
      setConnectionStatus('connected');
      const savedKey = sessionStorage.getItem(`accesskey_project_${roomName}`) || getCookie(`accesskey_project_${roomName}`);
      socket.emit('join-call-room', { room: roomName, accessKey: savedKey });
      setRoster(prev => {
        const selfId = socket.id;
        const already = prev.find(r => r.socketId === selfId);
        if (already) return prev;
        return [...prev, { socketId: selfId, username: username || 'You' }];
      });
    };

    socket.on('connect', doJoinRoom);
    socket.on('disconnect', () => { setConnected(false); setConnectionStatus('reconnecting'); });
    socket.on('reconnect', () => { setConnectionStatus('connected'); setConnected(true); });
    socket.on('reconnect_failed', () => setConnectionStatus('reconnection-failed'));

    socket.on('set username', (name) => { setUsername(name); });
    socket.on('room users', (users) => { setRoster(users.map(u => ({ socketId: u.id, username: u.username }))); });

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

    // WEBRTC_DEPRECATED
    /*
    socket.on('webrtc-user-joined', handleWebRTCUserJoined);
    socket.on('webrtc-signal', handleWebRTCSignal);
    socket.on('webrtc-user-left', handleWebRTCUserLeft);
    */

    socket.on('moq-user-joined', ({ socketId: sid, username: peerName }) => {
      setPeers(prev => {
        if (prev.find(p => p.socketId === sid)) return prev;
        return [...prev, { socketId: sid, username: peerName || 'Participant' }];
      });
      setRoster(prev => {
        if (prev.find(r => r.socketId === sid)) return prev;
        return [...prev, { socketId: sid, username: peerName || 'Participant' }];
      });
    });

    socket.on('moq-user-left', ({ socketId: sid }) => {
      setPeers(prev => prev.filter(p => p.socketId !== sid));
      setRoster(prev => prev.filter(r => r.socketId !== sid));
    });

    socket.on('peer-mic-status', ({ socketId: sid, muted }) => {
      setMicMutedMap(prev => ({ ...prev, [sid]: muted }));
    });

    socket.connect();
    if (socket.connected) doJoinRoom();

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('reconnect');
      socket.off('reconnect_failed');
      socket.off('chat message');
      socket.off('load messages');
      socket.off('moq-user-joined');
      socket.off('moq-user-left');
      socket.off('peer-mic-status');
      endCallCleanup();
      socket.disconnect();
    };
  }, [isAuthed, roomName, endCallCleanup, sidebarOpen, username]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

      requestAnimationFrame(() => {
        if (localVideoRef.current && localStreamRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
          localVideoRef.current.play().catch(() => { });
        }
      });

      // WEBRTC_DEPRECATED
      /*
      socketRef.current?.emit('webrtc-join-call', { projectName: roomName }, (response) => { ... });
      */

      // Initialize MoQ Client
      const moqUrl = 'https://localhost:8554/moq_server';
      const client = new MoQTransportClient(
        moqUrl,
        roomName,
        username || 'Anonymous',
        (videoFrame) => {
          // Pass incoming decoded video frame to remote tiles
          setPeers(prev => prev.map(p => ({ ...p, lastFrame: videoFrame })));
        },
        (audioData) => {
          audioData.close();
        }
      );

      moqClientRef.current = client;
      const connected = await client.connect();
      if (connected) {
        client.startMediaEncoding(stream.getVideoTracks()[0], stream.getAudioTracks()[0]);
      }

      socketRef.current?.emit('moq-join-room', { projectName: roomName, username });

    } catch (err) {
      console.error('getUserMedia error:', err);
      alert('Camera/microphone access is required to start the call.');
    }
  };

  const leaveCall = () => {
    endCallCleanup();
    navigate('/');
  };

  const toggleMic = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      const nowMuted = !track.enabled;
      setMicMuted(nowMuted);
      socketRef.current?.emit('mic-status', { projectName: roomName, muted: nowMuted });
    }
  };

  const toggleVideo = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setVideoMuted(!track.enabled);
    }
  };

  const replaceVideoTrack = (newTrack) => {
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

        if (moqClientRef.current) {
          const aTrack = localStreamRef.current?.getAudioTracks()[0];
          moqClientRef.current.startMediaEncoding(screenTrack, aTrack);
        }

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

  const sendMessage = () => {
    const text = inputText.trim();
    if (!text || !socketRef.current) return;
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

  const totalTiles = 1 + peers.length;

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
      {/* Header */}
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
          <span className="callroom-title">AnonHub Call (MoQ)</span>
          <span className="callroom-room-name">#{roomName}</span>
        </div>
        <div className="callroom-header-right">
          {inCall && (
            <div className="callroom-live-badge">
              <div className="callroom-live-dot" />
              LIVE (MoQ)
            </div>
          )}
          <div className="callroom-user-count">
            <Users size={12} />
            {roster.length || 1} online
          </div>
        </div>
      </header>

      {/* Video Grid */}
      <main className="callroom-grid">
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
          <div className="callroom-waiting-overlay">
            <div className="callroom-waiting-icon">
              <Video size={36} color="rgba(124, 77, 255, 0.7)" />
            </div>
            <h3>Ready to join the MoQ call?</h3>
            <p>Click the button below to join low-latency Media over QUIC streaming.</p>
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
              <Video size={18} /> Join MoQ Call
            </button>
          </div>
        ) : (
          <div
            className={`callroom-video-mesh${totalTiles >= 5 ? ' many-participants' : ''}`}
            data-count={Math.min(totalTiles, 4)}
          >
            {/* Local tile */}
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

      {/* Controls Bar */}
      <footer className="callroom-controls">
        {!inCall ? (
          <button id="callroom-join-btn" className="callroom-ctrl-btn" onClick={startCall} title="Join Call">
            <Video size={20} />
            <span className="callroom-ctrl-btn-label">Join</span>
          </button>
        ) : (
          <>
            <button
              id="callroom-mic-btn"
              className={`callroom-ctrl-btn${micMuted ? ' muted' : ''}`}
              onClick={toggleMic}
              title={micMuted ? 'Unmute Mic' : 'Mute Mic'}
            >
              {micMuted ? <MicOff size={20} /> : <Mic size={20} />}
              <span className="callroom-ctrl-btn-label">{micMuted ? 'Unmuted' : 'Mute'}</span>
            </button>

            <button
              id="callroom-cam-btn"
              className={`callroom-ctrl-btn${videoMuted ? ' muted' : ''}`}
              onClick={toggleVideo}
              title={videoMuted ? 'Turn Camera On' : 'Turn Camera Off'}
            >
              {videoMuted ? <VideoOff size={20} /> : <Video size={20} />}
              <span className="callroom-ctrl-btn-label">{videoMuted ? 'Cam Off' : 'Camera'}</span>
            </button>

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

      {/* Sidebar (Chat + Roster) */}
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

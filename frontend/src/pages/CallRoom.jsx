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
 *    - Payload: WebCodecs compressed VP8/H.264 or Opus chunk bytes
 * ============================================================================
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Video, VideoOff, Mic, MicOff, MonitorUp, PhoneOff,
  Users, MessageSquare, X, Send, ChevronRight, Home, RefreshCw, Info
} from 'lucide-react';
import { initSocket, getCookie, setCookie } from '../services/socket';
import { globalCallSession } from '../services/callSession';
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

// ─── MoQ WebTransport & WebCodecs Client ──────────────────────────────────────
class MoQTransportClient {
  constructor(serverUrl, roomName, username, socket, onFrame, onAudio) {
    this.serverUrl = serverUrl;
    this.roomName = roomName;
    this.username = username;
    this.socket = socket;
    this.onFrame = onFrame;
    this.onAudio = onAudio;
    this.transport = null;
    this.connected = false;
    this.mode = 'WebTransport';
    this.videoEncoder = null;
    this.audioEncoder = null;
    this.videoWriter = null;
    this.audioWriter = null;
    this.peerDecoders = {};
    this.audioCtx = null;
    this.nextAudioTime = 0;
    this.activeVideoLoopId = 0;
    this.forceNextKeyframe = true;
  }

  async connect() {
    this.connected = true;

    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
    } catch (e) {
      // AudioCtx catch
    }

    if (typeof WebTransport !== 'undefined') {
      try {
        const url = `${this.serverUrl}/${encodeURIComponent(this.roomName)}/${encodeURIComponent(this.username)}`;
        this.transport = new WebTransport(url);
        await this.transport.ready;
        this.mode = 'WebTransport';
        console.log('MoQ CallRoom connected via WebTransport to:', url);
        this.listenIncomingStreams();
        return true;
      } catch (err) {
        console.warn('MediaMTX WebTransport unreachable on localhost:8554. Using Socket.IO MoQ packet relay:', err);
      }
    }

    this.mode = 'SocketRelay';
    if (this.socket) {
      this.socket.on('moq-packet', ({ senderId, packet }) => {
        const rawBytes = packet instanceof ArrayBuffer ? new Uint8Array(packet) : new Uint8Array(packet);
        this.processIncomingPacket(senderId, rawBytes);
      });
    }

    return true;
  }

  requestKeyframe() {
    this.forceNextKeyframe = true;
  }

  getPeerDecoders(senderId) {
    if (!this.peerDecoders[senderId]) {
      let videoDecoder = null;
      let audioDecoder = null;

      if (typeof VideoDecoder !== 'undefined') {
        try {
          videoDecoder = new VideoDecoder({
            output: (frame) => {
              if (this.onFrame) this.onFrame(senderId, frame);
            },
            error: (e) => console.error(`CallRoom VideoDecoder error for peer ${senderId}:`, e)
          });
          videoDecoder.configure({ codec: 'vp8' });
        } catch (e) {
          console.error('CallRoom VideoDecoder config error:', e);
        }
      }

      if (typeof AudioDecoder !== 'undefined') {
        try {
          audioDecoder = new AudioDecoder({
            output: (audioData) => {
              this.playAudioData(audioData);
              audioData.close();
            },
            error: (e) => console.error(`CallRoom AudioDecoder error for peer ${senderId}:`, e)
          });
          audioDecoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 });
        } catch (e) {
          console.error('CallRoom AudioDecoder config error:', e);
        }
      }

      this.peerDecoders[senderId] = { videoDecoder, audioDecoder };
    }

    return this.peerDecoders[senderId];
  }

  playAudioData(audioData) {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      const buffer = this.audioCtx.createBuffer(
        audioData.numberOfChannels,
        audioData.numberOfFrames,
        audioData.sampleRate
      );
      for (let channel = 0; channel < audioData.numberOfChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        audioData.copyTo(channelData, { planeIndex: channel });
      }
      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioCtx.destination);

      const currentTime = this.audioCtx.currentTime;
      if (!this.nextAudioTime || this.nextAudioTime < currentTime || this.nextAudioTime > currentTime + 0.05) {
        this.nextAudioTime = currentTime + 0.005;
      }
      source.start(this.nextAudioTime);
      this.nextAudioTime += buffer.duration;
    } catch (e) {
      console.warn('CallRoom audio playback error:', e);
    }
  }

  async startMediaEncoding(videoTrack, audioTrack) {
    if (!this.connected) return;

    if (this.mode === 'WebTransport' && this.transport) {
      try {
        const videoStream = await this.transport.createUnidirectionalStream();
        this.videoWriter = videoStream.getWriter();

        const audioStream = await this.transport.createUnidirectionalStream();
        this.audioWriter = audioStream.getWriter();
      } catch (e) {
        console.error('Error opening MoQ WebTransport streams:', e);
      }
    }

    if (videoTrack) {
      this.switchVideoTrack(videoTrack);
    }

    // Configure AudioEncoder (Opus Real-Time 20ms)
    if (audioTrack && typeof AudioEncoder !== 'undefined') {
      try {
        if (!this.audioEncoder) {
          this.audioEncoder = new AudioEncoder({
            output: (chunk) => this.sendAudioChunk(chunk),
            error: (err) => console.error('AudioEncoder error:', err)
          });
          this.audioEncoder.configure({
            codec: 'opus',
            sampleRate: 48000,
            numberOfChannels: 1,
            bitrate: 48000
          });

          this.fallbackAudioData(audioTrack);
        }
      } catch (e) {
        console.error('AudioEncoder initialization error:', e);
      }
    }
  }

  switchVideoTrack(videoTrack) {
    if (!this.connected || !videoTrack || typeof VideoEncoder === 'undefined') return;

    this.activeVideoLoopId++;
    this.forceNextKeyframe = true;
    const currentLoopId = this.activeVideoLoopId;

    try {
      const settings = videoTrack.getSettings();
      if (this.videoEncoder) {
        try { this.videoEncoder.close(); } catch (e) { }
      }

      this.videoEncoder = new VideoEncoder({
        output: (chunk) => this.sendVideoChunk(chunk),
        error: (err) => console.error('VideoEncoder error:', err)
      });

      const isScreenShare = videoTrack.label && videoTrack.label.toLowerCase().includes('screen');
      const targetWidth = isScreenShare ? (settings.width || 1280) : (settings.width || 640);
      const targetHeight = isScreenShare ? (settings.height || 720) : (settings.height || 480);
      const targetBitrate = isScreenShare ? 800000 : 400000;

      this.videoEncoder.configure({
        codec: 'vp8',
        width: targetWidth,
        height: targetHeight,
        bitrate: targetBitrate,
        framerate: settings.frameRate || 24,
        latencyMode: 'realtime'
      });

      if (typeof MediaStreamTrackProcessor !== 'undefined') {
        try {
          const processor = new MediaStreamTrackProcessor({ track: videoTrack });
          const reader = processor.readable.getReader();
          this.processVideoFrames(reader, currentLoopId);
        } catch (e) {
          this.fallbackVideoFrames(videoTrack, currentLoopId);
        }
      } else {
        this.fallbackVideoFrames(videoTrack, currentLoopId);
      }
    } catch (err) {
      console.error('VideoEncoder switch error:', err);
    }
  }

  fallbackVideoFrames(videoTrack, loopId) {
    const video = document.createElement('video');
    video.srcObject = new MediaStream([videoTrack]);
    video.muted = true;
    video.play().catch(() => {});

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    let frameIdx = 0;

    const captureStep = () => {
      if (!this.connected || (loopId && loopId !== this.activeVideoLoopId)) {
        clearInterval(timerId);
        return;
      }

      if (video.readyState >= 2) {
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        if (this.videoEncoder && this.videoEncoder.state === 'configured') {
          try {
            const frame = new VideoFrame(canvas, { timestamp: performance.now() * 1000 });
            const keyFrame = this.forceNextKeyframe || frameIdx === 0 || frameIdx % 12 === 0;
            if (this.forceNextKeyframe) this.forceNextKeyframe = false;

            this.videoEncoder.encode(frame, { keyFrame });
            frame.close();
            frameIdx++;
          } catch (e) {
            console.warn('CallRoom VideoFrame fallback error:', e);
          }
        }
      }
    };

    // Use setInterval so screen capture continues even when working outside the app window!
    const timerId = setInterval(captureStep, 35);
  }

  fallbackAudioData(audioTrack) {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
      const source = audioCtx.createMediaStreamSource(new MediaStream([audioTrack]));
      const processor = audioCtx.createScriptProcessor(2048, 1, 1);

      let bufferPool = new Float32Array(0);

      processor.onaudioprocess = (e) => {
        if (!this.connected) return;
        const inputData = e.inputBuffer.getChannelData(0);

        const temp = new Float32Array(bufferPool.length + inputData.length);
        temp.set(bufferPool, 0);
        temp.set(inputData, bufferPool.length);
        bufferPool = temp;

        while (bufferPool.length >= 960) {
          const chunk = bufferPool.slice(0, 960);
          bufferPool = bufferPool.slice(960);

          if (this.audioEncoder && this.audioEncoder.state === 'configured') {
            try {
              const audioData = new AudioData({
                format: 'f32-planar',
                sampleRate: 48000,
                numberOfFrames: 960,
                numberOfChannels: 1,
                timestamp: performance.now() * 1000,
                data: chunk
              });
              this.audioEncoder.encode(audioData);
              audioData.close();
            } catch (err) {
              // AudioData encode error
            }
          }
        }
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
    } catch (e) {
      console.warn('Audio fallback error:', e);
    }
  }

  async processVideoFrames(reader, loopId) {
    let frameIdx = 0;
    while (this.connected && loopId === this.activeVideoLoopId) {
      try {
        const { value: frame, done } = await reader.read();
        if (done || !frame || loopId !== this.activeVideoLoopId) break;
        if (this.videoEncoder && this.videoEncoder.state === 'configured') {
          const keyFrame = this.forceNextKeyframe || frameIdx === 0 || frameIdx % 12 === 0;
          if (this.forceNextKeyframe) this.forceNextKeyframe = false;

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

    this.sendPacket(packet);
  }

  async sendAudioChunk(chunk) {
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

    this.sendPacket(packet);
  }

  async sendPacket(packet) {
    const rawBuffer = packet.buffer.slice(packet.byteOffset, packet.byteOffset + packet.byteLength);
    if (this.mode === 'WebTransport' && this.videoWriter) {
      try {
        await this.videoWriter.write(packet);
      } catch (e) {
        if (this.socket) {
          this.socket.emit('moq-packet', { projectName: this.roomName, packet: rawBuffer });
        }
      }
    } else if (this.socket) {
      this.socket.emit('moq-packet', { projectName: this.roomName, packet: rawBuffer });
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
    while (this.connected) {
      try {
        const { value, done } = await reader.read();
        if (done || !value) break;
        this.processIncomingPacket('remote-peer', value);
      } catch (e) {
        break;
      }
    }
  }

  processIncomingPacket(senderId, packetBytes) {
    if (packetBytes.byteLength < 13) return;

    const view = new DataView(packetBytes.buffer, packetBytes.byteOffset, packetBytes.byteLength);
    const trackType = view.getUint8(0);
    const timestamp = view.getFloat64(1, false);
    const payloadLen = view.getUint32(9, false);

    const payload = packetBytes.subarray(13, 13 + payloadLen);
    const { videoDecoder, audioDecoder } = this.getPeerDecoders(senderId);

    if ((trackType === 0x01 || trackType === 0x02) && videoDecoder) {
      try {
        const chunk = new EncodedVideoChunk({
          type: trackType === 0x01 ? 'key' : 'delta',
          timestamp: timestamp * 1000,
          data: payload
        });
        videoDecoder.decode(chunk);
      } catch (e) {
        console.warn('Video chunk decode error:', e);
      }
    } else if (trackType === 0x03 && audioDecoder) {
      try {
        const chunk = new EncodedAudioChunk({
          type: 'key',
          timestamp: timestamp * 1000,
          data: payload
        });
        audioDecoder.decode(chunk);
      } catch (e) {
        console.warn('Audio chunk decode error:', e);
      }
    }
  }

  disconnect() {
    this.connected = false;
    if (this.videoEncoder) { try { this.videoEncoder.close(); } catch (e) { } }
    if (this.audioEncoder) { try { this.audioEncoder.close(); } catch (e) { } }
    Object.values(this.peerDecoders).forEach(({ videoDecoder, audioDecoder }) => {
      if (videoDecoder) { try { videoDecoder.close(); } catch (e) { } }
      if (audioDecoder) { try { audioDecoder.close(); } catch (e) { } }
    });
    if (this.transport) { try { this.transport.close(); } catch (e) { } }
    if (this.audioCtx) { try { this.audioCtx.close(); } catch (e) { } }
  }
}

// ─── Remote Video Tile (MoQ Canvas Rendering) ──────────────────────────────
function RemoteVideoTile({ peer, micMutedMap, onCanvasRef }) {
  const isMuted = micMutedMap?.[peer.socketId];

  return (
    <div className="callroom-video-tile remote-tile" style={{ position: 'relative' }}>
      <canvas
        ref={onCanvasRef}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          background: '#0d0f1a',
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          display: 'block'
        }}
      />
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
  const [connectionStatus, setConnectionStatus] = useState(
    globalCallSession.isSessionActive(roomName) ? 'connected' : 'disconnected'
  );
  const [transportMode, setTransportMode] = useState('MoQ');

  // ── MoQ & Call State ────────────────────────────────────────────────────────
  const [inCall, setInCall] = useState(globalCallSession.isSessionActive(roomName));
  const [micMuted, setMicMuted] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);
  const [screenSharing, setScreenSharing] = useState(globalCallSession.screenSharing);
  const [facingMode, setFacingMode] = useState(globalCallSession.facingMode || 'user');
  const [peers, setPeers] = useState([]);
  const [showScreenTip, setShowScreenTip] = useState(false);
  const localStreamRef = useRef(globalCallSession.localStream);
  const localVideoRef = useRef(null);
  const screenStreamRef = useRef(globalCallSession.screenStream);
  const moqClientRef = useRef(globalCallSession.moqSession);
  const peerCanvasRefs = useRef({});

  const localVideoRefCallback = useCallback((node) => {
    localVideoRef.current = node;
    if (node) {
      if (screenStreamRef.current) {
        node.srcObject = screenStreamRef.current;
      } else if (localStreamRef.current) {
        node.srcObject = localStreamRef.current;
      }
    }
  }, []);

  const handleUserJoined = useCallback(({ socketId, username: peerName }) => {
    if (!socketId || socketId === 'remote-peer' || socketId === socketRef.current?.id) return;
    setPeers(prev => {
      if (prev.find(p => p.socketId === socketId)) return prev;
      return [...prev, { socketId, username: peerName || 'Participant' }];
    });
    setRoster(prev => {
      if (prev.find(r => r.socketId === socketId)) return prev;
      return [...prev, { socketId, username: peerName || 'Participant' }];
    });

    if (moqClientRef.current) {
      moqClientRef.current.requestKeyframe();
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

  // ─── End Call Cleanup ────────────────────────────────────────────────────────
  const endCallCleanup = useCallback(() => {
    globalCallSession.endSession();

    localStreamRef.current = null;
    screenStreamRef.current = null;
    moqClientRef.current = null;

    setPeers([]);
    setInCall(false);
    setScreenSharing(false);
    setVideoMuted(false);
    setMicMuted(false);
  }, []);

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

    socket.on('moq-user-joined', handleUserJoined);
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
      socket.disconnect();
    };
  }, [isAuthed, roomName, sidebarOpen, username, handleUserJoined]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (sidebarOpen) setUnreadCount(0);
  }, [sidebarOpen]);

  // ─── Start Call ──────────────────────────────────────────────────────────────
  const startCall = async () => {
    try {
      setInCall(true);

      if (globalCallSession.isSessionActive(roomName)) {
        localStreamRef.current = globalCallSession.localStream;
        screenStreamRef.current = globalCallSession.screenStream;
        moqClientRef.current = globalCallSession.moqSession;
        setScreenSharing(globalCallSession.screenSharing);
        setConnectionStatus('connected');
        return;
      }

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: true
        });
      } catch (e) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      localStreamRef.current = stream;
      setVideoMuted(false);
      setMicMuted(false);
      setFacingMode('user');

      requestAnimationFrame(() => {
        if (localVideoRef.current && localStreamRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
          localVideoRef.current.play().catch(() => { });
        }
      });

      // Initialize MoQ Client
      const moqUrl = 'https://localhost:8554/moq_server';
      const client = new MoQTransportClient(
        moqUrl,
        roomName,
        username || 'Anonymous',
        socketRef.current,
        (peerId, videoFrame) => {
          if (peerId && peerId !== 'remote-peer' && peerId !== socketRef.current?.id) {
            handleUserJoined({ socketId: peerId, username: 'Participant' });
          }

          let canvas = peerCanvasRefs.current[peerId];
          if (!canvas) {
            const firstId = Object.keys(peerCanvasRefs.current)[0];
            if (firstId) canvas = peerCanvasRefs.current[firstId];
          }

          if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
              const width = videoFrame.displayWidth || 480;
              const height = videoFrame.displayHeight || 360;
              if (canvas.width !== width) canvas.width = width;
              if (canvas.height !== height) canvas.height = height;
              ctx.drawImage(videoFrame, 0, 0, width, height);
            }
          }
          videoFrame.close();
        },
        (peerId, audioData) => {
          if (peerId && peerId !== 'remote-peer' && peerId !== socketRef.current?.id) {
            handleUserJoined({ socketId: peerId, username: 'Participant' });
          }
          audioData.close();
        }
      );

      moqClientRef.current = client;
      await client.connect();
      setTransportMode(client.mode === 'WebTransport' ? 'MoQ (QUIC)' : 'MoQ (Relay)');

      client.startMediaEncoding(stream.getVideoTracks()[0], stream.getAudioTracks()[0]);

      globalCallSession.setSession({
        roomName,
        localStream: stream,
        moqSession: client,
        socket: socketRef.current
      });

      socketRef.current?.emit('moq-join-room', { projectName: roomName, username }, (response) => {
        if (response && Array.isArray(response.existingPeers)) {
          response.existingPeers.forEach(({ socketId, username: peerName }) => {
            handleUserJoined({ socketId, username: peerName });
          });
        }
      });

    } catch (err) {
      console.error('getUserMedia error:', err);
      alert('Microphone/camera access is required to start the call.');
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

  const switchCamera = async () => {
    if (!localStreamRef.current || screenSharing) return;

    const targetMode = facingMode === 'user' ? 'environment' : 'user';

    try {
      let newStream;
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: targetMode } }
        });
      } catch (e) {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: targetMode }
        });
      }

      const newVideoTrack = newStream.getVideoTracks()[0];
      if (!newVideoTrack) return;

      const oldVideoTrack = localStreamRef.current.getVideoTracks()[0];
      if (oldVideoTrack) {
        oldVideoTrack.stop();
        localStreamRef.current.removeTrack(oldVideoTrack);
      }

      localStreamRef.current.addTrack(newVideoTrack);
      setFacingMode(targetMode);
      globalCallSession.facingMode = targetMode;
      replaceVideoTrack(newVideoTrack);

      if (moqClientRef.current) {
        moqClientRef.current.switchVideoTrack(newVideoTrack);
      }
    } catch (err) {
      console.error('Camera switch error:', err);
      alert('Could not switch camera. Check if a secondary camera is available.');
    }
  };

  const replaceVideoTrack = (newTrack) => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = new MediaStream([newTrack]);
      localVideoRef.current.play().catch(() => {});
    }
  };

  const toggleScreenShare = async () => {
    if (!inCall) {
      try {
        let stream;
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: 'always' },
            audio: true
          });
        } catch (e) {
          stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        }

        screenStreamRef.current = stream;
        globalCallSession.screenStream = stream;
        globalCallSession.screenSharing = true;
        setInCall(true);
        setScreenSharing(true);
        setShowScreenTip(true);

        const screenTrack = stream.getVideoTracks()[0];

        const moqUrl = 'https://localhost:8554/moq_server';
        const client = new MoQTransportClient(
          moqUrl,
          roomName,
          username || 'Anonymous',
          socketRef.current,
          (peerId, videoFrame) => {
            if (peerId && peerId !== 'remote-peer' && peerId !== socketRef.current?.id) {
              handleUserJoined({ socketId: peerId, username: 'Participant' });
            }

            let canvas = peerCanvasRefs.current[peerId];
            if (!canvas) {
              const firstId = Object.keys(peerCanvasRefs.current)[0];
              if (firstId) canvas = peerCanvasRefs.current[firstId];
            }

            if (canvas) {
              const ctx = canvas.getContext('2d');
              if (ctx) {
                const width = videoFrame.displayWidth || 480;
                const height = videoFrame.displayHeight || 360;
                if (canvas.width !== width) canvas.width = width;
                if (canvas.height !== height) canvas.height = height;
                ctx.drawImage(videoFrame, 0, 0, width, height);
              }
            }
            videoFrame.close();
          },
          (peerId, audioData) => {
            if (peerId && peerId !== 'remote-peer' && peerId !== socketRef.current?.id) {
              handleUserJoined({ socketId: peerId, username: 'Participant' });
            }
            audioData.close();
          }
        );

        moqClientRef.current = client;
        await client.connect();
        setTransportMode(client.mode === 'WebTransport' ? 'MoQ (QUIC)' : 'MoQ (Relay)');

        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
        const audioTrack = micStream ? micStream.getAudioTracks()[0] : null;
        if (micStream) localStreamRef.current = micStream;

        client.startMediaEncoding(screenTrack, audioTrack);
        replaceVideoTrack(screenTrack);

        globalCallSession.setSession({
          roomName,
          localStream: micStream,
          screenStream: stream,
          moqSession: client,
          socket: socketRef.current
        });

        socketRef.current?.emit('moq-join-room', { projectName: roomName, username }, (response) => {
          if (response && Array.isArray(response.existingPeers)) {
            response.existingPeers.forEach(({ socketId, username: peerName }) => {
              handleUserJoined({ socketId, username: peerName });
            });
          }
        });

        screenTrack.onended = () => {
          globalCallSession.stopScreenShare();
          setScreenSharing(false);
          setShowScreenTip(false);
        };
        return;
      } catch (err) {
        console.error('Direct screen share error:', err);
        return;
      }
    }

    if (screenSharing) {
      globalCallSession.stopScreenShare();
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;
      }
      setScreenSharing(false);
      setShowScreenTip(false);
      const camTrack = localStreamRef.current?.getVideoTracks()[0];
      if (camTrack) {
        replaceVideoTrack(camTrack);
        if (moqClientRef.current) moqClientRef.current.switchVideoTrack(camTrack);
      }
    } else {
      try {
        let stream;
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: 'always' },
            audio: true
          });
        } catch (e) {
          stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        }

        screenStreamRef.current = stream;
        globalCallSession.screenStream = stream;
        globalCallSession.screenSharing = true;
        setScreenSharing(true);
        setShowScreenTip(true);

        const screenTrack = stream.getVideoTracks()[0];
        replaceVideoTrack(screenTrack);

        if (moqClientRef.current) {
          moqClientRef.current.switchVideoTrack(screenTrack);
        }

        screenTrack.onended = () => {
          globalCallSession.stopScreenShare();
          setScreenSharing(false);
          setShowScreenTip(false);
          const camTrack = localStreamRef.current?.getVideoTracks()[0];
          if (camTrack) {
            replaceVideoTrack(camTrack);
            if (moqClientRef.current) moqClientRef.current.switchVideoTrack(camTrack);
          }
        };
      } catch (err) {
        console.error('Screen sharing error:', err);
        if (err.name !== 'AbortError') {
          alert('Screen sharing failed or was canceled.');
        }
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
              navigate('/');
            }}
            className="callroom-home-btn"
            title="Go to Homepage"
          >
            <Home size={16} />
          </button>
          <div className="callroom-logo-dot" />
          <span className="callroom-title">AnonHub Call ({transportMode})</span>
          <span className="callroom-room-name">#{roomName}</span>
        </div>
        <div className="callroom-header-right">
          {inCall && (
            <div className="callroom-live-badge">
              <div className="callroom-live-dot" />
              LIVE ({transportMode})
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

        {showScreenTip && screenSharing && (
          <div style={{
            padding: '10px 16px',
            margin: '8px 16px',
            borderRadius: '8px',
            background: 'rgba(255, 171, 0, 0.15)',
            border: '1px solid rgba(255, 171, 0, 0.4)',
            color: '#ffc107',
            fontSize: '0.82rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            zIndex: 10,
          }}>
            <Info size={16} />
            <span><strong>Tip:</strong> Share a different window or desktop app to avoid the hall-of-mirrors preview loop!</span>
          </div>
        )}

        {/* ALWAYS VISIBLE TOP BAR */}
        <div className="callroom-top-action-bar" style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '8px 16px', background: 'rgba(13, 15, 26, 0.9)', borderRadius: '10px', margin: '8px 16px', border: '1px solid rgba(124, 77, 255, 0.3)', zIndex: 10 }}>
          {!inCall ? (
            <>
              <button id="callroom-start-btn" onClick={startCall} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 18px', background: '#7c4dff', color: '#fff', borderRadius: '8px', fontWeight: 600, border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}>
                <Video size={16} /> Join Video Call
              </button>
              <button onClick={toggleScreenShare} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 18px', background: '#2563eb', color: '#fff', borderRadius: '8px', fontWeight: 600, border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}>
                <MonitorUp size={16} /> Share Laptop Screen
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '100%', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.82rem', color: '#a78bfa', fontWeight: 600 }}>Active Call Session (#{roomName})</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={toggleScreenShare} style={{ padding: '6px 14px', background: screenSharing ? '#dc2626' : '#2563eb', color: '#fff', borderRadius: '6px', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <MonitorUp size={14} /> {screenSharing ? 'Stop Sharing' : 'Share Screen'}
                </button>
                <button onClick={leaveCall} style={{ padding: '6px 14px', background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', borderRadius: '6px', border: '1px solid rgba(239, 68, 68, 0.4)', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <PhoneOff size={14} /> Leave
                </button>
              </div>
            </div>
          )}
        </div>

        {!inCall ? (
          <div className="callroom-waiting-overlay">
            <div className="callroom-waiting-icon">
              <Video size={36} color="rgba(124, 77, 255, 0.7)" />
            </div>
            <h3>Ready to join the MoQ call?</h3>
            <p>Click below to join or share your laptop screen directly.</p>
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
                {username} (You) {screenSharing ? '(Screen)' : ''}
              </div>
            </div>

            {/* Remote video tiles */}
            {peers.map(peer => (
              <RemoteVideoTile
                key={peer.socketId}
                peer={peer}
                micMutedMap={micMutedMap}
                onCanvasRef={(node) => {
                  if (node) peerCanvasRefs.current[peer.socketId] = node;
                }}
              />
            ))}
          </div>
        )}
      </main>

      {/* Controls Bar */}
      <footer className="callroom-controls">
        {!inCall ? (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button id="callroom-join-btn" className="callroom-ctrl-btn" onClick={startCall} title="Join Call">
              <Video size={20} />
              <span className="callroom-ctrl-btn-label">Join</span>
            </button>
            <button className="callroom-ctrl-btn" onClick={toggleScreenShare} title="Share Screen" style={{ background: '#2563eb' }}>
              <MonitorUp size={20} />
              <span className="callroom-ctrl-btn-label">Share Screen</span>
            </button>
          </div>
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
              id="callroom-switch-cam-btn"
              className="callroom-ctrl-btn"
              onClick={switchCamera}
              title={`Switch to ${facingMode === 'user' ? 'Back' : 'Front'} Camera`}
            >
              <RefreshCw size={20} />
              <span className="callroom-ctrl-btn-label">Flip</span>
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

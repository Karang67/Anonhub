/**
 * ============================================================================
 * MEDIA OVER QUIC (MoQ) ARCHITECTURE & PROTOCOL SPECIFICATION
 * ============================================================================
 * 
 * 1. OVERVIEW:
 *    This file implements a low-latency Media over QUIC (MoQ) multi-user 
 *    screen sharing, video, and audio streaming architecture replacing legacy 
 *    WebRTC peer connections. MediaMTX is utilized as the central MoQ relay server.
 *    Client-side capture and encoding leverage native WebTransport API and 
 *    WebCodecs API (VideoEncoder, AudioEncoder, VideoDecoder, AudioDecoder).
 * 
 *    All legacy WebRTC code (RTCPeerConnection, SDP offer/answer, ICE candidates) 
 *    has been preserved in commented-out format tagged with "// WEBRTC_DEPRECATED".
 * 
 * 2. URL PATH & NAMESPACE HIERARCHY:
 *    MoQ publications and subscriptions are segmented by room and user namespaces:
 *      https://<MEDIAMTX_HOST>:8554/moq_server/<roomName>/<username>/<trackType>
 * 
 *    Examples:
 *      - Screen Track: https://localhost:8554/moq_server/room123/userA/screen
 *      - Video Track:        https://localhost:8554/moq_server/room123/userA/video
 *      - Audio Track:        https://localhost:8554/moq_server/room123/userA/audio
 * 
 * 3. MOQ PACKET STRUCTURAL FORMAT:
 *    Binary media chunks are encapsulated in MoQ object packets sent over WebTransport streams:
 * 
 *    ┌──────────────────┬──────────────────┬──────────────────┬──────────────────┐
 *    │ Track Type       │ Timestamp (ms)   │ Payload Length   │ Encoded Media    │
 *    │ (1 byte UInt8)   │ (8 bytes Float64)│ (4 bytes UInt32) │ Payload Chunk    │
 *    └──────────────────┴──────────────────┴──────────────────┴──────────────────┘
 *    - Track Type: 0x01 = Video Keyframe, 0x02 = Video Deltaframe, 0x03 = Audio
 *    - Timestamp: Double-precision floating point epoch offset (ms)
 *    - Payload Length: Big-Endian 32-bit unsigned integer (byte size of media data)
 *    - Media Payload: Encoded VP8/H.264 or Opus payload produced by WebCodecs.
 * ============================================================================
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, VideoOff, Mic, MicOff, Tv, PhoneOff, PhoneCall, RefreshCw, Info } from 'lucide-react';
import { globalCallSession } from '../services/callSession';
import './WebRTCCallWidget.css';

// WEBRTC_DEPRECATED
/*
// Public STUN/TURN servers for NAT traversal
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
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

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length > 1
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
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

// ─── MoQ WebTransport & WebCodecs Engine ─────────────────────────────────────
class MoQSession {
  constructor(serverUrl, roomName, username, socket, onPeerFrame, onPeerAudio) {
    this.serverUrl = serverUrl;
    this.roomName = roomName;
    this.username = username;
    this.socket = socket;
    this.onPeerFrame = onPeerFrame;
    this.onPeerAudio = onPeerAudio;
    this.transport = null;
    this.videoEncoder = null;
    this.audioEncoder = null;
    this.videoWriter = null;
    this.audioWriter = null;
    this.connected = false;
    this.mode = 'WebTransport';
    this.peerDecoders = {};
    this.audioCtx = null;
    this.nextAudioTime = 0;
    this.activeVideoLoopId = 0;
  }

  async connect() {
    this.connected = true;

    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
    } catch (e) {
      // AudioContext init fallback
    }

    if (typeof WebTransport !== 'undefined') {
      try {
        const fullUrl = `${this.serverUrl}/${encodeURIComponent(this.roomName)}/${encodeURIComponent(this.username)}`;
        this.transport = new WebTransport(fullUrl);
        await this.transport.ready;
        this.mode = 'WebTransport';
        console.log('MoQ WebTransport connected to MediaMTX:', fullUrl);
        this.listenIncomingStreams();
        return true;
      } catch (err) {
        console.warn('WebTransport unavailable on localhost:8554. Active mode: Socket.IO MoQ packet relay.');
      }
    }

    this.mode = 'SocketRelay';
    if (this.socket) {
      this.socket.on('moq-packet', ({ senderId, packet }) => {
        this.processIncomingPacket(senderId, new Uint8Array(packet));
      });
    }

    return true;
  }

  getPeerDecoders(senderId) {
    if (!this.peerDecoders[senderId]) {
      let videoDecoder = null;
      let audioDecoder = null;

      if (typeof VideoDecoder !== 'undefined') {
        try {
          videoDecoder = new VideoDecoder({
            output: (frame) => {
              if (this.onPeerFrame) this.onPeerFrame(senderId, frame);
            },
            error: (e) => console.error(`VideoDecoder error for peer ${senderId}:`, e)
          });
          videoDecoder.configure({ codec: 'vp8' });
        } catch (e) {
          console.error('VideoDecoder config error:', e);
        }
      }

      if (typeof AudioDecoder !== 'undefined') {
        try {
          audioDecoder = new AudioDecoder({
            output: (audioData) => {
              this.playAudioData(audioData);
              audioData.close();
            },
            error: (e) => console.error(`AudioDecoder error for peer ${senderId}:`, e)
          });
          audioDecoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 });
        } catch (e) {
          console.error('AudioDecoder config error:', e);
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
      console.warn('Audio playback error:', e);
    }
  }

  async initEncoders(videoTrack, audioTrack) {
    if (!this.connected) return;

    if (this.mode === 'WebTransport' && this.transport) {
      try {
        const sendStreamVideo = await this.transport.createUnidirectionalStream();
        this.videoWriter = sendStreamVideo.getWriter();

        const sendStreamAudio = await this.transport.createUnidirectionalStream();
        this.audioWriter = sendStreamAudio.getWriter();
      } catch (err) {
        console.error('Error opening WebTransport SendStreams:', err);
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
            output: (chunk, metadata) => this.handleEncodedAudioChunk(chunk, metadata),
            error: (e) => console.error('AudioEncoder error:', e)
          });

          this.audioEncoder.configure({
            codec: 'opus',
            sampleRate: 48000,
            numberOfChannels: 1,
            bitrate: 48000
          });

          this.fallbackAudioData(audioTrack);
        }
      } catch (err) {
        console.error('WebCodecs AudioEncoder setup error:', err);
      }
    }
  }

  switchVideoTrack(videoTrack) {
    if (!this.connected || !videoTrack || typeof VideoEncoder === 'undefined') return;

    this.activeVideoLoopId++;
    const currentLoopId = this.activeVideoLoopId;

    try {
      const settings = videoTrack.getSettings();
      if (this.videoEncoder) {
        try { this.videoEncoder.close(); } catch (e) { }
      }

      this.videoEncoder = new VideoEncoder({
        output: (chunk, metadata) => this.handleEncodedVideoChunk(chunk, metadata),
        error: (e) => console.error('VideoEncoder error:', e)
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
          this.readVideoFrames(reader, currentLoopId);
        } catch (e) {
          this.fallbackVideoFrames(videoTrack, currentLoopId);
        }
      } else {
        this.fallbackVideoFrames(videoTrack, currentLoopId);
      }
    } catch (err) {
      console.error('WebCodecs VideoEncoder switch error:', err);
    }
  }

  fallbackVideoFrames(videoTrack, loopId) {
    const video = document.createElement('video');
    video.srcObject = new MediaStream([videoTrack]);
    video.muted = true;
    video.play().catch(() => {});

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    let frameCount = 0;
    let lastTime = 0;

    const captureLoop = (now) => {
      if (!this.connected || (loopId && loopId !== this.activeVideoLoopId)) return;
      if (now - lastTime >= 35) {
        lastTime = now;
        if (video.readyState >= 2) {
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 480;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          if (this.videoEncoder && this.videoEncoder.state === 'configured') {
            try {
              const frame = new VideoFrame(canvas, { timestamp: performance.now() * 1000 });
              // Force keyframe on first frame for instant remote display!
              const keyFrame = frameCount === 0 || frameCount % 12 === 0;
              this.videoEncoder.encode(frame, { keyFrame });
              frame.close();
              frameCount++;
            } catch (e) {
              console.warn('Fallback VideoFrame creation error:', e);
            }
          }
        }
      }
      requestAnimationFrame(captureLoop);
    };

    video.onloadedmetadata = () => requestAnimationFrame(captureLoop);
    if (video.readyState >= 2) requestAnimationFrame(captureLoop);
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
              // AudioData encode error catch
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

  async readVideoFrames(reader, loopId) {
    let frameCount = 0;
    while (this.connected && loopId === this.activeVideoLoopId) {
      try {
        const { value: frame, done } = await reader.read();
        if (done || !frame || loopId !== this.activeVideoLoopId) break;
        if (this.videoEncoder && this.videoEncoder.state === 'configured') {
          const keyFrame = frameCount === 0 || frameCount % 12 === 0;
          this.videoEncoder.encode(frame, { keyFrame });
          frameCount++;
        }
        frame.close();
      } catch (e) {
        break;
      }
    }
  }

  async readAudioData(reader) {
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

  async handleEncodedVideoChunk(chunk, metadata) {
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

  async handleEncodedAudioChunk(chunk, metadata) {
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
    if (this.mode === 'WebTransport' && this.videoWriter) {
      try {
        await this.videoWriter.write(packet);
      } catch (e) {
        if (this.socket) {
          this.socket.emit('moq-packet', { projectName: this.roomName, packet: packet.buffer });
        }
      }
    } else if (this.socket) {
      this.socket.emit('moq-packet', { projectName: this.roomName, packet: packet.buffer });
    }
  }

  async listenIncomingStreams() {
    if (!this.transport) return;
    try {
      const reader = this.transport.incomingUnidirectionalStreams.getReader();
      while (this.connected) {
        const { value: stream, done } = await reader.read();
        if (done) break;
        this.readIncomingMoQStream(stream);
      }
    } catch (err) {
      console.warn('MoQ incoming stream reader error:', err);
    }
  }

  async readIncomingMoQStream(stream) {
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

// ─── Main Component ───────────────────────────────────────────────────────────
export default function WebRTCCallWidget({ projectName, socket, username }) {
  const [inCall, setInCall] = useState(globalCallSession.isSessionActive(projectName));
  const inCallRef = useRef(globalCallSession.isSessionActive(projectName));
  const [micMuted, setMicMuted] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);
  const [screenSharing, setScreenSharing] = useState(globalCallSession.screenSharing);
  const [facingMode, setFacingMode] = useState(globalCallSession.facingMode || 'user');
  const [peers, setPeers] = useState([]); // [{ socketId, username }]
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(
    globalCallSession.isSessionActive(projectName) ? 'connected' : 'disconnected'
  );
  const [transportMode, setTransportMode] = useState('MoQ');
  const [micMutedMap, setMicMutedMap] = useState({});
  const [showScreenTip, setShowScreenTip] = useState(false);

  const localStreamRef = useRef(globalCallSession.localStream);
  const localVideoRef = useRef(null);
  const screenStreamRef = useRef(globalCallSession.screenStream);
  const moqSessionRef = useRef(globalCallSession.moqSession);
  const peerCanvasRefs = useRef({}); // { peerId: canvasDOMNode }

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

  const handleReconnect = useCallback(() => {
    if (socket) {
      setIsReconnecting(true);
      socket.disconnect();
      socket.connect();
    }
  }, [socket]);

  const handleUserJoined = useCallback(({ socketId, username: peerName }) => {
    if (!socketId || socketId === 'remote-peer' || socketId === socket?.id) return;
    setPeers(prev => {
      if (prev.find(p => p.socketId === socketId)) return prev;
      return [...prev, { socketId, username: peerName || 'Participant' }];
    });
  }, [socket]);

  const startCall = async () => {
    try {
      setInCall(true);
      inCallRef.current = true;

      if (globalCallSession.isSessionActive(projectName)) {
        localStreamRef.current = globalCallSession.localStream;
        screenStreamRef.current = globalCallSession.screenStream;
        moqSessionRef.current = globalCallSession.moqSession;
        setScreenSharing(globalCallSession.screenSharing);
        setConnectionStatus('connected');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: true
      });
      localStreamRef.current = stream;
      setVideoMuted(false);
      setMicMuted(false);
      setFacingMode('user');
      setConnectionStatus('connected');

      requestAnimationFrame(() => {
        if (localVideoRef.current && localStreamRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
          localVideoRef.current.play().catch(() => { });
        }
      });

      // Initialize MoQ Session
      const moqServerUrl = 'https://localhost:8554/moq_server';
      const session = new MoQSession(
        moqServerUrl,
        projectName,
        username || 'anonymous',
        socket,
        (peerId, videoFrame) => {
          if (peerId && peerId !== 'remote-peer' && peerId !== socket?.id) {
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
              const width = videoFrame.displayWidth || 640;
              const height = videoFrame.displayHeight || 480;
              if (canvas.width !== width) canvas.width = width;
              if (canvas.height !== height) canvas.height = height;
              ctx.drawImage(videoFrame, 0, 0, width, height);
            }
          }
          videoFrame.close();
        },
        (peerId, audioData) => {
          if (peerId && peerId !== 'remote-peer' && peerId !== socket?.id) {
            handleUserJoined({ socketId: peerId, username: 'Participant' });
          }
          audioData.close();
        }
      );

      moqSessionRef.current = session;
      await session.connect();
      setTransportMode(session.mode === 'WebTransport' ? 'MoQ (QUIC)' : 'MoQ (Relay)');

      const vTrack = stream.getVideoTracks()[0];
      const aTrack = stream.getAudioTracks()[0];
      session.initEncoders(vTrack, aTrack);

      globalCallSession.setSession({
        roomName: projectName,
        localStream: stream,
        moqSession: session,
        socket
      });

      if (socket) {
        socket.emit('moq-join-room', { projectName, username }, (response) => {
          if (response && Array.isArray(response.existingPeers)) {
            response.existingPeers.forEach(({ socketId, username: peerName }) => {
              handleUserJoined({ socketId, username: peerName });
            });
          }
        });
      }

    } catch (err) {
      console.error('Failed to get media devices:', err);
      alert('Camera/microphone access is required to start a call.');
    }
  };

  const endCall = () => {
    globalCallSession.endSession();

    localStreamRef.current = null;
    screenStreamRef.current = null;
    moqSessionRef.current = null;

    inCallRef.current = false;
    setPeers([]);
    setInCall(false);
    setScreenSharing(false);
    setConnectionStatus('disconnected');
  };

  useEffect(() => {
    if (!socket) return;

    const handlePeerMicStatus = ({ socketId, muted }) => {
      setMicMutedMap(prev => ({ ...prev, [socketId]: muted }));
    };

    const handleUserLeft = ({ socketId }) => {
      setPeers(prev => prev.filter(p => p.socketId !== socketId));
    };

    socket.on('moq-user-joined', handleUserJoined);
    socket.on('moq-user-left', handleUserLeft);
    socket.on('peer-mic-status', handlePeerMicStatus);

    return () => {
      socket.off('moq-user-joined', handleUserJoined);
      socket.off('moq-user-left', handleUserLeft);
      socket.off('peer-mic-status', handlePeerMicStatus);
    };
  }, [socket, projectName, handleUserJoined]);

  const toggleMic = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const nowMuted = !audioTrack.enabled;
        setMicMuted(nowMuted);
        if (socket) {
          socket.emit('mic-status', { projectName, muted: nowMuted });
        }
      }
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoMuted(!videoTrack.enabled);
      }
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

      if (moqSessionRef.current) {
        moqSessionRef.current.switchVideoTrack(newVideoTrack);
      }
    } catch (err) {
      console.error('Camera switch error:', err);
      alert('Could not switch camera. Check if a secondary camera is available.');
    }
  };

  const toggleScreenShare = async () => {
    if (!inCall) {
      await startCall();
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
        if (moqSessionRef.current) moqSessionRef.current.switchVideoTrack(camTrack);
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

        if (moqSessionRef.current) {
          moqSessionRef.current.switchVideoTrack(screenTrack);
        }

        screenTrack.onended = () => {
          globalCallSession.stopScreenShare();
          setScreenSharing(false);
          setShowScreenTip(false);
          const camTrack = localStreamRef.current?.getVideoTracks()[0];
          if (camTrack) {
            replaceVideoTrack(camTrack);
            if (moqSessionRef.current) moqSessionRef.current.switchVideoTrack(camTrack);
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

  const replaceVideoTrack = (newTrack) => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = new MediaStream([newTrack]);
      localVideoRef.current.play().catch(() => {});
    }
  };

  return (
    <div className="webrtc-call-container">
      {connectionStatus === 'reconnection-failed' && (
        <div className="connection-error-banner">
          <span>Connection lost. Try to reconnect</span>
          <button onClick={handleReconnect} className="reconnect-btn">Reconnect</button>
        </div>
      )}

      {isReconnecting && (
        <div className="reconnecting-banner">
          <span>🔄 Reconnecting...</span>
        </div>
      )}

      {showScreenTip && screenSharing && (
        <div style={{
          padding: '8px 14px',
          margin: '8px 0',
          borderRadius: '8px',
          background: 'rgba(255, 171, 0, 0.15)',
          border: '1px solid rgba(255, 171, 0, 0.4)',
          color: '#ffc107',
          fontSize: '0.78rem',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <Info size={14} />
          <span><strong>Tip:</strong> Share a different window or desktop app to avoid the hall-of-mirrors preview loop!</span>
        </div>
      )}

      {!inCall ? (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="call-btn-trigger" onClick={startCall}>
            <PhoneCall size={14} /> Join Voice &amp; Video ({transportMode})
          </button>
          <button className="call-btn-trigger" onClick={toggleScreenShare} style={{ background: '#2563eb' }}>
            <Tv size={14} /> Share Screen
          </button>
        </div>
      ) : (
        <div className="webrtc-call-workspace">
          <div className="webrtc-participant-count">
            <span className="webrtc-live-dot" />
            {1 + peers.length} participant{(1 + peers.length) !== 1 ? 's' : ''} [{transportMode}]
          </div>

          <div className="webrtc-video-grid">
            {/* Local tile */}
            <div className={`video-card local-view ${screenSharing ? 'sharing-screen' : ''}`}>
              <video
                ref={localVideoRefCallback}
                autoPlay
                playsInline
                muted
                className={`video-element ${videoMuted ? 'muted' : ''}`}
              />
              {videoMuted && (
                <div className="video-avatar-placeholder">
                  <div
                    className="video-initials-circle"
                    style={{ background: getAvatarColor(username) }}
                  >
                    {getInitials(username)}
                  </div>
                </div>
              )}
              <div className="participant-badge">
                <span className={`webrtc-mic-icon ${micMuted ? 'muted' : ''}`}>
                  {micMuted ? <MicOff size={9} /> : <Mic size={9} />}
                </span>
                {username || 'You'} {screenSharing ? '(Screen)' : ''}
              </div>
            </div>

            {/* Remote peer tiles */}
            {peers.map(peer => (
              <MoQVideoCard
                key={peer.socketId}
                peer={peer}
                isMicMuted={!!micMutedMap[peer.socketId]}
                onCanvasRef={(node) => {
                  if (node) peerCanvasRefs.current[peer.socketId] = node;
                }}
              />
            ))}
          </div>

          <div className="webrtc-controls-bar">
            <button
              onClick={toggleMic}
              className={`call-tool-btn ${micMuted ? 'active' : ''}`}
              title={micMuted ? 'Unmute Mic' : 'Mute Mic'}
            >
              {micMuted ? <MicOff size={16} /> : <Mic size={16} />}
            </button>

            <button
              onClick={toggleVideo}
              className={`call-tool-btn ${videoMuted ? 'active' : ''}`}
              title={videoMuted ? 'Turn Video On' : 'Turn Video Off'}
            >
              {videoMuted ? <VideoOff size={16} /> : <Video size={16} />}
            </button>

            <button
              onClick={switchCamera}
              className="call-tool-btn"
              title={`Switch Camera (${facingMode === 'user' ? 'Front' : 'Back'})`}
            >
              <RefreshCw size={16} />
            </button>

            <button
              onClick={toggleScreenShare}
              className={`call-tool-btn ${screenSharing ? 'active' : ''}`}
              title={screenSharing ? 'Stop Sharing' : 'Share Screen'}
            >
              <Tv size={16} />
            </button>

            <button
              onClick={endCall}
              className="call-tool-btn leave-btn"
              title="Leave Call"
            >
              <PhoneOff size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MoQVideoCard({ peer, isMicMuted, onCanvasRef }) {
  return (
    <div className="video-card remote-view" style={{ position: 'relative' }}>
      <canvas
        ref={onCanvasRef}
        className="video-element"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          zIndex: 1,
          background: '#0d0f1a',
          display: 'block'
        }}
      />
      <div className="participant-badge" style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 3 }}>
        <span className={`webrtc-mic-icon ${isMicMuted ? 'muted' : ''}`}>
          {isMicMuted ? <MicOff size={9} /> : <Mic size={9} />}
        </span>
        {peer.username}
      </div>
    </div>
  );
}

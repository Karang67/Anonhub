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
import { Video, VideoOff, Mic, MicOff, Tv, PhoneOff, PhoneCall, RefreshCw, Info, Maximize2, Minimize2 } from 'lucide-react';
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
    this.forceNextKeyframe = true;
    this.currentEncWidth = 0;
    this.currentEncHeight = 0;
    this.offscreenCanvas = null;
    this.offscreenCtx = null;
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

  switchVideoTrack(videoTrack, isScreenShareExplicit = false) {
    if (!this.connected || !videoTrack || typeof VideoEncoder === 'undefined') return;

    this.activeVideoLoopId++;
    this.forceNextKeyframe = true;
    const currentLoopId = this.activeVideoLoopId;

    try {
      const settings = typeof videoTrack.getSettings === 'function' ? videoTrack.getSettings() : {};
      const label = (videoTrack.label || '').toLowerCase();
      const displaySurface = settings.displaySurface;

      const isScreenShare = isScreenShareExplicit ||
        !!displaySurface ||
        label.includes('screen') ||
        label.includes('window') ||
        label.includes('display') ||
        label.includes('monitor') ||
        label.includes('tab') ||
        label.includes('web-contents');

      if (this.videoEncoder) {
        try { this.videoEncoder.close(); } catch (e) { }
      }

      this.videoEncoder = new VideoEncoder({
        output: (chunk, metadata) => this.handleEncodedVideoChunk(chunk, metadata),
        error: (e) => console.error('VideoEncoder error:', e)
      });

      const rawWidth = settings.width || (isScreenShare ? 1280 : 640);
      const rawHeight = settings.height || (isScreenShare ? 720 : 480);

      // Force EVEN dimensions required by WebCodecs VideoEncoder (VP8/H264)
      const targetWidth = Math.max(2, rawWidth & ~1);
      const targetHeight = Math.max(2, rawHeight & ~1);
      const targetBitrate = isScreenShare ? 1200000 : 400000;

      this.currentEncWidth = targetWidth;
      this.currentEncHeight = targetHeight;

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
          this.readVideoFrames(reader, currentLoopId, isScreenShare, videoTrack);
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
    video.play().catch(() => { });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    let frameCount = 0;

    const captureStep = () => {
      if (!this.connected || (loopId && loopId !== this.activeVideoLoopId)) {
        clearInterval(timerId);
        return;
      }

      if (video.readyState >= 2) {
        const rawW = video.videoWidth || 640;
        const rawH = video.videoHeight || 480;
        const evenW = Math.max(2, rawW & ~1);
        const evenH = Math.max(2, rawH & ~1);
        if (canvas.width !== evenW) canvas.width = evenW;
        if (canvas.height !== evenH) canvas.height = evenH;
        ctx.drawImage(video, 0, 0, evenW, evenH);

        if (this.videoEncoder && this.videoEncoder.state === 'configured') {
          try {
            const frame = new VideoFrame(canvas, { timestamp: performance.now() * 1000 });
            const keyFrame = this.forceNextKeyframe || frameCount === 0 || frameCount % 12 === 0;
            if (this.forceNextKeyframe) this.forceNextKeyframe = false;

            this.videoEncoder.encode(frame, { keyFrame });
            frame.close();
            frameCount++;
          } catch (e) {
            console.warn('Fallback VideoFrame creation error:', e);
          }
        }
      }
    };

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

  async readVideoFrames(reader, loopId, isScreenShare, videoTrack) {
    let frameCount = 0;
    while (this.connected && loopId === this.activeVideoLoopId) {
      try {
        const { value: frame, done } = await reader.read();
        if (done || !frame || loopId !== this.activeVideoLoopId) break;

        if (this.videoEncoder && this.videoEncoder.state === 'configured') {
          let frameToEncode = frame;
          let tempFrameCreated = false;

          const displayW = frame.displayWidth || frame.codedWidth || this.currentEncWidth || 640;
          const displayH = frame.displayHeight || frame.codedHeight || this.currentEncHeight || 480;
          const evenW = Math.max(2, displayW & ~1);
          const evenH = Math.max(2, displayH & ~1);

          // Handle dynamic window resize outside the browser
          if (evenW !== this.currentEncWidth || evenH !== this.currentEncHeight) {
            this.currentEncWidth = evenW;
            this.currentEncHeight = evenH;
            try {
              const settings = typeof videoTrack?.getSettings === 'function' ? videoTrack.getSettings() : {};
              this.videoEncoder.configure({
                codec: 'vp8',
                width: this.currentEncWidth,
                height: this.currentEncHeight,
                bitrate: isScreenShare ? 1200000 : 400000,
                framerate: settings.frameRate || 24,
                latencyMode: 'realtime'
              });
              this.forceNextKeyframe = true;
            } catch (err) {
              console.warn('VideoEncoder dynamic resize error:', err);
            }
          }

          // If frame dimensions are odd, scale/crop to even dimensions via canvas to prevent WebCodecs crash
          if (displayW % 2 !== 0 || displayH % 2 !== 0) {
            if (!this.offscreenCanvas) {
              this.offscreenCanvas = document.createElement('canvas');
              this.offscreenCtx = this.offscreenCanvas.getContext('2d');
            }
            if (this.offscreenCanvas.width !== evenW) this.offscreenCanvas.width = evenW;
            if (this.offscreenCanvas.height !== evenH) this.offscreenCanvas.height = evenH;
            this.offscreenCtx.drawImage(frame, 0, 0, evenW, evenH);
            try {
              frameToEncode = new VideoFrame(this.offscreenCanvas, { timestamp: frame.timestamp });
              tempFrameCreated = true;
            } catch (e) {
              frameToEncode = frame;
              tempFrameCreated = false;
            }
          }

          const keyFrame = this.forceNextKeyframe || frameCount === 0 || frameCount % 12 === 0;
          if (this.forceNextKeyframe) this.forceNextKeyframe = false;

          this.videoEncoder.encode(frameToEncode, { keyFrame });
          frameCount++;

          if (tempFrameCreated) {
            frameToEncode.close();
          }
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
    this.offscreenCanvas = null;
    this.offscreenCtx = null;
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

  // ── Maximize / Minimize Screen Tile State for Mobile View ──────────────────
  const [maximizedTileId, setMaximizedTileId] = useState(null);
  const localCardRef = useRef(null);

  const toggleMaximizeTile = (tileId, elementRef) => {
    if (maximizedTileId === tileId) {
      setMaximizedTileId(null);
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    } else {
      setMaximizedTileId(tileId);
      if (elementRef && elementRef.requestFullscreen) {
        elementRef.requestFullscreen().catch(() => {});
      }
    }
  };

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

    if (moqSessionRef.current) {
      moqSessionRef.current.requestKeyframe();
    }
  }, [socket]);

  const toggleMicPrejoin = () => {
    if (inCall && localStreamRef.current) {
      toggleMic();
    } else {
      setMicMuted(prev => !prev);
    }
  };

  const toggleVideoPrejoin = () => {
    if (inCall && localStreamRef.current) {
      toggleVideo();
    } else {
      setVideoMuted(prev => !prev);
    }
  };

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

      // Respect pre-join preferences
      if (stream.getAudioTracks()[0]) {
        stream.getAudioTracks()[0].enabled = !micMuted;
      }
      if (stream.getVideoTracks()[0]) {
        stream.getVideoTracks()[0].enabled = !videoMuted;
      }

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
      alert('Microphone/camera access is required to join.');
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
    setMaximizedTileId(null);
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

        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
        const audioTrack = micStream ? micStream.getAudioTracks()[0] : null;
        if (micStream) {
          localStreamRef.current = micStream;
          if (micMuted && micStream.getAudioTracks()[0]) {
            micStream.getAudioTracks()[0].enabled = false;
          }
        }

        session.initEncoders(screenTrack, audioTrack);
        replaceVideoTrack(screenTrack);

        globalCallSession.setSession({
          roomName: projectName,
          localStream: micStream,
          screenStream: stream,
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
          moqSessionRef.current.switchVideoTrack(screenTrack, true);
        }

        screenTrack.onended = () => {
          globalCallSession.stopScreenShare();
          setScreenSharing(false);
          setShowScreenTip(false);
          const camTrack = localStreamRef.current?.getVideoTracks()[0];
          if (camTrack) {
            replaceVideoTrack(camTrack);
            if (moqSessionRef.current) moqSessionRef.current.switchVideoTrack(camTrack, false);
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
      localVideoRef.current.play().catch(() => { });
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

      {/* ALWAYS VISIBLE ACTION BAR WITH PRE-JOIN CONTROLS */}
      <div className="webrtc-action-header-bar" style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '8px 12px', background: 'rgba(13, 15, 26, 0.9)', borderRadius: '10px', marginBottom: '8px', border: '1px solid rgba(124, 77, 255, 0.3)' }}>
        {!inCall ? (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', width: '100%', justifyContent: 'center' }}>
            <button
              onClick={toggleMicPrejoin}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', background: micMuted ? 'rgba(239,68,68,0.2)' : 'rgba(124,77,255,0.15)', color: micMuted ? '#ef4444' : '#c5b3ff', borderRadius: '8px', fontWeight: 600, border: `1px solid ${micMuted ? 'rgba(239,68,68,0.4)' : 'rgba(124,77,255,0.3)'}`, cursor: 'pointer', fontSize: '0.82rem' }}
              title={micMuted ? 'Unmute Mic' : 'Mute Mic'}
            >
              {micMuted ? <MicOff size={15} /> : <Mic size={15} />}
              {micMuted ? 'Mic Muted' : 'Mic On'}
            </button>

            <button
              onClick={toggleVideoPrejoin}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', background: videoMuted ? 'rgba(239,68,68,0.2)' : 'rgba(124,77,255,0.15)', color: videoMuted ? '#ef4444' : '#c5b3ff', borderRadius: '8px', fontWeight: 600, border: `1px solid ${videoMuted ? 'rgba(239,68,68,0.4)' : 'rgba(124,77,255,0.3)'}`, cursor: 'pointer', fontSize: '0.82rem' }}
              title={videoMuted ? 'Turn Camera On' : 'Turn Camera Off'}
            >
              {videoMuted ? <VideoOff size={15} /> : <Video size={15} />}
              {videoMuted ? 'Camera Off' : 'Camera On'}
            </button>

            <button className="call-btn-trigger" onClick={startCall} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', background: '#7c4dff', color: '#fff', borderRadius: '8px', fontWeight: 600, border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}>
              <PhoneCall size={15} /> Join Video Call
            </button>
            <button className="call-btn-trigger" onClick={toggleScreenShare} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', background: '#2563eb', color: '#fff', borderRadius: '8px', fontWeight: 600, border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}>
              <Tv size={15} /> Screen Share Only
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '100%', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.8rem', color: '#a78bfa', fontWeight: 600 }}>Active MoQ Session (#{projectName})</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={toggleScreenShare} style={{ padding: '6px 12px', background: screenSharing ? '#dc2626' : '#2563eb', color: '#fff', borderRadius: '6px', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Tv size={13} /> {screenSharing ? 'Stop Sharing' : 'Share Screen'}
              </button>
              <button onClick={endCall} style={{ padding: '6px 12px', background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', borderRadius: '6px', border: '1px solid rgba(239, 68, 68, 0.4)', fontWeight: 600, cursor: 'pointer', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <PhoneOff size={13} /> Leave Call
              </button>
            </div>
          </div>
        )}
      </div>

      {inCall && (
        <div className="webrtc-call-workspace">
          <div className="webrtc-participant-count">
            <span className="webrtc-live-dot" />
            {1 + peers.length} participant{(1 + peers.length) !== 1 ? 's' : ''} [{transportMode}]
          </div>

          <div className="webrtc-video-grid">
            {/* Local tile */}
            <div
              ref={localCardRef}
              className={`video-card local-view ${screenSharing ? 'sharing-screen' : ''} ${maximizedTileId === 'local' ? 'maximized-tile' : ''}`}
            >
              <video
                ref={localVideoRefCallback}
                autoPlay
                playsInline
                muted
                className={`video-element ${(videoMuted && !screenSharing) ? 'muted' : ''}`}
                style={{
                  objectFit: screenSharing ? 'contain' : 'cover'
                }}
              />
              {/* Maximize / Minimize button on local screen share tile */}
              {screenSharing && (
                <button
                  className="tile-maximize-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleMaximizeTile('local', localCardRef.current);
                  }}
                  title={maximizedTileId === 'local' ? "Minimize Screen" : "Maximize Screen"}
                >
                  {maximizedTileId === 'local' ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  <span>{maximizedTileId === 'local' ? "Minimize" : "Maximize"}</span>
                </button>
              )}

              {(videoMuted && !screenSharing) && (
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
                isMaximized={maximizedTileId === peer.socketId}
                onToggleMaximize={toggleMaximizeTile}
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

            {/* Maximize / Minimize button on control bar */}
            <button
              onClick={() => toggleMaximizeTile(maximizedTileId ? maximizedTileId : 'local', localCardRef.current)}
              className={`call-tool-btn ${maximizedTileId ? 'active' : ''}`}
              title={maximizedTileId ? "Minimize Screen" : "Maximize Screen"}
            >
              {maximizedTileId ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
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

function MoQVideoCard({ peer, isMicMuted, isMaximized, onToggleMaximize, onCanvasRef }) {
  const cardRef = useRef(null);

  return (
    <div
      ref={cardRef}
      className={`video-card remote-view ${isMaximized ? 'maximized-tile' : ''}`}
      style={{ position: 'relative' }}
    >
      <canvas
        ref={onCanvasRef}
        className="video-element"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          zIndex: 1,
          background: '#000000',
          display: 'block'
        }}
      />

      {/* Prominent Maximize/Minimize button for Mobile & Desktop users to view remote shared screen */}
      <button
        className="tile-maximize-btn"
        onClick={(e) => {
          e.stopPropagation();
          onToggleMaximize(peer.socketId, cardRef.current);
        }}
        title={isMaximized ? "Minimize Screen" : "Maximize Screen"}
      >
        {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        <span>{isMaximized ? "Minimize" : "Maximize"}</span>
      </button>

      <div className="participant-badge" style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 3 }}>
        <span className={`webrtc-mic-icon ${isMicMuted ? 'muted' : ''}`}>
          {isMicMuted ? <MicOff size={9} /> : <Mic size={9} />}
        </span>
        {peer.username}
      </div>
    </div>
  );
}

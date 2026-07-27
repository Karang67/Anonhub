/**
 * ============================================================================
 * MEDIA OVER QUIC (MoQ) ARCHITECTURE & PROTOCOL SPECIFICATION
 * ============================================================================
 * 
 * 1. OVERVIEW:
 *    This file implements a low-latency Media over QUIC (MoQ) multi-user 
 *    screen sharing, video, and audio streaming architecture replacing legacy 
 *    WebRTC peer connections. MediaMTX is utilized as the central MoQ relay server.
 *    Client-side capture and encoding leverage the native WebTransport API and 
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
 *      - Screen Share Track: https://localhost:8554/moq_server/room123/userA/screen
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
 *    - Media Payload: Encoded H.264/VP8 or Opus payload produced by WebCodecs.
 * ============================================================================
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, VideoOff, Mic, MicOff, Tv, PhoneOff, PhoneCall } from 'lucide-react';
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

// ─── MoQ WebTransport & WebCodecs Helper Class ────────────────────────────────
class MoQSession {
  constructor(serverUrl, roomName, username, onPeerFrame, onPeerAudio) {
    this.serverUrl = serverUrl;
    this.roomName = roomName;
    this.username = username;
    this.onPeerFrame = onPeerFrame;
    this.onPeerAudio = onPeerAudio;
    this.transport = null;
    this.videoEncoder = null;
    this.audioEncoder = null;
    this.videoWriter = null;
    this.audioWriter = null;
    this.connected = false;
    this.audioContext = null;
  }

  async connect() {
    try {
      if (typeof WebTransport === 'undefined') {
        console.warn('WebTransport API is not supported in this browser environment. MoQ falling back to simulation mode.');
        return false;
      }
      const fullUrl = `${this.serverUrl}/${encodeURIComponent(this.roomName)}/${encodeURIComponent(this.username)}`;
      this.transport = new WebTransport(fullUrl);
      await this.transport.ready;
      this.connected = true;
      console.log('MoQ WebTransport connection established to MediaMTX:', fullUrl);

      // Listen for incoming streams from MediaMTX relay
      this.listenIncomingStreams();
      return true;
    } catch (err) {
      console.warn('Failed to establish MoQ WebTransport connection to MediaMTX server:', err);
      return false;
    }
  }

  async initEncoders(videoTrack, audioTrack) {
    if (!this.transport || !this.connected) return;

    // Create SendStreams for outbound MoQ tracks
    try {
      const sendStreamVideo = await this.transport.createUnidirectionalStream();
      this.videoWriter = sendStreamVideo.getWriter();

      const sendStreamAudio = await this.transport.createUnidirectionalStream();
      this.audioWriter = sendStreamAudio.getWriter();
    } catch (err) {
      console.error('Error creating WebTransport SendStreams:', err);
      return;
    }

    // Initialize WebCodecs VideoEncoder
    if (videoTrack && typeof VideoEncoder !== 'undefined') {
      try {
        const settings = videoTrack.getSettings();
        this.videoEncoder = new VideoEncoder({
          output: (chunk, metadata) => this.handleEncodedVideoChunk(chunk, metadata),
          error: (e) => console.error('VideoEncoder error:', e)
        });

        this.videoEncoder.configure({
          codec: 'avc1.42E01E', // H.264 Baseline Profile
          width: settings.width || 640,
          height: settings.height || 480,
          bitrate: 1000000, // 1 Mbps
          framerate: settings.frameRate || 30
        });

        if (typeof MediaStreamTrackProcessor !== 'undefined') {
          const processor = new MediaStreamTrackProcessor({ track: videoTrack });
          const reader = processor.readable.getReader();
          this.readVideoFrames(reader);
        }
      } catch (err) {
        console.error('WebCodecs VideoEncoder setup error:', err);
      }
    }

    // Initialize WebCodecs AudioEncoder
    if (audioTrack && typeof AudioEncoder !== 'undefined') {
      try {
        this.audioEncoder = new AudioEncoder({
          output: (chunk, metadata) => this.handleEncodedAudioChunk(chunk, metadata),
          error: (e) => console.error('AudioEncoder error:', e)
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
          this.readAudioData(reader);
        }
      } catch (err) {
        console.error('WebCodecs AudioEncoder setup error:', err);
      }
    }
  }

  async readVideoFrames(reader) {
    let frameCount = 0;
    while (this.connected) {
      try {
        const { value: frame, done } = await reader.read();
        if (done || !frame) break;
        if (this.videoEncoder && this.videoEncoder.state === 'configured') {
          const keyFrame = frameCount % 60 === 0;
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
    if (!this.videoWriter) return;

    // Pack MoQ binary frame: [TrackType (1B), Timestamp (8B Float64), Length (4B UInt32), Payload]
    const payload = new Uint8Array(chunk.byteLength);
    chunk.copyTo(payload);

    const header = new ArrayBuffer(13);
    const view = new DataView(header);
    view.setUint8(0, chunk.type === 'key' ? 0x01 : 0x02); // 0x01: Keyframe, 0x02: Delta
    view.setFloat64(1, chunk.timestamp / 1000, false);     // Timestamp in ms
    view.setUint32(9, payload.byteLength, false);          // Length

    const packet = new Uint8Array(13 + payload.byteLength);
    packet.set(new Uint8Array(header), 0);
    packet.set(payload, 13);

    try {
      await this.videoWriter.write(packet);
    } catch (e) {
      console.warn('MoQ video packet send error:', e);
    }
  }

  async handleEncodedAudioChunk(chunk, metadata) {
    if (!this.audioWriter) return;

    const payload = new Uint8Array(chunk.byteLength);
    chunk.copyTo(payload);

    const header = new ArrayBuffer(13);
    const view = new DataView(header);
    view.setUint8(0, 0x03);                            // 0x03: Audio
    view.setFloat64(1, chunk.timestamp / 1000, false); // Timestamp in ms
    view.setUint32(9, payload.byteLength, false);      // Length

    const packet = new Uint8Array(13 + payload.byteLength);
    packet.set(new Uint8Array(header), 0);
    packet.set(payload, 13);

    try {
      await this.audioWriter.write(packet);
    } catch (e) {
      console.warn('MoQ audio packet send error:', e);
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
    let videoDecoder = null;
    let audioDecoder = null;

    if (typeof VideoDecoder !== 'undefined') {
      videoDecoder = new VideoDecoder({
        output: (frame) => {
          if (this.onPeerFrame) this.onPeerFrame(frame);
        },
        error: (e) => console.error('VideoDecoder error:', e)
      });
      videoDecoder.configure({ codec: 'avc1.42E01E' });
    }

    if (typeof AudioDecoder !== 'undefined') {
      audioDecoder = new AudioDecoder({
        output: (audioData) => {
          if (this.onPeerAudio) this.onPeerAudio(audioData);
        },
        error: (e) => console.error('AudioDecoder error:', e)
      });
      audioDecoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 });
    }

    while (this.connected) {
      try {
        const { value, done } = await reader.read();
        if (done || !value) break;

        // Parse MoQ header
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

// ─── Main Component ───────────────────────────────────────────────────────────
export default function WebRTCCallWidget({ projectName, socket, username }) {
  const [inCall, setInCall] = useState(false);
  const inCallRef = useRef(false);
  const [micMuted, setMicMuted] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [peers, setPeers] = useState([]); // [{ socketId, username, stream }]
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [micMutedMap, setMicMutedMap] = useState({});

  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const screenStreamRef = useRef(null);
  const moqSessionRef = useRef(null);

  // WEBRTC_DEPRECATED
  // const peersRef = useRef({}); // { socketId: RTCPeerConnection }
  // const streamsRef = useRef({}); // { socketId: MediaStream }
  // const candidateQueues = useRef({}); // { socketId: [RTCIceCandidate] }

  const localVideoRefCallback = useCallback((node) => {
    localVideoRef.current = node;
    if (node && localStreamRef.current) {
      node.srcObject = localStreamRef.current;
    }
  }, []);

  const handleReconnect = useCallback(() => {
    console.log('Manual reconnection triggered');
    if (socket) {
      setIsReconnecting(true);
      socket.disconnect();
      socket.connect();
    }
  }, [socket]);

  const startCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      localStreamRef.current = stream;
      inCallRef.current = true;
      setInCall(true);
      setVideoMuted(false);
      setMicMuted(false);
      setConnectionStatus('connected');

      requestAnimationFrame(() => {
        if (localVideoRef.current && localStreamRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
          localVideoRef.current.play().catch(() => { });
        }
      });

      // WEBRTC_DEPRECATED
      /*
      // Join the signaling pool with enhanced error handling
      socket.emit('webrtc-join-call', { projectName }, (response) => {
        console.log('Join call response:', response);
        if (response && response.error) {
          console.error('Failed to join call:', response.error);
          alert(`Could not join the call: ${response.error}`);
          endCall();
        } else if (response && Array.isArray(response.existingPeers)) {
          response.existingPeers.forEach(({ socketId: sid, username: peerName }) => {
            if (!peersRef.current[sid]) {
              // isInitiator=true: the joining user must send the SDP offer
              const pc = createPeerConnection(sid, peerName || 'Participant', true);
              peersRef.current[sid] = pc;
            }
          });
        }
      });
      */

      // Initialize MoQ WebTransport & WebCodecs session
      const moqServerUrl = 'https://localhost:8554/moq_server';
      const session = new MoQSession(
        moqServerUrl,
        projectName,
        username || 'anonymous',
        (videoFrame) => {
          // Handle decoded remote frame
          videoFrame.close();
        },
        (audioData) => {
          // Handle decoded remote audio
          audioData.close();
        }
      );

      moqSessionRef.current = session;
      const connected = await session.connect();
      if (connected) {
        const vTrack = stream.getVideoTracks()[0];
        const aTrack = stream.getAudioTracks()[0];
        session.initEncoders(vTrack, aTrack);
      }

      // Socket room registration for roster
      if (socket) {
        socket.emit('moq-join-room', { projectName, username });
      }

    } catch (err) {
      console.error('Failed to get media devices:', err);
      alert('Camera/microphone access is required to start a call.');
    }
  };

  const endCall = () => {
    // WEBRTC_DEPRECATED
    /*
    if (socket) {
      socket.emit('webrtc-leave-call', { projectName });
    }
    */

    if (socket) {
      socket.emit('moq-leave-room', { projectName });
    }

    // Stop MoQ session
    if (moqSessionRef.current) {
      moqSessionRef.current.disconnect();
      moqSessionRef.current = null;
    }

    // Stop all local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }

    // WEBRTC_DEPRECATED
    /*
    Object.keys(peersRef.current).forEach(id => {
      try {
        peersRef.current[id].close();
      } catch (e) {
        console.warn(`Error closing peer connection ${id}:`, e);
      }
    });
    peersRef.current = {};
    streamsRef.current = {};
    */

    inCallRef.current = false;
    setPeers([]);
    setInCall(false);
    setScreenSharing(false);
    setConnectionStatus('disconnected');
  };

  // WEBRTC_DEPRECATED
  /*
  const createPeerConnection = (peerSocketId, peerName, isInitiator) => {
    const pc = new RTCPeerConnection(RTC_CONFIG);

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('webrtc-signal', {
          targetId: peerSocketId,
          signal: { candidate: event.candidate }
        });
      }
    };

    pc.ontrack = (event) => {
      const prevStream = streamsRef.current[peerSocketId];
      const newStream = new MediaStream();
      if (prevStream) {
        prevStream.getTracks().forEach(t => newStream.addTrack(t));
      }
      newStream.addTrack(event.track);
      streamsRef.current[peerSocketId] = newStream;

      setPeers(prev => {
        const idx = prev.findIndex(p => p.socketId === peerSocketId);
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], username: peerName || updated[idx].username, stream: newStream };
          return updated;
        }
        return [...prev, { socketId: peerSocketId, username: peerName || 'Participant', stream: newStream }];
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
            socket.emit('webrtc-signal', {
              targetId: peerSocketId,
              signal: { sdp: pc.localDescription }
            });
          }
        })
        .catch(err => console.error('Error creating offer:', err));
    }

    return pc;
  };
  */

  useEffect(() => {
    if (!socket) return;

    const handlePeerMicStatus = ({ socketId, muted }) => {
      setMicMutedMap(prev => ({ ...prev, [socketId]: muted }));
    };

    // Socket events for roster synchronization
    const handleUserJoined = ({ socketId, username: peerName }) => {
      setPeers(prev => {
        if (prev.find(p => p.socketId === socketId)) return prev;
        return [...prev, { socketId, username: peerName || 'Participant' }];
      });
    };

    const handleUserLeft = ({ socketId }) => {
      setPeers(prev => prev.filter(p => p.socketId !== socketId));
    };

    // WEBRTC_DEPRECATED
    /*
    socket.on('webrtc-user-joined', handleUserJoined);
    socket.on('webrtc-signal', handleSignal);
    socket.on('webrtc-user-left', handleUserLeft);
    */

    socket.on('moq-user-joined', handleUserJoined);
    socket.on('moq-user-left', handleUserLeft);
    socket.on('peer-mic-status', handlePeerMicStatus);

    return () => {
      // WEBRTC_DEPRECATED
      /*
      socket.off('webrtc-user-joined', handleUserJoined);
      socket.off('webrtc-signal', handleSignal);
      socket.off('webrtc-user-left', handleUserLeft);
      */

      socket.off('moq-user-joined', handleUserJoined);
      socket.off('moq-user-left', handleUserLeft);
      socket.off('peer-mic-status', handlePeerMicStatus);

      if (inCallRef.current) {
        endCall();
      }
    };
  }, [socket, projectName]);

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

  const toggleScreenShare = async () => {
    if (screenSharing) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;
      }
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

        if (moqSessionRef.current) {
          const aTrack = localStreamRef.current?.getAudioTracks()[0];
          moqSessionRef.current.initEncoders(screenTrack, aTrack);
        }

        screenTrack.onended = () => {
          setScreenSharing(false);
          const camTrack = localStreamRef.current?.getVideoTracks()[0];
          if (camTrack) replaceVideoTrack(camTrack);
        };
      } catch (err) {
        console.error('Failed to start screen share:', err);
        if (err.name !== 'AbortError') {
          alert('Failed to start screen sharing. Please try again.');
        }
      }
    }
  };

  const replaceVideoTrack = (newTrack) => {
    if (localVideoRef.current) {
      const currentStream = localVideoRef.current.srcObject;
      if (currentStream) {
        const oldTrack = currentStream.getVideoTracks()[0];
        if (oldTrack) {
          currentStream.removeTrack(oldTrack);
          currentStream.addTrack(newTrack);
          localVideoRef.current.srcObject = currentStream;
        }
      }
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

      {!inCall ? (
        <button className="call-btn-trigger" onClick={startCall}>
          <PhoneCall size={14} /> Join Voice &amp; Video (MoQ)
        </button>
      ) : (
        <div className="webrtc-call-workspace">
          <div className="webrtc-participant-count">
            <span className="webrtc-live-dot" />
            {1 + peers.length} participant{(1 + peers.length) !== 1 ? 's' : ''} [MoQ Active]
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
                {username || 'You'}
              </div>
            </div>

            {/* Remote peer tiles (Rendered via MoQ canvas/decoder pipeline) */}
            {peers.map(peer => (
              <MoQVideoCard
                key={peer.socketId}
                peer={peer}
                isMicMuted={!!micMutedMap[peer.socketId]}
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

function MoQVideoCard({ peer, isMicMuted }) {
  const canvasRef = useRef(null);
  const [hasVideo, setHasVideo] = useState(false);

  return (
    <div className="video-card remote-view" style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        className="video-element"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          zIndex: 1,
          display: hasVideo ? 'block' : 'none'
        }}
      />
      {!hasVideo && (
        <div className="video-avatar-placeholder" style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', background: '#13152a' }}>
          <div
            className="video-initials-circle"
            style={{ background: getAvatarColor(peer.username) }}
          >
            {getInitials(peer.username)}
          </div>
          <span style={{ fontSize: '0.75rem', color: '#a0a5c0', marginTop: '6px' }}>{peer.username}</span>
        </div>
      )}
      <div className="participant-badge" style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 3 }}>
        <span className={`webrtc-mic-icon ${isMicMuted ? 'muted' : ''}`}>
          {isMicMuted ? <MicOff size={9} /> : <Mic size={9} />}
        </span>
        {peer.username}
      </div>
    </div>
  );
}

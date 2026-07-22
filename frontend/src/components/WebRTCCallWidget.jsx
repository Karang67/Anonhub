/**
 * @file WebRTCCallWidget.jsx
 * @description Collaborative anonymous group video and voice call overlay component.
 * Uses WebRTC mesh networking with Socket.IO signaling to establish peer connections.
 * Supports camera toggle, microphone mute/unmute, and screen sharing.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, VideoOff, Mic, MicOff, Tv, PhoneOff, PhoneCall, Volume2 } from 'lucide-react';
import './WebRTCCallWidget.css';

// Public STUN/TURN servers for NAT traversal
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

export default function WebRTCCallWidget({ projectName, socket, username }) {
  const [inCall, setInCall] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [peers, setPeers] = useState([]); // [{ socketId, username, stream }]
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [micMutedMap, setMicMutedMap] = useState({}); // { socketId: boolean }

  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const peersRef = useRef({}); // { socketId: RTCPeerConnection }
  const streamsRef = useRef({}); // { socketId: MediaStream }
  const candidateQueues = useRef({}); // { socketId: [RTCIceCandidate] }
  const screenStreamRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectionAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  const localVideoRefCallback = useCallback((node) => {
    localVideoRef.current = node;
    if (node && localStreamRef.current) {
      node.srcObject = localStreamRef.current;
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // Enhanced Call Session Actions
  // ─────────────────────────────────────────────────────────────────────────────

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

      // Join the signaling pool with enhanced error handling
      socket.emit('webrtc-join-call', { projectName }, (response) => {
        console.log('Join call response:', response);
        if (response && response.error) {
          console.error('Failed to join call:', response.error);
          alert(`Could not join the call: ${response.error}`);
          endCall();
        }
      });
    } catch (err) {
      console.error('Failed to get media devices:', err);
      alert('Camera/microphone access is required to start a call.');
    }
  };

  const endCall = () => {
    // Leave room signaling
    if (socket) {
      socket.emit('webrtc-leave-call', { projectName });
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

    // Close all peer connections with cleanup
    Object.keys(peersRef.current).forEach(id => {
      try {
        peersRef.current[id].close();
      } catch (e) {
        console.warn(`Error closing peer connection ${id}:`, e);
      }
    });
    peersRef.current = {};
    streamsRef.current = {};

    setPeers([]);
    setInCall(false);
    setScreenSharing(false);
    setConnectionStatus('disconnected');

    // Clear any pending reconnection attempts
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectionAttempts.current = 0;
  };

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
      // Re-use a single persistent MediaStream per peer so srcObject stays live
      if (!streamsRef.current[peerSocketId]) {
        streamsRef.current[peerSocketId] = new MediaStream();
      }
      streamsRef.current[peerSocketId].addTrack(event.track);
      const liveStream = streamsRef.current[peerSocketId];

      setPeers(prev => {
        const idx = prev.findIndex(p => p.socketId === peerSocketId);
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = { socketId: peerSocketId, username: peerName, stream: liveStream };
          return updated;
        } else {
          return [...prev, { socketId: peerSocketId, username: peerName, stream: liveStream }];
        }
      });
    };

    pc.onnegotiationneeded = async () => {
      if (isInitiator) {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('webrtc-signal', {
            targetId: peerSocketId,
            signal: { sdp: pc.localDescription }
          });
        } catch (err) {
          console.error('Negotiation error:', err);
        }
      }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    return pc;
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Enhanced WebRTC Signaling & Handshake
  // ─────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!socket) return;

    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    let reconnectTimeout = null;

    const handleSocketConnect = () => {
      console.log('Socket connected, rejoining call if needed');
      setIsReconnecting(false);
      setConnectionStatus('connected');

      if (inCall) {
        socket.emit('webrtc-join-call', { projectName }, (response) => {
          console.log('Rejoin call response:', response);
          if (response && response.error) {
            console.error('Failed to rejoin call after reconnect:', response.error);
          }
        });
      }
    };

    const handleSocketDisconnect = () => {
      console.log('Socket disconnected, attempting to reconnect');
      setConnectionStatus('reconnecting');
      setIsReconnecting(true);

      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }

      const attemptReconnect = () => {
        reconnectAttempts++;
        if (reconnectAttempts <= maxReconnectAttempts) {
          const backoffTime = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 10000);
          reconnectTimeout = setTimeout(() => {
            console.log(`Reconnection attempt ${reconnectAttempts}/${maxReconnectAttempts}`);
            socket.connect();
          }, backoffTime);
        } else {
          console.error('Max reconnection attempts reached');
          setConnectionStatus('reconnection-failed');
        }
      };

      reconnectTimeout = setTimeout(attemptReconnect, 1000);
    };

    const handleUserJoined = ({ socketId, username: peerName }) => {
      // Only create a new PC if we don't already have one for this peer.
      // Do NOT call createOffer() here — onnegotiationneeded inside
      // createPeerConnection fires automatically after addTrack() and
      // sends the offer. Creating a second offer here causes SDP glare.
      if (!peersRef.current[socketId]) {
        const pc = createPeerConnection(socketId, peerName, true);
        peersRef.current[socketId] = pc;
      }
    };

    const handleSignal = async ({ senderId, signal }) => {
      let pc = peersRef.current[senderId];

      if (!pc) {
        pc = createPeerConnection(senderId, 'Anonymous participant', false);
        peersRef.current[senderId] = pc;
      }

      try {
        if (signal.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

          // Flush queued candidates
          const queue = candidateQueues.current[senderId] || [];
          while (queue.length > 0) {
            const cand = queue.shift();
            await pc.addIceCandidate(cand).catch(() => { });
          }
          candidateQueues.current[senderId] = [];

          if (signal.sdp.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('webrtc-signal', {
              targetId: senderId,
              signal: { sdp: pc.localDescription }
            });
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
        console.error('Error processing signal:', err);
      }
    };

    const handleUserLeft = ({ socketId }) => {
      if (peersRef.current[socketId]) {
        try {
          peersRef.current[socketId].close();
        } catch (e) {
          console.warn(`Error closing peer connection ${socketId}:`, e);
        }
        delete peersRef.current[socketId];
      }
      if (streamsRef.current[socketId]) {
        delete streamsRef.current[socketId];
      }
      setPeers(prev => prev.filter(p => p.socketId !== socketId));
    };

    const handlePeerMicStatus = ({ socketId, muted }) => {
      setMicMutedMap(prev => ({ ...prev, [socketId]: muted }));
    };

    socket.on('connect', handleSocketConnect);
    socket.on('disconnect', handleSocketDisconnect);
    socket.on('webrtc-user-joined', handleUserJoined);
    socket.on('webrtc-signal', handleSignal);
    socket.on('webrtc-user-left', handleUserLeft);
    socket.on('peer-mic-status', handlePeerMicStatus);

    return () => {
      socket.off('connect', handleSocketConnect);
      socket.off('disconnect', handleSocketDisconnect);
      socket.off('webrtc-user-joined', handleUserJoined);
      socket.off('webrtc-signal', handleSignal);
      socket.off('webrtc-user-left', handleUserLeft);
      socket.off('peer-mic-status', handlePeerMicStatus);

      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (inCall) {
        endCall();
      }
    };
  }, [socket, inCall, projectName]);

  const toggleMic = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const nowMuted = !audioTrack.enabled;
        setMicMuted(nowMuted);
        // Broadcast mute state to peers
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
      replaceVideoTrack(localStreamRef.current.getVideoTracks()[0]);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = stream;
        setScreenSharing(true);

        const screenTrack = stream.getVideoTracks()[0];
        replaceVideoTrack(screenTrack);

        screenTrack.onended = () => {
          setScreenSharing(false);
          replaceVideoTrack(localStreamRef.current.getVideoTracks()[0]);
        };
      } catch (err) {
        console.error('Failed to start screen share:', err);
        if (err.name === 'AbortError') {
          console.log('Screen sharing cancelled by user');
        } else {
          alert('Failed to start screen sharing. Please try again.');
        }
      }
    }
  };

  const replaceVideoTrack = (newTrack) => {
    Object.values(peersRef.current).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(newTrack).catch(err => {
          console.error('Error replacing video track:', err);
        });
      }
    });

    if (localVideoRef.current) {
      const currentStream = localVideoRef.current.srcObject;
      if (currentStream) {
        const oldTrack = currentStream.getVideoTracks()[0];
        if (oldTrack) {
          currentStream.removeTrack(oldTrack);
          currentStream.addTrack(newTrack);
          // Re-assign srcObject to force browser video element refresh
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
          <PhoneCall size={14} /> Join Voice &amp; Video
        </button>
      ) : (
        <div className="webrtc-call-workspace">
          {/* Participant count */}
          <div className="webrtc-participant-count">
            <span className="webrtc-live-dot" />
            {1 + peers.length} participant{(1 + peers.length) !== 1 ? 's' : ''}
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

            {/* Remote peer tiles */}
            {peers.map(peer => (
              <VideoCard
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

function VideoCard({ peer, isMicMuted }) {
  const videoRef = useRef(null);

  const videoRefCallback = useCallback((node) => {
    videoRef.current = node;
    if (node && peer.stream) {
      node.srcObject = peer.stream;
      node.play().catch(() => {});
    }
  }, [peer.stream]);

  useEffect(() => {
    if (videoRef.current && peer.stream) {
      videoRef.current.srcObject = peer.stream;
      videoRef.current.play().catch(() => {});
    }
  }, [peer.stream]);

  return (
    <div className="video-card remote-view" style={{ position: 'relative' }}>
      <video
        ref={videoRefCallback}
        autoPlay
        playsInline
        muted={false}
        className="video-element"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
      {!peer.stream && (
        <div className="video-avatar-placeholder" style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', background: '#13152a' }}>
          <div
            className="video-initials-circle"
            style={{ background: getAvatarColor(peer.username) }}
          >
            {getInitials(peer.username)}
          </div>
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

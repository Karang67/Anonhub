/**
 * @file WebRTCCallWidget.jsx
 * @description Collaborative anonymous group video and voice call overlay component.
 * Uses WebRTC mesh networking with Socket.IO signaling to establish peer connections.
 * Supports camera toggle, microphone mute/unmute, and screen sharing.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Video, VideoOff, Mic, MicOff, Tv, PhoneOff, PhoneCall, Volume2 } from 'lucide-react';
import './WebRTCCallWidget.css';

// Public Google STUN servers for NAT traversal
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

export default function WebRTCCallWidget({ projectName, socket, username }) {
  const [inCall, setInCall] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [peers, setPeers] = useState([]); // [{ socketId, username, stream }]

  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const peersRef = useRef({}); // { socketId: RTCPeerConnection }
  const streamsRef = useRef({}); // { socketId: MediaStream }
  const screenStreamRef = useRef(null);

  // ─────────────────────────────────────────────────────────────────────────────
  // Call Session Actions
  // ─────────────────────────────────────────────────────────────────────────────

  const startCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setInCall(true);
      setVideoMuted(false);
      setMicMuted(false);

      // Join the signaling pool
      socket.emit('webrtc-join-call', { projectName });
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

    // Close all peer connections
    Object.keys(peersRef.current).forEach(id => {
      peersRef.current[id].close();
    });
    peersRef.current = {};
    streamsRef.current = {};

    setPeers([]);
    setInCall(false);
    setScreenSharing(false);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // WebRTC Signaling & Handshake
  // ─────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!socket) return;

    // A new user joined the call room
    const handleUserJoined = async ({ socketId, username: peerName }) => {
      console.log('Peer joined call:', socketId, peerName);
      const pc = createPeerConnection(socketId, peerName, true);
      peersRef.current[socketId] = pc;
    };

    // Receive RTC offers, answers, ICE candidates
    const handleSignal = async ({ senderId, signal }) => {
      let pc = peersRef.current[senderId];
      
      // If peer connection doesn't exist, create it (as answerer)
      if (!pc) {
        pc = createPeerConnection(senderId, 'Anonymous participant', false);
        peersRef.current[senderId] = pc;
      }

      if (signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        if (signal.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('webrtc-signal', {
            targetId: senderId,
            signal: { sdp: pc.localDescription }
          });
        }
      } else if (signal.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch (e) {
          console.warn('Error adding ICE candidate:', e);
        }
      }
    };

    // Participant left the call
    const handleUserLeft = ({ socketId }) => {
      console.log('Peer left call:', socketId);
      if (peersRef.current[socketId]) {
        peersRef.current[socketId].close();
        delete peersRef.current[socketId];
      }
      if (streamsRef.current[socketId]) {
        delete streamsRef.current[socketId];
      }
      setPeers(prev => prev.filter(p => p.socketId !== socketId));
    };

    socket.on('webrtc-user-joined', handleUserJoined);
    socket.on('webrtc-signal', handleSignal);
    socket.on('webrtc-user-left', handleUserLeft);

    return () => {
      socket.off('webrtc-user-joined', handleUserJoined);
      socket.off('webrtc-signal', handleSignal);
      socket.off('webrtc-user-left', handleUserLeft);
      // Clean call on unmount
      if (inCall) endCall();
    };
  }, [socket, inCall, projectName]);

  const createPeerConnection = (peerSocketId, peerName, isInitiator) => {
    const pc = new RTCPeerConnection(RTC_CONFIG);

    // Add local tracks to the connection
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    // ICE Candidate gathering
    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('webrtc-signal', {
          targetId: peerSocketId,
          signal: { candidate: event.candidate }
        });
      }
    };

    // Remote stream track added
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      streamsRef.current[peerSocketId] = remoteStream;

      setPeers(prev => {
        const idx = prev.findIndex(p => p.socketId === peerSocketId);
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = { socketId: peerSocketId, username: peerName, stream: remoteStream };
          return updated;
        } else {
          return [...prev, { socketId: peerSocketId, username: peerName, stream: remoteStream }];
        }
      });
    };

    // If initiator, generate the RTC offer
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

    return pc;
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Track Controls
  // ─────────────────────────────────────────────────────────────────────────────

  const toggleMic = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setMicMuted(!audioTrack.enabled);
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
      // Stop screen sharing and return to webcam
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

        // When user stops sharing via browser bar
        screenTrack.onended = () => {
          setScreenSharing(false);
          replaceVideoTrack(localStreamRef.current.getVideoTracks()[0]);
        };
      } catch (err) {
        console.error('Failed to start screen share:', err);
      }
    }
  };

  const replaceVideoTrack = (newTrack) => {
    Object.values(peersRef.current).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(newTrack);
      }
    });
    // Update local video element preview
    if (localVideoRef.current) {
      const currentStream = localVideoRef.current.srcObject;
      if (currentStream) {
        const oldTrack = currentStream.getVideoTracks()[0];
        if (oldTrack) {
          currentStream.removeTrack(oldTrack);
          currentStream.addTrack(newTrack);
        }
      }
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // DOM Render
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="webrtc-call-container">
      {!inCall ? (
        <button className="call-btn-trigger" onClick={startCall}>
          <PhoneCall size={14} /> Join Voice & Video
        </button>
      ) : (
        <div className="webrtc-call-workspace">
          <div className="webrtc-video-grid">
            {/* Local Client View */}
            <div className="video-card local-view">
              <video 
                ref={localVideoRef} 
                autoPlay 
                playsInline 
                muted 
                className={`video-element ${videoMuted ? 'muted' : ''}`}
              />
              <div className="participant-badge">
                {username} (You)
              </div>
              {videoMuted && (
                <div className="video-avatar-placeholder">
                  👤
                </div>
              )}
            </div>

            {/* Remote Participants Views */}
            {peers.map(peer => (
              <VideoCard key={peer.socketId} peer={peer} />
            ))}
          </div>

          {/* Controls Bar */}
          <div className="webrtc-controls-bar">
            <button 
              onClick={toggleMic} 
              className={`call-tool-btn ${micMuted ? 'active' : ''}`}
              title={micMuted ? "Unmute Mic" : "Mute Mic"}
            >
              {micMuted ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            
            <button 
              onClick={toggleVideo} 
              className={`call-tool-btn ${videoMuted ? 'active' : ''}`}
              title={videoMuted ? "Turn Video On" : "Turn Video Off"}
            >
              {videoMuted ? <VideoOff size={16} /> : <Video size={16} />}
            </button>

            <button 
              onClick={toggleScreenShare} 
              className={`call-tool-btn ${screenSharing ? 'active' : ''}`}
              title={screenSharing ? "Stop Sharing" : "Share Screen"}
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

/**
 * Peer Video stream binder component helper
 */
function VideoCard({ peer }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && peer.stream) {
      videoRef.current.srcObject = peer.stream;
    }
  }, [peer.stream]);

  return (
    <div className="video-card remote-view">
      <video 
        ref={videoRef} 
        autoPlay 
        playsInline 
        className="video-element"
      />
      <div className="participant-badge">
        {peer.username}
      </div>
    </div>
  );
}

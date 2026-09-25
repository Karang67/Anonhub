/**
 * @file callSession.js
 * @description High-performance, persistent WebRTC Call Session Manager for AnonHub.
 * Features:
 * - Direct peer-to-peer WebRTC mesh with Google & Cloudflare STUN + Metered TURN fallbacks
 * - Perfect negotiation pattern (W3C recommended) to eliminate SDP glare and race conditions
 * - Zero-latency track replacement for seamless camera switching & screen sharing without renegotiation
 * - Route-persistent in-memory call state preserved across navigation (/projects, /chat, /call, /whiteboard, /code)
 * - Auto-recovery and session restore after page reloads via sessionStorage
 * - Dynamic subscriber model for real-time UI synchronization
 */

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443'
      ],
      username: 'openrelay',
      credential: 'openrelay'
    }
  ],
  iceCandidatePoolSize: 2,
  bundlePolicy: 'max-bundle'
};

class CallSessionManager {
  constructor() {
    this.activeRoom = null;
    this.username = '';
    this.socket = null;
    this.inCall = false;
    this.connectionStatus = 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
    
    // Media streams
    this.localStream = null;
    this.screenStream = null;
    this.screenSharing = false;
    this.micMuted = false;
    this.videoMuted = false;
    this.facingMode = 'user';

    // WebRTC Peer State: socketId -> RTCPeerConnection
    this.peerConnections = new Map();
    // Remote Media Streams: socketId -> MediaStream
    this.remoteStreams = new Map();
    // Peer Meta: socketId -> { socketId, username, micMuted, videoMuted }
    this.peerRoster = new Map();
    // Candidate queues for early ICE arrivals before remote description
    this.iceCandidateQueues = new Map();
    // Making-offer flag for perfect negotiation
    this.makingOffer = new Map();

    // Subscribers (React components listening for updates)
    this.subscribers = new Set();
    this.boundSocketEvents = false;
  }

  // ─── Subscriber Pattern ───────────────────────────────────────────────────

  subscribe(callback) {
    this.subscribers.add(callback);
    // Initial emit
    try { callback(this.getState()); } catch (e) {}
    return () => this.subscribers.delete(callback);
  }

  notify() {
    const state = this.getState();
    this.subscribers.forEach(cb => {
      try { cb(state); } catch (e) { console.error('CallSession subscriber error:', e); }
    });
  }

  getState() {
    return {
      activeRoom: this.activeRoom,
      username: this.username,
      inCall: this.inCall,
      connectionStatus: this.connectionStatus,
      localStream: this.localStream,
      screenStream: this.screenStream,
      screenSharing: this.screenSharing,
      micMuted: this.micMuted,
      videoMuted: this.videoMuted,
      facingMode: this.facingMode,
      peers: Array.from(this.peerRoster.values()),
      remoteStreams: new Map(this.remoteStreams)
    };
  }

  // ─── Persistence Helpers ──────────────────────────────────────────────────

  persistCallState(roomName, extra = {}) {
    if (typeof sessionStorage === 'undefined' || !roomName) return;
    try {
      const state = {
        active: true,
        roomName,
        timestamp: Date.now(),
        micMuted: this.micMuted,
        videoMuted: this.videoMuted,
        ...extra
      };
      sessionStorage.setItem(`trinetra_active_call_${roomName}`, JSON.stringify(state));
      sessionStorage.setItem(`anonhub_active_call_${roomName}`, JSON.stringify(state));
    } catch (e) {}
  }

  clearPersistedCallState(roomName) {
    if (typeof sessionStorage === 'undefined') return;
    try {
      const targetRoom = roomName || this.activeRoom;
      if (targetRoom) {
        sessionStorage.removeItem(`trinetra_active_call_${targetRoom}`);
        sessionStorage.removeItem(`anonhub_active_call_${targetRoom}`);
      }
      Object.keys(sessionStorage).forEach(key => {
        if (key.startsWith('trinetra_active_call_') || key.startsWith('anonhub_active_call_')) {
          sessionStorage.removeItem(key);
        }
      });
    } catch (e) {}
  }

  getPersistedCallState(roomName) {
    if (typeof sessionStorage === 'undefined' || !roomName) return null;
    try {
      const raw = sessionStorage.getItem(`trinetra_active_call_${roomName}`) || sessionStorage.getItem(`anonhub_active_call_${roomName}`);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  isSessionActive(roomName) {
    if (this.inCall && this.activeRoom === roomName) return true;
    const persisted = this.getPersistedCallState(roomName);
    return !!(persisted && persisted.active);
  }

  // ─── Socket Signaling Listeners ───────────────────────────────────────────

  attachSocket(socket) {
    if (!socket || this.socket === socket) return;
    
    // Detach old socket listeners if re-attaching
    if (this.socket) {
      this.detachSocket();
    }

    this.socket = socket;

    this._onUserJoined = ({ socketId, username }) => this.handlePeerJoined(socketId, username);
    this._onUserLeft = ({ socketId }) => this.handlePeerLeft(socketId);
    this._onSignal = ({ senderId, senderUsername, signal }) => this.handleSignal(senderId, senderUsername, signal);
    this._onMicStatus = ({ socketId, muted }) => this.handlePeerMicStatus(socketId, muted);
    this._onDisconnect = () => {
      if (this.inCall) {
        this.connectionStatus = 'reconnecting';
        this.notify();
      }
    };
    this._onConnect = () => {
      if (this.inCall && this.activeRoom) {
        this.connectionStatus = 'connected';
        this.socket.emit('webrtc-join-call', { projectName: this.activeRoom }, (res) => {
          if (res?.existingPeers) {
            res.existingPeers.forEach(p => this.createPeerConnection(p.socketId, p.username, true));
          }
        });
        this.notify();
      }
    };

    socket.on('webrtc-user-joined', this._onUserJoined);
    socket.on('webrtc-user-left', this._onUserLeft);
    socket.on('webrtc-signal', this._onSignal);
    socket.on('peer-mic-status', this._onMicStatus);
    socket.on('disconnect', this._onDisconnect);
    socket.on('connect', this._onConnect);
    this.boundSocketEvents = true;
  }

  detachSocket() {
    if (!this.socket || !this.boundSocketEvents) return;
    this.socket.off('webrtc-user-joined', this._onUserJoined);
    this.socket.off('webrtc-user-left', this._onUserLeft);
    this.socket.off('webrtc-signal', this._onSignal);
    this.socket.off('peer-mic-status', this._onMicStatus);
    this.socket.off('disconnect', this._onDisconnect);
    this.socket.off('connect', this._onConnect);
    this.boundSocketEvents = false;
  }

  // ─── Call Lifecycle (Start / Join / Leave) ────────────────────────────────

  async startCall({ roomName, username, socket, preferScreen = false }) {
    if (!roomName) return false;

    // If already in call for this room with active local stream, re-notify and return
    if (this.inCall && this.activeRoom === roomName && this.localStream) {
      if (socket) this.attachSocket(socket);
      this.notify();
      return true;
    }

    this.activeRoom = roomName;
    this.username = username || this.username || 'Participant';
    if (socket) this.attachSocket(socket);
    this.connectionStatus = 'connecting';
    this.notify();

    try {
      // 1. Acquire Local Media Stream
      let stream;
      if (preferScreen) {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always' },
          audio: true
        });
        this.screenStream = stream;
        this.screenSharing = true;
      } else {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, max: 60 },
              facingMode: this.facingMode
            },
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          });
        } catch (mediaErr) {
          // Camera unavailable, fallback to audio only
          console.warn('Camera failed, falling back to audio only:', mediaErr);
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          });
          this.videoMuted = true;
        }
      }

      this.localStream = stream;
      this.inCall = true;
      this.connectionStatus = 'connected';
      this.persistCallState(roomName, { active: true });

      // Apply initial mute settings
      if (stream.getAudioTracks()[0]) {
        stream.getAudioTracks()[0].enabled = !this.micMuted;
      }
      if (stream.getVideoTracks()[0]) {
        stream.getVideoTracks()[0].enabled = !this.videoMuted;
      }

      // Handle screen share stop via browser native UI bar
      if (preferScreen && stream.getVideoTracks()[0]) {
        stream.getVideoTracks()[0].onended = () => this.stopScreenShare();
      }

      // 2. Join WebRTC Room via Socket
      if (this.socket) {
        this.socket.emit('webrtc-join-call', { projectName: roomName }, (response) => {
          if (response && response.success && Array.isArray(response.existingPeers)) {
            response.existingPeers.forEach(peer => {
              this.createPeerConnection(peer.socketId, peer.username, true);
            });
          }
        });
      }

      this.notify();
      return true;
    } catch (err) {
      console.error('Call initiation error:', err);
      this.inCall = false;
      this.connectionStatus = 'disconnected';
      this.notify();
      throw err;
    }
  }

  endSession() {
    this.endCall();
  }

  endCall() {
    if (this.socket && this.activeRoom) {
      this.socket.emit('webrtc-leave-call', { projectName: this.activeRoom });
    }

    // Stop all media tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
    }

    // Close all peer connections
    this.peerConnections.forEach(pc => {
      try { pc.close(); } catch (e) {}
    });
    this.peerConnections.clear();
    this.remoteStreams.clear();
    this.peerRoster.clear();
    this.iceCandidateQueues.clear();
    this.makingOffer.clear();

    const previousRoom = this.activeRoom;
    this.clearPersistedCallState(previousRoom);
    this.activeRoom = null;
    this.inCall = false;
    this.screenSharing = false;
    this.connectionStatus = 'disconnected';
    this.notify();
  }

  // ─── WebRTC Mesh Peer Connection Logic ────────────────────────────────────

  createPeerConnection(peerId, peerUsername = 'Participant', isInitiator = false) {
    if (this.peerConnections.has(peerId)) {
      return this.peerConnections.get(peerId);
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.peerConnections.set(peerId, pc);
    this.peerRoster.set(peerId, { socketId: peerId, username: peerUsername, micMuted: false });
    this.iceCandidateQueues.set(peerId, []);
    this.makingOffer.set(peerId, false);

    // 1. Add local tracks to peer connection
    const currentStream = this.screenSharing && this.screenStream ? this.screenStream : this.localStream;
    if (currentStream) {
      currentStream.getTracks().forEach(track => {
        pc.addTrack(track, currentStream);
      });
      // Also add mic audio if screen sharing is active
      if (this.screenSharing && this.localStream && this.localStream.getAudioTracks()[0]) {
        const audioTrack = this.localStream.getAudioTracks()[0];
        if (!pc.getSenders().some(s => s.track === audioTrack)) {
          pc.addTrack(audioTrack, this.localStream);
        }
      }
    }

    // 2. ICE Candidates Handling
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && this.socket) {
        this.socket.emit('webrtc-signal', {
          targetId: peerId,
          signal: { type: 'candidate', candidate }
        });
      }
    };

    // 3. Remote Tracks Handling
    pc.ontrack = (event) => {
      let remoteStream = this.remoteStreams.get(peerId);
      if (!remoteStream) {
        remoteStream = new MediaStream();
        this.remoteStreams.set(peerId, remoteStream);
      }
      if (event.streams && event.streams[0]) {
        event.streams[0].getTracks().forEach(track => {
          if (!remoteStream.getTracks().some(t => t.id === track.id)) {
            remoteStream.addTrack(track);
          }
        });
      } else if (event.track) {
        if (!remoteStream.getTracks().some(t => t.id === event.track.id)) {
          remoteStream.addTrack(event.track);
        }
      }
      this.notify();
    };

    // 4. Connection State Monitor
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        console.warn(`ICE failed for peer ${peerId}. Restarting ICE...`);
        pc.restartIce();
      } else if (pc.iceConnectionState === 'disconnected') {
        setTimeout(() => {
          if (pc.iceConnectionState === 'disconnected') {
            this.handlePeerLeft(peerId);
          }
        }, 5000);
      }
    };

    // 5. Perfect Negotiation: negotiationneeded
    pc.onnegotiationneeded = async () => {
      try {
        if (pc.signalingState !== 'stable') return;
        this.makingOffer.set(peerId, true);
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') return;
        await pc.setLocalDescription(offer);
        if (this.socket) {
          this.socket.emit('webrtc-signal', {
            targetId: peerId,
            signal: { type: 'offer', sdp: pc.localDescription }
          });
        }
      } catch (err) {
        console.error(`Negotiation needed error for ${peerId}:`, err);
      } finally {
        this.makingOffer.set(peerId, false);
      }
    };

    // If initiator and tracks exist, ensure initial negotiation happens smoothly
    if (isInitiator && pc.signalingState === 'stable') {
      pc.onnegotiationneeded();
    }

    this.notify();
    return pc;
  }

  async handleSignal(senderId, senderUsername, signal) {
    if (!signal) return;

    let pc = this.peerConnections.get(senderId);
    if (!pc) {
      pc = this.createPeerConnection(senderId, senderUsername, false);
    } else if (senderUsername && this.peerRoster.has(senderId)) {
      this.peerRoster.get(senderId).username = senderUsername;
    }

    try {
      if (signal.type === 'offer') {
        const polite = (this.socket?.id || '') < senderId;
        const offerCollision = this.makingOffer.get(senderId) || pc.signalingState !== 'stable';
        
        if (offerCollision && !polite) {
          return; // Ignore offer from impolite peer during collision
        }

        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

        // Flush queued ICE candidates
        const queue = this.iceCandidateQueues.get(senderId) || [];
        while (queue.length > 0) {
          const candidate = queue.shift();
          try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        if (this.socket) {
          this.socket.emit('webrtc-signal', {
            targetId: senderId,
            signal: { type: 'answer', sdp: pc.localDescription }
          });
        }
      } else if (signal.type === 'answer') {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          // Flush queued candidates
          const queue = this.iceCandidateQueues.get(senderId) || [];
          while (queue.length > 0) {
            const candidate = queue.shift();
            try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
          }
        }
      } else if (signal.type === 'candidate' && signal.candidate) {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } catch (e) {
            console.warn('ICE candidate addition error:', e);
          }
        } else {
          // Queue candidate until remote description is set
          const queue = this.iceCandidateQueues.get(senderId) || [];
          queue.push(signal.candidate);
          this.iceCandidateQueues.set(senderId, queue);
        }
      }
    } catch (err) {
      console.error(`Signaling error handling ${signal.type} from ${senderId}:`, err);
    }
  }

  handlePeerJoined(socketId, username) {
    if (socketId === this.socket?.id) return;
    this.createPeerConnection(socketId, username, true);
  }

  handlePeerLeft(socketId) {
    const pc = this.peerConnections.get(socketId);
    if (pc) {
      try { pc.close(); } catch (e) {}
      this.peerConnections.delete(socketId);
    }
    this.remoteStreams.delete(socketId);
    this.peerRoster.delete(socketId);
    this.iceCandidateQueues.delete(socketId);
    this.makingOffer.delete(socketId);
    this.notify();
  }

  handlePeerMicStatus(socketId, muted) {
    if (this.peerRoster.has(socketId)) {
      this.peerRoster.get(socketId).micMuted = !!muted;
      this.notify();
    }
  }

  // ─── Fast Controls (Mute / Camera / Screen Share) ─────────────────────────

  toggleMic() {
    if (!this.localStream) return;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      this.micMuted = !audioTrack.enabled;
      if (this.socket && this.activeRoom) {
        this.socket.emit('mic-status', { projectName: this.activeRoom, muted: this.micMuted });
      }
      this.notify();
    }
  }

  toggleVideo() {
    if (!this.localStream) return;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      this.videoMuted = !videoTrack.enabled;
      this.notify();
    }
  }

  async switchCamera() {
    if (!this.localStream || this.screenSharing) return;
    const nextMode = this.facingMode === 'user' ? 'environment' : 'user';

    try {
      let newStream;
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: nextMode } }
        });
      } catch (e) {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: nextMode }
        });
      }

      const newVideoTrack = newStream.getVideoTracks()[0];
      if (!newVideoTrack) return;

      const oldVideoTrack = this.localStream.getVideoTracks()[0];
      if (oldVideoTrack) {
        oldVideoTrack.stop();
        this.localStream.removeTrack(oldVideoTrack);
      }

      this.localStream.addTrack(newVideoTrack);
      this.facingMode = nextMode;

      // Ultra-fast track replacement across all active peer connections
      for (const pc of this.peerConnections.values()) {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          sender.replaceTrack(newVideoTrack).catch(console.warn);
        }
      }

      this.notify();
    } catch (err) {
      console.error('Camera switch error:', err);
    }
  }

  async toggleScreenShare() {
    if (this.screenSharing) {
      this.stopScreenShare();
    } else {
      await this.startScreenShare();
    }
  }

  async startScreenShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: true
      });

      const screenTrack = stream.getVideoTracks()[0];
      if (!screenTrack) return;

      this.screenStream = stream;
      this.screenSharing = true;

      // Swap track on all active connections instantly
      for (const pc of this.peerConnections.values()) {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          sender.replaceTrack(screenTrack).catch(console.warn);
        } else {
          pc.addTrack(screenTrack, stream);
        }
      }

      screenTrack.onended = () => this.stopScreenShare();
      this.notify();
    } catch (err) {
      console.warn('Screen share canceled or denied:', err);
    }
  }

  stopScreenShare() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
    }
    this.screenSharing = false;

    // Restore camera track to all peers
    const camTrack = this.localStream ? this.localStream.getVideoTracks()[0] : null;
    if (camTrack) {
      for (const pc of this.peerConnections.values()) {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          sender.replaceTrack(camTrack).catch(console.warn);
        }
      }
    }

    this.notify();
  }
}

export const globalCallSession = new CallSessionManager();

/**
 * @file callSession.js
 * @description Global call session manager to preserve Media over QUIC (MoQ) 
 * connections and system-wide screen sharing across route navigation.
 */

class CallSessionManager {
  constructor() {
    this.activeRoom = null;
    this.localStream = null;
    this.screenStream = null;
    this.moqSession = null;
    this.socket = null;
    this.inCall = false;
    this.screenSharing = false;
    this.facingMode = 'user';
  }

  setSession({ roomName, localStream, screenStream, moqSession, socket }) {
    this.activeRoom = roomName;
    if (localStream) this.localStream = localStream;
    if (screenStream) {
      this.screenStream = screenStream;
      this.screenSharing = true;
    }
    if (moqSession) this.moqSession = moqSession;
    if (socket) this.socket = socket;
    this.inCall = true;
  }

  isSessionActive(roomName) {
    return this.inCall && this.activeRoom === roomName;
  }

  stopScreenShare() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
    }
    this.screenSharing = false;
  }

  endSession() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.moqSession) {
      this.moqSession.disconnect();
      this.moqSession = null;
    }
    if (this.socket && this.activeRoom) {
      this.socket.emit('moq-leave-room', { projectName: this.activeRoom });
    }
    this.activeRoom = null;
    this.inCall = false;
    this.screenSharing = false;
  }
}

export const globalCallSession = new CallSessionManager();

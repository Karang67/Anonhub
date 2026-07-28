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
    this.persistCallState(roomName, { active: true });
  }

  isSessionActive(roomName) {
    if (this.inCall && this.activeRoom === roomName) return true;
    const persisted = this.getPersistedCallState(roomName);
    return !!(persisted && persisted.active);
  }

  persistCallState(roomName, extra = {}) {
    if (typeof sessionStorage === 'undefined' || !roomName) return;
    try {
      const state = {
        active: true,
        roomName,
        timestamp: Date.now(),
        ...extra
      };
      sessionStorage.setItem(`anonhub_active_call_${roomName}`, JSON.stringify(state));
    } catch (e) { }
  }

  clearPersistedCallState(roomName) {
    if (typeof sessionStorage === 'undefined') return;
    try {
      const targetRoom = roomName || this.activeRoom;
      if (targetRoom) {
        sessionStorage.removeItem(`anonhub_active_call_${targetRoom}`);
      }
      Object.keys(sessionStorage).forEach(key => {
        if (key.startsWith('anonhub_active_call_')) {
          sessionStorage.removeItem(key);
        }
      });
    } catch (e) { }
  }

  getPersistedCallState(roomName) {
    if (typeof sessionStorage === 'undefined' || !roomName) return null;
    try {
      const raw = sessionStorage.getItem(`anonhub_active_call_${roomName}`);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
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
    this.clearPersistedCallState(this.activeRoom);
    this.activeRoom = null;
    this.inCall = false;
    this.screenSharing = false;
  }
}

export const globalCallSession = new CallSessionManager();


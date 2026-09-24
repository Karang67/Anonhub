/**
 * @file WhiteboardRoom.jsx
 * @description Dedicated real-time collaborative Whiteboard page for AnonHub.
 * Enables instant anonymous multiplayer drawing sessions without login,
 * automatic room URL generation, room sharing, online participant presence,
 * live cursors, and persistence.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Palette, Users, Share2, Copy, Check, Plus, Download, 
  Trash2, Sparkles, HelpCircle, ArrowLeft, ExternalLink, QrCode, X, Pencil, ArrowRightLeft, LogOut, Grid
} from 'lucide-react';
import QRCode from 'qrcode';
import { initSocket, getCookie, setCookie } from '../services/socket';
import { useFeatureAccess } from '../context/FeatureAccessContext';
import WhiteboardCanvas from '../components/whiteboard/WhiteboardCanvas';
import './WhiteboardRoom.css';

// Helper to generate unique unpredictable room IDs like wb-7f91-xk24
function generateRoomId() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const part = (len) => {
    let res = '';
    for (let i = 0; i < len; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return res;
  };
  return `wb-${part(4)}-${part(4)}`;
}

export default function WhiteboardRoom() {
  const { roomName } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const socketRef = useRef(null);
  const { isFeatureVisible, can } = useFeatureAccess();

  // User identity state
  const [currentUser, setCurrentUser] = useState(() => {
    const savedName = sessionStorage.getItem('trinetra-username') || sessionStorage.getItem('anonhub-username') || getCookie('trinetra-username') || getCookie('anonhub-username');
    const randomNum = Math.floor(100 + Math.random() * 900);
    const guestName = savedName || `Guest-${randomNum}`;
    
    // Save to cookies/session
    sessionStorage.setItem('trinetra-username', guestName);
    sessionStorage.setItem('anonhub-username', guestName);
    setCookie('trinetra-username', guestName);
    setCookie('anonhub-username', guestName);

    return {
      username: guestName,
      color: ['#E11D48', '#2563EB', '#059669', '#D97706', '#7C3AED', '#DB2777', '#0284C7', '#0D9488'][Math.floor(Math.random() * 8)]
    };
  });

  const [roster, setRoster] = useState([]);
  const [copied, setCopied] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [socketReady, setSocketReady] = useState(false);
  const [isGridMode, setIsGridMode] = useState(false);
  const editorInstanceRef = useRef(null);

  // Export board as serialized JSON snapshot
  const handleExportJson = () => {
    if (!editorInstanceRef.current) return;
    try {
      const snapshot = editorInstanceRef.current.store.getSnapshot();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `whiteboard-${roomName}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export error:", e);
    }
  };

  // Toggle Grid
  const handleToggleGrid = () => {
    if (!editorInstanceRef.current) return;
    const next = !isGridMode;
    setIsGridMode(next);
    editorInstanceRef.current.updateInstanceState({ isGridMode: next });
  };

  // Clear Board action
  const handleClearBoard = () => {
    if (!window.confirm("Are you sure you want to clear the entire whiteboard? This will affect all participants.")) return;
    if (editorInstanceRef.current) {
      const shapeIds = Array.from(editorInstanceRef.current.getCurrentPageShapeIds());
      if (shapeIds.length > 0) {
        editorInstanceRef.current.deleteShapes(shapeIds);
      }
    }
    if (socketRef.current) {
      socketRef.current.emit('whiteboard-clear', { roomName });
    }
  };

  // Switch to another room ID
  const handleSwitchRoom = () => {
    const targetRoom = prompt("Enter Room ID to open or join whiteboard:", roomName || '');
    if (targetRoom && targetRoom.trim() && targetRoom.trim() !== roomName) {
      navigate(`/whiteboard/${encodeURIComponent(targetRoom.trim())}`);
    }
  };

  // If no room is specified in the URL, check active project or generate one
  const queryRoom = searchParams.get('room') || searchParams.get('project');
  useEffect(() => {
    if (!roomName) {
      if (queryRoom) {
        navigate(`/whiteboard/${encodeURIComponent(queryRoom)}`, { replace: true });
        return;
      }
      const activeProject = sessionStorage.getItem('trinetra-active-project-room') || sessionStorage.getItem('anonhub-active-project-room') || getCookie('trinetra-active-project-room');
      const newRoom = activeProject || generateRoomId();
      navigate(`/whiteboard/${newRoom}`, { replace: true });
    }
  }, [roomName, queryRoom, navigate]);

  // Initialize socket instance
  useEffect(() => {
    if (!roomName) return;

    const socket = initSocket();
    socketRef.current = socket;
    setSocketReady(true);

    socket.on('set username', (assignedName) => {
      if (assignedName) {
        setCurrentUser(prev => ({ ...prev, username: assignedName }));
        sessionStorage.setItem('trinetra-username', assignedName);
        sessionStorage.setItem('anonhub-username', assignedName);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [roomName]);

  // Generate QR Code when share modal is opened
  useEffect(() => {
    if (showShareModal && typeof window !== 'undefined') {
      QRCode.toDataURL(window.location.href, { width: 220, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } })
        .then(url => setQrCodeUrl(url))
        .catch(err => console.error("QR Code Error:", err));
    }
  }, [showShareModal]);

  // Copy link handler
  const handleCopyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {
      // Fallback
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const handleNewBoard = () => {
    const newRoom = generateRoomId();
    navigate(`/whiteboard/${newRoom}`);
  };

  const handleLeaveRoom = () => {
    if (window.confirm(`Are you sure you want to exit whiteboard room "${roomName}"?`)) {
      socketRef.current?.emit('leave whiteboard', { roomName });
      sessionStorage.removeItem('trinetra-active-whiteboard-room');
      sessionStorage.removeItem('anonhub-active-whiteboard-room');
      navigate('/');
    }
  };

  const currentRoom = roomName || queryRoom || 'main';

  return (
    <div className="whiteboard-page-wrapper">
      {/* Top Application Bar */}
      <header className="whiteboard-header">
        {/* Left: Branding & Room Identity */}
        <div className="wb-header-left">
          <div className="wb-brand-badge" onClick={() => navigate('/')} title="Back to Home">
            <Palette className="wb-brand-icon" size={18} />
            <span className="wb-brand-name">AnonHub</span>
            <span className="wb-badge-pill">Whiteboard</span>
          </div>

          <div className="wb-room-tag" title="Click to switch or join any Room ID" onClick={handleSwitchRoom} style={{ cursor: 'pointer' }}>
            <span className="wb-room-label">Room:</span>
            <span className="wb-room-name">{currentRoom}</span>
            <button 
              onClick={(e) => { e.stopPropagation(); handleSwitchRoom(); }} 
              title="Switch to a different room ID"
              style={{ background: 'transparent', border: 'none', color: 'inherit', padding: '2px 4px', cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: 0.85 }}
            >
              <Pencil size={11} />
            </button>
          </div>
        </div>

        {/* Center: Connected Participants */}
        {isFeatureVisible('whiteboard.collaboration') && (
          <div className="wb-header-center">
            <div className="wb-roster-badge" title="Active collaborators online">
              <Users size={14} className="wb-users-icon" />
              <span className="wb-roster-count">{roster.length || 1} online</span>
            </div>

            <div className="wb-participants-list">
              {roster.slice(0, 4).map((p) => (
                <div 
                  key={p.id} 
                  className={`wb-user-pill ${p.isSelf ? 'self' : ''}`}
                  style={{ borderColor: p.color || '#2563EB' }}
                  title={`${p.username} ${p.isSelf ? '(You)' : ''}`}
                >
                  <span className="wb-user-dot" style={{ backgroundColor: p.color || '#2563EB' }} />
                  <span className="wb-user-name">{p.username} {p.isSelf ? '(You)' : ''}</span>
                </div>
              ))}
              {roster.length > 4 && (
                <div className="wb-user-overflow">+{roster.length - 4}</div>
              )}
            </div>
          </div>
        )}

        {/* Right: Actions */}
        <div className="wb-header-right">
          <button 
            className="wb-action-btn wb-btn-switch"
            onClick={handleSwitchRoom}
            title="Open or join a different Room ID"
          >
            <ArrowRightLeft size={13} />
            <span className="wb-btn-label">Switch Room</span>
          </button>
          <button 
            className="wb-action-btn wb-btn-grid"
            onClick={handleToggleGrid}
            title={isGridMode ? 'Hide Grid' : 'Show Grid Dots'}
          >
            <Grid size={13} />
            <span className="wb-btn-label">{isGridMode ? 'Grid On' : 'Grid Off'}</span>
          </button>

          {isFeatureVisible('whiteboard.export') && (
            <button 
              className="wb-action-btn wb-btn-export"
              onClick={handleExportJson}
              title="Download Canvas as JSON Snapshot"
            >
              <Download size={14} />
              <span className="wb-btn-label">Export JSON</span>
            </button>
          )}

          <button 
            className="wb-action-btn wb-btn-clear"
            onClick={handleClearBoard}
            title="Clear all drawings on this whiteboard"
          >
            <Trash2 size={14} />
          </button>

          <button 
            className="wb-action-btn wb-btn-share"
            onClick={() => setShowShareModal(true)}
            title="Share Whiteboard Room URL"
          >
            {copied ? <Check size={14} /> : <Share2 size={14} />}
            <span className="wb-btn-label">{copied ? 'Link Copied!' : 'Share'}</span>
          </button>

          <button 
            className="wb-action-btn wb-btn-new"
            onClick={handleNewBoard}
            title="Start a fresh Whiteboard room"
          >
            <Plus size={14} />
            <span className="wb-btn-label">New Board</span>
          </button>

          <button 
            className="wb-action-btn wb-btn-leave"
            onClick={handleLeaveRoom}
            title="Exit Whiteboard Room"
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.12)',
              color: '#ef4444',
              borderColor: 'rgba(239, 68, 68, 0.35)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontWeight: 600
            }}
          >
            <LogOut size={13} />
            <span className="wb-btn-label">Exit</span>
          </button>
        </div>
      </header>

      {/* Main Collaborative Canvas Area */}
      <main className="whiteboard-main-viewport">
        <WhiteboardCanvas 
          roomName={currentRoom}
          socket={socketRef.current}
          currentUser={currentUser}
          onRosterUpdate={setRoster}
          onEditorMount={(ed) => { editorInstanceRef.current = ed; }}
          height="100%"
        />
      </main>

      {/* Share Modal Dialog */}
      {showShareModal && (
        <div className="wb-modal-backdrop" onClick={() => setShowShareModal(false)}>
          <div className="wb-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="wb-modal-header">
              <div className="wb-modal-title">
                <Share2 size={18} />
                <span>Invite Collaborators</span>
              </div>
              <button className="wb-modal-close" onClick={() => setShowShareModal(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="wb-modal-body">
              <p className="wb-modal-desc">
                Anyone with this link can join this Whiteboard immediately and draw together with you in real time — <strong>no account or login required!</strong>
              </p>

              <div className="wb-share-input-group">
                <input 
                  type="text" 
                  readOnly 
                  value={window.location.href}
                  className="wb-share-input"
                  onClick={(e) => e.target.select()}
                />
                <button 
                  className={`wb-copy-btn ${copied ? 'copied' : ''}`}
                  onClick={handleCopyLink}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  <span>{copied ? 'Copied!' : 'Copy'}</span>
                </button>
              </div>

              {qrCodeUrl && (
                <div className="wb-qr-section">
                  <div className="wb-qr-label">Or scan QR Code to join on phone/tablet:</div>
                  <div className="wb-qr-box">
                    <img src={qrCodeUrl} alt="Room QR Code" className="wb-qr-image" />
                  </div>
                </div>
              )}
            </div>

            <div className="wb-modal-footer">
              <button className="wb-modal-btn-done" onClick={() => setShowShareModal(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

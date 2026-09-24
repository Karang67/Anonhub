/**
 * @file ChatRoom.jsx
 * @description Real-time Chat Room client view.
 * Handles instant messaging, peer roster lists, typing indicators, reconnection status,
 * and user avatar hash coloring using a connection to Socket.IO.
 * Enforces key verification gateway overlay (AccessKeyModal) for secure chat spaces.
 *
 * Phase 1 additions:
 * - Share/Invite modal with QR code
 * - Inline image preview + lightbox
 * - "Load older messages" pagination
 * - Custom user nickname (pencil icon edit)
 * - Emoji reactions display
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Users, Send, X, Edit2, Trash2, Link, Check, Copy, Pencil, PhoneCall, Shield, Key, Paperclip, Upload, AlertTriangle, FileText, Download, LogOut, Share2, Sparkles, KeyRound, CheckSquare } from 'lucide-react';
import QRCode from 'qrcode';
import { getApiUrl } from '../config';
import { initSocket, getCookie } from '../services/socket';
import { globalCallSession } from '../services/callSession';
import { deleteRoom } from '../services/api';
import { useFeatureAccess } from '../context/FeatureAccessContext';
import AccessKeyModal from '../components/AccessKeyModal';
import WebRTCCallWidget from '../components/WebRTCCallWidget';
import './ChatRoom.css';

// ─── Image URL detection ─────────────────────────────────────────────────────
const IMAGE_URL_REGEX = /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i;

function ChatImageMessage({ fullUrl, filename, onImageClick }) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <a 
        href={fullUrl} 
        download={filename} 
        target="_blank" 
        rel="noopener noreferrer" 
        className="chat-attachment-card"
        onClick={e => e.stopPropagation()}
      >
        <div className="chat-attachment-icon-box">
          <FileText size={18} />
        </div>
        <div className="chat-attachment-info">
          <span className="chat-attachment-filename" title={filename}>{filename}</span>
          <span className="chat-attachment-meta">IMAGE • Click to view / download</span>
        </div>
        <div className="chat-attachment-download-btn">
          <Download size={15} />
        </div>
      </a>
    );
  }

  return (
    <div className="chat-attachment-image-wrap">
      <img
        src={fullUrl}
        alt={filename}
        className="chat-inline-image"
        onClick={() => onImageClick && onImageClick(fullUrl)}
        onError={() => setHasError(true)}
        loading="lazy"
      />
      <a 
        href={fullUrl} 
        download={filename} 
        className="chat-img-download-overlay" 
        title={`Download ${filename}`}
        onClick={e => e.stopPropagation()}
      >
        <Download size={14} />
      </a>
    </div>
  );
}

/**
 * Renders a single message's text content, auto-detecting attachments, images, and URLs.
 */
function MessageContent({ text, onImageClick }) {
  if (!text) return null;
  const trimmed = text.trim();

  // 1. Check for Audio / Voice Notes
  if (trimmed.startsWith('data:audio') || /\.(mp3|wav|ogg|webm)($|\?)/i.test(trimmed)) {
    return (
      <div className="chat-voice-note-card" style={{ marginTop: '4px', maxWidth: '100%' }}>
        <audio controls src={trimmed} style={{ maxWidth: '100%', height: '36px' }} />
      </div>
    );
  }

  // 2. Check if the message is an attachment or image URL
  const isAttachment = trimmed.includes('/api/attachments/') || trimmed.startsWith('/attachments/');
  const isDirectImage = IMAGE_URL_REGEX.test(trimmed) || (isAttachment && (/\.(jpg|jpeg|png|gif|webp|svg)($|\?)/i.test(trimmed) || /[?&]type=image/i.test(trimmed)));

  // If it is an image
  if (isDirectImage) {
    const fullUrl = trimmed.startsWith('http') ? trimmed : getApiUrl(trimmed);
    let filename = 'Image';
    try {
      const urlObj = new URL(fullUrl, window.location.origin);
      filename = urlObj.searchParams.get('name') || 'image';
    } catch(e) {}

    return <ChatImageMessage fullUrl={fullUrl} filename={filename} onImageClick={onImageClick} />;
  }

  // 3. If it's a non-image attachment (PDF, DOCX, ZIP, or /api/attachments/:id)
  if (isAttachment) {
    const fullUrl = trimmed.startsWith('http') ? trimmed : getApiUrl(trimmed);
    let filename = 'Attachment';
    let fileType = 'File';
    try {
      const urlObj = new URL(fullUrl, window.location.origin);
      filename = urlObj.searchParams.get('name') || urlObj.pathname.split('/').pop() || 'Attachment';
      const rawType = urlObj.searchParams.get('type') || '';
      fileType = rawType ? rawType.split('/').pop() : (filename.split('.').pop() || 'FILE');
    } catch(e) {}

    return (
      <a 
        href={fullUrl} 
        download={filename} 
        target="_blank" 
        rel="noopener noreferrer" 
        className="chat-attachment-card"
        onClick={e => e.stopPropagation()}
      >
        <div className="chat-attachment-icon-box">
          <FileText size={18} />
        </div>
        <div className="chat-attachment-info">
          <span className="chat-attachment-filename" title={filename}>{filename}</span>
          <span className="chat-attachment-meta">{fileType.toUpperCase()} • Click to download</span>
        </div>
        <div className="chat-attachment-download-btn">
          <Download size={15} />
        </div>
      </a>
    );
  }

  // 4. Standard text with URL detection
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return (
    <span className="bubble-content">
      {parts.map((part, i) =>
        urlRegex.test(part) ? (
          <a key={i} href={part} className="chat-link" target="_blank" rel="noopener noreferrer">{part}</a>
        ) : part
      )}
    </span>
  );
}

/**
 * Share / Invite modal with QR code.
 */
function ShareModal({ roomName, accessKey, onClose }) {
  const inviteUrl = `${window.location.origin}/chat/${encodeURIComponent(roomName)}`;
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, inviteUrl, {
        width: 180,
        margin: 2,
        color: { dark: '#1a1a2e', light: '#ffffff' }
      });
    }
  }, [inviteUrl]);

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="chat-lightbox" onClick={onClose}>
      <div className="share-modal" onClick={e => e.stopPropagation()}>
        <div className="share-modal-header">
          <h3>🔗 Invite to Room</h3>
          <button onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <p className="share-modal-subtitle">
          Share this link to invite others to <strong>{roomName}</strong>.
          <span className="share-modal-warning">⚠️ Anyone with this link can join — share privately.</span>
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
          <canvas ref={canvasRef} style={{ borderRadius: '8px' }} />
        </div>
        <div className="share-modal-url-row">
          <input
            type="text"
            className="share-modal-url-input"
            value={inviteUrl}
            readOnly
            onClick={e => e.target.select()}
          />
          <button className={`share-copy-btn ${copied ? 'copied' : ''}`} onClick={handleCopy}>
            {copied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Lightbox overlay for full-size image view.
 */
function ImageLightbox({ src, onClose }) {
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="chat-lightbox" onClick={onClose}>
      <button className="chat-lightbox-close" onClick={onClose} aria-label="Close lightbox">
        <X size={20} />
      </button>
      <img
        src={src}
        alt="Full size"
        className="chat-lightbox-img"
        onClick={e => e.stopPropagation()}
      />
    </div>
  );
}

/**
 * ChatRoom Component
 * Orchestrates local state hooks and listeners to coordinate live chat channels.
 */
export default function ChatRoom() {
  const { roomName } = useParams();
  const navigate = useNavigate();
  const { isFeatureVisible, can } = useFeatureAccess();

  // Real-time synchronization states
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [users, setUsers] = useState([]);
  const [typingUser, setTypingUser] = useState('');
  const [username, setUsername] = useState('');

  // Access Overlay gating states
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayError, setOverlayError] = useState('');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [tourStep, setTourStep] = useState(-1);
  const [isOwner, setIsOwner] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState([]);

  // ── Room Permissions (synced from server) ────────────────────────────────
  const [roomPermissions, setRoomPermissions] = useState({
    allowUserEdit: false,
    allowUserDelete: false,
    allowUserUpload: true
  });

  // ── Owner Permissions Panel (sidebar) ────────────────────────────────────
  const [showPermissionsPanel, setShowPermissionsPanel] = useState(false);

  // ── Owner Key Entry (sidebar — for claiming ownership) ───────────────────
  const [showOwnerKeyEntry, setShowOwnerKeyEntry] = useState(false);
  const [ownerKeyInput, setOwnerKeyInput] = useState('');
  const [ownerKeyError, setOwnerKeyError] = useState('');
  const [ownerKeySuccess, setOwnerKeySuccess] = useState('');
  const [claimingOwnership, setClaimingOwnership] = useState(false);
  const [newCustomOwnerKey, setNewCustomOwnerKey] = useState('');
  const [customOwnerKeyMsg, setCustomOwnerKeyMsg] = useState(null);

  // ── Room Delete state ─────────────────────────────────────────────────────
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingRoom, setDeletingRoom] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // ── File Upload ──────────────────────────────────────────────────────────
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // ── Phase 1 states ──────────────────────────────────────────────────────────
  const [showShareModal, setShowShareModal] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [nicknameInput, setNicknameInput] = useState('');
  const [mySocketId, setMySocketId] = useState(null);
  const [socketInstance, setSocketInstance] = useState(null);

  // Connection references & view locks
  const socketRef = useRef(null);
  const chatMessagesRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const accessKeyRef = useRef('');

  /**
   * Generates a deterministic background color based on a username hash.
   */
  const getAvatarColor = (name) => {
    if (!name) name = 'Anonymous';
    const colors = [
      '#A93F55', '#2E4052', '#3B7A57', '#8F6BBF',
      '#D97A53', '#4A7C59', '#61A5C2', '#D9A05B'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  /**
   * Formats database Date strings into local AM/PM time tags.
   */
  const formatTime = (timestamp) => {
    const date = timestamp ? new Date(timestamp) : new Date();
    let hours = date.getHours();
    let minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    minutes = minutes < 10 ? '0' + minutes : minutes;
    return `${hours}:${minutes} ${ampm}`;
  };

  // Onboarding walkthrough tour logic
  useEffect(() => {
    const handleStartTour = () => setTourStep(0);
    window.addEventListener('start-trinetra-tour', handleStartTour);
    window.addEventListener('start-anonhub-tour', handleStartTour);
    const hasSeenTour = localStorage.getItem('trinetra_chat_tour_seen') || localStorage.getItem('anonhub_chat_tour_seen');
    if (!hasSeenTour) {
      const t = setTimeout(() => setTourStep(0), 1500);
      return () => {
        clearTimeout(t);
        window.removeEventListener('start-trinetra-tour', handleStartTour);
        window.removeEventListener('start-anonhub-tour', handleStartTour);
      };
    }
    return () => {
      window.removeEventListener('start-trinetra-tour', handleStartTour);
      window.removeEventListener('start-anonhub-tour', handleStartTour);
    };
  }, []);

  // Lock body scroll for chat room page
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Connection lifecycle
  useEffect(() => {
    const socket = initSocket();
    socketRef.current = socket;
    setSocketInstance(socket);
    socket.connect();

    const savedKey = sessionStorage.getItem(`accesskey_chat_${roomName}`) || '';
    accessKeyRef.current = savedKey;
    const ownerToken = localStorage.getItem(`owner_token_chat_${roomName}`)
      || localStorage.getItem(`owner_token_chat_${roomName.toLowerCase()}`)
      || localStorage.getItem(`owner_token_${roomName}`)
      || localStorage.getItem(`owner_token_${roomName.toLowerCase()}`)
      || '';
    socket.emit('join room', { room: roomName, accessKey: savedKey, ownerToken });

    socket.on('connect', () => {
      setMySocketId(socket.id);
      const currentKey = sessionStorage.getItem(`accesskey_chat_${roomName}`) || '';
      const token = localStorage.getItem(`owner_token_chat_${roomName}`)
        || localStorage.getItem(`owner_token_chat_${roomName.toLowerCase()}`)
        || localStorage.getItem(`owner_token_${roomName}`)
        || localStorage.getItem(`owner_token_${roomName.toLowerCase()}`)
        || '';
      socket.emit('join room', { room: roomName, accessKey: currentKey, ownerToken: token });
    });

    socket.on('set username', (name) => {
      setUsername(name);
      setNicknameInput(name);
      // Use a session cookie (no max-age) so the name persists across page
      // navigations within the same browser session but resets when the browser closes.
      document.cookie = `trinetra-username=${encodeURIComponent(name)}; path=/; SameSite=Lax`;
      document.cookie = `anonhub-username=${encodeURIComponent(name)}; path=/; SameSite=Lax`;
      sessionStorage.setItem('trinetra-username', name);
      sessionStorage.setItem('anonhub-username', name);
      if (socketRef.current) {
        socketRef.current.auth = { ...socketRef.current.auth, username: name };
      }
    });

    // Custom nickname confirmed by server
    socket.on('username updated', (name) => {
      setUsername(name);
      setNicknameInput(name);
      document.cookie = `trinetra-username=${encodeURIComponent(name)}; path=/; SameSite=Lax`;
      document.cookie = `anonhub-username=${encodeURIComponent(name)}; path=/; SameSite=Lax`;
      sessionStorage.setItem('trinetra-username', name);
      sessionStorage.setItem('anonhub-username', name);
      if (socketRef.current) {
        socketRef.current.auth = { ...socketRef.current.auth, username: name };
      }
    });

    socket.on('access denied', (data) => {
      setShowOverlay(true);
      setOverlayError(data.message);
    });

    socket.on('join success', () => {
      setShowOverlay(false);
      setOverlayError('');
    });

    socket.on('room deleted', ({ room, message }) => {
      alert(message || 'This chat room has been permanently deleted by the owner.');
      navigate('/');
    });

    socket.on('set owner token', (token) => {
      localStorage.setItem(`owner_token_chat_${roomName}`, token);
      localStorage.setItem(`owner_token_chat_${roomName.toLowerCase()}`, token);
      localStorage.setItem(`owner_token_${roomName}`, token);
      localStorage.setItem(`owner_token_${roomName.toLowerCase()}`, token);
    });

    socket.on('is owner', (status) => setIsOwner(status));

    socket.on('load messages', (messagesArray) => {
      if (Array.isArray(messagesArray)) {
        setMessages(messagesArray);
        // If server returned < 50, there's nothing older to load
        setHasOlderMessages(messagesArray.length >= 50);
      }
    });

    socket.on('chat message', (data) => {
      setTypingUser('');
      setMessages(prev => [...prev, data]);
    });

    socket.on('message deleted', ({ messageId }) => {
      setMessages(prev => prev.filter(msg => msg._id !== messageId));
    });

    socket.on('messages deleted', ({ messageIds }) => {
      setMessages(prev => prev.filter(msg => !messageIds.includes(msg._id)));
      setSelectedMessageIds([]);
    });

    socket.on('message edited', ({ messageId, newMsg }) => {
      setMessages(prev => prev.map(msg =>
        msg._id === messageId ? { ...msg, msg: newMsg } : msg
      ));
    });

    // Room permissions update
    socket.on('room permissions', (perms) => {
      setRoomPermissions({
        allowUserEdit:   !!perms.allowUserEdit,
        allowUserDelete: !!perms.allowUserDelete,
        allowUserUpload: perms.allowUserUpload !== false
      });
    });

    // Claim ownership result
    socket.on('claim ownership result', ({ success, message }) => {
      setClaimingOwnership(false);
      if (success) {
        setOwnerKeySuccess(message);
        setOwnerKeyError('');
        setOwnerKeyInput('');
        setTimeout(() => setOwnerKeySuccess(''), 4000);
      } else {
        setOwnerKeyError(message);
        setOwnerKeySuccess('');
      }
    });

    socket.on('set owner key result', ({ success, message }) => {
      if (success) {
        setCustomOwnerKeyMsg({ type: 'success', text: message });
        setNewCustomOwnerKey('');
        setTimeout(() => setCustomOwnerKeyMsg(null), 4000);
      } else {
        setCustomOwnerKeyMsg({ type: 'error', text: message });
      }
    });

    // Emoji reaction update
    socket.on('reaction update', ({ messageId, reactions }) => {
      setMessages(prev => prev.map(msg =>
        msg._id === messageId ? { ...msg, reactions } : msg
      ));
    });

    socket.on('typing', (msg) => {
      setTypingUser(msg);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => setTypingUser(''), 4000);
    });

    socket.on('room users', (usersArray) => {
      if (Array.isArray(usersArray)) setUsers(usersArray);
    });

    socket.on('connect_error', () => {
      setMessages(prev => [
        ...prev,
        { username: 'System', msg: '⚠️ Connection lost. Attempting to reconnect...', timestamp: Date.now() }
      ]);
    });

    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (!globalCallSession.isSessionActive(roomName)) {
        socket.disconnect();
      }
    };
  }, [roomName]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTo({
        top: chatMessagesRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages, typingUser]);

  // ── Load older messages (pagination) ───────────────────────────────────────
  const handleLoadOlder = useCallback(async () => {
    if (loadingOlder || !hasOlderMessages) return;
    const oldest = messages.find(m => m.timestamp);
    const before = oldest ? new Date(oldest.timestamp).toISOString() : new Date().toISOString();
    setLoadingOlder(true);
    try {
      const res = await fetch(getApiUrl(`/api/messages/${encodeURIComponent(roomName)}?before=${encodeURIComponent(before)}&limit=50`));
      if (!res.ok) throw new Error('Failed');
      const older = await res.json();
      if (older.length === 0) {
        setHasOlderMessages(false);
      } else {
        setMessages(prev => [...older, ...prev]);
        if (older.length < 50) setHasOlderMessages(false);
        // Maintain scroll position so user doesn't get jumped to top
        const container = chatMessagesRef.current;
        if (container) {
          const prevScrollHeight = container.scrollHeight;
          requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight - prevScrollHeight;
          });
        }
      }
    } catch {
      // Silently fail — user can try again
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, hasOlderMessages, messages, roomName]);

  // ── Save nickname ───────────────────────────────────────────────────────────
  const handleSaveNickname = useCallback(() => {
    const trimmed = nicknameInput.trim().slice(0, 50);
    if (!trimmed || trimmed === username) {
      setIsEditingNickname(false);
      return;
    }
    socketRef.current?.emit('update username', { username: trimmed });
    setIsEditingNickname(false);
  }, [nicknameInput, username]);

  // ── Message actions ─────────────────────────────────────────────────────────
  const handleSendMessage = (e) => {
    e.preventDefault();
    const msg = messageInput.trim();
    if (msg && socketRef.current) {
      socketRef.current.emit('room message', { room: roomName, msg });
      setMessageInput('');
    }
  };

  const handleInputChange = (e) => {
    setMessageInput(e.target.value);
    if (socketRef.current) {
      socketRef.current.emit('typing', { room: roomName });
    }
  };

  const handleDeleteMessageClick = (messageId) => {
    if (window.confirm('Are you sure you want to delete this message?')) {
      socketRef.current?.emit('delete message', { room: roomName, messageId });
    }
  };

  const handleSaveEdit = (messageId) => {
    if (editingText.trim() && socketRef.current) {
      socketRef.current.emit('edit message', { room: roomName, messageId, newMsg: editingText.trim() });
      setEditingMessageId(null);
      setEditingText('');
    }
  };

  const handleToggleSelectMessage = (messageId) => {
    setSelectedMessageIds(prev =>
      prev.includes(messageId) ? prev.filter(id => id !== messageId) : [...prev, messageId]
    );
  };

  const handleDeleteSelected = () => {
    if (selectedMessageIds.length === 0) return;
    if (window.confirm(`Delete ${selectedMessageIds.length} message(s)?`)) {
      socketRef.current?.emit('delete messages', { room: roomName, messageIds: selectedMessageIds });
      setIsMultiSelectMode(false);
      setSelectedMessageIds([]);
    }
  };

  // ── Permissions panel helpers ───────────────────────────────────────────
  const handlePermissionToggle = (key) => {
    const updated = { ...roomPermissions, [key]: !roomPermissions[key] };
    setRoomPermissions(updated);
    socketRef.current?.emit('update permissions', { room: roomName, ...updated });
  };

  // ── Owner Key Claim ─────────────────────────────────────────────────────
  const handleClaimOwnership = () => {
    const key = ownerKeyInput.trim();
    if (!key) { setOwnerKeyError('Please enter your access key.'); return; }
    setClaimingOwnership(true);
    setOwnerKeyError('');
    setOwnerKeySuccess('');
    socketRef.current?.emit('claim ownership', { room: roomName, accessKey: key });
  };

  const handleSaveCustomOwnerKey = () => {
    const key = newCustomOwnerKey.trim();
    if (!key) { setCustomOwnerKeyMsg({ type: 'error', text: 'Please enter a key.' }); return; }
    socketRef.current?.emit('set owner key', { room: roomName, newOwnerKey: key });
  };

  const handleDeleteChatRoom = async () => {
    if (deleteConfirmText.trim().toLowerCase() !== roomName.trim().toLowerCase()) {
      setDeleteError(`Please type "${roomName}" exactly to confirm.`);
      return;
    }
    const ownerToken = localStorage.getItem(`owner_token_chat_${roomName}`)
      || localStorage.getItem(`owner_token_chat_${roomName.toLowerCase()}`)
      || localStorage.getItem(`owner_token_${roomName}`)
      || localStorage.getItem(`owner_token_${roomName.toLowerCase()}`);
    if (!ownerToken) {
      setDeleteError('Owner token not found in this browser session.');
      return;
    }
    setDeletingRoom(true);
    setDeleteError('');
    try {
      await deleteRoom('chat', roomName, ownerToken);
      localStorage.removeItem(`owner_token_chat_${roomName}`);
      localStorage.removeItem(`owner_token_${roomName}`);
      setShowDeleteModal(false);
      navigate('/');
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete room.');
      setDeletingRoom(false);
    }
  };

  // ── File Upload ─────────────────────────────────────────────────────────
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so same file can be re-uploaded
    e.target.value = '';
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('room', roomName);
      const res = await fetch(getApiUrl('/upload'), { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }
      const data = await res.json();
      const location = data.location;
      const filename = data.filename || file.name;
      const contentType = data.contentType || file.type;

      // Preserve filename & type in query parameter for rich preview across all clients
      const fileUrl = `${getApiUrl(location)}?name=${encodeURIComponent(filename)}&type=${encodeURIComponent(contentType)}`;

      if (location && socketRef.current) {
        socketRef.current.emit('room message', { room: roomName, msg: fileUrl });
      }
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleOverlaySubmit = (room, key) => {
    sessionStorage.setItem(`accesskey_chat_${roomName}`, key);
    accessKeyRef.current = key;
    const token = localStorage.getItem(`owner_token_chat_${roomName}`)
      || localStorage.getItem(`owner_token_chat_${roomName.toLowerCase()}`)
      || '';
    if (socketRef.current) {
      socketRef.current.emit('join room', { room: roomName, accessKey: key, ownerToken: token });
    }
  };

  // ── Emoji reaction helpers ──────────────────────────────────────────────────
  const EMOJIS = ['👍', '❤️', '😂', '🔥', '😮', '😢'];

  const handleToggleReaction = (messageId, emoji, currentReactions) => {
    const myUsername = username;
    const existing = (currentReactions || []).find(r => r.emoji === emoji);
    const alreadyReacted = existing?.users?.includes(myUsername);
    if (alreadyReacted) {
      socketRef.current?.emit('remove reaction', { room: roomName, messageId, emoji });
    } else {
      socketRef.current?.emit('add reaction', { room: roomName, messageId, emoji });
    }
  };

  const handleLeaveRoom = () => {
    if (window.confirm(`Are you sure you want to leave chat room "${roomName}"?`)) {
      socketRef.current?.emit('leave room', { room: roomName });
      sessionStorage.removeItem(`accesskey_chat_${roomName}`);
      sessionStorage.removeItem(`accesskey_chat_${roomName.toLowerCase()}`);
      sessionStorage.removeItem('trinetra-active-chat-room');
      sessionStorage.removeItem('anonhub-active-chat-room');
      navigate('/chat');
    }
  };

  const handleCloseSession = () => {
    if (window.confirm(`Close active session for "${roomName}"?\n\nThis will clear your saved room access key and disconnect you from the active chat so you can re-enter with a different key or account.`)) {
      if (socketRef.current) {
        socketRef.current.emit('leave room', { room: roomName });
      }
      sessionStorage.removeItem(`accesskey_chat_${roomName}`);
      sessionStorage.removeItem(`accesskey_chat_${roomName.toLowerCase()}`);
      sessionStorage.removeItem('trinetra-active-chat-room');
      sessionStorage.removeItem('anonhub-active-chat-room');
      accessKeyRef.current = '';
      setMessages([]);
      setUsers([]);
      setOverlayError('');
      setShowOverlay(true);
    }
  };

  return (
    <div className="chat-page-container">
      {/* Access Authentication modal gating */}
      {showOverlay && (
        <AccessKeyModal
          title="Chat Room Verification"
          subtitle={`Please enter the access key to enter chat room: ${roomName}`}
          errorMessage={overlayError}
          onSubmit={handleOverlaySubmit}
        />
      )}

      {/* Share / Invite Modal */}
      {showShareModal && (
        <ShareModal
          roomName={roomName}
          onClose={() => setShowShareModal(false)}
        />
      )}

      {/* Image Lightbox */}
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}

      {/* Primary chat layout view */}
      <div className="chat-container">
        <div className="chat-main" onClick={() => { if (mobileSidebarOpen) setMobileSidebarOpen(false); }}>

          {/* Top header bar */}
          <div className="header-bar">
            <div className="header-room-name-area">
              {isEditingNickname ? (
                <div className="nickname-edit-row">
                  <input
                    className="nickname-input"
                    value={nicknameInput}
                    onChange={e => setNicknameInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSaveNickname();
                      else if (e.key === 'Escape') setIsEditingNickname(false);
                    }}
                    autoFocus
                    maxLength={50}
                    placeholder="Your nickname..."
                  />
                  <button className="nickname-save-btn" onClick={handleSaveNickname} title="Save nickname">
                    <Check size={13} />
                  </button>
                  <button className="nickname-cancel-btn" onClick={() => setIsEditingNickname(false)} title="Cancel">
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <div className="header-room-title-row">
                  <span className="header-room-name">Room: {roomName}</span>
                  <button
                    className="nickname-edit-trigger"
                    onClick={() => { setNicknameInput(username); setIsEditingNickname(true); }}
                    title="Change your nickname"
                  >
                    <Pencil size={10} />
                    <span className="nickname-display">{username}</span>
                  </button>
                </div>
              )}
            </div>

            <div className="header-bar-actions">
              {/* Share button */}
              <button
                id="chat-share-btn"
                className="chat-header-btn chat-header-btn-share"
                onClick={() => setShowShareModal(true)}
                title="Share invite link and QR code"
                aria-label="Share chat room"
              >
                <Share2 size={13} className="chat-btn-icon" />
                <span className="btn-label-text">Share</span>
              </button>

              {/* Guided Tour */}
              <button
                onClick={() => setTourStep(0)}
                className="chat-header-btn chat-header-btn-tour"
                title="Start interactive guided tour"
                aria-label="Start Tour"
              >
                <Sparkles size={13} className="chat-btn-icon" />
                <span className="btn-label-text">Tour</span>
              </button>

              {/* Multi-select Mode (Owner or user delete allowed) */}
              {(isOwner || roomPermissions.allowUserDelete) && (
                <button
                  onClick={() => { setIsMultiSelectMode(prev => !prev); setSelectedMessageIds([]); }}
                  className={`chat-header-btn chat-header-btn-select ${isMultiSelectMode ? 'active' : ''}`}
                  title={isMultiSelectMode ? 'Cancel multi-select' : 'Select messages to delete'}
                  aria-label="Toggle select mode"
                >
                  <CheckSquare size={13} className="chat-btn-icon" />
                  <span className="btn-label-text">{isMultiSelectMode ? 'Cancel' : 'Select'}</span>
                </button>
              )}

              {/* Session Close Button (Clear saved key & session to enter differently) */}
              <button
                onClick={handleCloseSession}
                className="chat-header-btn chat-header-btn-session"
                title="Close active session and clear saved access key to re-enter differently"
                aria-label="Close session"
              >
                <KeyRound size={13} className="chat-btn-icon" />
                <span className="btn-label-text">Close Session</span>
              </button>

              {/* Exit Room */}
              <button
                onClick={handleLeaveRoom}
                className="chat-header-btn chat-header-btn-exit"
                title="Exit chat room and return to lobby"
                aria-label="Exit room"
              >
                <LogOut size={13} className="chat-btn-icon" />
                <span className="btn-label-text">Exit</span>
              </button>

              {/* Users & Call Panel Toggle */}
              <button
                id="sidebar-toggle"
                className="chat-header-btn chat-header-btn-users"
                onClick={() => setMobileSidebarOpen(prev => !prev)}
                title="Toggle users and call panel"
                aria-label="Toggle users and call"
              >
                <Users size={13} className="chat-btn-icon" />
                <span className="chat-users-count-badge">{users.length}</span>
                <span className="chat-btn-divider">|</span>
                <PhoneCall size={12} className="chat-btn-icon" />
                <span className="btn-label-text">Users & Call</span>
              </button>
            </div>
          </div>

          {/* Load older messages button */}
          {hasOlderMessages && (
            <div className="load-older-bar">
              <button
                className="load-older-btn"
                onClick={handleLoadOlder}
                disabled={loadingOlder}
              >
                {loadingOlder ? '⏳ Loading...' : '⬆ Load older messages'}
              </button>
            </div>
          )}

          {/* List of scrollable chat bubbles */}
          <ul ref={chatMessagesRef} className="chat-messages">
            {messages.map((msg, i) => {
              const isSystem = msg.username === 'System';
              const isOutgoing = msg.username === username;

              if (isSystem) {
                return (
                  <li key={msg._id || i} className="system-bubble-wrapper">
                    <div className="system-bubble">{msg.msg}</div>
                  </li>
                );
              }

              const isEditing = editingMessageId === msg._id;
              const reactions = msg.reactions || [];

              return (
                <li key={msg._id || i} className={`message-bubble-wrapper ${isOutgoing ? 'outgoing' : 'incoming'} ${isMultiSelectMode ? 'select-mode' : ''}`}>
                  {isMultiSelectMode && (
                    <input
                      type="checkbox"
                      checked={selectedMessageIds.includes(msg._id)}
                      onChange={() => handleToggleSelectMessage(msg._id)}
                      style={{ marginRight: '12px', cursor: 'pointer', width: '18px', height: '18px', accentColor: 'var(--primary-color)', alignSelf: 'center' }}
                    />
                  )}
                  <div
                    className="message-bubble"
                    onClick={isMultiSelectMode ? () => handleToggleSelectMessage(msg._id) : undefined}
                    style={isMultiSelectMode ? { cursor: 'pointer' } : {}}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '15px' }}>
                        <span className="bubble-sender">{msg.username} {isOutgoing && '(You)'}</span>
                        {/* Show edit/delete to: owner (any msg) OR non-owner on OWN messages when permission granted */}
                        {!isEditing && !isMultiSelectMode && msg._id && (
                          (isOwner || (isOutgoing && (roomPermissions.allowUserEdit || roomPermissions.allowUserDelete)))
                        ) && (
                          <div className="message-owner-actions">
                            {(isOwner || (isOutgoing && roomPermissions.allowUserEdit)) && (
                              <button onClick={() => { setEditingMessageId(msg._id); setEditingText(msg.msg); }} title="Edit Message">
                                <Edit2 size={12} />
                              </button>
                            )}
                            {(isOwner || (isOutgoing && roomPermissions.allowUserDelete)) && (
                              <button onClick={() => handleDeleteMessageClick(msg._id)} title="Delete Message">
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        )}
                    </div>

                    {isEditing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px', width: '100%', minWidth: '180px' }}>
                        <input
                          type="text"
                          value={editingText}
                          onChange={e => setEditingText(e.target.value)}
                          style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1.5px solid var(--border-color)', background: 'var(--light-color)', color: 'var(--text-color)', outline: 'none', fontSize: '0.9rem' }}
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleSaveEdit(msg._id);
                            else if (e.key === 'Escape') setEditingMessageId(null);
                          }}
                        />
                        <div style={{ display: 'flex', gap: '6px', alignSelf: 'flex-end' }}>
                          <button onClick={() => handleSaveEdit(msg._id)} style={{ padding: '3px 8px', fontSize: '0.75rem', borderRadius: '4px', border: 'none', background: 'var(--primary-color)', color: 'white', cursor: 'pointer', fontWeight: 'bold' }}>Save</button>
                          <button onClick={() => setEditingMessageId(null)} style={{ padding: '3px 8px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: isOutgoing ? 'white' : 'var(--text-color)', cursor: 'pointer' }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <MessageContent text={msg.msg} onImageClick={setLightboxSrc} />
                    )}

                    <span className="bubble-time">{formatTime(msg.timestamp)}</span>

                    {/* Emoji reactions display */}
                    {isFeatureVisible('chat.reactions') && reactions.length > 0 && (
                      <div className="reaction-badges-row">
                        {reactions.map(r => (
                          <button
                            key={r.emoji}
                            className={`reaction-badge ${r.users?.includes(username) ? 'mine' : ''}`}
                            onClick={() => handleToggleReaction(msg._id, r.emoji, reactions)}
                            title={r.users?.join(', ')}
                          >
                            {r.emoji} <span>{r.users?.length}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Emoji reaction picker row (hover) */}
                    {isFeatureVisible('chat.reactions') && can('chat.reactions', 'CREATE') && !isEditing && !isMultiSelectMode && msg._id && (
                      <div className="reaction-picker-row">
                        {EMOJIS.map(emoji => (
                          <button
                            key={emoji}
                            className="reaction-picker-btn"
                            onClick={() => handleToggleReaction(msg._id, emoji, reactions)}
                            title={`React with ${emoji}`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Real-time typing alerts */}
          {isFeatureVisible('chat.typing_indicator') && (
            <div className="typing-indicator">
              {typingUser && <span>💬 {typingUser}</span>}
            </div>
          )}

          {/* Message Dispatch form / Bulk actions bar */}
          {isMultiSelectMode ? (
            <div className="message-form select-actions-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.95rem', fontWeight: '600', color: 'var(--text-muted)' }}>
                {selectedMessageIds.length} message(s) selected
              </span>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="button" onClick={() => { setIsMultiSelectMode(false); setSelectedMessageIds([]); }} className="tab-btn" style={{ padding: '6px 16px', borderRadius: '20px', border: '1px solid var(--border-color)' }}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  disabled={selectedMessageIds.length === 0}
                  className="btn-primary"
                  style={{ padding: '6px 20px', borderRadius: '20px', width: 'auto', backgroundColor: selectedMessageIds.length === 0 ? 'var(--border-color)' : 'var(--primary-color)', color: 'white', boxShadow: 'none', cursor: selectedMessageIds.length === 0 ? 'not-allowed' : 'pointer' }}
                >
                  Delete Selected
                </button>
              </div>
            </div>
          ) : isFeatureVisible('chat.messaging') && can('chat.messaging', 'CREATE') ? (
            <form className="message-form" onSubmit={handleSendMessage}>
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.json,.zip"
              />
              {/* File upload button — shown when owner allows uploads OR user is owner */}
              {isFeatureVisible('chat.file_upload') && can('chat.file_upload', 'CREATE') && (isOwner || roomPermissions.allowUserUpload) && (
                <button
                  type="button"
                  className="upload-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title={uploading ? 'Uploading...' : 'Attach a file'}
                  aria-label="Attach file"
                >
                  {uploading ? <Upload size={16} className="spin-icon" /> : <Paperclip size={16} />}
                </button>
              )}
              <input
                className="chat-input"
                value={messageInput}
                onChange={handleInputChange}
                placeholder="Type your message..."
                aria-label="Type your message"
                autoComplete="off"
              />
              <button type="submit" aria-label="Send message" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>Send</span>
                <Send size={14} />
              </button>
            </form>
          ) : (
            <div style={{ padding: '14px 20px', textAlign: 'center', background: 'var(--card-bg)', borderTop: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 600 }}>
              🔒 Text messaging is disabled by administrator.
            </div>
          )}
        </div>

        {/* Sidebar list of users + call widget */}
        <aside className={`chat-sidebar ${mobileSidebarOpen ? 'active' : ''}`}>
          <div className="sidebar-header">
            <h4>Users in Room ({users.length})</h4>
            <button className="sidebar-close-btn" onClick={() => setMobileSidebarOpen(false)} title="Close Users Panel">
              <X size={18} />
            </button>
          </div>

          {/* Voice & Video Call widget */}
          {socketInstance && (
            <div style={{ padding: '10px 12px 4px' }}>
              <WebRTCCallWidget
                projectName={roomName}
                socket={socketInstance}
                username={username}
              />
            </div>
          )}

          {/* ── Room Permissions Panel (Owner only) ──────────────────────── */}
          {isOwner && (
            <div className="sidebar-section">
              <button
                className="sidebar-section-toggle"
                onClick={() => setShowPermissionsPanel(p => !p)}
              >
                <Shield size={13} />
                <span>Room Permissions</span>
                <span className="toggle-chevron">{showPermissionsPanel ? '▲' : '▼'}</span>
              </button>
              {showPermissionsPanel && (
                <div className="permissions-panel">
                  <p className="permissions-hint">Control what all users can do in this room.</p>
                  <label className="perm-toggle-row">
                    <span className="perm-label">
                      <Edit2 size={12} />
                      Allow users to edit messages
                    </span>
                    <input
                      type="checkbox"
                      className="perm-checkbox"
                      checked={roomPermissions.allowUserEdit}
                      onChange={() => handlePermissionToggle('allowUserEdit')}
                      id="perm-edit"
                    />
                    <label htmlFor="perm-edit" className="toggle-switch" />
                  </label>
                  <label className="perm-toggle-row">
                    <span className="perm-label">
                      <Trash2 size={12} />
                      Allow users to delete messages
                    </span>
                    <input
                      type="checkbox"
                      className="perm-checkbox"
                      checked={roomPermissions.allowUserDelete}
                      onChange={() => handlePermissionToggle('allowUserDelete')}
                      id="perm-delete"
                    />
                    <label htmlFor="perm-delete" className="toggle-switch" />
                  </label>
                  <label className="perm-toggle-row">
                    <span className="perm-label">
                      <Paperclip size={12} />
                      Allow users to upload files
                    </span>
                    <input
                      type="checkbox"
                      className="perm-checkbox"
                      checked={roomPermissions.allowUserUpload}
                      onChange={() => handlePermissionToggle('allowUserUpload')}
                      id="perm-upload"
                    />
                    <label htmlFor="perm-upload" className="toggle-switch" />
                  </label>

                  {/* Set Custom Owner Key Section */}
                  <div style={{ marginTop: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                    <p className="permissions-hint" style={{ fontWeight: 600, color: 'var(--text-color)', marginBottom: '4px' }}>
                      🔑 Set Secret Owner Key
                    </p>
                    <p className="permissions-hint" style={{ marginBottom: '8px' }}>
                      Set a secret key to manage owner privileges.
                    </p>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <input
                        type="password"
                        className="owner-key-input"
                        placeholder="New secret Owner Key..."
                        value={newCustomOwnerKey}
                        onChange={e => setNewCustomOwnerKey(e.target.value)}
                        maxLength={128}
                      />
                      <button
                        className="owner-key-btn"
                        onClick={handleSaveCustomOwnerKey}
                        style={{ width: 'auto', padding: '0 12px', whiteSpace: 'nowrap' }}
                      >
                        Save
                      </button>
                    </div>
                    {customOwnerKeyMsg && <p className={`owner-key-msg ${customOwnerKeyMsg.type}`} style={{ marginTop: '6px' }}>{customOwnerKeyMsg.text}</p>}
                  </div>

                  {/* Danger Zone */}
                  <div style={{ marginTop: '14px', borderTop: '1px solid rgba(239, 68, 68, 0.3)', paddingTop: '10px' }}>
                    <p className="permissions-hint" style={{ fontWeight: 700, color: '#ef4444', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <AlertTriangle size={12} /> Danger Zone
                    </p>
                    <p className="permissions-hint" style={{ marginBottom: '8px' }}>
                      Permanently delete this chat room and all messages.
                    </p>
                    <button
                      className="btn-danger"
                      onClick={() => { setShowDeleteModal(true); setDeleteConfirmText(''); setDeleteError(''); }}
                      style={{ width: '100%', padding: '6px 12px', borderRadius: '6px', background: '#ef4444', color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                    >
                      <Trash2 size={12} /> Delete Room
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Owner Access Key Entry (visible to non-owners) ────────────── */}
          {!isOwner && (
            <div className="sidebar-section">
              <button
                className="sidebar-section-toggle"
                onClick={() => { setShowOwnerKeyEntry(p => !p); setOwnerKeyError(''); setOwnerKeySuccess(''); }}
              >
                <Key size={13} />
                <span>Enter Owner Key</span>
                <span className="toggle-chevron">{showOwnerKeyEntry ? '▲' : '▼'}</span>
              </button>
              {showOwnerKeyEntry && (
                <div className="owner-key-panel">
                  <p className="permissions-hint">Room owners can enter their access key here to reclaim privileges.</p>
                  <input
                    type="password"
                    className="owner-key-input"
                    placeholder="Enter access key..."
                    value={ownerKeyInput}
                    onChange={e => { setOwnerKeyInput(e.target.value); setOwnerKeyError(''); setOwnerKeySuccess(''); }}
                    onKeyDown={e => { if (e.key === 'Enter') handleClaimOwnership(); }}
                    maxLength={128}
                  />
                  {ownerKeyError && <p className="owner-key-msg error">{ownerKeyError}</p>}
                  {ownerKeySuccess && <p className="owner-key-msg success">{ownerKeySuccess}</p>}
                  <button
                    className="owner-key-btn"
                    onClick={handleClaimOwnership}
                    disabled={claimingOwnership}
                  >
                    {claimingOwnership ? 'Verifying...' : 'Claim Ownership'}
                  </button>
                </div>
              )}
            </div>
          )}

          <ul className="user-list">
            {users.map((user, i) => {
              const isMe = user.username === username;
              return (
                <li key={i} className="user-contact-card">
                  <div className="contact-avatar" style={{ backgroundColor: getAvatarColor(user.username) }}>
                    {user.username ? user.username.charAt(0).toUpperCase() : '?'}
                  </div>
                  <div className="contact-info">
                    <div className="contact-name-row">
                      <span className="contact-name">{user.username}{isMe && ' (You)'}</span>
                      <span className="online-indicator"></span>
                    </div>
                    <div className="contact-status-row">
                      <span className="contact-status">online</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>

      {/* Interactive Tour Tooltip Card */}
      {tourStep >= 0 && (
        <div className={`tour-tooltip-card chat-step-${tourStep}`}>
          <div className="tour-tooltip-arrow" />
          <div className="tour-tooltip-header">
            <h4>Tour Guide</h4>
            <span className="tour-tooltip-badge">Step {tourStep + 1} of 5</span>
          </div>
          <div className="tour-tooltip-body">
            {tourStep === 0 && <p>Welcome to the <strong>Secure Chat Room</strong>! Enjoy real-time, private group messaging with no registration and full anonymity.</p>}
            {tourStep === 1 && <p>Click the <strong>✏️ Nickname</strong> button in the header to set your custom display name, and view active collaborators in the user roster.</p>}
            {tourStep === 2 && <p>The <strong>Message Feed</strong> supports rich media: inline image rendering, file uploads, and recorded <strong>Voice Notes</strong>.</p>}
            {tourStep === 3 && <p>Hover over any message to add <strong>Emoji Reactions</strong>, reply directly in thread, or pin important notices to the top bar.</p>}
            {tourStep === 4 && <p>Use <strong>🔗 Share Room</strong> to copy invite links or QR codes, or click the <strong>📹 Video Call</strong> button to jump into a live meeting with your team!</p>}
          </div>
          <div className="tour-tooltip-footer">
            <button className="tour-skip-btn" onClick={() => { setTourStep(-1); localStorage.setItem('trinetra_chat_tour_seen', 'true'); }}>Skip</button>
            <button className="tour-next-btn" onClick={() => {
              if (tourStep < 4) setTourStep(prev => prev + 1);
              else { setTourStep(-1); localStorage.setItem('trinetra_chat_tour_seen', 'true'); }
            }}>
              {tourStep === 4 ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      )}

      {/* ── Room Deletion Confirmation Modal ────────────────────────────── */}
      {showDeleteModal && (
        <div className="chat-lightbox" onClick={() => !deletingRoom && setShowDeleteModal(false)}>
          <div className="share-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px', border: '1.5px solid #ef4444' }}>
            <div className="share-modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444' }}>
                <AlertTriangle size={18} /> Delete Room Permanently?
              </h3>
              <button onClick={() => !deletingRoom && setShowDeleteModal(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <p className="share-modal-subtitle" style={{ color: 'var(--text-color)', lineHeight: 1.6 }}>
              All messages and files associated with <strong>{roomName}</strong> will be permanently removed. This action <strong>cannot be undone</strong>.
            </p>
            <div style={{ margin: '14px 0' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-muted)' }}>
                Please type <strong>{roomName}</strong> to confirm:
              </label>
              <input
                type="text"
                className="owner-key-input"
                placeholder={roomName}
                value={deleteConfirmText}
                onChange={e => { setDeleteConfirmText(e.target.value); setDeleteError(''); }}
                disabled={deletingRoom}
                autoFocus
                style={{ width: '100%', borderColor: '#ef4444' }}
              />
              {deleteError && <p className="owner-key-msg error" style={{ marginTop: '6px' }}>{deleteError}</p>}
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button
                type="button"
                className="tab-btn"
                onClick={() => setShowDeleteModal(false)}
                disabled={deletingRoom}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteChatRoom}
                disabled={deletingRoom || deleteConfirmText.trim().toLowerCase() !== roomName.trim().toLowerCase()}
                style={{ padding: '8px 18px', borderRadius: '8px', background: '#ef4444', color: '#fff', border: 'none', fontWeight: 600, cursor: (deletingRoom || deleteConfirmText.trim().toLowerCase() !== roomName.trim().toLowerCase()) ? 'not-allowed' : 'pointer', opacity: (deleteConfirmText.trim().toLowerCase() !== roomName.trim().toLowerCase()) ? 0.6 : 1 }}
              >
                {deletingRoom ? 'Deleting...' : 'Permanently Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

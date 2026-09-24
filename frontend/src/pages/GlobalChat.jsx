/**
 * @file GlobalChat.jsx
 * @description Global Public Anonymous Chat for AnonHub.
 * Connects all visitors into a single shared real-time conversation with
 * automatic guest identities, live presence, rolling 100-message memory,
 * and author-only edit & delete capabilities.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Globe, Send, Users, ShieldAlert, ArrowDown, Edit3, 
  MessageSquare, Sparkles, AlertCircle, WifiOff, Check, X,
  Edit2, Trash2
} from 'lucide-react';
import { initSocket } from '../services/socket';
import './GlobalChat.css';

const MAX_MESSAGE_LEN = 2000;

export default function GlobalChat() {
  // Generate or retrieve a stable persistent guest ID for this browser
  const getPersistentGuestId = () => {
    const key = 'trinetra-guest-id';
    let id = localStorage.getItem(key);
    if (!id) {
      // Generate a random UUID-like ID (crypto.randomUUID or fallback)
      id = typeof crypto !== 'undefined' && crypto.randomUUID
        ? `gc_${crypto.randomUUID()}`
        : `gc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(key, id);
    }
    return id;
  };
  const persistentGuestId = getPersistentGuestId();
  const [messages, setMessages] = useState([]);
  const [inputMsg, setInputMsg] = useState('');
  const [onlineCount, setOnlineCount] = useState(1);
  const [currentUser, setCurrentUser] = useState({
    guestId: '',
    username: 'Guest',
    color: '#2563EB'
  });
  const [connected, setConnected] = useState(false);
  const [rateLimitWarning, setRateLimitWarning] = useState(null);
  const [systemAlert, setSystemAlert] = useState(null);
  
  // Nickname Edit Modal State
  const [showNickModal, setShowNickModal] = useState(false);
  const [newNickInput, setNewNickInput] = useState('');

  // Inline Message Editing State
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingText, setEditingText] = useState('');

  // Auto-scroll & unread counter
  const [unreadCount, setUnreadCount] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const socketRef = useRef(null);
  const currentUserRef = useRef(currentUser);
  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);

  // Keep currentUserRef in sync without triggering re-subscriptions
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  // Format timestamp (e.g. "10:45 PM")
  const formatTime = (ts) => {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  // Safe URL Parser for chat messages (XSS-safe text nodes)
  const renderMessageText = (text) => {
    if (!text) return null;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    return parts.map((part, i) => {
      if (urlRegex.test(part)) {
        return (
          <a
            key={i}
            href={part}
            className="gc-chat-link"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        );
      }
      return part;
    });
  };

  // Scroll to bottom helper
  const scrollToBottom = useCallback((smooth = true) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
    }
    setUnreadCount(0);
    setIsAtBottom(true);
  }, []);

  // Handle scroll events in messages container
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 80;
    setIsAtBottom(atBottom);
    if (atBottom) {
      setUnreadCount(0);
    }
  };

  // Socket Connection Lifecycle — Mounts once
  useEffect(() => {
    const socket = initSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join-global-chat', {
        username: currentUserRef.current.username,
        persistentGuestId
      });
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('global-chat-init', (data) => {
      if (data.user) {
        setCurrentUser(data.user);
        currentUserRef.current = data.user;
        setNewNickInput(data.user.username);
      }
      if (Array.isArray(data.messages)) {
        setMessages(data.messages);
      }
      setTimeout(() => {
        if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: 'auto' });
        }
      }, 60);
    });

    socket.on('global-chat-message', (newMsg) => {
      setMessages((prev) => {
        // Enforce rolling 100 messages client-side cache
        const next = [...prev, newMsg];
        return next.length > 100 ? next.slice(-100) : next;
      });

      const el = scrollContainerRef.current;
      if (el) {
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        const isSelf = newMsg.guestId === currentUserRef.current.guestId || 
                       newMsg.username === currentUserRef.current.username;

        if (distanceFromBottom < 100 || isSelf) {
          setTimeout(() => {
            if (messagesEndRef.current) {
              messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
            }
          }, 30);
        } else {
          setUnreadCount((c) => c + 1);
        }
      }
    });

    // Live Message Edit Broadcast
    socket.on('global-chat-message-edited', (data) => {
      setMessages((prev) =>
        prev.map((m) => (m._id === data._id ? { ...m, msg: data.msg, edited: true } : m))
      );
    });

    // Live Message Delete Broadcast
    socket.on('global-chat-message-deleted', ({ messageId }) => {
      setMessages((prev) => prev.filter((m) => m._id !== messageId));
    });

    socket.on('global-chat-count', ({ count }) => {
      setOnlineCount(count || 1);
    });

    socket.on('global-chat-system', ({ msg }) => {
      setMessages((prev) => [
        ...prev,
        { _id: `sys_${Date.now()}_${Math.random()}`, isSystem: true, msg, timestamp: new Date() }
      ]);
    });

    socket.on('global-username-updated', ({ username }) => {
      setCurrentUser((prev) => ({ ...prev, username }));
      currentUserRef.current.username = username;
    });

    socket.on('global-chat-rate-limited', ({ message }) => {
      setRateLimitWarning(message || 'You are sending messages too quickly. Please wait.');
      setTimeout(() => setRateLimitWarning(null), 4000);
    });

    socket.on('global-chat-disabled', ({ message }) => {
      setSystemAlert(message || 'Global Chat is currently disabled.');
    });

    // Connect socket
    socket.connect();
    if (socket.connected) {
      setConnected(true);
      socket.emit('join-global-chat', {});
    }

    return () => {
      socket.emit('leave-global-chat');
      socket.off('connect');
      socket.off('disconnect');
      socket.off('global-chat-init');
      socket.off('global-chat-message');
      socket.off('global-chat-message-edited');
      socket.off('global-chat-message-deleted');
      socket.off('global-chat-count');
      socket.off('global-chat-system');
      socket.off('global-username-updated');
      socket.off('global-chat-rate-limited');
      socket.off('global-chat-disabled');
      socket.disconnect();
    };
  }, []);

  // Send message
  const handleSendMessage = (e) => {
    if (e) e.preventDefault();
    const clean = inputMsg.trim();
    if (!clean || !socketRef.current) return;

    socketRef.current.emit('send-global-message', { message: clean });
    setInputMsg('');
  };

  // Handle enter key in input
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Start editing a message
  const handleStartEdit = (msg) => {
    setEditingMessageId(msg._id);
    setEditingText(msg.msg);
  };

  // Save edited message
  const handleSaveEdit = (msgId) => {
    const clean = editingText.trim();
    if (!clean) return;
    if (socketRef.current) {
      socketRef.current.emit('edit-global-message', { messageId: msgId, newMsg: clean });
    }
    setEditingMessageId(null);
    setEditingText('');
  };

  // Cancel edit
  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingText('');
  };

  // Delete message
  const handleDeleteMessage = (msgId) => {
    if (!msgId || !socketRef.current) return;
    socketRef.current.emit('delete-global-message', { messageId: msgId });
  };

  // Change nickname
  const handleSaveNickname = (e) => {
    if (e) e.preventDefault();
    const cleanNick = newNickInput.trim().slice(0, 30);
    if (!cleanNick || !socketRef.current) return;

    socketRef.current.emit('update-global-username', { username: cleanNick });
    setShowNickModal(false);
  };

  return (
    <div className="global-chat-page">
      <div className="global-chat-card">
        
        {/* Header */}
        <header className="gc-header">
          <div className="gc-header-left">
            <div className="gc-icon-badge">
              <Globe size={22} />
            </div>
            <div className="gc-title-wrap">
              <h1 className="gc-title">Global Anonymous Chat</h1>
              <span className="gc-online-badge">
                {connected ? (
                  <>
                    <span className="gc-pulse-dot" />
                    {onlineCount} {onlineCount === 1 ? 'person' : 'people'} online
                  </>
                ) : (
                  <>
                    <WifiOff size={13} style={{ color: '#f59e0b' }} />
                    <span style={{ color: '#f59e0b' }}>Connecting...</span>
                  </>
                )}
              </span>
            </div>
          </div>

          <div className="gc-header-right">
            <div className="gc-user-pill" title="Your anonymous nickname">
              <span className="gc-avatar-circle" style={{ backgroundColor: currentUser.color || '#3b82f6' }} />
              <span>{currentUser.username}</span>
              <button 
                className="gc-edit-nick-btn" 
                onClick={() => setShowNickModal(true)} 
                title="Change Nickname"
              >
                <Edit3 size={13} />
              </button>
            </div>
          </div>
        </header>

        {/* Notice & Rolling Storage Banner */}
        <div className="gc-notice-strip">
          <span>
            <Sparkles size={14} style={{ color: '#8b5cf6' }} />
            Public & anonymous conversation. Do not share sensitive passwords.
          </span>
          <span className="gc-memory-tag">
            ⚡ Rolling 100 Messages Memory
          </span>
        </div>

        {/* System Alert Banner if disabled */}
        {systemAlert && (
          <div className="gc-warning-banner" style={{ background: '#fef2f2', color: '#b91c1c' }}>
            <AlertCircle size={16} />
            <span>{systemAlert}</span>
          </div>
        )}

        {/* Rate Limit Warning */}
        {rateLimitWarning && (
          <div className="gc-warning-banner">
            <ShieldAlert size={16} />
            <span>{rateLimitWarning}</span>
          </div>
        )}

        {/* Message Feed (Scrollable) */}
        <div className="gc-messages-wrap" ref={scrollContainerRef} onScroll={handleScroll}>
          {messages.length === 0 ? (
            <div className="gc-empty-state">
              <div className="gc-empty-icon">
                <MessageSquare size={32} />
              </div>
              <div className="gc-empty-title">Welcome to Global Chat</div>
              <div className="gc-empty-desc">
                Say hello! Start an instant conversation with collaborators from anywhere in the world.
              </div>
            </div>
          ) : (
            <ul className="gc-messages-list">
              {messages.map((item, idx) => {
                if (item.isSystem) {
                  return (
                    <li key={item._id || idx} className="gc-system-msg">
                      {item.msg}
                    </li>
                  );
                }

                const isSelf = item.guestId === currentUser.guestId || 
                               item.username === currentUser.username;
                const isEditing = editingMessageId === item._id;

                return (
                  <li 
                    key={item._id || idx} 
                    className={`gc-message-row ${isSelf ? 'outgoing' : 'incoming'}`}
                  >
                    <div className="gc-meta-line">
                      <span className="gc-sender-name" style={{ color: isSelf ? '#2563eb' : (item.color || '#475569') }}>
                        {item.username} {isSelf && '(You)'}
                      </span>
                      <span className="gc-timestamp">
                        {formatTime(item.timestamp)}
                        {item.edited && <span className="gc-edited-tag"> (edited)</span>}
                      </span>

                      {/* Author Edit and Delete Action Buttons */}
                      {isSelf && !isEditing && item._id && (
                        <div className="gc-msg-actions">
                          <button
                            className="gc-msg-action-btn edit"
                            onClick={() => handleStartEdit(item)}
                            title="Edit message"
                          >
                            <Edit2 size={12} />
                          </button>
                          <button
                            className="gc-msg-action-btn delete"
                            onClick={() => handleDeleteMessage(item._id)}
                            title="Delete message"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="gc-edit-wrap">
                        <input
                          type="text"
                          className="gc-edit-input"
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(item._id);
                            else if (e.key === 'Escape') handleCancelEdit();
                          }}
                          autoFocus
                          maxLength={MAX_MESSAGE_LEN}
                        />
                        <div className="gc-edit-buttons">
                          <button 
                            className="gc-edit-btn save" 
                            onClick={() => handleSaveEdit(item._id)} 
                            title="Save changes (Enter)"
                          >
                            <Check size={12} />
                            <span>Save</span>
                          </button>
                          <button 
                            className="gc-edit-btn cancel" 
                            onClick={handleCancelEdit} 
                            title="Cancel (Esc)"
                          >
                            <X size={12} />
                            <span>Cancel</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="gc-bubble">
                        {renderMessageText(item.msg)}
                      </div>
                    )}
                  </li>
                );
              })}
              <div ref={messagesEndRef} style={{ height: 1 }} />
            </ul>
          )}

          {/* Floating Scroll to Bottom Badge */}
          {!isAtBottom && (
            <button className="gc-scroll-bottom-btn" onClick={() => scrollToBottom(true)}>
              <ArrowDown size={14} />
              <span>Latest</span>
              {unreadCount > 0 && <span className="gc-badge-count">{unreadCount}</span>}
            </button>
          )}
        </div>

        {/* Input Bar */}
        <footer className="gc-footer">
          <form className="gc-input-form" onSubmit={handleSendMessage}>
            <div className="gc-input-wrap">
              <input
                type="text"
                className="gc-input"
                placeholder="Type an anonymous message to everyone..."
                value={inputMsg}
                onChange={(e) => setInputMsg(e.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={MAX_MESSAGE_LEN}
                autoFocus
              />
              <span className="gc-char-counter">
                {inputMsg.length}/{MAX_MESSAGE_LEN}
              </span>
            </div>

            <button 
              type="submit" 
              className="gc-send-btn" 
              disabled={!inputMsg.trim() || !connected}
              title="Send to Global Chat"
            >
              <Send size={17} />
            </button>
          </form>
        </footer>
      </div>

      {/* Nickname Change Modal */}
      {showNickModal && (
        <div className="gc-modal-backdrop" onClick={() => setShowNickModal(false)}>
          <div className="gc-modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="gc-modal-title">Change Anonymous Nickname</h3>
            <form onSubmit={handleSaveNickname}>
              <input
                type="text"
                className="gc-modal-input"
                placeholder="Enter nickname (e.g. Cosmic Fox)"
                value={newNickInput}
                onChange={(e) => setNewNickInput(e.target.value)}
                maxLength={30}
                autoFocus
              />
              <div className="gc-modal-actions">
                <button 
                  type="button" 
                  className="gc-modal-btn-cancel"
                  onClick={() => setShowNickModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="gc-modal-btn-save">
                  Save Nickname
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

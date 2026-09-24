/**
 * @file OmniRoomSearchModal.jsx
 * @description Universal fast room search & join modal (Ctrl+K).
 * Automatically detects room type (Whiteboard, Chat, Project, OfficeBoard, Video Call)
 * and keeps a history of recently visited collaborative workspaces.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Search, X, MessageSquare, FolderKanban, Palette, Monitor, 
  Video, ArrowRight, Clock, Trash2, Zap, Sparkles 
} from 'lucide-react';
import './OmniRoomSearchModal.css';

const ROOM_TYPES = [
  { id: 'auto', label: 'Auto Detect', icon: <Zap size={14} /> },
  { id: 'whiteboard', label: 'Whiteboard', icon: <Palette size={14} /> },
  { id: 'chat', label: 'Chat', icon: <MessageSquare size={14} /> },
  { id: 'project', label: 'Project', icon: <FolderKanban size={14} /> },
  { id: 'office', label: 'Office Board', icon: <Monitor size={14} /> },
  { id: 'call', label: 'Video Call', icon: <Video size={14} /> },
];

export default function OmniRoomSearchModal({ isOpen, onClose }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [selectedType, setSelectedType] = useState('auto');
  const [recentRooms, setRecentRooms] = useState([]);

  // Load recent rooms from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('anonhub-recent-rooms');
      if (saved) {
        setRecentRooms(JSON.parse(saved));
      }
    } catch (e) {}
  }, [isOpen]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
    }
  }, [isOpen]);

  // Listen for Ctrl+K / Cmd+K global hotkey
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) {
          onClose();
        } else {
          // Open triggered by parent state or custom event
          const event = new CustomEvent('openOmniSearch');
          window.dispatchEvent(event);
        }
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Save room to recent history
  const saveToRecent = (type, roomName, url) => {
    try {
      const existing = recentRooms.filter(r => r.url !== url);
      const updated = [{ type, roomName, url, timestamp: Date.now() }, ...existing].slice(0, 8);
      setRecentRooms(updated);
      localStorage.setItem('anonhub-recent-rooms', JSON.stringify(updated));
    } catch (e) {}
  };

  // Clear recent history
  const handleClearHistory = (e) => {
    e.stopPropagation();
    setRecentRooms([]);
    localStorage.removeItem('anonhub-recent-rooms');
  };

  // Detect target URL based on query and type
  const resolveTargetUrl = (input, typeChoice) => {
    let clean = input.trim();
    if (!clean) return null;

    // Handle full URL pasted
    if (clean.includes('/whiteboard/')) return clean.slice(clean.indexOf('/whiteboard/'));
    if (clean.includes('/chat/')) return clean.slice(clean.indexOf('/chat/'));
    if (clean.includes('/projects/')) return clean.slice(clean.indexOf('/projects/'));
    if (clean.includes('/office/')) return clean.slice(clean.indexOf('/office/'));
    if (clean.includes('/call/')) return clean.slice(clean.indexOf('/call/'));

    // Strip leading slashes
    clean = clean.replace(/^\/+/, '');

    // Auto-detect based on prefix or explicit type
    if (typeChoice === 'whiteboard' || clean.startsWith('wb-') || clean.startsWith('whiteboard/')) {
      const room = clean.replace(/^wb-|^whiteboard\//, '');
      return { type: 'Whiteboard', name: clean.startsWith('wb-') ? clean : room, path: `/whiteboard/${clean.startsWith('wb-') ? clean : room}` };
    }
    if (typeChoice === 'project' || clean.startsWith('prj-') || clean.startsWith('projects/')) {
      const room = clean.replace(/^prj-|^projects\//, '');
      return { type: 'Project Room', name: room, path: `/projects/${room}` };
    }
    if (typeChoice === 'office' || clean.startsWith('off-') || clean.startsWith('office/')) {
      const room = clean.replace(/^off-|^office\//, '');
      return { type: 'Office Board', name: room, path: `/office/${room}` };
    }
    if (typeChoice === 'call' || clean.startsWith('call-') || clean.startsWith('call/')) {
      const room = clean.replace(/^call-|^call\//, '');
      return { type: 'Video Call', name: room, path: `/call/${room}` };
    }
    if (typeChoice === 'chat' || clean.startsWith('chat/')) {
      const room = clean.replace(/^chat\//, '');
      return { type: 'Chat Room', name: room, path: `/chat/${room}` };
    }

    // Default auto fallback
    return { type: 'Chat Room', name: clean, path: `/chat/${clean}` };
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    const target = resolveTargetUrl(query, selectedType);
    if (target) {
      saveToRecent(target.type, target.name, target.path);
      onClose();
      navigate(target.path);
    }
  };

  if (!isOpen) return null;

  const detectedTarget = query.trim() ? resolveTargetUrl(query, selectedType) : null;

  return (
    <div className="omni-search-backdrop" onClick={onClose}>
      <div className="omni-search-modal" onClick={(e) => e.stopPropagation()}>
        {/* Search Header Form */}
        <form onSubmit={handleJoin} className="omni-search-form">
          <Search size={18} className="omni-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="omni-search-input"
            placeholder="Search or paste any Room ID (e.g. wb-7f91, my-chat, project-alpha)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className="omni-close-btn" onClick={onClose} title="Close (Esc)">
            <X size={16} />
          </button>
        </form>

        {/* Room Type Selector Filter */}
        <div className="omni-type-pills">
          {ROOM_TYPES.map(t => (
            <button
              key={t.id}
              type="button"
              className={`omni-type-pill ${selectedType === t.id ? 'active' : ''}`}
              onClick={() => setSelectedType(t.id)}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Instant Match Action Box */}
        {detectedTarget && (
          <div className="omni-match-preview" onClick={handleJoin}>
            <div className="omni-match-left">
              <Sparkles size={16} className="omni-sparkle-icon" />
              <div>
                <div className="omni-match-title">
                  Jump to <strong>{detectedTarget.type}</strong>: <code>{detectedTarget.name}</code>
                </div>
                <div className="omni-match-sub">Press Enter to join immediately</div>
              </div>
            </div>
            <button type="button" className="omni-join-btn">
              <span>Join</span> <ArrowRight size={14} />
            </button>
          </div>
        )}

        {/* Recent Workspaces History */}
        <div className="omni-history-section">
          <div className="omni-history-header">
            <span className="omni-history-title">
              <Clock size={13} /> Recently Visited Workspaces
            </span>
            {recentRooms.length > 0 && (
              <button className="omni-clear-btn" onClick={handleClearHistory} title="Clear history">
                <Trash2 size={12} /> Clear
              </button>
            )}
          </div>

          {recentRooms.length === 0 ? (
            <div className="omni-empty-history">
              No recent rooms yet. Enter any room ID above to jump into collaboration!
            </div>
          ) : (
            <div className="omni-history-list">
              {recentRooms.map((item, idx) => (
                <div 
                  key={idx} 
                  className="omni-history-item"
                  onClick={() => {
                    onClose();
                    navigate(item.url);
                  }}
                >
                  <div className="omni-hist-item-left">
                    <span className="omni-hist-badge">{item.type}</span>
                    <span className="omni-hist-name">{item.roomName}</span>
                  </div>
                  <span className="omni-hist-arrow">↳</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Hotkey Info */}
        <div className="omni-footer-hints">
          <span><kbd>Esc</kbd> to close</span>
          <span><kbd>↵</kbd> to select</span>
          <span><kbd>Ctrl</kbd> + <kbd>K</kbd> to toggle</span>
        </div>
      </div>
    </div>
  );
}

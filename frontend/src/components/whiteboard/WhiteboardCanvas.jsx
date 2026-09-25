/**
 * @file WhiteboardCanvas.jsx
 * @description Modern real-time collaborative Whiteboard component powered by tldraw.
 * Features full freehand drawing, geometric shapes, sticky notes, arrows, text,
 * infinite canvas, pan/zoom, undo/redo, real-time multiplayer differential syncing,
 * live peer cursors, anonymous guest presence, and auto-persistence.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Tldraw, loadSnapshot } from 'tldraw';
import 'tldraw/tldraw.css';
import { Wifi, WifiOff, Users, Share2, Download, Trash2, Check, Copy } from 'lucide-react';
import { initSocket } from '../../services/socket';
import './WhiteboardCanvas.css';

export default function WhiteboardCanvas({ 
  roomName, 
  socket, 
  currentUser,
  onRosterUpdate,
  onEditorMount,
  readOnly = false,
  height = '100%' 
}) {
  const editorRef = useRef(null);
  const socketInstanceRef = useRef(null);
  if (!socketInstanceRef.current) {
    socketInstanceRef.current = socket && socket.connected ? socket : initSocket();
  }
  const activeSocket = socketInstanceRef.current;

  useEffect(() => {
    if (activeSocket && !activeSocket.connected) {
      activeSocket.connect();
    }
  }, [activeSocket]);

  const [isConnected, setIsConnected] = useState(false);
  const [peers, setPeers] = useState([]); 
  const [remoteCursors, setRemoteCursors] = useState({});
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [saveIndicator, setSaveIndicator] = useState('Saved');
  const [activeTheme, setActiveTheme] = useState('dark');
  const cursorCleanupTimers = useRef(new Map());

  // Listen for global theme changes
  useEffect(() => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'modern';
    setActiveTheme(currentTheme === 'dark' || currentTheme === 'dracula' || currentTheme === 'cyberpunk' || currentTheme === 'midnight' ? 'dark' : 'light');

    const handleThemeChange = (e) => {
      const t = e.detail?.theme || 'modern';
      setActiveTheme(t === 'dark' || t === 'dracula' || t === 'cyberpunk' || t === 'midnight' ? 'dark' : 'light');
    };
    window.addEventListener('themeChanged', handleThemeChange);
    return () => window.removeEventListener('themeChanged', handleThemeChange);
  }, []);

  const pendingSnapshotRef = useRef(null);

  // Helper to verify if snapshot contains actual drawn shapes
  const hasValidShapes = (snapshot) => {
    if (!snapshot || !snapshot.store) return false;
    return Object.keys(snapshot.store).some(key => key.startsWith('shape:'));
  };

  // Helper to safely load snapshot into editor
  const applySnapshotToEditor = useCallback((editor, snapshotData) => {
    if (!editor || !snapshotData || !hasValidShapes(snapshotData)) return;
    try {
      if (typeof editor.store.loadStoreSnapshot === 'function') {
        editor.store.loadStoreSnapshot(snapshotData);
      } else if (typeof loadSnapshot === 'function') {
        loadSnapshot(editor.store, snapshotData);
      }
    } catch (err) {
      console.warn('[WHITEBOARD] Error loading store snapshot:', err);
    }
  }, []);

  // Handle tldraw mount
  const handleMount = useCallback((editor) => {
    editorRef.current = editor;

    // Apply user name and color to tldraw user preferences
    try {
      editor.user.updateUserPreferences({
        name: currentUser?.username || 'Guest',
        color: currentUser?.color || '#2563EB'
      });
    } catch (e) {}

    if (readOnly) {
      editor.updateInstanceState({ isReadonly: true });
    }

    // 1. If server snapshot with shapes is pending, load it
    if (pendingSnapshotRef.current && hasValidShapes(pendingSnapshotRef.current)) {
      applySnapshotToEditor(editor, pendingSnapshotRef.current);
    } else {
      // 2. Check if local cache has shapes
      try {
        const localCached = localStorage.getItem(`wb_snap_${roomName}`);
        if (localCached) {
          const parsed = JSON.parse(localCached);
          if (hasValidShapes(parsed)) {
            applySnapshotToEditor(editor, parsed);
          }
        }
      } catch (e) {}
    }

    // 3. Sync initial shapes to server if editor already has drawings
    setTimeout(() => {
      try {
        const currentSnap = editor.store.getStoreSnapshot();
        if (hasValidShapes(currentSnap) && activeSocket && activeSocket.connected) {
          activeSocket.emit('whiteboard-changes', {
            roomName,
            changes: { added: {}, updated: {}, removed: {} },
            snapshot: currentSnap
          });
        }
      } catch (e) {}
    }, 500);

    if (onEditorMount) {
      onEditorMount(editor);
    }

    // Subscribe to local drawing and shape modifications
    const unlisten = editor.store.listen((entry) => {
      if (entry.source === 'user') {
        const { added, updated, removed } = entry.changes;
        const hasChanges = Object.keys(added).length > 0 || Object.keys(updated).length > 0 || Object.keys(removed).length > 0;
        
        if (hasChanges) {
          let snapshot = null;
          try {
            if (typeof editor.store.getStoreSnapshot === 'function') {
              snapshot = editor.store.getStoreSnapshot();
            } else if (typeof editor.store.getSnapshot === 'function') {
              snapshot = editor.store.getSnapshot();
            }
            if (snapshot) {
              pendingSnapshotRef.current = snapshot;
              localStorage.setItem(`wb_snap_${roomName}`, JSON.stringify(snapshot));
            }
          } catch (e) {}

          if (activeSocket && activeSocket.connected) {
            setSaveIndicator('Saving...');
            activeSocket.emit('whiteboard-changes', {
              roomName,
              changes: { added, updated, removed },
              snapshot
            });
            setTimeout(() => setSaveIndicator('Saved'), 600);
          }
        }
      }
    }, { scope: 'all' });

    return () => {
      unlisten();
    };
  }, [roomName, activeSocket, currentUser, activeTheme, readOnly, onEditorMount, applySnapshotToEditor]);

  // Update user preferences when currentUser changes
  useEffect(() => {
    if (editorRef.current && currentUser) {
      try {
        editorRef.current.user.updateUserPreferences({
          name: currentUser.username || 'Guest',
          color: currentUser.color || '#2563EB'
        });
      } catch (e) {}
    }
  }, [currentUser]);

  // Setup Socket.IO synchronization listeners
  useEffect(() => {
    if (!activeSocket || !roomName) return;

    setIsConnected(activeSocket.connected);

    const onConnect = () => {
      setIsConnected(true);
      activeSocket.emit('join whiteboard', {
        roomName,
        username: currentUser?.username,
        color: currentUser?.color
      });
    };

    const onDisconnect = () => {
      setIsConnected(false);
    };

    // Initial snapshot receipt from server
    const onInit = (data) => {
      if (data && data.snapshot && data.snapshot !== '{}') {
        try {
          const parsed = typeof data.snapshot === 'string' ? JSON.parse(data.snapshot) : data.snapshot;
          if (hasValidShapes(parsed)) {
            pendingSnapshotRef.current = parsed;
            try {
              localStorage.setItem(`wb_snap_${roomName}`, JSON.stringify(parsed));
            } catch (e) {}
            if (editorRef.current) {
              applySnapshotToEditor(editorRef.current, parsed);
            }
          } else if (editorRef.current) {
            const currentSnap = editorRef.current.store.getStoreSnapshot();
            if (hasValidShapes(currentSnap)) {
              activeSocket.emit('whiteboard-changes', {
                roomName,
                changes: { added: {}, updated: {}, removed: {} },
                snapshot: currentSnap
              });
            }
          }
        } catch (err) {
          console.warn('[WHITEBOARD] Error loading initial snapshot:', err);
        }
      }
      setInitialLoaded(true);
    };

    // Differential changes from remote peers
    const onRemoteChanges = ({ changes, senderId }) => {
      if (senderId === activeSocket.id || !editorRef.current) return;
      try {
        editorRef.current.store.mergeRemoteChanges(() => {
          if (changes.added && Object.keys(changes.added).length > 0) {
            editorRef.current.store.put(Object.values(changes.added));
          }
          if (changes.updated && Object.keys(changes.updated).length > 0) {
            editorRef.current.store.put(Object.values(changes.updated).map(([_, to]) => to));
          }
          if (changes.removed && Object.keys(changes.removed).length > 0) {
            editorRef.current.store.remove(Object.keys(changes.removed));
          }
        });
        try {
          const newSnap = editorRef.current.store.getStoreSnapshot();
          localStorage.setItem(`wb_snap_${roomName}`, JSON.stringify(newSnap));
        } catch (e) {}
      } catch (err) {
        console.warn('[WHITEBOARD] Remote changes merge warning:', err);
      }
    };

    // Peer cursors presence
    const onRemotePresence = (data) => {
      if (!data || data.userId === activeSocket.id || !data.presence) return;

      const { userId, username, color, presence } = data;

      setRemoteCursors((prev) => ({
        ...prev,
        [userId]: {
          x: presence.x,
          y: presence.y,
          username: username || 'Guest',
          color: color || '#2563EB',
          lastSeen: Date.now()
        }
      }));

      // Prune inactive cursor after 4 seconds of silence
      if (cursorCleanupTimers.current.has(userId)) {
        clearTimeout(cursorCleanupTimers.current.get(userId));
      }
      const timer = setTimeout(() => {
        setRemoteCursors((prev) => {
          const next = { ...prev };
          delete next[userId];
          return next;
        });
      }, 4000);
      cursorCleanupTimers.current.set(userId, timer);
    };

    // Peer user list
    const onUsers = (userList) => {
      setPeers(userList || []);
      if (onRosterUpdate) onRosterUpdate(userList || []);
    };

    const onUserLeft = ({ userId }) => {
      setRemoteCursors((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    };

    const onCleared = ({ senderId }) => {
      if (senderId !== activeSocket.id && editorRef.current) {
        editorRef.current.selectAll();
        editorRef.current.deleteShapes(editorRef.current.getSelectedShapeIds());
      }
    };

    activeSocket.on('connect', onConnect);
    activeSocket.on('disconnect', onDisconnect);
    activeSocket.on('whiteboard-init', onInit);
    activeSocket.on('whiteboard-remote-changes', onRemoteChanges);
    activeSocket.on('whiteboard-remote-presence', onRemotePresence);
    activeSocket.on('whiteboard-users', onUsers);
    activeSocket.on('whiteboard-user-left', onUserLeft);
    activeSocket.on('whiteboard-cleared', onCleared);

    // If socket is already connected, join immediately
    if (activeSocket.connected) {
      onConnect();
    } else {
      activeSocket.connect();
    }

    return () => {
      activeSocket.off('connect', onConnect);
      activeSocket.off('disconnect', onDisconnect);
      activeSocket.off('whiteboard-init', onInit);
      activeSocket.off('whiteboard-remote-changes', onRemoteChanges);
      activeSocket.off('whiteboard-remote-presence', onRemotePresence);
      activeSocket.off('whiteboard-users', onUsers);
      activeSocket.off('whiteboard-user-left', onUserLeft);
      activeSocket.off('whiteboard-cleared', onCleared);
      activeSocket.emit('leave whiteboard', { roomName });
    };
  }, [activeSocket, roomName, currentUser, onRosterUpdate, applySnapshotToEditor]);

  // Pointer move broadcaster for multiplayer presence
  const handlePointerMove = useCallback((e) => {
    if (!editorRef.current || !activeSocket || !activeSocket.connected || !roomName) return;
    try {
      const pagePoint = editorRef.current.inputs?.currentPagePoint;
      if (pagePoint) {
        activeSocket.emit('whiteboard-presence', {
          roomName,
          presence: {
            x: pagePoint.x,
            y: pagePoint.y
          }
        });
      }
    } catch (err) {}
  }, [activeSocket, roomName]);

  return (
    <div 
      className="whiteboard-canvas-container" 
      style={{ height, position: 'relative', width: '100%', overflow: 'hidden' }}
      onPointerMove={handlePointerMove}
    >
      {/* Real-time Status Badge */}
      <div className="whiteboard-status-badge">
        <div className={`status-dot ${isConnected ? 'connected' : 'connecting'}`} />
        <span>{isConnected ? 'Live Sync' : 'Connecting...'}</span>
        <span className="save-indicator">• {saveIndicator}</span>
      </div>

      {/* Main tldraw canvas */}
      <div style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
        <Tldraw 
          persistenceKey={`anonhub_wb_${roomName}`}
          onMount={handleMount}
          autoFocus={false}
        />
      </div>

      {/* Render Multiplayer Cursors Overlay */}
      <RemoteCursorsOverlay editorRef={editorRef} remoteCursors={remoteCursors} />
    </div>
  );
}

/**
 * Overlay component to convert canvas page coordinates to screen viewport coordinates
 * and render multiplayer cursor tags for remote peers.
 */
function RemoteCursorsOverlay({ editorRef, remoteCursors }) {
  const [, setTick] = useState(0);

  // Re-render cursors smoothly with requestAnimationFrame during viewport pans/zooms
  useEffect(() => {
    let animId;
    const loop = () => {
      setTick((t) => (t + 1) % 1000);
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  const cursorEntries = Object.entries(remoteCursors);
  if (cursorEntries.length === 0 || !editorRef.current) return null;

  return (
    <div className="remote-cursors-layer" style={{ pointerEvents: 'none', position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 999 }}>
      {cursorEntries.map(([userId, cursor]) => {
        let screenPoint = { x: -100, y: -100 };
        try {
          if (editorRef.current && typeof editorRef.current.pageToViewport === 'function') {
            screenPoint = editorRef.current.pageToViewport({ x: cursor.x, y: cursor.y });
          }
        } catch (e) {}

        if (screenPoint.x < -50 || screenPoint.y < -50) return null;

        return (
          <div
            key={userId}
            className="remote-cursor-item"
            style={{
              position: 'absolute',
              left: `${screenPoint.x}px`,
              top: `${screenPoint.y}px`,
              transform: 'translate(0, 0)',
              transition: 'left 0.08s ease-out, top 0.08s ease-out',
              pointerEvents: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start'
            }}
          >
            {/* SVG Cursor Pointer */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}>
              <path
                d="M5.65376 12.3673H5.46026L5.31717 12.4976L0.500002 16.8829L0.500002 1.19841L11.7841 12.3673H5.65376Z"
                fill={cursor.color || '#2563EB'}
                stroke="#ffffff"
                strokeWidth="1.5"
              />
            </svg>

            {/* Peer Name Tag */}
            <div
              className="remote-cursor-label"
              style={{
                backgroundColor: cursor.color || '#2563EB',
                color: '#ffffff',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '11px',
                fontWeight: '600',
                marginTop: '-4px',
                marginLeft: '12px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
                whiteSpace: 'nowrap',
                letterSpacing: '0.02em'
              }}
            >
              {cursor.username}
            </div>
          </div>
        );
      })}
    </div>
  );
}

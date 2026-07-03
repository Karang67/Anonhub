/**
 * @file ProjectRoom.jsx
 * @description Collaborative multi-pane workspace component.
 * Integrates three key collaboration panels:
 * 1. Sketch Board (Fabric.js v7 canvas with Pen, Eraser, shapes, and Undo/Redo tracking).
 * 2. Document Board (TinyMCE rich text editor synced in real-time with Mongo DB memory-upload buffers).
 * 3. Coding Board (Monaco editor for multi-language syntax-highlighted code sharing).
 * Syncs workspace states over Socket.IO using specialized synchronization locking flags.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { Palette, FileText, Code2, Trash2, Download, Send, RefreshCw, MessageSquare, X, Link, Copy, Check, History, KeyRound, Pencil, BarChart3, Save, Clock, HelpCircle, LogOut } from 'lucide-react';
import { Canvas, Rect, Circle, PencilBrush, Triangle, Line } from 'fabric';
import { Editor as TinyMCEEditor } from '@tinymce/tinymce-react';
import Editor from '@monaco-editor/react';
import QRCode from 'qrcode';

import { initSocket, getCookie, setCookie, deleteCookie } from '../services/socket';
import AccessKeyModal from '../components/AccessKeyModal';
import VersionHistoryPanel from '../components/VersionHistoryPanel';
import WebRTCCallWidget from '../components/WebRTCCallWidget';
import './ProjectRoom.css';

/**
 * ProjectRoom Component
 * Manages the workspace components, socket listeners, and canvas state stacks.
 */
export default function ProjectRoom() {
  const { projectName } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // standaloneMode checks if the workspace was loaded targeting a single specific pane (e.g. document/code)
  const queryTab = searchParams.get('tab');
  const standaloneMode = queryTab === 'document' || queryTab === 'code';

  // Panel management state hooks
  const [activeTab, setActiveTab] = useState(queryTab || 'sketch');
  const [theme, setTheme] = useState('modern');

  // Connection & Gating state hooks
  const [username, setUsername] = useState('');
  const [users, setUsers] = useState([]);
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayError, setOverlayError] = useState('');

  // Messaging state hooks
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');

  // Rich editors & attachments states
  const [docContent, setDocContent] = useState('');
  const [codeContent, setCodeContent] = useState('// Start coding in VS Code style here...\n');
  const [codeLanguage, setCodeLanguage] = useState('javascript');
  const [attachments, setAttachments] = useState([]);
  const [isOwner, setIsOwner] = useState(false);
  const [deleteConfirmFile, setDeleteConfirmFile] = useState(null);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [tourStep, setTourStep] = useState(-1);
  const [showShareModal, setShowShareModal] = useState(false);

  // Phase 2: Version History
  const [showVersionPanel, setShowVersionPanel] = useState(false);
  const [versionPanelType, setVersionPanelType] = useState('document'); // 'document' | 'code'
  const [versionMessage, setVersionMessage] = useState('');

  // Phase 2: Change Access Key
  const [showChangeKeyModal, setShowChangeKeyModal] = useState(false);
  const [newKeyInput, setNewKeyInput] = useState('');
  const [changeKeyError, setChangeKeyError] = useState('');
  const [changeKeyLoading, setChangeKeyLoading] = useState(false);

  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [nicknameInput, setNicknameInput] = useState('');

  // Smart Notes states
  const [notes, setNotes] = useState([]);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [notesSearch, setNotesSearch] = useState('');
  const [isFormattingAi, setIsFormattingAi] = useState(false);

  // Manual Code Save modal states
  const [showSaveCodeModal, setShowSaveCodeModal] = useState(false);
  const [saveCodeComment, setSaveCodeComment] = useState('');

  // Phase 4: Polls states
  const [polls, setPolls] = useState([]);
  const [newPollQuestion, setNewPollQuestion] = useState('');
  const [newPollOptions, setNewPollOptions] = useState(['', '']);
  const [pollExpirationMinutes, setPollExpirationMinutes] = useState(60);

  // Phase 4: Snippets states
  const [snippets, setSnippets] = useState([]);
  const [newSnippetTitle, setNewSnippetTitle] = useState('');
  const [newSnippetCode, setNewSnippetCode] = useState('');
  const [newSnippetLang, setNewSnippetLang] = useState('javascript');
  const [snippetsSearch, setSnippetsSearch] = useState('');
  const [snippetsFilterLang, setSnippetsFilterLang] = useState('all');
  const [showAddSnippetModal, setShowAddSnippetModal] = useState(false);
  const [selectedSnippetId, setSelectedSnippetId] = useState(null);
  const [socketInstance, setSocketInstance] = useState(null);

  // Phase 4: Activity timeline state
  const [activityLog, setActivityLog] = useState([]);

  // Phase 4: Timeline logging helper
  const addTimelineEvent = useCallback((text) => {
    setActivityLog(prev => [
      { text, timestamp: Date.now() },
      ...prev.slice(0, 49)
    ]);
  }, []);

  // Phase 4: Notification sound tone synthesis
  const playNotificationSound = useCallback(() => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
      osc.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.1); // E5
      
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    } catch(e) {
      console.warn("Could not play synthesized audio alert:", e);
    }
  }, []);

  // Phase 4: HTML5 web notification trigger
  const triggerWebNotification = useCallback((title, body) => {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      new Notification(title, { body });
    }
  }, []);

  // Get active steps based on mode (dynamic definition to support standalone views)
  const getTourSteps = () => {
    if (standaloneMode) {
      if (activeTab === 'document') {
        return [
          {
            title: 'Welcome to Standalone Document Board',
            body: 'This is a dedicated, real-time collaborative document editor. Write rich-text markup and share it instantly with others.',
            class: 'doc-standalone-0'
          },
          {
            title: 'Document Board & Attachments',
            body: 'Use our toolbar to write and style documents. You can also upload files in the <strong>Project Attachments</strong> panel at the bottom for others to download.',
            class: 'proj-step-3'
          },
          {
            title: 'Real-Time Chat & Roster',
            body: 'Use the <strong>Project Chat</strong> sidebar on the right to send messages anonymously and view active collaborators in this document.',
            class: 'proj-step-5'
          }
        ];
      } else { // code
        return [
          {
            title: 'Welcome to Standalone Coding Board',
            body: 'This is a dedicated, collaborative code editor. Write code, compile scripts, and see output results in real-time.',
            class: 'code-standalone-0'
          },
          {
            title: 'Coding Board & Sandbox',
            body: 'Select a language, write code, and click <strong>Run Code</strong> to execute it in our secure compiler sandbox. Read console outputs below.',
            class: 'proj-step-4'
          },
          {
            title: 'Real-Time Chat & Roster',
            body: 'Use the <strong>Project Chat</strong> sidebar on the right to send messages anonymously and view active collaborators in this session.',
            class: 'proj-step-5'
          }
        ];
      }
    } else {
      // Standard mode
      return [
        {
          title: 'Project Room Guide',
          body: 'Welcome to your <strong>Project Workspace</strong>! This workspace lets you and your team work on whiteboards, documents, and code simultaneously in real-time.',
          class: 'proj-step-0'
        },
        {
          title: 'Workspace Panels',
          body: 'Use these <strong>Tabs</strong> to toggle between the <strong>Sketch Board</strong> (drawing canvas), <strong>Document Board</strong> (rich editor & files), and <strong>Coding Board</strong> (interactive compiler).',
          class: 'proj-step-1'
        },
        {
          title: 'Sketch Board Controls',
          body: 'On the <strong>Sketch Board</strong>, use the Pen, Eraser, shapes, and Undo/Redo tools to brainstorm. All drawings are instantly synchronized with your collaborators.',
          class: 'proj-step-2'
        },
        {
          title: 'Document Board & Files',
          body: 'On the <strong>Document Board</strong>, write formatted documentation with our editor, and upload files in the <strong>Project Attachments</strong> panel for others to download.',
          class: 'proj-step-3'
        },
        {
          title: 'Coding Board & Sandbox',
          body: 'On the <strong>Coding Board</strong>, select a language, write code in a VS Code style editor, and click <strong>Run Code</strong> to compile it instantly in our sandboxed runner.',
          class: 'proj-step-4'
        },
        {
          title: 'Real-Time Chat & Roster',
          body: 'Use the <strong>Project Chat</strong> sidebar to message your team anonymously and view active collaborators in the project.',
          class: 'proj-step-5'
        },
        {
          title: 'AI Chat Copilot',
          body: 'Finally, need some quick help? Click the floating <strong>AI Copilot</strong> button in the bottom right corner to get coding tips, layout alignment help, or templates immediately from Gemini. Have fun collaborating!',
          class: 'proj-step-6'
        }
      ];
    }
  };

  const steps = getTourSteps();

  // Code execution states
  const [isRunning, setIsRunning] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState('');
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Mutable reference mapping to avoid stale closures inside Monaco callbacks
  const handleRunCodeRef = useRef(null);

  // Drawing settings hooks
  const [drawingTool, setDrawingTool] = useState('pen'); // 'pen', 'select', 'eraser'
  const [brushWidth, setBrushWidth] = useState(3);
  const [brushColor, setBrushColor] = useState('#A93F55');

  // Core module references
  const socketRef = useRef(null);
  const canvasRef = useRef(null); // DOM canvas node ref
  const fabricCanvasRef = useRef(null); // Fabric JS instance ref
  const tinymceRef = useRef(null);
  const monacoRef = useRef(null);
  const chatContainerRef = useRef(null);

  // Whiteboard history stacks (Undo/Redo buffers)
  const undoStackRef = useRef([]); // Serialized history queue to traverse backwards
  const redoStackRef = useRef([]); // Serialized history queue to traverse forwards
  const isUndoingRedoingRef = useRef(false); // Locking flag to prevent saving frames during history traversal

  // Mutual exclusion guard flags to prevent echo-back infinite loop updates
  const isRemoteDocChangeRef = useRef(false);
  const isRemoteCodeChangeRef = useRef(false);
  const isRemoteCanvasChangeRef = useRef(false);

  // Input debounce timeouts to prevent keystroke flooding
  const docTimeoutRef = useRef(null);
  const codeTimeoutRef = useRef(null);

  // Sync the execution handler reference on state changes to bypass Monaco closure scopes
  useEffect(() => {
    handleRunCodeRef.current = handleRunCode;
  });

  // Synchronizes visual skin changes with TinyMCE themes
  useEffect(() => {
    const handleThemeChange = (e) => {
      setTheme(e.detail.theme);
    };
    window.addEventListener('themeChanged', handleThemeChange);
    setTheme(localStorage.getItem('anonhub-theme') || 'modern');
    return () => window.removeEventListener('themeChanged', handleThemeChange);
  }, []);

  // Track viewport size dynamically to toggle compact dimensions for mobile editors
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Onboarding walkthrough tour logic
  useEffect(() => {
    const handleStartTour = () => {
      setTourStep(0);
    };
    window.addEventListener('start-anonhub-tour', handleStartTour);

    // Auto-trigger for first-time visitors
    const tourKey = standaloneMode ? `anonhub_standalone_${activeTab}_tour_seen` : 'anonhub_project_tour_seen';
    const hasSeenTour = localStorage.getItem(tourKey);
    if (!hasSeenTour) {
      const t = setTimeout(() => setTourStep(0), 1500);
      return () => {
        clearTimeout(t);
        window.removeEventListener('start-anonhub-tour', handleStartTour);
      };
    }

    return () => {
      window.removeEventListener('start-anonhub-tour', handleStartTour);
    };
  }, [standaloneMode, activeTab]);

  // Switch tabs automatically to focus on relevant boards during onboarding guide steps (only in standard mode)
  useEffect(() => {
    if (standaloneMode || tourStep < 0) return;

    const currentStepClass = steps[tourStep]?.class;
    if (currentStepClass === 'proj-step-2') {
      setActiveTab('sketch');
    } else if (currentStepClass === 'proj-step-3') {
      setActiveTab('document');
    } else if (currentStepClass === 'proj-step-4') {
      setActiveTab('code');
    }
  }, [tourStep, standaloneMode]);

  // Workspace initialization: bootstraps socket connections, credentials, and real-time syncing triggers
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Save active standalone sessions for the current browser session
  useEffect(() => {
    if (!projectName) return;
    if (activeTab === 'document') {
      sessionStorage.setItem('anonhub-active-document-room', projectName);
      setCookie('anonhub-active-document-room', projectName);
    } else if (activeTab === 'code') {
      sessionStorage.setItem('anonhub-active-code-room', projectName);
      setCookie('anonhub-active-code-room', projectName);
    }
  }, [projectName, activeTab]);

  // Render QR code into the project share modal canvas when it opens
  useEffect(() => {
    if (!showShareModal) return;
    const inviteUrl = `${window.location.origin}/projects/${encodeURIComponent(projectName)}`;
    const canvas = document.getElementById('project-share-qr');
    if (canvas) {
      QRCode.toCanvas(canvas, inviteUrl, {
        width: 180,
        margin: 2,
        color: { dark: '#1a1a2e', light: '#ffffff' }
      });
    }
  }, [showShareModal, projectName]);

  useEffect(() => {
    const socket = initSocket();
    socketRef.current = socket;
    setSocketInstance(socket);
    socket.connect();

    // Synchronization callback: parses client pseudonym tags
    socket.on('set username', (name) => {
      setUsername(name);
      setNicknameInput(name);
      document.cookie = `anonhub-username=${encodeURIComponent(name)}; path=/; SameSite=Lax`;
      sessionStorage.setItem('anonhub-username', name);
      if (socketRef.current) {
        socketRef.current.auth = { ...socketRef.current.auth, username: name };
      }
    });

    socket.on('username updated', (name) => {
      setUsername(name);
      setNicknameInput(name);
      document.cookie = `anonhub-username=${encodeURIComponent(name)}; path=/; SameSite=Lax`;
      sessionStorage.setItem('anonhub-username', name);
      if (socketRef.current) {
        socketRef.current.auth = { ...socketRef.current.auth, username: name };
      }
    });

    socket.on('set session id', (id) => {
      document.cookie = `anonhub-session-id=${encodeURIComponent(id)}; path=/; SameSite=Lax`;
    });

    // Capture dynamic ownerToken responses representing project creation
    socket.on('set owner token', (token) => {
      localStorage.setItem(`owner_token_${projectName}`, token);
    });

    socket.on('is owner', (val) => {
      setIsOwner(val);
    });

    socket.on('access denied', (data) => {
      setShowOverlay(true);
      setOverlayError(data.message);
    });

    socket.on('join success', () => {
      setShowOverlay(false);
      setOverlayError('');
    });

    // Chat events
    socket.on('load messages', (messagesArray) => {
      if (Array.isArray(messagesArray)) setChatMessages(messagesArray);
    });

    socket.on('chat message', (data) => {
      setChatMessages(prev => [...prev, data]);
      if (data.username !== username) {
        playNotificationSound();
        triggerWebNotification(`Message from ${data.username}`, data.msg);
      }
    });

    socket.on('room users', (usersArray) => {
      if (Array.isArray(usersArray)) {
        setUsers(prev => {
          if (prev.length > 0) {
            // Find joins
            const joined = usersArray.filter(u => !prev.some(p => p.username === u.username));
            joined.forEach(u => addTimelineEvent(`👤 ${u.username} joined the workspace`));
            // Find leaves
            const left = prev.filter(p => !usersArray.some(u => u.username === p.username));
            left.forEach(p => addTimelineEvent(`👤 ${p.username} left the workspace`));
          }
          return usersArray;
        });
      }
    });

    // Editor content updates synced over Socket events
    // Uses synchronization refs to prevent recursive infinite trigger loops
    socket.on('project content', (content) => {
      if (content === undefined || content === null) return;
      isRemoteDocChangeRef.current = true;
      setDocContent(content);
      if (tinymceRef.current) {
        tinymceRef.current.setContent(content);
      }
      isRemoteDocChangeRef.current = false;
      addTimelineEvent('📝 Rich document updated');
    });

    socket.on('code content', (data) => {
      if (!data) return;
      isRemoteCodeChangeRef.current = true;
      setCodeContent(data.code);
      setCodeLanguage(data.language);
      if (monacoRef.current) {
        monacoRef.current.setValue(data.code);
      }
      isRemoteCodeChangeRef.current = false;
      addTimelineEvent(`💻 Code modified (${data.language})`);
    });

    socket.on('whiteboard content', (content) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas || !content) return;

      try {
        isRemoteCanvasChangeRef.current = true;
        const parsed = JSON.parse(content);
        if (!parsed.objects) parsed.objects = [];

        canvas.loadFromJSON(parsed).then(() => {
          const pane = document.getElementById('pane-sketch');
          const parentEl = pane ? pane.parentElement : null;
          const parentWidth = parentEl ? parentEl.clientWidth : (window.innerWidth - 32);
          const w = pane ? Math.min(pane.clientWidth || parentWidth, parentWidth) : parentWidth;
          canvas.setZoom(w / 800);
          canvas.renderAll();
          isRemoteCanvasChangeRef.current = false;
          addTimelineEvent('🎨 Whiteboard drawing updated');
        }).catch(err => {
          console.error('Failed to parse whiteboard content JSON inside loadFromJSON:', err);
          isRemoteCanvasChangeRef.current = false;
        });
      } catch (err) {
        console.error('Failed to load whiteboard content:', err);
        isRemoteCanvasChangeRef.current = false;
      }
    });

    socket.on('attachments content', (attachmentsStr) => {
      try {
        const list = JSON.parse(attachmentsStr || '[]');
        setAttachments(list);
        addTimelineEvent('📎 Attachments updated');
      } catch (err) {
        console.error('Failed to parse attachments:', err);
      }
    });

    socket.on('notes content', (notesStr) => {
      try {
        const list = JSON.parse(notesStr || '[]');
        setNotes(list);
        setActiveNoteId(prev => {
          if (prev && list.some(n => n.id === prev)) return prev;
          return list[0]?.id || null;
        });
        addTimelineEvent('🗒️ Smart Notes updated');
      } catch (err) {
        console.error('Failed to parse notes:', err);
      }
    });

    socket.on('polls content', (pollsStr) => {
      try {
        const list = JSON.parse(pollsStr || '[]');
        setPolls(list);
        addTimelineEvent('📊 Poll status updated');
        playNotificationSound();
        triggerWebNotification('AnonHub Polls', 'A workspace poll was updated or created.');
      } catch (err) {
        console.error('Failed to parse polls:', err);
      }
    });

    socket.on('snippets content', (snippetsStr) => {
      try {
        const list = JSON.parse(snippetsStr || '[]');
        setSnippets(list);
        addTimelineEvent('💾 Code snippets library updated');
      } catch (err) {
        console.error('Failed to parse snippets:', err);
      }
    });

    socket.on('connect_error', () => {
      setChatMessages(prev => [
        ...prev,
        { username: 'System', msg: '⚠️ Connection lost. Retrying...', timestamp: Date.now() }
      ]);
    });

    socket.on('connect', () => {
      const currentKey = sessionStorage.getItem(`accesskey_project_${projectName}`) || getCookie(`accesskey_project_${projectName}`) || '';
      const savedOwnerToken = localStorage.getItem(`owner_token_${projectName}`) || '';
      socket.emit('join project', { projectName, accessKey: currentKey, ownerToken: savedOwnerToken });
    });

    // Now emit the initial join project event that all listeners are bound
    const savedKey = sessionStorage.getItem(`accesskey_project_${projectName}`) || getCookie(`accesskey_project_${projectName}`) || '';
    const savedOwnerToken = localStorage.getItem(`owner_token_${projectName}`) || '';
    socket.emit('join project', { projectName, accessKey: savedKey, ownerToken: savedOwnerToken });

    return () => {
      // Send final state cleanup
      if (socketRef.current) {
        // Emit final updates before leaving
        if (tinymceRef.current) {
          socketRef.current.emit('project update', { projectName, content: tinymceRef.current.getContent() });
        }
        if (monacoRef.current) {
          socketRef.current.emit('code update', {
            projectName,
            code: monacoRef.current.getValue(),
            language: codeLanguage
          });
        }
        if (fabricCanvasRef.current) {
          const json = JSON.stringify(fabricCanvasRef.current.toJSON(['selectable']));
          socketRef.current.emit('whiteboard update', { projectName, content: json });
        }
      }
      socket.disconnect();
    };
  }, [projectName]);

  const handleSaveNickname = useCallback(() => {
    const trimmed = nicknameInput.trim().slice(0, 50);
    if (!trimmed || trimmed === username) {
      setIsEditingNickname(false);
      return;
    }
    socketRef.current?.emit('update username', { username: trimmed });
    setIsEditingNickname(false);
  }, [nicknameInput, username]);

  const handleLeaveRoom = () => {
    if (standaloneMode) {
      sessionStorage.removeItem(`anonhub-active-${activeTab}-room`);
      deleteCookie(`anonhub-active-${activeTab}-room`);
      deleteCookie(`accesskey_project_${projectName}`);
      navigate(`/${activeTab}`);
    } else {
      sessionStorage.removeItem('anonhub-active-document-room');
      sessionStorage.removeItem('anonhub-active-code-room');
      deleteCookie('anonhub-active-document-room');
      deleteCookie('anonhub-active-code-room');
      deleteCookie(`accesskey_project_${projectName}`);
      navigate('/');
    }
  };

  // Auto-scrolls the panel chat window to display incoming logs
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  /**
   * Captures the current serializable JSON state of the whiteboard canvas
   * and pushes it into the undo history stack. Sets a size cap of 50 frames
   * to guarantee memory leaks are avoided during prolonged whiteboard design sessions.
   */
  const saveCanvasState = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || isUndoingRedoingRef.current) return;

    const state = JSON.stringify(canvas.toJSON(['selectable']));
    if (undoStackRef.current.length >= 50) {
      undoStackRef.current.shift();
    }
    undoStackRef.current.push(state);
    redoStackRef.current = []; // Clear redo actions whenever a fresh user stroke completes
  };

  // Canvas bootstrap lifecycle: sets up Fabric.js, dynamic resizing, and change listeners
  useEffect(() => {
    if (!canvasRef.current) return;

    // Instantiate drawing board parameters
    const canvas = new Canvas(canvasRef.current, {
      isDrawingMode: drawingTool === 'pen' || drawingTool === 'eraser',
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
      width: 800,
      height: 600
    });

    // Fabric v7 PencilBrush registration
    canvas.freeDrawingBrush = new PencilBrush(canvas);
    fabricCanvasRef.current = canvas;

    // Apply active width & color properties to brush config
    if (canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush.width = brushWidth;
      canvas.freeDrawingBrush.color = drawingTool === 'eraser' ? '#ffffff' : brushColor;
    }

    // Dynamic width adapter to match container pane changes
    // Dynamic width/height adapter to match container pane changes
    const resizeCanvas = () => {
      const pane = document.getElementById('pane-sketch');
      if (pane && fabricCanvasRef.current === canvas && typeof canvas.setWidth === 'function') {
        const parentEl = pane.parentElement;
        const parentWidth = parentEl ? parentEl.clientWidth : (window.innerWidth - 32);
        const width = Math.min(pane.clientWidth || parentWidth, parentWidth);
        const height = width * 0.75; // Locked to 4:3 aspect ratio
        canvas.setWidth(width);
        canvas.setHeight(height);
        canvas.setZoom(width / 800); // Scale coordinates relative to base 800 width
        canvas.calcOffset();
        canvas.renderAll();
      }
    };

    setTimeout(resizeCanvas, 200);

    // Watch resizing via ResizeObserver or fallback window event listeners
    let resizeObserver = null;
    const pane = document.getElementById('pane-sketch');
    if (pane && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resizeCanvas);
      resizeObserver.observe(pane);
    } else {
      window.addEventListener('resize', resizeCanvas);
    }

    // Debounced canvas update broadcaster
    let emitTimeout = null;
    const emitCanvasChange = () => {
      if (isRemoteCanvasChangeRef.current || !socketRef.current) return;

      if (emitTimeout) clearTimeout(emitTimeout);
      emitTimeout = setTimeout(() => {
        const json = JSON.stringify(canvas.toJSON(['selectable']));
        socketRef.current.emit('whiteboard update', { projectName, content: json });
      }, 300);
    };

    // Attach events to record state snapshots and dispatch changes
    canvas.on('path:created', () => {
      if (!isRemoteCanvasChangeRef.current && !isUndoingRedoingRef.current) saveCanvasState();
      emitCanvasChange();
    });
    canvas.on('object:added', () => {
      if (!isRemoteCanvasChangeRef.current && !isUndoingRedoingRef.current) saveCanvasState();
      emitCanvasChange();
    });
    canvas.on('object:modified', () => {
      if (!isRemoteCanvasChangeRef.current && !isUndoingRedoingRef.current) saveCanvasState();
      emitCanvasChange();
    });
    canvas.on('object:removed', () => {
      if (!isRemoteCanvasChangeRef.current && !isUndoingRedoingRef.current) saveCanvasState();
      emitCanvasChange();
    });

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', resizeCanvas);
      if (emitTimeout) clearTimeout(emitTimeout);
      canvas.dispose();
      fabricCanvasRef.current = null;
    };
  }, [projectName, activeTab]); // Rebinds when activeTab updates to hook onto correct ref nodes

  // Synchronizes pen properties (tool, color, stroke weight) with Fabric drawing model
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    canvas.isDrawingMode = drawingTool === 'pen' || drawingTool === 'eraser';
    if (canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush.width = brushWidth;
      canvas.freeDrawingBrush.color = drawingTool === 'eraser' ? '#ffffff' : brushColor;
    }
  }, [drawingTool, brushWidth, brushColor]);

  // Whiteboard Action Handlers for Shape Insertions & Traversal Stacks

  /**
   * Adds a collaborative Rectangle outline to the canvas.
   * Disables drawingMode to switch to Selection controls automatically.
   */
  const addRect = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    canvas.isDrawingMode = false;
    setDrawingTool('select');
    const rect = new Rect({
      left: 80,
      top: 80,
      width: 120,
      height: 80,
      fill: 'transparent',
      stroke: brushColor,
      strokeWidth: 2
    });
    canvas.add(rect);
    canvas.setActiveObject(rect);
    canvas.renderAll();
  };

  /**
   * Adds a collaborative Circle outline to the canvas.
   * Disables drawingMode to switch to Selection controls automatically.
   */
  const addCircle = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    canvas.isDrawingMode = false;
    setDrawingTool('select');
    const circle = new Circle({
      left: 100,
      top: 100,
      radius: 40,
      fill: 'transparent',
      stroke: brushColor,
      strokeWidth: 2
    });
    canvas.add(circle);
    canvas.setActiveObject(circle);
    canvas.renderAll();
  };

  /**
   * Adds a collaborative Triangle outline to the canvas.
   * Disables drawingMode to switch to Selection controls automatically.
   */
  const addTriangle = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    canvas.isDrawingMode = false;
    setDrawingTool('select');
    const triangle = new Triangle({
      left: 100,
      top: 100,
      width: 100,
      height: 100,
      fill: 'transparent',
      stroke: brushColor,
      strokeWidth: 2
    });
    canvas.add(triangle);
    canvas.setActiveObject(triangle);
    canvas.renderAll();
  };

  /**
   * Adds a collaborative horizontal Line shape to the canvas.
   * Disables drawingMode to switch to Selection controls automatically.
   */
  const addLine = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    canvas.isDrawingMode = false;
    setDrawingTool('select');
    const line = new Line([50, 50, 200, 50], {
      stroke: brushColor,
      strokeWidth: 2
    });
    canvas.add(line);
    canvas.setActiveObject(line);
    canvas.renderAll();
  };

  /**
   * Deletes currently selected canvas element(s).
   * Pushes a history snapshot onto the undo stack prior to removals.
   */
  const deleteSelected = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const activeObjects = canvas.getActiveObjects();
    if (activeObjects.length > 0) {
      saveCanvasState();
      activeObjects.forEach(obj => {
        canvas.remove(obj);
      });
      canvas.discardActiveObject();
      canvas.renderAll();
    }
  };

  /**
   * Pops the last state snapshot from the undo history stack,
   * loads it onto the canvas, and broadcasts changes to peers.
   */
  const handleUndo = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || undoStackRef.current.length === 0) return;

    isUndoingRedoingRef.current = true;
    const currentState = JSON.stringify(canvas.toJSON(['selectable']));
    redoStackRef.current.push(currentState);

    const previousState = undoStackRef.current.pop();
    try {
      const parsed = JSON.parse(previousState);
      canvas.loadFromJSON(parsed).then(() => {
        const pane = document.getElementById('pane-sketch');
        const parentEl = pane ? pane.parentElement : null;
        const parentWidth = parentEl ? parentEl.clientWidth : (window.innerWidth - 32);
        const w = pane ? Math.min(pane.clientWidth || parentWidth, parentWidth) : parentWidth;
        canvas.setZoom(w / 800);
        canvas.renderAll();
        isUndoingRedoingRef.current = false;
        if (socketRef.current) {
          socketRef.current.emit('whiteboard update', { projectName, content: previousState });
        }
      }).catch(err => {
        console.error('Failed to load undo state:', err);
        isUndoingRedoingRef.current = false;
      });
    } catch (err) {
      console.error('Failed to undo:', err);
      isUndoingRedoingRef.current = false;
    }
  };

  /**
   * Pops the last state snapshot from the redo history stack,
   * loads it onto the canvas, and broadcasts changes to peers.
   */
  const handleRedo = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || redoStackRef.current.length === 0) return;

    isUndoingRedoingRef.current = true;
    const nextState = redoStackRef.current.pop();
    const currentState = JSON.stringify(canvas.toJSON(['selectable']));
    undoStackRef.current.push(currentState);

    try {
      const parsed = JSON.parse(nextState);
      canvas.loadFromJSON(parsed).then(() => {
        const pane = document.getElementById('pane-sketch');
        const parentEl = pane ? pane.parentElement : null;
        const parentWidth = parentEl ? parentEl.clientWidth : (window.innerWidth - 32);
        const w = pane ? Math.min(pane.clientWidth || parentWidth, parentWidth) : parentWidth;
        canvas.setZoom(w / 800);
        canvas.renderAll();
        isUndoingRedoingRef.current = false;
        if (socketRef.current) {
          socketRef.current.emit('whiteboard update', { projectName, content: nextState });
        }
      }).catch(err => {
        console.error('Failed to load redo state:', err);
        isUndoingRedoingRef.current = false;
      });
    } catch (err) {
      console.error('Failed to redo:', err);
      isUndoingRedoingRef.current = false;
    }
  };

  /**
   * Wipes all items drawn on the board.
   * Prompt confirmation alert prior to execution.
   */
  const clearWhiteboard = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !window.confirm('Clear the whiteboard for everyone?')) return;
    saveCanvasState();
    canvas.clear();
    canvas.backgroundColor = '#ffffff';
    canvas.renderAll();
    if (socketRef.current) {
      const json = JSON.stringify(canvas.toJSON(['selectable']));
      socketRef.current.emit('whiteboard update', { projectName, content: json });
    }
  };

  /**
   * Exports the whiteboard configurations as a downloadable JSON file.
   */
  const exportWhiteboard = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const json = JSON.stringify(canvas.toJSON(['selectable']));
    const dataUri = 'data:text/json;charset=utf-8,' + encodeURIComponent(json);
    const exportFileDefaultName = `${projectName}-whiteboard.json`;
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  // --- Attachments & File Uploads Handlers ---

  /**
   * Event dispatched upon successful file uploads to backend storage.
   * Broadcasts a Socket trigger to populate peer attachment cards.
   * @param {string} name - Base name of the file
   * @param {string} url - Target stream endpoint URL
   */
  const onUploadSuccess = (name, url) => {
    if (socketRef.current) {
      socketRef.current.emit('add attachment', {
        projectName,
        file: { name, url, timestamp: Date.now() }
      });
    }
  };

  /**
   * Intercepts local file picker changes, uploading payloads to `/upload`.
   */
  const handleAttachmentUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    fetch('/upload', {
      method: 'POST',
      body: formData
    })
      .then(res => res.json())
      .then(json => {
        if (json.location) {
          onUploadSuccess(file.name, json.location);
        }
      })
      .catch(err => {
        console.error('Attachment upload failed:', err);
        alert('Upload failed: ' + err.message);
      });
  };

  /**
   * Removes attachments. Secured client-side by rendering delete buttons
   * only for the project owner. Validated backend-side over websocket logic.
   */
  const handleRemoveAttachment = (fileUrl) => {
    if (socketRef.current && window.confirm('Are you sure you want to delete this attachment?')) {
      socketRef.current.emit('remove attachment', {
        projectName,
        fileUrl
      });
    }
  };

  // --- Document Editor (TinyMCE) Handlers ---

  /**
   * Handles TinyMCE text modifications, debouncing Socket updates to prevent lag.
   */
  const handleDocChange = (content) => {
    setDocContent(content);
    if (isRemoteDocChangeRef.current || !socketRef.current) return;

    if (docTimeoutRef.current) clearTimeout(docTimeoutRef.current);
    docTimeoutRef.current = setTimeout(() => {
      socketRef.current.emit('project update', { projectName, content });
    }, 400);
  };

  // --- Code Editor (Monaco) Handlers ---

  /**
   * Handles Monaco code modifications, debouncing Socket updates to prevent lag.
   */
  const handleCodeChange = (value) => {
    setCodeContent(value);
    if (isRemoteCodeChangeRef.current || !socketRef.current) return;

    if (codeTimeoutRef.current) clearTimeout(codeTimeoutRef.current);
    codeTimeoutRef.current = setTimeout(() => {
      socketRef.current.emit('code update', {
        projectName,
        code: value,
        language: codeLanguage
      });
    }, 400);
  };

  /**
   * Inserts a code snippet into the Monaco editor at the current cursor position.
   */
  const handleInsertSnippet = (snippetCode) => {
    if (monacoRef.current) {
      const editor = monacoRef.current;
      const position = editor.getPosition() || { lineNumber: 1, column: 1 };
      const range = {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      };
      editor.executeEdits("snippet-insert", [{
        range: range,
        text: snippetCode,
        forceMoveMarkers: true
      }]);
      editor.focus();
    } else {
      const newCode = codeContent + '\n' + snippetCode;
      setCodeContent(newCode);
      socketRef.current?.emit('code update', {
        projectName,
        code: newCode,
        language: codeLanguage
      });
    }
    setActiveTab('code');
    addTimelineEvent('Saved snippet inserted into editor');
  };

  /**
   * Handles dropdown configuration updates for Monaco syntax highlighting.
   */
  const handleLanguageChange = (e) => {
    const lang = e.target.value;
    setCodeLanguage(lang);
    if (socketRef.current) {
      socketRef.current.emit('code update', {
        projectName,
        code: codeContent,
        language: lang
      });
    }
  };

  /**
   * Dispatches code execution request to the server and updates the terminal output.
   */
  const handleRunCode = async () => {
    setIsRunning(true);
    setTerminalOpen(true);
    if (codeLanguage === 'html') {
      setShowPreview(true);
      setTerminalOutput('Rendering HTML Live Preview...');
      setIsRunning(false);
      return;
    }

    setShowPreview(false);
    setTerminalOutput('Compiling and running code...');
    try {
      const response = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeContent, language: codeLanguage })
      });
      const data = await response.json();

      if (response.ok) {
        let output = '';
        if (data.timeout) {
          output += '⚠️ Execution timed out (exceeded 5 seconds boundary).\n';
        }
        if (data.stdout) {
          output += data.stdout;
        }
        if (data.stderr) {
          output += `\nError:\n${data.stderr}`;
        }
        if (!data.stdout && !data.stderr && !data.timeout) {
          output += `Process exited with code ${data.exitCode}`;
        }
        setTerminalOutput(output);
      } else {
        setTerminalOutput(`Error: ${data.error || 'Execution failed.'}`);
      }
    } catch (err) {
      console.error(err);
      setTerminalOutput('Execution failed. Network error.');
    } finally {
      setIsRunning(false);
    }
  };

  // --- Chat Submit Handlers ---

  /**
   * Dispatches chat message strings inside the active workspace room.
   */
  const handleSendChat = (e) => {
    e.preventDefault();
    const msg = chatInput.trim();
    if (msg && socketRef.current) {
      socketRef.current.emit('room message', { room: projectName, msg });
      setChatInput('');
    }
  };

  // --- Phase 2: Change Access Key ---
  const handleChangeKey = async () => {
    const trimmed = newKeyInput.trim();
    if (trimmed.length < 4) {
      setChangeKeyError('New key must be at least 4 characters.');
      return;
    }
    const ownerToken = localStorage.getItem(`owner_token_${projectName}`) || '';
    setChangeKeyLoading(true);
    setChangeKeyError('');
    try {
      const res = await fetch(`/api/project/${encodeURIComponent(projectName)}/change-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerToken, newKey: trimmed })
      });
      const data = await res.json();
      if (res.ok) {
        sessionStorage.setItem(`accesskey_project_${projectName}`, trimmed);
        setCookie(`accesskey_project_${projectName}`, trimmed);
        setShowChangeKeyModal(false);
        setNewKeyInput('');
        alert('✅ Access key updated! Share the new key with your collaborators.');
      } else {
        setChangeKeyError(data.error || 'Failed to change key.');
      }
    } catch {
      setChangeKeyError('Network error. Please try again.');
    } finally {
      setChangeKeyLoading(false);
    }
  };

  // --- Phase 2: Restore version via socket ---
  const handleRestoreVersion = (versionId) => {
    socketRef.current?.emit('restore version', { projectName, versionId });
  };

  // --- Gating overlay inputs handler ---
  const handleOverlayJoinSubmit = (room, key) => {
    sessionStorage.setItem(`accesskey_project_${projectName}`, key);
    setCookie(`accesskey_project_${projectName}`, key);
    if (socketRef.current) {
      const savedOwnerToken = localStorage.getItem(`owner_token_${projectName}`) || '';
      socketRef.current.emit('join project', {
        projectName,
        accessKey: key,
        ownerToken: savedOwnerToken
      });
    }
  };

  // --- Smart Notes Handlers ---

  const handleAddNote = () => {
    const newNote = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 9),
      content: '# New Note\nWrite content here...',
      updatedAt: Date.now(),
      color: ['#A93F55', '#3B7A57', '#8F6BBF', '#D97A53', '#4A7C59', '#61A5C2', '#D9A05B'][Math.floor(Math.random() * 7)]
    };
    const updatedNotes = [newNote, ...notes];
    setNotes(updatedNotes);
    setActiveNoteId(newNote.id);
    socketRef.current?.emit('notes update', { projectName, notes: JSON.stringify(updatedNotes) });
  };

  const handleEditNoteContent = (content) => {
    const updatedNotes = notes.map(n => {
      if (n.id === activeNoteId) {
        return { ...n, content, updatedAt: Date.now() };
      }
      return n;
    });
    setNotes(updatedNotes);
    socketRef.current?.emit('notes update', { projectName, notes: JSON.stringify(updatedNotes) });
  };

  const handleDeleteNote = (noteId) => {
    if (!window.confirm('Delete this note?')) return;
    const updatedNotes = notes.filter(n => n.id !== noteId);
    setNotes(updatedNotes);
    if (activeNoteId === noteId) {
      setActiveNoteId(updatedNotes[0]?.id || null);
    }
    socketRef.current?.emit('notes update', { projectName, notes: JSON.stringify(updatedNotes) });
  };

  const handleAiOrganizeNote = async (noteId) => {
    const note = notes.find(n => n.id === noteId);
    if (!note || !note.content.trim()) return;

    setIsFormattingAi(true);
    try {
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Please format the following notes raw text to arrange headings, title, and bullet points cleanly. Arrange heading title content nicely. Output ONLY the formatted text with no introduction or markdown outer code fences:\n\n${note.content}`,
          history: []
        })
      });
      const data = await response.json();
      if (response.ok && data.response) {
        let cleanText = data.response;
        // Strip out triple-backtick markdown blocks if Gemini includes them
        cleanText = cleanText.replace(/^```markdown\n/, '').replace(/^```\n?/, '').replace(/```$/, '').trim();
        handleEditNoteContent(cleanText);
      } else {
        alert('AI format failed: ' + (data.error || 'Server error'));
      }
    } catch (err) {
      console.error(err);
      alert('AI format failed. Connection error.');
    } finally {
      setIsFormattingAi(false);
    }
  };

  const getNoteTitle = (content) => {
    const firstLine = content.split('\n')[0]?.trim();
    if (!firstLine) return 'Untitled Note';
    return firstLine.replace(/^#+\s+/, '');
  };

  const getNotePreview = (content) => {
    const lines = content.split('\n');
    const nonTitleLines = lines.slice(1).map(l => l.trim()).filter(l => l.length > 0);
    const preview = nonTitleLines.join(' ');
    if (preview.length > 60) return preview.substring(0, 60) + '...';
    return preview || 'Empty note content...';
  };

  const parseSmartNotes = (rawText) => {
    if (!rawText) return { title: 'Untitled Note', sections: [] };

    const lines = rawText.split('\n');
    let title = '';
    const sections = [];
    let currentSection = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Check if it's the title (first non-empty line)
      if (!title) {
        if (line.startsWith('# ')) {
          title = line.substring(2).trim();
        } else {
          title = line;
        }
        continue;
      }

      // Parse headings
      if (line.startsWith('# ') || line.startsWith('## ') || line.startsWith('### ')) {
        if (currentSection) {
          sections.push(currentSection);
        }
        const headingText = line.replace(/^#+\s+/, '');
        currentSection = {
          type: 'section',
          heading: headingText,
          items: []
        };
      } else {
        if (!currentSection) {
          currentSection = {
            type: 'intro',
            heading: '',
            items: []
          };
        }

        // Check if it's a list item
        if (line.startsWith('- ') || line.startsWith('* ') || line.startsWith('• ')) {
          currentSection.items.push({
            type: 'list-item',
            text: line.substring(2).trim()
          });
        } else if (/^\d+\.\s+/.test(line)) {
          const itemText = line.replace(/^\d+\.\s+/, '');
          currentSection.items.push({
            type: 'list-item',
            text: itemText,
            ordered: true
          });
        } else {
          currentSection.items.push({
            type: 'paragraph',
            text: line
          });
        }
      }
    }

    if (currentSection) {
      sections.push(currentSection);
    }

    return {
      title: title || 'Untitled Note',
      sections
    };
  };

  // --- Manual Code Save Handler ---
  const handleSaveCodeSnapshot = () => {
    if (!socketRef.current) return;
    const comment = saveCodeComment.trim().slice(0, 100);
    socketRef.current.emit('save version', {
      projectName,
      type: 'code',
      content: codeContent,
      language: codeLanguage,
      comment
    });
    setShowSaveCodeModal(false);
    setSaveCodeComment('');
  };

  return (
    <div className="project-page">
      {showOverlay && (
        <AccessKeyModal
          title="Project Verification"
          subtitle={`Please enter the access key to collaborate on: ${projectName}`}
          errorMessage={overlayError}
          onSubmit={handleOverlayJoinSubmit}
        />
      )}

      {/* Version History Panel (slide-in from right) */}
      {showVersionPanel && (
        <VersionHistoryPanel
          projectName={projectName}
          type={versionPanelType}
          socket={socketRef.current}
          isOwner={isOwner}
          onClose={() => setShowVersionPanel(false)}
        />
      )}

      {/* Change Access Key Modal */}
      {showChangeKeyModal && (
        <div className="chat-lightbox" onClick={() => setShowChangeKeyModal(false)}>
          <div className="share-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="share-modal-header">
              <h3><KeyRound size={16} style={{ marginRight: '8px' }} />Change Access Key</h3>
              <button onClick={() => setShowChangeKeyModal(false)}><X size={18} /></button>
            </div>
            <p className="share-modal-subtitle">
              Set a new access key for <strong>{projectName}</strong>. All current members will need the new key to re-enter.
            </p>
            {changeKeyError && (
              <div style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: '10px', padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: '6px' }}>
                ⚠️ {changeKeyError}
              </div>
            )}
            <div className="share-modal-url-row">
              <input
                type="password"
                className="share-modal-url-input"
                placeholder="New access key (min 4 chars)"
                value={newKeyInput}
                onChange={e => setNewKeyInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleChangeKey()}
                autoFocus
              />
              <button
                className="share-copy-btn"
                onClick={handleChangeKey}
                disabled={changeKeyLoading}
              >
                {changeKeyLoading ? '…' : <><Check size={14} /> Save</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Code Modal */}
      {showSaveCodeModal && (
        <div className="chat-lightbox" onClick={() => setShowSaveCodeModal(false)}>
          <div className="share-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="share-modal-header">
              <h3>💾 Save Code Version</h3>
              <button onClick={() => setShowSaveCodeModal(false)}><X size={18} /></button>
            </div>
            <p className="share-modal-subtitle">
              Enter a comment/description to save a snapshot of the current code.
            </p>
            <div className="share-modal-url-row">
              <input
                type="text"
                className="share-modal-url-input"
                placeholder="Description (e.g., alpha release, fix bug)"
                value={saveCodeComment}
                onChange={e => setSaveCodeComment(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveCodeSnapshot()}
                autoFocus
                maxLength={100}
              />
              <button
                className="share-copy-btn"
                onClick={handleSaveCodeSnapshot}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Snippet Modal */}
      {showAddSnippetModal && (
        <div className="snippet-modal-overlay" onClick={() => setShowAddSnippetModal(false)}>
          <div className="snippet-modal" onClick={e => e.stopPropagation()}>
            <div className="snippet-modal-header">
              <h3>💾 Save Code Snippet</h3>
              <button className="snippet-modal-close" onClick={() => setShowAddSnippetModal(false)}>
                <X size={18} />
              </button>
            </div>
            
            <div className="poll-input-group">
              <label>Snippet Title</label>
              <input
                type="text"
                placeholder="e.g. Debounce Utility, API helper"
                value={newSnippetTitle}
                onChange={e => setNewSnippetTitle(e.target.value)}
              />
            </div>
            
            <div className="poll-input-group">
              <label>Programming Language</label>
              <select
                value={newSnippetLang}
                onChange={e => setNewSnippetLang(e.target.value)}
              >
                <option value="javascript">JavaScript</option>
                <option value="html">HTML</option>
                <option value="css">CSS</option>
                <option value="python">Python</option>
                <option value="java">Java</option>
                <option value="cpp">C++</option>
              </select>
            </div>
            
            <div className="poll-input-group">
              <label>Snippet Code</label>
              <textarea
                style={{
                  width: '100%',
                  height: '150px',
                  fontFamily: 'monospace',
                  fontSize: '0.85rem',
                  padding: '10px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'rgba(0,0,0,0.02)',
                  color: 'var(--text-color)',
                  resize: 'vertical'
                }}
                placeholder="Paste your snippet code here..."
                value={newSnippetCode}
                onChange={e => setNewSnippetCode(e.target.value)}
              />
            </div>
            
            <button
              className="create-poll-submit-btn"
              onClick={() => {
                if (!newSnippetTitle.trim()) return alert('Please enter a snippet title');
                if (!newSnippetCode.trim()) return alert('Please enter snippet code');
                
                const newSnippet = {
                  id: 'snippet_' + Math.random().toString(36).substr(2, 9),
                  title: newSnippetTitle,
                  code: newSnippetCode,
                  language: newSnippetLang,
                  createdAt: Date.now()
                };
                
                const updated = [newSnippet, ...snippets];
                setSnippets(updated);
                socketRef.current?.emit('update snippets', { projectName, snippets: JSON.stringify(updated) });
                addTimelineEvent(`Saved code snippet: "${newSnippetTitle}"`);
                
                setNewSnippetTitle('');
                setNewSnippetCode('');
                setNewSnippetLang('javascript');
                setShowAddSnippetModal(false);
                setSelectedSnippetId(newSnippet.id);
              }}
            >
              Save Snippet
            </button>
          </div>
        </div>
      )}

      <main className="project-editor-wrapper">
        {/* Share / Invite Modal */}
        {showShareModal && (
          <div className="chat-lightbox" onClick={() => setShowShareModal(false)}>
            <div className="share-modal" onClick={e => e.stopPropagation()}>
              <div className="share-modal-header">
                <h3>🔗 Invite to Project</h3>
                <button onClick={() => setShowShareModal(false)}><X size={18} /></button>
              </div>
              <p className="share-modal-subtitle">
                Share this link to invite others to <strong>{projectName}</strong>.
                <span className="share-modal-warning">⚠️ Anyone with this link can join — share privately.</span>
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                <canvas id="project-share-qr" style={{ borderRadius: '8px' }} />
              </div>
              <div className="share-modal-url-row">
                <input
                  type="text"
                  className="share-modal-url-input"
                  value={`${window.location.origin}/projects/${encodeURIComponent(projectName)}`}
                  readOnly
                  onClick={e => e.target.select()}
                />
                <button
                  className="share-copy-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/projects/${encodeURIComponent(projectName)}`);
                  }}
                >
                  <Copy size={14} /> Copy
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="collaboration-editor">
          <div className="workspace-header-bar">
            <div className="workspace-title-area">
              <div className="workspace-title-text-group">
                <h2>Project: {projectName}</h2>
                
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
                    <button
                      className="nickname-edit-trigger"
                      onClick={() => { setNicknameInput(username); setIsEditingNickname(true); }}
                      title="Change your nickname"
                    >
                      <Pencil size={10} />
                      <span className="nickname-display">{username}</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="workspace-title-actions">
                <button
                  onClick={() => setShowShareModal(true)}
                  className="workspace-tour-trigger-btn"
                  title="Share invite link"
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Link size={13} /> <span className="btn-text">Share</span>
                </button>
                <button
                  onClick={() => setTourStep(0)}
                  className="workspace-tour-trigger-btn"
                  title="Start Room Tour"
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <HelpCircle size={13} /> <span className="btn-text">Tour Guide</span>
                </button>
                <button
                  onClick={handleLeaveRoom}
                  className="workspace-tour-trigger-btn"
                  title={standaloneMode ? "Leave this board session" : "Leave this project workspace"}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: '#e05252', color: 'white' }}
                >
                  <LogOut size={13} /> <span className="btn-text">{standaloneMode ? "Leave Board" : "Leave Workspace"}</span>
                </button>
              </div>
            </div>

            {/* Show tab buttons only if not in standalone (document.html / code.html) mode */}
            {!standaloneMode && (
              <div className="workspace-tabs">
                <button
                  className={`tab-btn ${activeTab === 'sketch' ? 'active' : ''}`}
                  onClick={() => setActiveTab('sketch')}
                >
                  <Palette size={16} />
                  <span className="tab-text">Sketch Board</span>
                </button>
                <button
                  className={`tab-btn ${activeTab === 'document' ? 'active' : ''}`}
                  onClick={() => setActiveTab('document')}
                >
                  <FileText size={16} />
                  <span className="tab-text">Document Board</span>
                </button>
                <button
                  className={`tab-btn ${activeTab === 'code' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab('code');
                    setTimeout(() => {
                      // Trigger monaco layout adjustment
                      window.dispatchEvent(new Event('resize'));
                    }, 100);
                  }}
                >
                  <Code2 size={16} />
                  <span className="tab-text">Coding Board</span>
                </button>
                <button
                  className={`tab-btn ${activeTab === 'notes' ? 'active' : ''}`}
                  onClick={() => setActiveTab('notes')}
                >
                  <FileText size={16} />
                  <span className="tab-text">Smart Notes</span>
                </button>
                <button
                  className={`tab-btn ${activeTab === 'polls' ? 'active' : ''}`}
                  onClick={() => setActiveTab('polls')}
                >
                  <BarChart3 size={16} />
                  <span className="tab-text">Polls</span>
                </button>
                <button
                  className={`tab-btn ${activeTab === 'snippets' ? 'active' : ''}`}
                  onClick={() => setActiveTab('snippets')}
                >
                  <Save size={16} />
                  <span className="tab-text">Snippets</span>
                </button>
                <button
                  className={`tab-btn ${activeTab === 'timeline' ? 'active' : ''}`}
                  onClick={() => setActiveTab('timeline')}
                >
                  <Clock size={16} />
                  <span className="tab-text">Timeline</span>
                </button>
              </div>
            )}
          </div>

          <div className="workspace-panes">
            {/* 1. Whiteboard Pane */}
            <div id="pane-sketch" className={`workspace-pane ${activeTab === 'sketch' ? 'active' : ''}`}>
              <div className="whiteboard-controls">
                <button
                  className={drawingTool === 'pen' ? 'active' : ''}
                  onClick={() => setDrawingTool('pen')}
                >
                  ✏️ Pen
                </button>
                <button
                  className={drawingTool === 'eraser' ? 'active' : ''}
                  onClick={() => setDrawingTool('eraser')}
                >
                  🧼 Eraser
                </button>
                <button
                  className={drawingTool === 'select' ? 'active' : ''}
                  onClick={() => setDrawingTool('select')}
                >
                  🖐️ Select
                </button>
                <button onClick={addRect}>🟩 Rect</button>
                <button onClick={addCircle}>⭕ Circle</button>
                <button onClick={addTriangle}>🔺 Triangle</button>
                <button onClick={addLine}>➖ Line</button>
                <button onClick={deleteSelected} title="Delete Selected Shape">✂️ Cut</button>
                <button onClick={handleUndo} title="Undo">↩️ Undo</button>
                <button onClick={handleRedo} title="Redo">↪️ Redo</button>
                <label>
                  Brush width:
                  <input
                    type="range"
                    min="1"
                    max="30"
                    value={brushWidth}
                    onChange={(e) => setBrushWidth(parseInt(e.target.value))}
                  />
                </label>
                <label>
                  Color:
                  <input
                    type="color"
                    value={brushColor}
                    onChange={(e) => setBrushColor(e.target.value)}
                  />
                </label>
                <button onClick={clearWhiteboard} title="Clear Drawing Board">
                  <Trash2 size={14} /> Clear
                </button>
                <button onClick={exportWhiteboard} title="Export Whiteboard JSON">
                  <Download size={14} /> Export
                </button>
              </div>
              <div className="whiteboard-canvas-wrapper">
                <canvas ref={canvasRef} />
              </div>
            </div>

            {/* 2. Document Board (TinyMCE) Pane */}
            <div id="pane-document" className={`workspace-pane ${activeTab === 'document' ? 'active' : ''}`}>
              {/* Owner toolbar row */}
              {isOwner && (
                <div className="board-owner-toolbar">
                  <button
                    className="board-owner-btn"
                    onClick={() => { setVersionPanelType('document'); setShowVersionPanel(true); }}
                    title="View document version history"
                  >
                    <History size={13} /> Version History
                  </button>
                  <button
                    className="board-owner-btn board-owner-btn-danger"
                    onClick={() => setShowChangeKeyModal(true)}
                    title="Change the access key for this project"
                  >
                    <KeyRound size={13} /> Change Key
                  </button>
                </div>
              )}
              <TinyMCEEditor
                tinymceScriptSrc="https://cdnjs.cloudflare.com/ajax/libs/tinymce/6.8.2/tinymce.min.js"
                onInit={(evt, editor) => {
                  tinymceRef.current = editor;
                  if (docContent) {
                    editor.setContent(docContent);
                  }
                }}
                value={docContent}
                onEditorChange={handleDocChange}
                init={{
                  height: 600,
                  menubar: false,
                  plugins: [
                    'advlist', 'autolink', 'lists', 'link', 'image', 'charmap', 'preview',
                    'anchor', 'searchreplace', 'visualblocks', 'code', 'fullscreen',
                    'insertdatetime', 'media', 'table', 'code', 'help', 'wordcount', 'emoticons'
                  ],
                  toolbar: 'undo redo | blocks | bold italic backcolor | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | removeformat | table emoticons code fullscreen | uploadimage uploadfile',
                  skin: theme === 'dark' ? 'oxide-dark' : 'oxide',
                  content_css: theme === 'dark' ? 'dark' : 'default',
                  branding: false,
                  promotion: false,
                  setup: (editor) => {
                    editor.ui.registry.addButton('uploadfile', {
                      tooltip: 'Upload Document / File',
                      icon: 'upload',
                      onAction: () => {
                        const input = document.createElement('input');
                        input.setAttribute('type', 'file');
                        input.setAttribute('accept', '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt');
                        input.onchange = function () {
                          const file = this.files[0];
                          if (!file) return;
                          const formData = new FormData();
                          formData.append('file', file);

                          editor.setProgressState(true);
                          fetch('/upload', {
                            method: 'POST',
                            body: formData
                          })
                            .then(res => res.json())
                            .then(json => {
                              editor.setProgressState(false);
                              editor.selection.collapse(false);
                              editor.insertContent(`<a href="${json.location}" target="_blank" download="${file.name}" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--light-color); color: var(--text-color); font-weight: 700; text-decoration: none; margin: 4px 0;">📎 Download ${file.name}</a>&nbsp;`);
                              onUploadSuccess(file.name, json.location);
                            })
                            .catch(err => {
                              editor.setProgressState(false);
                              console.error('File upload failed:', err);
                              alert('Upload failed: ' + err.message);
                            });
                        };
                        input.click();
                      }
                    });

                    editor.ui.registry.addButton('uploadimage', {
                      tooltip: 'Upload Image',
                      icon: 'image',
                      onAction: () => {
                        const input = document.createElement('input');
                        input.setAttribute('type', 'file');
                        input.setAttribute('accept', 'image/*');
                        input.onchange = function () {
                          const file = this.files[0];
                          if (!file) return;
                          const formData = new FormData();
                          formData.append('file', file);

                          editor.setProgressState(true);
                          fetch('/upload', {
                            method: 'POST',
                            body: formData
                          })
                            .then(res => res.json())
                            .then(json => {
                              editor.setProgressState(false);
                              editor.selection.collapse(false);
                              editor.insertContent(`<img src="${json.location}" alt="${file.name}" style="max-width: 100%; height: auto; border-radius: 8px; margin: 10px 0;" />&nbsp;`);
                              onUploadSuccess(file.name, json.location);
                            })
                            .catch(err => {
                              editor.setProgressState(false);
                              console.error('Image upload failed:', err);
                              alert('Upload failed: ' + err.message);
                            });
                        };
                        input.click();
                      }
                    });
                  },
                  images_upload_handler: (blobInfo) => new Promise((resolve, reject) => {
                    const formData = new FormData();
                    formData.append('file', blobInfo.blob(), blobInfo.filename());

                    fetch('/upload', {
                      method: 'POST',
                      body: formData
                    })
                      .then(res => {
                        if (!res.ok) throw new Error('HTTP error ' + res.status);
                        return res.json();
                      })
                      .then(json => {
                        if (!json || typeof json.location !== 'string') throw new Error('Invalid response');
                        resolve(json.location);
                        onUploadSuccess(blobInfo.filename(), json.location);
                      })
                      .catch(err => {
                        reject('Upload failed: ' + err.message);
                      });
                  }),
                  file_picker_callback: (callback, value, meta) => {
                    const input = document.createElement('input');
                    input.setAttribute('type', 'file');

                    if (meta.filetype === 'image') {
                      input.setAttribute('accept', 'image/*');
                    } else {
                      input.setAttribute('accept', '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt');
                    }

                    input.onchange = function () {
                      const file = this.files[0];
                      const formData = new FormData();
                      formData.append('file', file);

                      fetch('/upload', {
                        method: 'POST',
                        body: formData
                      })
                        .then(res => res.json())
                        .then(json => {
                          callback(json.location, { text: file.name, title: file.name });
                          onUploadSuccess(file.name, json.location);
                        })
                        .catch(err => {
                          console.error('File upload failed:', err);
                        });
                    };

                    input.click();
                  }
                }}
              />

              {/* Attachments Panel */}
              <div className="attachments-panel">
                <div className="attachments-header">
                  <h3 className="attachments-title">
                    <FileText size={18} />
                    <span>Project Attachments</span>
                  </h3>
                  <div className="attachments-actions">
                    <label className="upload-btn-label">
                      <span>Upload File</span>
                      <input
                        type="file"
                        onChange={handleAttachmentUpload}
                        style={{ display: 'none' }}
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,image/*"
                      />
                    </label>
                  </div>
                </div>

                {attachments.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>No files attached yet. Upload files to collaborate.</p>
                ) : (
                  <div className="attachments-list">
                    {attachments.map((file, idx) => {
                      const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file.name);
                      const isPdf = /\.pdf$/i.test(file.name);
                      return (
                        <div key={idx} className="attachment-card">
                          <div className="attachment-info">
                            <div className="attachment-icon-wrapper">
                              {isImage ? '🖼️' : isPdf ? '📄' : '📁'}
                            </div>
                            <div className="attachment-details">
                              <a
                                href={file.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="attachment-name"
                                title={file.name}
                              >
                                {file.name}
                              </a>
                              <span className="attachment-meta">
                                {new Date(file.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </div>
                          <div className="attachment-buttons">
                            <a
                              href={file.url}
                              download={file.name}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="attachment-action-btn download-btn"
                              title="Download File"
                            >
                              <Download size={14} />
                              <span className="attachment-btn-text">Download</span>
                            </a>
                            {isOwner && (
                              <button
                                onClick={() => setDeleteConfirmFile(file)}
                                className="attachment-action-btn delete-btn"
                                title="Delete File"
                              >
                                <Trash2 size={14} />
                                <span className="attachment-btn-text">Delete</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* 3. Coding Board (Monaco) Pane */}
            <div id="pane-code" className={`workspace-pane ${activeTab === 'code' ? 'active' : ''}`}>
              <div className="code-controls">
                <label>
                  Language:
                  <select value={codeLanguage} onChange={handleLanguageChange}>
                    <option value="javascript">JavaScript</option>
                    <option value="typescript">TypeScript</option>
                    <option value="python">Python</option>
                    <option value="html">HTML</option>
                    <option value="css">CSS</option>
                    <option value="cpp">C++</option>
                    <option value="java">Java</option>
                    <option value="json">JSON</option>
                  </select>
                </label>
                <div className="code-controls-actions">
                  <button
                    className="board-owner-btn"
                    onClick={() => { setShowSaveCodeModal(true); }}
                    title="Save current code to history"
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--primary-light)', color: 'var(--primary-color)' }}
                  >
                    💾 Save Code
                  </button>
                  <button
                    className="board-owner-btn"
                    onClick={() => { setVersionPanelType('code'); setShowVersionPanel(true); }}
                    title="View code version history"
                    style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    🕒 History
                  </button>
                  <button
                    className={`run-code-btn ${isRunning ? 'loading' : ''}`}
                    onClick={handleRunCode}
                    disabled={isRunning}
                    title="Execute Code (Ctrl + Enter)"
                  >
                    {isRunning ? '⏳ Running...' : '▶️ Run Code'}
                  </button>
                  <button
                    className="terminal-toggle-btn"
                    onClick={() => {
                      setTerminalOpen(prev => !prev);
                      if (!terminalOpen && codeLanguage === 'html') setShowPreview(true);
                    }}
                    title="Toggle Console Output"
                  >
                    Console {terminalOpen ? '▼' : '▲'}
                  </button>
                </div>
              </div>

              <div className="code-workspace-split">
                <div className="editor-pane">
                  <Editor
                    height={isMobile ? (terminalOpen ? "280px" : "400px") : (terminalOpen ? "380px" : "560px")}
                    language={codeLanguage}
                    theme={theme === 'dark' ? 'vs-dark' : 'vs'}
                    value={codeContent}
                    onChange={handleCodeChange}
                    onMount={(editor, monaco) => {
                      monacoRef.current = editor;
                      // Bind Cmd/Ctrl + Enter shortcut to run compilation directly from editor
                      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                        if (handleRunCodeRef.current) handleRunCodeRef.current();
                      });
                    }}
                    options={{
                      fontSize: 14,
                      fontFamily: "'JetBrains Mono', Courier, monospace",
                      minimap: { enabled: true },
                      lineNumbers: 'on',
                      roundedSelection: true,
                      scrollBeyondLastLine: false,
                      cursorBlinking: 'smooth',
                      cursorSmoothCaretAnimation: 'on',
                      automaticLayout: true
                    }}
                  />
                </div>

                {terminalOpen && (
                  <div className="terminal-pane">
                    <div className="terminal-header">
                      <span className="terminal-title">
                        {codeLanguage === 'html' ? 'Live Preview Canvas' : 'Console Terminal Output'}
                      </span>
                      <div className="terminal-actions">
                        <button
                          onClick={() => {
                            if (codeLanguage === 'html') {
                              setShowPreview(false);
                              setTimeout(() => setShowPreview(true), 50);
                            } else {
                              setTerminalOutput('');
                            }
                          }}
                        >
                          Clear
                        </button>
                        <button onClick={() => setTerminalOpen(false)}>Close</button>
                      </div>
                    </div>
                    <div className="terminal-body">
                      {codeLanguage === 'html' && showPreview ? (
                        <iframe
                          srcDoc={codeContent}
                          title="HTML Live Preview"
                          sandbox="allow-scripts"
                          className="html-live-iframe"
                        />
                      ) : (
                        <pre className="terminal-pre">{terminalOutput || 'Click "Run" to execute the code...'}</pre>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 4. Smart Notes Pane */}
            <div id="pane-notes" className={`workspace-pane ${activeTab === 'notes' ? 'active' : ''}`}>
              <div className="smart-notes-workspace">
                {/* Notes list sidebar */}
                <div className="notes-sidebar">
                  <div className="notes-sidebar-header">
                    <button className="add-note-btn" onClick={handleAddNote}>
                      ➕ Add Note
                    </button>
                    <input
                      type="text"
                      className="notes-search-input"
                      placeholder="Search notes..."
                      value={notesSearch}
                      onChange={e => setNotesSearch(e.target.value)}
                    />
                  </div>
                  <div className="notes-list">
                    {notes.filter(n => {
                      const title = getNoteTitle(n.content).toLowerCase();
                      const body = n.content.toLowerCase();
                      const q = notesSearch.toLowerCase();
                      return title.includes(q) || body.includes(q);
                    }).length === 0 ? (
                      <p className="no-notes-placeholder">No notes found.</p>
                    ) : (
                      notes.filter(n => {
                        const title = getNoteTitle(n.content).toLowerCase();
                        const body = n.content.toLowerCase();
                        const q = notesSearch.toLowerCase();
                        return title.includes(q) || body.includes(q);
                      }).map(n => (
                        <div
                          key={n.id}
                          className={`note-list-item ${n.id === activeNoteId ? 'active' : ''}`}
                          style={{ borderLeftColor: n.color }}
                          onClick={() => setActiveNoteId(n.id)}
                        >
                          <div className="note-item-header">
                            <span className="note-item-title">{getNoteTitle(n.content)}</span>
                            <button
                              className="note-delete-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteNote(n.id);
                              }}
                              title="Delete Note"
                            >
                              🗑️
                            </button>
                          </div>
                          <span className="note-item-preview">{getNotePreview(n.content)}</span>
                          <span className="note-item-date">
                            {new Date(n.updatedAt).toLocaleDateString()} {new Date(n.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Active Note Editor & Preview */}
                <div className="note-detail-pane">
                  {activeNoteId ? (
                    (() => {
                      const activeNote = notes.find(n => n.id === activeNoteId);
                      if (!activeNote) return null;
                      const parsed = parseSmartNotes(activeNote.content);
                      return (
                        <div className="active-note-layout">
                          {/* Note toolbar */}
                          <div className="note-toolbar">
                            <span className="note-toolbar-status">
                              Last updated: {new Date(activeNote.updatedAt).toLocaleTimeString()}
                            </span>
                            <button
                              className={`note-ai-btn ${isFormattingAi ? 'loading' : ''}`}
                              onClick={() => handleAiOrganizeNote(activeNote.id)}
                              disabled={isFormattingAi}
                              title="AI Organize and Format using Gemini"
                            >
                              {isFormattingAi ? '⏳ Organizing...' : '🤖 AI Organize'}
                            </button>
                          </div>

                          <div className="note-split-view">
                            {/* Editor Panel */}
                            <div className="note-editor-panel">
                              <textarea
                                className="note-textarea"
                                value={activeNote.content}
                                onChange={e => handleEditNoteContent(e.target.value)}
                                placeholder="Type your note here... The first line becomes the title. Use # for headings, - for lists."
                              />
                            </div>

                            {/* Beautiful Formatted Panel */}
                            <div className="note-formatted-panel">
                              <div className="note-formatted-card" style={{ borderTop: `6px solid ${activeNote.color}` }}>
                                <h1 className="note-title-render">{parsed.title}</h1>
                                <div className="note-content-render">
                                  {parsed.sections.map((sect, sIdx) => (
                                    <div key={sIdx} className="note-section-render">
                                      {sect.heading && (
                                        <h2 className="note-heading-render">{sect.heading}</h2>
                                      )}
                                      <div className="note-items-render">
                                        {sect.items.map((item, iIdx) => {
                                          if (item.type === 'list-item') {
                                            return (
                                              <div key={iIdx} className="note-list-item-render">
                                                <span className="note-bullet">
                                                  {item.ordered ? '▪' : '•'}
                                                </span>
                                                <span className="note-list-text">{item.text}</span>
                                              </div>
                                            );
                                          } else {
                                            return (
                                              <p key={iIdx} className="note-paragraph-render">
                                                {item.text}
                                              </p>
                                            );
                                          }
                                        })}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="note-empty-state">
                      <span>📝</span>
                      <h3>Smart Collaborative Notes</h3>
                      <p>Create notes, organize ideas, and see them format instantly. All changes are synced in real-time with other developers.</p>
                      <button className="add-note-btn" onClick={handleAddNote} style={{ width: 'auto', padding: '10px 20px' }}>
                        Create your first note
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 5. Polls Pane */}
            <div id="pane-polls" className={`workspace-pane ${activeTab === 'polls' ? 'active' : ''}`}>
              <div className="polls-workspace">
                <div className="poll-creator-panel">
                  <h3>📊 Create a New Poll</h3>
                  <div className="poll-input-group">
                    <label>Question / Topic</label>
                    <input
                      type="text"
                      placeholder="e.g., Which UI framework should we use?"
                      value={newPollQuestion}
                      onChange={e => setNewPollQuestion(e.target.value)}
                    />
                  </div>
                  <div className="poll-input-group">
                    <label>Options</label>
                    {newPollOptions.map((opt, index) => (
                      <div key={index} className="poll-option-row">
                        <input
                          type="text"
                          placeholder={`Option ${index + 1}`}
                          value={opt}
                          onChange={e => {
                            const updated = [...newPollOptions];
                            updated[index] = e.target.value;
                            setNewPollOptions(updated);
                          }}
                        />
                        {newPollOptions.length > 2 && (
                          <button
                            type="button"
                            className="remove-option-btn"
                            onClick={() => {
                              const updated = newPollOptions.filter((_, i) => i !== index);
                              setNewPollOptions(updated);
                            }}
                          >
                            ❌
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      className="add-option-btn"
                      onClick={() => setNewPollOptions([...newPollOptions, ''])}
                    >
                      ➕ Add Option
                    </button>
                  </div>
                  <div className="poll-input-group">
                    <label>Expiration (Minutes)</label>
                    <select
                      value={pollExpirationMinutes}
                      onChange={e => setPollExpirationMinutes(Number(e.target.value))}
                    >
                      <option value={5}>5 Minutes</option>
                      <option value={15}>15 Minutes</option>
                      <option value={60}>1 Hour</option>
                      <option value={1440}>24 Hours</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    className="create-poll-submit-btn"
                    onClick={() => {
                      if (!newPollQuestion.trim()) return alert('Please enter a question');
                      const filteredOpts = newPollOptions.filter(o => o.trim() !== '');
                      if (filteredOpts.length < 2) return alert('Please provide at least 2 options');
                      
                      const newPoll = {
                        id: 'poll_' + Math.random().toString(36).substr(2, 9),
                        question: newPollQuestion,
                        options: filteredOpts.map(text => ({ text, votes: 0 })),
                        createdAt: Date.now(),
                        expiresAt: Date.now() + (pollExpirationMinutes * 60 * 1000)
                      };
                      
                      const updatedPolls = [newPoll, ...polls];
                      setPolls(updatedPolls);
                      socketRef.current?.emit('update polls', { projectName, polls: JSON.stringify(updatedPolls) });
                      addTimelineEvent(`Created poll: "${newPollQuestion}"`);
                      setNewPollQuestion('');
                      setNewPollOptions(['', '']);
                    }}
                  >
                    Create Poll
                  </button>
                </div>

                <div className="polls-list-panel">
                  <h3>Active Polls ({polls.length})</h3>
                  {polls.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No polls created yet.</p>
                  ) : (
                    polls.map(poll => {
                      const hasVotedList = JSON.parse(localStorage.getItem(`anonhub_voted_polls_${projectName}`) || '[]');
                      const hasVoted = hasVotedList.includes(poll.id);
                      const isExpired = Date.now() > poll.expiresAt;
                      const showResults = hasVoted || isExpired;
                      const totalVotes = poll.options.reduce((sum, opt) => sum + opt.votes, 0);

                      return (
                        <div key={poll.id} className="poll-card">
                          <div className="poll-card-header">
                            <h4 className="poll-question">{poll.question}</h4>
                            <span className="poll-meta-badge">
                              {isExpired ? 'Expired' : 'Active'}
                            </span>
                          </div>
                          
                          <div className="poll-options-list">
                            {poll.options.map((opt, oIdx) => {
                              const pct = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
                              return (
                                <div key={oIdx} className="poll-option-item">
                                  <div className="poll-option-info">
                                    <span>{opt.text}</span>
                                    {showResults && (
                                      <span>{opt.votes} votes ({pct}%)</span>
                                    )}
                                  </div>
                                  {showResults ? (
                                    <div className="poll-option-bar-container">
                                      <div className="poll-option-bar" style={{ width: `${pct}%` }}></div>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      className="poll-vote-btn"
                                      onClick={() => {
                                        const updatedPolls = polls.map(p => {
                                          if (p.id === poll.id) {
                                            const updatedOpts = p.options.map((o, idx) => {
                                              if (idx === oIdx) return { ...o, votes: o.votes + 1 };
                                              return o;
                                            });
                                            return { ...p, options: updatedOpts };
                                          }
                                          return p;
                                        });
                                        setPolls(updatedPolls);
                                        socketRef.current?.emit('update polls', { projectName, polls: JSON.stringify(updatedPolls) });
                                        
                                        const newVotedList = [...hasVotedList, poll.id];
                                        localStorage.setItem(`anonhub_voted_polls_${projectName}`, JSON.stringify(newVotedList));
                                        addTimelineEvent(`Voted in poll: "${poll.question}"`);
                                      }}
                                    >
                                      Vote
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          <div className="poll-card-footer">
                            <span>Total Votes: {totalVotes}</span>
                            <span>
                              {isExpired
                                ? `Ended on ${new Date(poll.expiresAt).toLocaleTimeString()}`
                                : `Expires: ${new Date(poll.expiresAt).toLocaleTimeString()}`
                              }
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* 6. Snippets Pane */}
            <div id="pane-snippets" className={`workspace-pane ${activeTab === 'snippets' ? 'active' : ''}`}>
              <div className="snippets-workspace">
                <div className="snippets-sidebar">
                  <div className="snippets-sidebar-header">
                    <button
                      className="add-snippet-btn"
                      onClick={() => setShowAddSnippetModal(true)}
                    >
                      💾 Save Snippet
                    </button>
                    <input
                      type="text"
                      className="snippets-search-input"
                      placeholder="Search snippets..."
                      value={snippetsSearch}
                      onChange={e => setSnippetsSearch(e.target.value)}
                    />
                    <select
                      className="snippets-filter-select"
                      value={snippetsFilterLang}
                      onChange={e => setSnippetsFilterLang(e.target.value)}
                    >
                      <option value="all">All Languages</option>
                      <option value="javascript">JavaScript</option>
                      <option value="html">HTML</option>
                      <option value="css">CSS</option>
                      <option value="python">Python</option>
                      <option value="java">Java</option>
                      <option value="cpp">C++</option>
                    </select>
                  </div>
                  
                  <div className="snippets-list">
                    {snippets.filter(s => {
                      const matchQuery = s.title.toLowerCase().includes(snippetsSearch.toLowerCase()) ||
                                         s.code.toLowerCase().includes(snippetsSearch.toLowerCase());
                      const matchLang = snippetsFilterLang === 'all' || s.language === snippetsFilterLang;
                      return matchQuery && matchLang;
                    }).length === 0 ? (
                      <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '10px' }}>
                        No snippets found.
                      </p>
                    ) : (
                      snippets.filter(s => {
                        const matchQuery = s.title.toLowerCase().includes(snippetsSearch.toLowerCase()) ||
                                           s.code.toLowerCase().includes(snippetsSearch.toLowerCase());
                        const matchLang = snippetsFilterLang === 'all' || s.language === snippetsFilterLang;
                        return matchQuery && matchLang;
                      }).map(s => (
                        <div
                          key={s.id}
                          className={`snippet-list-item ${s.id === selectedSnippetId ? 'active' : ''}`}
                          onClick={() => setSelectedSnippetId(s.id)}
                        >
                          <span className="snippet-item-title">{s.title}</span>
                          <div className="snippet-item-meta">
                            <span style={{ textTransform: 'uppercase', fontWeight: 700 }}>{s.language}</span>
                            <span>{new Date(s.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="snippet-detail-pane">
                  {selectedSnippetId && snippets.some(s => s.id === selectedSnippetId) ? (
                    (() => {
                      const snippet = snippets.find(s => s.id === selectedSnippetId);
                      return (
                        <>
                          <div className="snippet-detail-header">
                            <h3>{snippet.title}</h3>
                            <div className="snippet-actions-row">
                              <button
                                className="snippet-action-btn primary"
                                onClick={() => handleInsertSnippet(snippet.code)}
                                title="Insert directly at cursor inside Coding Board"
                              >
                                Insert into Editor
                              </button>
                              <button
                                className="snippet-action-btn"
                                onClick={() => {
                                  navigator.clipboard.writeText(snippet.code);
                                  alert('Copied to clipboard!');
                                }}
                              >
                                Copy
                              </button>
                              <button
                                className="snippet-action-btn"
                                onClick={() => {
                                  if (window.confirm('Delete this snippet?')) {
                                    const updated = snippets.filter(s => s.id !== snippet.id);
                                    setSnippets(updated);
                                    socketRef.current?.emit('update snippets', { projectName, snippets: JSON.stringify(updated) });
                                    addTimelineEvent(`Deleted code snippet: "${snippet.title}"`);
                                    setSelectedSnippetId(null);
                                  }
                                }}
                                style={{ color: '#ff4d4f' }}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                          
                          <div className="snippet-code-preview-container">
                            <div className="snippet-code-header">
                              Language: {snippet.language}
                            </div>
                            <pre className="snippet-code-body">
                              <code>{snippet.code}</code>
                            </pre>
                          </div>
                        </>
                      );
                    })()
                  ) : (
                    <div className="snippet-empty-state">
                      <span>💾</span>
                      <h3>Code Snippets Library</h3>
                      <p>Select a snippet from the list, or save a new one to reuse code templates inside your editor.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 7. Timeline Pane */}
            <div id="pane-timeline" className={`workspace-pane ${activeTab === 'timeline' ? 'active' : ''}`}>
              <div className="timeline-workspace">
                <div className="timeline-header">
                  <h3>🕒 Room Activity Timeline</h3>
                  <button
                    className="nickname-save-btn"
                    onClick={() => {
                      setActivityLog([]);
                      alert('Timeline log cleared (locally).');
                    }}
                    style={{ width: 'auto', borderRadius: '6px', padding: '6px 12px', fontSize: '0.8rem' }}
                  >
                    Clear History
                  </button>
                </div>
                
                <div className="timeline-list">
                  {activityLog.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', paddingLeft: '8px' }}>
                      No events logged in this session yet. Events will appear as you edit code, update the whiteboard, or add notes.
                    </p>
                  ) : (
                    activityLog.map((ev, index) => (
                      <div key={index} className="timeline-item">
                        <div className="timeline-node"></div>
                        <span className="timeline-item-content">{ev.text}</span>
                        <span className="timeline-item-time">
                          {new Date(ev.timestamp).toLocaleTimeString()} - {new Date(ev.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Workspace Chat & Users Panel */}
        <aside className={`project-chat-container ${mobileChatOpen ? 'mobile-open' : ''}`}>
          <div className="mobile-chat-close-bar">
            <span>Project Chat & Roster</span>
            <button className="close-mobile-chat-btn" onClick={() => setMobileChatOpen(false)} title="Close Chat">
              <X size={18} />
            </button>
          </div>
          {socketInstance && (
            <WebRTCCallWidget projectName={projectName} socket={socketInstance} username={username} />
          )}
          <div className="panel-section">
            <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '2px solid var(--border-color)', paddingBottom: '10px' }}>
              Project Chat
              <span
                style={{
                  display: 'inline-block',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: '#52c41a'
                }}
                title="Connected"
              ></span>
            </h4>
            <ul ref={chatContainerRef} className="chat-messages" style={{ overflowY: 'auto' }}>
              {chatMessages.map((msg, i) => {
                const isSystem = msg.username === 'System';
                return (
                  <li key={i} className={isSystem ? 'system-message' : ''} style={{ listStyle: 'none' }}>
                    {isSystem ? (
                      <em style={{ color: 'var(--text-muted)' }}>{msg.msg}</em>
                    ) : (
                      <>
                        <strong style={{ color: 'var(--primary-color)' }}>{msg.username}:</strong>{' '}
                        <span>{msg.msg}</span>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            <form className="message-form" onSubmit={handleSendChat}>
              <input
                className="chat-form-control"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Message..."
                autoComplete="off"
              />
              <button type="submit">
                <Send size={12} />
              </button>
            </form>
          </div>

          <div className="panel-section" style={{ maxHeight: '250px' }}>
            <h4 style={{ margin: 0, borderBottom: '2px solid var(--border-color)', paddingBottom: '10px' }}>
              Users in Project ({users.length})
            </h4>
            <ul className="user-list" style={{ marginTop: '10px', maxHeight: '150px', overflowY: 'auto' }}>
              {users.map((u, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', padding: '4px 0' }}>
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: '#52c41a'
                    }}
                  ></span>
                  <span>{u.username} {u.username === username && '(You)'}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </main>

      {deleteConfirmFile && (
        <div className="custom-confirm-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 32, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 99999
        }}>
          <div className="custom-confirm-card" style={{
            background: 'var(--card-background)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '24px',
            maxWidth: '400px',
            width: '90%',
            textAlign: 'center',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)'
          }}>
            <h3 style={{ margin: '0 0 12px 0', color: 'var(--primary-color)', fontSize: '1.25rem' }}>Delete Attachment</h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '0.95rem', color: 'var(--text-color)' }}>Are you sure you want to delete <strong>{deleteConfirmFile.name}</strong> from this project?</p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                onClick={() => setDeleteConfirmFile(null)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'transparent',
                  color: 'var(--text-color)',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (socketRef.current) {
                    socketRef.current.emit('remove attachment', {
                      projectName,
                      fileUrl: deleteConfirmFile.url
                    });
                  }
                  setDeleteConfirmFile(null);
                }}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  background: 'var(--primary-color)',
                  color: '#ffffff',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Tour Tooltip Card */}
      {tourStep >= 0 && steps[tourStep] && (
        <div className={`tour-tooltip-card ${steps[tourStep].class}`}>
          <div className="tour-tooltip-arrow" />
          <div className="tour-tooltip-header">
            <h4>Tour Guide</h4>
            <span className="tour-tooltip-badge">Step {tourStep + 1} of {steps.length}</span>
          </div>
          <div className="tour-tooltip-body">
            <p dangerouslySetInnerHTML={{ __html: steps[tourStep].body }} />
          </div>
          <div className="tour-tooltip-footer">
            <button
              className="tour-skip-btn"
              onClick={() => {
                setTourStep(-1);
                localStorage.setItem(standaloneMode ? `anonhub_standalone_${activeTab}_tour_seen` : 'anonhub_project_tour_seen', 'true');
              }}
            >
              Skip
            </button>
            <button
              className="tour-next-btn"
              onClick={() => {
                if (tourStep < steps.length - 1) {
                  setTourStep(prev => prev + 1);
                } else {
                  setTourStep(-1);
                  localStorage.setItem(standaloneMode ? `anonhub_standalone_${activeTab}_tour_seen` : 'anonhub_project_tour_seen', 'true');
                }
              }}
            >
              {tourStep === steps.length - 1 ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      )}

      {/* Floating Chat Toggle Icon (Mobile Only) */}
      <button
        className="floating-chat-toggle"
        onClick={() => setMobileChatOpen(true)}
        title="Open Chat"
      >
        <MessageSquare size={20} />
      </button>

    </div>
  );
}

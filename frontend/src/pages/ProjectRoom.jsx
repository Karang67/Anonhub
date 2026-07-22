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
import { Palette, FileText, Code2, Trash2, Download, Send, RefreshCw, MessageSquare, X, Link, Copy, Check, History, KeyRound, Pencil, BarChart3, Save, Clock, HelpCircle, LogOut, MousePointer, Square, Circle as CircleIcon, Triangle as TriangleIcon, Minus, Scissors, Undo, Redo, Eraser, Shapes, Diamond, ArrowRight, Star, Heart, Upload } from 'lucide-react';
import { Canvas, Rect, Circle, PencilBrush, Triangle, Line, Polygon, Path } from 'fabric';
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
  const [isOwner, setIsOwner] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayError, setOverlayError] = useState('');

  // Messaging state hooks
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');

  // Rich editors & attachments states
  const [docContent, setDocContent] = useState('');
  const [codeContent, setCodeContent] = useState('// Start coding in VS Code style here...\n');
  const [codeLanguage, setCodeLanguage] = useState('javascript');

  // Upgraded IDE Workspace states
  const [files, setFiles] = useState({
    'README.md': {
      name: 'README.md',
      path: 'README.md',
      content: '# Collaborative Code Workspace\n\nStart editing or create new files!',
      language: 'markdown'
    }
  });
  const [activeFilePath, setActiveFilePath] = useState('README.md');
  const [openTabs, setOpenTabs] = useState(['README.md']);
  const [unsavedFiles, setUnsavedFiles] = useState({});
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [sidebarActiveView, setSidebarActiveView] = useState('explorer');
  const [terminalStdin, setTerminalStdin] = useState('');
  const [terminalStats, setTerminalStats] = useState(null);
  const [terminalIsRunning, setTerminalIsRunning] = useState(false);
  const [editorTheme, setEditorTheme] = useState('vs-dark');
  const [editorFontSize, setEditorFontSize] = useState(14);
  const [editorFontFamily, setEditorFontFamily] = useState("'JetBrains Mono', Consolas, monospace");
  const [editorLineHeight, setEditorLineHeight] = useState(20);
  const [editorWordWrap, setEditorWordWrap] = useState('on');
  const [editorTabSize, setEditorTabSize] = useState(2);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('');
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiMessageInput, setAiMessageInput] = useState('');
  const [aiLogs, setAiLogs] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [projectSearchRegex, setProjectSearchRegex] = useState(false);
  const [projectSearchCase, setProjectSearchCase] = useState(false);
  const [projectSearchWord, setProjectSearchWord] = useState(false);
  const [projectSearchResults, setProjectSearchResults] = useState([]);
  const [presenceCursors, setPresenceCursors] = useState({});

  // Upgraded IDE Advanced feature states
  const [recentFiles, setRecentFiles] = useState([]);
  const [favoriteFiles, setFavoriteFiles] = useState([]);
  const [pinnedTabs, setPinnedTabs] = useState([]);
  const [closedTabsHistory, setClosedTabsHistory] = useState([]);
  const [projectReplaceQuery, setProjectReplaceQuery] = useState('');
  const [editorMinimap, setEditorMinimap] = useState(true);
  const [editorStickyScroll, setEditorStickyScroll] = useState(true);
  const [editorLineNumbers, setEditorLineNumbers] = useState(true);
  const [editorFormatOnSave, setEditorFormatOnSave] = useState(false);
  const [userRole, setUserRole] = useState('Editor'); // 'Owner' | 'Editor' | 'Viewer'
  const [typingUsers, setTypingUsers] = useState({});
  const [outlineSymbols, setOutlineSymbols] = useState([]);
  const [editorMarkers, setEditorMarkers] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [draggedNodePath, setDraggedNodePath] = useState(null);
  const [activeRightClickPath, setActiveRightClickPath] = useState(null);
  const [showRightClickMenu, setShowRightClickMenu] = useState(false);
  const [rightClickMenuPos, setRightClickMenuPos] = useState({ x: 0, y: 0 });
  const [codeReviewMode, setCodeReviewMode] = useState(false);
  const [inlineComments, setInlineComments] = useState({}); // path -> array of { line, author, text, timestamp }
  const [activeReviewCommentLine, setActiveReviewCommentLine] = useState(null);
  const [reviewCommentInput, setReviewCommentInput] = useState('');
  const [executionController, setExecutionController] = useState(null);
  const [terminalHistory, setTerminalHistory] = useState([]);
  const [bottomTerminalActiveTab, setBottomTerminalActiveTab] = useState('console');

  // Toast Notification System helper
  const addToast = (message, type = 'info') => {
    const id = Date.now() + Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  // Set user role based on isOwner
  useEffect(() => {
    if (isOwner) {
      setUserRole('Owner');
    } else {
      setUserRole('Editor');
    }
  }, [isOwner]);

  // Project ZIP Export handler using JSZip dynamic loading
  const handleExportAsZip = async () => {
    addToast('Generating Project ZIP file...', 'info');
    try {
      if (!window.JSZip) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }

      const zip = new window.JSZip();
      Object.keys(files).forEach(pathStr => {
        if (pathStr.split('/').pop() !== '.keep') {
          zip.file(pathStr, files[pathStr].content);
        }
      });

      const content = await zip.generateAsync({ type: 'blob' });
      const url = window.URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${projectName || 'project'}-workspace.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      addToast('ZIP Downloaded successfully!', 'success');
      addTimelineEvent('📥 Exported workspace project as ZIP archive');
    } catch (err) {
      addToast(`ZIP Export failed: ${err.message}`, 'error');
    }
  };

  // Outline symbol parser effect
  useEffect(() => {
    const activeFile = files[activeFilePath];
    if (!activeFile) {
      setOutlineSymbols([]);
      return;
    }
    const content = activeFile.content || '';
    const symbols = [];
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      let match = null;
      let type = 'function';

      if (activeFile.language === 'javascript' || activeFile.language === 'typescript') {
        match = line.match(/(?:class\s+([A-Za-z0-9_$]+))|(?:function\s+([A-Za-z0-9_$]+))|(?:\s*const\s+([A-Za-z0-9_$]+)\s*=\s*(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>)/);
        if (match) type = match[1] ? 'class' : 'function';
      } else if (activeFile.language === 'python') {
        match = line.match(/(?:class\s+([A-Za-z0-9_]+))|(?:def\s+([A-Za-z0-9_]+))/);
        if (match) type = match[1] ? 'class' : 'method';
      } else if (activeFile.language === 'cpp' || activeFile.language === 'java' || activeFile.language === 'csharp') {
        match = line.match(/(?:class\s+([A-Za-z0-9_]+))|(?:\b[A-Za-z0-9_<>]+(?:\s+|\s*[*&]\s*)[A-Za-z0-9_]+(?:\s*::\s*[A-Za-z0-9_]+)?\s*\([^)]*\)\s*\{)/);
      }

      if (match) {
        const name = match[1] || match[2] || match[3] || line.trim().split('(')[0];
        if (name && name.length < 50) {
          symbols.push({
            name: name.trim(),
            line: idx + 1,
            type
          });
        }
      }
    });
    setOutlineSymbols(symbols);
  }, [activeFilePath, files]);

  // Cancel code execution request handler
  const handleStopExecution = () => {
    if (executionController) {
      executionController.abort();
      setExecutionController(null);
      setTerminalIsRunning(false);
      setTerminalOutput(prev => prev + '\n⚠️ Execution cancelled by user.');
      addToast('Code execution stopped.', 'warning');
    }
  };

  // Recent files tracking
  useEffect(() => {
    if (activeFilePath) {
      setRecentFiles(prev => {
        const filtered = prev.filter(f => f !== activeFilePath);
        return [activeFilePath, ...filtered].slice(0, 10);
      });
    }
  }, [activeFilePath]);

  const toggleFavoriteFile = (filePath, e) => {
    e.stopPropagation();
    setFavoriteFiles(prev =>
      prev.includes(filePath) ? prev.filter(f => f !== filePath) : [...prev, filePath]
    );
    addToast(favoriteFiles.includes(filePath) ? 'Removed from favorites' : 'Added to favorites', 'success');
  };

  // Tab Pinning & History Reopeners
  const togglePinTab = (tabPath, e) => {
    e.stopPropagation();
    setPinnedTabs(prev =>
      prev.includes(tabPath) ? prev.filter(t => t !== tabPath) : [...prev, tabPath]
    );
    addToast(pinnedTabs.includes(tabPath) ? 'Tab unpinned' : 'Tab pinned', 'info');
  };

  const closeTabWithHistory = (tabPath, e) => {
    e.stopPropagation();
    setClosedTabsHistory(prev => [...prev, tabPath]);
    closeTab(tabPath, e);
  };

  const reopenLastClosedTab = () => {
    if (closedTabsHistory.length === 0) {
      addToast('No recently closed tabs to reopen.', 'warning');
      return;
    }
    const nextHistory = [...closedTabsHistory];
    const path = nextHistory.pop();
    setClosedTabsHistory(nextHistory);
    if (files[path]) {
      selectFile(path);
      addToast(`Reopened ${path.split('/').pop()}`, 'success');
    }
  };

  // Replace occurrence handlers
  const handleReplaceOne = (pathStr, lineNum, matchText) => {
    if (!files[pathStr]) return;
    setFiles(prev => {
      const file = prev[pathStr];
      const lines = file.content.split('\n');
      if (lines[lineNum - 1] !== undefined) {
        const lineVal = lines[lineNum - 1];
        let newLineVal = lineVal;
        if (projectSearchRegex) {
          try {
            const flags = projectSearchCase ? '' : 'i';
            const regex = new RegExp(projectSearchQuery, flags);
            newLineVal = lineVal.replace(regex, projectReplaceQuery);
          } catch (e) { }
        } else {
          newLineVal = lineVal.replace(projectSearchQuery, projectReplaceQuery);
        }
        lines[lineNum - 1] = newLineVal;
        const updated = {
          ...prev,
          [pathStr]: {
            ...file,
            content: lines.join('\n')
          }
        };
        triggerCodeUpdate(updated);
        addToast('Occurrence replaced.', 'success');
        return updated;
      }
      return prev;
    });
  };

  const handleReplaceAll = () => {
    if (!projectSearchQuery) return;
    setFiles(prev => {
      const updated = { ...prev };
      let totalCount = 0;
      Object.keys(updated).forEach(pathStr => {
        const file = updated[pathStr];
        let nextContent = file.content;
        let isMatch = false;
        if (projectSearchRegex) {
          try {
            const flags = projectSearchCase ? 'g' : 'gi';
            const regex = new RegExp(projectSearchQuery, flags);
            isMatch = regex.test(nextContent);
            if (isMatch) {
              nextContent = nextContent.replace(regex, projectReplaceQuery);
              totalCount++;
            }
          } catch (e) { }
        } else {
          const count = nextContent.split(projectSearchQuery).length - 1;
          if (count > 0) {
            nextContent = nextContent.replaceAll(projectSearchQuery, projectReplaceQuery);
            totalCount += count;
          }
        }
        updated[pathStr] = {
          ...file,
          content: nextContent
        };
      });
      if (totalCount > 0) {
        triggerCodeUpdate(updated);
        addToast(`Replaced ${totalCount} occurrence(s) across project.`, 'success');
      } else {
        addToast('No occurrences found to replace.', 'warning');
      }
      return updated;
    });
  };

  // Drag-and-drop hierarchy reorganization logic
  const handleDragStartNode = (e, pathStr) => {
    setDraggedNodePath(pathStr);
    e.dataTransfer.setData('text/plain', pathStr);
  };

  const handleDropNode = (e, targetFolderHoverPath) => {
    e.preventDefault();
    if (!draggedNodePath || draggedNodePath === targetFolderHoverPath) return;

    if (targetFolderHoverPath.startsWith(draggedNodePath + '/')) {
      addToast('Cannot drop a folder into its own subdirectory.', 'error');
      return;
    }

    setFiles(prev => {
      const updated = { ...prev };
      const keysToMove = Object.keys(updated).filter(k => k === draggedNodePath || k.startsWith(draggedNodePath + '/'));

      keysToMove.forEach(oldKey => {
        const fileData = updated[oldKey];
        delete updated[oldKey];

        let newKey = oldKey;
        if (oldKey === draggedNodePath) {
          const fileName = oldKey.split('/').pop();
          newKey = targetFolderHoverPath ? `${targetFolderHoverPath}/${fileName}` : fileName;
        } else {
          const suffix = oldKey.substring(draggedNodePath.length);
          const folderName = draggedNodePath.split('/').pop();
          newKey = targetFolderHoverPath ? `${targetFolderHoverPath}/${folderName}${suffix}` : `${folderName}${suffix}`;
        }

        updated[newKey] = {
          ...fileData,
          path: newKey,
          name: newKey.split('/').pop()
        };
      });

      triggerCodeUpdate(updated);
      addToast('Workspace nodes reorganized.', 'success');
      return updated;
    });
    setDraggedNodePath(null);
  };

  // Inline comments reviews mapping
  const addInlineComment = (lineNum) => {
    if (!reviewCommentInput.trim() || !activeFilePath) return;
    const author = username || 'Peer';
    const text = reviewCommentInput.trim();

    setInlineComments(prev => {
      const list = prev[activeFilePath] || [];
      const updatedList = [...list, { line: lineNum, author, text, timestamp: Date.now() }];
      const updated = { ...prev, [activeFilePath]: updatedList };
      return updated;
    });
    setReviewCommentInput('');
    setActiveReviewCommentLine(null);
    addToast('Review comment posted.', 'success');
  };

  // Autosavesnapshots history
  useEffect(() => {
    if (!files || Object.keys(files).length === 0) return;
    const interval = setInterval(() => {
      setSnapshots(prev => {
        const nextSnapshots = [...prev, {
          timestamp: Date.now(),
          files: JSON.parse(JSON.stringify(files))
        }];
        if (nextSnapshots.length > 10) nextSnapshots.shift();
        return nextSnapshots;
      });
    }, 60000);
    return () => clearInterval(interval);
  }, [files]);

  const restoreSnapshot = (snapshotItem) => {
    setFiles(snapshotItem.files);
    triggerCodeUpdate(snapshotItem.files);
    addToast('Project restored to snapshot version.', 'success');
    addTimelineEvent(`🕒 Restored project to version from ${new Date(snapshotItem.timestamp).toLocaleTimeString()}`);
  };

  // Typing status clear out intervals
  useEffect(() => {
    const interval = setInterval(() => {
      setTypingUsers(prev => {
        const next = { ...prev };
        let changed = false;
        const now = Date.now();
        Object.keys(next).forEach(u => {
          if (now - next[u] > 3000) {
            delete next[u];
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const [attachments, setAttachments] = useState([]);
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
    } catch (e) {
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
  const [showStylingPopover, setShowStylingPopover] = useState(false);
  const [showShapesPopover, setShowShapesPopover] = useState(false);
  const [chatVisible, setChatVisible] = useState(true);

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

  // Dynamic CSS styles tag builder for remote custom cursor colors
  useEffect(() => {
    Object.keys(presenceCursors).forEach(socketId => {
      const presence = presenceCursors[socketId];
      if (presence && presence.color) {
        const styleId = `presence-style-${socketId}`;
        let styleEl = document.getElementById(styleId);
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = styleId;
          document.head.appendChild(styleEl);
        }
        styleEl.innerHTML = `
          .remote-presence-cursor-${socketId} {
            border-left: 2px solid ${presence.color} !important;
            animation: presenceBlink 1s step-end infinite;
          }
          .remote-presence-selection-${socketId} {
            background-color: ${presence.color}33 !important;
          }
        `;
      }
    });

    return () => {
      document.querySelectorAll('style[id^="presence-style-"]').forEach(styleEl => {
        const socketId = styleEl.id.replace('presence-style-', '');
        if (!presenceCursors[socketId]) {
          styleEl.remove();
        }
      });
    };
  }, [presenceCursors]);

  // Monaco editor cursors synchronization annotations
  const presenceDecorationsRef = useRef([]);
  useEffect(() => {
    const editor = monacoRef.current;
    if (!editor || !activeFilePath) return;

    const newDecorations = [];
    Object.keys(presenceCursors).forEach(socketId => {
      const presence = presenceCursors[socketId];
      if (presence.path === activeFilePath) {
        if (presence.position) {
          newDecorations.push({
            range: {
              startLineNumber: presence.position.lineNumber,
              startColumn: presence.position.column,
              endLineNumber: presence.position.lineNumber,
              endColumn: presence.position.column + 1
            },
            options: {
              className: `remote-presence-cursor-${socketId}`,
              hoverMessage: { value: `**${presence.username || 'Peer'}** is editing here` }
            }
          });
        }
        if (presence.selection) {
          newDecorations.push({
            range: {
              startLineNumber: presence.selection.startLineNumber,
              startColumn: presence.selection.startColumn,
              endLineNumber: presence.selection.endLineNumber,
              endColumn: presence.selection.endColumn
            },
            options: {
              className: `remote-presence-selection-${socketId}`,
              hoverMessage: { value: `**${presence.username || 'Peer'}** selection` }
            }
          });
        }
      }
    });

    try {
      if (editor.getModel()) {
        presenceDecorationsRef.current = editor.deltaDecorations(
          presenceDecorationsRef.current,
          newDecorations
        );
      }
    } catch (e) {
      console.warn('Failed to update presence decorations:', e);
    }
  }, [presenceCursors, activeFilePath]);

  // Global Workspace Hotkeys
  useEffect(() => {
    const handleGlobalShortcuts = (e) => {
      if (activeTab !== 'code') return;

      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        reopenLastClosedTab();
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        setCodeReviewMode(prev => !prev);
        addToast('Code Review Mode toggled!', 'info');
      } else if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        // Save manual snapshot
        setSnapshots(prev => [
          ...prev,
          { timestamp: Date.now(), files: JSON.parse(JSON.stringify(files)) }
        ].slice(-10));
        addToast('Manual snapshot saved!', 'success');
        addTimelineEvent(`🕒 Manually saved snapshot at ${new Date().toLocaleTimeString()}`);
      } else if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSidebarActiveView('search');
      } else if (e.ctrlKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setSidebarActiveView('search');
      }
    };
    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, [activeTab, files, closedTabsHistory]);

  // Project Search indexing
  useEffect(() => {
    if (!projectSearchQuery) {
      setProjectSearchResults([]);
      return;
    }
    const results = [];
    Object.keys(files).forEach(pathStr => {
      const content = files[pathStr].content;
      const lines = content.split('\n');
      lines.forEach((lineText, idx) => {
        let isMatch = false;
        if (projectSearchRegex) {
          try {
            const flags = projectSearchCase ? 'g' : 'gi';
            const regex = new RegExp(projectSearchQuery, flags);
            isMatch = regex.test(lineText);
          } catch (e) { }
        } else {
          let needle = projectSearchQuery;
          let haystack = lineText;
          if (!projectSearchCase) {
            needle = needle.toLowerCase();
            haystack = haystack.toLowerCase();
          }
          if (projectSearchWord) {
            const words = haystack.split(/\W+/);
            isMatch = words.includes(needle);
          } else {
            isMatch = haystack.includes(needle);
          }
        }

        if (isMatch) {
          results.push({
            path: pathStr,
            lineNumber: idx + 1,
            lineContent: lineText.trim()
          });
        }
      });
    });
    setProjectSearchResults(results);
  }, [projectSearchQuery, projectSearchRegex, projectSearchCase, projectSearchWord, files]);

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
      localStorage.setItem(`owner_token_${projectName.toLowerCase()}`, token);
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
      try {
        const parsed = JSON.parse(data.code);
        if (parsed && parsed.files) {
          setFiles(prev => {
            const nextFiles = { ...parsed.files };
            const activeFile = nextFiles[activeFilePath];
            if (activeFile && activeFile.content !== (prev[activeFilePath]?.content || '')) {
              if (monacoRef.current) {
                const editor = monacoRef.current;
                const pos = editor.getPosition();
                const sel = editor.getSelections();
                editor.setValue(activeFile.content);
                if (pos) editor.setPosition(pos);
                if (sel) editor.setSelections(sel);
              }
            }
            return nextFiles;
          });
        } else {
          const legacyFile = 'index.js';
          const newFiles = {
            [legacyFile]: {
              name: legacyFile,
              path: legacyFile,
              content: data.code,
              language: data.language || 'javascript'
            }
          };
          setFiles(newFiles);
          setActiveFilePath(legacyFile);
          if (monacoRef.current && monacoRef.current.getValue() !== data.code) {
            monacoRef.current.setValue(data.code);
          }
        }
      } catch (err) {
        const legacyFile = 'index.js';
        const newFiles = {
          [legacyFile]: {
            name: legacyFile,
            path: legacyFile,
            content: data.code,
            language: data.language || 'javascript'
          }
        };
        setFiles(newFiles);
        setActiveFilePath(legacyFile);
        if (monacoRef.current && monacoRef.current.getValue() !== data.code) {
          monacoRef.current.setValue(data.code);
        }
      }
      isRemoteCodeChangeRef.current = false;
      addTimelineEvent('💻 Collaborative workspace files synced');
    });

    socket.on('cursor position', ({ socketId, username, color, path, position }) => {
      setPresenceCursors(prev => ({
        ...prev,
        [socketId]: { ...prev[socketId], username, color, path, position }
      }));
    });

    socket.on('cursor selection', ({ socketId, username, color, path, selection }) => {
      setPresenceCursors(prev => ({
        ...prev,
        [socketId]: { ...prev[socketId], username, color, path, selection }
      }));
    });

    socket.on('typing', ({ username, path }) => {
      setTypingUsers(prev => ({
        ...prev,
        [username]: Date.now()
      }));
    });

    socket.on('user left presence', ({ socketId }) => {
      setPresenceCursors(prev => {
        const copy = { ...prev };
        delete copy[socketId];
        return copy;
      });
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
      const savedOwnerToken = localStorage.getItem(`owner_token_${projectName}`) || localStorage.getItem(`owner_token_${projectName.toLowerCase()}`) || '';
      socket.emit('join project', { projectName, accessKey: currentKey, ownerToken: savedOwnerToken });
    });

    // Now emit the initial join project event that all listeners are bound
    const savedKey = sessionStorage.getItem(`accesskey_project_${projectName}`) || getCookie(`accesskey_project_${projectName}`) || '';
    const savedOwnerToken = localStorage.getItem(`owner_token_${projectName}`) || localStorage.getItem(`owner_token_${projectName.toLowerCase()}`) || '';
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

  const addDiamond = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    canvas.isDrawingMode = false;
    setDrawingTool('select');
    const points = [
      { x: 40, y: 0 },
      { x: 80, y: 40 },
      { x: 40, y: 80 },
      { x: 0, y: 40 }
    ];
    const diamond = new Polygon(points, {
      left: 100,
      top: 100,
      fill: 'transparent',
      stroke: brushColor,
      strokeWidth: 2
    });
    canvas.add(diamond);
    canvas.setActiveObject(diamond);
    canvas.renderAll();
  };

  const addArrow = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    canvas.isDrawingMode = false;
    setDrawingTool('select');
    const arrowPath = "M 0 10 L 100 10 M 100 10 L 85 0 M 100 10 L 85 20";
    const arrow = new Path(arrowPath, {
      left: 100,
      top: 100,
      fill: 'transparent',
      stroke: brushColor,
      strokeWidth: 2
    });
    canvas.add(arrow);
    canvas.setActiveObject(arrow);
    canvas.renderAll();
  };

  const addStar = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    canvas.isDrawingMode = false;
    setDrawingTool('select');
    const points = [
      { x: 40, y: 0 },
      { x: 50, y: 30 },
      { x: 80, y: 30 },
      { x: 56, y: 48 },
      { x: 66, y: 80 },
      { x: 40, y: 60 },
      { x: 14, y: 80 },
      { x: 24, y: 48 },
      { x: 0, y: 30 },
      { x: 30, y: 30 }
    ];
    const star = new Polygon(points, {
      left: 100,
      top: 100,
      fill: 'transparent',
      stroke: brushColor,
      strokeWidth: 2
    });
    canvas.add(star);
    canvas.setActiveObject(star);
    canvas.renderAll();
  };

  const addHeart = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    canvas.isDrawingMode = false;
    setDrawingTool('select');
    const heartPath = "M 10,30 A 20,20 0,0,1 50,30 A 20,20 0,0,1 90,30 Q 90,60 50,90 Q 10,60 10,30 z";
    const heart = new Path(heartPath, {
      left: 100,
      top: 100,
      fill: 'transparent',
      stroke: brushColor,
      strokeWidth: 2
    });
    canvas.add(heart);
    canvas.setActiveObject(heart);
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

  const importWhiteboard = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const jsonContent = event.target.result;
        const parsed = JSON.parse(jsonContent);
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;

        isRemoteCanvasChangeRef.current = true;
        canvas.loadFromJSON(parsed).then(() => {
          canvas.renderAll();
          isRemoteCanvasChangeRef.current = false;
          if (socketRef.current) {
            socketRef.current.emit('whiteboard update', { projectName, content: jsonContent });
          }
          addTimelineEvent('📥 Imported whiteboard configuration');
        }).catch((err) => {
          alert('Failed to parse whiteboard JSON.');
          isRemoteCanvasChangeRef.current = false;
        });
      } catch (err) {
        alert('Invalid whiteboard JSON file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
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

  // --- Upgraded IDE Workspace & Editor Handlers ---

  const [saveStatus, setSaveStatus] = useState('Saved');
  const [lastSavedTime, setLastSavedTime] = useState(new Date().toLocaleTimeString());
  const [collapsedFolders, setCollapsedFolders] = useState({});

  const getFileIcon = (filePath) => {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    switch (ext) {
      case 'js':
      case 'jsx':
        return <span style={{ color: '#f7df1e', fontWeight: 'bold', fontSize: '0.75rem', marginRight: '4px' }}>JS</span>;
      case 'ts':
      case 'tsx':
        return <span style={{ color: '#007acc', fontWeight: 'bold', fontSize: '0.75rem', marginRight: '4px' }}>TS</span>;
      case 'py':
        return <span style={{ color: '#3776ab', fontWeight: 'bold', fontSize: '0.75rem', marginRight: '4px' }}>PY</span>;
      case 'html':
        return <span style={{ color: '#e34f26', fontWeight: 'bold', fontSize: '0.75rem', marginRight: '4px' }}>HTML</span>;
      case 'css':
        return <span style={{ color: '#1572b6', fontWeight: 'bold', fontSize: '0.75rem', marginRight: '4px' }}>CSS</span>;
      case 'json':
        return <span style={{ color: '#ffb86c', fontWeight: 'bold', fontSize: '0.75rem', marginRight: '4px' }}>{ }</span>;
      case 'md':
        return <span style={{ color: '#50fa7b', fontWeight: 'bold', fontSize: '0.75rem', marginRight: '4px' }}>MD</span>;
      case 'rs':
        return <span style={{ color: '#dea584', fontWeight: 'bold', fontSize: '0.75rem', marginRight: '4px' }}>RS</span>;
      case 'go':
        return <span style={{ color: '#8be9fd', fontWeight: 'bold', fontSize: '0.75rem', marginRight: '4px' }}>GO</span>;
      case 'cpp':
      case 'c':
        return <span style={{ color: '#50fa7b', fontWeight: 'bold', fontSize: '0.75rem', marginRight: '4px' }}>C++</span>;
      case 'java':
        return <span style={{ color: '#ff5555', fontWeight: 'bold', fontSize: '0.75rem', marginRight: '4px' }}>JV</span>;
      case 'php':
        return <span style={{ color: '#bd93f9', fontWeight: 'bold', fontSize: '0.75rem', marginRight: '4px' }}>PHP</span>;
      case 'sql':
        return <span style={{ color: '#ffb86c', fontWeight: 'bold', fontSize: '0.75rem', marginRight: '4px' }}>SQL</span>;
      default:
        return <span style={{ color: '#839496', fontSize: '0.8rem', marginRight: '4px' }}>📄</span>;
    }
  };

  const judge0LanguageMap = {
    javascript: 63,
    typescript: 74,
    python: 71,
    cpp: 54,
    c: 50,
    java: 62,
    go: 60,
    rust: 73,
    php: 68,
    sql: 82,
    markdown: 0,
    html: 0,
    css: 0
  };

  const presenceColors = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899'];
  const myPresenceColor = presenceColors[Math.abs((username || 'anon').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % presenceColors.length];

  const defineMonacoThemes = (monaco) => {
    monaco.editor.defineTheme('dracula', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6272a4', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'ff79c6' },
        { token: 'identifier', foreground: 'f8f8f2' },
        { token: 'string', foreground: 'f1fa8c' },
        { token: 'number', foreground: 'bd93f9' },
      ],
      colors: {
        'editor.background': '#282a36',
        'editor.foreground': '#f8f8f2',
        'editor.lineHighlightBackground': '#44475a',
        'editorCursor.foreground': '#bd93f9',
      }
    });

    monaco.editor.defineTheme('nord', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '4c566a', fontStyle: 'italic' },
        { token: 'keyword', foreground: '81a1c1' },
        { token: 'string', foreground: 'a3be8c' },
        { token: 'number', foreground: 'b48ead' },
      ],
      colors: {
        'editor.background': '#2e3440',
        'editor.foreground': '#d8dee9',
        'editor.lineHighlightBackground': '#3b4252',
        'editorCursor.foreground': '#81a1c1',
      }
    });

    monaco.editor.defineTheme('solarized', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '586e75', fontStyle: 'italic' },
        { token: 'keyword', foreground: '859900' },
        { token: 'string', foreground: '2aa198' },
        { token: 'number', foreground: 'd33682' },
      ],
      colors: {
        'editor.background': '#002b36',
        'editor.foreground': '#839496',
        'editor.lineHighlightBackground': '#073642',
        'editorCursor.foreground': '#859900',
      }
    });
  };

  const handleEditorDidMount = (editor, monaco) => {
    monacoRef.current = editor;
    defineMonacoThemes(monaco);

    // Command Palette shortcut
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP, () => {
      setShowCommandPalette(prev => !prev);
    });

    // Run Code shortcut
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      if (handleRunCodeRef.current) handleRunCodeRef.current();
    });

    // Find / Replace shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
      setSidebarActiveView('search');
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, () => {
      setSidebarActiveView('search');
    });

    // Custom inline comments reviewer keybind
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyC, () => {
      setCodeReviewMode(prev => !prev);
      addToast('Code Review Mode toggled!', 'info');
    });

    // Monitor file markers / diagnostics
    const updateMarkers = () => {
      const model = editor.getModel();
      if (model) {
        const markers = monaco.editor.getModelMarkers({ resource: model.uri });
        setEditorMarkers(markers);
      }
    };
    editor.onDidChangeModelContent(updateMarkers);
    editor.onDidChangeModel(updateMarkers);

    // Sync cursor presence
    editor.onDidChangeCursorPosition((e) => {
      if (socketRef.current && activeFilePath) {
        socketRef.current.emit('cursor position', {
          projectName,
          path: activeFilePath,
          position: e.position,
          username,
          color: myPresenceColor
        });
      }
    });

    // Sync selection presence
    editor.onDidChangeCursorSelection((e) => {
      if (socketRef.current && activeFilePath) {
        socketRef.current.emit('cursor selection', {
          projectName,
          path: activeFilePath,
          selection: e.selection,
          username,
          color: myPresenceColor
        });
      }
    });
  };

  const triggerCodeUpdate = (updatedFiles) => {
    if (isRemoteCodeChangeRef.current || !socketRef.current) return;
    setSaveStatus('Saving...');
    if (codeTimeoutRef.current) clearTimeout(codeTimeoutRef.current);
    codeTimeoutRef.current = setTimeout(() => {
      const serialized = JSON.stringify({ files: updatedFiles });
      socketRef.current.emit('code update', {
        projectName,
        code: serialized,
        language: 'json'
      });
      setSaveStatus('Saved');
      setLastSavedTime(new Date().toLocaleTimeString());
      if (editorFormatOnSave) {
        formatActiveDocument();
      }
    }, 400);
  };

  const handleCodeChange = (value) => {
    if (!activeFilePath) return;
    if (socketRef.current) {
      socketRef.current.emit('typing', { username, path: activeFilePath });
    }
    setFiles(prev => {
      const updated = {
        ...prev,
        [activeFilePath]: {
          ...prev[activeFilePath],
          content: value || ''
        }
      };
      triggerCodeUpdate(updated);
      return updated;
    });
  };

  const handleInsertSnippet = (snippetCode) => {
    if (monacoRef.current && activeFilePath) {
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
    } else if (activeFilePath) {
      setFiles(prev => {
        const file = prev[activeFilePath];
        const newCode = (file?.content || '') + '\n' + snippetCode;
        const updated = {
          ...prev,
          [activeFilePath]: {
            ...file,
            content: newCode
          }
        };
        triggerCodeUpdate(updated);
        return updated;
      });
    }
    setActiveTab('code');
    addTimelineEvent('Saved snippet inserted into editor');
  };

  const createFile = (pathStr) => {
    if (!pathStr || files[pathStr]) return;
    const ext = pathStr.split('.').pop() || 'js';
    const extMap = {
      js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
      py: 'python', cpp: 'cpp', c: 'c', java: 'java', html: 'html', css: 'css',
      json: 'json', md: 'markdown', sql: 'sql', php: 'php', go: 'go', rs: 'rust'
    };
    const language = extMap[ext.toLowerCase()] || 'javascript';
    setFiles(prev => {
      const updated = {
        ...prev,
        [pathStr]: {
          name: pathStr.split('/').pop(),
          path: pathStr,
          content: '',
          language
        }
      };
      triggerCodeUpdate(updated);
      return updated;
    });
    setActiveFilePath(pathStr);
    setOpenTabs(prev => prev.includes(pathStr) ? prev : [...prev, pathStr]);
    addTimelineEvent(`📁 Created file ${pathStr}`);
  };

  const deleteFile = (pathStr) => {
    setFiles(prev => {
      const updated = { ...prev };
      delete updated[pathStr];
      triggerCodeUpdate(updated);
      return updated;
    });
    setOpenTabs(prev => prev.filter(t => t !== pathStr));
    if (activeFilePath === pathStr) {
      const remaining = openTabs.filter(t => t !== pathStr);
      if (remaining.length > 0) {
        setActiveFilePath(remaining[remaining.length - 1]);
      } else {
        setActiveFilePath('');
      }
    }
    addTimelineEvent(`❌ Deleted file ${pathStr}`);
  };

  const renameFile = (oldPath, newPath) => {
    if (!newPath || files[newPath] || !files[oldPath]) return;
    setFiles(prev => {
      const updated = { ...prev };
      const fileData = updated[oldPath];
      delete updated[oldPath];
      updated[newPath] = {
        ...fileData,
        name: newPath.split('/').pop(),
        path: newPath
      };
      triggerCodeUpdate(updated);
      return updated;
    });
    if (activeFilePath === oldPath) {
      setActiveFilePath(newPath);
    }
    setOpenTabs(prev => prev.map(t => t === oldPath ? newPath : t));
    addTimelineEvent(`✏️ Renamed file to ${newPath}`);
  };

  const selectFile = (pathStr) => {
    setActiveFilePath(pathStr);
    if (!openTabs.includes(pathStr)) {
      setOpenTabs(prev => [...prev, pathStr]);
    }
  };

  const closeTab = (pathStr, e) => {
    e.stopPropagation();
    setOpenTabs(prev => {
      const nextTabs = prev.filter(t => t !== pathStr);
      if (activeFilePath === pathStr) {
        if (nextTabs.length > 0) {
          setActiveFilePath(nextTabs[nextTabs.length - 1]);
        } else {
          setActiveFilePath('');
        }
      }
      return nextTabs;
    });
  };

  const formatActiveDocument = () => {
    if (monacoRef.current) {
      monacoRef.current.getAction('editor.action.formatDocument').run();
      addTimelineEvent('✨ Formatted document');
    }
  };

  const getSelectedCode = () => {
    if (monacoRef.current) {
      const editor = monacoRef.current;
      const selection = editor.getSelection();
      if (selection && !selection.isEmpty()) {
        return editor.getModel().getValueInRange(selection);
      }
    }
    return '';
  };

  const handleAiAction = (actionType) => {
    const code = getSelectedCode() || files[activeFilePath]?.content || '';
    if (!code && actionType !== 'error') {
      alert('Active file is empty.');
      return;
    }

    let prompt = '';
    if (actionType === 'explain') {
      prompt = `Explain the following code in detail:\n\n\`\`\`\n${code}\n\`\`\``;
    } else if (actionType === 'fix') {
      prompt = `Identify any bugs or syntax issues in the following code and provide a corrected version:\n\n\`\`\`\n${code}\n\`\`\``;
    } else if (actionType === 'optimize') {
      prompt = `Optimize the performance and readability of this code snippet:\n\n\`\`\`\n${code}\n\`\`\``;
    } else if (actionType === 'refactor') {
      prompt = `Refactor this code to follow SOLID principles and clean practices:\n\n\`\`\`\n${code}\n\`\`\``;
    } else if (actionType === 'comments') {
      prompt = `Add descriptive inline comments and docstrings to clarify the following code:\n\n\`\`\`\n${code}\n\`\`\``;
    } else if (actionType === 'tests') {
      prompt = `Generate a robust suite of unit tests for the following code snippet:\n\n\`\`\`\n${code}\n\`\`\``;
    } else if (actionType === 'error') {
      prompt = `Review this compiler diagnostic output and propose a detailed fix:\n\nCompiler Output:\n${terminalOutput}\n\nActive Source code context:\n\`\`\`\n${code}\n\`\`\``;
    } else if (actionType === 'convert') {
      prompt = `Convert the following code logic to Python if written in Javascript/Java/C++, or Javascript if written in Python:\n\n\`\`\`\n${code}\n\`\`\``;
    }

    setAiPanelOpen(true);
    sendAiMessage(prompt);
  };

  const sendAiMessage = async (msgText) => {
    if (!msgText.trim() || aiLoading) return;
    setAiLoading(true);
    setAiLogs(prev => [...prev, { role: 'user', text: msgText }]);
    setAiMessageInput('');

    try {
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msgText,
          history: aiLogs
        })
      });
      const data = await response.json();
      if (response.ok) {
        setAiLogs(prev => [...prev, { role: 'model', text: data.response }]);
        addTimelineEvent('🤖 AI assistant response received');
      } else {
        setAiLogs(prev => [...prev, { role: 'model', text: `❌ Error: ${data.error || 'AI request failed'}` }]);
      }
    } catch (err) {
      setAiLogs(prev => [...prev, { role: 'model', text: `❌ Network Error: ${err.message}` }]);
    } finally {
      setAiLoading(false);
    }
  };

  const runLocalCompiler = async (code, language) => {
    setTerminalOutput('⏳ Executing code via local compiler...');
    try {
      const response = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, language })
      });
      const data = await response.json();
      const output = data.stdout || data.stderr || 'No output.';
      setTerminalOutput(output);
      setTerminalStats({
        time: data.timeout ? 'Timed out' : '8.0s limit',
        memory: 'N/A',
        status: data.exitCode === 0 ? 'Success' : 'Failed'
      });
      setTerminalOpen(true);
      addTimelineEvent(`🚀 Ran code: ${files[activeFilePath]?.name} (Local Compiler)`);
    } catch (err) {
      setTerminalOutput(`❌ Execution failed: ${err.message}`);
    }
  };

  const handleRunCode = async () => {
    const activeFile = files[activeFilePath];
    if (!activeFile) return;

    setTerminalIsRunning(true);
    setTerminalOutput('⏳ Executing code via Judge0...');
    setTerminalStats(null);
    setTerminalOpen(true);

    const langId = judge0LanguageMap[activeFile.language];

    if (activeFile.language === 'html' || activeFile.language === 'css' || activeFile.language === 'markdown') {
      setTerminalOutput('🌐 Loaded active view in web preview frame.');
      setTerminalIsRunning(false);
      setShowPreview(true);
      return;
    }

    if (!langId) {
      runLocalCompiler(activeFile.content, activeFile.language);
      setTerminalIsRunning(false);
      return;
    }

    try {
      const response = await fetch('https://ce.judge0.com/submissions?wait=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_code: activeFile.content,
          language_id: langId,
          stdin: terminalStdin
        })
      });

      if (!response.ok) {
        throw new Error('Judge0 CE API failed');
      }

      const data = await response.json();
      const output = data.stdout || data.compile_output || data.stderr || 'No output.';
      setTerminalOutput(output);
      setTerminalStats({
        time: data.time ? `${data.time}s` : '0.0s',
        memory: data.memory ? `${(data.memory / 1024).toFixed(2)}MB` : '0.0MB',
        status: data.status?.description || 'Done'
      });
      addTimelineEvent(`🚀 Ran code: ${activeFile.name} (Judge0)`);
    } catch (err) {
      console.warn('Judge0 failed, falling back to local compiler:', err);
      runLocalCompiler(activeFile.content, activeFile.language);
    } finally {
      setTerminalIsRunning(false);
    }
  };

  const buildFileTree = (filesMap) => {
    const root = { name: 'root', type: 'folder', path: '', children: {} };
    Object.keys(filesMap).forEach(filePath => {
      const parts = filePath.split('/');
      let current = root;
      parts.forEach((part, index) => {
        const isLast = index === parts.length - 1;
        if (!current.children[part]) {
          current.children[part] = {
            name: part,
            type: isLast ? 'file' : 'folder',
            path: parts.slice(0, index + 1).join('/'),
            children: {}
          };
        }
        current = current.children[part];
      });
    });
    return root;
  };

  const toggleFolder = (pathStr) => {
    setCollapsedFolders(prev => ({
      ...prev,
      [pathStr]: !prev[pathStr]
    }));
  };

  const renderFileTree = (node) => {
    const sortedChildren = Object.values(node.children).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return sortedChildren.map(child => {
      if (child.name === '.keep') return null;

      const isFolder = child.type === 'folder';
      const isCollapsed = collapsedFolders[child.path];

      return (
        <div key={child.path} className="file-tree-node" style={{ paddingLeft: '12px' }}>
          {isFolder ? (
            <div
              draggable
              onDragStart={(e) => handleDragStartNode(e, child.path)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleDropNode(e, child.path)}
            >
              <div
                className="file-node-item folder-item"
                onClick={() => toggleFolder(child.path)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setActiveRightClickPath(child.path);
                  setRightClickMenuPos({ x: e.clientX, y: e.clientY });
                  setShowRightClickMenu(true);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', padding: '4px 6px', borderRadius: '4px' }}
              >
                <span>{isCollapsed ? '📁' : '📂'}</span>
                <span className="node-name" style={{ fontWeight: 600 }}>{child.name}</span>
                <div className="folder-actions" style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
                  <button onClick={(e) => { e.stopPropagation(); const fn = prompt('File name:'); if (fn) createFile(`${child.path}/${fn}`); }} title="New File" style={{ border: 'none', background: 'transparent', fontSize: '0.85rem', cursor: 'pointer' }}>📄+</button>
                  <button onClick={(e) => {
                    e.stopPropagation(); if (confirm(`Delete folder ${child.path}?`)) {
                      Object.keys(files).forEach(f => {
                        if (f.startsWith(child.path + '/')) deleteFile(f);
                      });
                    }
                  }} title="Delete Folder" style={{ border: 'none', background: 'transparent', fontSize: '0.85rem', cursor: 'pointer' }}>🗑️</button>
                </div>
              </div>
              {!isCollapsed && (
                <div className="folder-children">
                  {renderFileTree(child)}
                </div>
              )}
            </div>
          ) : (
            <div
              draggable
              onDragStart={(e) => handleDragStartNode(e, child.path)}
              className={`file-node-item file-item ${activeFilePath === child.path ? 'active' : ''}`}
              onClick={() => selectFile(child.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                setActiveRightClickPath(child.path);
                setRightClickMenuPos({ x: e.clientX, y: e.clientY });
                setShowRightClickMenu(true);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', padding: '4px 6px', borderRadius: '4px' }}
            >
              {getFileIcon(child.path)}
              <span className="node-name">{child.name}</span>
              <button
                onClick={(e) => toggleFavoriteFile(child.path, e)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: favoriteFiles.includes(child.path) ? '#f59e0b' : '#6b7280', fontSize: '0.8rem', marginLeft: 'auto' }}
                title="Favorite File"
              >
                ★
              </button>
              <div className="file-actions" style={{ display: 'flex', gap: '4px' }}>
                <button onClick={(e) => { e.stopPropagation(); const np = prompt('Rename file to:', child.path); if (np) renameFile(child.path, np); }} title="Rename File" style={{ border: 'none', background: 'transparent', fontSize: '0.85rem', cursor: 'pointer' }}>✏️</button>
                <button onClick={(e) => { e.stopPropagation(); if (confirm(`Delete file ${child.path}?`)) deleteFile(child.path); }} title="Delete File" style={{ border: 'none', background: 'transparent', fontSize: '0.85rem', cursor: 'pointer' }}>🗑️</button>
              </div>
            </div>
          )}
        </div>
      );
    });
  };

  const selectSearchResult = (pathStr, lineNum) => {
    selectFile(pathStr);
    setTimeout(() => {
      if (monacoRef.current) {
        monacoRef.current.revealLineInCenter(lineNum);
        monacoRef.current.setPosition({ lineNumber: lineNum, column: 1 });
        monacoRef.current.focus();
      }
    }, 120);
  };

  const commandPaletteOptions = [
    { label: 'Run Active File', action: () => handleRunCode() },
    { label: 'Format Document', action: () => formatActiveDocument() },
    { label: 'Toggle Console Terminal', action: () => setTerminalOpen(prev => !prev) },
    { label: 'Toggle AI Assistant Sidebar', action: () => setAiPanelOpen(prev => !prev) },
    {
      label: 'Create New File', action: () => {
        const name = prompt('Enter new file path (e.g. src/App.jsx):');
        if (name) createFile(name);
      }
    },
    { label: 'Switch Theme: VS Dark', action: () => setEditorTheme('vs-dark') },
    { label: 'Switch Theme: VS Light', action: () => setEditorTheme('vs-light') },
    { label: 'Switch Theme: Dracula', action: () => setEditorTheme('dracula') },
    { label: 'Switch Theme: Nord', action: () => setEditorTheme('nord') },
    { label: 'Switch Theme: Solarized Dark', action: () => setEditorTheme('solarized') },
    { label: 'Increase Font Size', action: () => setEditorFontSize(prev => Math.min(prev + 1, 30)) },
    { label: 'Decrease Font Size', action: () => setEditorFontSize(prev => Math.max(prev - 1, 10)) },
  ];

  const filteredCommands = commandPaletteOptions.filter(cmd =>
    cmd.label.toLowerCase().includes(commandPaletteQuery.toLowerCase())
  );

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
    const ownerToken = localStorage.getItem(`owner_token_${projectName}`) || localStorage.getItem(`owner_token_${projectName.toLowerCase()}`) || '';
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
      const savedOwnerToken = localStorage.getItem(`owner_token_${projectName}`) || localStorage.getItem(`owner_token_${projectName.toLowerCase()}`) || '';
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

      <main className={`project-editor-wrapper ${chatVisible ? '' : 'sidebar-hidden'}`}>
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
                  onClick={() => setChatVisible(!chatVisible)}
                  className="workspace-tour-trigger-btn"
                  title={chatVisible ? "Hide Sidebar Chat & Users" : "Show Sidebar Chat & Users"}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <MessageSquare size={13} /> <span className="btn-text">{chatVisible ? "Hide Chat" : "Show Chat"}</span>
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
              <div className="whiteboard-canvas-wrapper" style={{ position: 'relative' }}>
                {/* Floating Vertical Toolbar */}
                <div className="whiteboard-vertical-toolbar" onClick={(e) => e.stopPropagation()}>
                  <button
                    className={`tool-btn ${drawingTool === 'select' ? 'active' : ''}`}
                    onClick={() => { setDrawingTool('select'); setShowShapesPopover(false); setShowStylingPopover(false); }}
                    title="Select & Move Shapes"
                  >
                    <MousePointer size={20} />
                  </button>

                  <button
                    className={`tool-btn ${drawingTool === 'pen' ? 'active' : ''}`}
                    onClick={() => { setDrawingTool('pen'); setShowShapesPopover(false); setShowStylingPopover(false); }}
                    title="Draw Freehand"
                    style={drawingTool === 'pen' ? { borderLeft: `3px solid ${brushColor}` } : {}}
                  >
                    <Pencil size={20} />
                  </button>

                  <button
                    className={`tool-btn ${drawingTool === 'eraser' ? 'active' : ''}`}
                    onClick={() => { setDrawingTool('eraser'); setShowShapesPopover(false); setShowStylingPopover(false); }}
                    title="Erase Freehand Drawing"
                  >
                    <Eraser size={20} />
                  </button>

                  <div className="toolbar-divider" />

                  {/* Shapes Trigger */}
                  <div style={{ position: 'relative' }}>
                    <button
                      className={`tool-btn ${showShapesPopover ? 'active' : ''}`}
                      onClick={() => { setShowShapesPopover(!showShapesPopover); setShowStylingPopover(false); }}
                      title="Insert Shapes"
                    >
                      <Shapes size={20} />
                    </button>

                    {showShapesPopover && (
                      <div className="shapes-popover-card" onClick={(e) => e.stopPropagation()}>
                        <div className="popover-header">
                          <h4>Insert Shape</h4>
                          <button className="popover-close-btn" onClick={() => setShowShapesPopover(false)}>
                            <X size={14} />
                          </button>
                        </div>
                        <div className="shapes-grid">
                          <button
                            onClick={() => { addRect(); setShowShapesPopover(false); }}
                            className="shape-select-btn"
                            title="Rectangle"
                          >
                            <Square size={20} />
                            <span>Rectangle</span>
                          </button>
                          <button
                            onClick={() => { addCircle(); setShowShapesPopover(false); }}
                            className="shape-select-btn"
                            title="Circle"
                          >
                            <CircleIcon size={20} />
                            <span>Circle</span>
                          </button>
                          <button
                            onClick={() => { addTriangle(); setShowShapesPopover(false); }}
                            className="shape-select-btn"
                            title="Triangle"
                          >
                            <TriangleIcon size={20} />
                            <span>Triangle</span>
                          </button>
                          <button
                            onClick={() => { addLine(); setShowShapesPopover(false); }}
                            className="shape-select-btn"
                            title="Line"
                          >
                            <Minus size={20} style={{ transform: 'rotate(-45deg)' }} />
                            <span>Line</span>
                          </button>
                          <button
                            onClick={() => { addDiamond(); setShowShapesPopover(false); }}
                            className="shape-select-btn"
                            title="Diamond"
                          >
                            <Diamond size={20} />
                            <span>Diamond</span>
                          </button>
                          <button
                            onClick={() => { addArrow(); setShowShapesPopover(false); }}
                            className="shape-select-btn"
                            title="Arrow"
                          >
                            <ArrowRight size={20} />
                            <span>Arrow</span>
                          </button>
                          <button
                            onClick={() => { addStar(); setShowShapesPopover(false); }}
                            className="shape-select-btn"
                            title="Star"
                          >
                            <Star size={20} />
                            <span>Star</span>
                          </button>
                          <button
                            onClick={() => { addHeart(); setShowShapesPopover(false); }}
                            className="shape-select-btn"
                            title="Heart"
                          >
                            <Heart size={20} />
                            <span>Heart</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Styling Trigger */}
                  <div style={{ position: 'relative' }}>
                    <button
                      className={`tool-btn ${showStylingPopover ? 'active' : ''}`}
                      onClick={() => { setShowStylingPopover(!showStylingPopover); setShowShapesPopover(false); }}
                      title="Styling & Presets"
                      style={{ borderLeft: `3px solid ${brushColor}` }}
                    >
                      <Palette size={20} />
                    </button>

                    {showStylingPopover && (
                      <div className="styling-popover-card" onClick={(e) => e.stopPropagation()}>
                        <div className="popover-header">
                          <h4>Brush Styling</h4>
                          <button className="popover-close-btn" onClick={() => setShowStylingPopover(false)}>
                            <X size={14} />
                          </button>
                        </div>

                        <div className="popover-section">
                          <label>Presets</label>
                          <div className="color-presets" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                            {['#A93F55', '#1e293b', '#2563eb', '#16a34a', '#d97706', '#9333ea'].map((color) => (
                              <button
                                key={color}
                                className={`preset-color-btn ${brushColor.toLowerCase() === color.toLowerCase() ? 'selected' : ''}`}
                                style={{ backgroundColor: color, width: '20px', height: '20px', borderRadius: '50%', border: 'none', cursor: 'pointer', transition: 'var(--transition)' }}
                                onClick={() => setBrushColor(color)}
                                title={`Select Color ${color}`}
                              />
                            ))}
                            <div className="color-picker-wrapper" title="More Colors" style={{ position: 'relative', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <input
                                type="color"
                                value={brushColor}
                                onChange={(e) => setBrushColor(e.target.value)}
                                className="color-picker-input"
                                style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
                              />
                              <Palette size={13} className="color-picker-icon" style={{ color: 'var(--text-color)' }} />
                            </div>
                          </div>
                        </div>

                        <div className="popover-section">
                          <label>Thickness ({brushWidth}px)</label>
                          <div className="brush-presets" style={{ display: 'flex', gap: '8px' }}>
                            {[2, 5, 10, 20].map((size) => (
                              <button
                                key={size}
                                className={`brush-preset-btn ${brushWidth === size ? 'selected' : ''}`}
                                onClick={() => setBrushWidth(size)}
                                title={`Preset Width ${size}px`}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', cursor: 'pointer' }}
                              >
                                <span
                                  className="brush-dot"
                                  style={{ display: 'block', borderRadius: '50%', background: 'var(--text-color)', width: `${Math.min(size + 2, 14)}px`, height: `${Math.min(size + 2, 14)}px` }}
                                />
                              </button>
                            ))}
                          </div>
                          <div className="brush-slider-wrapper" style={{ marginTop: '8px' }}>
                            <input
                              type="range"
                              min="1"
                              max="30"
                              value={brushWidth}
                              onChange={(e) => setBrushWidth(parseInt(e.target.value))}
                              className="brush-slider"
                              title="Fine-tune brush width"
                              style={{ width: '100%' }}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="toolbar-divider" />

                  {/* Actions */}
                  <button onClick={deleteSelected} title="Delete Selected Shape" className="tool-btn text-danger">
                    <Scissors size={20} />
                  </button>

                  <button onClick={clearWhiteboard} title="Clear Drawing Board" className="tool-btn text-danger">
                    <Trash2 size={20} />
                  </button>

                  <button onClick={exportWhiteboard} title="Export Whiteboard JSON" className="tool-btn">
                    <Download size={20} />
                  </button>

                  <label className="tool-btn" title="Import Whiteboard JSON" style={{ display: 'flex', cursor: 'pointer', margin: 0, justifyContent: 'center', alignItems: 'center' }}>
                    <Upload size={20} />
                    <input
                      type="file"
                      accept=".json"
                      onChange={importWhiteboard}
                      style={{ display: 'none' }}
                    />
                  </label>
                </div>

                {/* Floating History / Undo-Redo Toolbar */}
                <div className="whiteboard-history-toolbar">
                  <button onClick={handleUndo} title="Undo last action" className="action-btn">
                    <Undo size={18} />
                  </button>
                  <button onClick={handleRedo} title="Redo last undone action" className="action-btn">
                    <Redo size={18} />
                  </button>
                </div>

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
            <div id="pane-code" className={`workspace-pane ${activeTab === 'code' ? 'active' : ''} upgraded-ide-pane`}>

              {/* Command Palette Overlay */}
              {showCommandPalette && (
                <div className="command-palette-overlay" onClick={() => setShowCommandPalette(false)}>
                  <div className="command-palette-modal" onClick={e => e.stopPropagation()}>
                    <input
                      type="text"
                      className="command-palette-input"
                      placeholder="Type a command to execute... (Theme, Format, File, Run)"
                      autoFocus
                      value={commandPaletteQuery}
                      onChange={e => setCommandPaletteQuery(e.target.value)}
                    />
                    <div className="command-palette-list">
                      {filteredCommands.length > 0 ? (
                        filteredCommands.map((cmd, idx) => (
                          <div
                            key={idx}
                            className="command-palette-item"
                            onClick={() => {
                              cmd.action();
                              setShowCommandPalette(false);
                              setCommandPaletteQuery('');
                            }}
                          >
                            <span>⚡</span>
                            <span>{cmd.label}</span>
                          </div>
                        ))
                      ) : (
                        <div className="command-palette-empty">No matching commands found.</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="ide-main-container">
                {/* 1. Activity Bar (Leftmost vertical dock) */}
                <div className="ide-activity-bar">
                  <div className="activity-bar-items">
                    <button
                      className={`activity-btn ${sidebarActiveView === 'explorer' ? 'active' : ''}`}
                      onClick={() => setSidebarActiveView('explorer')}
                      title="File Explorer"
                    >
                      📁
                    </button>
                    <button
                      className={`activity-btn ${sidebarActiveView === 'search' ? 'active' : ''}`}
                      onClick={() => setSidebarActiveView('search')}
                      title="Search Project"
                    >
                      🔍
                    </button>
                    <button
                      className={`activity-btn ${sidebarActiveView === 'users' ? 'active' : ''}`}
                      onClick={() => setSidebarActiveView('users')}
                      title="Collaboration & Presence"
                    >
                      👥
                    </button>
                    <button
                      className={`activity-btn ${sidebarActiveView === 'settings' ? 'active' : ''}`}
                      onClick={() => setSidebarActiveView('settings')}
                      title="Editor Settings"
                    >
                      ⚙️
                    </button>
                    <button
                      className={`activity-btn ${sidebarActiveView === 'timeline' ? 'active' : ''}`}
                      onClick={() => setSidebarActiveView('timeline')}
                      title="Room Activity Log"
                    >
                      🕒
                    </button>
                  </div>
                  <div className="activity-bar-footer">
                    <button
                      className={`activity-btn ${aiPanelOpen ? 'active' : ''}`}
                      onClick={() => setAiPanelOpen(!aiPanelOpen)}
                      title="AI Coding Assistant"
                    >
                      🤖
                    </button>
                  </div>
                </div>

                {/* 2. Sidebar Panel (Explorer, Search, presence stats, etc.) */}
                <div className="ide-sidebar-panel">
                  {sidebarActiveView === 'explorer' && (
                    <div className="sidebar-view explorer-view">
                      <div className="sidebar-section-header">
                        <span>WORKSPACE FILES</span>
                        <div className="explorer-header-actions">
                          <button onClick={() => { const fn = prompt('Enter new file path (e.g. index.js):'); if (fn) createFile(fn); }} title="New File">📄+</button>
                          <button onClick={() => { const fn = prompt('Enter new folder path (e.g. src):'); if (fn) { createFile(`${fn}/.keep`); } }} title="New Folder">📁+</button>
                        </div>
                      </div>

                      <div className="file-search-bar-wrapper">
                        <input
                          type="text"
                          className="file-search-bar"
                          placeholder="Filter files..."
                          value={fileSearchQuery}
                          onChange={e => setFileSearchQuery(e.target.value)}
                        />
                      </div>

                      {/* Recents Collapsible List */}
                      {recentFiles.length > 0 && (
                        <div className="sidebar-collapsible-section" style={{ marginBottom: '8px' }}>
                          <div className="sidebar-section-header"><span>🕒 Recent Files</span></div>
                          <div className="recent-files-list">
                            {recentFiles.map(fp => {
                              if (!files[fp]) return null;
                              return (
                                <div key={fp} className="file-node-item file-item" onClick={() => selectFile(fp)} style={{ padding: '3px 8px' }}>
                                  {getFileIcon(fp)}
                                  <span className="node-name" style={{ fontSize: '0.8rem' }}>{fp.split('/').pop()}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Favorites Collapsible List */}
                      {favoriteFiles.length > 0 && (
                        <div className="sidebar-collapsible-section" style={{ marginBottom: '8px' }}>
                          <div className="sidebar-section-header"><span>⭐ Starred Files</span></div>
                          <div className="favorite-files-list">
                            {favoriteFiles.map(fp => {
                              if (!files[fp]) return null;
                              return (
                                <div key={fp} className="file-node-item file-item" onClick={() => selectFile(fp)} style={{ padding: '3px 8px' }}>
                                  {getFileIcon(fp)}
                                  <span className="node-name" style={{ fontSize: '0.8rem' }}>{fp.split('/').pop()}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="file-tree-container">
                        {renderFileTree(buildFileTree(
                          Object.keys(files)
                            .filter(f => f.toLowerCase().includes(fileSearchQuery.toLowerCase()))
                            .reduce((acc, curr) => { acc[curr] = files[curr]; return acc; }, {})
                        ))}
                      </div>

                      {/* Code Outline Section */}
                      {outlineSymbols.length > 0 && (
                        <div className="sidebar-collapsible-section" style={{ marginTop: '14px', borderTop: '1px solid var(--ide-border)', paddingTop: '10px' }}>
                          <div className="sidebar-section-header"><span>🧬 OUTLINE</span></div>
                          <div className="outline-symbols-list" style={{ maxHeight: '160px', overflowY: 'auto' }}>
                            {outlineSymbols.map((sym, idx) => (
                              <div
                                key={idx}
                                className="outline-symbol-item"
                                onClick={() => {
                                  if (monacoRef.current) {
                                    monacoRef.current.revealLineInCenter(sym.line);
                                    monacoRef.current.setPosition({ lineNumber: sym.line, column: 1 });
                                    monacoRef.current.focus();
                                  }
                                }}
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', padding: '4px', cursor: 'pointer' }}
                              >
                                <span style={{ opacity: 0.6 }}>{sym.type === 'class' ? '🔷' : '⚡'}</span>
                                <span className="symbol-name">{sym.name}</span>
                                <span style={{ color: 'var(--ide-muted)', marginLeft: 'auto', fontSize: '0.7rem' }}>L{sym.line}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {sidebarActiveView === 'search' && (
                    <div className="sidebar-view search-view">
                      <div className="sidebar-section-header">
                        <span>SEARCH IN PROJECT</span>
                      </div>
                      <div className="project-search-form">
                        <input
                          type="text"
                          className="project-search-input"
                          placeholder="Search text..."
                          value={projectSearchQuery}
                          onChange={e => setProjectSearchQuery(e.target.value)}
                        />
                        <div className="search-options-row">
                          <label className={`search-opt-btn ${projectSearchCase ? 'active' : ''}`}>
                            <input type="checkbox" checked={projectSearchCase} onChange={e => setProjectSearchCase(e.target.checked)} style={{ display: 'none' }} />
                            Cc
                          </label>
                          <label className={`search-opt-btn ${projectSearchWord ? 'active' : ''}`}>
                            <input type="checkbox" checked={projectSearchWord} onChange={e => setProjectSearchWord(e.target.checked)} style={{ display: 'none' }} />
                            W
                          </label>
                          <label className={`search-opt-btn ${projectSearchRegex ? 'active' : ''}`}>
                            <input type="checkbox" checked={projectSearchRegex} onChange={e => setProjectSearchRegex(e.target.checked)} style={{ display: 'none' }} />
                            .*
                          </label>
                        </div>

                        {/* Replace field overlay */}
                        <div className="project-replace-container" style={{ marginTop: '8px', borderTop: '1px solid var(--ide-border)', paddingTop: '10px' }}>
                          <input
                            type="text"
                            className="project-search-input"
                            placeholder="Replace with..."
                            value={projectReplaceQuery}
                            onChange={e => setProjectReplaceQuery(e.target.value)}
                          />
                          <button
                            className="tabs-act-btn run-btn"
                            onClick={handleReplaceAll}
                            style={{ width: '100%', marginTop: '6px', height: '28px', padding: '0' }}
                          >
                            Replace All Matches
                          </button>
                        </div>
                      </div>

                      <div className="project-search-results">
                        {projectSearchResults.length > 0 ? (
                          projectSearchResults.map((res, idx) => (
                            <div
                              key={idx}
                              className="search-result-item"
                              style={{ position: 'relative' }}
                              onClick={() => selectSearchResult(res.path, res.lineNumber)}
                            >
                              <div className="result-file-path">{res.path} : L{res.lineNumber}</div>
                              <div className="result-snippet">{res.lineContent}</div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleReplaceOne(res.path, res.lineNumber, res.lineContent);
                                }}
                                style={{ position: 'absolute', right: '6px', top: '6px', background: 'rgba(255,255,255,0.06)', border: 'none', color: '#c9ccd3', borderRadius: '4px', cursor: 'pointer', fontSize: '0.72rem', padding: '2px 4px' }}
                                title="Replace only this occurrence"
                              >
                                Replace
                              </button>
                            </div>
                          ))
                        ) : (
                          projectSearchQuery && <div className="no-results">No matches found.</div>
                        )}
                      </div>
                    </div>
                  )}

                  {sidebarActiveView === 'users' && (
                    <div className="sidebar-view collaboration-presence-view">
                      <div className="sidebar-section-header">
                        <span>PARTICIPANTS</span>
                      </div>
                      <div className="presence-users-list">
                        <div className="presence-user-item self-presence" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span className="presence-dot active">🟢</span>
                            <span className="username-label">{username || 'Anonymous'} (You)</span>
                          </div>
                          <span className="role-label" style={{ fontSize: '0.7rem', padding: '2px 6px', background: '#3b82f6', borderRadius: '4px', fontWeight: 600 }}>{userRole}</span>
                        </div>
                        {users.map(u => {
                          const otherCursor = Object.values(presenceCursors).find(p => p.username === u.username);
                          return (
                            <div key={u.username} className="presence-user-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span className="presence-dot active">🟢</span>
                                <span className="username-label">{u.username}</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span className="editing-badge" style={{ fontSize: '0.7rem', opacity: 0.8 }}>
                                  {otherCursor ? otherCursor.path.split('/').pop() : 'Viewing'}
                                </span>
                                {isOwner && (
                                  <select
                                    value={u.role || 'Editor'}
                                    onChange={(e) => {
                                      socketRef.current?.emit('chat message', {
                                        room: projectName,
                                        msg: `[ROLE] ${u.username} set to ${e.target.value}`
                                      });
                                      addToast(`${u.username} role updated to ${e.target.value}`, 'info');
                                    }}
                                    style={{ background: 'var(--ide-bg)', border: '1px solid var(--ide-border)', color: 'var(--ide-text)', fontSize: '0.65rem', borderRadius: '4px', padding: '2px' }}
                                  >
                                    <option value="Editor">Editor</option>
                                    <option value="Viewer">Viewer</option>
                                  </select>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {sidebarActiveView === 'settings' && (
                    <div className="sidebar-view settings-view">
                      <div className="sidebar-section-header">
                        <span>EDITOR SETTINGS</span>
                      </div>
                      <div className="settings-controls">
                        <div className="setting-row">
                          <label>Font Size ({editorFontSize}px)</label>
                          <input
                            type="range"
                            min="10"
                            max="28"
                            value={editorFontSize}
                            onChange={e => setEditorFontSize(parseInt(e.target.value))}
                          />
                        </div>
                        <div className="setting-row">
                          <label>Line Height ({editorLineHeight}px)</label>
                          <input
                            type="range"
                            min="16"
                            max="36"
                            value={editorLineHeight}
                            onChange={e => setEditorLineHeight(parseInt(e.target.value))}
                          />
                        </div>
                        <div className="setting-row">
                          <label>Word Wrap</label>
                          <select value={editorWordWrap} onChange={e => setEditorWordWrap(e.target.value)}>
                            <option value="on">On</option>
                            <option value="off">Off</option>
                          </select>
                        </div>
                        <div className="setting-row">
                          <label>Tab Size</label>
                          <select value={editorTabSize} onChange={e => setEditorTabSize(parseInt(e.target.value))}>
                            <option value="2">2 Spaces</option>
                            <option value="4">4 Spaces</option>
                          </select>
                        </div>
                        <div className="setting-row">
                          <label>Editor Theme</label>
                          <select value={editorTheme} onChange={e => setEditorTheme(e.target.value)}>
                            <option value="vs-dark">VS Dark</option>
                            <option value="vs-light">VS Light</option>
                            <option value="dracula">Dracula</option>
                            <option value="nord">Nord</option>
                            <option value="solarized">Solarized Dark</option>
                          </select>
                        </div>

                        {/* Minimap / Sticky Toggles */}
                        <div className="setting-row" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px', borderTop: '1px solid var(--ide-border)', paddingTop: '10px' }}>
                          <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem' }}>
                            <input type="checkbox" checked={editorMinimap} onChange={e => setEditorMinimap(e.target.checked)} />
                            Enable Minimap
                          </label>
                          <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem' }}>
                            <input type="checkbox" checked={editorStickyScroll} onChange={e => setEditorStickyScroll(e.target.checked)} />
                            Enable Sticky Scroll
                          </label>
                          <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem' }}>
                            <input type="checkbox" checked={editorLineNumbers} onChange={e => setEditorLineNumbers(e.target.checked)} />
                            Show Line Numbers
                          </label>
                          <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem' }}>
                            <input type="checkbox" checked={editorFormatOnSave} onChange={e => setEditorFormatOnSave(e.target.checked)} />
                            Format on Save
                          </label>
                        </div>

                        {/* ZIP Exporter */}
                        <div className="setting-row" style={{ marginTop: '16px' }}>
                          <button className="tabs-act-btn run-btn" onClick={handleExportAsZip} style={{ width: '100%', height: '32px' }}>
                            📦 Export Project as ZIP
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {sidebarActiveView === 'timeline' && (
                    <div className="sidebar-view timeline-view">
                      <div className="sidebar-section-header">
                        <span>WORKSPACE LOGS</span>
                        <button
                          onClick={() => { setActivityLog([]); }}
                          title="Clear Log"
                          style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
                        >
                          🗑️
                        </button>
                      </div>
                      <div className="timeline-logs-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
                        {activityLog.length > 0 ? (
                          [...activityLog].reverse().map((evt, idx) => (
                            <div key={idx} className="timeline-log-item" style={{ padding: '6px', borderBottom: '1px solid var(--border-color)', fontSize: '0.78rem' }}>
                              <div className="log-time" style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                                {new Date(evt.timestamp).toLocaleTimeString()}
                              </div>
                              <div className="log-text" style={{ color: 'var(--text-color)', marginTop: '2px' }}>
                                {evt.text}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="no-logs" style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', paddingTop: '20px' }}>
                            No events logged yet.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. Main Editor Column */}
                <div className="ide-editor-column">
                  {/* Tabs Bar */}
                  <div className="ide-tabs-bar" style={{ display: 'flex', alignItems: 'center' }}>
                    {openTabs.map(tabPath => {
                      const file = files[tabPath];
                      if (!file) return null;
                      const isActive = activeFilePath === tabPath;
                      const isPinned = pinnedTabs.includes(tabPath);
                      return (
                        <div
                          key={tabPath}
                          className={`editor-tab-item ${isActive ? 'active' : ''} ${isPinned ? 'pinned' : ''}`}
                          onClick={() => selectFile(tabPath)}
                          style={{ position: 'relative' }}
                        >
                          {getFileIcon(tabPath)}
                          <span className="tab-name" style={{ marginRight: '6px' }}>{file.name}</span>

                          {/* Unsaved indicator */}
                          {unsavedFiles[tabPath] && <span className="tab-unsaved-dot" style={{ background: '#f59e0b', width: '6px', height: '6px', borderRadius: '50%', display: 'inline-block', marginRight: '6px' }}></span>}

                          {/* Pin option */}
                          <button
                            onClick={(e) => togglePinTab(tabPath, e)}
                            style={{ background: 'transparent', border: 'none', color: isPinned ? '#10b981' : '#4b5563', cursor: 'pointer', padding: '0 2px', fontSize: '0.72rem' }}
                            title="Pin Tab"
                          >
                            📌
                          </button>

                          {/* Close Option */}
                          {!isPinned && (
                            <button className="tab-close-btn" onClick={(e) => closeTabWithHistory(tabPath, e)}>×</button>
                          )}
                        </div>
                      );
                    })}
                    <div className="tabs-bar-spacer" />

                    {/* Reopen Closed Tab Option */}
                    {closedTabsHistory.length > 0 && (
                      <button
                        onClick={reopenLastClosedTab}
                        className="tabs-act-btn outline-btn"
                        style={{ height: '24px', fontSize: '0.7rem', padding: '0 6px', marginRight: '8px' }}
                        title="Reopen last closed tab (Ctrl+Shift+T)"
                      >
                        ↩️ Reopen Tab
                      </button>
                    )}

                    {/* Review Mode Toggle Badge */}
                    <button
                      onClick={() => setCodeReviewMode(prev => !prev)}
                      className={`tabs-act-btn ${codeReviewMode ? 'run-btn' : 'outline-btn'}`}
                      style={{ height: '24px', fontSize: '0.7rem', padding: '0 6px', marginRight: '8px' }}
                      title="Toggle Review Mode"
                    >
                      👁️ {codeReviewMode ? 'Review Mode: On' : 'Review Mode'}
                    </button>
                    {/* Collaborative Avatars Bar */}
                    <div className="ide-presence-avatars-row">
                      {users.slice(0, 4).map(u => {
                        const col = presenceColors[Math.abs(u.username.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % presenceColors.length];
                        return (
                          <div
                            key={u.username}
                            className="presence-avatar-circle"
                            style={{ backgroundColor: col }}
                            title={`${u.username} is editing`}
                          >
                            {u.username.slice(0, 2).toUpperCase()}
                          </div>
                        );
                      })}
                      {users.length > 4 && (
                        <div className="presence-avatar-circle more-badge" title="More active users">
                          +{users.length - 4}
                        </div>
                      )}
                    </div>
                    {/* Run / Format buttons inside tabs bar */}
                    <div className="tabs-action-buttons">
                      <button onClick={() => setShowCommandPalette(true)} className="tabs-act-btn outline-btn" title="Command Palette (Ctrl+Shift+P)">
                        ⌨️
                      </button>
                      <button onClick={formatActiveDocument} className="tabs-act-btn outline-btn" title="Format Document">
                        ✨ Format
                      </button>
                      <button
                        onClick={handleRunCode}
                        className={`tabs-act-btn run-btn ${terminalIsRunning ? 'loading' : ''}`}
                        disabled={terminalIsRunning}
                        title="Run Code (Ctrl + Enter)"
                      >
                        {terminalIsRunning ? '⏳ Executing...' : '▶ Run'}
                      </button>
                    </div>
                  </div>

                  {/* Breadcrumbs Bar */}
                  {activeFilePath && (
                    <div className="ide-breadcrumbs-bar" style={{ padding: '6px 16px', background: 'rgba(0, 0, 0, 0.12)', borderBottom: '1px solid var(--ide-border)', fontSize: '0.75rem', color: 'var(--ide-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>📁 {projectName || 'root'}</span>
                      {activeFilePath.split('/').map((p, idx) => (
                        <span key={idx}>&gt; {p}</span>
                      ))}
                      {Object.keys(typingUsers).length > 0 && (
                        <span className="typing-indicator" style={{ marginLeft: 'auto', color: '#10b981', animation: 'pulse 1.5s infinite' }}>
                          ✍️ {Object.keys(typingUsers).join(', ')} typing...
                        </span>
                      )}
                    </div>
                  )}

                  {/* Monaco Editor Pane */}
                  <div className="ide-monaco-wrapper">
                    {activeFilePath && files[activeFilePath] ? (
                      <Editor
                        height="100%"
                        language={files[activeFilePath].language}
                        theme={editorTheme === 'dracula' || editorTheme === 'nord' || editorTheme === 'solarized' ? editorTheme : (editorTheme === 'vs-light' ? 'vs' : 'vs-dark')}
                        value={files[activeFilePath].content}
                        onChange={handleCodeChange}
                        onMount={handleEditorDidMount}
                        options={{
                          fontSize: editorFontSize,
                          fontFamily: editorFontFamily,
                          lineHeight: editorLineHeight,
                          wordWrap: editorWordWrap,
                          tabSize: editorTabSize,
                          minimap: { enabled: editorMinimap },
                          lineNumbers: editorLineNumbers ? 'on' : 'off',
                          roundedSelection: true,
                          scrollBeyondLastLine: false,
                          cursorBlinking: 'smooth',
                          cursorSmoothCaretAnimation: 'on',
                          automaticLayout: true,
                          stickyScroll: { enabled: editorStickyScroll },
                          readOnly: userRole === 'Viewer'
                        }}
                      />
                    ) : (
                      <div className="empty-editor-placeholder">
                        <div className="placeholder-content">
                          <h3>AnonHub Collaborative IDE</h3>
                          <p>Select or create a file from the explorer sidebar to begin editing.</p>
                          <div className="shortcut-guide">
                            <div><span>Ctrl + Shift + P</span> Command Palette</div>
                            <div><span>Ctrl + Enter</span> Run Active File</div>
                            <div><span>Ctrl + S</span> Manual Snapshot Save</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Status Bar */}
                  <div className="ide-status-bar">
                    <span className="status-item font-semibold">
                      {saveStatus === 'Saving...' ? '⏳ Autosaving...' : '✅ Saved'}
                    </span>
                    <span className="status-item text-xs text-muted">
                      Last Saved: {lastSavedTime}
                    </span>
                    <span className="status-item-spacer" />
                    {activeFilePath && (
                      <>
                        <span className="status-item uppercase">{files[activeFilePath]?.language}</span>
                        <span className="status-item">UTF-8</span>
                      </>
                    )}
                  </div>
                </div>

                {/* 4. AI Coding Assistant Sidebar */}
                {aiPanelOpen && (
                  <div className="ide-ai-panel">
                    <div className="ai-panel-header">
                      <span>🤖 AI Assistant</span>
                      <button onClick={() => setAiPanelOpen(false)}>×</button>
                    </div>
                    <div className="ai-shortkey-actions" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                      <button onClick={() => handleAiAction('explain')} title="Explain Selected Code">Explain</button>
                      <button onClick={() => handleAiAction('fix')} title="Find & Fix Bugs">Fix Bugs</button>
                      <button onClick={() => handleAiAction('optimize')} title="Optimize Code">Optimize</button>
                      <button onClick={() => handleAiAction('refactor')} title="Refactor Code">Refactor</button>
                      <button onClick={() => handleAiAction('comments')} title="Add Inline Comments">Add Comments</button>
                      <button onClick={() => handleAiAction('tests')} title="Generate Unit Tests">Gen Tests</button>
                      <button onClick={() => handleAiAction('convert')} title="Convert Code Language">Convert Code</button>
                      <button onClick={() => handleAiAction('error')} title="Explain Compiler Errors">Fix Compile Error</button>
                    </div>
                    <div className="ai-chat-history">
                      {aiLogs.length > 0 ? (
                        aiLogs.map((logItem, idx) => (
                          <div key={idx} className={`ai-chat-bubble ${logItem.role === 'user' ? 'user-bubble' : 'model-bubble'}`}>
                            <div className="bubble-sender">{logItem.role === 'user' ? 'You' : 'Gemini AI'}</div>
                            <div className="bubble-text" style={{ whiteSpace: 'pre-wrap' }}>{logItem.text}</div>
                          </div>
                        ))
                      ) : (
                        <div className="ai-chat-placeholder">
                          Ask questions, fix bugs, optimize algorithms, or explain code selections.
                        </div>
                      )}
                      {aiLoading && <div className="ai-loading-indicator">⏳ Thinking...</div>}
                    </div>
                    <form
                      className="ai-chat-input-wrapper"
                      onSubmit={e => {
                        e.preventDefault();
                        sendAiMessage(aiMessageInput);
                      }}
                    >
                      <input
                        type="text"
                        className="ai-chat-input"
                        placeholder="Ask Gemini anything..."
                        value={aiMessageInput}
                        onChange={e => setAiMessageInput(e.target.value)}
                      />
                      <button type="submit" disabled={aiLoading}>Send</button>
                    </form>
                  </div>
                )}
              </div>

              {/* Bottom Multi-Tab Panel (Console, Problems, Reviews, snapshots) */}
              {terminalOpen && (
                <div className="ide-bottom-terminal">
                  <div className="terminal-panel-header" style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                    <div className="terminal-tabs-row" style={{ display: 'flex', gap: '8px' }}>
                      <button
                        className={`terminal-tab-btn ${bottomTerminalActiveTab === 'console' ? 'active' : ''}`}
                        onClick={() => setBottomTerminalActiveTab('console')}
                        style={{ background: 'transparent', border: 'none', color: bottomTerminalActiveTab === 'console' ? 'var(--ide-accent)' : 'var(--ide-muted)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', padding: '4px 8px' }}
                      >
                        💻 Console Shell
                      </button>
                      <button
                        className={`terminal-tab-btn ${bottomTerminalActiveTab === 'problems' ? 'active' : ''}`}
                        onClick={() => setBottomTerminalActiveTab('problems')}
                        style={{ background: 'transparent', border: 'none', color: bottomTerminalActiveTab === 'problems' ? 'var(--ide-accent)' : 'var(--ide-muted)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', padding: '4px 8px' }}
                      >
                        ⚠️ Problems ({editorMarkers.length})
                      </button>
                      <button
                        className={`terminal-tab-btn ${bottomTerminalActiveTab === 'reviews' ? 'active' : ''}`}
                        onClick={() => setBottomTerminalActiveTab('reviews')}
                        style={{ background: 'transparent', border: 'none', color: bottomTerminalActiveTab === 'reviews' ? 'var(--ide-accent)' : 'var(--ide-muted)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', padding: '4px 8px' }}
                      >
                        💬 Code Reviews
                      </button>
                      <button
                        className={`terminal-tab-btn ${bottomTerminalActiveTab === 'snapshots' ? 'active' : ''}`}
                        onClick={() => setBottomTerminalActiveTab('snapshots')}
                        style={{ background: 'transparent', border: 'none', color: bottomTerminalActiveTab === 'snapshots' ? 'var(--ide-accent)' : 'var(--ide-muted)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', padding: '4px 8px' }}
                      >
                        🕒 Snapshots ({snapshots.length})
                      </button>
                    </div>

                    {bottomTerminalActiveTab === 'console' && terminalStats && (
                      <span className="terminal-stats-badge">
                        ⏱️ {terminalStats.time} | 💾 {terminalStats.memory} | Status: {terminalStats.status}
                      </span>
                    )}

                    <div className="terminal-panel-actions" style={{ marginLeft: 'auto' }}>
                      {bottomTerminalActiveTab === 'console' && terminalIsRunning && (
                        <button onClick={handleStopExecution} style={{ color: '#ff5555', borderColor: '#ff5555', marginRight: '6px' }}>Stop</button>
                      )}
                      <button onClick={() => { setTerminalOutput(''); setTerminalStats(null); }}>Clear Output</button>
                      <button onClick={() => setTerminalOpen(false)}>×</button>
                    </div>
                  </div>

                  <div className="terminal-panel-content-area" style={{ flex: 1, overflow: 'hidden' }}>
                    {bottomTerminalActiveTab === 'console' && (
                      <div className="terminal-panel-body-grid" style={{ height: '100%' }}>
                        {/* Left: stdin inputs */}
                        <div className="terminal-input-column">
                          <div className="column-label">User Input (stdin)</div>
                          <textarea
                            className="terminal-textarea input-textarea"
                            placeholder="Type program input data here before running..."
                            value={terminalStdin}
                            onChange={e => setTerminalStdin(e.target.value)}
                          />
                        </div>
                        {/* Right: stdout/stderr outputs */}
                        <div className="terminal-output-column">
                          <div className="column-label">Program Output (stdout/stderr)</div>
                          {files[activeFilePath]?.language === 'html' && showPreview ? (
                            <iframe
                              srcDoc={files[activeFilePath]?.content}
                              title="HTML Live Preview"
                              sandbox="allow-scripts"
                              className="html-live-iframe"
                              style={{ width: '100%', height: 'calc(100% - 20px)', border: 'none', background: 'white' }}
                            />
                          ) : (
                            <pre className="terminal-output-pre">{terminalOutput || 'Shell console output idle.'}</pre>
                          )}
                        </div>
                      </div>
                    )}

                    {bottomTerminalActiveTab === 'problems' && (
                      <div className="problems-tab-body" style={{ padding: '12px', overflowY: 'auto', height: '100%' }}>
                        {editorMarkers.length > 0 ? (
                          editorMarkers.map((marker, idx) => (
                            <div
                              key={idx}
                              className={`problem-item ${marker.severity === 8 ? 'error' : 'warning'}`}
                              onClick={() => {
                                if (monacoRef.current) {
                                  monacoRef.current.revealLineInCenter(marker.startLineNumber);
                                  monacoRef.current.setPosition({ lineNumber: marker.startLineNumber, column: marker.startColumn });
                                  monacoRef.current.focus();
                                }
                              }}
                              style={{ padding: '6px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '0.78rem', cursor: 'pointer', display: 'flex', gap: '8px', color: marker.severity === 8 ? '#ff5555' : '#ffb86c' }}
                            >
                              <span>{marker.severity === 8 ? '❌ Error' : '⚠️ Warning'}</span>
                              <span>Line {marker.startLineNumber}:</span>
                              <span style={{ color: 'var(--ide-text)' }}>{marker.message}</span>
                            </div>
                          ))
                        ) : (
                          <div className="no-problems" style={{ padding: '12px', color: 'var(--ide-muted)', fontSize: '0.8rem', textAlign: 'center' }}>
                            No problems detected in active document.
                          </div>
                        )}
                      </div>
                    )}

                    {bottomTerminalActiveTab === 'reviews' && (
                      <div className="reviews-tab-body" style={{ padding: '12px', overflowY: 'auto', height: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input
                            type="number"
                            placeholder="Line"
                            style={{ width: '60px', background: '#0d0d11', border: '1px solid var(--ide-border)', color: '#fff', padding: '6px', borderRadius: '4px' }}
                            value={activeReviewCommentLine || ''}
                            onChange={e => setActiveReviewCommentLine(parseInt(e.target.value))}
                          />
                          <input
                            type="text"
                            placeholder="Add review feedback for this line..."
                            style={{ flex: 1, background: '#0d0d11', border: '1px solid var(--ide-border)', color: '#fff', padding: '6px', borderRadius: '4px' }}
                            value={reviewCommentInput}
                            onChange={e => setReviewCommentInput(e.target.value)}
                          />
                          <button className="tabs-act-btn run-btn" onClick={() => addInlineComment(activeReviewCommentLine)} style={{ padding: '0 12px' }}>
                            Comment
                          </button>
                        </div>
                        <div className="reviews-comments-list" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {(inlineComments[activeFilePath] || []).length > 0 ? (
                            (inlineComments[activeFilePath] || []).map((comm, idx) => (
                              <div key={idx} style={{ padding: '6px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '0.78rem' }}>
                                <span style={{ color: '#38bdf8', fontWeight: 600 }}>L{comm.line}</span> | <strong>{comm.author}:</strong> <span style={{ color: '#e5e7eb' }}>{comm.text}</span>
                              </div>
                            ))
                          ) : (
                            <div style={{ color: 'var(--ide-muted)', fontSize: '0.8rem', textAlign: 'center', paddingTop: '10px' }}>No review comments for this file.</div>
                          )}
                        </div>
                      </div>
                    )}

                    {bottomTerminalActiveTab === 'snapshots' && (
                      <div className="snapshots-tab-body" style={{ padding: '12px', overflowY: 'auto', height: '100%', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {snapshots.length > 0 ? (
                          snapshots.map((snap, idx) => (
                            <button
                              key={idx}
                              className="tabs-act-btn outline-btn"
                              onClick={() => restoreSnapshot(snap)}
                              style={{ fontSize: '0.72rem', height: '30px' }}
                            >
                              Restore frame ({new Date(snap.timestamp).toLocaleTimeString()})
                            </button>
                          ))
                        ) : (
                          <div style={{ color: 'var(--ide-muted)', fontSize: '0.8rem', width: '100%', textAlign: 'center', paddingTop: '10px' }}>
                            No automatic history snapshots stored yet. Snapshots save every minute.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Toast Notifications Overlay */}
              <div className="ide-toast-container" style={{ position: 'fixed', bottom: '24px', right: '24px', display: 'flex', flexDirection: 'column', gap: '8px', zIndex: 9999 }}>
                {toasts.map(toast => (
                  <div key={toast.id} className={`ide-toast toast-${toast.type}`} style={{ minWidth: '220px', padding: '12px 16px', borderRadius: '8px', color: '#fff', fontSize: '0.82rem', fontWeight: 600, display: 'flex', alignItems: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', animation: 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1)', background: toast.type === 'success' ? '#10b981' : (toast.type === 'error' ? '#ff5555' : (toast.type === 'warning' ? '#ffb86c' : '#3b82f6')) }}>
                    <span>{toast.message}</span>
                  </div>
                ))}
              </div>

              {/* Right Click Context Menu Overlay */}
              {showRightClickMenu && (
                <div className="right-click-menu-overlay" onClick={() => setShowRightClickMenu(false)} onContextMenu={(e) => { e.preventDefault(); setShowRightClickMenu(false); }} style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 9999 }}>
                  <div className="context-menu" style={{ position: 'absolute', top: rightClickMenuPos.y, left: rightClickMenuPos.x, background: 'var(--ide-card)', border: '1px solid var(--ide-border)', borderRadius: '8px', padding: '4px 0', minWidth: '150px', boxShadow: '0 4px 12px rgba(0,0,0,0.4)', pointerEvents: 'auto' }}>
                    <div className="context-menu-item" onClick={() => {
                      if (activeRightClickPath) {
                        setPinnedTabs(prev => prev.includes(activeRightClickPath) ? prev.filter(t => t !== activeRightClickPath) : [...prev, activeRightClickPath]);
                        addToast('Tab Pin state updated.', 'info');
                      }
                      setShowRightClickMenu(false);
                    }} style={{ padding: '8px 12px', fontSize: '0.8rem', cursor: 'pointer', display: 'flex', gap: '8px', color: 'var(--ide-text)' }}>
                      📌 {pinnedTabs.includes(activeRightClickPath) ? 'Unpin File' : 'Pin File'}
                    </div>
                    <div className="context-menu-item" onClick={(e) => {
                      if (activeRightClickPath) toggleFavoriteFile(activeRightClickPath, e);
                      setShowRightClickMenu(false);
                    }} style={{ padding: '8px 12px', fontSize: '0.8rem', cursor: 'pointer', display: 'flex', gap: '8px', color: 'var(--ide-text)' }}>
                      ⭐ {favoriteFiles.includes(activeRightClickPath) ? 'Remove Favorite' : 'Add Favorite'}
                    </div>
                    <div className="context-menu-item" onClick={() => {
                      if (activeRightClickPath) {
                        const np = prompt('Rename file to:', activeRightClickPath);
                        if (np) renameFile(activeRightClickPath, np);
                      }
                      setShowRightClickMenu(false);
                    }} style={{ padding: '8px 12px', fontSize: '0.8rem', cursor: 'pointer', display: 'flex', gap: '8px', color: 'var(--ide-text)' }}>
                      ✏️ Rename File
                    </div>
                    <div className="context-menu-item" onClick={() => {
                      if (activeRightClickPath && confirm(`Delete ${activeRightClickPath}?`)) {
                        deleteFile(activeRightClickPath);
                      }
                      setShowRightClickMenu(false);
                    }} style={{ padding: '8px 12px', fontSize: '0.8rem', cursor: 'pointer', display: 'flex', gap: '8px', color: '#ff5555' }}>
                      🗑️ Delete File
                    </div>
                  </div>
                </div>
              )}
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

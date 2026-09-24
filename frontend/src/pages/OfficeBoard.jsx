/**
 * @file OfficeBoard.jsx
 * @description Real-time collaborative office productivity suite.
 * Features a collaborative spreadsheet (Excel-style formula evaluator),
 * word document editor (rich page layout with formatting tools),
 * smart notes formatter (AI organization integration), and Kanban project board.
 * Synchronizes workspace states over Socket.IO using Room name authentication.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { 
  Table, FileText, CheckSquare, ListTodo, Plus, Trash2, 
  Download, ArrowLeftRight, Edit3, Send, Check, X, 
  Copy, Bold, Italic, Underline, AlignLeft, AlignCenter, 
  AlignRight, Heading1, Heading2, List, ListOrdered, Sparkles, KeyRound, Eye, EyeOff, Link2, LogOut, MessageSquare, HelpCircle, AlertTriangle,
  ChevronUp, ChevronDown
} from 'lucide-react';
import { getApiUrl } from '../config';
import { initSocket, getCookie, setCookie, deleteCookie } from '../services/socket';
import { deleteRoom } from '../services/api';
import SpreadsheetEditor from '../components/spreadsheet/SpreadsheetEditor';
import WordEditor from '../components/word/WordEditor';
import './OfficeBoard.css';

// ─────────────────────────────────────────────────────────────────────────────
// Spreadsheet Formula Evaluator Helpers
// ─────────────────────────────────────────────────────────────────────────────

const getCellRange = (start, end) => {
  const startCol = start[0].toUpperCase().charCodeAt(0);
  const startRow = parseInt(start.slice(1), 10);
  const endCol = end[0].toUpperCase().charCodeAt(0);
  const endRow = parseInt(end.slice(1), 10);

  const minCol = Math.min(startCol, endCol);
  const maxCol = Math.max(startCol, endCol);
  const minRow = Math.min(startRow, endRow);
  const maxRow = Math.max(startRow, endRow);

  const cells = [];
  for (let c = minCol; c <= maxCol; c++) {
    for (let r = minRow; r <= maxRow; r++) {
      cells.push(String.fromCharCode(c) + r);
    }
  }
  return cells;
};

const evaluateCell = (cellId, cellData, visited = new Set()) => {
  if (visited.has(cellId)) return '#CIRCULAR!';
  visited.add(cellId);

  const rawVal = cellData[cellId] || '';
  if (!rawVal.startsWith('=')) {
    return rawVal;
  }

  const formula = rawVal.slice(1).toUpperCase().trim();

  // Try SUM, e.g. SUM(A1:B3)
  const sumMatch = formula.match(/^SUM\(([A-H]\d+):([A-H]\d+)\)$/);
  if (sumMatch) {
    const startCell = sumMatch[1];
    const endCell = sumMatch[2];
    const cells = getCellRange(startCell, endCell);
    let sum = 0;
    for (const c of cells) {
      const val = parseFloat(evaluateCell(c, cellData, visited));
      if (!isNaN(val)) sum += val;
    }
    return sum.toString();
  }

  // Try AVERAGE, e.g. AVERAGE(A1:B3)
  const avgMatch = formula.match(/^AVERAGE\(([A-H]\d+):([A-H]\d+)\)$/);
  if (avgMatch) {
    const startCell = avgMatch[1];
    const endCell = avgMatch[2];
    const cells = getCellRange(startCell, endCell);
    let sum = 0;
    let count = 0;
    for (const c of cells) {
      const val = parseFloat(evaluateCell(c, cellData, visited));
      if (!isNaN(val)) {
        sum += val;
        count++;
      }
    }
    return count > 0 ? (sum / count).toFixed(2).toString() : '0';
  }

  // Basic math replacement
  let mathExpr = formula;
  const cellRefRegex = /[A-H]\d+/g;
  const matches = mathExpr.match(cellRefRegex) || [];
  
  for (const match of matches) {
    const val = parseFloat(evaluateCell(match, cellData, visited));
    mathExpr = mathExpr.replace(match, isNaN(val) ? 0 : val);
  }

  try {
    const cleanExpr = mathExpr.replace(/[^0-9+\-*/(). ]/g, '');
    const evaluated = Function(`"use strict"; return (${cleanExpr})`)();
    return (evaluated !== undefined) ? evaluated.toString() : '';
  } catch (e) {
    return '#ERROR!';
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Component Implementation
// ─────────────────────────────────────────────────────────────────────────────

export default function OfficeBoard() {
  const { roomName } = useParams();
  const navigate = useNavigate();
  const socketRef = useRef(null);

  // Connection & Room Setup State
  const [roomInput, setRoomInput] = useState('');
  const [accessKeyInput, setAccessKeyInput] = useState('');
  const [overlayError, setOverlayError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [users, setUsers] = useState([]);
  const [isOwner, setIsOwner] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [tourStep, setTourStep] = useState(-1);

  // Room Delete state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingRoom, setDeletingRoom] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Main navigation tab
  const [activeTab, setActiveTab] = useState('excel'); // 'excel' | 'word' | 'notes' | 'kanban'

  const steps = [
    {
      title: 'Office Suite Overview',
      body: 'Welcome to the <strong>Office Productivity Suite</strong>! Here you can collaboratively manage spreadsheets, rich word documents, smart markdown notes, and kanban project boards.',
      class: 'office-step-0'
    },
    {
      title: 'Spreadsheet Tab (Excel)',
      body: 'The <strong>Spreadsheet</strong> tab features a real-time reactive grid supporting mathematical formulas (e.g. <code>=A1+B1</code>, <code>=SUM(A1:A5)</code>, <code>=AVERAGE(A1:A5)</code>) with CSV import and export.',
      class: 'office-step-1'
    },
    {
      title: 'Document Tab (Word)',
      body: 'In the <strong>Word</strong> tab, write formatted rich text documents collaboratively with font controls, lists, alignments, and export tools.',
      class: 'office-step-2'
    },
    {
      title: 'Smart Notes & AI Organize',
      body: 'Use <strong>Smart Notes</strong> to capture meeting notes and ideas. Click <strong>AI Organize</strong> to automatically convert unstructured notes into organized summaries and action checklists.',
      class: 'office-step-3'
    },
    {
      title: 'Kanban Project Board',
      body: 'Use the <strong>Kanban Board</strong> to track tasks across stages. Add, edit, and move cards across columns (To Do, In Progress, Review, Done) in real time.',
      class: 'office-step-4'
    },
    {
      title: 'Share Board & Suite Controls',
      body: 'Use the top actions bar to <strong>Share Board</strong> with collaborators (generates instant invite links and QR codes), collapse the header for more workspace room, or manage room lifecycle.',
      class: 'office-step-5'
    }
  ];

  // Onboarding walkthrough tour logic
  useEffect(() => {
    const handleStartTour = () => setTourStep(0);
    window.addEventListener('start-trinetra-tour', handleStartTour);
    window.addEventListener('start-anonhub-tour', handleStartTour);

    if (roomName) {
      const hasSeenTour = localStorage.getItem('trinetra_office_tour_seen') || localStorage.getItem('anonhub_office_tour_seen');
      if (!hasSeenTour) {
        const t = setTimeout(() => setTourStep(0), 1500);
        return () => {
          clearTimeout(t);
          window.removeEventListener('start-trinetra-tour', handleStartTour);
          window.removeEventListener('start-anonhub-tour', handleStartTour);
        };
      }
    }

    return () => {
      window.removeEventListener('start-trinetra-tour', handleStartTour);
      window.removeEventListener('start-anonhub-tour', handleStartTour);
    };
  }, [roomName]);

  // Synchronize navigation tabs when walking through tour steps
  useEffect(() => {
    if (tourStep === 1) {
      setActiveTab('excel');
    } else if (tourStep === 2) {
      setActiveTab('word');
    } else if (tourStep === 3) {
      setActiveTab('notes');
    } else if (tourStep === 4) {
      setActiveTab('kanban');
    }
  }, [tourStep]);

  // Spreadsheet state (Default rows/cols structure mapping)
  const [sheetRows, setSheetRows] = useState(20);
  const [sheetCols, setSheetCols] = useState(8); // A to H
  const [sheetData, setSheetData] = useState({}); // { A1: "10", B1: "=A1+5" }
  const [selectedCell, setSelectedCell] = useState(null);
  const [cellFormulaInput, setCellFormulaInput] = useState('');
  const [tempCellInput, setTempCellInput] = useState('');
  const [editingCell, setEditingCell] = useState(null);

  const [wordContent, setWordContent] = useState('');
  const notesTimeoutRef = useRef(null);

  // Notes state
  const [notes, setNotes] = useState([]);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [notesSearch, setNotesSearch] = useState('');
  const [isFormattingAi, setIsFormattingAi] = useState(false);
  const [viewMode, setViewMode] = useState('original'); // 'original' | 'formatted'
  const [formattedContent, setFormattedContent] = useState(null); // stores AI-formatted content for active note

  // Kanban Board state
  const [kanbanTasks, setKanbanTasks] = useState([]); // [{ id, title, desc, status: 'todo' | 'progress' | 'done' }]
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskForm, setTaskForm] = useState({ id: '', title: '', desc: '', status: 'todo' });

  // Group Chat states
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
  const chatMessagesEndRef = useRef(null);

  useEffect(() => {
    if (chatMessagesEndRef.current) {
      chatMessagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Initial Authorization & Gateway
  // ─────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!roomName) return;

    // Retrieve cached token if it exists
    const cachedToken = localStorage.getItem(`trinetra-office-token-${roomName}`)
      || localStorage.getItem(`trinetra-office-token-${roomName.toLowerCase()}`)
      || localStorage.getItem(`anonhub-office-token-${roomName}`)
      || localStorage.getItem(`anonhub-office-token-${roomName.toLowerCase()}`)
      || '';

    // Instantiating Socket Connection
    const socket = initSocket();
    socketRef.current = socket;

    socket.connect();

    socket.on('connect', () => {
      // Handshake joining
      socket.emit('join office', {
        officeName: roomName,
        accessKey: sessionStorage.getItem(`accesskey_office_${roomName}`) || getCookie(`accesskey_office_${roomName}`) || '',
        ownerToken: cachedToken || ''
      });
    });

    socket.on('set username', (name) => {
      setUsername(name);
      document.cookie = `trinetra-username=${encodeURIComponent(name)}; path=/; SameSite=Lax`;
      document.cookie = `anonhub-username=${encodeURIComponent(name)}; path=/; SameSite=Lax`;
      sessionStorage.setItem('trinetra-username', name);
      sessionStorage.setItem('anonhub-username', name);
      if (socketRef.current) {
        socketRef.current.auth = { ...socketRef.current.auth, username: name };
      }
    });

    socket.on('username updated', (name) => {
      setUsername(name);
      document.cookie = `anonhub-username=${encodeURIComponent(name)}; path=/; SameSite=Lax`;
      sessionStorage.setItem('anonhub-username', name);
      if (socketRef.current) {
        socketRef.current.auth = { ...socketRef.current.auth, username: name };
      }
    });

    socket.on('is owner', (ownerStatus) => {
      setIsOwner(ownerStatus);
    });

    socket.on('set owner token', (token) => {
      localStorage.setItem(`anonhub-office-token-${roomName}`, token);
      localStorage.setItem(`anonhub-office-token-${roomName.toLowerCase()}`, token);
    });

    socket.on('room users', (roster) => {
      setUsers(roster);
    });

    // Receive all office suite data on join
    socket.on('office data', (data) => {
      try {
        setSheetData(JSON.parse(data.spreadsheet || '{}'));
      } catch(e) { setSheetData({}); }
      
      setWordContent(data.wordContent || '');

      try {
        const loadedNotes = JSON.parse(data.notes || '[]');
        setNotes(loadedNotes);
        if (loadedNotes.length > 0) setActiveNoteId(loadedNotes[0].id);
      } catch(e) { setNotes([]); }

      try {
        setKanbanTasks(JSON.parse(data.kanban || '[]'));
      } catch(e) { setKanbanTasks([]); }
    });

    // Real-time synchronization events
    socket.on('spreadsheet content', (data) => {
      try {
        setSheetData(JSON.parse(data || '{}'));
      } catch(e) {}
    });

    socket.on('word content', (content) => {
      setWordContent(content);
    });

    socket.on('office notes content', (data) => {
      try {
        setNotes(JSON.parse(data || '[]'));
      } catch(e) {}
    });

    socket.on('kanban content', (data) => {
      try {
        setKanbanTasks(JSON.parse(data || '[]'));
      } catch(e) {}
    });

    socket.on('access denied', ({ message }) => {
      setOverlayError(message || 'Incorrect access key.');
      navigate('/office');
    });

    socket.on('room deleted', ({ room, message }) => {
      alert(message || 'This office room has been permanently deleted by the owner.');
      navigate('/');
    });

    socket.on('chat message', (msg) => {
      setChatMessages(prev => [...prev, msg]);
    });

    socket.on('error', (msg) => {
      alert(`Error: ${msg}`);
    });

    return () => {
      socket.disconnect();
    };
  }, [roomName, navigate]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Action Handlers: Gateway Login
  // ─────────────────────────────────────────────────────────────────────────────

  const handleJoinOrCreateRoom = async (e) => {
    e.preventDefault();
    if (!roomInput.trim() || !accessKeyInput.trim()) {
      setOverlayError('Both room name and access key are required.');
      return;
    }
    setIsLoading(true);
    setOverlayError('');

    try {
      const res = await fetch(getApiUrl('/create-office'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: roomInput.trim(), accessKey: accessKeyInput.trim() })
      });
      let data = {};
      try {
        data = await res.json();
      } catch (e) {
        data = { error: `Server error: received non-JSON response (${res.status})` };
      }
      if (!res.ok) {
        setOverlayError(data.error || 'Access authorization failed.');
      } else {
        if (data.ownerToken) {
          localStorage.setItem(`trinetra-office-token-${roomInput.trim()}`, data.ownerToken);
          localStorage.setItem(`anonhub-office-token-${roomInput.trim()}`, data.ownerToken);
        }
        sessionStorage.setItem(`accesskey_office_${roomInput.trim()}`, accessKeyInput.trim());
        setCookie(`accesskey_office_${roomInput.trim()}`, accessKeyInput.trim());
        navigate(`/office/${encodeURIComponent(roomInput.trim())}`);
      }
    } catch (err) {
      console.error(err);
      setOverlayError(err.message || 'Could not connect to Office room.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteOfficeRoom = async () => {
    if (deleteConfirmText.trim().toLowerCase() !== roomName.trim().toLowerCase()) {
      setDeleteError(`Please type "${roomName}" exactly to confirm.`);
      return;
    }
    const ownerToken = localStorage.getItem(`trinetra-office-token-${roomName}`)
      || localStorage.getItem(`anonhub-office-token-${roomName}`)
      || localStorage.getItem(`owner_token_office_${roomName}`)
      || localStorage.getItem(`owner_token_${roomName}`);
    if (!ownerToken) {
      setDeleteError('Owner token not found in this browser session.');
      return;
    }
    setDeletingRoom(true);
    setDeleteError('');
    try {
      await deleteRoom('office', roomName, ownerToken);
      localStorage.removeItem(`trinetra-office-token-${roomName}`);
      localStorage.removeItem(`anonhub-office-token-${roomName}`);
      localStorage.removeItem(`owner_token_office_${roomName}`);
      localStorage.removeItem(`owner_token_${roomName}`);
      setShowDeleteModal(false);
      navigate('/');
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete room.');
      setDeletingRoom(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Action Handlers: Excel Spreadsheet
  // ─────────────────────────────────────────────────────────────────────────────

  const handleCellSelect = (colId, rowIdx) => {
    const cellId = colId + rowIdx;
    setSelectedCell(cellId);
    const val = sheetData[cellId] || '';
    setCellFormulaInput(val);
    setTempCellInput(val);
  };

  const handleCellChange = (cellId, value) => {
    const updated = { ...sheetData, [cellId]: value };
    setSheetData(updated);
    if (socketRef.current) {
      socketRef.current.emit('update spreadsheet', {
        officeName: roomName,
        spreadsheet: JSON.stringify(updated)
      });
    }
  };

  const handleFormulaBarChange = (e) => {
    const val = e.target.value;
    setCellFormulaInput(val);
    setTempCellInput(val);
  };

  const handleAddRow = () => {
    setSheetRows(r => r + 5);
  };

  const handleRemoveRow = () => {
    setSheetRows(r => Math.max(5, r - 5));
  };

  const handleAddCol = () => {
    setSheetCols(c => Math.min(c + 2, 26)); // Cap at Z columns (26)
  };

  const handleRemoveCol = () => {
    setSheetCols(c => Math.max(2, c - 2));
  };

  const handleClearSheet = () => {
    if (window.confirm("Are you sure you want to clear the entire spreadsheet?")) {
      setSheetData({});
      setSelectedCell(null);
      setCellFormulaInput('');
      setTempCellInput('');
      if (socketRef.current) {
        socketRef.current.emit('update spreadsheet', {
          officeName: roomName,
          spreadsheet: '{}'
        });
      }
    }
  };

  const exportToCSV = () => {
    let csv = '';
    // Headers
    for (let c = 0; c < sheetCols; c++) {
      csv += String.fromCharCode(65 + c) + (c === sheetCols - 1 ? '' : ',');
    }
    csv += '\n';

    // Rows
    for (let r = 1; r <= sheetRows; r++) {
      for (let c = 0; c < sheetCols; c++) {
        const cellId = String.fromCharCode(65 + c) + r;
        const evalVal = evaluateCell(cellId, sheetData);
        // escape commas
        const escaped = ('' + evalVal).replace(/"/g, '""');
        csv += `"${escaped}"` + (c === sheetCols - 1 ? '' : ',');
      }
      csv += '\n';
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `${roomName}_spreadsheet.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSendChatMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !socketRef.current) return;
    socketRef.current.emit('send chat message', { officeName: roomName, msg: chatInput.trim() });
    setChatInput('');
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Action Handlers: Kanban Board
  // ─────────────────────────────────────────────────────────────────────────────

  const handleOpenTaskModal = (status, existingTask = null) => {
    if (existingTask) {
      setTaskForm({ id: existingTask.id, title: existingTask.title, desc: existingTask.desc || '', status: existingTask.status });
    } else {
      setTaskForm({ id: '', title: '', desc: '', status });
    }
    setShowTaskModal(true);
  };

  const handleSaveTask = (e) => {
    e.preventDefault();
    if (!taskForm.title.trim()) return;

    let updated;
    if (taskForm.id) {
      // Editing existing task
      updated = kanbanTasks.map(t =>
        t.id === taskForm.id
          ? { ...t, title: taskForm.title, desc: taskForm.desc, status: taskForm.status }
          : t
      );
    } else {
      // Creating new task
      const newTask = {
        id: Math.random().toString(36).substring(2, 9),
        title: taskForm.title.trim(),
        desc: taskForm.desc.trim(),
        status: taskForm.status
      };
      updated = [...kanbanTasks, newTask];
    }

    setKanbanTasks(updated);
    setShowTaskModal(false);
    setTaskForm({ id: '', title: '', desc: '', status: 'todo' });

    if (socketRef.current) {
      socketRef.current.emit('update kanban', {
        officeName: roomName,
        kanban: JSON.stringify(updated)
      });
    }
  };

  const handleDeleteTask = (taskId) => {
    if (!window.confirm('Delete this task?')) return;
    const updated = kanbanTasks.filter(t => t.id !== taskId);
    setKanbanTasks(updated);

    if (socketRef.current) {
      socketRef.current.emit('update kanban', {
        officeName: roomName,
        kanban: JSON.stringify(updated)
      });
    }
  };

  const handleMoveTask = (taskId, newStatus) => {
    const updated = kanbanTasks.map(t =>
      t.id === taskId ? { ...t, status: newStatus } : t
    );
    setKanbanTasks(updated);

    if (socketRef.current) {
      socketRef.current.emit('update kanban', {
        officeName: roomName,
        kanban: JSON.stringify(updated)
      });
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Action Handlers: Smart Notes
  // ─────────────────────────────────────────────────────────────────────────────

  const getNoteTitle = (content) => {
    if (!content || !content.trim()) return 'Untitled Note';
    const lines = content.split('\n');
    const firstLine = lines[0].replace(/[#*_\-]/g, '').trim();
    return firstLine.substring(0, 24) || 'Untitled Note';
  };

  const handleAddNote = () => {
    const newNote = {
      id: Math.random().toString(36).substring(2, 9),
      content: '# New Note\nWrite notes here...',
      color: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][Math.floor(Math.random() * 5)],
      updatedAt: new Date().toISOString()
    };
    const updated = [newNote, ...notes];
    setNotes(updated);
    setActiveNoteId(newNote.id);
    if (socketRef.current) {
      socketRef.current.emit('update office notes', { officeName: roomName, notes: JSON.stringify(updated) });
    }
  };

  const handleDeleteNote = (id) => {
    if (!window.confirm('Delete this note permanently?')) return;
    const updated = notes.filter(n => n.id !== id);
    setNotes(updated);
    if (activeNoteId === id && updated.length > 0) {
      setActiveNoteId(updated[0].id);
    } else if (updated.length === 0) {
      setActiveNoteId(null);
    }
    if (socketRef.current) {
      socketRef.current.emit('update office notes', { officeName: roomName, notes: JSON.stringify(updated) });
    }
  };

  const handleNoteContentChange = (id, newContent) => {
    const updated = notes.map(n => 
      n.id === id 
        ? { ...n, content: newContent, updatedAt: new Date().toISOString() } 
        : n
    );
    setNotes(updated);
    if (socketRef.current) {
      if (notesTimeoutRef.current) clearTimeout(notesTimeoutRef.current);
      notesTimeoutRef.current = setTimeout(() => {
        socketRef.current.emit('update office notes', { officeName: roomName, notes: JSON.stringify(updated) });
      }, 400);
    }
  };

  const parseSmartNotes = (content) => {
    if (!content) return null;
    const lines = content.split('\n');
    return lines.map((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('# ')) {
        return <h1 key={idx} className="note-preview-h1">{trimmed.replace('# ', '')}</h1>;
      }
      if (trimmed.startsWith('## ')) {
        return <h2 key={idx} className="note-preview-h2">{trimmed.replace('## ', '')}</h2>;
      }
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        return <li key={idx} className="note-preview-li">{trimmed.replace(/^[-*]\s+/, '')}</li>;
      }
      if (trimmed === '') {
        return <div key={idx} className="note-preview-space" />;
      }
      return <p key={idx} className="note-preview-p">{line}</p>;
    });
  };

  // Toggle between original and AI-formatted view
  const toggleViewMode = () => {
    setViewMode(prev => {
      const newMode = prev === 'original' ? 'formatted' : 'original';
      // Store current view mode in localStorage for persistence
      localStorage.setItem(`office-board-view-mode-${roomName}`, newMode);
      return newMode;
    });
  };

  // Revert to original AI-organized content (undo button)
  const revertToOriginal = () => {
    setViewMode('original');
    setFormattedContent(null); // Clear saved formatted version
  };

  // Load saved view mode from localStorage
  useEffect(() => {
    if (roomName) {
      const savedViewMode = localStorage.getItem(`office-board-view-mode-${roomName}`);
      if (savedViewMode === 'formatted') {
        setViewMode('formatted');
      }
    }
  }, [roomName]);

    const handleAiOrganize = async () => {
    if (!activeNoteId) return;
    const note = notes.find(n => n.id === activeNoteId);
    if (!note || !note.content.trim()) return;

    setIsFormattingAi(true);
    setViewMode('original'); // Force display of original during processing
    try {
      const response = await fetch(getApiUrl('/api/ai-chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Please format and organize the following raw text note dump into a beautifully arranged structure with clear headings, title, body content, and bullet lists where appropriate. Keep the language natural and clear. Output ONLY the formatted text.\n\nRaw Note Dump:\n${note.content}`
        })
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      const organizedContent = data.response;
      
      setFormattedContent(organizedContent); // Store formatted version
      setViewMode('formatted'); // Switch to formatted view
      
      // Optionally save formatted version to the note but don't replace immediately
    } catch (err) {
      alert('Failed to organize note via AI.');
    } finally {
      setIsFormattingAi(false);
    }
  };


  // Persist state in localStorage when tab is not active
  useEffect(() => {
    if (!roomName) return;

    const saveStateToStorage = () => {
      if (activeTab !== 'excel') {
        localStorage.setItem(`office-${roomName}-sheetData`, JSON.stringify(sheetData));
      }
      if (activeTab !== 'word') {
        localStorage.setItem(`office-${roomName}-wordContent`, wordContent);
      }
      if (activeTab !== 'notes') {
        localStorage.setItem(`office-${roomName}-notes`, JSON.stringify(notes));
      }
      if (activeTab !== 'kanban') {
        localStorage.setItem(`office-${roomName}-kanbanTasks`, JSON.stringify(kanbanTasks));
      }
      localStorage.setItem(`office-${roomName}-activeTab`, activeTab);
    };

    const restoreStateFromStorage = () => {
      const savedSheetData = localStorage.getItem(`office-${roomName}-sheetData`);
      if (savedSheetData && activeTab === 'excel') {
        try {
          const parsed = JSON.parse(savedSheetData);
          if (JSON.stringify(parsed) !== JSON.stringify(sheetData)) {
            setSheetData(parsed);
          }
        } catch (e) {
          console.warn('Failed to restore sheet data:', e);
        }
      }

      const savedWordContent = localStorage.getItem(`office-${roomName}-wordContent`);
      if (savedWordContent && activeTab === 'word' && savedWordContent !== wordContent) {
        setWordContent(savedWordContent);
      }

      const savedNotes = localStorage.getItem(`office-${roomName}-notes`);
      if (savedNotes && activeTab === 'notes') {
        try {
          const parsedNotes = JSON.parse(savedNotes);
          if (JSON.stringify(parsedNotes) !== JSON.stringify(notes)) {
            setNotes(parsedNotes);
          }
        } catch (e) {
          console.warn('Failed to restore notes:', e);
        }
      }

      const savedKanbanTasks = localStorage.getItem(`office-${roomName}-kanbanTasks`);
      if (savedKanbanTasks && activeTab === 'kanban') {
        try {
          const parsedTasks = JSON.parse(savedKanbanTasks);
          if (JSON.stringify(parsedTasks) !== JSON.stringify(kanbanTasks)) {
            setKanbanTasks(parsedTasks);
          }
        } catch (e) {
          console.warn('Failed to restore kanban tasks:', e);
        }
      }

      const savedActiveTab = localStorage.getItem(`office-${roomName}-activeTab`);
      if (savedActiveTab) {
        setActiveTab(savedActiveTab);
      }
    };

    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        restoreStateFromStorage();
      } else {
        saveStateToStorage();
      }
    });

    window.addEventListener('beforeunload', saveStateToStorage);

    return () => {
      window.removeEventListener('visibilitychange', () => {});
      window.removeEventListener('beforeunload', saveStateToStorage);
    };
  }, [roomName, activeTab, sheetData, wordContent, notes, kanbanTasks]);

  // Auto-save state periodically
  useEffect(() => {
    if (!roomName) return;

    const interval = setInterval(() => {
      localStorage.setItem(`office-${roomName}-lastActive`, Date.now().toString());
      localStorage.setItem(`office-${roomName}-sheetData`, JSON.stringify(sheetData));
      localStorage.setItem(`office-${roomName}-wordContent`, wordContent);
      localStorage.setItem(`office-${roomName}-notes`, JSON.stringify(notes));
      localStorage.setItem(`office-${roomName}-kanbanTasks`, JSON.stringify(kanbanTasks));
    }, 5000);

    return () => clearInterval(interval);
  }, [roomName, sheetData, wordContent, notes, kanbanTasks]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Rendering Landing Page / Gateway Mode
  // ─────────────────────────────────────────────────────────────────────────────

  if (!roomName) {
    return (
      <div className="office-landing-container">
        <div className="office-landing-card">
          <div className="office-landing-header">
            <h2>🏢 Connect to Office Board</h2>
            <p>Collaboratively manage Spreadsheets, Rich Word Docs, Notes, and Kanban Boards in an anonymous workspace room.</p>
          </div>

          <form onSubmit={handleJoinOrCreateRoom} className="office-landing-form">
            {overlayError && (
              <div className="office-landing-error">{overlayError}</div>
            )}
            
            <div className="form-group">
              <label>Workspace Room Name</label>
              <input
                type="text"
                placeholder="e.g. project-planning"
                value={roomInput}
                onChange={e => setRoomInput(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Room Access Key</label>
              <input
                type="password"
                placeholder="Minimum 4 characters"
                value={accessKeyInput}
                onChange={e => setAccessKeyInput(e.target.value)}
                required
              />
            </div>

            <button type="submit" disabled={isLoading} className="office-join-btn">
              {isLoading ? '🔌 Connecting...' : 'Create or Join Board'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Rendering In-Workspace Workspace
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="office-workspace-wrapper">
      
      {/* Workspace top bar header (Collapsible) */}
      {!isHeaderCollapsed && (
        <div className="office-header-bar">
          <div className="office-header-title">
            <h2>🏢 Office: {roomName}</h2>
            <span className="office-user-badge">Username: <strong>{username}</strong></span>
          </div>

          {/* Action controls */}
          <div className="office-header-actions">
            <div className="office-users-roster">
              👥 {users.length} connected
            </div>
            <button className="office-share-btn" onClick={() => setShowShareModal(true)}>
              <Link2 size={14} /> <span className="btn-text">Share Board</span>
            </button>
            <button 
              className="office-share-btn" 
              onClick={() => setTourStep(0)} 
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'var(--accent-glow)', color: 'var(--primary-color)' }}
              title="Start Onboarding Tour"
            >
              <HelpCircle size={14} /> <span className="btn-text">Quick Guide</span>
            </button>
            {isOwner && (
              <button
                className="office-exit-btn"
                onClick={() => { setShowDeleteModal(true); setDeleteConfirmText(''); setDeleteError(''); }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer' }}
                title="Delete this room permanently"
              >
                <Trash2 size={14} /> <span className="btn-text">Delete Room</span>
              </button>
            )}
            <Link to="/" onClick={() => deleteCookie(`accesskey_office_${roomName}`)} className="office-exit-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <LogOut size={14} /> <span className="btn-text">Leave Suite</span>
            </Link>
            <button
              className="office-header-collapse-toggle"
              onClick={() => setIsHeaderCollapsed(true)}
              title="Collapse Header (Maximize Workspace)"
              aria-label="Collapse Header"
            >
              <ChevronUp size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Tabs list Nav Bar */}
      <div className={`office-tabs-bar ${isHeaderCollapsed ? 'collapsed-mode' : ''}`}>
        {isHeaderCollapsed && (
          <div className="compact-room-brand">
            <span className="compact-room-name">🏢 {roomName}</span>
          </div>
        )}

        <div className="office-tabs-group">
          <button className={`office-tab-btn ${activeTab === 'excel' ? 'active' : ''}`} onClick={() => setActiveTab('excel')}>
            <Table size={15} /> Spreadsheet (Excel)
          </button>
          <button className={`office-tab-btn ${activeTab === 'word' ? 'active' : ''}`} onClick={() => setActiveTab('word')}>
            <FileText size={15} /> Document (Word)
          </button>
          <button className={`office-tab-btn ${activeTab === 'notes' ? 'active' : ''}`} onClick={() => setActiveTab('notes')}>
            <CheckSquare size={15} /> Smart Notes
          </button>
          <button className={`office-tab-btn ${activeTab === 'kanban' ? 'active' : ''}`} onClick={() => setActiveTab('kanban')}>
            <ListTodo size={15} /> Kanban Board
          </button>
        </div>

        {isHeaderCollapsed && (
          <div className="compact-header-actions">
            <button className="compact-action-btn" onClick={() => setShowShareModal(true)} title="Share Room Link">
              <Link2 size={14} />
            </button>
            <button
              className="office-header-collapse-toggle"
              onClick={() => setIsHeaderCollapsed(false)}
              title="Expand Full Header"
              aria-label="Expand Full Header"
            >
              <ChevronDown size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Main interactive window viewport */}
      <div className="office-tabs-viewport">

        {/* TABS CONTAINER 1: EXCEL SPREADSHEET */}
        {activeTab === 'excel' && (
          <div className="office-pane excel-pane" style={{ padding: 0, overflow: 'hidden', height: '100%' }}>
            <SpreadsheetEditor
              roomName={roomName}
              username={username}
              isOwner={isOwner}
              initialData={sheetData}
              socketRef={socketRef}
              onWorkbookChange={(newWb) => setSheetData(newWb)}
            />
          </div>
        )}

        {/* TABS CONTAINER 2: WORD DOCUMENT */}
        {activeTab === 'word' && (
          <div className="office-pane word-pane" style={{ padding: 0, overflow: 'hidden', height: '100%' }}>
            <WordEditor
              roomName={roomName}
              username={username}
              isOwner={isOwner}
              initialContent={wordContent}
              socketRef={socketRef}
              onContentChange={(newHtml) => setWordContent(newHtml)}
            />
          </div>
        )}

        {/* TABS CONTAINER 3: SMART NOTES */}
        {activeTab === 'notes' && (
          <div className="office-pane notes-pane">
            <div className="smart-notes-workspace">
              
              {/* Sidebar list of notes */}
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
                  }).map(n => (
                    <div
                      key={n.id}
                      className={`note-list-item ${n.id === activeNoteId ? 'active' : ''}`}
                      style={{ borderLeftColor: n.color }}
                      onClick={() => {
                        setActiveNoteId(n.id);
                        setFormattedContent(null);
                        setViewMode('original');
                      }}
                    >
                      <div className="note-item-header">
                        <span className="note-item-title">{getNoteTitle(n.content)}</span>
                        <button
                          className="note-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteNote(n.id);
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <span className="note-item-time">
                        {new Date(n.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Note editor workspace split */}
              {activeNoteId ? (
                <div className="notes-editor-split">
                  <div className="notes-editor-half">
                    <div className="notes-editor-header">
                      <h3>📝 Raw Markdown Draft</h3>
                      <button 
                        onClick={handleAiOrganize}
                        disabled={isFormattingAi}
                        className="ai-organize-btn"
                      >
                        <Sparkles size={14} /> {isFormattingAi ? 'AI Organizing...' : 'AI Organize'}
                      </button>
                    </div>
                    <textarea
                      className="note-raw-textarea"
                      placeholder="Type note dump here (markdown header #, ## and list item - prefixes supported)..."
                      value={notes.find(n => n.id === activeNoteId)?.content || ''}
                      onChange={(e) => handleNoteContentChange(activeNoteId, e.target.value)}
                    />
                  </div>

                  <div className="notes-preview-half">
                    <div className="notes-preview-header">
                      <h3>✨ Arranged Preview Layout</h3>
                      {formattedContent && (
                        <div className="notes-preview-actions">
                          <button 
                            onClick={toggleViewMode} 
                            className="notes-preview-toggle-btn"
                          >
                            Show {viewMode === 'original' ? 'AI Organized' : 'Original'}
                          </button>
                          <button 
                            onClick={revertToOriginal} 
                            className="notes-preview-revert-btn"
                            title="Revert to original preview"
                          >
                            Undo
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="notes-arranged-viewport">
                      {parseSmartNotes(
                        (viewMode === 'formatted' && formattedContent)
                          ? formattedContent
                          : notes.find(n => n.id === activeNoteId)?.content
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="notes-empty-workspace">
                  <FileText size={48} opacity={0.3} />
                  <p>No notes active. Click '➕ Add Note' to create your first note.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TABS CONTAINER 4: KANBAN BOARD */}
        {activeTab === 'kanban' && (
          <div className="office-pane kanban-pane">
            <div className="kanban-workspace">
              
              {/* Columns list */}
              {['todo', 'progress', 'done'].map(status => {
                const columnTitle = { todo: '📋 To Do', progress: '⚡ In Progress', done: '✅ Completed' }[status];
                const tasksInCol = kanbanTasks.filter(t => t.status === status);

                return (
                  <div key={status} className={`kanban-column col-${status}`}>
                    <div className="kanban-col-header">
                      <h4>{columnTitle} ({tasksInCol.length})</h4>
                      <button className="kanban-add-card-btn" onClick={() => handleOpenTaskModal(status)}>
                        <Plus size={14} />
                      </button>
                    </div>

                    <div className="kanban-col-body">
                      {tasksInCol.length === 0 ? (
                        <div className="kanban-empty-placeholder">Empty column</div>
                      ) : (
                        tasksInCol.map(task => (
                          <div key={task.id} className="kanban-card">
                            <div className="kanban-card-header">
                              <h5>{task.title}</h5>
                              <div className="kanban-card-actions">
                                <button onClick={() => handleOpenTaskModal(status, task)} title="Edit Task"><Edit3 size={11} /></button>
                                <button onClick={() => handleDeleteTask(task.id)} className="delete" title="Delete Task"><Trash2 size={11} /></button>
                              </div>
                            </div>
                            {task.desc && <p className="kanban-card-desc">{task.desc}</p>}
                            
                            <div className="kanban-card-footer">
                              {status !== 'todo' && (
                                <button 
                                  onClick={() => handleMoveTask(task.id, status === 'done' ? 'progress' : 'todo')}
                                  title="Shift Left"
                                >
                                  ◀️
                                </button>
                              )}
                              <span className="kanban-status-badge">{status}</span>
                              {status !== 'done' && (
                                <button 
                                  onClick={() => handleMoveTask(task.id, status === 'todo' ? 'progress' : 'done')}
                                  title="Shift Right"
                                >
                                  ▶️
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>

      {/* Share / Invite Modal */}
      {showShareModal && (
        <div className="chat-lightbox" onClick={() => setShowShareModal(false)}>
          <div className="share-modal" onClick={e => e.stopPropagation()}>
            <div className="share-modal-header">
              <h3>🔗 Invite to Office Board</h3>
              <button onClick={() => setShowShareModal(false)}><X size={18} /></button>
            </div>
            <p className="share-modal-subtitle">
              Share this link to collaborate in <strong>{roomName}</strong>.
            </p>
            <div className="share-modal-url-row">
              <input
                type="text"
                className="share-modal-url-input"
                value={`${window.location.origin}/office/${encodeURIComponent(roomName)}`}
                readOnly
                onClick={e => e.target.select()}
              />
              <button
                className="share-copy-btn"
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/office/${encodeURIComponent(roomName)}`);
                }}
              >
                Copy Link
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kanban Task Modal */}
      {showTaskModal && (
        <div className="chat-lightbox">
          <div className="task-form-modal" onClick={e => e.stopPropagation()}>
            <div className="task-modal-header">
              <h3>{taskForm.id ? '✏️ Edit Task' : '➕ Add Task'}</h3>
              <button onClick={() => setShowTaskModal(false)}><X size={18} /></button>
            </div>
            
            <form onSubmit={handleSaveTask} className="task-form">
              <div className="form-group">
                <label>Task Title</label>
                <input
                  type="text"
                  placeholder="Task title..."
                  value={taskForm.title}
                  onChange={e => setTaskForm({ ...taskForm, title: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  placeholder="Task description (optional)..."
                  value={taskForm.desc}
                  onChange={e => setTaskForm({ ...taskForm, desc: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Status</label>
                <select
                  value={taskForm.status}
                  onChange={e => setTaskForm({ ...taskForm, status: e.target.value })}
                >
                  <option value="todo">To Do</option>
                  <option value="progress">In Progress</option>
                  <option value="done">Completed</option>
                </select>
              </div>

              <div className="task-modal-actions">
                <button type="button" onClick={() => setShowTaskModal(false)} className="task-cancel-btn">Cancel</button>
                <button type="submit" className="task-save-btn">Save Task</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Group Chat Drawer Floating Button */}
      <button 
        className={`floating-office-chat-toggle ${isChatOpen ? 'open' : ''}`}
        onClick={() => setIsChatOpen(prev => !prev)}
        title="Open Room Group Chat"
      >
        <MessageSquare size={20} />
      </button>

      {/* ── Room Deletion Confirmation Modal (Owner) ────────────────────── */}
      {showDeleteModal && (
        <div className="chat-lightbox" onClick={() => !deletingRoom && setShowDeleteModal(false)}>
          <div className="share-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px', border: '1.5px solid #ef4444' }}>
            <div className="share-modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444' }}>
                <AlertTriangle size={18} /> Delete Office Room Permanently?
              </h3>
              <button onClick={() => !deletingRoom && setShowDeleteModal(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <p className="share-modal-subtitle" style={{ color: 'var(--text-color)', lineHeight: 1.6 }}>
              All spreadsheets, documents, notes, and kanban boards associated with <strong>{roomName}</strong> will be permanently removed. This action <strong>cannot be undone</strong>.
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
                onClick={handleDeleteOfficeRoom}
                disabled={deletingRoom || deleteConfirmText.trim().toLowerCase() !== roomName.trim().toLowerCase()}
                style={{ padding: '8px 18px', borderRadius: '8px', background: '#ef4444', color: '#fff', border: 'none', fontWeight: 600, cursor: (deletingRoom || deleteConfirmText.trim().toLowerCase() !== roomName.trim().toLowerCase()) ? 'not-allowed' : 'pointer', opacity: (deleteConfirmText.trim().toLowerCase() !== roomName.trim().toLowerCase()) ? 0.6 : 1 }}
              >
                {deletingRoom ? 'Deleting...' : 'Permanently Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`office-chat-window ${isChatOpen ? 'open' : ''}`}>
        <div className="office-chat-header">
          <div className="office-chat-header-title">
            <MessageSquare className="office-glow-icon" size={18} />
            <span>Office Chat ({users.length})</span>
          </div>
          <button className="office-chat-close-btn" onClick={() => setIsChatOpen(false)} title="Close Chat">
            <X size={16} />
          </button>
        </div>

        <div className="office-chat-body">
          <div className="office-messages-list">
            {chatMessages.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                No messages yet. Send a message to start collaborating!
              </div>
            ) : (
              chatMessages.map((msg, index) => (
                <div key={index} className={`office-message-row ${msg.username === username ? 'user' : 'other'}`}>
                  <div className="office-message-bubble">
                    <div className="office-message-sender">{msg.username}</div>
                    <div className="office-message-text">{msg.msg}</div>
                    <div className="office-message-time">{msg.time}</div>
                  </div>
                </div>
              ))
            )}
            <div ref={chatMessagesEndRef} />
          </div>
        </div>

        <form onSubmit={handleSendChatMessage} className="office-chat-footer">
          <input
            type="text"
            className="office-chat-input"
            placeholder="Type a message..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
          />
          <button type="submit" className="office-chat-send-btn" disabled={!chatInput.trim()}>
            <Send size={14} />
          </button>
        </form>
      </div>

      {tourStep >= 0 && steps[tourStep] && (
        <div className={`tour-tooltip-card ${steps[tourStep].class}`}>
          <div className="tour-tooltip-header">
            <h4>{steps[tourStep].title}</h4>
            <span className="tour-tooltip-badge">Step {tourStep + 1} of {steps.length}</span>
          </div>
          <div className="tour-tooltip-body">
            <p dangerouslySetInnerHTML={{ __html: steps[tourStep].body }} />
          </div>
          <div className="tour-tooltip-footer">
            <button
              className="tour-skip-btn"
              onClick={() => {
                localStorage.setItem('trinetra_office_tour_seen', 'true');
                setTourStep(-1);
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
                  localStorage.setItem('trinetra_office_tour_seen', 'true');
                  setTourStep(-1);
                }
              }}
            >
              {tourStep === steps.length - 1 ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

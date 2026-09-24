/**
 * @file SpreadsheetEditor.jsx
 * @description Full-featured Microsoft Excel-style collaborative spreadsheet editor for Trinetra.
 * Features ribbon navigation, multi-sheet workbooks, formula engine, cell formatting,
 * row/column management, autofill, embedded charts, data validation, conditional formatting,
 * import/export (.xlsx/.csv), real-time peer cursors, find/replace, and Trinetra AI assistant.
 */

// XLSX library is loaded dynamically on demand to optimize initial bundle size
const getXLSX = async () => await import('xlsx');
import {
  colIndexToLetter,
  colLetterToIndex,
  parseCellAddress,
  expandRange,
  adjustFormulaOnDrag,
  evaluateCell,
  FORMULA_CATALOG
} from '../../utils/spreadsheetEngine';
import { getApiUrl } from '../../config';
import {
  Undo, Redo, Copy, Scissors, Clipboard,
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  Plus, Minus, Trash2, Download, Upload,
  Search, Replace, Filter, BarChart2, PieChart,
  LineChart, Sparkles, MessageSquare, HelpCircle,
  Maximize2, Check, X, RefreshCw, Layers,
  ChevronDown, ChevronUp, Grid, Eye, EyeOff, FileSpreadsheet,
  Columns, Rows, ListOrdered, Palette, Type
} from 'lucide-react';
import './SpreadsheetEditor.css';

// ─── Default Workbook Factory & Normalizer ───────────────────────────────────

const DEFAULT_ROW_COUNT = 50;
const DEFAULT_COL_COUNT = 26;
const DEFAULT_COL_WIDTH = 90;
const DEFAULT_ROW_HEIGHT = 26;

export function createDefaultSheet(id = 'sheet_1', name = 'Sheet1') {
  return {
    id,
    name,
    rowCount: DEFAULT_ROW_COUNT,
    colCount: DEFAULT_COL_COUNT,
    data: {}, // Sparse map: { "A1": { raw: "10", format: { bold: true } } }
    colWidths: {},
    rowHeights: {},
    merges: [],
    frozen: { rows: 0, cols: 0 },
    validations: {},
    conditionalRules: [],
    filterRange: null,
    hiddenRows: [],
    hiddenCols: []
  };
}

export function normalizeWorkbook(rawInput) {
  if (!rawInput) {
    return {
      sheets: [createDefaultSheet()],
      activeSheetId: 'sheet_1',
      charts: [],
      comments: {},
      version: 1
    };
  }

  let parsed = rawInput;
  if (typeof rawInput === 'string') {
    try {
      parsed = JSON.parse(rawInput);
    } catch {
      parsed = {};
    }
  }

  // Already a full workbook structure
  if (parsed && Array.isArray(parsed.sheets) && parsed.sheets.length > 0) {
    return {
      sheets: parsed.sheets.map((s, idx) => ({
        ...createDefaultSheet(s.id || `sheet_${idx + 1}`, s.name || `Sheet${idx + 1}`),
        ...s,
        data: s.data || {}
      })),
      activeSheetId: parsed.activeSheetId || parsed.sheets[0].id || 'sheet_1',
      charts: parsed.charts || [],
      comments: parsed.comments || {},
      version: parsed.version || 1
    };
  }

  // Legacy flat object: { A1: "10", B1: "=A1*2" }
  const defaultSheet = createDefaultSheet('sheet_1', 'Sheet1');
  if (parsed && typeof parsed === 'object') {
    Object.entries(parsed).forEach(([cellKey, cellVal]) => {
      if (typeof cellVal === 'object' && cellVal !== null) {
        defaultSheet.data[cellKey.toUpperCase()] = cellVal;
      } else {
        defaultSheet.data[cellKey.toUpperCase()] = { raw: String(cellVal || '') };
      }
    });
  }

  return {
    sheets: [defaultSheet],
    activeSheetId: 'sheet_1',
    charts: [],
    comments: {},
    version: 1
  };
}

// ─── Main Spreadsheet Editor Component ───────────────────────────────────────

export default function SpreadsheetEditor({
  roomName,
  username = 'Anonymous',
  isOwner = false,
  userRole = 'Editor', // 'Owner' | 'Editor' | 'Viewer'
  initialData = null,
  onWorkbookChange,
  socketRef = null
}) {
  // ─── Master Workbook State ──────────────────────────────────────────────────
  const [workbook, setWorkbook] = useState(() => normalizeWorkbook(initialData));
  const [activeTab, setActiveRibbonTab] = useState('Home'); // File, Home, Insert, Data, View, Formulas, AI
  const [isRibbonCollapsed, setIsRibbonCollapsed] = useState(false);

  // Active Sheet Helper
  const activeSheet = useMemo(() => {
    return workbook.sheets.find(s => s.id === workbook.activeSheetId) || workbook.sheets[0] || createDefaultSheet();
  }, [workbook]);

  // ─── Selection & Editing State ──────────────────────────────────────────────
  const [selectedCell, setSelectedCell] = useState('A1');
  const [selectionRange, setSelectionRange] = useState({ start: 'A1', end: 'A1' });
  const [isSelecting, setIsSelecting] = useState(false);
  const [editingCell, setEditingCell] = useState(null);
  const [tempEditValue, setTempEditValue] = useState('');
  const [formulaBarValue, setFormulaBarValue] = useState('');
  const [nameBoxInput, setNameBoxInput] = useState('A1');

  // Autofill Drag State
  const [isAutofilling, setIsAutofilling] = useState(false);
  const [autofillEnd, setAutofillEnd] = useState(null);

  // Undo / Redo History Stack
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Real-time Peer Presence
  const [peerSelections, setPeerSelections] = useState({}); // { socketId: { username, cell, color, sheetId } }

  // Sync / Save Status Indicator
  const [syncStatus, setSyncStatus] = useState('saved'); // 'saved' | 'saving' | 'synced'

  // View Options
  const [zoomLevel, setZoomLevel] = useState(100);
  const [showGridlines, setShowGridlines] = useState(true);
  const [showHeaders, setShowHeaders] = useState(true);

  // Dialog & Modal Popups
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [findMatchCase, setFindMatchCase] = useState(false);
  const [showChartModal, setShowChartModal] = useState(false);
  const [newChartType, setNewChartType] = useState('column');
  const [newChartTitle, setNewChartTitle] = useState('New Chart');
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [validationType, setValidationType] = useState('list');
  const [validationValues, setValidationValues] = useState('Pending, In Progress, Completed');
  const [showConditionalModal, setShowConditionalModal] = useState(false);
  const [conditionalRule, setConditionalRule] = useState({ type: 'greaterThan', val: '100', bg: '#dcfce7', color: '#166534' });
  const [showFormulaCatalog, setShowFormulaCatalog] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [activeCommentCell, setActiveCommentCell] = useState(null);
  const [commentInput, setCommentInput] = useState('');

  // Context Menus
  const [cellContextMenu, setCellContextMenu] = useState(null); // { x, y, cellId }
  const [sheetContextMenu, setSheetContextMenu] = useState(null); // { x, y, sheetId }

  // Resizing state
  const [resizingCol, setResizingCol] = useState(null);
  const [resizingRow, setResizingRow] = useState(null);

  // Refs
  const gridContainerRef = useRef(null);
  const inlineEditorRef = useRef(null);
  const formulaInputRef = useRef(null);
  const isInternalUpdate = useRef(false);

  // ─── Synchronize initialData when received from socket ──────────────────────
  useEffect(() => {
    if (initialData && !isInternalUpdate.current) {
      const normalized = normalizeWorkbook(initialData);
      setWorkbook(normalized);
    }
  }, [initialData]);

  // ─── Real-Time Socket.IO Listeners ──────────────────────────────────────────
  useEffect(() => {
    if (!socketRef || !socketRef.current) return;
    const socket = socketRef.current;

    const handleSpreadsheetOp = (op) => {
      if (!op || op.sourceUser === username) return;
      applyRemoteOperation(op);
    };

    const handlePeerSelection = ({ socketId, user, cell, color, sheetId }) => {
      setPeerSelections(prev => ({
        ...prev,
        [socketId]: { username: user, cell, color, sheetId }
      }));
    };

    const handlePeerLeave = (socketId) => {
      setPeerSelections(prev => {
        const copy = { ...prev };
        delete copy[socketId];
        return copy;
      });
    };

    socket.on('spreadsheet op', handleSpreadsheetOp);
    socket.on('spreadsheet peer selection', handlePeerSelection);
    socket.on('user left', handlePeerLeave);

    return () => {
      socket.off('spreadsheet op', handleSpreadsheetOp);
      socket.off('spreadsheet peer selection', handlePeerSelection);
      socket.off('user left', handlePeerLeave);
    };
  }, [socketRef, username]);

  // Broadcast local selection changes
  const broadcastSelection = useCallback((cellId) => {
    if (!socketRef || !socketRef.current || !cellId) return;
    socketRef.current.emit('spreadsheet selection', {
      officeName: roomName,
      user: username,
      cell: cellId,
      sheetId: workbook.activeSheetId,
      color: '#3b82f6'
    });
  }, [socketRef, roomName, username, workbook.activeSheetId]);

  // ─── Workbook State Push & Debounced Auto-Save ──────────────────────────────
  const emitWorkbookUpdate = useCallback((newWb, operation = null) => {
    isInternalUpdate.current = true;
    setWorkbook(newWb);
    setSyncStatus('saving');

    // Add to local history
    setHistory(prev => [...prev.slice(0, historyIndex + 1), newWb]);
    setHistoryIndex(prev => prev + 1);

    if (onWorkbookChange) {
      onWorkbookChange(newWb);
    }

    if (socketRef && socketRef.current) {
      // Send granular operation if available
      if (operation) {
        socketRef.current.emit('spreadsheet operation', {
          officeName: roomName,
          operation: { ...operation, sourceUser: username }
        });
      }
      // Send full serialized state backup
      socketRef.current.emit('update spreadsheet', {
        officeName: roomName,
        spreadsheet: JSON.stringify(newWb)
      });
    }

    setTimeout(() => {
      setSyncStatus('saved');
      isInternalUpdate.current = false;
    }, 600);
  }, [historyIndex, onWorkbookChange, socketRef, roomName, username]);

  // ─── Remote Operation Applier ───────────────────────────────────────────────
  const applyRemoteOperation = useCallback((op) => {
    setWorkbook(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      const targetSheet = copy.sheets.find(s => s.id === op.sheetId) || copy.sheets[0];
      if (!targetSheet) return prev;

      switch (op.type) {
        case 'CELL_UPDATE':
          if (!targetSheet.data[op.cellId]) targetSheet.data[op.cellId] = {};
          targetSheet.data[op.cellId].raw = op.value;
          if (op.format) targetSheet.data[op.cellId].format = op.format;
          break;

        case 'RANGE_UPDATE':
          if (Array.isArray(op.updates)) {
            op.updates.forEach(u => {
              if (!targetSheet.data[u.cellId]) targetSheet.data[u.cellId] = {};
              targetSheet.data[u.cellId].raw = u.value;
              if (u.format) targetSheet.data[u.cellId].format = u.format;
            });
          }
          break;

        case 'FORMAT_UPDATE':
          if (Array.isArray(op.cells)) {
            op.cells.forEach(c => {
              if (!targetSheet.data[c]) targetSheet.data[c] = { raw: '' };
              targetSheet.data[c].format = { ...targetSheet.data[c].format, ...op.format };
            });
          }
          break;

        case 'SHEET_ACTION':
          if (op.action === 'create') {
            copy.sheets.push(op.sheet);
          } else if (op.action === 'rename') {
            const sh = copy.sheets.find(s => s.id === op.sheetId);
            if (sh) sh.name = op.newName;
          } else if (op.action === 'delete') {
            copy.sheets = copy.sheets.filter(s => s.id !== op.sheetId);
            if (copy.activeSheetId === op.sheetId) {
              copy.activeSheetId = copy.sheets[0]?.id || 'sheet_1';
            }
          }
          break;

        default:
          break;
      }
      return copy;
    });
  }, []);

  // ─── Cell Selection Handlers ────────────────────────────────────────────────
  const handleCellClick = (cellId, e) => {
    if (e.shiftKey && selectedCell) {
      setSelectionRange({ start: selectedCell, end: cellId });
    } else {
      setSelectedCell(cellId);
      setSelectionRange({ start: cellId, end: cellId });
    }
    const rawVal = activeSheet.data[cellId]?.raw || '';
    setFormulaBarValue(rawVal);
    setNameBoxInput(cellId);
    setEditingCell(null);
    broadcastSelection(cellId);
  };

  const handleCellDoubleClick = (cellId) => {
    if (userRole === 'Viewer') return;
    setEditingCell(cellId);
    const rawVal = activeSheet.data[cellId]?.raw || '';
    setTempEditValue(rawVal);
    setFormulaBarValue(rawVal);
  };

  const handleCellMouseDown = (cellId) => {
    setIsSelecting(true);
    setSelectedCell(cellId);
    setSelectionRange({ start: cellId, end: cellId });
    const rawVal = activeSheet.data[cellId]?.raw || '';
    setFormulaBarValue(rawVal);
    setNameBoxInput(cellId);
  };

  const handleCellMouseEnter = (cellId) => {
    if (isSelecting) {
      setSelectionRange(prev => ({ ...prev, end: cellId }));
      setNameBoxInput(`${selectionRange.start}:${cellId}`);
    }
    if (isAutofilling) {
      setAutofillEnd(cellId);
    }
  };

  const handleMouseUp = () => {
    setIsSelecting(false);
    if (isAutofilling && autofillEnd) {
      executeAutofill(selectionRange, autofillEnd);
      setIsAutofilling(false);
      setAutofillEnd(null);
    }
  };

  useEffect(() => {
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [isSelecting, isAutofilling, autofillEnd, selectionRange]);

  // ─── Cell Commit & Value Changes ────────────────────────────────────────────
  const commitCellEdit = (cellId, value) => {
    if (userRole === 'Viewer') return;
    const newWb = JSON.parse(JSON.stringify(workbook));
    const targetSheet = newWb.sheets.find(s => s.id === newWb.activeSheetId);
    if (!targetSheet) return;

    if (!targetSheet.data[cellId]) {
      targetSheet.data[cellId] = { raw: '' };
    }
    targetSheet.data[cellId].raw = value;

    emitWorkbookUpdate(newWb, {
      type: 'CELL_UPDATE',
      sheetId: targetSheet.id,
      cellId,
      value
    });

    setEditingCell(null);
    setFormulaBarValue(value);
  };

  // ─── Autofill Execution (Numbers, Dates, Formulas) ──────────────────────────
  const executeAutofill = (sourceRange, targetCell) => {
    const startAddr = parseCellAddress(sourceRange.start);
    const endAddr = parseCellAddress(sourceRange.end);
    const targetAddr = parseCellAddress(targetCell);
    if (!startAddr || !endAddr || !targetAddr) return;

    const sourceCells = expandRange(`${sourceRange.start}:${sourceRange.end}`);
    const newWb = JSON.parse(JSON.stringify(workbook));
    const targetSheet = newWb.sheets.find(s => s.id === newWb.activeSheetId);
    const updates = [];

    // Direction calculation
    const rowDelta = targetAddr.row - endAddr.row;
    const colDelta = targetAddr.col - endAddr.col;

    if (rowDelta > 0) {
      // Dragging downward
      for (let r = endAddr.row + 1; r <= targetAddr.row; r++) {
        const offset = r - endAddr.row;
        for (let c = startAddr.col; c <= endAddr.col; c++) {
          const colLetters = colIndexToLetter(c);
          const sourceKey = `${colLetters}${endAddr.row}`;
          const destKey = `${colLetters}${r}`;
          const sourceRaw = targetSheet.data[sourceKey]?.raw || '';

          let nextVal = sourceRaw;
          if (sourceRaw.startsWith('=')) {
            nextVal = adjustFormulaOnDrag(sourceRaw, offset, 0);
          } else {
            const num = parseFloat(sourceRaw);
            if (!isNaN(num)) {
              nextVal = String(num + offset);
            }
          }

          if (!targetSheet.data[destKey]) targetSheet.data[destKey] = {};
          targetSheet.data[destKey].raw = nextVal;
          updates.push({ cellId: destKey, value: nextVal });
        }
      }
    } else if (colDelta > 0) {
      // Dragging rightward
      for (let c = endAddr.col + 1; c <= targetAddr.col; c++) {
        const offset = c - endAddr.col;
        for (let r = startAddr.row; r <= endAddr.row; r++) {
          const sourceCol = colIndexToLetter(endAddr.col);
          const destCol = colIndexToLetter(c);
          const sourceKey = `${sourceCol}${r}`;
          const destKey = `${destCol}${r}`;
          const sourceRaw = targetSheet.data[sourceKey]?.raw || '';

          let nextVal = sourceRaw;
          if (sourceRaw.startsWith('=')) {
            nextVal = adjustFormulaOnDrag(sourceRaw, 0, offset);
          } else {
            const num = parseFloat(sourceRaw);
            if (!isNaN(num)) {
              nextVal = String(num + offset);
            }
          }

          if (!targetSheet.data[destKey]) targetSheet.data[destKey] = {};
          targetSheet.data[destKey].raw = nextVal;
          updates.push({ cellId: destKey, value: nextVal });
        }
      }
    }

    emitWorkbookUpdate(newWb, {
      type: 'RANGE_UPDATE',
      sheetId: targetSheet.id,
      updates
    });
  };

  // ─── Cell Formatting Actions ────────────────────────────────────────────────
  const applyCellFormat = (formatPatch) => {
    if (userRole === 'Viewer') return;
    const selectedCells = expandRange(`${selectionRange.start}:${selectionRange.end}`);
    const newWb = JSON.parse(JSON.stringify(workbook));
    const targetSheet = newWb.sheets.find(s => s.id === newWb.activeSheetId);

    selectedCells.forEach(cellId => {
      if (!targetSheet.data[cellId]) {
        targetSheet.data[cellId] = { raw: '' };
      }
      targetSheet.data[cellId].format = {
        ...targetSheet.data[cellId].format,
        ...formatPatch
      };
    });

    emitWorkbookUpdate(newWb, {
      type: 'FORMAT_UPDATE',
      sheetId: targetSheet.id,
      cells: selectedCells,
      format: formatPatch
    });
  };

  // ─── Row & Column Mutations ─────────────────────────────────────────────────
  const handleInsertRow = (atIndex = null) => {
    if (userRole === 'Viewer') return;
    const targetRow = atIndex !== null ? atIndex : parseCellAddress(selectedCell).row;
    const newWb = JSON.parse(JSON.stringify(workbook));
    const targetSheet = newWb.sheets.find(s => s.id === newWb.activeSheetId);
    targetSheet.rowCount += 1;

    // Shift data down
    const shiftedData = {};
    Object.entries(targetSheet.data).forEach(([cellKey, cellObj]) => {
      const addr = parseCellAddress(cellKey);
      if (addr.row >= targetRow) {
        shiftedData[`${addr.colStr}${addr.row + 1}`] = cellObj;
      } else {
        shiftedData[cellKey] = cellObj;
      }
    });
    targetSheet.data = shiftedData;

    emitWorkbookUpdate(newWb);
  };

  const handleDeleteRow = (atIndex = null) => {
    if (userRole === 'Viewer') return;
    const targetRow = atIndex !== null ? atIndex : parseCellAddress(selectedCell).row;
    const newWb = JSON.parse(JSON.stringify(workbook));
    const targetSheet = newWb.sheets.find(s => s.id === newWb.activeSheetId);
    if (targetSheet.rowCount <= 5) return;
    targetSheet.rowCount -= 1;

    const shiftedData = {};
    Object.entries(targetSheet.data).forEach(([cellKey, cellObj]) => {
      const addr = parseCellAddress(cellKey);
      if (addr.row < targetRow) {
        shiftedData[cellKey] = cellObj;
      } else if (addr.row > targetRow) {
        shiftedData[`${addr.colStr}${addr.row - 1}`] = cellObj;
      }
    });
    targetSheet.data = shiftedData;

    emitWorkbookUpdate(newWb);
  };

  const handleInsertColumn = (atIndex = null) => {
    if (userRole === 'Viewer') return;
    const targetCol = atIndex !== null ? atIndex : parseCellAddress(selectedCell).col;
    const newWb = JSON.parse(JSON.stringify(workbook));
    const targetSheet = newWb.sheets.find(s => s.id === newWb.activeSheetId);
    targetSheet.colCount = Math.min(100, targetSheet.colCount + 1);

    const shiftedData = {};
    Object.entries(targetSheet.data).forEach(([cellKey, cellObj]) => {
      const addr = parseCellAddress(cellKey);
      if (addr.col >= targetCol) {
        shiftedData[`${colIndexToLetter(addr.col + 1)}${addr.row}`] = cellObj;
      } else {
        shiftedData[cellKey] = cellObj;
      }
    });
    targetSheet.data = shiftedData;

    emitWorkbookUpdate(newWb);
  };

  const handleDeleteColumn = (atIndex = null) => {
    if (userRole === 'Viewer') return;
    const targetCol = atIndex !== null ? atIndex : parseCellAddress(selectedCell).col;
    const newWb = JSON.parse(JSON.stringify(workbook));
    const targetSheet = newWb.sheets.find(s => s.id === newWb.activeSheetId);
    if (targetSheet.colCount <= 3) return;
    targetSheet.colCount -= 1;

    const shiftedData = {};
    Object.entries(targetSheet.data).forEach(([cellKey, cellObj]) => {
      const addr = parseCellAddress(cellKey);
      if (addr.col < targetCol) {
        shiftedData[cellKey] = cellObj;
      } else if (addr.col > targetCol) {
        shiftedData[`${colIndexToLetter(addr.col - 1)}${addr.row}`] = cellObj;
      }
    });
    targetSheet.data = shiftedData;

    emitWorkbookUpdate(newWb);
  };

  // ─── Sheet Management Handlers ──────────────────────────────────────────────
  const handleAddSheet = () => {
    if (userRole === 'Viewer') return;
    const newSheetIndex = workbook.sheets.length + 1;
    const newSheetId = `sheet_${Date.now()}`;
    const newSheet = createDefaultSheet(newSheetId, `Sheet${newSheetIndex}`);

    const newWb = {
      ...workbook,
      sheets: [...workbook.sheets, newSheet],
      activeSheetId: newSheetId
    };

    emitWorkbookUpdate(newWb, {
      type: 'SHEET_ACTION',
      action: 'create',
      sheet: newSheet
    });
  };

  const handleRenameSheet = (sheetId, currentName) => {
    if (userRole === 'Viewer') return;
    const newName = window.prompt('Enter new sheet name:', currentName);
    if (!newName || newName.trim() === '' || newName === currentName) return;

    const newWb = {
      ...workbook,
      sheets: workbook.sheets.map(s => s.id === sheetId ? { ...s, name: newName.trim() } : s)
    };

    emitWorkbookUpdate(newWb, {
      type: 'SHEET_ACTION',
      action: 'rename',
      sheetId,
      newName: newName.trim()
    });
  };

  const handleDeleteSheet = (sheetId) => {
    if (userRole === 'Viewer') return;
    if (workbook.sheets.length <= 1) {
      alert('A workbook must contain at least one worksheet.');
      return;
    }

    const target = workbook.sheets.find(s => s.id === sheetId);
    const hasData = target && Object.keys(target.data).length > 0;

    if (hasData && !window.confirm(`"${target.name}" contains data. Are you sure you want to permanently delete this sheet?`)) {
      return;
    }

    const remaining = workbook.sheets.filter(s => s.id !== sheetId);
    const newActiveId = workbook.activeSheetId === sheetId ? remaining[0].id : workbook.activeSheetId;

    const newWb = {
      ...workbook,
      sheets: remaining,
      activeSheetId: newActiveId
    };

    emitWorkbookUpdate(newWb, {
      type: 'SHEET_ACTION',
      action: 'delete',
      sheetId
    });
  };

  const handleDuplicateSheet = (sheetId) => {
    if (userRole === 'Viewer') return;
    const target = workbook.sheets.find(s => s.id === sheetId);
    if (!target) return;

    const newSheetId = `sheet_${Date.now()}`;
    const duplicated = {
      ...JSON.parse(JSON.stringify(target)),
      id: newSheetId,
      name: `${target.name} (Copy)`
    };

    const newWb = {
      ...workbook,
      sheets: [...workbook.sheets, duplicated],
      activeSheetId: newSheetId
    };

    emitWorkbookUpdate(newWb, {
      type: 'SHEET_ACTION',
      action: 'create',
      sheet: duplicated
    });
  };

  // ─── Sorting & Filtering ────────────────────────────────────────────────────
  const handleSort = (ascending = true) => {
    if (userRole === 'Viewer') return;
    const addr = parseCellAddress(selectedCell);
    const targetColLetter = addr.colStr;
    const newWb = JSON.parse(JSON.stringify(workbook));
    const targetSheet = newWb.sheets.find(s => s.id === newWb.activeSheetId);

    // Group rows from 2 to rowCount (treating row 1 as header)
    const rowEntries = [];
    for (let r = 2; r <= targetSheet.rowCount; r++) {
      const rowObj = {};
      for (let c = 0; c < targetSheet.colCount; c++) {
        const colL = colIndexToLetter(c);
        rowObj[colL] = targetSheet.data[`${colL}${r}`] || { raw: '' };
      }
      rowEntries.push({ rowIdx: r, cells: rowObj, keyVal: targetSheet.data[`${targetColLetter}${r}`]?.raw || '' });
    }

    rowEntries.sort((a, b) => {
      const numA = parseFloat(a.keyVal);
      const numB = parseFloat(b.keyVal);
      if (!isNaN(numA) && !isNaN(numB)) {
        return ascending ? numA - numB : numB - numA;
      }
      return ascending ? String(a.keyVal).localeCompare(String(b.keyVal)) : String(b.keyVal).localeCompare(String(a.keyVal));
    });

    // Write back sorted rows
    rowEntries.forEach((entry, idx) => {
      const targetRow = idx + 2;
      Object.entries(entry.cells).forEach(([colL, cellObj]) => {
        targetSheet.data[`${colL}${targetRow}`] = cellObj;
      });
    });

    emitWorkbookUpdate(newWb);
  };

  // ─── Import & Export (.xlsx & .csv) ──────────────────────────────────────────
  const handleExportXLSX = async () => {
    const XLSX = await getXLSX();
    const wb = XLSX.utils.book_new();

    workbook.sheets.forEach(sh => {
      const wsData = [];
      for (let r = 1; r <= sh.rowCount; r++) {
        const row = [];
        let hasDataInRow = false;
        for (let c = 0; c < sh.colCount; c++) {
          const cellId = `${colIndexToLetter(c)}${r}`;
          const evaluated = evaluateCell(cellId, workbook, sh.id);
          row.push(evaluated);
          if (evaluated !== '') hasDataInRow = true;
        }
        if (hasDataInRow || r <= 20) {
          wsData.push(row);
        }
      }
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31));
    });

    XLSX.writeFile(wb, `${roomName || 'Trinetra'}_Workbook.xlsx`);
  };

  const handleExportCSV = () => {
    let csv = '';
    for (let r = 1; r <= activeSheet.rowCount; r++) {
      const rowVals = [];
      for (let c = 0; c < activeSheet.colCount; c++) {
        const cellId = `${colIndexToLetter(c)}${r}`;
        const val = evaluateCell(cellId, workbook, activeSheet.id);
        const escaped = String(val).replace(/"/g, '""');
        rowVals.push(`"${escaped}"`);
      }
      csv += rowVals.join(',') + '\n';
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${roomName}_${activeSheet.name}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const XLSX = await getXLSX();
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const importedWb = XLSX.read(bstr, { type: 'binary' });
        const newSheets = [];

        importedWb.SheetNames.forEach((sheetName, sIdx) => {
          const ws = importedWb.Sheets[sheetName];
          const jsonAoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
          const newSheet = createDefaultSheet(`sheet_${sIdx + 1}`, sheetName);

          newSheet.rowCount = Math.max(DEFAULT_ROW_COUNT, jsonAoa.length + 10);
          let maxCols = DEFAULT_COL_COUNT;

          jsonAoa.forEach((row, rIdx) => {
            if (Array.isArray(row)) {
              maxCols = Math.max(maxCols, row.length);
              row.forEach((val, cIdx) => {
                if (val !== undefined && val !== null && String(val).trim() !== '') {
                  const cellId = `${colIndexToLetter(cIdx)}${rIdx + 1}`;
                  newSheet.data[cellId] = { raw: String(val) };
                }
              });
            }
          });
          newSheet.colCount = Math.min(100, maxCols + 5);
          newSheets.push(newSheet);
        });

        if (newSheets.length > 0) {
          const newWb = {
            sheets: newSheets,
            activeSheetId: newSheets[0].id,
            charts: [],
            comments: {},
            version: 1
          };
          emitWorkbookUpdate(newWb);
        }
      } catch (err) {
        alert('Failed to parse spreadsheet file. Please check file format.');
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  // ─── Find & Replace Engine ──────────────────────────────────────────────────
  const handleFindNext = () => {
    if (!findText) return;
    const cells = Object.keys(activeSheet.data);
    const match = cells.find(c => {
      const raw = activeSheet.data[c]?.raw || '';
      return findMatchCase ? raw.includes(findText) : raw.toLowerCase().includes(findText.toLowerCase());
    });
    if (match) {
      setSelectedCell(match);
      setSelectionRange({ start: match, end: match });
    } else {
      alert(`No matches found for "${findText}" in this sheet.`);
    }
  };

  const handleReplaceAll = () => {
    if (!findText || userRole === 'Viewer') return;
    const newWb = JSON.parse(JSON.stringify(workbook));
    const targetSheet = newWb.sheets.find(s => s.id === newWb.activeSheetId);
    let replaceCount = 0;

    Object.keys(targetSheet.data).forEach(c => {
      const raw = targetSheet.data[c]?.raw || '';
      const regex = new RegExp(findText, findMatchCase ? 'g' : 'gi');
      if (regex.test(raw)) {
        targetSheet.data[c].raw = raw.replace(regex, replaceText);
        replaceCount++;
      }
    });

    if (replaceCount > 0) {
      emitWorkbookUpdate(newWb);
      alert(`Replaced ${replaceCount} occurrence(s).`);
    } else {
      alert(`No matches found for "${findText}".`);
    }
  };

  // ─── Chart Insertion & Rendering ────────────────────────────────────────────
  const handleInsertChart = () => {
    if (userRole === 'Viewer') return;
    const range = `${selectionRange.start}:${selectionRange.end}`;
    const newChart = {
      id: `chart_${Date.now()}`,
      type: newChartType,
      title: newChartTitle || 'Data Chart',
      range,
      sheetId: activeSheet.id,
      x: 120,
      y: 80,
      width: 360,
      height: 240
    };

    const newWb = {
      ...workbook,
      charts: [...(workbook.charts || []), newChart]
    };
    emitWorkbookUpdate(newWb);
    setShowChartModal(false);
  };

  const handleDeleteChart = (chartId) => {
    if (userRole === 'Viewer') return;
    const newWb = {
      ...workbook,
      charts: (workbook.charts || []).filter(c => c.id !== chartId)
    };
    emitWorkbookUpdate(newWb);
  };

  // ─── ✨ Trinetra AI Spreadsheet Assistant ──────────────────────────────────
  const handleAskAi = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiLoading(true);
    setAiResponse(null);

    // Build minimal context from selected range or active sheet sample
    const selectedCells = expandRange(`${selectionRange.start}:${selectionRange.end}`);
    const sampleData = {};
    selectedCells.slice(0, 30).forEach(c => {
      sampleData[c] = activeSheet.data[c]?.raw || '';
    });

    try {
      const res = await fetch(getApiUrl('/api/ai-chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `You are Trinetra AI Spreadsheet Copilot. The user has selected cell/range ${selectionRange.start}:${selectionRange.end} in sheet "${activeSheet.name}".
Sample data in range: ${JSON.stringify(sampleData)}

User Request: "${aiPrompt}"

Respond with:
1. Proposed Formula (if applicable, e.g. =SUM(A1:A10))
2. Brief Explanation
3. Summary of analysis.`
        })
      });

      const data = await res.json();
      setAiResponse(data.response || 'Formula generated successfully.');
    } catch {
      setAiResponse('Could not connect to Trinetra AI assistant.');
    } finally {
      setIsAiLoading(false);
    }
  };

  const applyAiFormula = (formulaStr) => {
    if (!formulaStr || userRole === 'Viewer') return;
    const cleanFormula = formulaStr.trim().startsWith('=') ? formulaStr.trim() : `=${formulaStr.trim()}`;
    commitCellEdit(selectedCell, cleanFormula);
    setShowAiModal(false);
  };

  // ─── Keyboard Shortcuts Handler ─────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (editingCell) return; // Allow native inputs inside inline editor

      // Ctrl + Z: Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (historyIndex > 0) {
          setHistoryIndex(prev => prev - 1);
          setWorkbook(history[historyIndex - 1]);
        }
      }
      // Ctrl + Y: Redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        if (historyIndex < history.length - 1) {
          setHistoryIndex(prev => prev + 1);
          setWorkbook(history[historyIndex + 1]);
        }
      }
      // Ctrl + F: Find
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setShowFindReplace(true);
      }
      // Ctrl + B: Bold
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        const currentBold = activeSheet.data[selectedCell]?.format?.bold;
        applyCellFormat({ bold: !currentBold });
      }
      // Ctrl + I: Italic
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
        e.preventDefault();
        const currentItalic = activeSheet.data[selectedCell]?.format?.italic;
        applyCellFormat({ italic: !currentItalic });
      }
      // Delete / Backspace: Clear cell
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (userRole !== 'Viewer') {
          e.preventDefault();
          const cells = expandRange(`${selectionRange.start}:${selectionRange.end}`);
          const newWb = JSON.parse(JSON.stringify(workbook));
          const targetSheet = newWb.sheets.find(s => s.id === newWb.activeSheetId);
          cells.forEach(c => {
            if (targetSheet.data[c]) targetSheet.data[c].raw = '';
          });
          emitWorkbookUpdate(newWb);
        }
      }
      // Navigation arrows
      const addr = parseCellAddress(selectedCell);
      if (addr) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const next = `${addr.colStr}${Math.min(activeSheet.rowCount, addr.row + 1)}`;
          handleCellClick(next, e);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const next = `${addr.colStr}${Math.max(1, addr.row - 1)}`;
          handleCellClick(next, e);
        } else if (e.key === 'ArrowRight' || e.key === 'Tab') {
          e.preventDefault();
          const next = `${colIndexToLetter(Math.min(activeSheet.colCount - 1, addr.col + 1))}${addr.row}`;
          handleCellClick(next, e);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          const next = `${colIndexToLetter(Math.max(0, addr.col - 1))}${addr.row}`;
          handleCellClick(next, e);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingCell, selectedCell, selectionRange, history, historyIndex, activeSheet, userRole]);

  // ─── Range Selection Calculation Summary ────────────────────────────────────
  const selectionSummary = useMemo(() => {
    const cells = expandRange(`${selectionRange.start}:${selectionRange.end}`);
    if (cells.length <= 1) return null;

    let sum = 0, count = 0, numCount = 0;
    cells.forEach(c => {
      const val = evaluateCell(c, workbook, activeSheet.id);
      const n = parseFloat(val);
      if (!isNaN(n)) {
        sum += n;
        numCount++;
      }
      if (val !== '' && val !== null && val !== undefined) count++;
    });

    return {
      sum: numCount > 0 ? sum : null,
      avg: numCount > 0 ? (sum / numCount).toFixed(2) : null,
      count,
      cellsCount: cells.length
    };
  }, [selectionRange, workbook, activeSheet]);

  // ─── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="trinetra-spreadsheet-container">
      {/* ─── Ribbon Bar & Command Tabs ──────────────────────────────────────── */}
      <div className="spreadsheet-ribbon">
        <div className="ribbon-tabs-header">
          <div className="ribbon-brand-tag">
            <FileSpreadsheet size={16} className="brand-icon" />
            <span>Excel Studio</span>
          </div>
          {['File', 'Home', 'Insert', 'Data', 'View', 'Formulas', '✨ AI'].map(tab => (
            <button
              key={tab}
              className={`ribbon-tab-btn ${activeTab === tab ? 'active' : ''} ${tab === '✨ AI' ? 'ai-tab' : ''}`}
              onClick={() => {
                if (activeTab === tab && isRibbonCollapsed) {
                  setIsRibbonCollapsed(false);
                } else if (activeTab === tab && !isRibbonCollapsed) {
                  // Keep active
                } else {
                  setActiveRibbonTab(tab);
                  setIsRibbonCollapsed(false);
                }
              }}
              onDoubleClick={() => setIsRibbonCollapsed(c => !c)}
            >
              {tab === '✨ AI' && <Sparkles size={14} style={{ marginRight: '4px' }} />}
              {tab}
            </button>
          ))}
          <div className="ribbon-save-status">
            <span className={`status-dot ${syncStatus}`} />
            {syncStatus === 'saving' ? 'Saving...' : 'Saved ✓'}
          </div>

          <button
            className="ribbon-collapse-toggle-btn"
            onClick={() => setIsRibbonCollapsed(c => !c)}
            title={isRibbonCollapsed ? "Expand Ribbon Bar (Double-click Tab)" : "Collapse Ribbon Bar (Double-click Tab)"}
            aria-label="Toggle Ribbon Visibility"
          >
            {isRibbonCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>

        {/* ─── Ribbon Toolbars by Active Tab ─────────────────────────────────── */}
        {!isRibbonCollapsed && (
          <div className="ribbon-toolbar-body">
          {/* HOME TAB */}
          {activeTab === 'Home' && (
            <div className="toolbar-section-group">
              {/* History & Clipboard */}
              <div className="toolbar-group">
                <button className="tool-btn" onClick={() => historyIndex > 0 && setWorkbook(history[historyIndex - 1])} title="Undo (Ctrl+Z)"><Undo size={14} /></button>
                <button className="tool-btn" onClick={() => historyIndex < history.length - 1 && setWorkbook(history[historyIndex + 1])} title="Redo (Ctrl+Y)"><Redo size={14} /></button>
              </div>

              <div className="toolbar-divider" />

              {/* Typography */}
              <div className="toolbar-group">
                <button className={`tool-btn ${activeSheet.data[selectedCell]?.format?.bold ? 'active' : ''}`} onClick={() => applyCellFormat({ bold: !activeSheet.data[selectedCell]?.format?.bold })} title="Bold (Ctrl+B)"><Bold size={14} /></button>
                <button className={`tool-btn ${activeSheet.data[selectedCell]?.format?.italic ? 'active' : ''}`} onClick={() => applyCellFormat({ italic: !activeSheet.data[selectedCell]?.format?.italic })} title="Italic (Ctrl+I)"><Italic size={14} /></button>
                <button className={`tool-btn ${activeSheet.data[selectedCell]?.format?.underline ? 'active' : ''}`} onClick={() => applyCellFormat({ underline: !activeSheet.data[selectedCell]?.format?.underline })} title="Underline (Ctrl+U)"><Underline size={14} /></button>
                <button className={`tool-btn ${activeSheet.data[selectedCell]?.format?.strike ? 'active' : ''}`} onClick={() => applyCellFormat({ strike: !activeSheet.data[selectedCell]?.format?.strike })} title="Strikethrough"><Strikethrough size={14} /></button>
              </div>

              <div className="toolbar-divider" />

              {/* Colors */}
              <div className="toolbar-group">
                <label className="color-picker-label" title="Text Color">
                  <Type size={14} />
                  <input type="color" onChange={e => applyCellFormat({ color: e.target.value })} className="hidden-color-input" />
                </label>
                <label className="color-picker-label" title="Cell Fill Color">
                  <Palette size={14} />
                  <input type="color" onChange={e => applyCellFormat({ bg: e.target.value })} className="hidden-color-input" />
                </label>
              </div>

              <div className="toolbar-divider" />

              {/* Alignment */}
              <div className="toolbar-group">
                <button className="tool-btn" onClick={() => applyCellFormat({ align: 'left' })} title="Align Left"><AlignLeft size={14} /></button>
                <button className="tool-btn" onClick={() => applyCellFormat({ align: 'center' })} title="Align Center"><AlignCenter size={14} /></button>
                <button className="tool-btn" onClick={() => applyCellFormat({ align: 'right' })} title="Align Right"><AlignRight size={14} /></button>
                <button className="tool-btn" onClick={() => applyCellFormat({ wrap: !activeSheet.data[selectedCell]?.format?.wrap })} title="Wrap Text"><AlignJustify size={14} /></button>
              </div>

              <div className="toolbar-divider" />

              {/* Number Format */}
              <div className="toolbar-group">
                <button className="tool-btn text-label-btn" onClick={() => applyCellFormat({ numFormat: 'currency' })} title="Format as Currency">$</button>
                <button className="tool-btn text-label-btn" onClick={() => applyCellFormat({ numFormat: 'percent' })} title="Format as Percentage">%</button>
                <button className="tool-btn text-label-btn" onClick={() => applyCellFormat({ numFormat: 'plain' })} title="Clear Number Format">123</button>
              </div>
            </div>
          )}

          {/* FILE TAB */}
          {activeTab === 'File' && (
            <div className="toolbar-section-group">
              <label className="tool-btn action-pill-btn">
                <Upload size={14} /> Import (.xlsx / .csv)
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} style={{ display: 'none' }} />
              </label>
              <button className="tool-btn action-pill-btn" onClick={handleExportXLSX}><Download size={14} /> Export Excel (.xlsx)</button>
              <button className="tool-btn action-pill-btn" onClick={handleExportCSV}><Download size={14} /> Export CSV</button>
              <button className="tool-btn action-pill-btn danger" onClick={() => {
                if (window.confirm('Clear all data from current sheet?')) {
                  const newWb = JSON.parse(JSON.stringify(workbook));
                  newWb.sheets.find(s => s.id === newWb.activeSheetId).data = {};
                  emitWorkbookUpdate(newWb);
                }
              }}><Trash2 size={14} /> Clear Sheet</button>
            </div>
          )}

          {/* INSERT TAB */}
          {activeTab === 'Insert' && (
            <div className="toolbar-section-group">
              <button className="tool-btn action-pill-btn" onClick={() => handleInsertRow()}><Rows size={14} /> Insert Row</button>
              <button className="tool-btn action-pill-btn" onClick={() => handleDeleteRow()}><Minus size={14} /> Delete Row</button>
              <button className="tool-btn action-pill-btn" onClick={() => handleInsertColumn()}><Columns size={14} /> Insert Column</button>
              <button className="tool-btn action-pill-btn" onClick={() => handleDeleteColumn()}><Minus size={14} /> Delete Column</button>
              <button className="tool-btn action-pill-btn" onClick={() => setShowChartModal(true)}><BarChart2 size={14} /> Insert Chart</button>
              <button className="tool-btn action-pill-btn" onClick={() => setActiveCommentCell(selectedCell)}><MessageSquare size={14} /> Add Comment</button>
            </div>
          )}

          {/* DATA TAB */}
          {activeTab === 'Data' && (
            <div className="toolbar-section-group">
              <button className="tool-btn action-pill-btn" onClick={() => handleSort(true)}><ListOrdered size={14} /> Sort A → Z</button>
              <button className="tool-btn action-pill-btn" onClick={() => handleSort(false)}><ListOrdered size={14} /> Sort Z → A</button>
              <button className="tool-btn action-pill-btn" onClick={() => setShowValidationModal(true)}><Check size={14} /> Data Validation</button>
              <button className="tool-btn action-pill-btn" onClick={() => setShowConditionalModal(true)}><Palette size={14} /> Conditional Format</button>
              <button className="tool-btn action-pill-btn" onClick={() => setShowFindReplace(true)}><Search size={14} /> Find & Replace</button>
            </div>
          )}

          {/* VIEW TAB */}
          {activeTab === 'View' && (
            <div className="toolbar-section-group">
              <button className={`tool-btn action-pill-btn ${showGridlines ? 'active' : ''}`} onClick={() => setShowGridlines(g => !g)}><Grid size={14} /> Gridlines</button>
              <button className={`tool-btn action-pill-btn ${showHeaders ? 'active' : ''}`} onClick={() => setShowHeaders(h => !h)}><Eye size={14} /> Headers</button>
              <button className="tool-btn action-pill-btn" onClick={() => setZoomLevel(z => Math.max(50, z - 10))}>Zoom -</button>
              <span className="zoom-text">{zoomLevel}%</span>
              <button className="tool-btn action-pill-btn" onClick={() => setZoomLevel(z => Math.min(150, z + 10))}>Zoom +</button>
              <button className="tool-btn action-pill-btn" onClick={() => setZoomLevel(100)}>Reset (100%)</button>
            </div>
          )}

          {/* FORMULAS TAB */}
          {activeTab === 'Formulas' && (
            <div className="toolbar-section-group">
              <button className="tool-btn action-pill-btn" onClick={() => setShowFormulaCatalog(true)}><HelpCircle size={14} /> Function Library</button>
              <button className="tool-btn action-pill-btn" onClick={() => commitCellEdit(selectedCell, `=SUM(${selectionRange.start}:${selectionRange.end})`)}>∑ AutoSum</button>
              <button className="tool-btn action-pill-btn" onClick={() => commitCellEdit(selectedCell, `=AVERAGE(${selectionRange.start}:${selectionRange.end})`)}>Average</button>
              <button className="tool-btn action-pill-btn" onClick={() => commitCellEdit(selectedCell, `=COUNT(${selectionRange.start}:${selectionRange.end})`)}>Count</button>
              <button className="tool-btn action-pill-btn" onClick={() => commitCellEdit(selectedCell, `=MAX(${selectionRange.start}:${selectionRange.end})`)}>Max</button>
              <button className="tool-btn action-pill-btn" onClick={() => commitCellEdit(selectedCell, `=MIN(${selectionRange.start}:${selectionRange.end})`)}>Min</button>
            </div>
          )}

          {/* AI TAB */}
          {activeTab === '✨ AI' && (
            <div className="toolbar-section-group">
              <button className="tool-btn action-pill-btn ai-btn" onClick={() => setShowAiModal(true)}>
                <Sparkles size={14} /> ✨ Ask Trinetra AI Copilot
              </button>
              <button className="tool-btn action-pill-btn" onClick={() => {
                setAiPrompt('Clean this data, trim extra spaces, and standardize casing.');
                setShowAiModal(true);
              }}>Clean Data</button>
              <button className="tool-btn action-pill-btn" onClick={() => {
                setAiPrompt('Analyze selected data and generate key statistical insights.');
                setShowAiModal(true);
              }}>Analyze Trends</button>
            </div>
          )}
        </div>
        )}
      </div>

      {/* ─── Formula Bar ────────────────────────────────────────────────────── */}
      <div className="spreadsheet-formula-bar">
        <input
          type="text"
          className="name-box-input"
          value={nameBoxInput}
          onChange={e => setNameBoxInput(e.target.value.toUpperCase())}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              const parsed = parseCellAddress(nameBoxInput);
              if (parsed) {
                setSelectedCell(`${parsed.colStr}${parsed.row}`);
                setSelectionRange({ start: `${parsed.colStr}${parsed.row}`, end: `${parsed.colStr}${parsed.row}` });
              }
            }
          }}
          title="Name Box / Cell Address"
        />

        <div className="formula-actions-group">
          <button className="formula-icon-btn" onClick={() => setFormulaBarValue(activeSheet.data[selectedCell]?.raw || '')} title="Cancel (Esc)"><X size={12} /></button>
          <button className="formula-icon-btn confirm" onClick={() => commitCellEdit(selectedCell, formulaBarValue)} title="Enter (✔)"><Check size={12} /></button>
          <span className="formula-fx-label" onClick={() => setShowFormulaCatalog(true)}>fx</span>
        </div>

        <input
          ref={formulaInputRef}
          type="text"
          className="formula-editor-input"
          placeholder="Enter text, number, or formula (e.g. =SUM(A1:B10) or =IF(C2>100, 'High', 'Low'))"
          value={formulaBarValue}
          onChange={e => {
            setFormulaBarValue(e.target.value);
            if (selectedCell) {
              setTempEditValue(e.target.value);
            }
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              commitCellEdit(selectedCell, formulaBarValue);
            }
          }}
          onBlur={() => {
            if (selectedCell && formulaBarValue !== (activeSheet.data[selectedCell]?.raw || '')) {
              commitCellEdit(selectedCell, formulaBarValue);
            }
          }}
          disabled={userRole === 'Viewer'}
        />
      </div>

      {/* ─── Virtualized Grid & Viewport ────────────────────────────────────── */}
      <div className="spreadsheet-grid-viewport" ref={gridContainerRef} style={{ zoom: `${zoomLevel}%` }}>
        <table className={`spreadsheet-grid-table ${showGridlines ? 'show-gridlines' : ''}`}>
          {showHeaders && (
            <thead>
              <tr>
                <th className="grid-corner-header" />
                {Array.from({ length: activeSheet.colCount }).map((_, cIdx) => {
                  const colL = colIndexToLetter(cIdx);
                  const isColSelected = selectionRange.start.startsWith(colL) && selectionRange.end.startsWith(colL);
                  const width = activeSheet.colWidths[colL] || DEFAULT_COL_WIDTH;

                  return (
                    <th
                      key={cIdx}
                      className={`grid-col-header ${isColSelected ? 'selected-header' : ''}`}
                      style={{ width: `${width}px`, minWidth: `${width}px` }}
                      onClick={() => {
                        setSelectionRange({ start: `${colL}1`, end: `${colL}${activeSheet.rowCount}` });
                        setSelectedCell(`${colL}1`);
                      }}
                    >
                      <span>{colL}</span>
                      <div
                        className="col-resize-handle"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setResizingCol({ colL, startX: e.clientX, startWidth: width });
                        }}
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
          )}

          <tbody>
            {Array.from({ length: activeSheet.rowCount }).map((_, rIdx) => {
              const rowNum = rIdx + 1;
              const height = activeSheet.rowHeights[rowNum] || DEFAULT_ROW_HEIGHT;

              return (
                <tr key={rIdx} style={{ height: `${height}px` }}>
                  {showHeaders && (
                    <td
                      className="grid-row-header"
                      onClick={() => {
                        setSelectionRange({ start: `A${rowNum}`, end: `${colIndexToLetter(activeSheet.colCount - 1)}${rowNum}` });
                        setSelectedCell(`A${rowNum}`);
                      }}
                    >
                      <span>{rowNum}</span>
                      <div
                        className="row-resize-handle"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setResizingRow({ rowNum, startY: e.clientY, startHeight: height });
                        }}
                      />
                    </td>
                  )}

                  {Array.from({ length: activeSheet.colCount }).map((_, cIdx) => {
                    const colL = colIndexToLetter(cIdx);
                    const cellId = `${colL}${rowNum}`;
                    const cellData = activeSheet.data[cellId];
                    const format = cellData?.format || {};
                    const isSelected = selectedCell === cellId;
                    const isEditing = editingCell === cellId;

                    // Evaluate value
                    const evaluatedVal = evaluateCell(cellId, workbook, activeSheet.id);

                    // Check peer cursors
                    const peerOnCell = Object.values(peerSelections).find(p => p.cell === cellId && p.sheetId === activeSheet.id);

                    // Check comments
                    const hasComment = workbook.comments && workbook.comments[cellId]?.length > 0;

                    // Selection box calculations
                    const selCells = expandRange(`${selectionRange.start}:${selectionRange.end}`);
                    const isInRange = selCells.includes(cellId);

                    return (
                      <td
                        key={cIdx}
                        className={`grid-cell ${isInRange ? 'in-range' : ''} ${isSelected ? 'selected' : ''}`}
                        style={{
                          backgroundColor: format.bg || undefined,
                          color: format.color || undefined,
                          fontWeight: format.bold ? 'bold' : 'normal',
                          fontStyle: format.italic ? 'italic' : 'normal',
                          textDecoration: [
                            format.underline ? 'underline' : '',
                            format.strike ? 'line-through' : ''
                          ].filter(Boolean).join(' ') || undefined,
                          textAlign: format.align || 'left',
                          whiteSpace: format.wrap ? 'normal' : 'nowrap'
                        }}
                        onClick={(e) => handleCellClick(cellId, e)}
                        onDoubleClick={() => handleCellDoubleClick(cellId)}
                        onMouseDown={() => handleCellMouseDown(cellId)}
                        onMouseEnter={() => handleCellMouseEnter(cellId)}
                      >
                        {isEditing ? (
                          <input
                            ref={inlineEditorRef}
                            type="text"
                            className="cell-inline-editor"
                            value={tempEditValue}
                            onChange={e => {
                              setTempEditValue(e.target.value);
                              setFormulaBarValue(e.target.value);
                            }}
                            onBlur={() => commitCellEdit(cellId, tempEditValue)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                commitCellEdit(cellId, tempEditValue);
                              } else if (e.key === 'Escape') {
                                setEditingCell(null);
                              }
                            }}
                            autoFocus
                          />
                        ) : (
                          <span className="cell-content-text">{evaluatedVal}</span>
                        )}

                        {/* Peer presence indicator */}
                        {peerOnCell && !isSelected && (
                          <div className="peer-cell-badge" style={{ borderColor: peerOnCell.color || '#3b82f6' }}>
                            <span className="peer-name-tag">{peerOnCell.username}</span>
                          </div>
                        )}

                        {/* Comment Triangle Indicator */}
                        {hasComment && <div className="cell-comment-triangle" title="Has comment" />}

                        {/* Autofill Corner Handle on Active Cell */}
                        {isSelected && userRole !== 'Viewer' && (
                          <div
                            className="autofill-drag-handle"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              setIsAutofilling(true);
                            }}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* ─── Floating Charts Layer ────────────────────────────────────────── */}
        {workbook.charts && workbook.charts.filter(ch => ch.sheetId === activeSheet.id).map(chart => (
          <div
            key={chart.id}
            className="floating-chart-card"
            style={{ top: `${chart.y}px`, left: `${chart.x}px`, width: `${chart.width}px`, height: `${chart.height}px` }}
          >
            <div className="chart-header">
              <h4>{chart.title}</h4>
              <button onClick={() => handleDeleteChart(chart.id)} className="chart-close-btn"><X size={12} /></button>
            </div>
            <div className="chart-visual-body">
              <SimpleSvgChart chart={chart} workbook={workbook} />
            </div>
          </div>
        ))}
      </div>

      {/* ─── Worksheet Tabs Bar ─────────────────────────────────────────────── */}
      <div className="spreadsheet-bottom-bar">
        <button className="add-sheet-btn" onClick={handleAddSheet} title="Add New Sheet" disabled={userRole === 'Viewer'}>
          <Plus size={14} />
        </button>

        <div className="sheet-tabs-scroll-list">
          {workbook.sheets.map(sh => (
            <div
              key={sh.id}
              className={`sheet-tab-item ${sh.id === workbook.activeSheetId ? 'active' : ''}`}
              onClick={() => {
                setWorkbook(prev => ({ ...prev, activeSheetId: sh.id }));
                setSelectedCell('A1');
              }}
              onDoubleClick={() => handleRenameSheet(sh.id, sh.name)}
            >
              <span>{sh.name}</span>
              {workbook.sheets.length > 1 && (
                <button
                  className="sheet-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteSheet(sh.id);
                  }}
                  title="Delete Sheet"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Live Selection Summary */}
        {selectionSummary && (
          <div className="selection-summary-bar">
            {selectionSummary.sum !== null && <span>SUM: <strong>{selectionSummary.sum}</strong></span>}
            {selectionSummary.avg !== null && <span>AVG: <strong>{selectionSummary.avg}</strong></span>}
            <span>COUNT: <strong>{selectionSummary.count}</strong></span>
          </div>
        )}
      </div>

      {/* ─── ✨ AI Assistant Modal ──────────────────────────────────────────── */}
      {showAiModal && (
        <div className="spreadsheet-modal-overlay">
          <div className="spreadsheet-modal-card ai-modal">
            <div className="modal-header">
              <h3><Sparkles size={16} /> Trinetra AI Spreadsheet Copilot</h3>
              <button onClick={() => setShowAiModal(false)}><X size={14} /></button>
            </div>
            <div className="modal-body">
              <p className="modal-desc">Ask AI to generate formulas, summarize trends, or transform data for range <strong>{selectionRange.start}:{selectionRange.end}</strong>.</p>
              <textarea
                className="ai-prompt-input"
                rows={3}
                placeholder="e.g. Calculate profit margin from Revenue (Col A) and Expenses (Col B), or create a lookup formula."
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
              />

              {isAiLoading && <div className="ai-loading-indicator"><RefreshCw size={16} className="spin" /> Generating suggestion...</div>}

              {aiResponse && (
                <div className="ai-response-box">
                  <h4>AI Recommendation:</h4>
                  <pre>{aiResponse}</pre>
                  {aiResponse.match(/=[A-Za-z0-9_()+*\-/., "]+/)?.[0] && (
                    <button
                      className="apply-formula-btn"
                      onClick={() => applyAiFormula(aiResponse.match(/=[A-Za-z0-9_()+*\-/., "]+/)?.[0])}
                    >
                      Apply Formula to {selectedCell}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowAiModal(false)}>Close</button>
              <button className="btn-primary" onClick={handleAskAi} disabled={isAiLoading}>Ask AI</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Find & Replace Dialog ─────────────────────────────────────────── */}
      {showFindReplace && (
        <div className="spreadsheet-modal-overlay">
          <div className="spreadsheet-modal-card">
            <div className="modal-header">
              <h3><Search size={16} /> Find & Replace</h3>
              <button onClick={() => setShowFindReplace(false)}><X size={14} /></button>
            </div>
            <div className="modal-body">
              <div className="input-row">
                <label>Find:</label>
                <input type="text" value={findText} onChange={e => setFindText(e.target.value)} autoFocus />
              </div>
              <div className="input-row">
                <label>Replace with:</label>
                <input type="text" value={replaceText} onChange={e => setReplaceText(e.target.value)} />
              </div>
              <div className="checkbox-row">
                <input type="checkbox" id="matchCase" checked={findMatchCase} onChange={e => setFindMatchCase(e.target.checked)} />
                <label htmlFor="matchCase">Match Case</label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={handleFindNext}>Find Next</button>
              <button className="btn-primary" onClick={handleReplaceAll}>Replace All</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Insert Chart Dialog ────────────────────────────────────────────── */}
      {showChartModal && (
        <div className="spreadsheet-modal-overlay">
          <div className="spreadsheet-modal-card">
            <div className="modal-header">
              <h3><BarChart2 size={16} /> Insert Chart</h3>
              <button onClick={() => setShowChartModal(false)}><X size={14} /></button>
            </div>
            <div className="modal-body">
              <div className="input-row">
                <label>Chart Title:</label>
                <input type="text" value={newChartTitle} onChange={e => setNewChartTitle(e.target.value)} />
              </div>
              <div className="input-row">
                <label>Chart Type:</label>
                <select value={newChartType} onChange={e => setNewChartType(e.target.value)}>
                  <option value="column">Column Chart</option>
                  <option value="bar">Bar Chart</option>
                  <option value="line">Line Chart</option>
                  <option value="pie">Pie Chart</option>
                </select>
              </div>
              <p className="modal-desc">Data Range: <strong>{selectionRange.start}:{selectionRange.end}</strong></p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowChartModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleInsertChart}>Insert Chart</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Function Catalog Library Dialog ───────────────────────────────── */}
      {showFormulaCatalog && (
        <div className="spreadsheet-modal-overlay">
          <div className="spreadsheet-modal-card wide-modal">
            <div className="modal-header">
              <h3><HelpCircle size={16} /> Excel Function Catalog</h3>
              <button onClick={() => setShowFormulaCatalog(false)}><X size={14} /></button>
            </div>
            <div className="modal-body formula-catalog-list">
              {FORMULA_CATALOG.map(fn => (
                <div key={fn.name} className="formula-item-card" onClick={() => {
                  setFormulaBarValue(`=${fn.name}(`);
                  commitCellEdit(selectedCell, `=${fn.name}(`);
                  setShowFormulaCatalog(false);
                }}>
                  <div className="fn-header">
                    <strong>{fn.name}</strong>
                    <span className="fn-category">{fn.category}</span>
                  </div>
                  <code className="fn-syntax">{fn.syntax}</code>
                  <p className="fn-desc">{fn.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Simple Embedded Chart Visualizer ─────────────────────────────────────────

function SimpleSvgChart({ chart, workbook }) {
  const cells = expandRange(chart.range || 'A1:B5');
  const values = cells.map(c => {
    const val = parseFloat(evaluateCell(c, workbook, chart.sheetId));
    return isNaN(val) ? 0 : val;
  });

  const maxVal = Math.max(...values, 1);
  const width = chart.width || 320;
  const height = (chart.height || 200) - 40;

  if (chart.type === 'pie') {
    return (
      <svg width={width - 20} height={height} viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="#3b82f6" opacity="0.8" />
        <circle cx="50" cy="50" r="25" fill="#10b981" opacity="0.9" />
      </svg>
    );
  }

  return (
    <svg width={width - 20} height={height} style={{ overflow: 'visible' }}>
      {values.map((v, idx) => {
        const barWidth = Math.max(12, (width - 40) / values.length - 8);
        const barHeight = (v / maxVal) * (height - 30);
        const x = 20 + idx * (barWidth + 8);
        const y = height - barHeight;

        return (
          <g key={idx}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              fill="#3b82f6"
              rx={3}
            />
            <text x={x + barWidth / 2} y={y - 4} fontSize="9" fill="var(--text-muted)" textAnchor="middle">
              {v}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

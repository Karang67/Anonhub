/**
 * @file WordEditor.jsx
 * @description Microsoft Word-style collaborative document processor for Trinetra.
 * Features realistic A4 page layouts, margins, orientation, headers/footers, dynamic page numbers,
 * rich typography, tables, images, hyperlinks, outline, find & replace, .docx import/export,
 * print layout, Trinetra AI writing assistant, and real-time collaboration.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import DOMPurify from 'dompurify';
// mammoth and docx libraries are loaded dynamically on demand to optimize initial bundle size
const getMammoth = async () => await import('mammoth');
const getDocx = async () => await import('docx');
import { getApiUrl } from '../../config';
import {
  FileText, Undo, Redo, Copy, Scissors, Clipboard,
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Indent, Outdent,
  Heading1, Heading2, Heading3, Type,
  Table as TableIcon, Image, Link2, Download, Upload,
  Printer, Search, Replace, Sparkles, HelpCircle,
  Maximize2, Check, X, RefreshCw, ZoomIn, ZoomOut,
  Sliders, Layout, BookOpen, MessageSquare, Quote,
  Code, Eye, Columns, Minus, Plus, Calendar, Hash,
  ChevronUp, ChevronDown
} from 'lucide-react';
import './WordEditor.css';

// ─── Page Dimensions Constants ────────────────────────────────────────────────

const PAGE_SIZES = {
  A4: { name: 'A4 (210 × 297 mm)', width: '210mm', height: '297mm', minHeight: '297mm' },
  A3: { name: 'A3 (297 × 420 mm)', width: '297mm', height: '420mm', minHeight: '420mm' },
  A5: { name: 'A5 (148 × 210 mm)', width: '148mm', height: '210mm', minHeight: '210mm' },
  Letter: { name: 'Letter (8.5 × 11 in)', width: '215.9mm', height: '279.4mm', minHeight: '279.4mm' },
  Legal: { name: 'Legal (8.5 × 14 in)', width: '215.9mm', height: '355.6mm', minHeight: '355.6mm' }
};

const MARGIN_PRESETS = {
  normal: { name: 'Normal (25.4 mm)', top: '25.4mm', bottom: '25.4mm', left: '25.4mm', right: '25.4mm' },
  narrow: { name: 'Narrow (12.7 mm)', top: '12.7mm', bottom: '12.7mm', left: '12.7mm', right: '12.7mm' },
  moderate: { name: 'Moderate (19.1 mm)', top: '25.4mm', bottom: '25.4mm', left: '19.1mm', right: '19.1mm' },
  wide: { name: 'Wide (50.8 mm)', top: '25.4mm', bottom: '25.4mm', left: '50.8mm', right: '50.8mm' }
};

export default function WordEditor({
  roomName,
  username = 'Anonymous',
  isOwner = false,
  userRole = 'Editor',
  initialContent = '',
  onContentChange,
  socketRef = null
}) {
  // ─── Document State ─────────────────────────────────────────────────────────
  const [content, setContent] = useState(initialContent || '<p>Start typing your document here...</p>');
  const [activeRibbonTab, setActiveRibbonTab] = useState('Home'); // File, Home, Insert, Layout, References, Review, View, ✨ AI
  const [isRibbonCollapsed, setIsRibbonCollapsed] = useState(false);
  
  // Page Settings
  const [pageSizeKey, setPageSizeKey] = useState('A4');
  const [orientation, setOrientation] = useState('portrait'); // 'portrait' | 'landscape'
  const [marginPreset, setMarginPreset] = useState('normal');
  const [headerText, setHeaderText] = useState('Trinetra Office Document');
  const [footerText, setFooterText] = useState('');
  const [showPageNumbers, setShowPageNumbers] = useState(true);

  // View Settings
  const [zoomLevel, setZoomLevel] = useState(100);
  const [showOutline, setShowOutline] = useState(false);
  const [showRuler, setShowRuler] = useState(true);
  const [headingsOutline, setHeadingsOutline] = useState([]);

  // Stats
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [syncStatus, setSyncStatus] = useState('saved'); // 'saved' | 'saving'

  // Modals & Popovers
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [findMatchCase, setFindMatchCase] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiAction, setAiAction] = useState('improve');
  const [aiCustomPrompt, setAiCustomPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  // Refs
  const editorRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const isInternalUpdate = useRef(false);

  // Active page dimensions
  const activePageStyle = useMemo(() => {
    const base = PAGE_SIZES[pageSizeKey] || PAGE_SIZES.A4;
    const margins = MARGIN_PRESETS[marginPreset] || MARGIN_PRESETS.normal;

    const width = orientation === 'portrait' ? base.width : base.height;
    const minHeight = orientation === 'portrait' ? base.minHeight : base.width;

    return {
      width,
      minHeight,
      paddingTop: margins.top,
      paddingBottom: margins.bottom,
      paddingLeft: margins.left,
      paddingRight: margins.right
    };
  }, [pageSizeKey, orientation, marginPreset]);

  // ─── Initial sync from prop ─────────────────────────────────────────────────
  useEffect(() => {
    if (initialContent && !isInternalUpdate.current) {
      const cleanHtml = DOMPurify.sanitize(initialContent);
      setContent(cleanHtml);
      if (editorRef.current && editorRef.current.innerHTML !== cleanHtml) {
        editorRef.current.innerHTML = cleanHtml;
        updateDocumentStats();
      }
    }
  }, [initialContent]);

  // ─── Calculate Word & Outline Statistics ────────────────────────────────────
  const updateDocumentStats = useCallback(() => {
    if (!editorRef.current) return;
    const text = editorRef.current.innerText || '';
    const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    const chars = text.length;
    setWordCount(words);
    setCharCount(chars);

    // Approximate A4 page count based on content height vs page height (1122px approx A4)
    const scrollHeight = editorRef.current.scrollHeight || 1122;
    const pages = Math.max(1, Math.ceil(scrollHeight / 1122));
    setPageCount(pages);

    // Extract headings for Outline
    const headings = [];
    const elements = editorRef.current.querySelectorAll('h1, h2, h3');
    elements.forEach((el, idx) => {
      if (!el.id) el.id = `heading-ref-${idx}`;
      headings.push({
        id: el.id,
        text: el.innerText || 'Untitled Section',
        level: el.tagName.toLowerCase()
      });
    });
    setHeadingsOutline(headings);
  }, []);

  // ─── Editor Input & Autosave ────────────────────────────────────────────────
  const handleEditorInput = () => {
    if (!editorRef.current || userRole === 'Viewer') return;
    const html = editorRef.current.innerHTML;
    setContent(html);
    updateDocumentStats();

    setSyncStatus('saving');
    isInternalUpdate.current = true;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      if (onContentChange) {
        onContentChange(html);
      }
      if (socketRef && socketRef.current) {
        socketRef.current.emit('update word', {
          officeName: roomName,
          wordContent: html
        });
      }
      setSyncStatus('saved');
      isInternalUpdate.current = false;
    }, 800);
  };

  // ─── Document Formatting Commands (execCommand) ─────────────────────────────
  const execCmd = (command, value = null) => {
    if (userRole === 'Viewer') return;
    if (editorRef.current) {
      editorRef.current.focus();
    }
    document.execCommand(command, false, value);
    handleEditorInput();
  };

  const applyStyleBlock = (tag) => {
    if (userRole === 'Viewer') return;
    execCmd('formatBlock', tag);
  };

  const applyLineSpacing = (spacing) => {
    if (userRole === 'Viewer') return;
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const parentBlock = range.commonAncestorContainer.nodeType === 1
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;

    if (parentBlock && editorRef.current.contains(parentBlock)) {
      parentBlock.style.lineHeight = spacing;
      handleEditorInput();
    }
  };

  // ─── Insert Elements (Tables, Images, Links, Page Break) ────────────────────
  const insertTable = (rows = 3, cols = 3) => {
    if (userRole === 'Viewer') return;
    let tableHtml = '<table class="word-document-table"><tbody>';
    for (let r = 0; r < rows; r++) {
      tableHtml += '<tr>';
      for (let c = 0; c < cols; c++) {
        tableHtml += `<td>${r === 0 ? '<strong>Header</strong>' : 'Cell'}</td>`;
      }
      tableHtml += '</tr>';
    }
    tableHtml += '</tbody></table><p><br/></p>';
    execCmd('insertHTML', tableHtml);
    setShowTablePicker(false);
  };

  const insertImage = (url) => {
    if (!url || userRole === 'Viewer') return;
    if (/^(javascript|vbscript):/i.test(url.trim())) return;
    const safeUrl = DOMPurify.sanitize(url);
    const imgHtml = `<p><img src="${safeUrl}" class="word-document-image" alt="Embedded Graphic" /></p><p><br/></p>`;
    execCmd('insertHTML', imgHtml);
  };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file || userRole === 'Viewer') return;
    if (file.size > 5 * 1024 * 1024) {
      alert('Image size exceeds 5MB limit.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      insertImage(evt.target.result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleInsertLink = () => {
    if (!linkUrl || userRole === 'Viewer') return;
    const trimmed = linkUrl.trim();
    if (/^(javascript|vbscript|data):/i.test(trimmed)) {
      alert('Invalid URL scheme');
      return;
    }
    const safeUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('mailto:') ? trimmed : `https://${trimmed}`;
    const safeText = (linkText || safeUrl).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const linkHtml = `<a href="${encodeURI(safeUrl)}" target="_blank" rel="noopener noreferrer">${safeText}</a>`;
    execCmd('insertHTML', linkHtml);
    setShowLinkModal(false);
    setLinkUrl('');
    setLinkText('');
  };

  const insertPageBreak = () => {
    if (userRole === 'Viewer') return;
    const pbHtml = '<div class="word-page-break-divider" data-page-break="true"><span>────── Page Break ──────</span></div><p><br/></p>';
    execCmd('insertHTML', pbHtml);
  };

  const insertTableOfContents = () => {
    if (userRole === 'Viewer') return;
    if (headingsOutline.length === 0) {
      alert('No headings (H1, H2, H3) found in document to generate Table of Contents.');
      return;
    }
    let tocHtml = '<div class="word-toc-container"><h3>Table of Contents</h3><ul class="word-toc-list">';
    headingsOutline.forEach(h => {
      const indentClass = h.level === 'h1' ? 'toc-h1' : h.level === 'h2' ? 'toc-h2' : 'toc-h3';
      tocHtml += `<li class="${indentClass}"><a href="#${h.id}">${h.text}</a></li>`;
    });
    tocHtml += '</ul></div><p><br/></p>';
    execCmd('insertHTML', tocHtml);
  };

  // ─── Import & Export (.docx & PDF) ──────────────────────────────────────────
  const handleImportDOCX = (e) => {
    const file = e.target.files?.[0];
    if (!file || userRole === 'Viewer') return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const mammoth = await getMammoth();
        const arrayBuffer = evt.target.result;
        const result = await mammoth.convertToHtml({ arrayBuffer });
        const importedHtml = result.value || '<p></p>';
        // Sanitize converted HTML to prevent XSS from malicious .docx files
        const safeHtml = DOMPurify.sanitize(importedHtml, {
          ALLOWED_TAGS: ['p','br','strong','em','u','s','h1','h2','h3','h4','h5','h6',
                         'ul','ol','li','blockquote','table','thead','tbody','tr','td','th',
                         'a','img','span','div','code','pre'],
          ALLOWED_ATTR: ['href','src','alt','class','style','target','rel','colspan','rowspan']
        });
        setContent(safeHtml);
        if (editorRef.current) {
          editorRef.current.innerHTML = safeHtml;
          updateDocumentStats();
        }
        handleEditorInput();
      } catch (err) {
        alert('Could not parse .docx file. Please verify file integrity.');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleExportDOCX = async () => {
    if (!editorRef.current) return;
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table: DocxTable, TableRow: DocxTableRow, TableCell: DocxTableCell, WidthType } = await getDocx();

    const textNodes = editorRef.current.querySelectorAll('p, h1, h2, h3, table');
    const docParagraphs = [];

    textNodes.forEach(node => {
      const tag = node.tagName.toLowerCase();
      const text = node.innerText || '';

      if (tag === 'h1') {
        docParagraphs.push(new Paragraph({ text, heading: HeadingLevel.HEADING_1 }));
      } else if (tag === 'h2') {
        docParagraphs.push(new Paragraph({ text, heading: HeadingLevel.HEADING_2 }));
      } else if (tag === 'h3') {
        docParagraphs.push(new Paragraph({ text, heading: HeadingLevel.HEADING_3 }));
      } else if (tag === 'table') {
        const rows = [];
        node.querySelectorAll('tr').forEach(tr => {
          const cells = [];
          tr.querySelectorAll('td, th').forEach(td => {
            cells.push(new DocxTableCell({
              children: [new Paragraph({ text: td.innerText })],
              width: { size: 3000, type: WidthType.DXA }
            }));
          });
          if (cells.length > 0) rows.push(new DocxTableRow({ children: cells }));
        });
        if (rows.length > 0) docParagraphs.push(new DocxTable({ rows }));
      } else {
        if (text.trim() || node.querySelector('img')) {
          docParagraphs.push(new Paragraph({ children: [new TextRun(text)] }));
        }
      }
    });

    if (docParagraphs.length === 0) {
      docParagraphs.push(new Paragraph({ text: editorRef.current.innerText || 'Document' }));
    }

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            size: {
              width: orientation === 'portrait' ? 11906 : 16838,
              height: orientation === 'portrait' ? 16838 : 11906
            }
          }
        },
        children: docParagraphs
      }]
    });

    const blob = await Packer.toBlob(doc);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${roomName || 'Trinetra'}_Document.docx`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const handlePrint = () => {
    window.print();
  };

  // ─── Find & Replace Engine ──────────────────────────────────────────────────
  const handleFindNext = () => {
    if (!findText || !window.find) return;
    const found = window.find(findText, findMatchCase, false, true, false, true, false);
    if (!found) {
      alert(`No more matches found for "${findText}".`);
    }
  };

  const handleReplaceAll = () => {
    if (!findText || !editorRef.current || userRole === 'Viewer') return;
    // ReDoS guard: wrap RegExp construction in try/catch
    let regex;
    try {
      regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), findMatchCase ? 'g' : 'gi');
    } catch {
      alert('Invalid search pattern.');
      return;
    }
    const currentHtml = editorRef.current.innerHTML;
    const replaced = currentHtml.replace(regex, replaceText.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])));
    editorRef.current.innerHTML = replaced;
    handleEditorInput();
    alert('Replaced all occurrences in document.');
  };

  // ─── ✨ Trinetra AI Writing Copilot ─────────────────────────────────────────
  const handleAskAiWriting = async () => {
    const selection = window.getSelection().toString().trim();
    const selectedOrFullText = selection || editorRef.current?.innerText.slice(0, 1500) || '';
    if (!selectedOrFullText) return;

    setIsAiLoading(true);
    setAiResponse(null);

    let systemInstruction = '';
    switch (aiAction) {
      case 'improve': systemInstruction = 'Improve writing clarity, flow, and professional tone.'; break;
      case 'grammar': systemInstruction = 'Fix all grammatical, punctuation, and spelling errors.'; break;
      case 'concise': systemInstruction = 'Make this text concise and punchy without losing key meaning.'; break;
      case 'expand': systemInstruction = 'Expand and elaborate on the core points with professional detail.'; break;
      case 'summarize': systemInstruction = 'Provide a structured summary of the key takeaways.'; break;
      case 'custom': systemInstruction = aiCustomPrompt || 'Refine this text.'; break;
      default: systemInstruction = 'Polish this document text.';
    }

    try {
      const res = await fetch(getApiUrl('/api/ai-chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `You are Trinetra AI Document Writing Copilot.
Action: ${systemInstruction}

Text to Process:
"""
${selectedOrFullText}
"""

Respond with ONLY the revised text ready to be inserted into a Word document.`
        })
      });

      const data = await res.json();
      setAiResponse(data.response || 'Text improved.');
    } catch {
      setAiResponse('Could not connect to Trinetra AI writing assistant.');
    } finally {
      setIsAiLoading(false);
    }
  };

  const applyAiText = () => {
    if (!aiResponse || userRole === 'Viewer') return;
    execCmd('insertHTML', `<p>${aiResponse.replace(/\n/g, '<br/>')}</p>`);
    setShowAiModal(false);
  };

  // ─── Keyboard Shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl + Enter: Page Break
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        insertPageBreak();
      }
      // Ctrl + F: Find
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setShowFindReplace(true);
      }
      // Ctrl + P: Print
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        handlePrint();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [userRole]);

  // ─── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="trinetra-word-container">
      {/* ─── Ribbon Bar Header ──────────────────────────────────────────────── */}
      <div className="word-ribbon">
        <div className="ribbon-tabs-header">
          <div className="ribbon-brand-tag">
            <FileText size={16} className="brand-icon" />
            <span>Word Studio</span>
          </div>
          {['File', 'Home', 'Insert', 'Layout', 'References', 'Review', 'View', '✨ AI'].map(tab => (
            <button
              key={tab}
              className={`ribbon-tab-btn ${activeRibbonTab === tab ? 'active' : ''} ${tab === '✨ AI' ? 'ai-tab' : ''}`}
              onClick={() => {
                if (activeRibbonTab === tab && isRibbonCollapsed) {
                  setIsRibbonCollapsed(false);
                } else if (activeRibbonTab === tab && !isRibbonCollapsed) {
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
          {activeRibbonTab === 'Home' && (
            <div className="toolbar-section-group">
              {/* History */}
              <div className="toolbar-group">
                <button className="tool-btn" onClick={() => execCmd('undo')} title="Undo (Ctrl+Z)"><Undo size={14} /></button>
                <button className="tool-btn" onClick={() => execCmd('redo')} title="Redo (Ctrl+Y)"><Redo size={14} /></button>
              </div>

              <div className="toolbar-divider" />

              {/* Font Family & Size */}
              <div className="toolbar-group">
                <select className="tool-select" onChange={e => execCmd('fontName', e.target.value)} defaultValue="Calibri" title="Font Family">
                  <option value="Calibri">Calibri</option>
                  <option value="Arial">Arial</option>
                  <option value="Times New Roman">Times New Roman</option>
                  <option value="Georgia">Georgia</option>
                  <option value="Verdana">Verdana</option>
                  <option value="Courier New">Courier New</option>
                </select>

                <select className="tool-select font-size-select" onChange={e => execCmd('fontSize', e.target.value)} defaultValue="3" title="Font Size">
                  <option value="1">8 pt</option>
                  <option value="2">10 pt</option>
                  <option value="3">12 pt</option>
                  <option value="4">14 pt</option>
                  <option value="5">18 pt</option>
                  <option value="6">24 pt</option>
                  <option value="7">36 pt</option>
                </select>
              </div>

              <div className="toolbar-divider" />

              {/* Character Formatting */}
              <div className="toolbar-group">
                <button className="tool-btn" onClick={() => execCmd('bold')} title="Bold (Ctrl+B)"><Bold size={14} /></button>
                <button className="tool-btn" onClick={() => execCmd('italic')} title="Italic (Ctrl+I)"><Italic size={14} /></button>
                <button className="tool-btn" onClick={() => execCmd('underline')} title="Underline (Ctrl+U)"><Underline size={14} /></button>
                <button className="tool-btn" onClick={() => execCmd('strikeThrough')} title="Strikethrough"><Strikethrough size={14} /></button>
                <button className="tool-btn" onClick={() => execCmd('superscript')} title="Superscript">x²</button>
                <button className="tool-btn" onClick={() => execCmd('subscript')} title="Subscript">x₂</button>
              </div>

              <div className="toolbar-divider" />

              {/* Colors */}
              <div className="toolbar-group">
                <label className="color-picker-label" title="Font Color">
                  <Type size={14} />
                  <input type="color" onChange={e => execCmd('foreColor', e.target.value)} className="hidden-color-input" />
                </label>
                <label className="color-picker-label" title="Highlight Color">
                  <div style={{ width: '12px', height: '12px', background: '#facc15', borderRadius: '2px' }} />
                  <input type="color" onChange={e => execCmd('hiliteColor', e.target.value)} className="hidden-color-input" />
                </label>
              </div>

              <div className="toolbar-divider" />

              {/* Paragraph Formatting */}
              <div className="toolbar-group">
                <button className="tool-btn" onClick={() => execCmd('justifyLeft')} title="Align Left"><AlignLeft size={14} /></button>
                <button className="tool-btn" onClick={() => execCmd('justifyCenter')} title="Align Center"><AlignCenter size={14} /></button>
                <button className="tool-btn" onClick={() => execCmd('justifyRight')} title="Align Right"><AlignRight size={14} /></button>
                <button className="tool-btn" onClick={() => execCmd('justifyFull')} title="Justify"><AlignJustify size={14} /></button>
                <button className="tool-btn" onClick={() => execCmd('insertUnorderedList')} title="Bullet List"><List size={14} /></button>
                <button className="tool-btn" onClick={() => execCmd('insertOrderedList')} title="Numbered List"><ListOrdered size={14} /></button>
                <button className="tool-btn" onClick={() => execCmd('indent')} title="Increase Indent"><Indent size={14} /></button>
                <button className="tool-btn" onClick={() => execCmd('outdent')} title="Decrease Indent"><Outdent size={14} /></button>
              </div>

              <div className="toolbar-divider" />

              {/* Heading Styles */}
              <div className="toolbar-group">
                <button className="tool-btn action-pill-btn" onClick={() => applyStyleBlock('H1')}>Heading 1</button>
                <button className="tool-btn action-pill-btn" onClick={() => applyStyleBlock('H2')}>Heading 2</button>
                <button className="tool-btn action-pill-btn" onClick={() => applyStyleBlock('H3')}>Heading 3</button>
                <button className="tool-btn action-pill-btn" onClick={() => applyStyleBlock('P')}>Normal</button>
              </div>
            </div>
          )}

          {/* FILE TAB */}
          {activeRibbonTab === 'File' && (
            <div className="toolbar-section-group">
              <label className="tool-btn action-pill-btn">
                <Upload size={14} /> Open / Import (.docx)
                <input type="file" accept=".docx" onChange={handleImportDOCX} style={{ display: 'none' }} />
              </label>
              <button className="tool-btn action-pill-btn" onClick={handleExportDOCX}><Download size={14} /> Download Word (.docx)</button>
              <button className="tool-btn action-pill-btn" onClick={handlePrint}><Printer size={14} /> Print / Export PDF (Ctrl+P)</button>
            </div>
          )}

          {/* INSERT TAB */}
          {activeRibbonTab === 'Insert' && (
            <div className="toolbar-section-group">
              <button className="tool-btn action-pill-btn" onClick={() => setShowTablePicker(true)}><TableIcon size={14} /> Table</button>
              <label className="tool-btn action-pill-btn">
                <Image size={14} /> Picture
                <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} />
              </label>
              <button className="tool-btn action-pill-btn" onClick={() => setShowLinkModal(true)}><Link2 size={14} /> Link</button>
              <button className="tool-btn action-pill-btn" onClick={insertPageBreak} title="Page Break (Ctrl+Enter)"><Minus size={14} /> Page Break</button>
              <button className="tool-btn action-pill-btn" onClick={() => execCmd('insertHorizontalRule')}><Minus size={14} /> Horizontal Line</button>
              <button className="tool-btn action-pill-btn" onClick={() => execCmd('insertHTML', `<span>${new Date().toLocaleDateString()}</span>`)}><Calendar size={14} /> Date & Time</button>
            </div>
          )}

          {/* LAYOUT TAB */}
          {activeRibbonTab === 'Layout' && (
            <div className="toolbar-section-group">
              <div className="toolbar-group">
                <label className="layout-select-label">Size:</label>
                <select className="tool-select" value={pageSizeKey} onChange={e => setPageSizeKey(e.target.value)}>
                  {Object.entries(PAGE_SIZES).map(([key, val]) => (
                    <option key={key} value={key}>{val.name}</option>
                  ))}
                </select>
              </div>

              <div className="toolbar-divider" />

              <div className="toolbar-group">
                <label className="layout-select-label">Orientation:</label>
                <select className="tool-select" value={orientation} onChange={e => setOrientation(e.target.value)}>
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </div>

              <div className="toolbar-divider" />

              <div className="toolbar-group">
                <label className="layout-select-label">Margins:</label>
                <select className="tool-select" value={marginPreset} onChange={e => setMarginPreset(e.target.value)}>
                  {Object.entries(MARGIN_PRESETS).map(([key, val]) => (
                    <option key={key} value={key}>{val.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* REFERENCES TAB */}
          {activeRibbonTab === 'References' && (
            <div className="toolbar-section-group">
              <button className="tool-btn action-pill-btn" onClick={insertTableOfContents}><BookOpen size={14} /> Table of Contents</button>
              <button className="tool-btn action-pill-btn" onClick={() => execCmd('insertHTML', '<span class="footnote-ref">[1]</span>')}>Insert Footnote</button>
            </div>
          )}

          {/* REVIEW TAB */}
          {activeRibbonTab === 'Review' && (
            <div className="toolbar-section-group">
              <button className="tool-btn action-pill-btn" onClick={() => alert(`Document Statistics:\n• Words: ${wordCount}\n• Characters: ${charCount}\n• Pages: ~${pageCount}`)}>Word Count</button>
              <button className="tool-btn action-pill-btn" onClick={() => setShowFindReplace(true)}><Search size={14} /> Find & Replace (Ctrl+F)</button>
            </div>
          )}

          {/* VIEW TAB */}
          {activeRibbonTab === 'View' && (
            <div className="toolbar-section-group">
              <button className={`tool-btn action-pill-btn ${showOutline ? 'active' : ''}`} onClick={() => setShowOutline(o => !o)}><Layout size={14} /> Navigation Outline</button>
              <button className="tool-btn action-pill-btn" onClick={() => setZoomLevel(z => Math.max(50, z - 10))}><ZoomOut size={14} /> Zoom -</button>
              <span className="zoom-text">{zoomLevel}%</span>
              <button className="tool-btn action-pill-btn" onClick={() => setZoomLevel(z => Math.min(200, z + 10))}><ZoomIn size={14} /> Zoom +</button>
              <button className="tool-btn action-pill-btn" onClick={() => setZoomLevel(100)}>Fit 100%</button>
            </div>
          )}

          {/* AI TAB */}
          {activeRibbonTab === '✨ AI' && (
            <div className="toolbar-section-group">
              <button className="tool-btn action-pill-btn ai-btn" onClick={() => { setAiAction('improve'); setShowAiModal(true); }}>
                <Sparkles size={14} /> ✨ Improve Selected Writing
              </button>
              <button className="tool-btn action-pill-btn" onClick={() => { setAiAction('grammar'); setShowAiModal(true); }}>Fix Grammar</button>
              <button className="tool-btn action-pill-btn" onClick={() => { setAiAction('concise'); setShowAiModal(true); }}>Make Concise</button>
              <button className="tool-btn action-pill-btn" onClick={() => { setAiAction('expand'); setShowAiModal(true); }}>Expand Text</button>
              <button className="tool-btn action-pill-btn" onClick={() => { setAiAction('summarize'); setShowAiModal(true); }}>Summarize</button>
            </div>
          )}
        </div>
        )}
      </div>

      {/* ─── Document Workspace & Page Viewport ─────────────────────────────── */}
      <div className="word-workspace-body">
        {/* Navigation Outline Sidebar */}
        {showOutline && (
          <div className="word-outline-sidebar">
            <div className="outline-header">
              <h4>Headings Outline</h4>
              <button onClick={() => setShowOutline(false)}><X size={12} /></button>
            </div>
            <div className="outline-list">
              {headingsOutline.length === 0 ? (
                <p className="no-headings-text">Apply Heading 1, 2, or 3 styles to populate navigation outline.</p>
              ) : (
                headingsOutline.map(h => (
                  <a key={h.id} href={`#${h.id}`} className={`outline-item ${h.level}`}>
                    {h.text}
                  </a>
                ))
              )}
            </div>
          </div>
        )}

        {/* Scaled Document Pages Container */}
        <div className="word-document-scroll-viewport" style={{ zoom: `${zoomLevel}%` }}>
          <div className="word-paper-page" style={activePageStyle}>
            {/* Header Area */}
            <div className="word-page-header-banner">
              <input
                type="text"
                className="page-header-input"
                value={headerText}
                onChange={e => setHeaderText(e.target.value)}
                placeholder="Header Text (Double-click to edit)"
              />
            </div>

            {/* Editable Content Body */}
            <div
              ref={editorRef}
              className="word-editable-content"
              contentEditable={userRole !== 'Viewer'}
              onInput={handleEditorInput}
              suppressContentEditableWarning
            />

            {/* Footer Area with Page Numbers */}
            <div className="word-page-footer-banner">
              <input
                type="text"
                className="page-footer-input"
                value={footerText}
                onChange={e => setFooterText(e.target.value)}
                placeholder="Footer Text"
              />
              {showPageNumbers && <span className="footer-page-num">Page 1 of {pageCount}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Bottom Status Bar ──────────────────────────────────────────────── */}
      <div className="word-status-bar">
        <div className="status-left">
          <span>Page 1 of {pageCount}</span>
          <span className="status-sep">|</span>
          <span>Words: {wordCount}</span>
          <span className="status-sep">|</span>
          <span>Characters: {charCount}</span>
        </div>
        <div className="status-right">
          <span>English (US)</span>
          <span className="status-sep">|</span>
          <span>Zoom: {zoomLevel}%</span>
        </div>
      </div>

      {/* ─── Insert Link Modal ──────────────────────────────────────────────── */}
      {showLinkModal && (
        <div className="word-modal-overlay">
          <div className="word-modal-card">
            <div className="modal-header">
              <h3><Link2 size={16} /> Insert Hyperlink</h3>
              <button onClick={() => setShowLinkModal(false)}><X size={14} /></button>
            </div>
            <div className="modal-body">
              <div className="input-row">
                <label>Display Text:</label>
                <input type="text" value={linkText} onChange={e => setLinkText(e.target.value)} placeholder="e.g. Trinetra Documentation" />
              </div>
              <div className="input-row">
                <label>URL / Destination:</label>
                <input type="text" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://example.com" autoFocus />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowLinkModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleInsertLink}>Insert Link</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Table Dimension Picker Modal ──────────────────────────────────── */}
      {showTablePicker && (
        <div className="word-modal-overlay">
          <div className="word-modal-card">
            <div className="modal-header">
              <h3><TableIcon size={16} /> Insert Table</h3>
              <button onClick={() => setShowTablePicker(false)}><X size={14} /></button>
            </div>
            <div className="modal-body">
              <div className="input-row">
                <label>Number of Rows:</label>
                <input type="number" min={1} max={50} value={tableRows} onChange={e => setTableRows(parseInt(e.target.value) || 1)} />
              </div>
              <div className="input-row">
                <label>Number of Columns:</label>
                <input type="number" min={1} max={20} value={tableCols} onChange={e => setTableCols(parseInt(e.target.value) || 1)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowTablePicker(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => insertTable(tableRows, tableCols)}>Insert Table</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Find & Replace Dialog ─────────────────────────────────────────── */}
      {showFindReplace && (
        <div className="word-modal-overlay">
          <div className="word-modal-card">
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
                <input type="checkbox" id="wordMatchCase" checked={findMatchCase} onChange={e => setFindMatchCase(e.target.checked)} />
                <label htmlFor="wordMatchCase">Match Case</label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={handleFindNext}>Find Next</button>
              <button className="btn-primary" onClick={handleReplaceAll}>Replace All</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── ✨ AI Writing Copilot Modal ────────────────────────────────────── */}
      {showAiModal && (
        <div className="word-modal-overlay">
          <div className="word-modal-card ai-modal">
            <div className="modal-header">
              <h3><Sparkles size={16} /> Trinetra AI Writing Copilot</h3>
              <button onClick={() => setShowAiModal(false)}><X size={14} /></button>
            </div>
            <div className="modal-body">
              <div className="input-row">
                <label>Select AI Writing Goal:</label>
                <select className="tool-select" value={aiAction} onChange={e => setAiAction(e.target.value)}>
                  <option value="improve">Improve Writing & Clarity</option>
                  <option value="grammar">Fix Grammar & Punctuation</option>
                  <option value="concise">Make Concise & Punchy</option>
                  <option value="expand">Expand with Professional Detail</option>
                  <option value="summarize">Summarize Key Points</option>
                  <option value="custom">Custom Instruction</option>
                </select>
              </div>

              {aiAction === 'custom' && (
                <textarea
                  className="ai-prompt-input"
                  rows={2}
                  placeholder="Enter specific instructions for AI..."
                  value={aiCustomPrompt}
                  onChange={e => setAiCustomPrompt(e.target.value)}
                />
              )}

              {isAiLoading && <div className="ai-loading-indicator"><RefreshCw size={16} className="spin" /> Generating revision...</div>}

              {aiResponse && (
                <div className="ai-response-box">
                  <h4>AI Suggested Revision:</h4>
                  <pre>{aiResponse}</pre>
                  <button className="apply-formula-btn" onClick={applyAiText}>Apply to Document</button>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowAiModal(false)}>Close</button>
              <button className="btn-primary" onClick={handleAskAiWriting} disabled={isAiLoading}>Run AI Assistant</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * @file pages/Guide.jsx
 * @description Complete User Guide for AnonHub / Trinetra with table of contents,
 * collapsible sections, and search — documenting all modules across the platform.
 */

import React, { useState, useMemo } from 'react';
import {
    Book, ChevronDown, ChevronRight, Search, MessageSquare, FolderKanban,
    Code2, Palette, FileText, Share2, Clock, Shield, HelpCircle, Trash2,
    Upload, Zap, Table, ListTodo, Video, BarChart3, Save, Bot, Sparkles,
    Layers, Smartphone, Mic, MonitorUp, EyeOff, Lock, CheckSquare, RefreshCw
} from 'lucide-react';
import './Guide.css';

const SECTIONS = [
    {
        id: 'what-is-trinetra',
        icon: <Book size={18} />,
        title: '1. What is Trinetra / AnonHub?',
        content: (
            <div>
                <p>Trinetra (AnonHub) is a <strong>free, anonymous, all-in-one real-time collaboration suite</strong>. No registration, no user account, and no personal data tracking — just create or join a room with a password key and start collaborating with your team.</p>
                <p>Core Capabilities:</p>
                <ul>
                    <li>💬 <strong>Encrypted Chat Rooms:</strong> Instant messaging, voice notes recording, inline image rendering, and emoji reactions.</li>
                    <li>🚀 <strong>Project Workspaces:</strong> Real-time synchronized whiteboard, collaborative rich-text docs, and multi-language code runner.</li>
                    <li>🏢 <strong>Office Productivity Suite:</strong> Collaborative Excel-style spreadsheets, Word documents, Smart Notes, and Kanban task boards.</li>
                    <li>📹 <strong>High-Performance Video Calls:</strong> Ultra low-latency video and audio streaming powered by Media over QUIC (MoQ), WebTransport, and WebCodecs with screen sharing.</li>
                    <li>📝 <strong>Smart Notes with AI Organize:</strong> Collaborative notes with one-click AI structuring and checklist generation.</li>
                    <li>📊 <strong>Live Team Polls:</strong> Real-time anonymous voting with customizable expiration countdowns.</li>
                    <li>💾 <strong>Code Snippets Library:</strong> Reusable boilerplate library with search, language filters, and 1-click editor insertion.</li>
                    <li>🕒 <strong>Timeline & Version History:</strong> Live activity stream and version rollback snapshots.</li>
                    <li>🤖 <strong>AI Copilot:</strong> Floating context-aware assistant powered by Gemini.</li>
                </ul>
                <p>Every collaborator is assigned a random anonymous alias (e.g. <em>"Cosmic Nomad"</em>) with distinct color badges — zero personal identifiers are ever stored.</p>
            </div>
        )
    },
    {
        id: 'getting-started',
        icon: <Zap size={18} />,
        title: '2. Getting Started',
        content: (
            <div>
                <ol>
                    <li><strong>Open the Platform:</strong> Navigate to the Home page or launch the installed PWA desktop/mobile app.</li>
                    <li><strong>Choose a Space:</strong> Select either <strong>Chat Room</strong> (messaging), <strong>Project Room</strong> (all-in-one workspace), or <strong>Office Suite</strong> (spreadsheets, word, kanban).</li>
                    <li><strong>Enter Room Name & Access Key:</strong> Choose a memorable room name and password access key. Optionally set an <em>Owner Secret Key</em> if you want persistent creator privileges across devices.</li>
                    <li><strong>Invite Your Team:</strong> Click <strong>Copy Invite Link</strong> or open the <strong>Share Modal</strong> to send a direct pre-filled URL or QR code to teammates.</li>
                    <li><strong>Start Creating:</strong> All edits, drawings, code executions, and messages synchronize across connected peers in real time!</li>
                </ol>
                <div className="guide-tip">
                    <Shield size={14} />
                    <span>Keep your room access key private — anyone possessing the room name and access key can join your session.</span>
                </div>
            </div>
        )
    },
    {
        id: 'room-security-ownership',
        icon: <Shield size={18} />,
        title: '3. Room Security, Permissions & Ownership',
        content: (
            <div>
                <h4>Room Creator & Ownership Token</h4>
                <p>When you create a new room, your browser receives a cryptographic <strong>Owner Token</strong> saved to local storage. Room owners have exclusive administration capabilities.</p>
                <h4>Owner Secret Key</h4>
                <p>When creating a room, you can specify an optional <strong>Owner Secret Key</strong>. This secret key allows you to claim ownership from another device or browser session by clicking <strong>Enter Owner Key</strong> in the room header.</p>
                <h4>Granular Permissions</h4>
                <p>Owners can toggle permissions for participants from the <strong>Room Permissions</strong> modal:</p>
                <ul>
                    <li>✏️ <strong>Allow Drawing:</strong> Enable or disable whiteboard drawing for non-owners.</li>
                    <li>📄 <strong>Allow Document Editing:</strong> Toggle document editing permissions.</li>
                    <li>💻 <strong>Allow Code Editing / Execution:</strong> Restrict Monaco editor changes or sandboxed script execution to owner-only.</li>
                </ul>
                <h4>Rotating Access Keys</h4>
                <p>Room owners can rotate the room password at any time without deleting room data. Once rotated, new joiners must enter the new key.</p>
                <h4>Permanent Room Deletion</h4>
                <p>Room owners can permanently delete a room from <strong>Room Settings → Delete Room</strong>. All messages, files, documents, drawings, and office data are immediately and irreversibly purged from the database.</p>
            </div>
        )
    },
    {
        id: 'chat-rooms',
        icon: <MessageSquare size={18} />,
        title: '4. Real-Time Chat Rooms',
        content: (
            <div>
                <p>The <strong>Chat Room</strong> is an encrypted, real-time communication space designed for group messaging with complete anonymity.</p>
                <h4>Key Features</h4>
                <ul>
                    <li>⚡ <strong>Instant Delivery:</strong> Low-latency WebSocket message broadcasting with live typing indicators.</li>
                    <li>🎙️ <strong>Voice Notes:</strong> Record high-fidelity audio voice messages directly in the browser with inline playback.</li>
                    <li>🖼️ <strong>Inline Media Previews:</strong> Paste image URLs or upload images to display responsive previews directly in chat bubbles.</li>
                    <li>❤️ <strong>Emoji Reactions:</strong> Hover over any message to react with emojis (thumbs up, heart, fire, celebration, etc.).</li>
                    <li>📌 <strong>Pinned Messages:</strong> Pin important announcements or links to the top banner of the chat room.</li>
                    <li>💬 <strong>Threaded Replies:</strong> Quote and reply to specific messages in context.</li>
                    <li>✏️ <strong>Custom Nicknames:</strong> Click the pencil icon next to your name to change your random alias.</li>
                    <li>📹 <strong>Video Call Transition:</strong> Jump directly into a live video call session from the chat header.</li>
                </ul>
                <h4>Limits</h4>
                <ul>
                    <li>Maximum message length: 2,000 characters.</li>
                    <li>Maximum individual file upload: 10 MB.</li>
                    <li>Total room attachment quota: 100 MB.</li>
                </ul>
            </div>
        )
    },
    {
        id: 'whiteboard',
        icon: <Palette size={18} />,
        title: '5. Sketch Board (Interactive Whiteboard)',
        content: (
            <div>
                <p>The <strong>Sketch Board</strong> is a multi-user visual workspace powered by Fabric.js with instant vector synchronization.</p>
                <h4>Drawing & Annotation Tools</h4>
                <ul>
                    <li>🖊️ <strong>Freehand Pen & Brush:</strong> Smooth drawing with customizable stroke width and color palette.</li>
                    <li>✨ <strong>Laser Pointer:</strong> Ephemeral laser highlight tool that disappears after pointing.</li>
                    <li>📐 <strong>Geometric Shapes:</strong> Rectangle, Circle, Triangle, Diamond, Star, Line, and Arrow.</li>
                    <li>🅰️ <strong>Text Labels:</strong> Click anywhere on the canvas to type scalable annotations.</li>
                    <li>🧹 <strong>Eraser & Selection Tool:</strong> Select, move, scale, rotate, or erase canvas objects.</li>
                    <li>↩️ <strong>Undo / Redo:</strong> History stack with keyboard shortcuts (<kbd>U</kbd> / <kbd>R</kbd>).</li>
                    <li>🖼️ <strong>Export Canvas:</strong> Download high-resolution PNG image or vector PDF exports.</li>
                    <li>🎨 <strong>Canvas Styling:</strong> Toggle grid backgrounds, dark/light canvas mode, and background colors.</li>
                </ul>
            </div>
        )
    },
    {
        id: 'documents',
        icon: <FileText size={18} />,
        title: '6. Collaborative Document Board & Files',
        content: (
            <div>
                <p>The <strong>Document Board</strong> provides rich WYSIWYG document co-editing using TinyMCE with multi-cursor synchronization.</p>
                <h4>Features</h4>
                <ul>
                    <li>🔤 <strong>Rich Formatting:</strong> Headings, Bold, Italic, Strikethrough, Colors, Blockquotes, Tables, and Code blocks.</li>
                    <li>👥 <strong>Multi-User Sync:</strong> Live document updates with conflict-free merging.</li>
                    <li>🕒 <strong>Version History Snapshots:</strong> View automatic and manual document snapshots, preview past states, and rollback with 1 click.</li>
                    <li>📥 <strong>Document Export:</strong> Export your documentation as PDF, Markdown, HTML, or Word (.docx).</li>
                    <li>📎 <strong>Project Attachments:</strong> Drag and drop files to share attachments with file size indicators, download links, and delete controls.</li>
                </ul>
            </div>
        )
    },
    {
        id: 'coding-board',
        icon: <Code2 size={18} />,
        title: '7. Coding Board & Sandboxed Compiler',
        content: (
            <div>
                <p>The <strong>Coding Board</strong> integrates a full Monaco code editor (the core of VS Code) with a sandboxed backend compiler and live web preview.</p>
                <h4>Supported Languages</h4>
                <p>JavaScript (Node.js), Python 3, TypeScript, C++, Java, HTML, CSS, JSON.</p>
                <h4>Execution & Security Limits</h4>
                <ul>
                    <li>⚡ <strong>One-Click Execution:</strong> Click <strong>Run Code</strong> or press <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to compile and execute scripts.</li>
                    <li>🌐 <strong>Live Browser Preview:</strong> Click <strong>Live Preview</strong> to render HTML/JS/CSS code in a sandboxed iframe.</li>
                    <li>⏱️ <strong>5-Second Timeout:</strong> Infinite loops or blocking scripts are automatically terminated.</li>
                    <li>🔒 <strong>Sandboxed Isolation:</strong> Scripts run in restricted environments without filesystem, network, or environment variable access.</li>
                    <li>📤 <strong>Output Ceiling:</strong> Terminal outputs are capped at 512 KB to prevent buffer overflows.</li>
                    <li>🎨 <strong>Code Formatting:</strong> Format code automatically using Prettier.</li>
                </ul>
            </div>
        )
    },
    {
        id: 'office-suite',
        icon: <Table size={18} />,
        title: '8. Office Productivity Suite',
        content: (
            <div>
                <p>The <strong>Office Suite</strong> provides 4 dedicated productivity applications in a single unified room:</p>
                <h4>1. Spreadsheet (Excel)</h4>
                <ul>
                    <li>Reactive 2D grid with column letters (A-H) and row numbers (1-20+).</li>
                    <li>Formula calculation engine supporting <code>=SUM(A1:A5)</code>, <code>=AVERAGE(A1:A5)</code>, <code>=MIN</code>, <code>=MAX</code>, <code>=COUNT</code>, and arithmetic (e.g. <code>=A1*B1+10</code>).</li>
                    <li>Import and Export formatted CSV files.</li>
                </ul>
                <h4>2. Document Processor (Word)</h4>
                <ul>
                    <li>Full-featured word processor with font styling, alignments, ordered/unordered lists, and print/export layout.</li>
                </ul>
                <h4>3. Smart Notes</h4>
                <ul>
                    <li>Lightweight collaborative note-taking with one-click <strong>AI Organize</strong> formatting.</li>
                </ul>
                <h4>4. Kanban Project Board</h4>
                <ul>
                    <li>Track workflows across 4 stages: <em>To Do</em>, <em>In Progress</em>, <em>Review</em>, and <em>Done</em>.</li>
                    <li>Create task cards with titles, descriptions, assignees, and priority tags with real-time drag-and-drop state sync.</li>
                </ul>
            </div>
        )
    },
    {
        id: 'video-calls',
        icon: <Video size={18} />,
        title: '9. Video & Audio Call Room (MoQ / WebTransport)',
        content: (
            <div>
                <p>The <strong>Video Call Room</strong> provides ultra-low latency, real-time video conferencing and screen sharing powered by <strong>Media over QUIC (MoQ)</strong> via browser-native WebTransport and WebCodecs (with resilient Socket.IO fallback).</p>
                <h4>Features</h4>
                <ul>
                    <li>🎙️ <strong>Pre-Join Check:</strong> Test and toggle your microphone and camera before entering the live session.</li>
                    <li>🖥️ <strong>Screen Sharing:</strong> 1-click screen presentation with built-in anti-mirroring guidance.</li>
                    <li>🎛️ <strong>Adaptive Video Mesh Grid:</strong> Multi-tile video grid with active microphone indicators and high-framerate rendering on HTML5 Canvas.</li>
                    <li>💬 <strong>In-Call Chat & Roster:</strong> Send text messages and view the online participant list alongside video streams.</li>
                    <li>🔄 <strong>Instant Reconnect:</strong> Automatic connection health monitoring and stream restoration.</li>
                </ul>
            </div>
        )
    },
    {
        id: 'smart-notes',
        icon: <CheckSquare size={18} />,
        title: '10. Smart Notes & AI Organization',
        content: (
            <div>
                <p><strong>Smart Notes</strong> gives your team a shared scratchpad for capturing brainstorms, meeting minutes, and specifications.</p>
                <h4>AI Organize Feature</h4>
                <p>Click the <strong>✨ AI Organize</strong> button to send messy raw text dumps to Gemini AI. The AI automatically formats and structures the text into:</p>
                <ul>
                    <li>📌 <strong>Executive Summary:</strong> High-level overview of key discussion points.</li>
                    <li>📋 <strong>Action Items:</strong> Checkboxes with designated tasks and deliverables.</li>
                    <li>💡 <strong>Key Takeaways:</strong> Categorized bullet points for fast reading.</li>
                </ul>
            </div>
        )
    },
    {
        id: 'polls',
        icon: <BarChart3 size={18} />,
        title: '11. Live Team Polls',
        content: (
            <div>
                <p>Create anonymous <strong>Live Polls</strong> within any Project Room to gather team consensus quickly and decisively.</p>
                <h4>Poll Capabilities</h4>
                <ul>
                    <li>🗳️ <strong>Multiple Choices:</strong> Add custom question prompts and options.</li>
                    <li>⏱️ <strong>Expiration Countdown:</strong> Set custom poll lifetimes (15m, 1h, 24h) after which voting is locked.</li>
                    <li>📊 <strong>Live Results:</strong> Real-time percentage bars and vote counters update as participants vote anonymously.</li>
                </ul>
            </div>
        )
    },
    {
        id: 'snippets',
        icon: <Save size={18} />,
        title: '12. Code Snippets Library',
        content: (
            <div>
                <p>The <strong>Snippets Library</strong> enables teams to store and organize reusable code templates directly within the Project Workspace.</p>
                <h4>Capabilities</h4>
                <ul>
                    <li>🏷️ <strong>Language Categorization:</strong> Tag snippets by language (JavaScript, Python, TypeScript, HTML, CSS, C++, Java).</li>
                    <li>🔍 <strong>Instant Search:</strong> Filter snippets by keyword or language tag.</li>
                    <li>⚡ <strong>1-Click Insert:</strong> Click <em>Insert Code</em> to paste any snippet directly into the Monaco coding editor.</li>
                </ul>
            </div>
        )
    },
    {
        id: 'timeline-versioning',
        icon: <Clock size={18} />,
        title: '13. Activity Timeline & Version History',
        content: (
            <div>
                <h4>Live Activity Timeline</h4>
                <p>The <strong>Timeline</strong> tab logs real-time workspace events as they happen:</p>
                <ul>
                    <li>👤 User joins and leaves</li>
                    <li>📄 Document updates and edits</li>
                    <li>💻 Code executions and snippet saves</li>
                    <li>📊 Poll creations and votes</li>
                    <li>⚙️ Permission and access key modifications</li>
                </ul>
                <h4>Version Snapshots & Rollback</h4>
                <p>Never lose work: both documents and code maintain historical snapshots. Owners can click <strong>Save Version</strong> to label custom milestones or restore any previous snapshot with one click.</p>
            </div>
        )
    },
    {
        id: 'ai-copilot',
        icon: <Bot size={18} />,
        title: '14. AI Copilot Assistant',
        content: (
            <div>
                <p>The floating <strong>AI Copilot</strong> button (located in the bottom-right corner) provides instant AI assistance powered by Google Gemini.</p>
                <h4>How AI Copilot Helps:</h4>
                <ul>
                    <li>💻 <strong>Coding Help:</strong> Write functions, explain syntax, debug errors, and suggest optimizations.</li>
                    <li>📝 <strong>Writing & Copy:</strong> Draft specifications, proofread meeting summaries, and create templates.</li>
                    <li>🎨 <strong>Design & Structure:</strong> Recommend architecture patterns, CSS layouts, and UI components.</li>
                </ul>
            </div>
        )
    },
    {
        id: 'themes-pwa',
        icon: <Smartphone size={18} />,
        title: '15. Color Themes & PWA Installation',
        content: (
            <div>
                <h4>6 Curated Color Themes</h4>
                <p>Select your favorite visual style from the theme dropdown in the Navbar:</p>
                <ul>
                    <li>☀️ <strong>Modern Light:</strong> Clean, high-contrast light mode.</li>
                    <li>🌙 <strong>Dark:</strong> Sleek slate-dark palette for low-light environments.</li>
                    <li>🧛 <strong>Dracula:</strong> Deep purple and vampiric aesthetic.</li>
                    <li>⚡ <strong>Cyberpunk:</strong> Neon yellow and vibrant high-energy contrasts.</li>
                    <li>🌊 <strong>Ocean:</strong> Deep marine blue and cyan accents.</li>
                    <li>🌌 <strong>Midnight:</strong> Deep space dark theme with starry glow.</li>
                </ul>
                <h4>Install as a Desktop or Mobile App (PWA)</h4>
                <p>AnonHub is a certified Progressive Web App. Click <strong>Install App</strong> in the Navbar or landing banner to install it as a standalone application on Windows, Mac, Linux, Android, or iOS with fast local caching.</p>
            </div>
        )
    },
    {
        id: 'room-expiration',
        icon: <Clock size={18} />,
        title: '16. Room Inactivity & Expiration Policy',
        content: (
            <div>
                <div className="guide-warning">
                    <Clock size={14} />
                    <span>Rooms automatically become <strong>inactive after 15 days</strong> without meaningful activity.</span>
                </div>
                <h4>What counts as activity?</h4>
                <ul>
                    <li>Sending a chat message</li>
                    <li>Editing a document, code file, or spreadsheet</li>
                    <li>Drawing on the whiteboard</li>
                    <li>Uploading or deleting a file</li>
                </ul>
                <p>Inactive rooms are permanently deleted along with all associated messages, files, documents, and whiteboard drawings. To keep a room active, simply interact with it regularly.</p>
            </div>
        )
    },
    {
        id: 'privacy-security',
        icon: <Lock size={18} />,
        title: '17. Privacy, Security & Limits',
        content: (
            <div>
                <ul>
                    <li>✅ <strong>Zero Registration:</strong> No names, email addresses, phone numbers, or credentials collected.</li>
                    <li>✅ <strong>Hashed Access Keys:</strong> Room access keys are protected with bcrypt cryptographic hashing.</li>
                    <li>✅ <strong>Sandboxed Execution:</strong> User scripts run in isolated sub-processes with memory, time, and syscall restrictions.</li>
                    <li>✅ <strong>Rate Limiting:</strong> Endpoints are rate-limited to protect against DDoS and brute-force attacks.</li>
                    <li>✅ <strong>Storage Quotas:</strong> 10 MB per file, 100 MB per room to prevent server resource exhaustion.</li>
                </ul>
            </div>
        )
    },
    {
        id: 'troubleshooting',
        icon: <HelpCircle size={18} />,
        title: '18. Troubleshooting & FAQ',
        content: (
            <div>
                <dl>
                    <dt>Cannot join a room</dt>
                    <dd>Check that the room name and access key are typed accurately. Room names and keys are case-sensitive.</dd>
                    <dt>Video call microphone or camera not working</dt>
                    <dd>Ensure your browser has granted permission to access your camera and microphone. In browser settings, check that permissions are allowed for this site.</dd>
                    <dt>Code execution timed out (5s limit)</dt>
                    <dd>Your script took longer than 5 seconds to complete. Check for infinite loops (e.g. <code>while(true)</code>) or long-running computations.</dd>
                    <dt>Spreadsheet formula returns #ERROR!</dt>
                    <dd>Check formula syntax. Formulas must start with <code>=</code> (e.g. <code>=SUM(A1:A5)</code> or <code>=A1+B1</code>) and reference valid cell coordinates.</dd>
                    <dt>File upload failed</dt>
                    <dd>Files must be under 10 MB, and the room's total storage cannot exceed 100 MB. Ask the room owner to delete old files to free up space.</dd>
                    <dt>How do I start the interactive Quick Tour?</dt>
                    <dd>Click the <strong>💡 Quick Tour</strong> button in the top navigation bar or the <strong>Tour Guide</strong> button in any room header at any time.</dd>
                </dl>
            </div>
        )
    }
];

export default function Guide() {
    const [openSections, setOpenSections] = useState(new Set(['what-is-trinetra', 'getting-started']));
    const [search, setSearch] = useState('');

    const toggleSection = (id) => {
        setOpenSections(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const expandAll = () => setOpenSections(new Set(SECTIONS.map(s => s.id)));
    const collapseAll = () => setOpenSections(new Set());

    const filtered = useMemo(() => {
        if (!search.trim()) return SECTIONS;
        const q = search.toLowerCase();
        return SECTIONS.filter(s => s.title.toLowerCase().includes(q));
    }, [search]);

    return (
        <main className="guide-page page-container">
            <div className="guide-hero">
                <Book size={40} className="guide-hero-icon" />
                <div>
                    <h2 className="guide-title">AnonHub & Trinetra User Guide</h2>
                    <p className="guide-subtitle">Comprehensive documentation for all collaborative workspaces, office tools, video calling, and AI features.</p>
                </div>
            </div>

            {/* Search + Controls */}
            <div className="guide-controls">
                <div className="guide-search-wrap">
                    <Search size={16} className="guide-search-icon" />
                    <input
                        type="search"
                        className="guide-search"
                        placeholder="Search features (e.g. spreadsheet, video call, compiler, whiteboard)..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        aria-label="Search guide sections"
                    />
                </div>
                <div className="guide-control-btns">
                    <button className="guide-ctrl-btn" onClick={expandAll}>Expand All</button>
                    <button className="guide-ctrl-btn" onClick={collapseAll}>Collapse All</button>
                </div>
            </div>

            {/* TOC */}
            <nav className="guide-toc" aria-label="Table of contents">
                <p className="guide-toc-label">Quick Navigation</p>
                <div className="guide-toc-links">
                    {SECTIONS.map(s => (
                        <a
                            key={s.id}
                            href={`#${s.id}`}
                            className="guide-toc-link"
                            onClick={e => {
                                e.preventDefault();
                                setOpenSections(prev => new Set([...prev, s.id]));
                                document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }}
                        >
                            {s.title.split('. ')[1] || s.title}
                        </a>
                    ))}
                </div>
            </nav>

            {/* Sections */}
            <div className="guide-sections">
                {filtered.length === 0 && (
                    <p className="guide-no-results">No sections matched "<strong>{search}</strong>". Try searching for <em>spreadsheet</em>, <em>video call</em>, <em>whiteboard</em>, <em>code</em>, or <em>polls</em>.</p>
                )}
                {filtered.map(section => {
                    const isOpen = openSections.has(section.id);
                    return (
                        <div key={section.id} id={section.id} className={`guide-section ${isOpen ? 'open' : ''}`}>
                            <button
                                className="guide-section-header"
                                onClick={() => toggleSection(section.id)}
                                aria-expanded={isOpen}
                            >
                                <span className="guide-section-icon">{section.icon}</span>
                                <span className="guide-section-title">{section.title}</span>
                                <span className="guide-section-chevron">
                                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                </span>
                            </button>
                            {isOpen && (
                                <div className="guide-section-body">
                                    {section.content}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </main>
    );
}

/**
 * @file Home.jsx
 * @description Modern, premium SaaS Landing Page for AnonHub / Trinetra.
 * Features an interactive collaboration network visual, simulated product mockup
 * with live tab switching, smooth scroll reveal animations, interactive feature cards,
 * AI Copilot playground, room lifecycle visualizer, technology showcase, and room creation gateways.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { getApiUrl } from '../config';
import {
  MessageSquare,
  FolderPlus,
  Users,
  Zap,
  EyeOff,
  ArrowRight,
  Shield,
  Lock,
  Code2,
  Send,
  Share2,
  Copy,
  Check,
  Palette,
  FileText,
  Table,
  Video,
  Sparkles,
  Bot,
  Terminal,
  Clock,
  CheckCircle2,
  ChevronDown,
  Layers,
  HelpCircle,
  ExternalLink,
  Laptop,
  Cpu,
  Flame,
  Radio,
  FileCode,
  ListTodo,
  BarChart3,
  Globe
} from 'lucide-react';
import './Home.css';
import { setCookie } from '../services/socket';
import PWAInstallPrompt from '../components/PWAInstallPrompt';

export default function Home() {
  const navigate = useNavigate();

  // Chat Form State
  const [chatRoom, setChatRoom] = useState('');
  const [chatKey, setChatKey] = useState('');
  const [chatOwnerKey, setChatOwnerKey] = useState('');
  const [chatError, setChatError] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  // Project Form State
  const [projectName, setProjectName] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [projectOwnerKey, setProjectOwnerKey] = useState('');
  const [projectError, setProjectError] = useState('');
  const [projectLoading, setProjectLoading] = useState(false);

  // Copy state
  const [chatCopied, setChatCopied] = useState(false);
  const [projCopied, setProjCopied] = useState(false);

  // Interactive Product Preview Tab state
  const [activeMockupTab, setActiveMockupTab] = useState('code'); // 'code' | 'whiteboard' | 'document' | 'spreadsheet' | 'chat' | 'call'

  // AI Copilot Playground state
  const [activeAiPrompt, setActiveAiPrompt] = useState('code'); // 'code' | 'notes' | 'spreadsheet'

  // Onboarding walkthrough tour state
  const [tourStep, setTourStep] = useState(-1);

  // Room gateway form tab
  const [gatewayTab, setGatewayTab] = useState('project'); // 'project' | 'chat'

  // Owner key collapse accordion
  const [showChatOwnerKey, setShowChatOwnerKey] = useState(false);
  const [showProjectOwnerKey, setShowProjectOwnerKey] = useState(false);

  // Scroll to room creation form
  const scrollToGateway = (type = 'project') => {
    setGatewayTab(type);
    const el = document.getElementById('room-gateway-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleCopyChatInvite = () => {
    if (!chatRoom.trim() || !chatKey.trim()) return;
    const url = `${window.location.origin}/chat/${encodeURIComponent(chatRoom.trim())}?key=${encodeURIComponent(chatKey.trim())}`;
    navigator.clipboard.writeText(url).then(() => {
      setChatCopied(true);
      setTimeout(() => setChatCopied(false), 2500);
    });
  };

  const handleCopyProjectInvite = () => {
    if (!projectName.trim() || !projectKey.trim()) return;
    const url = `${window.location.origin}/projects/${encodeURIComponent(projectName.trim())}?key=${encodeURIComponent(projectKey.trim())}`;
    navigator.clipboard.writeText(url).then(() => {
      setProjCopied(true);
      setTimeout(() => setProjCopied(false), 2500);
    });
  };

  // Tour listeners & initial launch
  useEffect(() => {
    const handleStartTour = () => setTourStep(0);
    window.addEventListener('start-trinetra-tour', handleStartTour);
    window.addEventListener('start-anonhub-tour', handleStartTour);

    const hasSeenTour = localStorage.getItem('trinetra_home_tour_seen') || localStorage.getItem('anonhub_home_tour_seen');
    if (!hasSeenTour) {
      const t = setTimeout(() => setTourStep(0), 1200);
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

  // Tour auto-scrolling
  useEffect(() => {
    if (tourStep < 0) return;
    const timer = setTimeout(() => {
      if (tourStep === 0) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (tourStep === 1) {
        const el = document.getElementById('home-chat-card') || document.getElementById('room-gateway-section');
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (tourStep === 2) {
        const el = document.getElementById('home-project-card') || document.getElementById('room-gateway-section');
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (tourStep === 3) {
        const el = document.querySelector('.ai-chatbot-bubble') || document.getElementById('ai-copilot-section');
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (tourStep === 4) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [tourStep]);

  // Join Chat Room
  const handleJoinChat = async (e) => {
    e.preventDefault();
    setChatError('');
    if (!chatRoom.trim() || !chatKey.trim()) {
      setChatError('Room name and access key are required.');
      return;
    }

    setChatLoading(true);
    try {
      const response = await fetch(getApiUrl('/join-chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: chatRoom.trim(), accessKey: chatKey.trim(), ownerKey: chatOwnerKey.trim() })
      });

      const data = await response.json();
      if (response.ok && data.redirectUrl) {
        sessionStorage.setItem(`accesskey_chat_${chatRoom.trim()}`, chatKey.trim());
        if (data.ownerToken) {
          localStorage.setItem(`owner_token_chat_${chatRoom.trim()}`, data.ownerToken);
          localStorage.setItem(`owner_token_${chatRoom.trim()}`, data.ownerToken);
        }
        navigate(`/chat/${encodeURIComponent(chatRoom.trim())}`);
      } else {
        setChatError(data.error || 'Could not join chat room.');
      }
    } catch (err) {
      console.error(err);
      setChatError('Network error. Please check your connection.');
    } finally {
      setChatLoading(false);
    }
  };

  // Create or Join Project Room
  const handleCreateProject = async (e) => {
    e.preventDefault();
    setProjectError('');
    if (!projectName.trim() || !projectKey.trim()) {
      setProjectError('Project name and access key are required.');
      return;
    }

    setProjectLoading(true);
    try {
      const response = await fetch(getApiUrl('/create-project'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projectName.trim(), accessKey: projectKey.trim(), ownerKey: projectOwnerKey.trim() })
      });

      const data = await response.json();
      if (response.ok && data.redirectUrl) {
        sessionStorage.setItem(`accesskey_project_${projectName.trim()}`, projectKey.trim());
        setCookie(`accesskey_project_${projectName.trim()}`, projectKey.trim());
        if (data.ownerToken) {
          localStorage.setItem(`owner_token_${projectName.trim()}`, data.ownerToken);
          localStorage.setItem(`owner_token_chat_${projectName.trim()}`, data.ownerToken);
        }
        navigate(`/projects/${encodeURIComponent(projectName.trim())}`);
      } else {
        setProjectError(data.error || 'Could not create project.');
      }
    } catch (err) {
      console.error(err);
      setProjectError('Network error. Please check your connection.');
    } finally {
      setProjectLoading(false);
    }
  };

  return (
    <div className="anonhub-landing-root">
      {/* Background Animated Ambient Lights & Grid */}
      <div className="landing-ambient-canvas" aria-hidden="true">
        <div className="ambient-orb orb-primary" />
        <div className="ambient-orb orb-secondary" />
        <div className="ambient-orb orb-tertiary" />
        <div className="ambient-grid-overlay" />
      </div>

      <PWAInstallPrompt variant="banner" />

      {/* ─────────────────────────────────────────────────────────────────────────────
          1. HERO SECTION
          ───────────────────────────────────────────────────────────────────────────── */}
      <section className="landing-hero-section">
        <div className="hero-content-wrapper">
          {/* Top Trust Badge */}
          <div className="hero-status-pill animate-fade-in">
            <span className="live-pulse-dot" />
            <span className="status-badge-text">100% Anonymous • Zero Accounts • Real-Time Collaboration</span>
          </div>

          {/* Main Title */}
          <h1 className="hero-main-title animate-slide-up">
            Collaborate. Create. Connect.
            <span className="hero-gradient-title"> Anonymously in Real-Time.</span>
          </h1>

          {/* Subtitle */}
          <p className="hero-subtext animate-slide-up delay-1">
            An all-in-one collaborative workspace for teams, developers, and students.
            Chat, write documents, compile code, sketch on whiteboards, manage spreadsheets,
            and video call — with zero sign-ups and total privacy.
          </p>

          {/* CTA Buttons */}
          <div className="hero-cta-group animate-slide-up delay-2">
            <Link
              to="/global-chat"
              className="btn-hero-primary"
              id="hero-global-chat-btn"
              style={{ background: 'linear-gradient(135deg, #2563eb, #8b5cf6)', border: 'none' }}
            >
              <Globe size={18} />
              <span>Global Chat (No Login)</span>
            </Link>
            <button
              onClick={() => scrollToGateway('project')}
              className="btn-hero-secondary"
              id="hero-create-room-btn"
            >
              <span>Create Private Room</span>
              <ArrowRight size={16} className="btn-arrow-icon" />
            </button>
            <button
              onClick={() => {
                const el = document.getElementById('product-preview-section');
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="btn-hero-secondary"
            >
              <Laptop size={16} />
              <span>Explore Workspace</span>
            </button>
          </div>

          {/* Live Feature Highlights Strip */}
          <div className="hero-features-strip animate-fade-in delay-3">
            <div className="hero-strip-item">
              <Lock size={15} className="icon-pink" />
              <span>Bcrypt Security</span>
            </div>
            <span className="strip-dot">•</span>
            <div className="hero-strip-item">
              <Zap size={15} className="icon-blue" />
              <span>Instant Sync</span>
            </div>
            <span className="strip-dot">•</span>
            <div className="hero-strip-item">
              <Radio size={15} className="icon-purple" />
              <span>Media over QUIC (MoQ)</span>
            </div>
            <span className="strip-dot">•</span>
            <div className="hero-strip-item">
              <Bot size={15} className="icon-gold" />
              <span>Gemini AI Copilot</span>
            </div>
          </div>
        </div>

        {/* Hero Collaboration Network Visualization */}
        <div className="hero-network-visual-container">
          <div className="network-visual-card">
            {/* Center Hub */}
            <div className="network-center-hub">
              <div className="hub-pulse-ring" />
              <div className="hub-core-badge">
                <Shield size={24} className="hub-shield-icon" />
                <span>AnonHub</span>
              </div>
            </div>

            {/* Connecting Nodes */}
            <div className="network-satellite-node node-code">
              <Code2 size={16} />
              <span>Coding Board</span>
              <span className="node-user-tag user-coder">Galaxy Coder</span>
            </div>

            <div className="network-satellite-node node-sketch">
              <Palette size={16} />
              <span>Whiteboard</span>
              <span className="node-user-tag user-artist">Neon Thinker</span>
            </div>

            <div className="network-satellite-node node-doc">
              <FileText size={16} />
              <span>Documents</span>
              <span className="node-user-tag user-writer">Silent Fox</span>
            </div>

            <div className="network-satellite-node node-chat">
              <MessageSquare size={16} />
              <span>Chat Room</span>
              <span className="node-user-tag user-chatter">Cosmic Nomad</span>
            </div>

            <div className="network-satellite-node node-office">
              <Table size={16} />
              <span>Spreadsheet</span>
              <span className="node-user-tag user-office">Data Swift</span>
            </div>

            <div className="network-satellite-node node-video">
              <Video size={16} />
              <span>Video Call</span>
              <span className="node-user-tag user-video">Media Live</span>
            </div>

            {/* SVG Connecting Lines with animated data pulses */}
            <svg className="network-svg-lines" viewBox="0 0 500 380">
              <defs>
                <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="var(--primary-color)" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="var(--secondary-color)" stopOpacity="0.8" />
                </linearGradient>
              </defs>
              <line x1="250" y1="190" x2="80" y2="70" stroke="url(#lineGrad)" strokeWidth="1.5" strokeDasharray="4 4" className="pulse-line-1" />
              <line x1="250" y1="190" x2="420" y2="70" stroke="url(#lineGrad)" strokeWidth="1.5" strokeDasharray="4 4" className="pulse-line-2" />
              <line x1="250" y1="190" x2="60" y2="280" stroke="url(#lineGrad)" strokeWidth="1.5" strokeDasharray="4 4" className="pulse-line-3" />
              <line x1="250" y1="190" x2="440" y2="280" stroke="url(#lineGrad)" strokeWidth="1.5" strokeDasharray="4 4" className="pulse-line-4" />
              <line x1="250" y1="190" x2="250" y2="40" stroke="url(#lineGrad)" strokeWidth="1.5" strokeDasharray="4 4" className="pulse-line-5" />
              <line x1="250" y1="190" x2="250" y2="340" stroke="url(#lineGrad)" strokeWidth="1.5" strokeDasharray="4 4" className="pulse-line-6" />
            </svg>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────────────────────
          2. INTERACTIVE PRODUCT PREVIEW SIMULATOR
          ───────────────────────────────────────────────────────────────────────────── */}
      <section className="landing-section product-preview-section" id="product-preview-section">
        <div className="section-header-center">
          <div className="section-kicker">
            <Sparkles size={14} />
            <span>Interactive Simulator</span>
          </div>
          <h2 className="section-heading">Everything You Need in One Screen</h2>
          <p className="section-description">
            Experience real-time co-creation across dedicated specialized boards. Switch between views to preview actual workspace workflows.
          </p>
        </div>

        {/* Simulator App Window */}
        <div className="simulator-window-container">
          {/* Mockup TitleBar */}
          <div className="simulator-window-titlebar">
            <div className="titlebar-top-row">
              <div className="window-dots">
                <span className="dot red" />
                <span className="dot yellow" />
                <span className="dot green" />
              </div>

              {/* Online users presence */}
              <div className="simulator-user-avatars">
                <div className="avatar-stack">
                  <span className="sim-avatar av-purple" title="Galaxy Coder">G</span>
                  <span className="sim-avatar av-blue" title="Silent Fox">S</span>
                  <span className="sim-avatar av-pink" title="Cosmic Nomad">C</span>
                </div>
                <span className="sim-online-tag">3 online</span>
              </div>
            </div>

            {/* Interactive Module Tabs */}
            <div className="simulator-tabs-switcher">
              <button
                className={`sim-tab-btn ${activeMockupTab === 'code' ? 'active' : ''}`}
                onClick={() => setActiveMockupTab('code')}
              >
                <Code2 size={13} />
                <span>Coding Board</span>
              </button>
              <button
                className={`sim-tab-btn ${activeMockupTab === 'whiteboard' ? 'active' : ''}`}
                onClick={() => setActiveMockupTab('whiteboard')}
              >
                <Palette size={13} />
                <span>Whiteboard</span>
              </button>
              <button
                className={`sim-tab-btn ${activeMockupTab === 'document' ? 'active' : ''}`}
                onClick={() => setActiveMockupTab('document')}
              >
                <FileText size={13} />
                <span>Document</span>
              </button>
              <button
                className={`sim-tab-btn ${activeMockupTab === 'spreadsheet' ? 'active' : ''}`}
                onClick={() => setActiveMockupTab('spreadsheet')}
              >
                <Table size={13} />
                <span>Spreadsheet</span>
              </button>
              <button
                className={`sim-tab-btn ${activeMockupTab === 'chat' ? 'active' : ''}`}
                onClick={() => setActiveMockupTab('chat')}
              >
                <MessageSquare size={13} />
                <span>Chat</span>
              </button>
              <button
                className={`sim-tab-btn ${activeMockupTab === 'call' ? 'active' : ''}`}
                onClick={() => setActiveMockupTab('call')}
              >
                <Video size={13} />
                <span>Video Call</span>
              </button>
            </div>
          </div>

          {/* Simulator Body */}
          <div className="simulator-window-body">
            {/* VIEW 1: CODE EDITOR */}
            {activeMockupTab === 'code' && (
              <div className="sim-view sim-view-code">
                <div className="sim-code-editor">
                  <div className="sim-code-toolbar">
                    <span className="code-lang-tag">JavaScript (Node.js)</span>
                    <button className="sim-run-code-btn">
                      <Zap size={12} fill="white" />
                      <span>Run Code (Ctrl+Enter)</span>
                    </button>
                  </div>
                  <div className="sim-code-content">
                    {/* Simulated live user cursor */}
                    <div className="sim-remote-cursor cursor-one" style={{ top: '68px', left: '260px' }}>
                      <span className="cursor-flag">Galaxy Coder</span>
                    </div>

                    <pre className="code-lines">
                      <code>{`// 🚀 AnonHub Sandboxed Collaboration
import { createRealtimeMesh } from 'anonhub-sync';

async function launchProjectWorkspace(room) {
  const session = await createRealtimeMesh({
    room: room.id,
    encryption: 'aes-256-gcm',
    features: ['code', 'sketch', 'docs', 'ai']
  });

  // Collaborative peer sync
  session.on('peer-edit', (patch) => {
    applyLiveDelta(patch);
  });

  console.log("Connected peers: 4 | Latency: 12ms");
  return session.status;
}`}</code>
                    </pre>
                  </div>
                  {/* Console output bar */}
                  <div className="sim-console-output">
                    <div className="console-header">
                      <Terminal size={12} />
                      <span>Terminal Execution Sandbox (5s Timeout Safe)</span>
                    </div>
                    <div className="console-body">
                      <span className="console-green">✔ [Success] Script compiled successfully in 28ms</span>
                      <br />
                      <span className="console-text">&gt; Connected peers: 4 | Latency: 12ms</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* VIEW 2: WHITEBOARD */}
            {activeMockupTab === 'whiteboard' && (
              <div className="sim-view sim-view-whiteboard">
                <div className="sim-whiteboard-toolbar">
                  <span className="wb-tool active">🖊️ Pen</span>
                  <span className="wb-tool">✨ Laser</span>
                  <span className="wb-tool">⬜ Rect</span>
                  <span className="wb-tool">⭕ Circle</span>
                  <span className="wb-tool">🅰️ Text</span>
                  <span className="wb-tool">↩️ Undo</span>
                  <span className="wb-badge">Fabric.js 60 FPS Sync</span>
                </div>
                <div className="sim-whiteboard-canvas">
                  <div className="sim-remote-cursor cursor-two" style={{ top: '120px', left: '420px' }}>
                    <span className="cursor-flag">Neon Artist</span>
                  </div>
                  <div className="sim-wb-drawing-element box-1">
                    <span>Architecture Idea</span>
                  </div>
                  <div className="sim-wb-arrow">➔</div>
                  <div className="sim-wb-drawing-element box-2">
                    <span>WebSocket Sync</span>
                  </div>
                  <div className="sim-wb-arrow">➔</div>
                  <div className="sim-wb-drawing-element box-3">
                    <span>Zero Storage Leak</span>
                  </div>
                </div>
              </div>
            )}

            {/* VIEW 3: DOCUMENT */}
            {activeMockupTab === 'document' && (
              <div className="sim-view sim-view-document">
                <div className="sim-doc-toolbar">
                  <span><strong>B</strong></span>
                  <span><em>I</em></span>
                  <span><u>U</u></span>
                  <span className="divider">|</span>
                  <span>H1</span>
                  <span>H2</span>
                  <span>List</span>
                  <span>Table</span>
                  <span className="divider">|</span>
                  <span className="doc-snapshot-tag">🕒 Autosaved Snapshot</span>
                </div>
                <div className="sim-doc-page">
                  <div className="sim-remote-cursor cursor-three" style={{ top: '80px', left: '320px' }}>
                    <span className="cursor-flag">Silent Fox</span>
                  </div>
                  <h3>Sprint Objectives & Specifications</h3>
                  <p>
                    AnonHub enables multi-disciplinary teams to brainstorm, draft user stories,
                    and review code without disclosing personal credentials. All content is stored
                    ephemerally and expires after 15 days of inactivity.
                  </p>
                  <ul>
                    <li>✅ Complete real-time cursor broadcast for 50+ concurrent users.</li>
                    <li>✅ Sandboxed code execution with 5-second automatic timeout loop protection.</li>
                    <li>✅ MoQ WebTransport ultra low-latency audio/video streaming relay.</li>
                  </ul>
                </div>
              </div>
            )}

            {/* VIEW 4: SPREADSHEET */}
            {activeMockupTab === 'spreadsheet' && (
              <div className="sim-view sim-view-spreadsheet">
                <div className="sim-sheet-formula-bar">
                  <span className="fx-tag">fx</span>
                  <span className="formula-text">=SUM(B2:B5)</span>
                  <span className="calc-result">Result: $44,800</span>
                </div>
                <div className="sim-sheet-grid">
                  <div className="sheet-row header-row">
                    <span className="cell corner"></span>
                    <span className="cell col-head">A (Category)</span>
                    <span className="cell col-head">B (Budget)</span>
                    <span className="cell col-head">C (Status)</span>
                  </div>
                  <div className="sheet-row">
                    <span className="cell row-head">1</span>
                    <span className="cell">Infra Servers</span>
                    <span className="cell font-mono">$12,000</span>
                    <span className="cell green-pill">Approved</span>
                  </div>
                  <div className="sheet-row active-row">
                    <span className="cell row-head">2</span>
                    <span className="cell">Security Audit</span>
                    <span className="cell font-mono selected-cell">$18,500</span>
                    <span className="cell blue-pill">In Progress</span>
                  </div>
                  <div className="sheet-row">
                    <span className="cell row-head">3</span>
                    <span className="cell">AI API Quotas</span>
                    <span className="cell font-mono">$14,300</span>
                    <span className="cell green-pill">Approved</span>
                  </div>
                </div>
              </div>
            )}

            {/* VIEW 5: CHAT */}
            {activeMockupTab === 'chat' && (
              <div className="sim-view sim-view-chat">
                <div className="sim-chat-feed">
                  <div className="sim-msg msg-in">
                    <div className="msg-avatar av-purple">C</div>
                    <div className="msg-bubble">
                      <div className="msg-sender">Cosmic Nomad <span className="msg-time">10:42 AM</span></div>
                      <p>Hey everyone, I just pushed the new MoQ video streaming relay. Can you test screen sharing?</p>
                      <div className="msg-reaction">👍 3</div>
                    </div>
                  </div>
                  <div className="sim-msg msg-out">
                    <div className="msg-bubble own">
                      <div className="msg-sender">You (Silent Fox) <span className="msg-time">10:43 AM</span></div>
                      <p>Testing now! Latency looks under 15ms. Attaching the trace log here.</p>
                      <div className="msg-attachment-pill">📎 trace_bench.json (4.2 KB)</div>
                    </div>
                    <div className="msg-avatar av-blue">S</div>
                  </div>
                </div>
              </div>
            )}

            {/* VIEW 6: VIDEO CALL */}
            {activeMockupTab === 'call' && (
              <div className="sim-view sim-view-call">
                <div className="sim-call-mesh">
                  <div className="sim-video-tile tile-speaker">
                    <div className="tile-badge">⚡ MoQ WebTransport Live</div>
                    <div className="avatar-placeholder">Cosmic Nomad (Sharing Screen)</div>
                    <span className="mic-active">🎤 Active Speaker</span>
                  </div>
                  <div className="sim-video-tile tile-peer">
                    <div className="avatar-placeholder">Galaxy Coder</div>
                    <span className="mic-active">🎤 Speaking</span>
                  </div>
                  <div className="sim-video-tile tile-peer">
                    <div className="avatar-placeholder">Silent Fox (You)</div>
                    <span className="mic-muted">🔇 Muted</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────────────────────
          3. ROOM CREATION & JOINING GATEWAY FORMS
          ───────────────────────────────────────────────────────────────────────────── */}
      <section className="landing-section room-gateway-section" id="room-gateway-section">
        <div className="section-header-center">
          <div className="section-kicker">
            <Lock size={14} />
            <span>Instant Room Creation</span>
          </div>
          <h2 className="section-heading">Jump Into a Room in Seconds</h2>
          <p className="section-description">
            Choose between a dedicated Chat Room or an All-in-One Project Workspace. Set a password access key and share the link.
          </p>
        </div>

        {/* Gateway Selection Tabs */}
        <div className="gateway-segmented-tabs">
          <button
            className={`gateway-tab-btn ${gatewayTab === 'project' ? 'active' : ''}`}
            onClick={() => setGatewayTab('project')}
          >
            <FolderPlus size={16} />
            <span>Project Workspace (All Tools)</span>
          </button>
          <button
            className={`gateway-tab-btn ${gatewayTab === 'chat' ? 'active' : ''}`}
            onClick={() => setGatewayTab('chat')}
          >
            <MessageSquare size={16} />
            <span>Secure Chat Room</span>
          </button>
        </div>

        {/* Forms Row */}
        <div className="gateway-cards-container">
          {/* FORM 1: PROJECT WORKSPACE */}
          {gatewayTab === 'project' && (
            <div className="gateway-action-card card-project" id="home-project-card">
              <div className="card-top-icon">
                <FolderPlus size={26} color="white" />
              </div>
              <h3>Start or Open a Project Workspace</h3>
              <p className="card-subtitle">
                Whiteboard sketchpad, Monaco code runner, rich document editor, Smart Notes, Polls, and attachment uploads.
              </p>

              {projectError && (
                <div className="form-error-alert" role="alert">
                  ⚠️ {projectError}
                </div>
              )}

              <form onSubmit={handleCreateProject} className="gateway-form">
                <div className="form-group-field">
                  <label>Project Workspace Name</label>
                  <input
                    type="text"
                    className="form-input-translucent"
                    placeholder="e.g. quantum-hackathon"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </div>

                <div className="form-group-field">
                  <label>Room Access Key (Password)</label>
                  <input
                    type="password"
                    className="form-input-translucent"
                    placeholder="Enter password for this room"
                    value={projectKey}
                    onChange={(e) => setProjectKey(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </div>

                {/* Optional Owner Key Toggle */}
                <div className="accordion-owner-key">
                  <button
                    type="button"
                    className="owner-key-toggle-btn"
                    onClick={() => setShowProjectOwnerKey(!showProjectOwnerKey)}
                  >
                    <span>{showProjectOwnerKey ? '▾ Hide Creator Secret Key' : '▸ Set Creator Secret Key (Optional)'}</span>
                  </button>
                  {showProjectOwnerKey && (
                    <div className="owner-key-input-wrapper">
                      <input
                        type="password"
                        className="form-input-translucent"
                        placeholder="Secret key to manage permissions across devices"
                        value={projectOwnerKey}
                        onChange={(e) => setProjectOwnerKey(e.target.value)}
                        autoComplete="off"
                      />
                      <small className="owner-key-hint">
                        Allows you to reclaim owner privileges if you switch browsers or devices.
                      </small>
                    </div>
                  )}
                </div>

                <button type="submit" className="btn-gateway-submit btn-project-gradient" disabled={projectLoading}>
                  {projectLoading ? 'Entering Workspace...' : (
                    <>
                      <span>Launch Project Workspace</span>
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>

                {projectName.trim() && projectKey.trim() && (
                  <button
                    type="button"
                    className={`btn-copy-invite ${projCopied ? 'copied' : ''}`}
                    onClick={handleCopyProjectInvite}
                  >
                    {projCopied ? (
                      <><Check size={14} /> Invite Link Copied!</>
                    ) : (
                      <><Copy size={14} /> Copy Direct Invite Link</>
                    )}
                  </button>
                )}
              </form>
            </div>
          )}

          {/* FORM 2: CHAT ROOM */}
          {gatewayTab === 'chat' && (
            <div className="gateway-action-card card-chat" id="home-chat-card">
              <div className="card-top-icon">
                <MessageSquare size={26} color="white" />
              </div>
              <h3>Join or Create a Chat Room</h3>
              <p className="card-subtitle">
                Encrypted real-time group messaging with recorded voice notes, inline image previews, and emoji reactions.
              </p>

              {chatError && (
                <div className="form-error-alert" role="alert">
                  ⚠️ {chatError}
                </div>
              )}

              <form onSubmit={handleJoinChat} className="gateway-form">
                <div className="form-group-field">
                  <label>Chat Room Name</label>
                  <input
                    type="text"
                    className="form-input-translucent"
                    placeholder="e.g. dev-standup-chat"
                    value={chatRoom}
                    onChange={(e) => setChatRoom(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </div>

                <div className="form-group-field">
                  <label>Room Access Key (Password)</label>
                  <input
                    type="password"
                    className="form-input-translucent"
                    placeholder="Enter room password"
                    value={chatKey}
                    onChange={(e) => setChatKey(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </div>

                {/* Optional Owner Key */}
                <div className="accordion-owner-key">
                  <button
                    type="button"
                    className="owner-key-toggle-btn"
                    onClick={() => setShowChatOwnerKey(!showChatOwnerKey)}
                  >
                    <span>{showChatOwnerKey ? '▾ Hide Creator Secret Key' : '▸ Set Creator Secret Key (Optional)'}</span>
                  </button>
                  {showChatOwnerKey && (
                    <div className="owner-key-input-wrapper">
                      <input
                        type="password"
                        className="form-input-translucent"
                        placeholder="Secret key to manage room permissions"
                        value={chatOwnerKey}
                        onChange={(e) => setChatOwnerKey(e.target.value)}
                        autoComplete="off"
                      />
                      <small className="owner-key-hint">
                        Claim owner permissions from any browser with this key.
                      </small>
                    </div>
                  )}
                </div>

                <button type="submit" className="btn-gateway-submit btn-chat-gradient" disabled={chatLoading}>
                  {chatLoading ? 'Joining Chat...' : (
                    <>
                      <span>Enter Chat Room</span>
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>

                {chatRoom.trim() && chatKey.trim() && (
                  <button
                    type="button"
                    className={`btn-copy-invite ${chatCopied ? 'copied' : ''}`}
                    onClick={handleCopyChatInvite}
                  >
                    {chatCopied ? (
                      <><Check size={14} /> Invite Link Copied!</>
                    ) : (
                      <><Copy size={14} /> Copy Direct Invite Link</>
                    )}
                  </button>
                )}
              </form>
            </div>
          )}
        </div>

        {/* Quick Links to Office & Calls */}
        <div className="gateway-sub-links">
          <span>Looking for specific tools?</span>
          <Link to="/office/demo" className="sub-link-pill">
            <Table size={13} /> Office Suite (Spreadsheet & Word)
          </Link>
          <Link to="/call/demo" className="sub-link-pill">
            <Video size={13} /> Video Call Room (MoQ)
          </Link>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────────────────────
          4. BUILT FOR MODERN COLLABORATION (AUDIENCE SECTION)
          ───────────────────────────────────────────────────────────────────────────── */}
      <section className="landing-section audience-section">
        <div className="section-header-center">
          <div className="section-kicker">
            <Users size={14} />
            <span>Built For Everyone</span>
          </div>
          <h2 className="section-heading">Designed for High-Velocity Teams</h2>
          <p className="section-description">
            Whether you are building a hackathon MVP or holding a private brainstorming session, AnonHub removes all onboarding friction.
          </p>
        </div>

        <div className="audience-grid">
          <div className="audience-card">
            <div className="audience-icon-wrap icon-dev">
              <Code2 size={22} />
            </div>
            <h4>Developers & Hackathons</h4>
            <p>Write multi-language code in Monaco, run scripts in our secure sandbox, review inline diffs, and store snippets.</p>
          </div>

          <div className="audience-card">
            <div className="audience-icon-wrap icon-team">
              <Zap size={22} />
            </div>
            <h4>Remote Teams</h4>
            <p>Collaborative Excel spreadsheets with formulas, Word documents, Kanban boards, and video conferencing in one space.</p>
          </div>

          <div className="audience-card">
            <div className="audience-icon-wrap icon-student">
              <FileText size={22} />
            </div>
            <h4>Students & Researchers</h4>
            <p>Co-write reports, capture notes with AI summaries, organize equations, and vote on team decisions with live polls.</p>
          </div>

          <div className="audience-card">
            <div className="audience-icon-wrap icon-design">
              <Palette size={22} />
            </div>
            <h4>Designers & Ideators</h4>
            <p>Brainstorm with a full Fabric.js vector whiteboard, laser pointers, shape toolbars, and high-res vector PDF/PNG exports.</p>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────────────────────
          5. COMPREHENSIVE FEATURES SHOWCASE (7 CORE MODULES)
          ───────────────────────────────────────────────────────────────────────────── */}
      <section className="landing-section features-showcase-section" id="features-section">
        <div className="section-header-center">
          <div className="section-kicker">
            <Layers size={14} />
            <span>Core Ecosystem</span>
          </div>
          <h2 className="section-heading">7 Powerful Real-Time Tools in One App</h2>
          <p className="section-description">
            No juggling five separate subscriptions. Every tool synchronizes instantly through our low-latency WebSocket & WebTransport mesh.
          </p>
        </div>

        <div className="features-bento-grid">
          {/* Card 1: Monaco Code Editor */}
          <div className="feature-bento-card card-large">
            <div className="card-tag">Developer Core</div>
            <div className="feature-card-header">
              <Code2 size={24} className="feature-icon icon-purple" />
              <h3>Sandboxed Coding Board & Live Web Preview</h3>
            </div>
            <p>
              VS Code-style Monaco editor supporting JavaScript, Python, TypeScript, HTML/CSS, C++, and Java.
              Execute code directly in an isolated server runner with 5s timeout protection, or toggle instant live browser rendering.
            </p>
            <div className="bento-mini-preview code-preview">
              <div className="mini-code-line"><span className="hl-k">const</span> session = <span className="hl-f">connectMesh</span>();</div>
              <div className="mini-code-line indent"><span className="hl-k">await</span> session.<span className="hl-f">compileSandbox</span>();</div>
              <div className="mini-status-badge">⚡ 5s Timeout Sandbox Protected</div>
            </div>
          </div>

          {/* Card 2: Sketch Whiteboard */}
          <div className="feature-bento-card">
            <div className="card-tag">Visual Ideation</div>
            <div className="feature-card-header">
              <Palette size={24} className="feature-icon icon-pink" />
              <h3>Fabric.js Whiteboard</h3>
            </div>
            <p>
              Freehand drawing, laser pointers, shapes, annotations, and vector export (PNG/PDF). Syncs smoothly at 60 FPS.
            </p>
            <div className="bento-mini-preview wb-preview">
              <div className="wb-bubble">Flowchart</div>
              <span className="wb-line">➔</span>
              <div className="wb-bubble">Prototype</div>
            </div>
          </div>

          {/* Card 3: Office Productivity Suite */}
          <div className="feature-bento-card">
            <div className="card-tag">Office Suite</div>
            <div className="feature-card-header">
              <Table size={24} className="feature-icon icon-blue" />
              <h3>Spreadsheet (Excel) & Word Docs</h3>
            </div>
            <p>
              Reactive grid with formulas (<code>=SUM</code>, <code>=AVERAGE</code>), CSV import/export, and rich word processing.
            </p>
            <div className="bento-mini-preview sheet-preview">
              <div className="mini-grid-row"><span>=SUM(A1:A4)</span><span className="val-tag">100% Sync</span></div>
            </div>
          </div>

          {/* Card 4: Media over QUIC Video Calls */}
          <div className="feature-bento-card">
            <div className="card-tag">Ultra Low Latency</div>
            <div className="feature-card-header">
              <Video size={24} className="feature-icon icon-gold" />
              <h3>MoQ WebTransport Video & Audio</h3>
            </div>
            <p>
              Next-generation video streaming with WebCodecs hardware acceleration, screen share, and resilient Socket.IO fallback.
            </p>
          </div>

          {/* Card 5: Smart Notes with AI */}
          <div className="feature-bento-card">
            <div className="card-tag">AI Powered</div>
            <div className="feature-card-header">
              <Sparkles size={24} className="feature-icon icon-purple" />
              <h3>Smart Notes with AI Organize</h3>
            </div>
            <p>
              Capture raw meeting notes. 1-click AI Organize converts messy text dumps into clear summaries and checklists.
            </p>
          </div>

          {/* Card 6: Live Team Polls & Snippets */}
          <div className="feature-bento-card">
            <div className="card-tag">Team Utility</div>
            <div className="feature-card-header">
              <BarChart3 size={24} className="feature-icon icon-pink" />
              <h3>Live Polls & Snippets Library</h3>
            </div>
            <p>
              Create anonymous team voting with countdown timers, and save reusable boilerplate code snippets.
            </p>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────────────────────
          6. AI COPILOT INTERACTIVE PLAYGROUND
          ───────────────────────────────────────────────────────────────────────────── */}
      <section className="landing-section ai-copilot-section" id="ai-copilot-section">
        <div className="section-header-center">
          <div className="section-kicker">
            <Bot size={14} />
            <span>Integrated AI</span>
          </div>
          <h2 className="section-heading">Context-Aware AI Assistant Powered by Gemini</h2>
          <p className="section-description">
            Get instant programming explanations, format messy brainstorms, draft copy, or generate templates without leaving your room.
          </p>
        </div>

        <div className="ai-showcase-container">
          {/* Prompt Selector Pills */}
          <div className="ai-prompts-bar">
            <button
              className={`ai-prompt-btn ${activeAiPrompt === 'code' ? 'active' : ''}`}
              onClick={() => setActiveAiPrompt('code')}
            >
              <span>💻 "Explain & optimize this algorithm"</span>
            </button>
            <button
              className={`ai-prompt-btn ${activeAiPrompt === 'notes' ? 'active' : ''}`}
              onClick={() => setActiveAiPrompt('notes')}
            >
              <span>📝 "Organize raw notes into action items"</span>
            </button>
            <button
              className={`ai-prompt-btn ${activeAiPrompt === 'spreadsheet' ? 'active' : ''}`}
              onClick={() => setActiveAiPrompt('spreadsheet')}
            >
              <span>📊 "Write spreadsheet formula for quarterly revenue"</span>
            </button>
          </div>

          {/* AI Output Card */}
          <div className="ai-response-card">
            <div className="ai-card-header">
              <div className="ai-model-badge">
                <Sparkles size={14} className="icon-sparkle" />
                <span>Gemini Pro • Live Workspace Context</span>
              </div>
              <span className="ai-latency-tag">Generated in 240ms</span>
            </div>

            <div className="ai-card-body">
              {activeAiPrompt === 'code' && (
                <div className="ai-response-content">
                  <p className="ai-intro">Here is an optimized asynchronous implementation using WebWorkers to prevent main thread blocking:</p>
                  <pre className="ai-code-block">
                    <code>{`// Time Complexity: O(N log N) -> Optimized
function processDataMesh(buffer) {
  return new Promise((resolve) => {
    const worker = new Worker('sync-worker.js');
    worker.postMessage({ buffer });
    worker.onmessage = (e) => resolve(e.data.result);
  });
}`}</code>
                  </pre>
                </div>
              )}

              {activeAiPrompt === 'notes' && (
                <div className="ai-response-content">
                  <h4>📌 Executive Summary</h4>
                  <p>The team aligned on shipping the Media over QUIC audio/video update before sprint completion.</p>
                  <h4>📋 Action Checklist</h4>
                  <ul className="ai-checklist">
                    <li><Check size={13} className="check-green" /> Complete WebCodecs frame rate test on mobile Safari.</li>
                    <li><Check size={13} className="check-green" /> Verify 15-day room inactivity auto-cleaner.</li>
                    <li><Check size={13} className="check-green" /> Release updated User Guide documentation.</li>
                  </ul>
                </div>
              )}

              {activeAiPrompt === 'spreadsheet' && (
                <div className="ai-response-content">
                  <p>Use the following formula in cell <strong>E2</strong> to calculate compound growth across columns B through D:</p>
                  <div className="ai-formula-pill">
                    <code>=SUM(B2:D2) * 1.15 - AVERAGE(B2:D2)</code>
                  </div>
                  <p className="ai-hint">This aggregates your total quarterly revenue while applying the 15% projected expansion rate.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────────────────────
          7. HOW IT WORKS (3-STEP TIMELINE)
          ───────────────────────────────────────────────────────────────────────────── */}
      <section className="landing-section how-it-works-section">
        <div className="section-header-center">
          <div className="section-kicker">
            <Zap size={14} />
            <span>Simple Workflow</span>
          </div>
          <h2 className="section-heading">How AnonHub Works</h2>
          <p className="section-description">
            Zero setup, zero account verification, zero friction. Start collaborating in 3 effortless steps.
          </p>
        </div>

        <div className="timeline-steps-grid">
          <div className="timeline-step-card">
            <div className="step-number-badge">01</div>
            <h4>Create a Room</h4>
            <p>Pick a unique room name and password access key. Optionally set a creator secret key to claim ownership from other devices.</p>
          </div>

          <div className="step-connector-arrow">➔</div>

          <div className="timeline-step-card">
            <div className="step-number-badge">02</div>
            <h4>Invite Your Team</h4>
            <p>Copy the pre-filled direct invite link or generate a QR code. Share it privately with your peers over any messenger.</p>
          </div>

          <div className="step-connector-arrow">➔</div>

          <div className="timeline-step-card">
            <div className="step-number-badge">03</div>
            <h4>Collaborate Freely</h4>
            <p>Write docs, sketch, code, run scripts, and jump into video calls with instant peer synchronization and total privacy.</p>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────────────────────
          8. ROOM LIFECYCLE & SECURITY GUARANTEES
          ───────────────────────────────────────────────────────────────────────────── */}
      <section className="landing-section security-lifecycle-section">
        <div className="section-header-center">
          <div className="section-kicker">
            <Shield size={14} />
            <span>Privacy First</span>
          </div>
          <h2 className="section-heading">Built for Privacy & Ephemeral Data</h2>
          <p className="section-description">
            Your data exists only as long as you need it. We enforce transparent lifecycles and strict execution safeguards.
          </p>
        </div>

        <div className="security-cards-row">
          <div className="security-feature-card">
            <div className="sec-icon-wrap"><Lock size={20} /></div>
            <h4>Bcrypt Password Protection</h4>
            <p>Room access keys are hashed with bcrypt. Only peers with your password key can enter.</p>
          </div>

          <div className="security-feature-card">
            <div className="sec-icon-wrap"><Cpu size={20} /></div>
            <h4>5s Sandboxed Code Runner</h4>
            <p>User code executes in isolated sub-processes with output limits (512 KB) and time limits (5s) to stop infinite loops.</p>
          </div>

          <div className="security-feature-card">
            <div className="sec-icon-wrap"><Clock size={20} /></div>
            <h4>15-Day Inactivity Auto-Purge</h4>
            <p>Rooms without activity for 15 days automatically deactivate and are permanently deleted. Zero data hoarding.</p>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────────────────────
          9. TECHNOLOGY STACK SHOWCASE
          ───────────────────────────────────────────────────────────────────────────── */}
      <section className="landing-section tech-stack-section">
        <div className="section-header-center">
          <div className="section-kicker">
            <Cpu size={14} />
            <span>Engineering Core</span>
          </div>
          <h2 className="section-heading">Powered by Modern Web Technologies</h2>
        </div>

        <div className="tech-badges-wrap">
          <span className="tech-badge">⚛️ React 19</span>
          <span className="tech-badge">🟢 Node.js & Express</span>
          <span className="tech-badge">⚡ Socket.IO</span>
          <span className="tech-badge">💻 Monaco Editor</span>
          <span className="tech-badge">🎨 Fabric.js</span>
          <span className="tech-badge">📝 TinyMCE</span>
          <span className="tech-badge">🌐 Media over QUIC (MoQ)</span>
          <span className="tech-badge">🍃 MongoDB</span>
          <span className="tech-badge">🤖 Google Gemini AI</span>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────────────────────
          10. FINAL CALL TO ACTION (CTA)
          ───────────────────────────────────────────────────────────────────────────── */}
      <section className="landing-section final-cta-section">
        <div className="final-cta-card">
          <div className="cta-glow-orb" />
          <h2 className="cta-heading">Ready to Collaborate Without Boundaries?</h2>
          <p className="cta-subheading">
            Launch an instant workspace in 5 seconds. No credit card, no sign-up, 100% anonymous.
          </p>
          <div className="cta-actions">
            <button
              onClick={() => scrollToGateway('project')}
              className="btn-hero-primary cta-btn-large"
            >
              <span>Create Your Room Now</span>
              <ArrowRight size={18} />
            </button>
            <Link to="/guide" className="btn-hero-secondary">
              <HelpCircle size={16} />
              <span>Read User Guide</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────────────────────
          11. MODERN FOOTER
          ───────────────────────────────────────────────────────────────────────────── */}
      <footer className="landing-footer">
        <div className="footer-top-row">
          <div className="footer-brand-col">
            <div className="footer-logo">
              <Shield size={20} className="footer-shield-icon" />
              <h3>AnonHub</h3>
              <span className="footer-badge">Beta</span>
            </div>
            <p className="footer-tagline">
              Real-Time Anonymous Collaboration Platform. Create, code, write, and ideate together with complete privacy.
            </p>
          </div>

          <div className="footer-nav-col">
            <h5>Product</h5>
            <Link to="/projects/demo">Project Workspace</Link>
            <Link to="/chat/demo">Chat Rooms</Link>
            <Link to="/office/demo">Office Suite</Link>
            <Link to="/call/demo">Video Calling (MoQ)</Link>
          </div>

          <div className="footer-nav-col">
            <h5>Resources</h5>
            <Link to="/guide">User Guide & Docs</Link>
            <Link to="/about">About Platform</Link>
            <a href="https://github.com" target="_blank" rel="noreferrer">
              GitHub Repository <ExternalLink size={11} />
            </a>
          </div>

          <div className="footer-nav-col">
            <h5>Security & Legal</h5>
            <Link to="/guide#privacy-security">Privacy & Limits</Link>
            <Link to="/guide#room-expiration">15-Day Policy</Link>
            <Link to="/about#security">Security Architecture</Link>
          </div>
        </div>

        <div className="footer-bottom-row">
          <p>© 2026 AnonHub • Built for Privacy & Instant Collaboration</p>
          <div className="footer-status-pill">
            <span className="pulse-green" /> All Systems Operational
          </div>
        </div>
      </footer>

      {/* ─────────────────────────────────────────────────────────────────────────────
          12. INTERACTIVE TOUR TOOLTIP
          ───────────────────────────────────────────────────────────────────────────── */}
      {tourStep >= 0 && (
        <div className={`tour-tooltip-card home-step-${tourStep}`}>
          <div className="tour-tooltip-arrow" />
          <div className="tour-tooltip-header">
            <h4>Tour Guide</h4>
            <span className="tour-tooltip-badge">Step {tourStep + 1} of 5</span>
          </div>
          <div className="tour-tooltip-body">
            {tourStep === 0 && (
              <p>Welcome to <strong>AnonHub</strong>! The all-in-one anonymous real-time collaboration platform: Project Workspaces, Office Suite, Chat Rooms, Video Calls, and AI Copilot — 100% private with no sign-up required.</p>
            )}
            {tourStep === 1 && (
              <p>Use the <strong>Chat Room</strong> gateway to create messaging rooms with inline media previews, emoji reactions, recorded voice notes, and instant room sharing.</p>
            )}
            {tourStep === 2 && (
              <p>Use the <strong>Project Room</strong> gateway to create workspaces with Fabric.js sketchpads, Monaco coding sandboxes, rich documents, Smart Notes, Live Polls, Code Snippets, and file uploads.</p>
            )}
            {tourStep === 3 && (
              <p>Need guidance or code generation? Click the floating <strong>AI Copilot</strong> chatbot button in the bottom right corner for instant answers and layout advice.</p>
            )}
            {tourStep === 4 && (
              <p>Explore the top Navbar to switch between <strong>6 Color Themes</strong>, install the app as a desktop/mobile <strong>PWA</strong>, access the <strong>Office Suite</strong> (Excel, Word, Kanban), or read the complete <strong>User Guide</strong>!</p>
            )}
          </div>
          <div className="tour-tooltip-footer">
            <button
              className="tour-skip-btn"
              onClick={() => {
                setTourStep(-1);
                localStorage.setItem('trinetra_home_tour_seen', 'true');
              }}
            >
              Skip
            </button>
            <button
              className="tour-next-btn"
              onClick={() => {
                if (tourStep < 4) {
                  setTourStep(prev => prev + 1);
                } else {
                  setTourStep(-1);
                  localStorage.setItem('trinetra_home_tour_seen', 'true');
                }
              }}
            >
              {tourStep === 4 ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

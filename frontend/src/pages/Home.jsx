/**
 * @file Home.jsx
 * @description Landing Page gateway of the AnonHub collaboration platform.
 * Provides descriptions of the application benefits (real-time channels, anonymous profiles, secure keys)
 * alongside user forms to instantiate or join dedicated Chat rooms and Project workspaces.
 * Persists session keys (sessionStorage) and creator authorization tokens (localStorage) on successful redirects.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Check
} from 'lucide-react';
import './Home.css';
import { setCookie } from '../services/socket';
import PWAInstallPrompt from '../components/PWAInstallPrompt';

/**
 * Home Component
 * Houses forms to dynamically route user connection handshakes.
 */
export default function Home() {
  const navigate = useNavigate();

  // Chat Form State bindings
  const [chatRoom, setChatRoom] = useState('');
  const [chatKey, setChatKey] = useState('');
  const [chatError, setChatError] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  // Project Form State bindings
  const [projectName, setProjectName] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [projectError, setProjectError] = useState('');
  const [projectLoading, setProjectLoading] = useState(false);

  // Onboarding walkthrough states
  const [tourStep, setTourStep] = useState(-1);

  // Copy invite link state
  const [chatCopied, setChatCopied] = useState(false);
  const [projCopied, setProjCopied] = useState(false);

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

  // Check if first-time visitor and register global tour listener
  useEffect(() => {
    const handleStartTour = () => {
      setTourStep(0);
    };
    window.addEventListener('start-anonhub-tour', handleStartTour);

    const hasSeenTour = localStorage.getItem('anonhub_home_tour_seen');
    if (!hasSeenTour) {
      // Small timeout to allow page layout transition animations to finish
      const t = setTimeout(() => setTourStep(0), 1000);
      return () => {
        clearTimeout(t);
        window.removeEventListener('start-anonhub-tour', handleStartTour);
      };
    }

    return () => {
      window.removeEventListener('start-anonhub-tour', handleStartTour);
    };
  }, []);

  // Auto-scroll the landing page to keep the highlighted feature element in the viewport during the onboarding tour
  useEffect(() => {
    if (tourStep < 0) return;

    const scrollToElement = () => {
      if (tourStep === 0) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (tourStep === 1) {
        const el = document.getElementById('home-chat-card');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } else if (tourStep === 2) {
        const el = document.getElementById('home-project-card');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } else if (tourStep === 3) {
        const el = document.querySelector('.ai-chatbot-bubble');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        }
      } else if (tourStep === 4) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };

    const timer = setTimeout(scrollToElement, 100);
    return () => clearTimeout(timer);
  }, [tourStep]);

  /**
   * Submits a Chat Room join request.
   * Dispatches validation credentials to backend API `/join-chat`.
   * Caches room access key in sessionStorage for state validation across route transfers.
   * @param {React.FormEvent} e - Form submission event
   */
  const handleJoinChat = async (e) => {
    e.preventDefault();
    setChatError('');
    if (!chatRoom.trim() || !chatKey.trim()) {
      setChatError('Room name and access key are required.');
      return;
    }

    setChatLoading(true);
    try {
      const response = await fetch('/join-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: chatRoom.trim(), accessKey: chatKey.trim() })
      });

      const data = await response.json();
      if (response.ok && data.redirectUrl) {
        // Cache access key locally to maintain websocket handshake sessions
        sessionStorage.setItem(`accesskey_chat_${chatRoom.trim()}`, chatKey.trim());
        if (data.ownerToken) {
          // Save under BOTH keys for unified project+chat ownership
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

  /**
   * Submits a Project Room creation or join request.
   * Dispatches project identifier and access key to API `/create-project`.
   * If a new project is created, receives and caches `ownerToken` inside localStorage
   * to secure subsequent data modifications/deletions.
   * @param {React.FormEvent} e - Form submission event
   */
  const handleCreateProject = async (e) => {
    e.preventDefault();
    setProjectError('');
    if (!projectName.trim() || !projectKey.trim()) {
      setProjectError('Project name and access key are required.');
      return;
    }

    setProjectLoading(true);
    try {
      const response = await fetch('/create-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projectName.trim(), accessKey: projectKey.trim() })
      });

      const data = await response.json();
      if (response.ok && data.redirectUrl) {
        // Save security/access configuration in storage buffers
        sessionStorage.setItem(`accesskey_project_${projectName.trim()}`, projectKey.trim());
        setCookie(`accesskey_project_${projectName.trim()}`, projectKey.trim());
        if (data.ownerToken) {
          // Store project creator token under BOTH keys:
          // - owner_token_<name>       → used by Project Room
          // - owner_token_chat_<name>  → used by Chat Room (unified ownership)
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
    <div className="homepage-v2-container">
      <PWAInstallPrompt variant="banner" />
      {/* Hero & App Mockup Section */}
      <section className="homepage-v2-hero-grid">
        {/* Left Column: Headline and Overview Bullets */}
        <div className="homepage-v2-hero-left">
          <div className="hero-badge">
            <Shield size={14} style={{ color: 'var(--primary-color)' }} />
            <span>Collaborate anonymously. Create freely.</span>
          </div>
          
          <h1 className="hero-headline">
            Real-Time<br />
            Anonymous<br />
            <span className="gradient-text">Collaboration</span>
          </h1>

          <p className="hero-description">
            Create instant, secure, and password-protected rooms. Write documents, code scripts, sketch ideas, and share attachments — all without revealing your identity.
          </p>

          <div className="hero-bullet-cards">
            <div className="hero-bullet-card">
              <div className="bullet-icon-wrapper">
                <Lock size={16} />
              </div>
              <div className="bullet-content">
                <h5>100% Anonymous</h5>
                <p>No sign-ups. No tracking.</p>
              </div>
            </div>

            <div className="hero-bullet-card">
              <div className="bullet-icon-wrapper">
                <Zap size={16} />
              </div>
              <div className="bullet-content">
                <h5>Real-Time Sync</h5>
                <p>Instant updates for seamless teamwork.</p>
              </div>
            </div>

            <div className="hero-bullet-card">
              <div className="bullet-icon-wrapper">
                <Shield size={16} />
              </div>
              <div className="bullet-content">
                <h5>Secure & Private</h5>
                <p>Your data stays private and protected.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: High-fidelity Workspace Mockup */}
        <div className="homepage-v2-hero-right">
          <div className="mockup-container">
            {/* Floating Shield Emblem */}
            <div className="mockup-floating-shield">
              <div className="shield-icon-wrapper">
                <div className="shield-svg-bg">
                  <Shield size={36} color="white" fill="rgba(139, 92, 246, 0.4)" />
                </div>
                <div className="mask-logo-overlay">
                  <svg viewBox="0 0 100 100" className="mask-svg">
                    <path d="M10,42 Q30,25 50,42 Q70,25 90,42 Q95,65 50,78 Q5,65 10,42 Z" fill="white" />
                    <circle cx="34" cy="52" r="7" fill="var(--primary-color)" />
                    <circle cx="66" cy="52" r="7" fill="var(--primary-color)" />
                    <path d="M 40 52 L 60 52" stroke="white" strokeWidth="2" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Simulated App Window */}
            <div className="mockup-window">
              {/* Window TitleBar */}
              <div className="mockup-window-header">
                <div className="window-dots">
                  <span className="dot red"></span>
                  <span className="dot yellow"></span>
                  <span className="dot green"></span>
                </div>
                <div className="window-address-bar">
                  <span className="arrow-nav">←</span>
                  <span className="address-text">Project Brainstorm</span>
                </div>
                <div className="window-users-badge">
                  <div className="avatar-stack">
                    <span className="avatar-mini bg-burgundy">C</span>
                    <span className="avatar-mini bg-blue">S</span>
                    <span className="avatar-mini bg-purple">G</span>
                  </div>
                  <span className="users-count">4 online</span>
                </div>
                <div className="window-actions-menu">⋮</div>
              </div>

              {/* Window Layout Frame */}
              <div className="mockup-window-body">
                {/* Chat Panel */}
                <div className="mockup-chat-sidebar">
                  <div className="sidebar-title">
                    <span>Room Chat</span>
                    <span className="count-tag">4 online</span>
                  </div>
                  <div className="sidebar-messages">
                    <div className="sidebar-msg">
                      <strong className="user-cosmic">Cosmic Explorer</strong>
                      <p>Let's brainstorm some ideas!</p>
                      <span className="msg-time">10:24 AM</span>
                    </div>
                    <div className="sidebar-msg">
                      <strong className="user-silent">Silent Fox</strong>
                      <p>Great! I'll start a doc.</p>
                      <span className="msg-time">10:25 AM</span>
                    </div>
                    <div className="sidebar-msg">
                      <strong className="user-galaxy">Galaxy Coder</strong>
                      <p>Working on the script now.</p>
                      <span className="msg-time">10:26 AM</span>
                    </div>
                    <div className="sidebar-msg">
                      <strong className="user-neon">Neon Thinker</strong>
                      <p>Sharing the file here.</p>
                      <span className="msg-time">10:27 AM</span>
                    </div>
                  </div>
                  <div className="sidebar-input-area">
                    <input type="text" placeholder="Type a message..." disabled />
                    <Send size={10} className="send-icon-btn" />
                  </div>
                </div>

                {/* Editor Content Area */}
                <div className="mockup-editor-panel">
                  <div className="editor-toolbar">
                    <span className="tool-bold">B</span>
                    <span className="tool-italic">I</span>
                    <span className="tool-heading">H</span>
                    <span>≡</span>
                    <span>🔗</span>
                    <span>🖼️</span>
                    <span>&lt;/&gt;</span>
                  </div>
                  <div className="editor-canvas">
                    <h4>Project Ideas</h4>
                    <ul>
                      <li>Build a collaborative platform</li>
                      <li>Focus on real-time interaction</li>
                      <li>Keep it anonymous</li>
                      <li>Make it secure & simple</li>
                    </ul>

                    <h4>Code Snippet</h4>
                    <div className="mockup-code-block">
                      <div className="code-line">
                        <span className="code-keyword">function</span> <span className="code-function">collaborate</span>() &#123;
                      </div>
                      <div className="code-line indent">
                        <span className="code-keyword">let</span> ideas = shareIdeas();
                      </div>
                      <div className="code-line indent">
                        buildTogether(ideas);
                      </div>
                      <div className="code-line indent">
                        <span className="code-keyword">return</span> success;
                      </div>
                      <div className="code-line">
                        &#125;
                      </div>
                    </div>
                  </div>
                </div>

                {/* File Attachment list */}
                <div className="mockup-files-sidebar">
                  <div className="sidebar-title">
                    <span>Shared Files</span>
                  </div>
                  <div className="files-list">
                    <div className="file-item">
                      <span className="icon">📄</span>
                      <div className="info">
                        <strong>brainstorm.md</strong>
                        <span>2.4 KB</span>
                      </div>
                    </div>
                    <div className="file-item">
                      <span className="icon">📁</span>
                      <div className="info">
                        <strong>script.js</strong>
                        <span>6.7 KB</span>
                      </div>
                    </div>
                    <div className="file-item">
                      <span className="icon">🖼️</span>
                      <div className="info">
                        <strong>design.png</strong>
                        <span>1.3 MB</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Flying Paper Plane animation */}
            <div className="mockup-paper-plane">
              <svg viewBox="0 0 100 100" className="plane-trail">
                <path d="M5,95 Q45,95 85,5" fill="none" stroke="rgba(169, 63, 85, 0.3)" strokeWidth="1.5" strokeDasharray="3 3" />
              </svg>
              <div className="plane-wrapper">
                <svg viewBox="0 0 24 24" className="plane-svg">
                  <path d="M22 2L2 8.66L11.5 12.5L22 2Z" fill="var(--primary-color)" />
                  <path d="M22 2L11.5 12.5L14.5 22L22 2Z" fill="var(--primary-hover)" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Connection Gateways Forms */}
      <section className="homepage-v2-forms-row">
        {/* Form 1: Chat Room Gateway */}
        <div className="action-card chat-gradient" id="home-chat-card">
          <div className="card-header-icon">
            <MessageSquare size={24} color="white" />
          </div>
          <h3>Join a Chat Room</h3>
          <p className="subtitle">
            Enter a room name and access key to join an ongoing conversation instantly.
          </p>

          {chatError && (
            <div className="form-error-alert">
              ⚠️ {chatError}
            </div>
          )}

          <form onSubmit={handleJoinChat}>
            <div className="form-group">
              <input
                type="text"
                className="form-control-translucent"
                placeholder="Enter room name"
                value={chatRoom}
                onChange={(e) => setChatRoom(e.target.value)}
                required
                autoComplete="off"
              />
            </div>
            <div className="form-group">
              <input
                type="password"
                className="form-control-translucent"
                placeholder="Enter access key"
                value={chatKey}
                onChange={(e) => setChatKey(e.target.value)}
                required
                autoComplete="off"
              />
            </div>
            <button type="submit" className="btn-white" disabled={chatLoading}>
              {chatLoading ? 'Joining...' : (
                <>
                  <span>Join Chat Room</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
            {chatRoom.trim() && chatKey.trim() && (
              <button
                type="button"
                className={`btn-invite-link ${chatCopied ? 'copied' : ''}`}
                onClick={handleCopyChatInvite}
                title="Copy invite link with room name and key pre-filled"
              >
                {chatCopied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy Invite Link</>}
              </button>
            )}
          </form>
        </div>

        {/* Form 2: Start or Open a Project Workspace Gateway */}
        <div className="action-card project-gradient" id="home-project-card">
          <div className="card-header-icon">
            <FolderPlus size={24} color="white" />
          </div>
          <h3>Start or Open a Project</h3>
          <p className="subtitle">
            Create a new project or open an existing one to collaborate in real-time.
          </p>

          {projectError && (
            <div className="form-error-alert">
              ⚠️ {projectError}
            </div>
          )}

          <form onSubmit={handleCreateProject}>
            <div className="form-group">
              <input
                type="text"
                className="form-control-translucent"
                placeholder="Enter project name"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                required
                autoComplete="off"
              />
            </div>
            <div className="form-group">
              <input
                type="password"
                className="form-control-translucent"
                placeholder="Enter access key"
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value)}
                required
                autoComplete="off"
              />
            </div>
            <button type="submit" className="btn-white" disabled={projectLoading}>
              {projectLoading ? 'Creating...' : (
                <>
                  <span>Create & Go</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
            {projectName.trim() && projectKey.trim() && (
              <button
                type="button"
                className={`btn-invite-link ${projCopied ? 'copied' : ''}`}
                onClick={handleCopyProjectInvite}
                title="Copy invite link with project name and key pre-filled"
              >
                {projCopied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy Invite Link</>}
              </button>
            )}
          </form>
        </div>
      </section>

      {/* Bottom Feature Grid Details */}
      <section className="homepage-v2-features-grid">
        {/* Feature 1: Collaborate Instantly */}
        <div className="feature-card">
          <div className="feature-icon-title">
            <Users size={18} className="icon-blue" />
            <h4>Collaborate Instantly</h4>
          </div>
          <p>
            Invite others to your room or project and start working together in real time. No setup, no hassles — just instant collaboration.
          </p>
          <div className="illustration-wrapper">
            <div className="avatar-conversation-illustration">
              <div className="avatar-bubble av-one">U1</div>
              <div className="avatar-bubble av-two">U2</div>
              <div className="chat-link-badge">
                <Zap size={10} />
                <span>Connected</span>
              </div>
            </div>
          </div>
        </div>

        {/* Feature 2: Stay Anonymous */}
        <div className="feature-card">
          <div className="feature-icon-title">
            <EyeOff size={18} className="icon-pink" />
            <h4>Stay Anonymous</h4>
          </div>
          <p>
            Each user gets a random identity. No sign-ups, no tracking. Share links securely and keep your privacy intact.
          </p>
          <div className="illustration-wrapper">
            <div className="masquerade-mask-illustration">
              <div className="mask-shape-outer">
                <div className="mask-left-eye"></div>
                <div className="mask-right-eye"></div>
                <div className="mask-details-line"></div>
              </div>
            </div>
          </div>
        </div>

        {/* Feature 3: Create Without Limits */}
        <div className="feature-card">
          <div className="feature-icon-title">
            <Code2 size={18} className="icon-purple" />
            <h4>Create Without Limits</h4>
          </div>
          <p>
            Write, code, sketch, and share files in one place. Perfect for brainstorming, coding, planning, and more.
          </p>
          <div className="illustration-wrapper">
            <div className="editor-mockup-illustration">
              <div className="tab-row">
                <span className="tab-dot active"></span>
                <span className="tab-dot"></span>
              </div>
              <div className="mini-editor-lines">
                <div className="line l-1"></div>
                <div className="line l-2"></div>
                <div className="line l-3"></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Floating Bottom Status Bar */}
      <div className="floating-status-bar">
        <Lock size={12} style={{ marginRight: '6px' }} />
        <span>No Sign-Ups</span>
        <span className="dot-divider">•</span>
        <span>No Tracking</span>
        <span className="dot-divider">•</span>
        <span>Just Pure Collaboration</span>
      </div>

      {/* Interactive Tour Tooltip Card */}
      {tourStep >= 0 && (
        <div className={`tour-tooltip-card home-step-${tourStep}`}>
          <div className="tour-tooltip-arrow" />
          <div className="tour-tooltip-header">
            <h4>Tour Guide</h4>
            <span className="tour-tooltip-badge">Step {tourStep + 1} of 5</span>
          </div>
          <div className="tour-tooltip-body">
            {tourStep === 0 && (
              <p>Welcome to <strong>AnonHub</strong>! This platform provides secure, password-protected real-time collaboration with complete privacy. No signup required.</p>
            )}
            {tourStep === 1 && (
              <p>Use the <strong>Chat Room</strong> card to create messaging-only rooms. Simply enter a name, set an access key, and invite your team to talk anonymously.</p>
            )}
            {tourStep === 2 && (
              <p>Use the <strong>Project Room</strong> card to spawn an advanced workspace containing whiteboard sketch pads, document writers, code runners, and attachment uploads.</p>
            )}
            {tourStep === 3 && (
              <p>Need some quick help? Click the floating <strong>AI Copilot</strong> chatbot button in the bottom right corner to get coding suggestions, layouts assistance, or copy drafts.</p>
            )}
            {tourStep === 4 && (
              <p>That's it for the landing page! You can toggle between <strong>Light</strong> and <strong>Dark</strong> modes at the top right, or click the links to read more. Have fun collaborating!</p>
            )}
          </div>
          <div className="tour-tooltip-footer">
            <button 
              className="tour-skip-btn" 
              onClick={() => {
                setTourStep(-1);
                localStorage.setItem('anonhub_home_tour_seen', 'true');
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
                  localStorage.setItem('anonhub_home_tour_seen', 'true');
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

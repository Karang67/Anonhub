/**
 * @file Navbar.jsx
 * @description Application global navigation bar. Coordinates routing links, responsive
 * drawer navigation states, and the site-wide theme switching loop (Light/Dark mode)
 * utilizing standard DOM attributes and local state listeners.
 * Includes dropdown menus for grouped page categories.
 */

import React, { useState, useEffect, useRef } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { Menu, X, ChevronDown, MessageSquare, FolderKanban, FileText, Code2, Monitor, Video, Info, HelpCircle, Home, Book, Palette, Globe } from 'lucide-react';
import PWAInstallPrompt from './PWAInstallPrompt';
import OmniRoomSearchModal from './OmniRoomSearchModal';
import { useFeatureAccess } from '../context/FeatureAccessContext';
import './Navbar.css';

/** Dropdown definition: label, icon, feature key, and children links */
const NAV_ITEMS = [
  {
    label: 'Home',
    to: '/',
    icon: <Home size={14} />,
    exact: true,
  },
  {
    label: 'Collaborate',
    icon: <MessageSquare size={14} />,
    children: [
      { label: 'Global Chat',    to: '/global-chat', icon: <Globe size={14} />,         desc: 'Public chat with everyone online', feature: 'chat.global' },
      { label: 'Chat Room',      to: '/chat',        icon: <MessageSquare size={14} />, desc: 'Anonymous private group chat',     feature: 'chat' },
      { label: 'Project Room',   to: '/projects',    icon: <FolderKanban size={14} />,  desc: 'Real-time project board',          feature: 'project' },
      { label: 'Document Board', to: '/document',    icon: <FileText size={14} />,       desc: 'Collaborative documents',          feature: 'project.document_board' },
      { label: 'Coding Board',   to: '/code',        icon: <Code2 size={14} />,          desc: 'Live code editor',                 feature: 'project.code_editor' },
    ],
  },
  {
    label: 'Workspace',
    icon: <Monitor size={14} />,
    children: [
      { label: 'Whiteboard',   to: '/whiteboard', icon: <Palette size={14} />, desc: 'Real-time multiplayer canvas', feature: 'whiteboard' },
      { label: 'Office Board', to: '/office',     icon: <Monitor size={14} />, desc: 'Office suite & tools',         feature: 'officeboard' },
      { label: 'Video Call',   to: '/call',       icon: <Video size={14} />,   desc: 'Peer-to-peer video calls',     feature: 'call' },
    ],
  },
  {
    label: 'Info',
    icon: <Info size={14} />,
    children: [
      { label: 'About',            to: '/about',          icon: <Info size={14} />,        desc: 'About Trinetra' },
      { label: 'Help',             to: '/help',           icon: <HelpCircle size={14} />,  desc: 'FAQ & documentation' },
      { label: 'Guide',            to: '/guide',          icon: <Book size={14} />,         desc: 'Complete user guide' },
    ],
  },
];

/** A single dropdown menu item */
function DropdownMenu({ item, closeAll }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const location = useLocation();
  const { isFeatureVisible, can } = useFeatureAccess();

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Filter visible children based on feature flags & device visibility
  const visibleChildren = (item.children || []).filter(c => {
    if (c.feature) {
      return isFeatureVisible(c.feature) && can(c.feature, 'VIEW');
    }
    return true;
  });

  if (visibleChildren.length === 0) {
    return null;
  }

  // Is any child route active?
  const isChildActive = visibleChildren.some(c => location.pathname === c.to);

  return (
    <div className={`nav-dropdown ${open ? 'open' : ''}`} ref={ref}>
      <button
        className={`nav-dropdown-trigger ${isChildActive ? 'active' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span className="nav-item-icon">{item.icon}</span>
        {item.label}
        <ChevronDown size={12} className={`chevron-icon ${open ? 'rotated' : ''}`} />
      </button>

      {open && (
        <div className="nav-dropdown-panel">
          {visibleChildren.map(child => (
            <NavLink
              key={child.to}
              to={child.to}
              className={({ isActive }) => `nav-dropdown-item ${isActive ? 'active' : ''}`}
              onClick={() => { setOpen(false); closeAll(); }}
            >
              <span className="nav-dropdown-item-icon">{child.icon}</span>
              <div className="nav-dropdown-item-text">
                <div className="nav-dropdown-item-label">{child.label}</div>
                {child.desc && <div className="nav-dropdown-item-desc">{child.desc}</div>}
              </div>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Navbar() {
  // Theme state hook
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('trinetra-theme') || localStorage.getItem('anonhub-theme') || 'modern'; }
    catch (e) { return 'modern'; }
  });

  // Mobile drawer state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  useEffect(() => {
    const handleOpen = () => setIsSearchOpen(true);
    window.addEventListener('openOmniSearch', handleOpen);
    return () => window.removeEventListener('openOmniSearch', handleOpen);
  }, []);

  // Navbar visibility state (scroll direction & mouse detection)
  const [navVisible, setNavVisible] = useState(true);
  const lastScrollYRef = useRef(0);
  const location = useLocation();

  // Scroll direction and mouse movement detection
  useEffect(() => {
    let scrollTimeout = null;

    const handleScroll = () => {
      const currentScrollY = window.scrollY || document.documentElement.scrollTop || 0;
      const diff = currentScrollY - lastScrollYRef.current;

      // In workspace/rooms (which might have internal scroll), also support body scroll
      if (currentScrollY > 50 && diff > 8) {
        // Scrolling down -> hide navbar
        setNavVisible(false);
      } else if (diff < -8 || currentScrollY <= 20) {
        // Scrolling up or at top -> show navbar
        setNavVisible(true);
      }

      lastScrollYRef.current = currentScrollY;
    };

    const handleMouseMove = (e) => {
      // If mouse is near the top 45px of the screen, automatically bring back navbar
      if (e.clientY <= 45) {
        setNavVisible(true);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('mousemove', handleMouseMove);
      if (scrollTimeout) clearTimeout(scrollTimeout);
    };
  }, []);

  // Show navbar when changing routes
  useEffect(() => {
    setNavVisible(true);
  }, [location.pathname]);

  // Sync theme with DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('trinetra-theme', theme); } catch (e) {}
    window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
  }, [theme]);

  function closeAll() { setMobileMenuOpen(false); }

  return (
    <>
      {/* Floating reveal handle when navbar is hidden */}
      {!navVisible && (
        <button
          className="nav-floating-reveal-handle"
          onClick={() => setNavVisible(true)}
          title="Show Navigation Bar"
          aria-label="Show Navigation Bar"
        >
          <ChevronDown size={14} />
          <span className="reveal-tag">Show Nav</span>
        </button>
      )}

      <header className={`header ${navVisible ? 'nav-visible' : 'nav-hidden'}`}>
        {/* Brand */}
        <div className="logo-container">
          <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 className="logo-text">Trinetra</h1>
            <span className="logo-badge">2.O</span>
          </Link>
        </div>

        {/* Desktop & Mobile nav */}
        <nav className={`header-links ${mobileMenuOpen ? 'show' : ''}`} aria-label="Main navigation">
          {NAV_ITEMS.map(item =>
            item.children ? (
              <DropdownMenu key={item.label} item={item} closeAll={closeAll} />
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.exact}
                className={({ isActive }) => `nav-plain-link ${isActive ? 'active' : ''}`}
                onClick={closeAll}
              >
                <span className="nav-item-icon">{item.icon}</span>
                {item.label}
              </NavLink>
            )
          )}

          {/* Mobile Drawer Footer Actions (Theme + Tour) */}
          <div className="mobile-drawer-footer">
            <div className="mobile-theme-control">
              <span className="mobile-action-label">Theme</span>
              <select
                value={theme}
                onChange={(e) => {
                  setTheme(e.target.value);
                  closeAll();
                }}
                className="mobile-theme-select"
              >
                <option value="modern">☀️ Light</option>
                <option value="dark">🌙 Dark</option>
                <option value="dracula">🧛 Dracula</option>
                <option value="cyberpunk">⚡ Cyberpunk</option>
                <option value="ocean">🌊 Ocean</option>
                <option value="midnight">🌌 Midnight</option>
              </select>
            </div>

            <button
              onClick={() => {
                closeAll();
                window.dispatchEvent(new CustomEvent('start-trinetra-tour'));
                window.dispatchEvent(new CustomEvent('start-anonhub-tour'));
              }}
              className="mobile-tour-action-btn"
            >
              <span>💡 Start Interactive Tour</span>
            </button>
          </div>
        </nav>

        {/* Actions */}
        <div className="header-actions">

          <PWAInstallPrompt variant="navbar" />

          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('start-trinetra-tour'));
              window.dispatchEvent(new CustomEvent('start-anonhub-tour'));
            }}
            className="theme-toggle-btn tour-btn"
            title="Start Page Tour"
          >
            <span>💡</span><span className="btn-text"> Quick Tour</span>
          </button>

          <div className="theme-select-container">
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className="theme-select-dropdown"
              title="Choose Accent Theme"
            >
              <option value="modern">☀️ Light</option>
              <option value="dark">🌙 Dark</option>
              <option value="dracula">🧛 Dracula</option>
              <option value="cyberpunk">⚡ Cyberpunk</option>
              <option value="ocean">🌊 Ocean</option>
              <option value="midnight">🌌 Midnight</option>
            </select>
          </div>

          {/* Hide Navigation Toggle Button */}
          <button
            className="nav-hide-toggle-btn"
            onClick={() => setNavVisible(false)}
            title="Hide Navigation Bar"
            aria-label="Hide Navigation Bar"
          >
            <ChevronDown size={14} style={{ transform: 'rotate(180deg)' }} />
          </button>

          <button
            className="menu-toggle-btn"
            onClick={() => setMobileMenuOpen(p => !p)}
            aria-label="Toggle Navigation"
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>

      {/* Universal Fast Room Jump Modal */}
      <OmniRoomSearchModal 
        isOpen={isSearchOpen} 
        onClose={() => setIsSearchOpen(false)} 
      />
    </>
  );
}

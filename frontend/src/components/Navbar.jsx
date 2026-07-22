/**
 * @file Navbar.jsx
 * @description Application global navigation bar. Coordinates routing links, responsive
 * drawer navigation states, and the site-wide theme switching loop (Light/Dark mode)
 * utilizing standard DOM attributes and local state listeners.
 * Includes dropdown menus for grouped page categories.
 */

import React, { useState, useEffect, useRef } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { Menu, X, ChevronDown, MessageSquare, FolderKanban, FileText, Code2, Monitor, Video, Info, HelpCircle, Home } from 'lucide-react';
import PWAInstallPrompt from './PWAInstallPrompt';
import './Navbar.css';

/** Dropdown definition: label, icon, and children links */
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
      { label: 'Chat Room',      to: '/chat',     icon: <MessageSquare size={14} />,  desc: 'Anonymous group chat' },
      { label: 'Project Room',   to: '/projects', icon: <FolderKanban size={14} />,   desc: 'Real-time project board' },
      { label: 'Document Board', to: '/document', icon: <FileText size={14} />,        desc: 'Collaborative documents' },
      { label: 'Coding Board',   to: '/code',     icon: <Code2 size={14} />,           desc: 'Live code editor' },
    ],
  },
  {
    label: 'Workspace',
    icon: <Monitor size={14} />,
    children: [
      { label: 'Office Board', to: '/office', icon: <Monitor size={14} />, desc: 'Whiteboard & office tools' },
      { label: 'Video Call',   to: '/call',   icon: <Video size={14} />,   desc: 'Peer-to-peer video calls' },
    ],
  },
  {
    label: 'Info',
    icon: <Info size={14} />,
    children: [
      { label: 'About', to: '/about', icon: <Info size={14} />,        desc: 'About AnonHub' },
      { label: 'Help',  to: '/help',  icon: <HelpCircle size={14} />,  desc: 'FAQ & documentation' },
    ],
  },
];

/** A single dropdown menu item */
function DropdownMenu({ item, closeAll }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const location = useLocation();

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const lastLocationRef = useRef(location.pathname);
  if (lastLocationRef.current !== location.pathname) {
    lastLocationRef.current = location.pathname;
    setOpen(false);
  }

  // Determine if any child is active
  const isAnyChildActive = item.children?.some(c => location.pathname === c.to || location.pathname.startsWith(c.to + '/'));

  return (
    <div className={`nav-dropdown ${open ? 'open' : ''}`} ref={ref}>
      <button
        className={`nav-dropdown-trigger ${isAnyChildActive ? 'active' : ''}`}
        onClick={() => setOpen(p => !p)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className="nav-item-icon">{item.icon}</span>
        {item.label}
        <ChevronDown size={13} className="chevron-icon" />
      </button>

      {open && (
        <div className="nav-dropdown-panel" role="menu">
          {item.children.map(child => (
            <NavLink
              key={child.to}
              to={child.to}
              className={({ isActive }) => `nav-dropdown-item ${isActive ? 'active' : ''}`}
              onClick={() => { setOpen(false); closeAll(); }}
              role="menuitem"
            >
              <span className="nav-dropdown-item-icon">{child.icon}</span>
              <span className="nav-dropdown-item-text">
                <span className="nav-dropdown-item-label">{child.label}</span>
                <span className="nav-dropdown-item-desc">{child.desc}</span>
              </span>
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
    try { return localStorage.getItem('anonhub-theme') || 'modern'; }
    catch (e) { return 'modern'; }
  });

  // Mobile drawer state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Sync theme with DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('anonhub-theme', theme); } catch (e) {}
    window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
  }, [theme]);

  function closeAll() { setMobileMenuOpen(false); }

  return (
    <header className="header">
      {/* Brand */}
      <div className="logo-container">
        <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h1 className="logo-text">AnonHub</h1>
          <span className="logo-badge">Beta</span>
        </Link>
      </div>

      {/* Desktop nav */}
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
      </nav>

      {/* Actions */}
      <div className="header-actions">
        <PWAInstallPrompt variant="navbar" />

        <button
          onClick={() => window.dispatchEvent(new CustomEvent('start-anonhub-tour'))}
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

        <button
          className="menu-toggle-btn"
          onClick={() => setMobileMenuOpen(p => !p)}
          aria-label="Toggle Navigation"
        >
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
    </header>
  );
}

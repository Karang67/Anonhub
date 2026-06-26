/**
 * @file Navbar.jsx
 * @description Application global navigation bar. Coordinates routing links, responsive
 * drawer navigation states, and the site-wide theme switching loop (Light/Dark mode)
 * utilizing standard DOM attributes and local state listeners.
 */

import React, { useState, useEffect } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { Sun, Moon, Menu, X } from 'lucide-react';
import './Navbar.css';

export default function Navbar() {
  // Theme state hook - lazy initializes using localStorage key to prevent UI layout flashes
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('anonhub-theme') || 'modern';
    } catch (e) {
      return 'modern'; // Fallback default
    }
  });
  
  // Mobile drawer state tracking flag
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Sync theme changes with DOM node metadata attributes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('anonhub-theme', theme);
    } catch (e) {
      console.warn('localStorage is not accessible', e);
    }
    
    // Broadcast CustomEvent 'themeChanged' to notify legacy widgets/editors
    // (such as Monaco Editor or TinyMCE OXIDE theme configurations) that reside outside React context
    window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
  }, [theme]);

  return (
    <header className="header">
      {/* Brand logo link targeting index route */}
      <div className="logo-container">
        <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h1 className="logo-text">AnonHub</h1>
          <span className="logo-badge">Beta</span>
        </Link>
      </div>

      {/* Navigation links - dynamically supports mobile viewport classes */}
      <nav className={`header-links ${mobileMenuOpen ? 'show' : ''}`}>
        <NavLink to="/" className={({ isActive }) => (isActive ? 'active' : '')} onClick={() => setMobileMenuOpen(false)}>
          Home
        </NavLink>
        <NavLink to="/about" className={({ isActive }) => (isActive ? 'active' : '')} onClick={() => setMobileMenuOpen(false)}>
          About
        </NavLink>
        <NavLink to="/help" className={({ isActive }) => (isActive ? 'active' : '')} onClick={() => setMobileMenuOpen(false)}>
          Help
        </NavLink>
        <NavLink to="/document" className={({ isActive }) => (isActive ? 'active' : '')} onClick={() => setMobileMenuOpen(false)}>
          Document Board
        </NavLink>
        <NavLink to="/code" className={({ isActive }) => (isActive ? 'active' : '')} onClick={() => setMobileMenuOpen(false)}>
          Coding Board
        </NavLink>
        <NavLink to="/office" className={({ isActive }) => (isActive ? 'active' : '')} onClick={() => setMobileMenuOpen(false)}>
          Office Board
        </NavLink>
      </nav>

      <div className="header-actions">
        {/* Global Tour trigger button */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('start-anonhub-tour'))}
          className="theme-toggle-btn tour-btn"
          title="Start Page Tour"
        >
          <span>💡</span><span className="btn-text"> Quick Tour</span>
        </button>

        {/* Theme configuration dropdown */}
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

        {/* Responsive mobile hamburger control */}
        <button className="menu-toggle-btn" onClick={() => setMobileMenuOpen(p => !p)} aria-label="Toggle Navigation">
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>
    </header>
  );
}

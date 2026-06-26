/**
 * @file App.jsx
 * @description Main client-side router and root component of the AnonHub application.
 * Manages routing endpoints for Home, About, Help, collaborative Project Rooms, and dedicated Chat Rooms.
 * Supports legacy HTML-suffix route aliases (e.g. `/about.html`) to prevent 404 errors when navigating
 * from static links or environments. Establishes the global layout flex grid structure.
 */

import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import About from './pages/About';
import Help from './pages/Help';
import ChatRoom from './pages/ChatRoom';
import ProjectRoom from './pages/ProjectRoom';
import StandaloneEntry from './pages/StandaloneEntry';
import OfficeBoard from './pages/OfficeBoard';

/**
 * ScrollToTop Component
 * Resets the window scroll position to the top of the viewport
 * whenever the location pathname changes.
 */
function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

/**
 * AppContent Component
 * Resolves active navigation parameters using react-router hooks to dynamically
 * toggle layout widgets (e.g. global footer) depending on page states.
 */
function AppContent() {
  const location = useLocation();
  const hideFooter = location.pathname.startsWith('/chat/') ||
                     location.pathname.startsWith('/projects/') ||
                     location.pathname.startsWith('/office') ||
                     location.pathname === '/document' ||
                     location.pathname === '/document.html' ||
                     location.pathname === '/code' ||
                     location.pathname === '/code.html';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Global Navigation Header */}
      <Navbar />

      {/* Main Workspace Frame */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Routes>
          {/* Primary Entry Paths */}
          <Route path="/" element={<Home />} />

          {/* Informational Pages (Supports direct routes and .html suffixes) */}
          <Route path="/about" element={<About />} />
          <Route path="/about.html" element={<About />} />
          <Route path="/help" element={<Help />} />
          <Route path="/help.html" element={<Help />} />

          {/* Dynamic Collaboration Routes */}
          <Route path="/chat/:roomName" element={<ChatRoom />} />
          <Route path="/projects/:projectName" element={<ProjectRoom />} />

          {/* Standalone Single-Pane Workspace Gateway Entries */}
          <Route path="/document" element={<StandaloneEntry tabType="document" />} />
          <Route path="/document.html" element={<StandaloneEntry tabType="document" />} />
          <Route path="/code" element={<StandaloneEntry tabType="code" />} />
          <Route path="/code.html" element={<StandaloneEntry tabType="code" />} />

          {/* Collaborative Office Board Routes */}
          <Route path="/office" element={<OfficeBoard />} />
          <Route path="/office.html" element={<OfficeBoard />} />
          <Route path="/office/:roomName" element={<OfficeBoard />} />
        </Routes>
      </div>

      {/* Global sticky footer - dynamically hidden on workspace views */}
      {!hideFooter && (
        <footer className="footer">
          <p style={{ margin: 0 }}>&copy; 2025 AnonHub. All rights reserved.</p>
        </footer>
      )}
    </div>
  );
}

/**
 * Root Application Component
 * Wraps routes inside the React Router Context. Ensures Navbar is persistent
 * and binds a global sticky footer for copyright information.
 */
export default function App() {
  return (
    <Router>
      <ScrollToTop />
      <AppContent />
    </Router>
  );
}


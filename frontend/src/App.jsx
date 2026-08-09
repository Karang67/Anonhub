/**
 * @file App.jsx
 * @description Main client-side router and root component of the AnonHub application.
 * Manages routing endpoints for Home, About, Help, collaborative Project Rooms, and dedicated Chat Rooms.
 * Supports legacy HTML-suffix route aliases (e.g. `/about.html`) to prevent 404 errors when navigating
 * from static links or environments. Establishes the global layout flex grid structure.
 */

import React, { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import AIChatBot from './components/AIChatBot';
import BackendStatusBanner from './components/BackendStatusBanner';

// Lazy load pages to decrease initial bundle size
const Home = lazy(() => import('./pages/Home'));
const About = lazy(() => import('./pages/About'));
const Help = lazy(() => import('./pages/Help'));
const ChatRoom = lazy(() => import('./pages/ChatRoom'));
const ProjectRoom = lazy(() => import('./pages/ProjectRoom'));
const StandaloneEntry = lazy(() => import('./pages/StandaloneEntry'));
const OfficeBoard = lazy(() => import('./pages/OfficeBoard'));
const CallRoom = lazy(() => import('./pages/CallRoom'));
const AdminFeedback = lazy(() => import('./pages/AdminFeedback'));
const AdminLogin = lazy(() => import('./pages/AdminLogin'));

// Modern premium loading spinner component
function LoadingSpinner() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      width: '100%',
      fontFamily: 'var(--font-sans)',
      gap: '1.5rem',
    }}>
      <div style={{
        width: '50px',
        height: '50px',
        border: '3px solid rgba(169, 63, 85, 0.1)',
        borderTop: '3px solid var(--primary-color)',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
      }} />
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
      <div style={{
        fontSize: '1rem',
        fontWeight: '600',
        color: 'var(--text-color)',
        letterSpacing: '0.08em',
        animation: 'pulse 1.5s ease-in-out infinite',
      }}>
        LOADING WORKSPACE...
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

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
                     location.pathname.startsWith('/call/') ||
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
        <Suspense fallback={<LoadingSpinner />}>
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
            <Route path="/call/:roomName" element={<CallRoom />} />

            {/* Standalone Single-Pane Workspace Gateway Entries */}
            <Route path="/chat" element={<StandaloneEntry tabType="chat" />} />
            <Route path="/chat.html" element={<StandaloneEntry tabType="chat" />} />
            <Route path="/projects" element={<StandaloneEntry tabType="project" />} />
            <Route path="/projects.html" element={<StandaloneEntry tabType="project" />} />
            <Route path="/call" element={<StandaloneEntry tabType="call" />} />
            <Route path="/call.html" element={<StandaloneEntry tabType="call" />} />
            <Route path="/document" element={<StandaloneEntry tabType="document" />} />
            <Route path="/document.html" element={<StandaloneEntry tabType="document" />} />
            <Route path="/code" element={<StandaloneEntry tabType="code" />} />
            <Route path="/code.html" element={<StandaloneEntry tabType="code" />} />

            {/* Collaborative Office Board Routes */}
            <Route path="/office" element={<OfficeBoard />} />
            <Route path="/office.html" element={<OfficeBoard />} />
            <Route path="/office/:roomName" element={<OfficeBoard />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin/feedback" element={<AdminFeedback />} />
          </Routes>
        </Suspense>
      </div>

      {/* Global sticky footer - dynamically hidden on workspace views */}
      {!hideFooter && (
        <footer className="footer">
          <p style={{ margin: 0 }}>&copy; 2025 AnonHub. All rights reserved.</p>
        </footer>
      )}

      {/* Global Floating AI Chatbot Widget */}
      <AIChatBot />

      {/* Render Backend Health & Cold-Start Monitoring Banner */}
      <BackendStatusBanner />
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


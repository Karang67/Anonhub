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
import { FeatureAccessProvider } from './context/FeatureAccessContext';
import FeatureRouteGuard from './components/FeatureRouteGuard';

// Lazy load pages to decrease initial bundle size
const Home = lazy(() => import('./pages/Home'));
const About = lazy(() => import('./pages/About'));
const Help = lazy(() => import('./pages/Help'));
const ChatRoom = lazy(() => import('./pages/ChatRoom'));
const ProjectRoom = lazy(() => import('./pages/ProjectRoom'));
const WhiteboardRoom = lazy(() => import('./pages/WhiteboardRoom'));
const StandaloneEntry = lazy(() => import('./pages/StandaloneEntry'));
const OfficeBoard = lazy(() => import('./pages/OfficeBoard'));
const CallRoom = lazy(() => import('./pages/CallRoom'));
const AdminFeedback = lazy(() => import('./pages/AdminFeedback'));
const AdminLogin = lazy(() => import('./pages/AdminLogin'));
const AdminFeatureManager = lazy(() => import('./pages/AdminFeatureManager'));
const Guide = lazy(() => import('./pages/Guide'));
const GlobalChat = lazy(() => import('./pages/GlobalChat'));

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
                     location.pathname.startsWith('/document/') ||
                     location.pathname.startsWith('/code/') ||
                     location.pathname.startsWith('/whiteboard') ||
                     location.pathname.startsWith('/office') ||
                     location.pathname.startsWith('/call/') ||
                     location.pathname.startsWith('/global-chat') ||
                     location.pathname === '/global-chat' ||
                     location.pathname === '/global-chat.html' ||
                     location.pathname === '/chat/global' ||
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
            <Route path="/guide" element={<Guide />} />
            <Route path="/guide.html" element={<Guide />} />

            {/* Dynamic Collaboration Routes */}
            <Route path="/global-chat" element={<FeatureRouteGuard feature="chat.global"><GlobalChat /></FeatureRouteGuard>} />
            <Route path="/global-chat.html" element={<FeatureRouteGuard feature="chat.global"><GlobalChat /></FeatureRouteGuard>} />
            <Route path="/chat/global" element={<FeatureRouteGuard feature="chat.global"><GlobalChat /></FeatureRouteGuard>} />
            <Route path="/chat/:roomName" element={<FeatureRouteGuard feature="chat"><ChatRoom /></FeatureRouteGuard>} />
            <Route path="/projects/:projectName" element={<FeatureRouteGuard feature="project"><ProjectRoom /></FeatureRouteGuard>} />
            <Route path="/document/:projectName" element={<FeatureRouteGuard feature="project.document_board"><ProjectRoom defaultTab="document" standalone={true} /></FeatureRouteGuard>} />
            <Route path="/code/:projectName" element={<FeatureRouteGuard feature="project.code_editor"><ProjectRoom defaultTab="code" standalone={true} /></FeatureRouteGuard>} />
            <Route path="/call/:roomName" element={<FeatureRouteGuard feature="call"><CallRoom /></FeatureRouteGuard>} />

            {/* Real-time Collaborative Whiteboard Routes */}
            <Route path="/whiteboard" element={<FeatureRouteGuard feature="whiteboard"><WhiteboardRoom /></FeatureRouteGuard>} />
            <Route path="/whiteboard.html" element={<FeatureRouteGuard feature="whiteboard"><WhiteboardRoom /></FeatureRouteGuard>} />
            <Route path="/whiteboard/:roomName" element={<FeatureRouteGuard feature="whiteboard"><WhiteboardRoom /></FeatureRouteGuard>} />

            {/* Standalone Single-Pane Workspace Gateway Entries */}
            <Route path="/chat" element={<FeatureRouteGuard feature="chat"><StandaloneEntry tabType="chat" /></FeatureRouteGuard>} />
            <Route path="/chat.html" element={<FeatureRouteGuard feature="chat"><StandaloneEntry tabType="chat" /></FeatureRouteGuard>} />
            <Route path="/projects" element={<FeatureRouteGuard feature="project"><StandaloneEntry tabType="project" /></FeatureRouteGuard>} />
            <Route path="/projects.html" element={<FeatureRouteGuard feature="project"><StandaloneEntry tabType="project" /></FeatureRouteGuard>} />
            <Route path="/call" element={<FeatureRouteGuard feature="call"><StandaloneEntry tabType="call" /></FeatureRouteGuard>} />
            <Route path="/call.html" element={<FeatureRouteGuard feature="call"><StandaloneEntry tabType="call" /></FeatureRouteGuard>} />
            <Route path="/document" element={<FeatureRouteGuard feature="project.document_board"><StandaloneEntry tabType="document" /></FeatureRouteGuard>} />
            <Route path="/document.html" element={<FeatureRouteGuard feature="project.document_board"><StandaloneEntry tabType="document" /></FeatureRouteGuard>} />
            <Route path="/code" element={<FeatureRouteGuard feature="project.code_editor"><StandaloneEntry tabType="code" /></FeatureRouteGuard>} />
            <Route path="/code.html" element={<FeatureRouteGuard feature="project.code_editor"><StandaloneEntry tabType="code" /></FeatureRouteGuard>} />

            {/* Collaborative Office Board Routes */}
            <Route path="/office" element={<FeatureRouteGuard feature="officeboard"><OfficeBoard /></FeatureRouteGuard>} />
            <Route path="/office.html" element={<FeatureRouteGuard feature="officeboard"><OfficeBoard /></FeatureRouteGuard>} />
            <Route path="/office/:roomName" element={<FeatureRouteGuard feature="officeboard"><OfficeBoard /></FeatureRouteGuard>} />

            {/* Administrative Management Routes */}
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin/feedback" element={<AdminFeedback />} />
            <Route path="/admin/features" element={<AdminFeatureManager />} />
          </Routes>
        </Suspense>
      </div>

      {/* Global sticky footer - dynamically hidden on workspace views */}
      {!hideFooter && (
        <footer className="footer">
          <p style={{ margin: 0 }}>&copy; 2025 Trinetra. All rights reserved.</p>
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
 * Wraps routes inside the React Router and FeatureAccess Contexts.
 */
export default function App() {
  return (
    <Router>
      <FeatureAccessProvider>
        <ScrollToTop />
        <AppContent />
      </FeatureAccessProvider>
    </Router>
  );
}


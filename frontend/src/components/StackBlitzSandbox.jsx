/**
 * @file components/StackBlitzSandbox.jsx
 * @description In-browser client-side WebContainer execution environment powered by @stackblitz/sdk.
 * Bridges AnonHub's real-time collaborative workspace file system with a local StackBlitz VM.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import sdk from '@stackblitz/sdk';
import './StackBlitzSandbox.css';

/**
 * Checks if a language is natively executable within Node.js / WebContainer environments
 */
const WEB_CONTAINER_LANGUAGES = new Set([
  'javascript', 'typescript', 'json', 'html', 'css', 'markdown', 'md'
]);

/**
 * Translates AnonHub's collaborative file map into the flat structure expected by StackBlitz SDK.
 * @param {Object} filesMap - { [path]: { name, content, language } }
 * @param {string} projectName
 * @param {string} activeFilePath
 * @returns {Record<string, string>}
 */
export function translateFilesToStackBlitz(filesMap, projectName = 'anonhub-workspace', activeFilePath = 'index.js') {
  const result = {};
  let hasPackageJson = false;

  Object.entries(filesMap || {}).forEach(([filePath, fileObj]) => {
    const cleanPath = filePath.replace(/^\/+/, '');
    const content = typeof fileObj === 'string' ? fileObj : (fileObj?.content ?? '');
    result[cleanPath] = content;
    if (cleanPath === 'package.json') {
      hasPackageJson = true;
    }
  });

  const cleanActive = (activeFilePath || '').replace(/^\/+/, '');
  const entryFile = (cleanActive && result[cleanActive])
    ? cleanActive
    : (result['index.js'] ? 'index.js' : (Object.keys(result).find(f => f.endsWith('.js') || f.endsWith('.ts')) || 'index.js'));

  // Provide a minimal package.json if absent so the WebContainer terminal has npm/node scripts ready
  if (!hasPackageJson) {
    const safePkgName = (projectName || 'anonhub-project')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-') || 'anonhub-workspace';

    // Check if express is used
    const anyContent = Object.values(result).join('\n');
    const usesExpress = anyContent.includes("require('express')") || anyContent.includes('from "express"') || anyContent.includes("from 'express'");

    const dependencies = {};
    if (usesExpress) {
      dependencies['express'] = '^4.18.2';
    }

    result['package.json'] = JSON.stringify({
      name: safePkgName,
      version: '1.0.0',
      scripts: {
        start: `node ${entryFile}`,
        dev: `node ${entryFile}`
      },
      dependencies
    }, null, 2);
  }

  // Ensure an index.js exists if no files were loaded
  if (Object.keys(result).length <= 1 && !result['index.js']) {
    result['index.js'] = '// Welcome to AnonHub WebContainer (StackBlitz)\nconsole.log("🚀 Hello from browser-sandbox WebContainer!");\n';
  }

  return result;
}

export default function StackBlitzSandbox({
  files,
  activeFilePath,
  projectName,
  isVisible,
  onSwitchToPiston,
  runTrigger
}) {
  const wrapperRef = useRef(null);
  const vmRef = useRef(null);
  const isBootingRef = useRef(false);
  const prevFilesRef = useRef({});
  const syncTimeoutRef = useRef(null);
  const retryTimerRef = useRef(null);

  const [bootStatus, setBootStatus] = useState('booting'); // 'booting' | 'ready' | 'syncing' | 'error'
  const [errorMessage, setErrorMessage] = useState(null);
  const [nonWebLangDetected, setNonWebLangDetected] = useState(null);
  const [viewMode, setViewMode] = useState('editor'); // 'editor' (Default full-width editor + dual terminal) | 'default' (split web preview)

  // Check language compatibility
  useEffect(() => {
    const activeFile = files[activeFilePath];
    const lang = activeFile?.language?.toLowerCase();
    if (lang && !WEB_CONTAINER_LANGUAGES.has(lang)) {
      setNonWebLangDetected(activeFile.language);
    } else {
      setNonWebLangDetected(null);
    }
  }, [files, activeFilePath]);

  // Attempt to reconnect to the iframe if initial handshake had network delay
  const attemptReconnect = useCallback((iframeEl, attemptsLeft = 5) => {
    if (!iframeEl || attemptsLeft <= 0 || vmRef.current) return;

    retryTimerRef.current = setTimeout(async () => {
      if (vmRef.current || !wrapperRef.current) return;
      try {
        const vm = await sdk.connect(iframeEl);
        if (vm) {
          vmRef.current = vm;
          isBootingRef.current = false;
          setBootStatus('ready');
          console.log('✅ Connected to StackBlitz VM via reconnect hook!');
          return;
        }
      } catch (_) {
        // Keep retrying
        attemptReconnect(iframeEl, attemptsLeft - 1);
      }
    }, 2500);
  }, []);

  // Boot the StackBlitz WebContainer instance
  const bootSandbox = useCallback((forcedView) => {
    if (!wrapperRef.current) return;

    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
    }

    const currentView = forcedView || viewMode;
    isBootingRef.current = true;
    setBootStatus('booting');
    setErrorMessage(null);

    const projectFiles = translateFilesToStackBlitz(files, projectName, activeFilePath);
    prevFilesRef.current = { ...projectFiles };

    const cleanActive = (activeFilePath || '').replace(/^\/+/, '');
    const initialOpenFile = (cleanActive && projectFiles[cleanActive])
      ? cleanActive
      : (projectFiles['index.js'] ? 'index.js' : Object.keys(projectFiles)[0]);

    // Create a stable mount element inside wrapperRef
    wrapperRef.current.innerHTML = '';
    const mountDiv = document.createElement('div');
    mountDiv.style.width = '100%';
    mountDiv.style.height = '100%';
    wrapperRef.current.appendChild(mountDiv);

    // Auto-dismiss loading overlay after 4s so user can immediately see & use the WebContainer terminal
    const autoDismissTimer = setTimeout(() => {
      setBootStatus(prev => (prev === 'booting' ? 'ready' : prev));
    }, 4000);

    sdk.embedProject(
      mountDiv,
      {
        title: projectName || 'AnonHub Workspace',
        description: 'Collaborative client-side sandboxed execution via WebContainers',
        template: 'node',
        files: projectFiles,
      },
      {
        height: '100%',
        openFile: initialOpenFile,
        terminalHeight: 45,
        theme: 'dark',
        crossOriginIsolated: true,
        hideNavigation: false,
        hideExplorer: false,
        showSidebar: true,
        clickToRun: false,
        view: currentView,
        startScript: 'start'
      }
    )
      .then((vm) => {
        clearTimeout(autoDismissTimer);
        vmRef.current = vm;
        isBootingRef.current = false;
        setBootStatus('ready');
      })
      .catch((err) => {
        clearTimeout(autoDismissTimer);
        console.warn('Initial StackBlitz handshake notice (connecting in background):', err);
        isBootingRef.current = false;
        setBootStatus('ready');

        // Iframe is rendered, try connecting in the background
        const iframe = wrapperRef.current?.querySelector('iframe');
        if (iframe) {
          attemptReconnect(iframe, 5);
        }
      });
  }, [files, projectName, activeFilePath, viewMode, attemptReconnect]);

  // Handle View Mode Toggle
  const toggleViewMode = useCallback(async () => {
    const newView = viewMode === 'editor' ? 'default' : 'editor';
    setViewMode(newView);
    if (vmRef.current?.editor?.setView) {
      try {
        await vmRef.current.editor.setView(newView);
        return;
      } catch (err) {
        console.warn('Could not set view dynamically:', err);
      }
    }
    // If VM not directly connected, reload with the desired view
    bootSandbox(newView);
  }, [viewMode, bootSandbox]);

  // Initial boot when becoming visible
  useEffect(() => {
    if (!isVisible || vmRef.current || isBootingRef.current) return;
    bootSandbox();
  }, [isVisible, bootSandbox]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, []);

  // Listen to external run trigger (e.g. from main top navbar Run button)
  useEffect(() => {
    if (!runTrigger || !isVisible) return;
    bootSandbox();
  }, [runTrigger, isVisible, bootSandbox]);

  // Open in new tab fallback helper
  const handleOpenInNewTab = () => {
    try {
      const projectFiles = translateFilesToStackBlitz(files, projectName, activeFilePath);
      sdk.openProject({
        title: projectName || 'AnonHub Workspace',
        description: 'AnonHub Sandbox Project',
        template: 'node',
        files: projectFiles,
      }, {
        newWindow: true
      });
    } catch (err) {
      window.open('https://stackblitz.com/fork/node', '_blank');
    }
  };

  // Real-Time Bridge: Debounced propagation of collaborative file updates to StackBlitz VM
  useEffect(() => {
    if (!vmRef.current || bootStatus === 'booting') return;

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    // Debounce typing updates by 350ms so rapid collaborative keystrokes don't choke the VM
    syncTimeoutRef.current = setTimeout(async () => {
      const currentSnapshot = translateFilesToStackBlitz(files, projectName, activeFilePath);
      const prevSnapshot = prevFilesRef.current;

      const createDiff = {};
      const destroyDiff = [];

      // Detect modified or newly created files
      Object.entries(currentSnapshot).forEach(([path, content]) => {
        if (prevSnapshot[path] !== content) {
          createDiff[path] = content;
        }
      });

      // Detect deleted files
      Object.keys(prevSnapshot).forEach((path) => {
        if (!currentSnapshot[path] && path !== 'package.json') {
          destroyDiff.push(path);
        }
      });

      const hasDiff = Object.keys(createDiff).length > 0 || destroyDiff.length > 0;
      if (!hasDiff) return;

      try {
        setBootStatus('syncing');
        await vmRef.current.applyFsDiff({
          create: createDiff,
          destroy: destroyDiff
        });
        prevFilesRef.current = { ...currentSnapshot };
        setBootStatus('ready');
      } catch (syncErr) {
        console.warn('StackBlitz applyFsDiff warning:', syncErr);
        setBootStatus('ready');
      }
    }, 350);

    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, [files, projectName, activeFilePath, bootStatus]);

  // Keep active file in view when changed from parent tabs
  useEffect(() => {
    if (!vmRef.current || !activeFilePath) return;
    try {
      if (vmRef.current.editor?.openFile) {
        vmRef.current.editor.openFile(activeFilePath.replace(/^\/+/, '')).catch(() => {});
      }
    } catch (_) {}
  }, [activeFilePath]);

  return (
    <div
      className="stackblitz-sandbox-container"
      style={{ display: isVisible ? 'flex' : 'none' }}
    >
      {/* Header Info & Sync Status Bar */}
      <div className="stackblitz-header-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontWeight: 600 }}>🌐 StackBlitz WebContainers</span>
          <span className={`stackblitz-status-tag ${bootStatus}`}>
            {bootStatus === 'booting' && '🟡 Initializing VM...'}
            {bootStatus === 'syncing' && '🔄 Syncing edits...'}
            {bootStatus === 'ready' && '🟢 WebContainer Ready'}
            {bootStatus === 'error' && '⚠️ Sandbox Notice'}
          </span>
        </div>

        <div className="stackblitz-actions">
          <button
            type="button"
            className="stackblitz-btn"
            onClick={toggleViewMode}
            title="Toggle between Editor & Terminal layout and Split Web Preview"
            style={{
              background: viewMode === 'editor' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.08)',
              borderColor: viewMode === 'editor' ? '#38bdf8' : 'rgba(255, 255, 255, 0.15)'
            }}
          >
            {viewMode === 'editor' ? '📱 Split Web Preview' : '🖥️ Editor & Dual Terminal'}
          </button>
          <button
            type="button"
            className="stackblitz-btn"
            onClick={() => bootSandbox()}
            title="Re-run active script and reload WebContainer"
            style={{ background: 'rgba(16, 185, 129, 0.15)', borderColor: '#10b981', color: '#6ee7b7' }}
          >
            ▶ Run Active File
          </button>
          <button
            type="button"
            className="stackblitz-btn"
            onClick={() => bootSandbox()}
            title="Reload WebContainer"
          >
            🔄 Reload VM
          </button>
          <button
            type="button"
            className="stackblitz-btn"
            onClick={handleOpenInNewTab}
            title="Open in full StackBlitz window"
          >
            ↗ Open External
          </button>
          <button
            type="button"
            className="stackblitz-btn"
            onClick={onSwitchToPiston}
            title="Switch to Coding Board (Compiler)"
            style={{ background: 'rgba(167, 139, 250, 0.15)', borderColor: '#a78bfa', color: '#c4b5fd' }}
          >
            💻 Coding Board (Compiler)
          </button>
        </div>
      </div>

      {/* Language Safety Warning */}
      {nonWebLangDetected && (
        <div className="stackblitz-lang-warning">
          <span>
            ⚠️ <strong>{nonWebLangDetected}</strong> detected: StackBlitz WebContainers natively run Node.js/Web stacks. For compiled languages (C++, Java, Python), use the Coding Board compiler.
          </span>
          <button type="button" onClick={onSwitchToPiston}>
            Go to Coding Board
          </button>
        </div>
      )}

      {/* StackBlitz Host DOM Element */}
      <div className="stackblitz-iframe-host">
        {bootStatus === 'booting' && (
          <div className="stackblitz-loading-overlay">
            <div className="stackblitz-spinner" />
            <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>Booting client-side WebContainer virtual machine...</p>
            <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
              Mounting local Node.js environment, dual terminal shell & file tree
            </span>
            <button
              type="button"
              className="stackblitz-btn"
              onClick={() => setBootStatus('ready')}
              style={{ marginTop: '8px' }}
            >
              Dismiss / View Terminal
            </button>
          </div>
        )}
        {errorMessage && (
          <div className="stackblitz-loading-overlay" style={{ color: '#f87171' }}>
            <p>⚠️ {errorMessage}</p>
            <button className="stackblitz-btn" onClick={() => bootSandbox()}>
              Retry Initialization
            </button>
          </div>
        )}
        <div ref={wrapperRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
}

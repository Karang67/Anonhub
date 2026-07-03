/**
 * @file main.jsx
 * @description Bootstraps the React client-side application.
 * Mounts the main React component (`App`) to the root HTML node (`#root`),
 * rendering inside StrictMode to identify potential side effects and deprecated hooks.
 * Imports global style assets including layout tokens and color schemes.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Select the root DOM node and render the React virtual DOM tree inside StrictMode
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Service worker: register only in production. In development we unregister
// any existing service workers to avoid stale caches causing blank-first-loads.
if ('serviceWorker' in navigator) {
  if (import.meta.env && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(reg => console.log('[SW] Registered:', reg.scope))
        .catch(err => console.warn('[SW] Registration failed:', err));
    });
  } else {
    // Development: ensure no service worker interferes
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(r => r.unregister());
    }).catch(() => {});
  }
}


/**
 * @file socket.js
 * @description Client-side Socket.IO initialization and management service.
 * Handles loading session cookies and instantiating single-instance websocket socket channels
 * directed at the host root origin.
 */

import { io } from 'socket.io-client';

/**
 * Parses and retrieves client cookies matching a specific key name.
 * @param {string} name - Target cookie parameter key E.g. 'anonhub-username'
 * @returns {string|null} Decoded cookie value payload if found, otherwise null
 */
export function getCookie(name) {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie.split(';');
  for (let i = 0; i < cookies.length; i++) {
    const cookie = cookies[i].trim();
    if (cookie.startsWith(name + '=')) {
      return decodeURIComponent(cookie.substring(name.length + 1));
    }
  }
  return null;
}

/**
 * Initializes and returns a new Socket.IO client instance.
 * Binds saved anonymous pseudonyms inside the connection authentication parameters
 * to let the backend reuse existing user descriptors.
 * Connects directly to the current host origin (since the Express app serves the client bundles).
 * Note: Configured with `autoConnect: false` to allow callers to control the connection lifespan.
 *
 * Priority: sessionStorage (current browser session) > cookie (set on page load).
 * This ensures that navigating between pages within the same browser session always
 * uses the same username, and a new name is only assigned when the browser is reopened.
 * @returns {Socket} Configured Socket.IO Client instance
 */
export function initSocket() {
  // Prefer sessionStorage (scoped to current browser session) over cookie
  const savedUsername = sessionStorage.getItem('anonhub-username') || getCookie('anonhub-username') || '';
  const sessionId = getCookie('anonhub-session-id') || '';
  return io({
    auth: {
      username: savedUsername,
      sessionId: sessionId
    },
    extraHeaders: {
      'ngrok-skip-browser-warning': 'true'
    },
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    autoConnect: false
  });
}

/**
 * Sets a client-side session cookie that persists until the browser is closed.
 * @param {string} name - Cookie name
 * @param {string} value - Cookie value
 */
export function setCookie(name, value) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; SameSite=Lax`;
}

/**
 * Deletes a client-side cookie.
 * @param {string} name - Cookie name
 */
export function deleteCookie(name) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC; SameSite=Lax`;
}



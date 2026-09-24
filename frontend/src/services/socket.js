/**
 * @file socket.js
 * @description Client-side Socket.IO initialization and management service.
 * Handles loading session cookies and instantiating single-instance websocket socket channels
 * directed at the host root origin.
 */

import { io } from 'socket.io-client';
import { SOCKET_URL } from '../config';

/**
 * Parses and retrieves client cookies matching a specific key name.
 * @param {string} name - Target cookie parameter key E.g. 'trinetra-username'
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

// Global shared socket instance to prevent duplicate connections and handshakes
let globalSocket = null;

/**
 * Initializes and returns the shared Socket.IO client singleton instance.
 * Reuses existing connection across components and pages to eliminate
 * redundant handshakes, timers, and TCP connection overhead.
 *
 * Priority: sessionStorage (current browser session) > cookie (set on page load).
 * @returns {Socket} Shared configured Socket.IO Client instance
 */
export function initSocket() {
  const savedUsername = sessionStorage.getItem('trinetra-username') || sessionStorage.getItem('anonhub-username') || getCookie('trinetra-username') || getCookie('anonhub-username') || '';
  const sessionId = getCookie('trinetra-session-id') || getCookie('anonhub-session-id') || '';

  if (globalSocket) {
    // Update auth credentials if username was updated
    if (globalSocket.auth) {
      globalSocket.auth.username = savedUsername;
      globalSocket.auth.sessionId = sessionId;
    }
    return globalSocket;
  }

  globalSocket = io(SOCKET_URL || undefined, {
    auth: {
      username: savedUsername,
      sessionId: sessionId
    },
    extraHeaders: {
      'ngrok-skip-browser-warning': 'true'
    },
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    autoConnect: false
  });

  return globalSocket;
}

export function getSharedSocket() {
  return globalSocket || initSocket();
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



/**
 * @file config.js
 * @description Centralized environment configuration for AnonHub frontend.
 * Manages API and Socket.IO URLs based on VITE_API_URL and VITE_SOCKET_URL environment variables.
 */

// Normalized API URL without trailing slashes (e.g. 'https://anonhub-l0wz.onrender.com')
export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

// Normalized Socket URL without trailing slashes (defaults to API_URL if not explicitly specified)
export const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

/**
 * Transforms relative API endpoint paths into absolute URLs targeting the configured backend.
 * If VITE_API_URL is empty (e.g. in local development with Vite dev proxies), returns the relative path.
 *
 * @param {string} path - Endpoint path (e.g. '/api/ai-chat', '/upload', '/create-project')
 * @returns {string} Fully qualified URL or relative path
 */
export function getApiUrl(path = '') {
  if (!path) return API_URL;
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return API_URL ? `${API_URL}${cleanPath}` : cleanPath;
}

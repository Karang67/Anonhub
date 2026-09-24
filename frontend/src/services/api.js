/**
 * @file services/api.js
 * @description Centralized HTTP API client for all backend REST calls.
 * Provides typed, named functions so page components stay clean of fetch logic.
 */

import { API_URL } from '../config';

const BASE = API_URL || '';

/** Shared fetch wrapper with JSON handling */
async function apiFetch(path, options = {}) {
    const res = await fetch(`${BASE}${path}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw Object.assign(new Error(err.error || 'Request failed'), { status: res.status, data: err });
    }
    return res.json();
}

// ─── Health ───────────────────────────────────────────────────────────────────

/** GET /api/health */
export const checkHealth = () => apiFetch('/api/health');

// ─── Project ──────────────────────────────────────────────────────────────────

/** POST /create-project */
export const createProject = (name, accessKey, ownerKey) =>
    apiFetch('/create-project', {
        method: 'POST',
        body: JSON.stringify({ name, accessKey, ownerKey }),
    });

/** POST /api/project/:name/change-key */
export const changeProjectKey = (name, ownerToken, newKey) =>
    apiFetch(`/api/project/${encodeURIComponent(name)}/change-key`, {
        method: 'POST',
        body: JSON.stringify({ ownerToken, newKey }),
    });

// ─── Chat ─────────────────────────────────────────────────────────────────────

/** POST /join-chat */
export const joinChat = (room, accessKey, ownerKey) =>
    apiFetch('/join-chat', {
        method: 'POST',
        body: JSON.stringify({ room, accessKey, ownerKey }),
    });

/** POST /api/chat/:name/change-key */
export const changeChatKey = (name, ownerToken, newKey) =>
    apiFetch(`/api/chat/${encodeURIComponent(name)}/change-key`, {
        method: 'POST',
        body: JSON.stringify({ ownerToken, newKey }),
    });

/** GET /api/messages/:room?before=&limit= */
export const getMessages = (room, { before, limit = 50 } = {}) => {
    const params = new URLSearchParams({ limit });
    if (before) params.set('before', before);
    return apiFetch(`/api/messages/${encodeURIComponent(room)}?${params}`);
};

// ─── Office ───────────────────────────────────────────────────────────────────

/** POST /create-office */
export const createOffice = (name, accessKey) =>
    apiFetch('/create-office', {
        method: 'POST',
        body: JSON.stringify({ name, accessKey }),
    });

// ─── Compile ──────────────────────────────────────────────────────────────────

/** POST /api/compile */
export const compileCode = (code, language) =>
    apiFetch('/api/compile', {
        method: 'POST',
        body: JSON.stringify({ code, language }),
    });

// ─── AI Chat ──────────────────────────────────────────────────────────────────

/** POST /api/ai-chat */
export const sendAiMessage = (message, history = []) =>
    apiFetch('/api/ai-chat', {
        method: 'POST',
        body: JSON.stringify({ message, history }),
    });

// ─── Feedback ─────────────────────────────────────────────────────────────────

/** POST /api/feedback */
export const submitFeedback = (data) =>
    apiFetch('/api/feedback', {
        method: 'POST',
        body: JSON.stringify(data),
    });

/** GET /api/admin/feedback */
export const getAdminFeedback = () => apiFetch('/api/admin/feedback');

/** GET /api/admin/feedback/status */
export const getAdminFeedbackStatus = () => apiFetch('/api/admin/feedback/status');

// ─── Versions ─────────────────────────────────────────────────────────────────

/** GET /api/versions/:projectName?type= */
export const getVersions = (projectName, type = 'document') =>
    apiFetch(`/api/versions/${encodeURIComponent(projectName)}?type=${type}`);

/** GET /api/versions/:id/content */
export const getVersionContent = (id) => apiFetch(`/api/versions/${id}/content`);

/** DELETE /api/versions/:id */
export const deleteVersion = (id) => apiFetch(`/api/versions/${id}`, { method: 'DELETE' });

// ─── Attachments ──────────────────────────────────────────────────────────────

/**
 * POST /upload — uploads a File object and returns { location }
 * @param {File} file
 */
export const uploadAttachment = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE}/upload`, { method: 'POST', credentials: 'include', body: formData });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Upload failed');
    }
    return res.json();
};

// ─── Admin Auth ───────────────────────────────────────────────────────────────

/** POST /api/admin/login */
export const adminLogin = (username, password) =>
    apiFetch('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
    });

/** POST /api/admin/logout */
export const adminLogout = () => apiFetch('/api/admin/logout', { method: 'POST' });

// ─── Room Delete ──────────────────────────────────────────────────

/**
 * DELETE /api/:type/:name — owner-only room deletion
 * @param {'project'|'chat'|'office'} type
 * @param {string} name
 * @param {string} ownerToken
 */
export const deleteRoom = (type, name, ownerToken) =>
    apiFetch(`/api/${type}/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        body: JSON.stringify({ ownerToken }),
    });


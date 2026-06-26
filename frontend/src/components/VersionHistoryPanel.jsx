/**
 * @file VersionHistoryPanel.jsx
 * @description Slide-in version history drawer for document and code boards.
 * Shows the last 10 auto-saved and manual snapshots with timestamps and descriptions.
 * Allows copy-to-clipboard for all users and version restoration.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { X, RotateCcw, Clock, FileText, Code2, Copy, Check, Trash2 } from 'lucide-react';
import './VersionHistoryPanel.css';

function formatRelativeTime(dateStr) {
  const date = new Date(dateStr);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  return `${days}d ago`;
}

function formatAbsoluteTime(dateStr) {
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

export default function VersionHistoryPanel({ projectName, type, socket, isOwner, onClose }) {
  const [versions, setVersions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [restoring, setRestoring] = useState(null);
  const [message, setMessage] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  const fetchVersions = useCallback(() => {
    if (!projectName || !type) return;
    setIsLoading(true);
    fetch(`/api/versions/${encodeURIComponent(projectName)}?type=${type}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setVersions(data);
        else setVersions([]);
      })
      .catch(() => setVersions([]))
      .finally(() => setIsLoading(false));
  }, [projectName, type]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  // Listen for socket notifications to refresh or alert
  useEffect(() => {
    if (!socket) return;

    const handleRestored = ({ type: t, savedAt }) => {
      setRestoring(null);
      setMessage(`✅ ${t === 'code' ? 'Code' : 'Document'} restored to version from ${formatAbsoluteTime(savedAt)}`);
      setTimeout(() => setMessage(''), 4000);
      fetchVersions();
    };

    const handleUpdated = ({ type: t }) => {
      if (t === type) {
        fetchVersions();
      }
    };

    socket.on('version restored', handleRestored);
    socket.on('version list updated', handleUpdated);
    socket.on('version saved', handleUpdated);

    return () => {
      socket.off('version restored', handleRestored);
      socket.off('version list updated', handleUpdated);
      socket.off('version saved', handleUpdated);
    };
  }, [socket, type, fetchVersions]);

  const handleRestore = (versionId) => {
    if (!socket) return;
    if (type === 'document' && !isOwner) {
      alert('Only the project owner can restore document versions.');
      return;
    }
    if (!window.confirm('Restore this version? Current content will be overwritten for all collaborators.')) return;
    setRestoring(versionId);
    socket.emit('restore version', { projectName, versionId });
  };

  const handleCopy = async (versionId) => {
    try {
      const res = await fetch(`/api/versions/${versionId}/content`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      await navigator.clipboard.writeText(data.content);
      setCopiedId(versionId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      alert('Failed to copy version content.');
    }
  };

  const handleDelete = async (versionId) => {
    if (!window.confirm('Permanently delete this version snapshot?')) return;
    try {
      const res = await fetch(`/api/versions/${versionId}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error();
      setMessage('✅ Version deleted successfully.');
      setTimeout(() => setMessage(''), 3000);
      fetchVersions();
    } catch {
      alert('Failed to delete version.');
    }
  };

  const canRestore = type === 'code' || isOwner;

  return (
    <div className="version-history-panel">
      <div className="version-panel-header">
        <div className="version-panel-title">
          {type === 'code' ? <Code2 size={16} /> : <FileText size={16} />}
          <span>Version History</span>
          <span className="version-panel-subtitle">({type === 'code' ? 'Code' : 'Document'})</span>
        </div>
        <button className="version-panel-close" onClick={onClose} title="Close">
          <X size={16} />
        </button>
      </div>

      {message && (
        <div className="version-panel-message success">{message}</div>
      )}

      <div className="version-panel-body">
        {isLoading ? (
          <div className="version-panel-loading">
            <div className="version-spinner" />
            <span>Loading versions...</span>
          </div>
        ) : versions.length === 0 ? (
          <div className="version-panel-empty">
            <Clock size={28} opacity={0.3} />
            <p>No versions saved yet.</p>
            <p className="version-panel-hint">Versions are saved automatically every 5 edits, or explicitly by using "Save Code".</p>
          </div>
        ) : (
          <ul className="version-list">
            {versions.map((v, i) => (
              <li key={v._id} className="version-item">
                <div className="version-item-icon">
                  {v.type === 'code' ? <Code2 size={14} /> : <FileText size={14} />}
                </div>
                <div className="version-item-info">
                  <span className="version-item-label">
                    {i === 0 ? '🟢 Current Version' : `Version ${versions.length - i}`}
                  </span>
                  {v.comment && (
                    <span className="version-item-comment">"{v.comment}"</span>
                  )}
                  <span className="version-item-time" title={formatAbsoluteTime(v.savedAt)}>
                    <Clock size={10} /> {formatRelativeTime(v.savedAt)}
                  </span>
                  {v.language && v.type === 'code' && (
                    <span className="version-item-lang">{v.language}</span>
                  )}
                </div>
                <div className="version-item-actions">
                  <button
                    className="version-copy-btn"
                    onClick={() => handleCopy(v._id)}
                    title="Copy this version's content"
                  >
                    {copiedId === v._id ? <Check size={12} style={{ color: '#52c41a' }} /> : <Copy size={12} />}
                  </button>
                  {canRestore && i !== 0 && (
                    <button
                      className={`version-restore-btn ${restoring === v._id ? 'loading' : ''}`}
                      onClick={() => handleRestore(v._id)}
                      disabled={restoring !== null}
                      title="Restore this version"
                    >
                      {restoring === v._id ? '...' : <RotateCcw size={12} />}
                    </button>
                  )}
                  <button
                    className="version-delete-btn"
                    onClick={() => handleDelete(v._id)}
                    title="Delete this version snapshot"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!canRestore && (
        <div className="version-panel-footer">
          <span className="version-panel-hint">Only the project owner can restore document versions.</span>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './AdminFeedback.css';

export default function AdminFeedback() {
  const navigate = useNavigate();
  const [feedback, setFeedback] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadAdminData() {
      setLoading(true);
      setError('');
      try {
        const [feedbackRes, statusRes] = await Promise.all([
          fetch('/api/admin/feedback', { credentials: 'include' }),
          fetch('/api/admin/feedback/status', { credentials: 'include' })
        ]);

        if (feedbackRes.status === 403 || statusRes.status === 403) {
          navigate('/admin/login');
          return;
        }

        const feedbackData = await feedbackRes.json();
        if (!feedbackRes.ok) throw new Error(feedbackData.error || 'Failed to load feedback.');

        const statusData = await statusRes.json();
        if (!statusRes.ok) throw new Error(statusData.error || 'Failed to load status.');

        setFeedback(feedbackData);
        setStatus(statusData);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadAdminData();
  }, [navigate]);

  return (
    <main className="page-container admin-feedback-page">
      <h2>Admin Feedback</h2>
      <p className="admin-feedback-note">This page displays submitted feedback from the Help page.</p>

      {status && (
        <div className={`admin-feedback-status ${status.emailDeliveryEnabled ? 'enabled' : 'disabled'}`}>
          {status.message}
        </div>
      )}

      {loading && <div className="admin-feedback-loading">Loading feedback...</div>}
      {error && <div className="admin-feedback-error">{error}</div>}

      {!loading && !error && (
        <div className="admin-feedback-table-wrap">
          <table className="admin-feedback-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Name</th>
                <th>Email</th>
                <th>Rating</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {feedback.map(item => (
                <tr key={item.id}>
                  <td>{new Date(item.createdAt).toLocaleString()}</td>
                  <td>{item.name}</td>
                  <td>{item.email}</td>
                  <td>{item.rating || '-'}</td>
                  <td>{item.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

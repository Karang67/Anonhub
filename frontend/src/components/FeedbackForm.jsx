import React, { useState } from 'react';
import './FeedbackForm.css';

export default function FeedbackForm({ onSuccess }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [rating, setRating] = useState(5);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!message.trim()) {
      setError('Please enter your feedback.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || undefined, email: email.trim() || undefined, message: message.trim(), rating })
      });
      let data;
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        // non-JSON response (often HTML when backend is not reachable)
        const text = await res.text();
        // If the server returned HTML (starts with <!DOCTYPE), show helpful message
        if (text.trim().startsWith('<')) {
          throw new Error('Server returned HTML. Is the backend running?');
        }
        throw new Error(text || 'Submission failed');
      }
      if (!res.ok) throw new Error(data.error || 'Submission failed');
      setSuccess(true);
      setMessage('');
      setName('');
      setEmail('');
      setRating(5);
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err.message || 'Failed to submit feedback.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="feedback-success">
        Thank you — your feedback was submitted.
      </div>
    );
  }

  return (
    <form className="feedback-form" onSubmit={submit}>
      <div className="feedback-row">
        <input
          className="feedback-input"
          placeholder="Your name (optional)"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <input
          className="feedback-input"
          placeholder="Email (optional)"
          value={email}
          onChange={e => setEmail(e.target.value)}
          type="email"
        />
      </div>

      <div className="feedback-row">
        <label className="feedback-label">Rating</label>
        <select className="feedback-select" value={rating} onChange={e => setRating(Number(e.target.value))}>
          <option value={5}>5 - Excellent</option>
          <option value={4}>4 - Good</option>
          <option value={3}>3 - Okay</option>
          <option value={2}>2 - Poor</option>
          <option value={1}>1 - Terrible</option>
        </select>
      </div>

      <textarea
        className="feedback-textarea"
        placeholder="What can we improve?"
        value={message}
        onChange={e => setMessage(e.target.value)}
        rows={5}
      />

      {error && <div className="feedback-error">{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="feedback-submit" type="submit" disabled={loading}>
          {loading ? 'Sending…' : 'Send Feedback'}
        </button>
        <button className="feedback-cancel" type="button" onClick={() => { setMessage(''); setName(''); setEmail(''); setRating(5); }}>
          Clear
        </button>
      </div>
    </form>
  );
}

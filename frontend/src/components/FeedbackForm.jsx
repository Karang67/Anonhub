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

  const resetForm = () => {
    setMessage('');
    setName('');
    setEmail('');
    setRating(5);
    setError('');
    setSuccess(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    const cleanMessage = message.trim();
    if (!cleanMessage) {
      setError('Please enter your feedback message.');
      return;
    }

    const cleanEmail = email.trim();
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Please enter a valid email address or leave it blank.');
      return;
    }

    const cleanName = name.trim();

    setLoading(true);
    try {
      const payload = {
        message: cleanMessage,
        rating: Number(rating) || 5
      };
      if (cleanName) payload.name = cleanName;
      if (cleanEmail) payload.email = cleanEmail;

      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      let data = null;
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        if (text.trim().startsWith('<')) {
          throw new Error('Server returned HTML. Is the backend server running?');
        }
        throw new Error(text || 'Submission failed.');
      }

      if (!res.ok) {
        throw new Error(data?.error || 'Submission failed. Please try again.');
      }

      setSuccess(true);
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
        <p style={{ margin: '0 0 12px 0' }}>Thank you — your feedback has been submitted successfully!</p>
        <button
          className="feedback-submit"
          type="button"
          onClick={resetForm}
          style={{ fontSize: '0.88rem', padding: '6px 14px' }}
        >
          Send Another Feedback
        </button>
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
        <button className="feedback-cancel" type="button" onClick={resetForm}>
          Clear
        </button>
      </div>
    </form>
  );
}

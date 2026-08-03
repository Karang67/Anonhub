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
    let web3Sent = false;
    let dbSent = false;

    // 1. Send via Web3Forms for instant, guaranteed live email delivery
    const WEB3FORMS_KEY = import.meta.env.VITE_WEB3FORMS_ACCESS_KEY || '42667a44-9862-4b87-a1be-7f2f261d70ee';
    if (WEB3FORMS_KEY) {
      try {
        const web3Payload = {
          access_key: WEB3FORMS_KEY,
          name: cleanName || 'Anonymous User',
          email: cleanEmail || 'loveinsights880@gmail.com',
          subject: `New AnonHub Feedback (${rating} Stars)`,
          from_name: 'AnonHub App',
          rating: `${rating} / 5`,
          message: cleanMessage
        };

        const wRes = await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(web3Payload)
        });

        const wData = await wRes.json().catch(() => null);
        if (wRes.ok && (wData === null || wData.success !== false)) {
          web3Sent = true;
        }
      } catch (wErr) {
        console.warn('Web3Forms dispatch warning:', wErr);
      }
    }

    // 2. Save to local database if backend API is reachable
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
      if (res.ok) {
        dbSent = true;
      }
    } catch (apiErr) {
      console.warn('Backend API save warning:', apiErr);
    }

    // If either Web3Forms or database save succeeded, consider submission successful
    if (web3Sent || dbSent) {
      setSuccess(true);
      if (onSuccess) onSuccess();
    } else {
      setError('Submission failed. Please check your network connection and try again.');
    }
    setLoading(false);
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

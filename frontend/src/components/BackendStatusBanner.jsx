import React, { useState, useEffect } from 'react';
import { getApiUrl } from '../config';
import { RefreshCw, Server, AlertCircle, CheckCircle2 } from 'lucide-react';
import './BackendStatusBanner.css';

export default function BackendStatusBanner() {
  const [status, setStatus] = useState('checking'); // 'checking' | 'waking' | 'connected' | 'error'
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    let isMounted = true;
    let timer = null;

    const checkHealth = async () => {
      try {
        const healthUrl = getApiUrl('/api/health');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const res = await fetch(healthUrl, {
          signal: controller.signal,
          headers: { 'Accept': 'application/json' }
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          if (isMounted) {
            setStatus('connected');
          }
          return;
        }
      } catch (err) {
        // Fetch failed or timed out (backend is waking up)
      }

      if (isMounted) {
        setAttempts(prev => prev + 1);
        setStatus('waking');
        // Schedule retry
        timer = setTimeout(checkHealth, 3000);
      }
    };

    checkHealth();

    return () => {
      isMounted = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Hide banner completely when connected cleanly on initial attempt or after short check
  if (status === 'connected' || (status === 'checking' && attempts === 0)) {
    return null;
  }

  return (
    <div className={`backend-status-banner ${status}`}>
      <div className="status-content">
        {status === 'waking' && <RefreshCw className="spin-icon" size={16} />}
        {status === 'error' && <AlertCircle size={16} />}
        
        <span className="status-text">
          {status === 'waking' ? (
            <>
              <strong>Connecting to AnonHub server...</strong> Render backend is waking up (takes ~30s on free tier).
            </>
          ) : (
            <>
              <strong>Server connection issue.</strong> Retrying connection...
            </>
          )}
        </span>
      </div>
    </div>
  );
}

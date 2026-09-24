/**
 * @file FeatureRouteGuard.jsx
 * @description Route-level guard component to intercept direct URL access to disabled or maintenance features.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useFeatureAccess } from '../context/FeatureAccessContext';
import { AlertTriangle, Wrench, ArrowLeft, ShieldAlert } from 'lucide-react';

export default function FeatureRouteGuard({ 
  feature, 
  action = 'VIEW', 
  children 
}) {
  const navigate = useNavigate();
  const { can, getFeatureStatus, isFeatureEnabled, isFeatureVisible, loading } = useFeatureAccess();

  if (loading) {
    return <>{children}</>;
  }

  if (!feature) {
    return <>{children}</>;
  }

  const status = getFeatureStatus(feature);

  // If feature is in maintenance mode
  if (status.maintenance) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '70vh',
        padding: '24px',
        textAlign: 'center',
        fontFamily: 'var(--font-sans)'
      }}>
        <div style={{
          background: 'var(--card-bg, #111827)',
          border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
          borderRadius: '16px',
          padding: '40px 32px',
          maxWidth: '520px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px'
        }}>
          <div style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            background: 'rgba(245, 158, 11, 0.15)',
            color: '#f59e0b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Wrench size={28} />
          </div>

          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0, color: 'var(--text-color, #fff)' }}>
            Feature Under Maintenance
          </h2>

          <p style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '0.95rem', lineHeight: 1.5, margin: 0 }}>
            {status.maintenanceMessage}
          </p>

          <button
            onClick={() => navigate('/')}
            style={{
              marginTop: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 20px',
              borderRadius: '8px',
              background: 'var(--primary-color, #a93f55)',
              color: '#fff',
              border: 'none',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <ArrowLeft size={16} /> Return to Home
          </button>
        </div>
      </div>
    );
  }

  // If feature is disabled or unauthorized
  if (!can(feature, action)) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '70vh',
        padding: '24px',
        textAlign: 'center',
        fontFamily: 'var(--font-sans)'
      }}>
        <div style={{
          background: 'var(--card-bg, #111827)',
          border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
          borderRadius: '16px',
          padding: '40px 32px',
          maxWidth: '520px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px'
        }}>
          <div style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            background: 'rgba(239, 68, 68, 0.15)',
            color: '#ef4444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <ShieldAlert size={28} />
          </div>

          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0, color: 'var(--text-color, #fff)' }}>
            Feature Unavailable
          </h2>

          <p style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '0.95rem', lineHeight: 1.5, margin: 0 }}>
            The requested feature (<code>{feature}</code>) is currently disabled or restricted for your device/role.
          </p>

          <button
            onClick={() => navigate('/')}
            style={{
              marginTop: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 20px',
              borderRadius: '8px',
              background: 'var(--primary-color, #a93f55)',
              color: '#fff',
              border: 'none',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <ArrowLeft size={16} /> Return to Home
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * @file FeatureGuard.jsx
 * @description Declarative wrapper component to conditionally render UI elements based on feature flags,
 * device visibility, and role permissions.
 */

import React from 'react';
import { useFeatureAccess } from '../context/FeatureAccessContext';
import { AlertTriangle, Wrench } from 'lucide-react';

export default function FeatureGuard({
  feature,
  action = 'USE',
  fallback = null,
  showMaintenance = false,
  children
}) {
  const { can, getFeatureStatus } = useFeatureAccess();

  if (!feature) {
    return <>{children}</>;
  }

  const status = getFeatureStatus(feature);

  // If in maintenance mode and showMaintenance is enabled, show maintenance indicator
  if (status.maintenance && showMaintenance) {
    return (
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        borderRadius: '8px',
        background: 'rgba(245, 158, 11, 0.12)',
        border: '1px solid rgba(245, 158, 11, 0.3)',
        color: '#f59e0b',
        fontSize: '0.85rem',
        fontWeight: '600'
      }}>
        <Wrench size={14} />
        <span>{status.maintenanceMessage}</span>
      </div>
    );
  }

  // Check if permitted, enabled, and visible on current device
  if (can(feature, action)) {
    return <>{children}</>;
  }

  return fallback;
}

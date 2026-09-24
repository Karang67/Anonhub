/**
 * @file FeatureAccessContext.jsx
 * @description Centralized React Context & Hook for Feature Flags, Device Visibility, and RBAC Permissions.
 * Subscribes to backend configurations and updates in real-time over Socket.IO.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getApiUrl } from '../config';
import { initSocket, getCookie } from '../services/socket';

const FeatureAccessContext = createContext(null);

export function FeatureAccessProvider({ children }) {
  const [features, setFeatures] = useState(() => {
    try {
      const cached = sessionStorage.getItem('anonhub_feature_cache');
      return cached ? JSON.parse(cached) : {};
    } catch {
      return {};
    }
  });
  const [roles, setRoles] = useState(() => {
    try {
      const cached = sessionStorage.getItem('anonhub_role_cache');
      return cached ? JSON.parse(cached) : {};
    } catch {
      return {};
    }
  });
  const [loading, setLoading] = useState(() => {
    try {
      return !sessionStorage.getItem('anonhub_feature_cache');
    } catch {
      return true;
    }
  });
  const [deviceType, setDeviceType] = useState(() => getDeviceType());
  
  // Current active role for user session (USER by default, or ADMIN/custom role)
  const [currentRole, setCurrentRole] = useState(() => {
    try {
      return sessionStorage.getItem('anonhub-role') || getCookie('anonhub-role') || 'USER';
    } catch (e) {
      return 'USER';
    }
  });

  // Calculate current device type based on window width
  function getDeviceType() {
    if (typeof window === 'undefined') return 'desktop';
    const w = window.innerWidth;
    if (w < 768) return 'mobile';
    if (w <= 1024) return 'tablet';
    return 'desktop';
  }

  // Window resize listener to dynamically update deviceType
  useEffect(() => {
    const handleResize = () => {
      setDeviceType(getDeviceType());
    };
    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Fetch feature config and role permissions from backend
  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl('/api/features/config'));
      if (res.ok) {
        const data = await res.json();
        const nextFeatures = data.features || {};
        const nextRoles = data.roles || {};
        setFeatures(nextFeatures);
        setRoles(nextRoles);
        try {
          sessionStorage.setItem('anonhub_feature_cache', JSON.stringify(nextFeatures));
          sessionStorage.setItem('anonhub_role_cache', JSON.stringify(nextRoles));
        } catch {}
      }
    } catch (err) {
      console.warn('[FEATURE-ACCESS] Failed loading feature config, using cached/defaults:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch and real-time Socket.IO synchronization
  useEffect(() => {
    fetchConfig();

    // Listen for live updates broadcast from the admin dashboard
    const socket = initSocket();
    socket.on('feature-config-updated', () => {
      fetchConfig();
    });

    return () => {
      socket.off('feature-config-updated');
    };
  }, [fetchConfig]);

  // Switch role for test / session
  const setRole = useCallback((newRole) => {
    const r = String(newRole).toUpperCase();
    setCurrentRole(r);
    try {
      sessionStorage.setItem('anonhub-role', r);
      document.cookie = `anonhub-role=${r}; path=/; SameSite=Lax`;
    } catch (e) {}
  }, []);

  /**
   * Evaluates if a feature is enabled globally and all its ancestor modules are enabled.
   */
  const isFeatureEnabled = useCallback((featureKey) => {
    if (!featureKey) return true;
    const key = featureKey.toLowerCase();
    const feat = features[key];
    
    // If not configured, default to true for non-breaking behavior
    if (!feat) return true;

    if (!feat.enabled || feat.status === 'disabled') {
      return false;
    }

    // Check parent hierarchy
    if (feat.parentKey && feat.parentKey !== key) {
      return isFeatureEnabled(feat.parentKey);
    }

    return true;
  }, [features]);

  /**
   * Evaluates if a feature is visible for the current device and UI state.
   */
  const isFeatureVisible = useCallback((featureKey) => {
    if (!featureKey) return true;
    const key = featureKey.toLowerCase();
    const feat = features[key];

    if (!isFeatureEnabled(key)) return false;
    if (!feat) return true;

    if (!feat.visible) return false;

    // Check device rules
    if (feat.devices && feat.devices[deviceType] === false) {
      return false;
    }

    // Check parent visibility
    if (feat.parentKey && feat.parentKey !== key) {
      return isFeatureVisible(feat.parentKey);
    }

    return true;
  }, [features, deviceType, isFeatureEnabled]);

  /**
   * Evaluates if the current user has permission to perform a specific action on a feature.
   */
  const can = useCallback((featureKey, action = 'USE') => {
    if (!featureKey) return true;
    const key = featureKey.toLowerCase();
    
    // Feature must be enabled and visible
    if (!isFeatureEnabled(key)) return false;
    if (!isFeatureVisible(key)) return false;

    // Super Admin, Admin, and Developer bypass role checks
    const roleUpper = currentRole.toUpperCase();
    if (roleUpper === 'SUPER_ADMIN' || roleUpper === 'ADMIN' || roleUpper === 'DEVELOPER') {
      return true;
    }

    const roleDoc = roles[roleUpper];
    if (!roleDoc || !roleDoc.permissions) {
      // Default to allowed for standard USER if no strict matrix set
      return roleUpper !== 'GUEST';
    }

    const allowed = roleDoc.permissions[key] || roleDoc.permissions[key.split('.')[0]] || [];
    return allowed.includes(action.toUpperCase()) || allowed.includes('ADMIN');
  }, [currentRole, roles, isFeatureEnabled, isFeatureVisible]);

  /**
   * Retrieves full status details for a feature (including maintenance message).
   */
  const getFeatureStatus = useCallback((featureKey) => {
    if (!featureKey) return { enabled: true, visible: true, status: 'active', maintenance: false };
    const key = featureKey.toLowerCase();
    const feat = features[key] || {};
    const enabled = isFeatureEnabled(key);
    const visible = isFeatureVisible(key);
    const isMaintenance = feat.status === 'maintenance';

    return {
      key,
      name: feat.name || key,
      enabled,
      visible,
      status: feat.status || 'active',
      maintenance: isMaintenance,
      maintenanceMessage: feat.maintenanceMessage || 'This feature is temporarily undergoing maintenance.',
      isDeviceAllowed: feat.devices ? (feat.devices[deviceType] !== false) : true
    };
  }, [features, isFeatureEnabled, isFeatureVisible, deviceType]);

  const value = {
    features,
    roles,
    loading,
    deviceType,
    currentRole,
    setRole,
    can,
    isFeatureEnabled,
    isFeatureVisible,
    getFeatureStatus,
    refreshConfig: fetchConfig
  };

  return (
    <FeatureAccessContext.Provider value={value}>
      {children}
    </FeatureAccessContext.Provider>
  );
}

/**
 * Custom hook to consume the Feature Access & RBAC Context.
 */
export function useFeatureAccess() {
  const context = useContext(FeatureAccessContext);
  if (!context) {
    throw new Error('useFeatureAccess must be used within a FeatureAccessProvider');
  }
  return context;
}

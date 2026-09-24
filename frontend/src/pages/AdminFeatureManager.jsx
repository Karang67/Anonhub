/**
 * @file AdminFeatureManager.jsx
 * @description Centralized Feature Management & RBAC Administrator Dashboard.
 * Allows authorized admins and developers to manage feature flags, device rules (Desktop, Tablet, Mobile),
 * role permission matrices, maintenance modes, and audit trails without source code changes.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { 
  Sliders, Shield, Users, History, Plus, Search, Filter, 
  Check, X, Wrench, AlertTriangle, Monitor, Tablet, Smartphone, 
  Trash2, Edit3, Save, RefreshCw, ChevronDown, ChevronRight, Lock, 
  Globe, Power, MessageSquare, ArrowLeft, Download, Upload
} from 'lucide-react';
import { getApiUrl } from '../config';
import { useFeatureAccess } from '../context/FeatureAccessContext';
import './AdminFeatureManager.css';

const PERMISSION_ACTIONS = ['VIEW', 'USE', 'CREATE', 'UPDATE', 'DELETE', 'SHARE', 'EXPORT', 'MANAGE'];

export default function AdminFeatureManager() {
  const navigate = useNavigate();
  const { currentRole, setRole, refreshConfig } = useFeatureAccess();

  // Tab state: 'features' | 'matrix' | 'roles' | 'audit' | 'killswitch'
  const [activeTab, setActiveTab] = useState('features');

  const [features, setFeatures] = useState([]);
  const [roles, setRoles] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toastMsg, setToastMsg] = useState(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModule, setSelectedModule] = useState('all');
  const [collapsedModules, setCollapsedModules] = useState({});

  // Configure Modal State
  const [configuringFeature, setConfiguringFeature] = useState(null);
  const [editForm, setEditForm] = useState(null);

  // New Feature Modal State
  const [showAddFeatureModal, setShowAddFeatureModal] = useState(false);
  const [newFeatureForm, setNewFeatureForm] = useState({
    key: '',
    name: '',
    description: '',
    module: 'chat',
    parentKey: '',
    status: 'active',
    enabled: true,
    visible: true,
    devices: { desktop: true, tablet: true, mobile: true }
  });

  // New Role Modal State
  const [showAddRoleModal, setShowAddRoleModal] = useState(false);
  const [newRoleForm, setNewRoleForm] = useState({
    role: '',
    displayName: '',
    description: ''
  });

  // Toast Helper
  const showToast = (text, type = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3000);
  };

  // Load Admin Data
  const loadAdminData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [featRes, roleRes, auditRes] = await Promise.all([
        fetch(getApiUrl('/api/admin/features'), { credentials: 'include' }),
        fetch(getApiUrl('/api/admin/roles'), { credentials: 'include' }),
        fetch(getApiUrl('/api/admin/audit-logs'), { credentials: 'include' })
      ]);

      if (featRes.status === 403 || roleRes.status === 403) {
        navigate('/admin/login');
        return;
      }

      if (!featRes.ok || !roleRes.ok) {
        throw new Error('Failed loading feature management data.');
      }

      const featData = await featRes.json();
      const roleData = await roleRes.json();
      const auditData = auditRes.ok ? await auditRes.json() : { logs: [] };

      setFeatures(featData);
      setRoles(roleData);
      setAuditLogs(auditData.logs || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  // Distinct Modules List
  const modulesList = useMemo(() => {
    const set = new Set();
    features.forEach(f => set.add(f.module));
    return Array.from(set);
  }, [features]);

  // Group Features by Module
  const groupedFeatures = useMemo(() => {
    const map = {};
    features.forEach(f => {
      if (selectedModule !== 'all' && f.module !== selectedModule) return;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matches = f.name.toLowerCase().includes(q) || f.key.toLowerCase().includes(q) || f.module.toLowerCase().includes(q);
        if (!matches) return;
      }

      if (!map[f.module]) map[f.module] = [];
      map[f.module].push(f);
    });
    return map;
  }, [features, selectedModule, searchQuery]);

  // Toggle Module Collapse
  const toggleCollapse = (mod) => {
    setCollapsedModules(prev => ({ ...prev, [mod]: !prev[mod] }));
  };

  // Quick Feature Toggle (Enabled, Desktop, Tablet, Mobile)
  const handleQuickToggle = async (feature, field, subField = null) => {
    try {
      const updated = { ...feature };
      if (subField) {
        updated.devices = { ...updated.devices, [subField]: !updated.devices[subField] };
      } else {
        updated[field] = !updated[field];
      }

      // Optimistic update
      setFeatures(prev => prev.map(f => f.key === feature.key ? updated : f));

      const res = await fetch(getApiUrl(`/api/admin/features/${feature.key}`), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });

      if (!res.ok) throw new Error('Failed to update feature');
      showToast(`Updated "${feature.name}"`);
      refreshConfig();
    } catch (err) {
      showToast(err.message, 'error');
      loadAdminData();
    }
  };

  // Status Dropdown Change (active / disabled / maintenance)
  const handleStatusChange = async (feature, newStatus) => {
    try {
      const updated = { ...feature, status: newStatus };
      setFeatures(prev => prev.map(f => f.key === feature.key ? updated : f));

      const res = await fetch(getApiUrl(`/api/admin/features/${feature.key}`), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });

      if (!res.ok) throw new Error('Failed to change status');
      showToast(`Status changed for "${feature.name}" to ${newStatus.toUpperCase()}`);
      refreshConfig();
    } catch (err) {
      showToast(err.message, 'error');
      loadAdminData();
    }
  };

  // Open Configure Modal
  const openConfigureModal = (feat) => {
    setConfiguringFeature(feat);
    setEditForm({
      ...feat,
      devices: { ...(feat.devices || { desktop: true, tablet: true, mobile: true }) }
    });
  };

  // Save Configured Feature
  const handleSaveConfiguredFeature = async (e) => {
    e.preventDefault();
    if (!editForm) return;
    setSaving(true);

    try {
      const res = await fetch(getApiUrl(`/api/admin/features/${editForm.key}`), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      });

      if (!res.ok) throw new Error('Failed saving feature configuration');
      const saved = await res.json();
      setFeatures(prev => prev.map(f => f.key === saved.key ? saved : f));
      setConfiguringFeature(null);
      showToast(`Saved configuration for "${saved.name}"`);
      refreshConfig();
      loadAdminData();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Create New Feature Key
  const handleCreateFeature = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(getApiUrl('/api/admin/features'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newFeatureForm)
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed creating feature');
      }

      setShowAddFeatureModal(false);
      setNewFeatureForm({
        key: '',
        name: '',
        description: '',
        module: 'chat',
        parentKey: '',
        status: 'active',
        enabled: true,
        visible: true,
        devices: { desktop: true, tablet: true, mobile: true }
      });
      showToast('New feature registered successfully!');
      loadAdminData();
      refreshConfig();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Export Complete Feature & RBAC Configuration Backup
  const handleExportConfigBackup = () => {
    try {
      const backup = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        features,
        roles
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `anonhub-feature-config-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Configuration exported to JSON file!');
    } catch (err) {
      showToast('Export failed', 'error');
    }
  };

  // Import / Restore Configuration JSON
  const handleImportConfigFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (!data.features && !data.roles) {
          throw new Error('Invalid configuration JSON format.');
        }

        setSaving(true);
        // Bulk update features
        if (Array.isArray(data.features)) {
          for (const feat of data.features) {
            await fetch(getApiUrl(`/api/admin/features/${feat.key}`), {
              method: 'PUT',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(feat)
            }).catch(() => {});
          }
        }

        // Bulk update roles
        if (Array.isArray(data.roles)) {
          for (const r of data.roles) {
            await fetch(getApiUrl(`/api/admin/roles/${r.role}`), {
              method: 'PUT',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(r)
            }).catch(() => {});
          }
        }

        showToast('Configuration successfully restored from backup!');
        loadAdminData();
        refreshConfig();
      } catch (err) {
        showToast(err.message || 'Failed to parse config file', 'error');
      } finally {
        setSaving(false);
      }
    };
    reader.readAsText(file);
  };

  // Bulk Enable / Disable for all features in a module
  const handleBulkToggleModule = async (moduleName, targetEnabled) => {
    const modFeatures = features.filter(f => f.module === moduleName);
    if (!confirm(`Are you sure you want to turn ${targetEnabled ? 'ON' : 'OFF'} all ${modFeatures.length} features in the ${moduleName.toUpperCase()} module?`)) return;

    // Optimistic update
    setFeatures(prev => prev.map(f => f.module === moduleName ? { ...f, enabled: targetEnabled } : f));

    try {
      for (const feat of modFeatures) {
        await fetch(getApiUrl(`/api/admin/features/${feat.key}`), {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...feat, enabled: targetEnabled })
        });
      }
      showToast(`All ${moduleName} features set to ${targetEnabled ? 'ENABLED' : 'DISABLED'}`);
      refreshConfig();
    } catch (err) {
      showToast('Error during bulk update', 'error');
      loadAdminData();
    }
  };

  // Delete Custom Feature
  const handleDeleteFeature = async (featureKey) => {
    if (!confirm(`Are you sure you want to permanently delete feature "${featureKey}"?`)) return;
    try {
      const res = await fetch(getApiUrl(`/api/admin/features/${featureKey}`), {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed deleting feature');
      }
      showToast(`Feature "${featureKey}" deleted.`);
      loadAdminData();
      refreshConfig();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Toggle Matrix Permission Checkbox
  const handleToggleMatrixPermission = async (roleName, featureKey, action) => {
    const roleDoc = roles.find(r => r.role === roleName);
    if (!roleDoc) return;

    const currentPerms = { ...(roleDoc.permissions || {}) };
    const allowed = Array.from(currentPerms[featureKey] || []);
    
    let nextAllowed;
    if (allowed.includes(action)) {
      nextAllowed = allowed.filter(a => a !== action);
    } else {
      nextAllowed = [...allowed, action];
    }
    currentPerms[featureKey] = nextAllowed;

    // Optimistic state
    setRoles(prev => prev.map(r => r.role === roleName ? { ...r, permissions: currentPerms } : r));

    try {
      const res = await fetch(getApiUrl(`/api/admin/roles/${roleName}`), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: currentPerms })
      });
      if (!res.ok) throw new Error();
      showToast(`Updated ${roleName} permission for ${featureKey}`);
      refreshConfig();
    } catch (err) {
      showToast('Failed to update permission matrix', 'error');
      loadAdminData();
    }
  };

  // Create Role
  const handleCreateRole = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(getApiUrl('/api/admin/roles'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRoleForm)
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed creating role');
      }
      setShowAddRoleModal(false);
      setNewRoleForm({ role: '', displayName: '', description: '' });
      showToast('Custom role created!');
      loadAdminData();
      refreshConfig();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="admin-fm-page">
      {/* Toast Notification */}
      {toastMsg && (
        <div className={`fm-toast ${toastMsg.type}`}>
          {toastMsg.type === 'error' ? <AlertTriangle size={16} /> : <Check size={16} />}
          <span>{toastMsg.text}</span>
        </div>
      )}

      {/* Header Bar */}
      <header className="fm-header">
        <div className="fm-header-left">
          <button onClick={() => navigate('/admin/feedback')} className="fm-back-btn" title="Back to Admin Area">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="fm-title">Feature Management & Access Control</h1>
            <p className="fm-subtitle">Centralized control for features, device visibility (Desktop/Tablet/Mobile), and RBAC matrices.</p>
          </div>
        </div>

        <div className="fm-header-actions">
          {/* Active Testing Role Selector */}
          <div className="fm-role-selector-wrap" title="Simulate application role preview">
            <span className="fm-role-label">Preview Role:</span>
            <select 
              value={currentRole} 
              onChange={(e) => {
                setRole(e.target.value);
                showToast(`Switched active test role to ${e.target.value}`);
              }}
              className="fm-role-select"
            >
              {roles.map(r => (
                <option key={r.role} value={r.role}>{r.displayName} ({r.role})</option>
              ))}
            </select>
          </div>

          <button onClick={handleExportConfigBackup} className="fm-btn-secondary" title="Export Configuration JSON Backup">
            <Download size={14} /> <span>Export JSON</span>
          </button>

          <label className="fm-btn-secondary" style={{ cursor: 'pointer', margin: 0 }} title="Restore Configuration from JSON File">
            <Upload size={14} /> <span>Import JSON</span>
            <input 
              type="file" 
              accept=".json" 
              onChange={handleImportConfigFile} 
              style={{ display: 'none' }} 
            />
          </label>

          <button onClick={loadAdminData} className="fm-btn-secondary" title="Refresh all configurations">
            <RefreshCw size={14} className={loading ? 'spinning' : ''} /> <span>Refresh</span>
          </button>

          <button onClick={() => setShowAddFeatureModal(true)} className="fm-btn-primary">
            <Plus size={15} /> <span>New Feature</span>
          </button>
        </div>
      </header>

      {/* Navigation Sub-Tabs */}
      <div className="fm-nav-tabs">
        <button 
          className={`fm-tab-btn ${activeTab === 'features' ? 'active' : ''}`}
          onClick={() => setActiveTab('features')}
        >
          <Sliders size={15} /> <span>Feature Controls</span>
        </button>

        <button 
          className={`fm-tab-btn ${activeTab === 'matrix' ? 'active' : ''}`}
          onClick={() => setActiveTab('matrix')}
        >
          <Shield size={15} /> <span>Role Permission Matrix</span>
        </button>

        <button 
          className={`fm-tab-btn ${activeTab === 'roles' ? 'active' : ''}`}
          onClick={() => setActiveTab('roles')}
        >
          <Users size={15} /> <span>Role Definitions</span>
        </button>

        <button 
          className={`fm-tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => setActiveTab('audit')}
        >
          <History size={15} /> <span>Audit Trail Logs ({auditLogs.length})</span>
        </button>

        <button 
          className={`fm-tab-btn ${activeTab === 'killswitch' ? 'active' : ''}`}
          onClick={() => setActiveTab('killswitch')}
        >
          <Power size={15} /> <span>Global Kill Switches</span>
        </button>
      </div>

      {loading && <div className="fm-loading-banner"><RefreshCw size={18} className="spinning" /> Loading registry data...</div>}
      {error && <div className="fm-error-banner"><AlertTriangle size={18} /> {error}</div>}

      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 1: FEATURE CONTROLS */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'features' && !loading && (
        <section className="fm-tab-content">
          {/* Filter / Search Bar */}
          <div className="fm-search-strip">
            <div className="fm-search-input-wrap">
              <Search size={16} className="fm-search-icon" />
              <input
                type="text"
                placeholder="Search features by name, key, or module..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="fm-search-input"
              />
            </div>

            <div className="fm-module-filter-wrap">
              <Filter size={15} />
              <select 
                value={selectedModule} 
                onChange={(e) => setSelectedModule(e.target.value)}
                className="fm-module-select"
              >
                <option value="all">All Modules ({features.length})</option>
                {modulesList.map(m => (
                  <option key={m} value={m}>{m.toUpperCase()} ({features.filter(f => f.module === m).length})</option>
                ))}
              </select>
            </div>
          </div>

          {/* Grouped Feature Sections */}
          <div className="fm-modules-container">
            {Object.keys(groupedFeatures).length === 0 ? (
              <div className="fm-empty-state">No matching features found in registry.</div>
            ) : (
              Object.entries(groupedFeatures).map(([modName, modFeatures]) => {
                const isCollapsed = collapsedModules[modName];
                const activeCount = modFeatures.filter(f => f.enabled && f.status === 'active').length;

                return (
                  <div key={modName} className="fm-module-card">
                    <div className="fm-module-header" onClick={() => toggleCollapse(modName)}>
                      <div className="fm-module-title-group">
                        <span className="fm-collapse-icon">{isCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}</span>
                        <h3 className="fm-module-name">{modName.toUpperCase()} MODULE</h3>
                        <span className="fm-module-count">{activeCount} / {modFeatures.length} Active</span>
                      </div>

                      <div className="fm-module-header-actions" onClick={(e) => e.stopPropagation()}>
                        <button 
                          type="button"
                          className="fm-bulk-btn enable"
                          onClick={() => handleBulkToggleModule(modName, true)}
                          title={`Enable all ${modName} features`}
                        >
                          Enable All
                        </button>
                        <button 
                          type="button"
                          className="fm-bulk-btn disable"
                          onClick={() => handleBulkToggleModule(modName, false)}
                          title={`Disable all ${modName} features`}
                        >
                          Disable All
                        </button>

                        <span className="fm-device-legend">
                          <Monitor size={14} title="Desktop" />
                          <Tablet size={14} title="Tablet" />
                          <Smartphone size={14} title="Mobile" />
                        </span>
                      </div>
                    </div>

                    {!isCollapsed && (
                      <div className="fm-table-wrap">
                        <table className="fm-table">
                          <thead>
                            <tr>
                              <th style={{ width: '28%' }}>Feature</th>
                              <th style={{ width: '16%' }}>Key</th>
                              <th style={{ width: '14%' }}>Status</th>
                              <th style={{ width: '8%', textAlign: 'center' }}>Global</th>
                              <th style={{ width: '6%', textAlign: 'center' }} title="Desktop Visibility"><Monitor size={14} /></th>
                              <th style={{ width: '6%', textAlign: 'center' }} title="Tablet Visibility"><Tablet size={14} /></th>
                              <th style={{ width: '6%', textAlign: 'center' }} title="Mobile Visibility"><Smartphone size={14} /></th>
                              <th style={{ width: '16%', textAlign: 'right' }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {modFeatures.map(feat => {
                              const isChild = Boolean(feat.parentKey);

                              return (
                                <tr key={feat.key} className={`fm-row ${!feat.enabled ? 'disabled-row' : ''} ${feat.status === 'maintenance' ? 'maintenance-row' : ''}`}>
                                  <td>
                                    <div className="fm-feat-name-cell" style={{ paddingLeft: isChild ? '24px' : '0' }}>
                                      {isChild && <span className="fm-child-arrow">↳</span>}
                                      <div>
                                        <div className="fm-feat-name">{feat.name}</div>
                                        {feat.description && <div className="fm-feat-desc">{feat.description}</div>}
                                      </div>
                                    </div>
                                  </td>

                                  <td>
                                    <code className="fm-feat-key">{feat.key}</code>
                                  </td>

                                  <td>
                                    <select 
                                      value={feat.status || 'active'} 
                                      onChange={(e) => handleStatusChange(feat, e.target.value)}
                                      className={`fm-status-select ${feat.status}`}
                                    >
                                      <option value="active">Active</option>
                                      <option value="disabled">Disabled</option>
                                      <option value="maintenance">Maintenance</option>
                                    </select>
                                  </td>

                                  <td style={{ textAlign: 'center' }}>
                                    <label className="fm-switch">
                                      <input 
                                        type="checkbox" 
                                        checked={feat.enabled} 
                                        onChange={() => handleQuickToggle(feat, 'enabled')}
                                      />
                                      <span className="fm-slider round" />
                                    </label>
                                  </td>

                                  <td style={{ textAlign: 'center' }}>
                                    <input 
                                      type="checkbox" 
                                      checked={feat.devices?.desktop !== false} 
                                      onChange={() => handleQuickToggle(feat, 'devices', 'desktop')}
                                      className="fm-device-check"
                                    />
                                  </td>

                                  <td style={{ textAlign: 'center' }}>
                                    <input 
                                      type="checkbox" 
                                      checked={feat.devices?.tablet !== false} 
                                      onChange={() => handleQuickToggle(feat, 'devices', 'tablet')}
                                      className="fm-device-check"
                                    />
                                  </td>

                                  <td style={{ textAlign: 'center' }}>
                                    <input 
                                      type="checkbox" 
                                      checked={feat.devices?.mobile !== false} 
                                      onChange={() => handleQuickToggle(feat, 'devices', 'mobile')}
                                      className="fm-device-check"
                                    />
                                  </td>

                                  <td style={{ textAlign: 'right' }}>
                                    <div className="fm-actions-cell">
                                      <button 
                                        onClick={() => openConfigureModal(feat)}
                                        className="fm-btn-configure"
                                        title="Configure deep permissions and maintenance message"
                                      >
                                        <Edit3 size={13} /> Configure
                                      </button>

                                      {!feat.isSystem && (
                                        <button 
                                          onClick={() => handleDeleteFeature(feat.key)}
                                          className="fm-btn-delete"
                                          title="Delete custom feature"
                                        >
                                          <Trash2 size={13} />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 2: ROLE PERMISSION MATRIX */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'matrix' && !loading && (
        <section className="fm-tab-content">
          <div className="fm-matrix-note">
            Click on permissions to toggle access per role. Changes apply immediately across the entire workspace.
          </div>

          <div className="fm-table-wrap fm-matrix-table-wrap">
            <table className="fm-table fm-matrix-table">
              <thead>
                <tr>
                  <th style={{ minWidth: '220px' }}>Feature Key</th>
                  {roles.map(r => (
                    <th key={r.role} style={{ minWidth: '150px', textAlign: 'center' }}>
                      <div className="fm-matrix-role-header">
                        <span>{r.displayName}</span>
                        <code className="fm-matrix-role-sub">{r.role}</code>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {features.map(feat => (
                  <tr key={feat.key}>
                    <td>
                      <div className="fm-feat-name">{feat.name}</div>
                      <code className="fm-feat-key">{feat.key}</code>
                    </td>

                    {roles.map(r => {
                      const isSuper = r.role === 'SUPER_ADMIN' || r.role === 'ADMIN' || r.role === 'DEVELOPER';
                      const allowed = isSuper ? PERMISSION_ACTIONS : (r.permissions?.[feat.key] || []);

                      return (
                        <td key={r.role} style={{ textAlign: 'center' }}>
                          <div className="fm-perm-pills-row">
                            {PERMISSION_ACTIONS.slice(0, 4).map(action => {
                              const isChecked = allowed.includes(action);
                              return (
                                <button
                                  key={action}
                                  disabled={isSuper}
                                  onClick={() => handleToggleMatrixPermission(r.role, feat.key, action)}
                                  className={`fm-perm-pill ${isChecked ? 'active' : ''} ${isSuper ? 'locked' : ''}`}
                                  title={isSuper ? 'Locked for Admin Role' : `${action} permission for ${r.displayName}`}
                                >
                                  {action}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 3: ROLE DEFINITIONS */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'roles' && !loading && (
        <section className="fm-tab-content">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <p className="fm-matrix-note" style={{ margin: 0 }}>Manage user roles and authorization hierarchies.</p>
            <button onClick={() => setShowAddRoleModal(true)} className="fm-btn-primary">
              <Plus size={14} /> Add Custom Role
            </button>
          </div>

          <div className="fm-roles-grid">
            {roles.map(r => (
              <div key={r.role} className="fm-role-card">
                <div className="fm-role-card-header">
                  <div className="fm-role-icon-box">
                    <Shield size={20} />
                  </div>
                  <div>
                    <h3 className="fm-role-title">{r.displayName}</h3>
                    <code className="fm-role-code">{r.role}</code>
                  </div>
                  {r.isSystem && <span className="fm-sys-badge">SYSTEM</span>}
                </div>

                <p className="fm-role-desc">{r.description || 'Standard role permissions.'}</p>

                <div className="fm-role-footer">
                  <span className="fm-role-perm-count">
                    {r.role === 'SUPER_ADMIN' ? 'ALL PERMISSIONS' : `${Object.keys(r.permissions || {}).length} configured features`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 4: AUDIT TRAIL LOGS */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'audit' && !loading && (
        <section className="fm-tab-content">
          <div className="fm-table-wrap">
            <table className="fm-table">
              <thead>
                <tr>
                  <th style={{ width: '18%' }}>Timestamp</th>
                  <th style={{ width: '16%' }}>Actor</th>
                  <th style={{ width: '18%' }}>Action</th>
                  <th style={{ width: '16%' }}>Target</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: '30px' }}>No audit history records found yet.</td></tr>
                ) : (
                  auditLogs.map((logItem, idx) => (
                    <tr key={logItem._id || idx}>
                      <td>{new Date(logItem.createdAt).toLocaleString()}</td>
                      <td><strong>{logItem.actor}</strong></td>
                      <td><span className="fm-action-badge">{logItem.action}</span></td>
                      <td><code>{logItem.targetKey}</code></td>
                      <td className="fm-log-details">{logItem.details || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 5: GLOBAL EMERGENCY KILL SWITCHES */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'killswitch' && !loading && (
        <section className="fm-tab-content">
          <div className="fm-killswitch-warning">
            <AlertTriangle size={20} />
            <div>
              <strong>Emergency Kill Switches</strong>
              <p>Disabling a top-level module instantly shuts down all its child features, routes, and APIs across all users.</p>
            </div>
          </div>

          <div className="fm-killswitch-grid">
            {features.filter(f => !f.parentKey).map(rootFeat => (
              <div key={rootFeat.key} className={`fm-killswitch-card ${!rootFeat.enabled ? 'killed' : ''}`}>
                <div className="fm-ks-header">
                  <h3 className="fm-ks-title">{rootFeat.name}</h3>
                  <code className="fm-ks-key">{rootFeat.key}</code>
                </div>

                <p className="fm-ks-desc">{rootFeat.description}</p>

                <div className="fm-ks-action">
                  <button 
                    onClick={() => handleQuickToggle(rootFeat, 'enabled')}
                    className={`fm-ks-btn ${rootFeat.enabled ? 'btn-active' : 'btn-disabled'}`}
                  >
                    <Power size={15} />
                    <span>{rootFeat.enabled ? 'MODULE ENABLED' : 'MODULE DISABLED (KILLED)'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* CONFIGURE MODAL */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {configuringFeature && editForm && (
        <div className="fm-modal-backdrop" onClick={() => setConfiguringFeature(null)}>
          <div className="fm-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="fm-modal-header">
              <div className="fm-modal-title">
                <Sliders size={18} />
                <span>Configure Feature: {configuringFeature.name}</span>
              </div>
              <button className="fm-modal-close" onClick={() => setConfiguringFeature(null)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveConfiguredFeature}>
              <div className="fm-modal-body">
                <div className="fm-form-group">
                  <label>Display Name</label>
                  <input 
                    type="text" 
                    value={editForm.name} 
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    required
                  />
                </div>

                <div className="fm-form-group">
                  <label>Description</label>
                  <input 
                    type="text" 
                    value={editForm.description || ''} 
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  />
                </div>

                <div className="fm-form-row">
                  <div className="fm-form-group">
                    <label>Global Status</label>
                    <select 
                      value={editForm.status} 
                      onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                    >
                      <option value="active">Active (Normal)</option>
                      <option value="disabled">Disabled (Hidden / Blocked)</option>
                      <option value="maintenance">Maintenance Mode</option>
                    </select>
                  </div>

                  <div className="fm-form-group">
                    <label>Enabled Switch</label>
                    <div style={{ marginTop: '8px' }}>
                      <label className="fm-switch">
                        <input 
                          type="checkbox" 
                          checked={editForm.enabled} 
                          onChange={(e) => setEditForm({ ...editForm, enabled: e.target.checked })}
                        />
                        <span className="fm-slider round" />
                      </label>
                    </div>
                  </div>
                </div>

                {editForm.status === 'maintenance' && (
                  <div className="fm-form-group">
                    <label>Custom Maintenance Message</label>
                    <textarea 
                      rows={2}
                      value={editForm.maintenanceMessage || ''}
                      onChange={(e) => setEditForm({ ...editForm, maintenanceMessage: e.target.value })}
                    />
                  </div>
                )}

                {/* Device Access Checkboxes */}
                <div className="fm-form-group">
                  <label>Supported Device Platforms</label>
                  <div className="fm-devices-checklist">
                    <label className="fm-check-label">
                      <input 
                        type="checkbox" 
                        checked={editForm.devices?.desktop !== false}
                        onChange={(e) => setEditForm({
                          ...editForm,
                          devices: { ...editForm.devices, desktop: e.target.checked }
                        })}
                      />
                      <Monitor size={15} /> Desktop
                    </label>

                    <label className="fm-check-label">
                      <input 
                        type="checkbox" 
                        checked={editForm.devices?.tablet !== false}
                        onChange={(e) => setEditForm({
                          ...editForm,
                          devices: { ...editForm.devices, tablet: e.target.checked }
                        })}
                      />
                      <Tablet size={15} /> Tablet
                    </label>

                    <label className="fm-check-label">
                      <input 
                        type="checkbox" 
                        checked={editForm.devices?.mobile !== false}
                        onChange={(e) => setEditForm({
                          ...editForm,
                          devices: { ...editForm.devices, mobile: e.target.checked }
                        })}
                      />
                      <Smartphone size={15} /> Mobile
                    </label>
                  </div>
                </div>
              </div>

              <div className="fm-modal-footer">
                <button type="button" className="fm-btn-secondary" onClick={() => setConfiguringFeature(null)}>
                  Cancel
                </button>
                <button type="submit" className="fm-btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* NEW FEATURE MODAL */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {showAddFeatureModal && (
        <div className="fm-modal-backdrop" onClick={() => setShowAddFeatureModal(false)}>
          <div className="fm-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="fm-modal-header">
              <div className="fm-modal-title">
                <Plus size={18} />
                <span>Register New Feature Key</span>
              </div>
              <button className="fm-modal-close" onClick={() => setShowAddFeatureModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateFeature}>
              <div className="fm-modal-body">
                <div className="fm-form-group">
                  <label>Feature Key (e.g. <code>chat.polls</code>, <code>dashboard.analytics</code>)</label>
                  <input 
                    type="text" 
                    placeholder="module.feature_name"
                    value={newFeatureForm.key}
                    onChange={(e) => setNewFeatureForm({ ...newFeatureForm, key: e.target.value })}
                    required
                  />
                </div>

                <div className="fm-form-group">
                  <label>Display Name</label>
                  <input 
                    type="text" 
                    placeholder="Feature Name"
                    value={newFeatureForm.name}
                    onChange={(e) => setNewFeatureForm({ ...newFeatureForm, name: e.target.value })}
                    required
                  />
                </div>

                <div className="fm-form-row">
                  <div className="fm-form-group">
                    <label>Module</label>
                    <input 
                      type="text" 
                      placeholder="chat, project, officeboard..."
                      value={newFeatureForm.module}
                      onChange={(e) => setNewFeatureForm({ ...newFeatureForm, module: e.target.value })}
                      required
                    />
                  </div>

                  <div className="fm-form-group">
                    <label>Parent Key (Optional)</label>
                    <input 
                      type="text" 
                      placeholder="e.g. chat"
                      value={newFeatureForm.parentKey}
                      onChange={(e) => setNewFeatureForm({ ...newFeatureForm, parentKey: e.target.value })}
                    />
                  </div>
                </div>

                <div className="fm-form-group">
                  <label>Description</label>
                  <input 
                    type="text" 
                    placeholder="Brief description of the feature"
                    value={newFeatureForm.description}
                    onChange={(e) => setNewFeatureForm({ ...newFeatureForm, description: e.target.value })}
                  />
                </div>
              </div>

              <div className="fm-modal-footer">
                <button type="button" className="fm-btn-secondary" onClick={() => setShowAddFeatureModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="fm-btn-primary" disabled={saving}>
                  {saving ? 'Registering...' : 'Register Feature'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* NEW ROLE MODAL */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {showAddRoleModal && (
        <div className="fm-modal-backdrop" onClick={() => setShowAddRoleModal(false)}>
          <div className="fm-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="fm-modal-header">
              <div className="fm-modal-title">
                <Shield size={18} />
                <span>Create New Custom Role</span>
              </div>
              <button className="fm-modal-close" onClick={() => setShowAddRoleModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateRole}>
              <div className="fm-modal-body">
                <div className="fm-form-group">
                  <label>Role Identifier (e.g. <code>SUPPORT_AGENT</code>, <code>ANALYST</code>)</label>
                  <input 
                    type="text" 
                    placeholder="ROLE_NAME"
                    value={newRoleForm.role}
                    onChange={(e) => setNewRoleForm({ ...newRoleForm, role: e.target.value })}
                    required
                  />
                </div>

                <div className="fm-form-group">
                  <label>Display Name</label>
                  <input 
                    type="text" 
                    placeholder="Support Agent"
                    value={newRoleForm.displayName}
                    onChange={(e) => setNewRoleForm({ ...newRoleForm, displayName: e.target.value })}
                    required
                  />
                </div>

                <div className="fm-form-group">
                  <label>Description</label>
                  <input 
                    type="text" 
                    placeholder="Role responsibilities and access scope"
                    value={newRoleForm.description}
                    onChange={(e) => setNewRoleForm({ ...newRoleForm, description: e.target.value })}
                  />
                </div>
              </div>

              <div className="fm-modal-footer">
                <button type="button" className="fm-btn-secondary" onClick={() => setShowAddRoleModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="fm-btn-primary" disabled={saving}>
                  {saving ? 'Creating...' : 'Create Role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

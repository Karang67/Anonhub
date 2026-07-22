/**
 * @file PWAInstallPrompt.jsx
 * @description Progressive Web App (PWA) installation button and banner component.
 * Captures the browser's `beforeinstallprompt` event and provides a 1-click install button.
 * Includes iOS Safari detection with guidance for adding to Home Screen.
 */

import React, { useState, useEffect } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import './PWAInstallPrompt.css';

export default function PWAInstallPrompt({ variant = 'navbar' }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Detect standalone mode (already installed as PWA)
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
      setInstalled(true);
      return;
    }

    // Detect iOS Safari
    const ua = window.navigator.userAgent;
    const iosDevice = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    if (iosDevice && !window.navigator.standalone) {
      setIsIOS(true);
    }

    // Listen for browser PWA install event
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      setInstalled(true);
      setIsInstallable(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIOSModal(true);
      return;
    }

    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const choiceResult = await deferredPrompt.userChoice;
    if (choiceResult.outcome === 'accepted') {
      console.log('[PWA] User accepted the install prompt');
      setInstalled(true);
    }
    setDeferredPrompt(null);
    setIsInstallable(false);
  };

  if (installed || dismissed) return null;
  if (!isInstallable && !isIOS) return null;

  if (variant === 'banner') {
    return (
      <div className="pwa-banner">
        <div className="pwa-banner-content">
          <div className="pwa-banner-icon">
            <Smartphone size={20} />
          </div>
          <div className="pwa-banner-text">
            <strong>Install AnonHub App</strong>
            <span>Fast offline access, video calls &amp; instant desktop/mobile workspace</span>
          </div>
        </div>
        <div className="pwa-banner-actions">
          <button className="pwa-install-btn-main" onClick={handleInstallClick}>
            <Download size={14} /> Install App
          </button>
          <button className="pwa-close-btn" onClick={() => setDismissed(true)} title="Close banner">
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={handleInstallClick}
        className="pwa-nav-btn"
        title="Install AnonHub PWA Desktop/Mobile App"
      >
        <Download size={14} />
        <span className="btn-text">Install App</span>
      </button>

      {showIOSModal && (
        <div className="pwa-ios-modal-overlay" onClick={() => setShowIOSModal(false)}>
          <div className="pwa-ios-modal" onClick={e => e.stopPropagation()}>
            <button className="pwa-modal-close" onClick={() => setShowIOSModal(false)}><X size={16} /></button>
            <h3>Install AnonHub on iOS</h3>
            <p>To install AnonHub as an app on your iPhone or iPad:</p>
            <ol>
              <li>Tap the <strong>Share</strong> icon in Safari's bottom toolbar.</li>
              <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
              <li>Tap <strong>Add</strong> in the top-right corner.</li>
            </ol>
            <button className="pwa-ios-done-btn" onClick={() => setShowIOSModal(false)}>Got it</button>
          </div>
        </div>
      )}
    </>
  );
}

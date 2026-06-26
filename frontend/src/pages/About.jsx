/**
 * @file About.jsx
 * @description About Page component for AnonHub. Displays the platform's vision, core values,
 * technology stack details (Node.js, Socket.IO, etc.), and licensing information in a clean panel layout.
 */

import React from 'react';
import { Sparkles, Shield, Compass, Heart } from 'lucide-react';
import './About.css';

/**
 * About Page Component
 * Renders static descriptions detailing privacy features, synchronization mechanics,
 * and the developer-centric values of registration-free collaboration.
 */
export default function About() {
  return (
    <main className="page-container">
      {/* Page Title */}
      <h2 className="title-center">About AnonHub</h2>

      {/* Intro paragraph emphasizing privacy and ease of collaboration */}
      <p style={{ maxWidth: '800px', margin: '0 auto 40px', textAlignment: 'center', fontSize: '1.15rem', color: 'var(--text-muted)', lineHeight: '1.7', textAlign: 'center' }}>
        AnonHub is a free and open-source platform designed for anonymous, real-time collaboration. We believe that great ideas can come from anyone, anywhere — and everyone deserves a simple, private space to share and build together.
      </p>

      {/* Grid container showcasing key platform elements */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px', margin: '20px 0' }}>
        {/* Core Mission Panel */}
        <section className="panel-section">
          <h3>
            <Shield size={20} color="var(--primary-color)" />
            Our Mission
          </h3>
          <p>
            To provide a minimalist, registration-free environment for creative collaboration. We value <strong>privacy</strong>, <strong>simplicity</strong>, and <strong>efficiency</strong> above all else. No user tracking, no profiles, just work.
          </p>
        </section>

        {/* Tech Stack and Mechanics Panel */}
        <section className="panel-section">
          <h3>
            <Compass size={20} color="var(--secondary-color)" />
            How It Works
          </h3>
          <p>
            AnonHub uses modern web technologies like <strong>Node.js</strong> and <strong>Socket.IO</strong> to enable live, instantaneous communication. All project data is stored in a database for persistence, while users are identified only by randomly generated names — ensuring complete anonymity.
          </p>
        </section>

        {/* Values and UX guidelines Panel */}
        <section className="panel-section">
          <h3>
            <Sparkles size={20} color="var(--primary-color)" />
            Core Values
          </h3>
          <p>
            We focus on clean interface design, responsive and lag-free editors, and zero-configuration setups. You don't need an account to whiteboard, write markdown, code, or chat. Just click, share, and build.
          </p>
        </section>
      </div>

      {/* Open Source Footer Panel */}
      <div className="panel-section" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginTop: '40px' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Heart size={20} color="#ff4d4f" fill="#ff4d4f" />
          Open Source and Free
        </h3>
        <p style={{ maxWidth: '600px' }}>
          AnonHub is developed by developers, for developers, writers, students, and teams worldwide. Contributions and feedback are welcome!
        </p>
      </div>
    </main>
  );
}


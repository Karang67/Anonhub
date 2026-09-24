/**
 * @file About.jsx
 * @description About Page for AnonHub — updated to reflect all current features.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Shield, Compass, Heart, Code2, Palette, MessageSquare, FileText, Upload, Clock, Trash2, Lock } from 'lucide-react';
import './About.css';

const FEATURES = [
    { icon: <MessageSquare size={18} color="var(--primary-color)" />, label: 'Real-time anonymous chat' },
    { icon: <FileText size={18} color="var(--secondary-color)" />, label: 'Collaborative rich text documents' },
    { icon: <Code2 size={18} color="var(--primary-color)" />, label: 'Coding board with live execution (JS, Python, C++, Java, TS)' },
    { icon: <Palette size={18} color="var(--secondary-color)" />, label: 'Interactive whiteboard (Fabric.js) with real-time sync' },
    { icon: <Upload size={18} color="var(--primary-color)" />, label: 'File sharing with per-room storage limits' },
    { icon: <Lock size={18} color="var(--secondary-color)" />, label: 'Secure code execution (sandboxed, resource-limited)' },
    { icon: <Clock size={18} color="var(--primary-color)" />, label: 'Automatic room expiration after 15 days of inactivity' },
    { icon: <Trash2 size={18} color="var(--secondary-color)" />, label: 'Owner-controlled permanent room deletion' },
    { icon: <Shield size={18} color="var(--primary-color)" />, label: 'bcrypt-hashed access keys — no plain-text passwords' },
];

export default function About() {
    return (
        <main className="page-container">
            <h2 className="title-center">About Trinetra</h2>

            <p style={{ maxWidth: '800px', margin: '0 auto 40px', fontSize: '1.15rem', color: 'var(--text-muted)', lineHeight: '1.7', textAlign: 'center' }}>
                Trinetra is a free, open-source platform for <strong>anonymous real-time collaboration</strong>. No accounts, no tracking — just create a room, share the link, and work together instantly.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px', margin: '20px 0' }}>
                <section className="panel-section">
                    <h3><Shield size={20} color="var(--primary-color)" /> Our Mission</h3>
                    <p>
                        To provide a minimalist, registration-free environment for creative collaboration. We value <strong>privacy</strong>, <strong>simplicity</strong>, and <strong>security</strong>. No user tracking, no profiles, no ads — just work.
                    </p>
                </section>

                <section className="panel-section">
                    <h3><Compass size={20} color="var(--secondary-color)" /> How It Works</h3>
                    <ol style={{ paddingLeft: '18px', margin: '8px 0', lineHeight: '1.8' }}>
                        <li>Open Trinetra and create a room.</li>
                        <li>Share the room name and access key privately.</li>
                        <li>Others join — everyone gets a random anonymous name.</li>
                        <li>Collaborate in real-time using chat, documents, code, or whiteboard.</li>
                        <li>The room auto-expires after 15 days without activity.</li>
                    </ol>
                </section>

                <section className="panel-section">
                    <h3><Sparkles size={20} color="var(--primary-color)" /> Core Values</h3>
                    <p>
                        Clean interface, responsive real-time editors, zero-configuration setup. No account means no barriers — open Trinetra, create a room, and start collaborating in under 30 seconds.
                    </p>
                </section>
            </div>

            {/* Feature list */}
            <section className="panel-section" style={{ marginTop: '24px' }}>
                <h3><Sparkles size={20} color="var(--primary-color)" /> What You Can Do</h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px' }}>
                    {FEATURES.map((f, i) => (
                        <li key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.93rem', color: 'var(--text-color)' }}>
                            {f.icon} {f.label}
                        </li>
                    ))}
                </ul>
            </section>

            {/* Tech stack */}
            <section className="panel-section" style={{ marginTop: '24px' }}>
                <h3><Code2 size={20} color="var(--secondary-color)" /> Technology</h3>
                <p style={{ lineHeight: '1.8' }}>
                    Trinetra is built with <strong>Node.js</strong> + <strong>Express</strong> (MVC architecture), <strong>Socket.IO</strong> for real-time sync, <strong>MongoDB/Mongoose</strong> for persistence, <strong>React + Vite</strong> on the frontend, <strong>Fabric.js</strong> for the collaborative whiteboard, <strong>Monaco Editor</strong> for the coding board, <strong>TinyMCE</strong> for the document editor, and <strong>WebRTC</strong> for peer-to-peer video calls.
                </p>
            </section>

            <div className="panel-section" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginTop: '32px' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Heart size={20} color="#ff4d4f" fill="#ff4d4f" /> Open Source & Free
                </h3>
                <p style={{ maxWidth: '600px' }}>
                    Trinetra is developed by developers, for developers, writers, students, and teams worldwide. Contributions and feedback are welcome!
                </p>
                <Link to="/guide" style={{ marginTop: '16px', display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 24px', borderRadius: '8px', background: 'var(--primary-color)', color: '#fff', textDecoration: 'none', fontWeight: 600, fontSize: '0.95rem', transition: 'opacity 0.2s' }}
                    onMouseOver={e => e.currentTarget.style.opacity = '0.85'}
                    onMouseOut={e => e.currentTarget.style.opacity = '1'}
                >
                    📖 Read the User Guide
                </Link>
            </div>
        </main>
    );
}

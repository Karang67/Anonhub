/**
 * @file AIChatBot.jsx
 * @description Floating AI Chatbot widget for Project workspace rooms.
 * Connects to the local /api/ai-chat endpoint to interact with Google Gemini AI.
 * Handles state tracking for open drawer, conversation message history, suggestions, and loading states.
 * Supports drag-and-drop repositioning via pointer events (mouse + touch).
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bot, X, Send, Sparkles, MessageCircle, RefreshCw } from 'lucide-react';
import './AIChatBot.css';

export default function AIChatBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'model',
      text: "👋 Hi! I'm your **AnonHub AI Copilot**. I can help you write code, debug layout alignment issues, draft document templates, or brainstorm project ideas. How can I help you today?"
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMockMode, setIsMockMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Drag position state — initialized from localStorage or defaults to CSS styling
  const getInitialPos = () => {
    try {
      const saved = localStorage.getItem('anonhub-ai-bot-pos');
      if (saved) {
        const { x, y } = JSON.parse(saved);
        // Clamp to viewport in case screen size changed
        const clampedX = Math.min(Math.max(x, 0), window.innerWidth - 64);
        const clampedY = Math.min(Math.max(y, 0), window.innerHeight - 64);
        return { x: clampedX, y: clampedY };
      }
    } catch (e) {}
    return null; // Fallback to CSS rules (bottom-right positioning)
  };

  const [pos, setPos] = useState(getInitialPos);

  const dragRef = useRef({ active: false, startX: 0, startY: 0, originX: 0, originY: 0 });
  const hasDraggedRef = useRef(false);
  const containerRef = useRef(null);
  const chatEndRef = useRef(null);

  // Scroll message thread to the bottom when messages or loading states change
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  // Save position to localStorage whenever it changes
  useEffect(() => {
    if (!pos) return;
    try {
      localStorage.setItem('anonhub-ai-bot-pos', JSON.stringify(pos));
    } catch (e) {}
  }, [pos]);

  // Clamp position relative to screen updates during viewport resizing
  useEffect(() => {
    const handleResize = () => {
      setPos(prev => {
        if (!prev) return null;
        const clampedX = Math.min(Math.max(prev.x, 0), window.innerWidth - 64);
        const clampedY = Math.min(Math.max(prev.y, 0), window.innerHeight - 64);
        return { x: clampedX, y: clampedY };
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ── Pointer drag handlers ──────────────────────────────────────────────────
  const onPointerDown = useCallback((e) => {
    // Only drag on the bubble button itself (ignore chat window clicks)
    if (e.target.closest('.ai-chatbot-window')) return;

    e.preventDefault();
    let currentX = pos ? pos.x : (window.innerWidth - 80);
    let currentY = pos ? pos.y : (window.innerHeight - 80);
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      currentX = rect.left;
      currentY = rect.top;
    }

    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      originX: currentX,
      originY: currentY
    };
    hasDraggedRef.current = false;

    setIsDragging(false);
    containerRef.current?.setPointerCapture(e.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((e) => {
    if (!dragRef.current.active) return;

    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;

    // Threshold: 5px to differentiate click from drag
    if (!hasDraggedRef.current && Math.hypot(dx, dy) > 5) {
      hasDraggedRef.current = true;
      setIsDragging(true);
    }

    if (!hasDraggedRef.current) return;

    const BUBBLE_SIZE = 64;
    const newX = Math.min(
      Math.max(dragRef.current.originX + dx, 0),
      window.innerWidth - BUBBLE_SIZE
    );
    const newY = Math.min(
      Math.max(dragRef.current.originY + dy, 0),
      window.innerHeight - BUBBLE_SIZE
    );

    setPos({ x: newX, y: newY });
  }, []);

  const onPointerUp = useCallback((e) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;

    if (!hasDraggedRef.current) {
      // It was a tap/click — toggle chat
      setIsOpen(prev => !prev);
    }

    setIsDragging(false);
    hasDraggedRef.current = false;
  }, []);

  // ── Chat window smart positioning ─────────────────────────────────────────
  // Flip the panel up/down and left/right based on where the bubble sits
  const BUBBLE_SIZE = 56;
  const WINDOW_W = 380;
  const WINDOW_H = 520;
  const MARGIN = 12;

  const activeX = pos ? pos.x : (window.innerWidth - 24 - BUBBLE_SIZE);
  const activeY = pos ? pos.y : (window.innerHeight - 24 - BUBBLE_SIZE);

  const openAbove = activeY + BUBBLE_SIZE + WINDOW_H + MARGIN > window.innerHeight;
  const openLeft  = activeX + WINDOW_W + MARGIN > window.innerWidth;

  const windowStyle = {
    position: 'fixed',
    width: Math.min(WINDOW_W, window.innerWidth - 24),
    height: Math.min(WINDOW_H, window.innerHeight * 0.75),
    ...(openAbove
      ? { bottom: window.innerHeight - activeY + MARGIN, top: 'auto' }
      : { top: activeY + BUBBLE_SIZE + MARGIN, bottom: 'auto' }),
    ...(openLeft
      ? { right: window.innerWidth - activeX - BUBBLE_SIZE, left: 'auto' }
      : { left: activeX, right: 'auto' }),
  };

  // ── AI messaging ──────────────────────────────────────────────────────────
  const handleSendMessage = async (textToSend) => {
    const text = textToSend || inputValue.trim();
    if (!text || isLoading) return;

    const updatedMessages = [...messages, { role: 'user', text }];
    setMessages(updatedMessages);
    setInputValue('');
    setIsLoading(true);

    const historyPayload = messages.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.text }]
    }));

    try {
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: historyPayload })
      });

      const data = await response.json();
      if (response.ok) {
        const reply = data.response || "No response received.";
        if (reply.includes('[AnonHub AI Assistant - Mock Mode]')) {
          setIsMockMode(true);
        } else {
          setIsMockMode(false);
        }
        setMessages(prev => [...prev, { role: 'model', text: reply }]);
      } else {
        setMessages(prev => [...prev, { role: 'model', text: `❌ **Error:** ${data.error || 'Failed to generate response.'}` }]);
      }
    } catch (err) {
      console.error('Failed to communicate with AI endpoint:', err);
      setMessages(prev => [...prev, { role: 'model', text: '⚠️ **Connection Error:** Could not connect to the backend AI assistant service.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestionClick = (prompt) => handleSendMessage(prompt);

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') handleSendMessage();
  };

  const clearChat = () => {
    setMessages([{
      role: 'model',
      text: "👋 Chat history cleared. How else can I assist your collaboration session?"
    }]);
  };

  // Basic Markdown-like parser
  const renderMessageContent = (text) => {
    if (!text) return '';
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part, index) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const code = part.slice(3, -3).replace(/^[a-zA-Z]+\n/, '');
        return (
          <pre key={index} className="ai-chat-code-block">
            <code>{code}</code>
          </pre>
        );
      }
      let line = part;
      line = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      line = line.replace(/`(.*?)`/g, '<code class="ai-chat-inline-code">$1</code>');
      line = line.replace(/^\*\s(.*)$/gm, '• $1');
      const formattedLines = line.split('\n').map((l, i) => (
        <span key={i} dangerouslySetInnerHTML={{ __html: l }} style={{ display: 'block', minHeight: '8px' }} />
      ));
      return <span key={index}>{formattedLines}</span>;
    });
  };

  const suggestions = [
    "Brainstorm dynamic coding ideas",
    "Explain CSS Flexbox vs Grid layout rules",
    "Draft a standard project README structure",
    "Write a bubble sort algorithm in JavaScript"
  ];

  return (
    <>
      {/* Draggable Bubble Button */}
      <div
        ref={containerRef}
        className={`ai-chatbot-bubble-wrapper ${isDragging ? 'dragging' : ''}`}
        style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : {}}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <button
          className={`ai-chatbot-bubble ${isOpen ? 'active' : ''}`}
          title={isDragging ? 'Drag to reposition' : 'Chat with AI Copilot'}
          aria-label="Toggle AI Chatbot"
        >
          {isOpen ? <X size={24} /> : <Bot size={24} />}
          {!isOpen && <span className="ai-bubble-badge">AI</span>}
        </button>
        {/* Drag hint indicator */}
        <div className="ai-drag-hint" title="Drag to move">⠿</div>
      </div>

      {/* Floating Chat Window — positioned absolutely based on bubble location */}
      <div
        className={`ai-chatbot-window ${isOpen ? 'open' : ''}`}
        style={windowStyle}
      >
        {/* Header bar */}
        <div className="ai-chat-header">
          <div className="ai-chat-header-title">
            <Sparkles size={16} className="ai-glow-icon" />
            <span>AI Copilot</span>
            <span
              className={`ai-status-indicator ${isMockMode ? 'mock' : 'live'}`}
              title={isMockMode ? "Mock Mode (API Key Missing)" : "Live Mode (Connected)"}
            />
          </div>
          <div className="ai-chat-header-actions">
            <button className="ai-clear-btn" onClick={clearChat} title="Clear Chat History">
              <RefreshCw size={14} />
            </button>
            <button className="ai-close-btn" onClick={() => setIsOpen(false)} title="Minimize Panel">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Message Feed */}
        <div className="ai-chat-body">
          <div className="ai-messages-list">
            {messages.map((msg, i) => (
              <div key={i} className={`ai-message-row ${msg.role === 'user' ? 'user' : 'ai'}`}>
                <div className="ai-message-bubble">
                  {renderMessageContent(msg.text)}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="ai-message-row ai">
                <div className="ai-message-bubble ai-thinking-bubble">
                  <div className="ai-pulse-dot"></div>
                  <div className="ai-pulse-dot"></div>
                  <div className="ai-pulse-dot"></div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Quick Suggestion Prompts */}
          {messages.length === 1 && !isLoading && (
            <div className="ai-suggestions-container">
              <p className="suggestion-title">Suggestions:</p>
              <div className="ai-suggestions-list">
                {suggestions.map((prompt, idx) => (
                  <button
                    key={idx}
                    className="ai-suggestion-chip"
                    onClick={() => handleSuggestionClick(prompt)}
                  >
                    💡 {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Text Input area */}
        <div className="ai-chat-footer">
          <input
            type="text"
            className="ai-chat-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Ask AI Copilot..."
            disabled={isLoading}
          />
          <button
            className="ai-chat-send-btn"
            onClick={() => handleSendMessage()}
            disabled={isLoading || !inputValue.trim()}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </>
  );
}

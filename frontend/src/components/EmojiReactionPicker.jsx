/**
 * @file EmojiReactionPicker.jsx
 * @description Emoji reaction picker strip and reaction badge row for chat messages.
 * Shows on hover, lets users toggle reactions. Broadcasts via socket events.
 */
import React, { useState } from 'react';
import './EmojiReactionPicker.css';

const EMOJI_SET = ['👍', '❤️', '😂', '🔥', '😮', '😢', '🎉', '👀'];

export default function EmojiReactionPicker({ messageId, reactions = [], username, room, socket }) {
  const [showPicker, setShowPicker] = useState(false);

  const handleToggle = (emoji) => {
    if (!socket) return;
    const existing = reactions.find(r => r.emoji === emoji);
    const isMine = existing?.users?.includes(username);
    if (isMine) {
      socket.emit('remove reaction', { room, messageId, emoji });
    } else {
      socket.emit('add reaction', { room, messageId, emoji });
    }
    setShowPicker(false);
  };

  const hasReactions = reactions && reactions.some(r => r.users.length > 0);

  return (
    <div className="reaction-wrapper">
      {/* Reaction badges row */}
      {hasReactions && (
        <div className="reaction-badges">
          {reactions.filter(r => r.users.length > 0).map((r) => {
            const isMine = r.users.includes(username);
            return (
              <button
                key={r.emoji}
                className={`reaction-badge ${isMine ? 'mine' : ''}`}
                onClick={() => handleToggle(r.emoji)}
                title={r.users.join(', ')}
              >
                {r.emoji} <span className="reaction-count">{r.users.length}</span>
              </button>
            );
          })}
          <button className="reaction-add-more" onClick={() => setShowPicker(p => !p)} title="Add reaction">
            +
          </button>
        </div>
      )}

      {/* Hover trigger when no reactions yet */}
      {!hasReactions && (
        <button
          className="reaction-trigger"
          onClick={() => setShowPicker(p => !p)}
          title="React"
        >
          😊
        </button>
      )}

      {/* Emoji picker strip */}
      {showPicker && (
        <div className="emoji-picker-strip">
          {EMOJI_SET.map(emoji => (
            <button
              key={emoji}
              className="emoji-option"
              onClick={() => handleToggle(emoji)}
              title={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

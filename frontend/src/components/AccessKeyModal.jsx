/**
 * @file AccessKeyModal.jsx
 * @description A security gating overlay modal component. Prevents unauthorized users from entering
 * collaborative workspaces or chats. Standardizes key verification input and room validation.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import './AccessKeyModal.css';

/**
 * AccessKeyModal Component
 * 
 * Props:
 * - title: Heading text displaying in the modal
 * - subtitle: Explanatory paragraph giving details of what workspace requires validation
 * - showRoomInput: If true, renders a room/project text input alongside the access key input
 * - initialRoomName: Starting value for the room input
 * - errorMessage: Validation error returned from the backend (if any)
 * - onSubmit: Handler callback dispatched with verified room name and access key
 */
export default function AccessKeyModal({
  title = 'Access Key Required',
  subtitle = 'This workspace is secure. Please enter the access key to enter.',
  showRoomInput = false,
  initialRoomName = '',
  errorMessage = '',
  onSubmit
}) {
  const navigate = useNavigate();
  
  // Local state hook to bind project/room name input
  const [roomName, setRoomName] = useState(initialRoomName);
  
  // Local state hook to bind password-protected access key input
  const [accessKey, setAccessKey] = useState('');

  /**
   * Dispatches validation details to workspace parent container.
   * Prevents standard form actions and asserts input criteria is met.
   */
  const handleSubmit = (e) => {
    e.preventDefault();
    if (showRoomInput && !roomName.trim()) return;
    if (!accessKey.trim()) return;
    onSubmit(roomName.trim(), accessKey.trim());
  };

  return (
    <div className="room-overlay">
      <div className="room-overlay-content">
        {/* Shield Icon to visually represent security gating */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
          <ShieldAlert size={48} color="var(--primary-color)" />
        </div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
        
        {/* Render error alerts dynamically if returned by server validations */}
        {errorMessage && (
          <p style={{ color: '#ff4d4f', fontWeight: 'bold', marginTop: '-10px', marginBottom: '15px' }}>
            {errorMessage}
          </p>
        )}

        <form onSubmit={handleSubmit}>
          {/* Renders dynamic room/project inputs for standalone gateway routes */}
          {showRoomInput && (
            <input
              type="text"
              className="form-control"
              placeholder="Enter room name..."
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              required
              autoComplete="off"
            />
          )}
          
          {/* Access verification input field */}
          <input
            type="password"
            className="form-control"
            placeholder="Enter access key..."
            value={accessKey}
            onChange={(e) => setAccessKey(e.target.value)}
            required
            autoComplete="off"
          />
          
          {/* Submit form to trigger verification handlers */}
          <button type="submit" className="btn-primary">Join Room</button>
          
          {/* Safety fallback button back to landing dashboard */}
          <button type="button" onClick={() => navigate('/')} className="btn-secondary-modal">
            Back to Home
          </button>
        </form>
      </div>
    </div>
  );
}

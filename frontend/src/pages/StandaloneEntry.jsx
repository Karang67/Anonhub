/**
 * @file StandaloneEntry.jsx
 * @description Gateway redirect entrypoint page.
 * Gatekeeps access to standalone Document and Coding workspaces when launched from direct static URLs
 * (e.g. `/document.html` or `/code`). Renders a unified security portal AccessKeyModal with room inputs,
 * verifies credentials against the API, saves access cookies/keys, and routes users to the target project layout.
 */

import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import AccessKeyModal from '../components/AccessKeyModal';
import { getCookie, setCookie } from '../services/socket';

/**
 * StandaloneEntry Component
 * Accepts a `tabType` ('document' or 'code') specifying the target tab destination.
 * @param {Object} props - Component properties
 * @param {string} props.tabType - Target tab pane identifier
 */
export default function StandaloneEntry({ tabType }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState('');
  
  const queryProject = searchParams.get('project');

  useEffect(() => {
    if (queryProject) {
      if (tabType === 'chat') {
        navigate(`/chat/${encodeURIComponent(queryProject)}`, { replace: true });
      } else if (tabType === 'call') {
        navigate(`/call/${encodeURIComponent(queryProject)}`, { replace: true });
      } else if (tabType === 'project') {
        navigate(`/projects/${encodeURIComponent(queryProject)}`, { replace: true });
      } else {
        navigate(`/projects/${encodeURIComponent(queryProject)}?tab=${tabType}`, { replace: true });
      }
    } else {
      const activeRoom = sessionStorage.getItem(`anonhub-active-${tabType}-room`) || getCookie(`anonhub-active-${tabType}-room`);
      if (activeRoom) {
        const keyPrefix = tabType === 'chat' ? 'chat' : 'project';
        const savedKey = sessionStorage.getItem(`accesskey_${keyPrefix}_${activeRoom}`) || getCookie(`accesskey_${keyPrefix}_${activeRoom}`);
        if (savedKey) {
          if (tabType === 'chat') {
            navigate(`/chat/${encodeURIComponent(activeRoom)}`, { replace: true });
          } else if (tabType === 'call') {
            navigate(`/call/${encodeURIComponent(activeRoom)}`, { replace: true });
          } else if (tabType === 'project') {
            navigate(`/projects/${encodeURIComponent(activeRoom)}`, { replace: true });
          } else {
            navigate(`/projects/${encodeURIComponent(activeRoom)}?tab=${tabType}`, { replace: true });
          }
        }
      }
    }
  }, [queryProject, navigate, tabType]);

  const handleSubmit = async (roomName, accessKey) => {
    setErrorMessage('');
    try {
      const isChat = tabType === 'chat';
      const endpoint = isChat ? '/join-chat' : '/create-project';
      const payload = isChat ? { room: roomName, accessKey } : { name: roomName, accessKey };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (response.ok) {
        const keyPrefix = isChat ? 'chat' : 'project';
        sessionStorage.setItem(`accesskey_${keyPrefix}_${roomName}`, accessKey);
        setCookie(`accesskey_${keyPrefix}_${roomName}`, accessKey);
        setCookie(`anonhub-active-${tabType}-room`, roomName);
        
        if (data.ownerToken) {
          const ownerKey = isChat ? `owner_token_chat_${roomName}` : `owner_token_${roomName}`;
          localStorage.setItem(ownerKey, data.ownerToken);
          if (isChat) {
            localStorage.setItem(`owner_token_${roomName}`, data.ownerToken);
          }
        }
        
        if (tabType === 'chat') {
          navigate(`/chat/${encodeURIComponent(roomName)}`);
        } else if (tabType === 'call') {
          navigate(`/call/${encodeURIComponent(roomName)}`);
        } else if (tabType === 'project') {
          navigate(`/projects/${encodeURIComponent(roomName)}`);
        } else {
          navigate(`/projects/${encodeURIComponent(roomName)}?tab=${tabType}`);
        }
      } else {
        setErrorMessage(data.error || 'Could not validate or join room.');
      }
    } catch (err) {
      console.error(err);
      setErrorMessage('Network error. Please try again.');
    }
  };

  let title = 'Collaborative Workspace';
  let subtitle = 'Enter a room name and access key to join or create a shared session.';
  
  if (tabType === 'document') {
    title = 'Collaborative Document Board';
    subtitle = 'Enter a room name and access key to join or create a shared document session.';
  } else if (tabType === 'code') {
    title = 'Collaborative Coding Board';
    subtitle = 'Enter a room name and access key to join or create a shared coding session.';
  } else if (tabType === 'chat') {
    title = 'Anonymous Chat Room Gateway';
    subtitle = 'Enter a room name and access key to join or create a secure chat room.';
  } else if (tabType === 'project') {
    title = 'Collaborative Project Room Gateway';
    subtitle = 'Enter a room name and access key to join or create a multi-pane project workspace.';
  } else if (tabType === 'call') {
    title = 'Dedicated Voice & Video Call';
    subtitle = 'Enter a room name and access key to join or start a secure calling and screen share session.';
  }

  if (queryProject) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <h3 style={{ color: 'var(--text-muted)' }}>Redirecting to workspace...</h3>
      </div>
    );
  }

  return (
    <AccessKeyModal
      title={title}
      subtitle={subtitle}
      showRoomInput={true}
      errorMessage={errorMessage}
      onSubmit={handleSubmit}
    />
  );
}


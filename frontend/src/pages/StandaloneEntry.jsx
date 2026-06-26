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

  // Extract query parameters representing project names (e.g. `?project=test-doc`)
  const queryProject = searchParams.get('project');

  // If a project identifier was parsed directly from the browser location,
  // or if there is an active session in the current browser session,
  // execute an immediate client-side redirection to the targeted multi-pane workspace route.
  useEffect(() => {
    if (queryProject) {
      navigate(`/projects/${encodeURIComponent(queryProject)}?tab=${tabType}`, { replace: true });
    } else {
      const activeRoom = sessionStorage.getItem(`anonhub-active-${tabType}-room`);
      if (activeRoom) {
        const savedKey = sessionStorage.getItem(`accesskey_project_${activeRoom}`);
        if (savedKey) {
          navigate(`/projects/${encodeURIComponent(activeRoom)}?tab=${tabType}`, { replace: true });
        }
      }
    }
  }, [queryProject, navigate, tabType]);

  /**
   * Dispatches validation inputs to the project creation API /create-project.
   * If credentials match, caches keys in storage states and redirects client.
   * @param {string} roomName - Form input project name
   * @param {string} accessKey - Form input access verification key
   */
  const handleSubmit = async (roomName, accessKey) => {
    setErrorMessage('');
    try {
      const response = await fetch('/create-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: roomName, accessKey })
      });

      const data = await response.json();
      if (response.ok) {
        // Store project credential attributes
        sessionStorage.setItem(`accesskey_project_${roomName}`, accessKey);
        if (data.ownerToken) {
          // If the project was newly initialized, register owner token locally
          localStorage.setItem(`owner_token_${roomName}`, data.ownerToken);
        }
        navigate(`/projects/${encodeURIComponent(roomName)}?tab=${tabType}`);
      } else {
        setErrorMessage(data.error || 'Could not validate or join room.');
      }
    } catch (err) {
      console.error(err);
      setErrorMessage('Network error. Please try again.');
    }
  };

  // If query project isn't set, show the entry overlay modal
  if (queryProject) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <h3 style={{ color: 'var(--text-muted)' }}>Redirecting to workspace...</h3>
      </div>
    );
  }

  return (
    <AccessKeyModal
      title={`Collaborative ${tabType === 'document' ? 'Document' : 'Coding'} Board`}
      subtitle={`Enter a room name and access key to join or create a shared ${tabType} session.`}
      showRoomInput={true}
      errorMessage={errorMessage}
      onSubmit={handleSubmit}
    />
  );
}


/**
 * @file main.jsx
 * @description Bootstraps the React client-side application.
 * Mounts the main React component (`App`) to the root HTML node (`#root`),
 * rendering inside StrictMode to identify potential side effects and deprecated hooks.
 * Imports global style assets including layout tokens and color schemes.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Select the root DOM node and render the React virtual DOM tree inside StrictMode
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)


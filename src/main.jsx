import React from 'react';
import { createRoot } from 'react-dom/client';
import PartyTracker from './PartyTracker.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PartyTracker />
  </React.StrictMode>,
);

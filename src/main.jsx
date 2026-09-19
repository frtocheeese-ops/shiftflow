import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);

// Skript se načetl v pořádku — zrušit příznak sebeopravy
try { sessionStorage.removeItem("sf_recover"); } catch {}

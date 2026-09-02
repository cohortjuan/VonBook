import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// easter egg: anyone curious enough to open devtools gets a little hello
console.log(
  '%c👾 VonBook 👾\n%cYou found the console. Try the konami code anywhere in the app: ↑ ↑ ↓ ↓ ← → ← → B A\n(on mobile: swipe the same pattern, then tap twice)',
  'font-size: 20px; font-weight: bold; color: #06b6d4;',
  'font-size: 12px; color: #2563eb;',
);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

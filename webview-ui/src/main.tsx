import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.tsx';
import { initSavedColors } from './cssColors.js';
import { isStandalone } from './vscodeApi.ts';

initSavedColors();

if (isStandalone) {
  import('./wsAdapter.ts').then((m) => m.initWebSocket());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DesktopApp } from './session/DesktopApp';
import { installTauriApi } from './tauri-api';

installTauriApi();

const container = document.getElementById('root');
if (!container) throw new Error('Renderer root element is missing');

createRoot(container).render(
  <StrictMode>
    <DesktopApp />
  </StrictMode>,
);

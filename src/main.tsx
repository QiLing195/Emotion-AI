import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import PetApp from './components/pet/PetApp.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import './index.css';

// v1.83：/pet 是 Electron 桌宠窗口用的极简页；其余路径仍是完整 OS 界面
const isPet = window.location.pathname.replace(/\/+$/, '') === '/pet';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isPet ? <PetApp /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
);

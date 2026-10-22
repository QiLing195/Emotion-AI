import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import PetApp from './components/pet/PetApp.tsx';
import PetSettingsApp from './components/pet/PetSettingsApp.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import './index.css';

// v1.83：/pet 是 Electron 桌宠窗口的极简页；v1.90：/pet/settings 是唤醒词设置窗口；其余是完整 OS 界面
const path = window.location.pathname.replace(/\/+$/, '');
const isPetSettings = path === '/pet/settings';
const isPet = path === '/pet';
if (isPet) document.documentElement.classList.add('pet-mode');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isPetSettings ? <PetSettingsApp /> : isPet ? <PetApp /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
);

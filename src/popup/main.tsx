import React from 'react';
import ReactDOM from 'react-dom/client';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import App from './App.tsx';
import './index.css';

const criticalSizeStyle = document.querySelector('[data-popup-critical-size]');

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

requestAnimationFrame(() => criticalSizeStyle?.remove());

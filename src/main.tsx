import { createRoot } from 'react-dom/client';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import App from './App';
import './style.css';
import './desktop/desktop.css';
document.body.dataset.window = getCurrentWebviewWindow().label;
createRoot(document.getElementById('app')!).render(<App />);

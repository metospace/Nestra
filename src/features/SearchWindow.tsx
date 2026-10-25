import { useEffect, useState } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen } from '@tauri-apps/api/event';
import { initialize, useNestra } from '@/stores/state';
import SearchPanel from './SearchPanel';
export default function SearchWindow() {
  const [focusSignal, setFocusSignal] = useState(0);
  const state = useNestra();
  useEffect(() => {
    const focus = () => setFocusSignal(value => value + 1);
    window.addEventListener('focus', focus);
    const unlisten = listen('nestra://search-focus', focus);
    void initialize();
    return () => { window.removeEventListener('focus', focus); void unlisten.then(dispose => dispose()); };
  }, []);
  return <div className="search-window"><SearchPanel compact focusSignal={focusSignal} onClose={() => void getCurrentWebviewWindow().hide()}/>{state.statusMessage && <p className="navigation-status" role="status">{state.statusMessage}</p>}</div>;
}

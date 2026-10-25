import { useEffect } from 'react';
import { create } from 'zustand';
import { getEverythingStatus, installEverything, startEverything, type EverythingStatus } from '@/lib/tauri';

interface EverythingSetupState {
  status: EverythingStatus | null;
  checking: boolean;
  pending: boolean;
  error: string | null;
}

export const everythingSetupStore = create<EverythingSetupState>(() => ({
  status: null, checking: false, pending: false, error: null,
}));

export const isEverythingBusy = (status: EverythingStatus | null) =>
  !!status && ['downloading', 'verifying', 'installing', 'starting'].includes(status.phase);

let owners = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let epoch = 0;
let detecting: Promise<void> | undefined;

function schedule() {
  if (timer !== undefined) clearTimeout(timer);
  if (!owners) return;
  const { status, pending } = everythingSetupStore.getState();
  timer = setTimeout(() => {
    timer = undefined;
    void refreshEverythingStatus();
  }, pending || isEverythingBusy(status) ? 1000 : 10000);
}

/** Background checks retain action errors until a deliberate retry or connection. */
export function refreshEverythingStatus(clearError = false): Promise<void> {
  if (clearError) everythingSetupStore.setState({ error: null });
  if (detecting) return detecting;
  const requestEpoch = epoch;
  everythingSetupStore.setState({ checking: true });
  const request = Promise.resolve().then(async () => {
    try {
      const status = await getEverythingStatus();
      if (requestEpoch === epoch) {
        everythingSetupStore.setState(state => ({ status, error: status.running ? null : state.error }));
      }
    } catch (error) {
      if (requestEpoch === epoch) everythingSetupStore.setState(state => ({ error: state.error ?? `无法检测 Everything：${String(error)}` }));
    } finally {
      if (detecting === request) detecting = undefined;
      if (requestEpoch === epoch) everythingSetupStore.setState({ checking: false });
      schedule();
    }
  });
  detecting = request;
  return request;
}

function onFocus() { void refreshEverythingStatus(); }

/** Each webview has one monitor; the native job survives route/window changes. */
export function retainEverythingMonitor(): () => void {
  owners++;
  if (owners === 1) {
    window.addEventListener('focus', onFocus);
    void refreshEverythingStatus();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--owners === 0) {
      window.removeEventListener('focus', onFocus);
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    }
  };
}

export function useEverythingSetup() {
  useEffect(retainEverythingMonitor, []);
  return everythingSetupStore();
}

async function perform(action: () => Promise<EverythingStatus>) {
  const current = everythingSetupStore.getState();
  if (current.pending || isEverythingBusy(current.status)) return;
  epoch++;
  detecting = undefined;
  everythingSetupStore.setState({ pending: true, checking: false, error: null });
  schedule();
  try {
    const status = await action();
    epoch++;
    detecting = undefined;
    everythingSetupStore.setState({ status, checking: false });
  } catch (error) {
    epoch++;
    detecting = undefined;
    everythingSetupStore.setState({ checking: false, error: String(error) });
  } finally {
    everythingSetupStore.setState({ pending: false });
    await refreshEverythingStatus();
  }
}

export const installEverythingFromStore = (installDir: string) => perform(() => installEverything(installDir));
export const startEverythingFromStore = () => perform(startEverything);

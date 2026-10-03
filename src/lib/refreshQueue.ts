/** Serialize refreshes and commit only after interaction has finished. */
export function createRefreshQueue<T>(
  read: () => Promise<T>,
  commit: (value: T) => void,
  blocked: () => boolean,
  wait: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 50)),
): () => Promise<void> {
  let running: Promise<void> | null = null;
  let requested = false;
  async function drain(): Promise<void> {
    while (requested) {
      while (blocked()) await wait();
      requested = false;
      const value = await read();
      // A drag can start while the scan is in flight. Retain the current DOM
      // and references until release; newer requests supersede this snapshot.
      while (blocked()) await wait();
      if (!requested) commit(value);
    }
  }
  return () => {
    requested = true;
    if (!running) {
      running = drain().finally(() => { running = null; });
    }
    return running;
  };
}

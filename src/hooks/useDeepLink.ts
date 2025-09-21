import { useEffect } from 'react';

declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        on: (channel: string, listener: (...args: unknown[]) => void) => () => void;
        removeListener: (channel: string, listener: (...args: unknown[]) => void) => void;
      };
    };
  }
}

export function useDeepLink(eventName: string, callback: (data: any) => void) {
  useEffect(() => {
    const unsubscribe = window.electron.ipcRenderer.on(eventName, callback);

    return () => {
      unsubscribe();
    };
  }, [eventName, callback]);
}
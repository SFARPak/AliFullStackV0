import { useCallback, useEffect, useRef } from "react";
import { atom } from "jotai";
import { IpcClient } from "@/ipc/ipc_client";
import {
  appOutputAtom,
  appUrlAtom,
  currentAppAtom,
  previewPanelKeyAtom,
  previewErrorMessageAtom,
  selectedAppIdAtom,
} from "@/atoms/appAtoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { AppOutput } from "@/ipc/ipc_types";
import { showInputRequest } from "@/lib/toast";

const useRunAppLoadingAtom = atom(false);

export function useRunApp() {
  const [loading, setLoading] = useAtom(useRunAppLoadingAtom);
  const [app, setApp] = useAtom(currentAppAtom);
  const setAppOutput = useSetAtom(appOutputAtom);
  const [, setAppUrlObj] = useAtom(appUrlAtom);
  const setPreviewPanelKey = useSetAtom(previewPanelKeyAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const setPreviewErrorMessage = useSetAtom(previewErrorMessageAtom);
  const startupTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clear startup timeout when app URL is successfully set
  const clearStartupTimeout = useCallback(() => {
    if (startupTimeoutRef.current) {
      clearTimeout(startupTimeoutRef.current);
      startupTimeoutRef.current = null;
    }
  }, []);

  // Set startup timeout to show error if app doesn't start within 2 minutes
  const setStartupTimeout = useCallback((appId: number) => {
    clearStartupTimeout(); // Clear any existing timeout
    startupTimeoutRef.current = setTimeout(() => {
      console.warn(`[useRunApp] App ${appId} startup timeout - no URL detected within 2 minutes`);
      setPreviewErrorMessage("App startup timed out. The server may have failed to start. Check the terminal output for errors.");
    }, 2 * 60 * 1000); // 2 minutes
  }, [clearStartupTimeout, setPreviewErrorMessage]);

  const processProxyServerOutput = (output: AppOutput) => {
    const matchesProxyServerStart = output.message.includes(
      "[AliFullStack-proxy-server]started=[",
    );
    if (matchesProxyServerStart) {
      // Extract both proxy URL and original URL using regex
      const proxyUrlMatch = output.message.match(
        /\[AliFullStack-proxy-server\]started=\[(.*?)\]/,
      );
      const originalUrlMatch = output.message.match(/original=\[(.*?)\]/);

      if (proxyUrlMatch && proxyUrlMatch[1]) {
        const proxyUrl = proxyUrlMatch[1];
        const originalUrl = originalUrlMatch && originalUrlMatch[1];
        console.log(`[useRunApp] Setting app URL: proxy=${proxyUrl}, original=${originalUrl}, appId=${output.appId}`);
        clearStartupTimeout();
        setAppUrlObj({
          appUrl: proxyUrl,
          appId: output.appId,
          originalUrl: originalUrl!,
        });
      }
    }

    // Also check for server startup messages that might indicate the app is ready
    // This handles cases where the proxy server message format might be different
    const serverReadyPatterns = [
      /Local:\s+(http:\/\/localhost:\d+)/i,
      /Server running at (http:\/\/localhost:\d+)/i,
      /App is running on (http:\/\/localhost:\d+)/i,
      /Development server started.*(http:\/\/\S+)/i,
    ];

    for (const pattern of serverReadyPatterns) {
      const match = output.message.match(pattern);
      if (match && match[1]) {
        console.log(`[useRunApp] Detected server ready from pattern: ${pattern}, URL: ${match[1]}`);
        clearStartupTimeout();
        setAppUrlObj({
          appUrl: match[1],
          appId: output.appId,
          originalUrl: match[1],
        });
        break;
      }
    }
  };

  const processAppOutput = useCallback(
    (output: AppOutput) => {
      // Handle input requests specially
      if (output.type === "input-requested") {
        showInputRequest(output.message, async (response) => {
          try {
            const ipcClient = IpcClient.getInstance();
            await ipcClient.respondToAppInput({
              appId: output.appId,
              response,
            });
          } catch (error) {
            console.error("Failed to respond to app input:", error);
          }
        });
        return; // Don't add to regular output
      }

      // Add to regular app output
      setAppOutput((prev) => [...prev, output]);

      // Process proxy server output
      processProxyServerOutput(output);
    },
    [setAppOutput],
  );
  const runApp = useCallback(
    async (appId: number) => {
      setLoading(true);
      clearStartupTimeout(); // Clear any existing timeout
      setStartupTimeout(appId); // Set new timeout for this app startup
      try {
        const ipcClient = IpcClient.getInstance();
        console.debug("Running app", appId);

        // Clear the URL and add restart message
        setAppUrlObj((prevAppUrlObj) => {
          if (prevAppUrlObj?.appId !== appId) {
            return { appUrl: null, appId: null, originalUrl: null };
          }
          return prevAppUrlObj; // No change needed
        });

        setAppOutput((prev) => [
          ...prev,
          {
            message: "Trying to restart app...",
            type: "stdout",
            appId,
            timestamp: Date.now(),
          },
        ]);
        const app = await ipcClient.getApp(appId);
        setApp(app);
        await ipcClient.runApp(appId, processAppOutput);
        setPreviewErrorMessage(undefined);
      } catch (error) {
        console.error(`Error running app ${appId}:`, error);
        clearStartupTimeout(); // Clear timeout on error
        setPreviewErrorMessage(
          error instanceof Error ? error.message : error?.toString(),
        );
      } finally {
        setLoading(false);
      }
    },
    [processAppOutput, clearStartupTimeout, setStartupTimeout],
  );

  const stopApp = useCallback(async (appId: number) => {
    if (appId === null) {
      return;
    }

    setLoading(true);
    try {
      const ipcClient = IpcClient.getInstance();
      await ipcClient.stopApp(appId);

      setPreviewErrorMessage(undefined);
    } catch (error) {
      console.error(`Error stopping app ${appId}:`, error);
      setPreviewErrorMessage(
        error instanceof Error ? error.message : error?.toString(),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const onHotModuleReload = useCallback(() => {
    setPreviewPanelKey((prevKey) => prevKey + 1);
  }, [setPreviewPanelKey]);

  const restartApp = useCallback(
    async (
      params: { removeNodeModules?: boolean } = {},
      options: { terminalType?: "frontend" | "backend" | "main" } = {}
    ) => {
      const { removeNodeModules = false } = params;
      const { terminalType = "main" } = options;
      if (appId === null) {
        return;
      }
      setLoading(true);
      clearStartupTimeout(); // Clear any existing timeout
      setStartupTimeout(appId); // Set new timeout for this app restart
      try {
        const ipcClient = IpcClient.getInstance();
        console.debug(
          "Restarting app",
          appId,
          removeNodeModules ? "with node_modules cleanup" : "",
        );

        // Clear the URL and add restart message
        setAppUrlObj({ appUrl: null, appId: null, originalUrl: null });
        setAppOutput((prev) => [
          ...prev,
          {
            message: "Restarting app...",
            type: "stdout",
            appId,
            timestamp: Date.now(),
          },
        ]);

        const app = await ipcClient.getApp(appId);
        setApp(app);
        await ipcClient.restartApp(
          appId,
          (output) => {
            // Handle HMR updates before processing
            if (
              output.message.includes("hmr update") &&
              output.message.includes("[vite]")
            ) {
              onHotModuleReload();
            }
            // Process normally (including input requests)
            processAppOutput(output);
          },
          removeNodeModules,
        );
      } catch (error) {
        console.error(`Error restarting app ${appId}:`, error);
        clearStartupTimeout(); // Clear timeout on error
        setPreviewErrorMessage(
          error instanceof Error ? error.message : error?.toString(),
        );
      } finally {
        setPreviewPanelKey((prevKey) => prevKey + 1);
        setLoading(false);
      }
    },
    [
      appId,
      setApp,
      setAppOutput,
      setAppUrlObj,
      setPreviewPanelKey,
      processAppOutput,
      onHotModuleReload,
      clearStartupTimeout,
      setStartupTimeout,
    ],
  );

  const refreshAppIframe = useCallback(async () => {
    setPreviewPanelKey((prevKey) => prevKey + 1);
  }, [setPreviewPanelKey]);

  // Cleanup timeout on unmount or appId change
  useEffect(() => {
    return () => {
      clearStartupTimeout();
    };
  }, [clearStartupTimeout]);

  return {
    loading,
    runApp,
    stopApp,
    restartApp,
    app,
    refreshAppIframe,
  };
}

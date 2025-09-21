import { useState, useEffect } from "react";
import { LogIn, LogOut, User, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { IpcClient } from "@/ipc/ipc_client";
import { showError } from "@/lib/toast";
import { useDeepLink } from "@/hooks/useDeepLink";

interface RooCodeConfigurationProps {
  provider: string;
}

interface AuthState {
  isAuthenticated: boolean;
  userInfo?: {
    name?: string;
    email?: string;
    picture?: string;
  };
}

export function RooCodeConfiguration({ provider }: RooCodeConfigurationProps) {
  const [authState, setAuthState] = useState<AuthState>({ isAuthenticated: false });
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  // Check authentication status on component mount
  useEffect(() => {
    // Small delay to ensure IPC client is initialized
    const timer = setTimeout(() => {
      checkAuthStatus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Listen for authentication callback
  useDeepLink("roocode-auth-callback", async (data: { code: string; state: string }) => {
    try {
      if (!(window as any).electron || !(window as any).electron.ipcRenderer) {
        console.error("IPC renderer not available for auth callback");
        return;
      }

      const ipcClient = IpcClient.getInstance();
      await ipcClient.invoke("roocode:auth-callback", data.code, data.state);
      await checkAuthStatus(); // Refresh auth status
    } catch (error) {
      console.error("Failed to handle Roo Code auth callback:", error);
      showError("Failed to complete Roo Code authentication");
    }
  });

  const checkAuthStatus = async () => {
    try {
      setIsInitializing(true);
      // Check if IPC client is available
      if (!(window as any).electron || !(window as any).electron.ipcRenderer) {
        console.warn("IPC renderer not available yet, retrying...");
        setTimeout(() => checkAuthStatus(), 500);
        return;
      }

      const ipcClient = IpcClient.getInstance();
      const status = await ipcClient.invoke("roocode:auth-status");
      setAuthState(status);
    } catch (error) {
      console.error("Failed to check Roo Code auth status:", error);
      setAuthState({ isAuthenticated: false });
    } finally {
      setIsInitializing(false);
    }
  };

  const handleLogin = async () => {
    try {
      setIsLoading(true);
      if (!(window as any).electron || !(window as any).electron.ipcRenderer) {
        showError("IPC renderer not available. Please refresh the page.");
        return;
      }

      const ipcClient = IpcClient.getInstance();
      await ipcClient.invoke("roocode:login");
      // The login process will open a browser window and handle the callback
    } catch (error) {
      console.error("Failed to initiate Roo Code login:", error);
      showError("Failed to initiate Roo Code authentication");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      setIsLoading(true);
      if (!(window as any).electron || !(window as any).electron.ipcRenderer) {
        showError("IPC renderer not available. Please refresh the page.");
        return;
      }

      const ipcClient = IpcClient.getInstance();
      await ipcClient.invoke("roocode:logout");
      await checkAuthStatus(); // Refresh auth status
    } catch (error) {
      console.error("Failed to logout from Roo Code:", error);
      showError("Failed to logout from Roo Code");
    } finally {
      setIsLoading(false);
    }
  };

  if (isInitializing) {
    return (
      <div className="space-y-4">
        <div className="border rounded-lg px-4 py-4 bg-(--background-lightest)">
          <div className="flex items-center justify-center">
            <div className="text-sm text-muted-foreground">Checking authentication status...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="border rounded-lg px-4 py-4 bg-(--background-lightest)">
        <h3 className="text-lg font-medium mb-4">Roo Code Cloud Authentication</h3>

        {authState.isAuthenticated ? (
          <div className="space-y-4">
            <Alert>
              <User className="h-4 w-4" />
              <AlertTitle className="flex items-center justify-between">
                <span>Authenticated</span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleLogout}
                  disabled={isLoading}
                  className="flex items-center gap-1 h-7 px-2"
                >
                  <LogOut className="h-4 w-4" />
                  {isLoading ? "Logging out..." : "Logout"}
                </Button>
              </AlertTitle>
              <AlertDescription>
                <div className="space-y-2">
                  {authState.userInfo?.name && (
                    <p><strong>Name:</strong> {authState.userInfo.name}</p>
                  )}
                  {authState.userInfo?.email && (
                    <p><strong>Email:</strong> {authState.userInfo.email}</p>
                  )}
                  <p className="text-xs text-green-600 dark:text-green-400 mt-2">
                    You are successfully authenticated with Roo Code Cloud.
                  </p>
                </div>
              </AlertDescription>
            </Alert>
          </div>
        ) : (
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Not Authenticated</AlertTitle>
              <AlertDescription>
                You need to authenticate with Roo Code Cloud to use Roo Code models.
                Click the button below to open your browser and sign in.
              </AlertDescription>
            </Alert>

            <Button
              onClick={handleLogin}
              disabled={isLoading}
              className="flex items-center gap-2"
            >
              <LogIn className="h-4 w-4" />
              {isLoading ? "Opening browser..." : "Authenticate with Roo Code"}
            </Button>

            <p className="text-xs text-muted-foreground">
              This will open your default browser to authenticate with Roo Code Cloud.
              After authentication, you'll be redirected back to AliFullStack.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
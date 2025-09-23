import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle, LogIn } from "lucide-react";
import { IpcClient } from "@/ipc/ipc_client";

export function RooCodeConfiguration() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Check authentication status on component mount
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      setIsLoading(true);
      const ipcClient = IpcClient.getInstance();
      const authStatus = await ipcClient.roocodeAuthStatus();
      setIsAuthenticated(authStatus?.isAuthenticated || false);
    } catch (error) {
      console.error("Failed to check Roo Code authentication status:", error);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignIn = async () => {
    try {
      setIsLoading(true);
      const ipcClient = IpcClient.getInstance();
      // This will trigger the OAuth flow
      await ipcClient.roocodeLogin();
      // After sign in, check status again
      setTimeout(checkAuthStatus, 1000);
    } catch (error) {
      console.error("Failed to initiate Roo Code sign in:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isAuthenticated) {
    return (
      <Alert variant="default" className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
        <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
        <AlertTitle className="text-green-800 dark:text-green-200">
          Connected to Roo Code Cloud
        </AlertTitle>
        <AlertDescription className="text-green-700 dark:text-green-300">
          You are successfully authenticated with Roo Code Cloud. You can now use Roo Code Cloud models.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <Alert variant="default">
        <LogIn className="h-4 w-4" />
        <AlertTitle>Roo Code Cloud Authentication Required</AlertTitle>
        <AlertDescription>
          To use Roo Code Cloud models, you need to authenticate with Roo Code Cloud.
          This provides access to premium AI models with enhanced capabilities.
        </AlertDescription>
      </Alert>

      <div className="flex justify-center">
        <Button
          onClick={handleSignIn}
          disabled={isLoading}
          className="flex items-center gap-2"
        >
          <LogIn className="h-4 w-4" />
          {isLoading ? "Connecting..." : "Connect to Roo Code Cloud"}
        </Button>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
        Authentication is secure and only grants access to AI model services.
        Your data remains private and is not shared.
      </p>
    </div>
  );
}
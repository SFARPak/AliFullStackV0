import {
  MiniSelectTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSettings } from "@/hooks/useSettings";
import type { ChatMode } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { IpcClient } from "@/ipc/ipc_client";
import { showError } from "@/lib/toast";
import { useState } from "react";
import { Loader2 } from "lucide-react";

export function ChatModeSelector({ appId }: { appId?: number }) {
  const { settings, updateSettings } = useSettings();
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const selectedMode = settings?.selectedChatMode || "build";

  const handleModeChange = async (value: string) => {
    const newMode = value as ChatMode;

    // If switching to backend mode and we have an app ID, check if backend folder exists
    if (newMode === "backend" && appId) {
      try {
        setIsCreatingFolder(true);
        // Get the app to check its structure
        const app = await IpcClient.getInstance().getApp(appId);
        const backendFiles = app.files.filter((file: string) => file.startsWith("backend/"));

        // If no backend files exist, create the backend folder
        if (backendFiles.length === 0) {
          await IpcClient.getInstance().createMissingFolder({
            appId,
            folderType: "backend",
            backendFramework: settings?.selectedBackendFramework,
          });
        }
      } catch (error) {
        console.error("Error creating backend folder:", error);
        showError(error);
        return; // Don't change the mode if folder creation failed
      } finally {
        setIsCreatingFolder(false);
      }
    }

    // Update the chat mode
    updateSettings({ selectedChatMode: newMode });
  };

  const getModeDisplayName = (mode: ChatMode) => {
    switch (mode) {
      case "build":
        return "Build";
      case "ask":
        return "Ask";
      case "backend":
        return "Backend";
      default:
        return "Build";
    }
  };

  return (
    <Select value={selectedMode} onValueChange={handleModeChange} disabled={isCreatingFolder}>
      <Tooltip>
        <TooltipTrigger asChild>
          <MiniSelectTrigger
            data-testid="chat-mode-selector"
            className={cn(
              "h-6 w-fit px-1.5 py-0 text-xs-sm font-medium shadow-none gap-0.5",
              selectedMode === "build"
                ? "bg-background hover:bg-muted/50 focus:bg-muted/50"
                : "bg-primary/10 hover:bg-primary/20 focus:bg-primary/20 text-primary border-primary/20 dark:bg-primary/20 dark:hover:bg-primary/30 dark:focus:bg-primary/30",
            )}
            size="sm"
          >
            {isCreatingFolder ? (
              <div className="flex items-center gap-1">
                <Loader2 size={12} className="animate-spin" />
                <span>Creating...</span>
              </div>
            ) : (
              <SelectValue>{getModeDisplayName(selectedMode)}</SelectValue>
            )}
          </MiniSelectTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {isCreatingFolder ? "Creating backend folder..." : "Open mode menu"}
        </TooltipContent>
      </Tooltip>
      <SelectContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
        <SelectItem value="build">
          <div className="flex flex-col items-start">
            <span className="font-medium">Build</span>
            <span className="text-xs text-muted-foreground">
              Generate and edit code
            </span>
          </div>
        </SelectItem>
        <SelectItem value="ask">
          <div className="flex flex-col items-start">
            <span className="font-medium">Ask</span>
            <span className="text-xs text-muted-foreground">
              Ask questions about the app
            </span>
          </div>
        </SelectItem>
        <SelectItem value="backend">
          <div className="flex flex-col items-start">
            <span className="font-medium">Backend</span>
            <span className="text-xs text-muted-foreground">
              Backend development with Roo-Code
            </span>
          </div>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

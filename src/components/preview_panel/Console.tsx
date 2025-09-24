import { appOutputAtom, frontendTerminalOutputAtom, backendTerminalOutputAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { useAtomValue } from "jotai";
import { useLoadApp } from "@/hooks/useLoadApp";

// Console component with side-by-side terminal support
export const Console = () => {
  const appOutput = useAtomValue(appOutputAtom);
  const frontendTerminalOutput = useAtomValue(frontendTerminalOutputAtom);
  const backendTerminalOutput = useAtomValue(backendTerminalOutputAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { app } = useLoadApp(selectedAppId);

  // Determine which terminals to show
  const hasFrontendOutput = frontendTerminalOutput.length > 0;
  const hasBackendOutput = backendTerminalOutput.length > 0;
  const hasMain = appOutput.length > 0;

  // Check if app has frontend/backend folders (always show terminals for apps that have these folders)
  const hasFrontendFolder = app?.files?.some((file: string) => file.startsWith("frontend/")) || false;
  const hasBackendFolder = app?.files?.some((file: string) => file.startsWith("backend/")) || false;

  // Terminals are visible if they have content OR if the app has the corresponding folder
  const hasFrontend = hasFrontendOutput || hasFrontendFolder;
  const hasBackend = hasBackendOutput || hasBackendFolder;

  // Show all terminals if any terminal has content (to ensure Frontend is visible when Backend/System have content)
  const totalTerminals = hasFrontend + hasBackend + hasMain;
  const showAllTerminals = totalTerminals > 0;

  // Count active terminals
  const activeTerminals = [
    (hasMain || showAllTerminals) && "main",
    (hasFrontend || showAllTerminals) && "frontend",
    (hasBackend || showAllTerminals) && "backend"
  ].filter(Boolean);
  const terminalCount = activeTerminals.length;

  // Terminal rendering component with proper color classes
  const TerminalPanel = ({ title, outputs, color }: { title: string; outputs: any[]; color: "green" | "orange" | "blue" }) => {
    const colorClasses = {
      green: "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200",
      orange: "bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200",
      blue: "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200",
    };

    return (
      <div className="flex flex-col h-full">
        <div className={`px-3 py-2 ${colorClasses[color]} text-xs font-medium border-b border-border`}>
          {title} ({outputs.length})
        </div>
        <div className="font-mono text-xs px-4 flex-1 overflow-auto">
          {outputs.map((output, index) => (
            <div key={index}>{output.message}</div>
          ))}
        </div>
      </div>
    );
  };

  // Single terminal layout
  if (terminalCount === 1) {
    if (hasFrontend) {
      return <TerminalPanel title="Frontend" outputs={frontendTerminalOutput} color="green" />;
    }
    if (hasBackend) {
      return <TerminalPanel title="Backend" outputs={backendTerminalOutput} color="orange" />;
    }
    return <TerminalPanel title="System" outputs={appOutput} color="blue" />;
  }

  // Two terminals layout
  if (terminalCount === 2) {
    if (hasFrontend && hasBackend) {
      // Frontend and Backend side by side
      return (
        <div className="flex h-full">
          <div className="flex-1 border-r border-border">
            <TerminalPanel title="Frontend" outputs={frontendTerminalOutput} color="green" />
          </div>
          <div className="flex-1">
            <TerminalPanel title="Backend" outputs={backendTerminalOutput} color="orange" />
          </div>
        </div>
      );
    }
    if (hasMain && hasFrontend) {
      // System and Frontend side by side
      return (
        <div className="flex h-full">
          <div className="flex-1 border-r border-border">
            <TerminalPanel title="System" outputs={appOutput} color="blue" />
          </div>
          <div className="flex-1">
            <TerminalPanel title="Frontend" outputs={frontendTerminalOutput} color="green" />
          </div>
        </div>
      );
    }
    if (hasMain && hasBackend) {
      // System and Backend side by side
      return (
        <div className="flex h-full">
          <div className="flex-1 border-r border-border">
            <TerminalPanel title="System" outputs={appOutput} color="blue" />
          </div>
          <div className="flex-1">
            <TerminalPanel title="Backend" outputs={backendTerminalOutput} color="orange" />
          </div>
        </div>
      );
    }
  }

  // Three terminals layout - show in a 3-column layout
  if (terminalCount === 3) {
    return (
      <div className="flex h-full">
        <div className="flex-1 border-r border-border">
          <TerminalPanel title="System" outputs={appOutput} color="blue" />
        </div>
        <div className="flex-1 border-r border-border">
          <TerminalPanel title="Frontend" outputs={frontendTerminalOutput} color="green" />
        </div>
        <div className="flex-1">
          <TerminalPanel title="Backend" outputs={backendTerminalOutput} color="orange" />
        </div>
      </div>
    );
  }

  // Fallback - show system terminal
  return <TerminalPanel title="System" outputs={appOutput} color="blue" />;
};

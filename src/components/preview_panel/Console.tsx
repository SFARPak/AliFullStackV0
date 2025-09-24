import { appOutputAtom, frontendTerminalOutputAtom, backendTerminalOutputAtom } from "@/atoms/appAtoms";
import { useAtomValue } from "jotai";

// Console component with side-by-side terminal support
export const Console = () => {
  const appOutput = useAtomValue(appOutputAtom);
  const frontendTerminalOutput = useAtomValue(frontendTerminalOutputAtom);
  const backendTerminalOutput = useAtomValue(backendTerminalOutputAtom);

  // Determine which terminals to show
  const hasFrontend = frontendTerminalOutput.length > 0;
  const hasBackend = backendTerminalOutput.length > 0;
  const hasMain = appOutput.length > 0;

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

  // Terminal rendering component
  const TerminalPanel = ({ title, outputs, color }: { title: string; outputs: any[]; color: string }) => (
    <div className="flex flex-col h-full">
      <div className={`px-3 py-2 bg-${color}-100 dark:bg-${color}-900 text-${color}-800 dark:text-${color}-200 text-xs font-medium border-b border-border`}>
        {title} ({outputs.length})
      </div>
      <div className="font-mono text-xs px-4 flex-1 overflow-auto">
        {outputs.map((output, index) => (
          <div key={index}>{output.message}</div>
        ))}
      </div>
    </div>
  );

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

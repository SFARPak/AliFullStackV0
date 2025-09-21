import { appOutputAtom, frontendTerminalOutputAtom, backendTerminalOutputAtom, activeTerminalAtom } from "@/atoms/appAtoms";
import { useAtomValue, useSetAtom } from "jotai";

// Console component with multi-terminal support
export const Console = () => {
  const appOutput = useAtomValue(appOutputAtom);
  const frontendTerminalOutput = useAtomValue(frontendTerminalOutputAtom);
  const backendTerminalOutput = useAtomValue(backendTerminalOutputAtom);
  const activeTerminal = useAtomValue(activeTerminalAtom);
  const setActiveTerminal = useSetAtom(activeTerminalAtom);

  // Determine which output to show based on active terminal
  const getCurrentOutput = () => {
    switch (activeTerminal) {
      case "frontend":
        return frontendTerminalOutput;
      case "backend":
        return backendTerminalOutput;
      case "main":
      default:
        return appOutput;
    }
  };

  const currentOutput = getCurrentOutput();

  // Show terminal tabs only in fullstack mode (when we have multiple terminals)
  const showTabs = frontendTerminalOutput.length > 0 || backendTerminalOutput.length > 0;

  return (
    <div className="flex flex-col h-full">
      {showTabs && (
        <div className="flex border-b border-border bg-[var(--background)]">
          <button
            onClick={() => setActiveTerminal("main")}
            className={`px-3 py-1 text-xs font-medium ${
              activeTerminal === "main"
                ? "border-b-2 border-blue-500 text-blue-500"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            System ({appOutput.length})
          </button>
          {frontendTerminalOutput.length > 0 && (
            <button
              onClick={() => setActiveTerminal("frontend")}
              className={`px-3 py-1 text-xs font-medium ${
                activeTerminal === "frontend"
                  ? "border-b-2 border-green-500 text-green-500"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Frontend ({frontendTerminalOutput.length})
            </button>
          )}
          {backendTerminalOutput.length > 0 && (
            <button
              onClick={() => setActiveTerminal("backend")}
              className={`px-3 py-1 text-xs font-medium ${
                activeTerminal === "backend"
                  ? "border-b-2 border-orange-500 text-orange-500"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Backend ({backendTerminalOutput.length})
            </button>
          )}
        </div>
      )}
      <div className="font-mono text-xs px-4 flex-1 overflow-auto">
        {currentOutput.map((output, index) => (
          <div key={index}>{output.message}</div>
        ))}
      </div>
    </div>
  );
};

import { safeSend } from "../utils/safe_sender";
import { frontendTerminalOutputAtom, backendTerminalOutputAtom, activeTerminalAtom } from "../../atoms/appAtoms";
import { getDefaultStore } from "jotai";
import log from "electron-log";

const logger = log.scope("terminal_handlers");

export function registerTerminalHandlers() {
  // No IPC handlers needed - this module handles terminal output routing
}

// Function to add output to a specific terminal
export function addTerminalOutput(appId: number, terminal: "frontend" | "backend", message: string, type: "command" | "output" | "success" | "error" = "output") {
  const store = getDefaultStore();

  // Format message with timestamp and type indicator
  const timestamp = new Date().toLocaleTimeString();
  let formattedMessage = `[${timestamp}] ${message}`;

  // Add type-specific formatting
  if (type === "command") {
    formattedMessage = `\x1b[36m${formattedMessage}\x1b[0m`; // Cyan for commands
  } else if (type === "success") {
    formattedMessage = `\x1b[32m${formattedMessage}\x1b[0m`; // Green for success
  } else if (type === "error") {
    formattedMessage = `\x1b[31m${formattedMessage}\x1b[0m`; // Red for errors
  }

  // Map our types to AppOutput types
  let appOutputType: "stdout" | "stderr" | "info" | "client-error" | "input-requested";
  switch (type) {
    case "error":
      appOutputType = "stderr";
      break;
    case "success":
    case "command":
      appOutputType = "info";
      break;
    default:
      appOutputType = "stdout";
  }

  const outputItem = {
    message: formattedMessage,
    timestamp: Date.now(),
    type: appOutputType,
    appId
  };

  if (terminal === "frontend") {
    const currentOutput = store.get(frontendTerminalOutputAtom);
    store.set(frontendTerminalOutputAtom, [...currentOutput, outputItem]);

    // Auto-switch to frontend terminal if it's empty
    if (currentOutput.length === 0) {
      store.set(activeTerminalAtom, "frontend");
    }
  } else if (terminal === "backend") {
    const currentOutput = store.get(backendTerminalOutputAtom);
    store.set(backendTerminalOutputAtom, [...currentOutput, outputItem]);

    // Auto-switch to backend terminal if it's empty
    if (currentOutput.length === 0) {
      store.set(activeTerminalAtom, "backend");
    }
  }

  logger.log(`Added ${type} output to ${terminal} terminal: ${message}`);
}
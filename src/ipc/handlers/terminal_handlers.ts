import { safeSend } from "../utils/safe_sender";
import { frontendTerminalOutputAtom, backendTerminalOutputAtom, activeTerminalAtom, appOutputAtom } from "../../atoms/appAtoms";
import { getDefaultStore } from "jotai";
import log from "electron-log";

const logger = log.scope("terminal_handlers");

export function registerTerminalHandlers() {
  // No IPC handlers needed - this module handles terminal output routing
}

// Function to add output to a specific terminal
export function addTerminalOutput(appId: number, terminal: "main" | "frontend" | "backend", message: string, type: "command" | "output" | "success" | "error" = "output") {
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

  if (terminal === "main") {
    // Main (system) terminal - add to the general app output
    const currentOutput = store.get(appOutputAtom);
    store.set(appOutputAtom, [...currentOutput, outputItem]);

    // Auto-switch to main terminal if it's empty
    if (currentOutput.length === 0) {
      store.set(activeTerminalAtom, "main");
    }
  } else if (terminal === "frontend") {
    const currentOutput = store.get(frontendTerminalOutputAtom);
    store.set(frontendTerminalOutputAtom, [...currentOutput, outputItem]);

    // Auto-switch to frontend terminal if it's empty
    if (currentOutput.length === 0) {
      store.set(activeTerminalAtom, "frontend");
    }
  } else if (terminal === "backend") {
    // Backend terminal - combine with main (system) terminal
    const currentOutput = store.get(appOutputAtom);
    const backendMessage = `[BACKEND] ${formattedMessage}`; // Prefix backend messages
    const backendOutputItem = {
      ...outputItem,
      message: backendMessage
    };
    store.set(appOutputAtom, [...currentOutput, backendOutputItem]);

    // Also keep in separate backend atom for backward compatibility if needed
    const backendCurrent = store.get(backendTerminalOutputAtom);
    store.set(backendTerminalOutputAtom, [...backendCurrent, outputItem]);

    // Auto-switch to main terminal (where backend output appears)
    if (currentOutput.length === 0) {
      store.set(activeTerminalAtom, "main");
    }
  }

  logger.log(`Added ${type} output to ${terminal} terminal: ${message}`);
}
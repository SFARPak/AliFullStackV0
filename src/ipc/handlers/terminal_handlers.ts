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

  // Create output item for system console (complete log)
  const systemOutputItem = {
    message: formattedMessage,
    timestamp: Date.now(),
    type: appOutputType,
    appId
  };

  // Always add to system console (complete log)
  const systemCurrentOutput = store.get(appOutputAtom);
  store.set(appOutputAtom, [...systemCurrentOutput, systemOutputItem]);

  // Also add to specific terminal based on command type
  if (terminal === "frontend") {
    // Add to frontend terminal
    const frontendCurrent = store.get(frontendTerminalOutputAtom);
    store.set(frontendTerminalOutputAtom, [...frontendCurrent, systemOutputItem]);

    // Auto-switch to frontend terminal if it's empty
    if (frontendCurrent.length === 0) {
      store.set(activeTerminalAtom, "frontend");
    }
  } else if (terminal === "backend") {
    // Add to backend terminal
    const backendCurrent = store.get(backendTerminalOutputAtom);
    store.set(backendTerminalOutputAtom, [...backendCurrent, systemOutputItem]);

    // Auto-switch to backend terminal if it's empty
    if (backendCurrent.length === 0) {
      store.set(activeTerminalAtom, "backend");
    }
  } else if (terminal === "main") {
    // Main/bash commands - only in system console, no specific terminal

    // Auto-switch to main terminal if it's empty
    if (systemCurrentOutput.length === 0) {
      store.set(activeTerminalAtom, "main");
    }
  }

  logger.log(`Added ${type} output to ${terminal} terminal: ${message}`);
}
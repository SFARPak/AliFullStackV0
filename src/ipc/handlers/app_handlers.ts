import { ipcMain, app } from "electron";
import { db, getDatabasePath } from "../../db";
import { apps, chats, messages } from "../../db/schema";
import { desc, eq, like } from "drizzle-orm";
import type {
  App,
  CreateAppParams,
  RenameBranchParams,
  CopyAppParams,
  EditAppFileReturnType,
  RespondToAppInputParams,
} from "../ipc_types";
import fs from "node:fs";
import path from "node:path";
import { getDyadAppPath, getUserDataPath } from "../../paths/paths";
import { ChildProcess, spawn } from "node:child_process";
import git from "isomorphic-git";
import { promises as fsPromises } from "node:fs";

// Import our utility modules
import { withLock } from "../utils/lock_utils";
import { getFilesRecursively } from "../utils/file_utils";
import {
  runningApps,
  processCounter,
  removeAppIfCurrentProcess,
  stopAppByInfo,
  removeDockerVolumesForApp,
} from "../utils/process_manager";
import { getEnvVar } from "../utils/read_env";
import { readSettings } from "../../main/settings";

import fixPath from "fix-path";

import killPort from "kill-port";
import util from "util";
import log from "electron-log";
import {
  deploySupabaseFunctions,
  getSupabaseProjectName,
} from "../../supabase_admin/supabase_management_client";
import { createLoggedHandler } from "./safe_handle";
import { getLanguageModelProviders } from "../shared/language_model_helpers";
import { startProxy } from "../utils/start_proxy_server";
import { Worker } from "worker_threads";
import { createFromTemplate, setupBackendFramework, getStartCommandForFramework } from "./createFromTemplate";
import { gitCommit } from "../utils/git_utils";
import { safeSend } from "../utils/safe_sender";
import { normalizePath } from "../../../shared/normalizePath";
import { isServerFunction } from "@/supabase_admin/supabase_utils";
import { getVercelTeamSlug } from "../utils/vercel_utils";
import { storeDbTimestampAtCurrentVersion } from "../utils/neon_timestamp_utils";
import { AppSearchResult } from "@/lib/schemas";
import { CreateMissingFolderParams } from "../ipc_types";
import { developmentOrchestrator } from "../utils/development_orchestrator";

const DEFAULT_COMMAND =
  "(node -e \"try { const pkg = require('./package.json'); if (pkg.dependencies && pkg.dependencies['@SFARPak/react-vite-component-tagger']) { delete pkg.dependencies['@SFARPak/react-vite-component-tagger']; require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2)); } if (pkg.devDependencies && pkg.devDependencies['@SFARPak/react-vite-component-tagger']) { delete pkg.devDependencies['@SFARPak/react-vite-component-tagger']; require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2)); } } catch(e) {}; try { const fs = require('fs'); if (fs.existsSync('./vite.config.ts')) { let config = fs.readFileSync('./vite.config.ts', 'utf8'); config = config.replace(/import.*@SFARPak\\/react-vite-component-tagger.*;\\s*/g, ''); config = config.replace(/dyadComponentTagger[^}]*},?\\s*/g, ''); config = config.replace(/applyComponentTagger[^}]*},?\\s*/g, ''); fs.writeFileSync('./vite.config.ts', config); } } catch(e) {}\" && pnpm install && pnpm run dev --port 32100) || (node -e \"try { const pkg = require('./package.json'); if (pkg.dependencies && pkg.dependencies['@SFARPak/react-vite-component-tagger']) { delete pkg.dependencies['@SFARPak/react-vite-component-tagger']; require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2)); } if (pkg.devDependencies && pkg.devDependencies['@SFARPak/react-vite-component-tagger']) { delete pkg.devDependencies['@SFARPak/react-vite-component-tagger']; require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2)); } } catch(e) {}; try { const fs = require('fs'); if (fs.existsSync('./vite.config.ts')) { let config = fs.readFileSync('./vite.config.ts', 'utf8'); config = config.replace(/import.*@SFARPak\\/react-vite-component-tagger.*;\\s*/g, ''); config = config.replace(/dyadComponentTagger[^}]*},?\\s*/g, ''); config = config.replace(/applyComponentTagger[^}]*},?\\s*/g, ''); fs.writeFileSync('./vite.config.ts', config); } } catch(e) {}\" && npm install --legacy-peer-deps && npm run dev -- --port 32100)";
async function copyDir(
  source: string,
  destination: string,
  filter?: (source: string) => boolean,
) {
  await fsPromises.cp(source, destination, {
    recursive: true,
    filter: (src: string) => {
      if (path.basename(src) === "node_modules") {
        return false;
      }
      if (filter) {
        return filter(src);
      }
      return true;
    },
  });
}

const logger = log.scope("app_handlers");
const handle = createLoggedHandler(logger);

let proxyWorker: Worker | null = null;

// Needed, otherwise electron in MacOS/Linux will not be able
// to find node/pnpm.
fixPath();

async function executeApp({
  appPath,
  appId,
  event, // Keep event for local-node case
  isNeon,
  installCommand,
  startCommand,
  terminalType,
}: {
  appPath: string;
  appId: number;
  event: Electron.IpcMainInvokeEvent;
  isNeon: boolean;
  installCommand?: string | null;
  startCommand?: string | null;
  terminalType?: "frontend" | "backend" | "main";
}): Promise<void> {
  if (proxyWorker) {
    proxyWorker.terminate();
    proxyWorker = null;
  }
  const settings = readSettings();
  const runtimeMode = settings.runtimeMode2 ?? "host";

  if (runtimeMode === "docker") {
    await executeAppInDocker({
      appPath,
      appId,
      event,
      isNeon,
      installCommand,
      startCommand,
    });
  } else {
    await executeAppLocalNode({
      appPath,
      appId,
      event,
      isNeon,
      installCommand,
      startCommand,
    });
  }
}

async function ensureBackendDirectory(backendPath: string): Promise<void> {
  // Create backend directory if it doesn't exist
  if (!fs.existsSync(backendPath)) {
    await fsPromises.mkdir(backendPath, { recursive: true });
    logger.info(`Created backend directory: ${backendPath}`);
  }

  // Check if backend directory is empty or missing key files
  const backendFiles = fs.readdirSync(backendPath);
  if (backendFiles.length === 0) {
    // Create a basic Python Flask backend structure
    const requirementsTxt = `flask==2.3.3
flask-cors==4.0.0
python-dotenv==1.0.0
`;

    const mainPy = `from flask import Flask, jsonify
from flask_cors import CORS
import os

app = Flask(__name__)
CORS(app)

@app.route('/')
def hello():
    return jsonify({"message": "Backend API is running!"})

@app.route('/api/health')
def health():
    return jsonify({"status": "healthy"})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    app.run(debug=True, host='0.0.0.0', port=port)
`;

    const startSh = `#!/bin/bash
# Start script for backend server
echo "Starting backend server..."
python main.py
`;

    try {
      await fsPromises.writeFile(path.join(backendPath, 'requirements.txt'), requirementsTxt, 'utf-8');
      await fsPromises.writeFile(path.join(backendPath, 'main.py'), mainPy, 'utf-8');
      await fsPromises.writeFile(path.join(backendPath, 'start.sh'), startSh, 'utf-8');

      // Make start.sh executable
      await fsPromises.chmod(path.join(backendPath, 'start.sh'), 0o755);

      logger.info(`Created basic Flask backend structure in ${backendPath}`);
    } catch (error) {
      logger.error(`Failed to create backend structure in ${backendPath}:`, error);
      throw error;
    }
  }
}

async function executeAppLocalNode({
  appPath,
  appId,
  event,
  isNeon,
  installCommand,
  startCommand,
}: {
  appPath: string;
  appId: number;
  event: Electron.IpcMainInvokeEvent;
  isNeon: boolean;
  installCommand?: string | null;
  startCommand?: string | null;
}): Promise<void> {
  // Determine working directory based on available folders
  const frontendPath = path.join(appPath, "frontend");
  const backendPath = path.join(appPath, "backend");

  const hasFrontend = fs.existsSync(frontendPath);
  const hasBackend = fs.existsSync(backendPath);

  // For fullstack mode (both frontend and backend exist), start both servers
  if (hasFrontend && hasBackend) {
    logger.info(`Fullstack mode detected - starting both frontend and backend servers for app ${appId}`);

    // Ensure backend directory exists and has proper structure
    await ensureBackendDirectory(backendPath);

    // Determine backend framework for proper server command
    let backendFramework: string | null = null;
    if (fs.existsSync(path.join(backendPath, "package.json"))) {
      backendFramework = "nodejs";
    } else if (fs.existsSync(path.join(backendPath, "requirements.txt"))) {
      // Check for framework-specific files
      if (fs.existsSync(path.join(backendPath, "manage.py"))) {
        backendFramework = "django";
      } else if (fs.existsSync(path.join(backendPath, "main.py"))) {
        backendFramework = "fastapi";
      } else if (fs.existsSync(path.join(backendPath, "app.py"))) {
        backendFramework = "flask";
      } else {
        backendFramework = "python";
      }
    }

    // Start backend server first
    try {
      let backendCommand: string;
      if (backendFramework) {
        backendCommand = await getStartCommandForFramework(backendFramework);
        if (!backendCommand) {
          backendCommand = getCommand({ installCommand, startCommand }); // Fallback
        }
      } else {
        backendCommand = getCommand({ installCommand, startCommand }); // Fallback
      }

      // Apply intelligent terminal routing for backend commands
      const isPythonBackend = backendCommand.toLowerCase().includes("python") ||
                             backendCommand.toLowerCase().includes("pip") ||
                             backendCommand.toLowerCase().includes("conda") ||
                             backendCommand.toLowerCase().includes("venv") ||
                             backendCommand.toLowerCase().includes("py ");

      const backendTerminalType = isPythonBackend ? "backend" : "main";

      logger.info(`[BACKEND_ROUTING] App ${appId} - Backend command: "${backendCommand}"`);
      logger.info(`[BACKEND_ROUTING] App ${appId} - Backend framework: ${backendFramework || 'unknown'}`);
      logger.info(`[BACKEND_ROUTING] App ${appId} - Python backend detected: ${isPythonBackend}`);
      logger.info(`[BACKEND_ROUTING] App ${appId} - Routing backend to ${backendTerminalType.toUpperCase()} terminal`);

      const backendProcess = spawn(backendCommand, [], {
        cwd: backendPath,
        shell: true,
        stdio: "pipe",
        detached: false,
      });

      if (backendProcess.pid) {
        const backendProcessId = processCounter.increment();
        runningApps.set(appId, {
          process: backendProcess,
          processId: backendProcessId,
          isDocker: false,
        });

        listenToProcess({
          process: backendProcess,
          appId,
          isNeon,
          event,
          terminalType: backendTerminalType,
        });

        logger.info(`Backend server started for fullstack app ${appId} (PID: ${backendProcess.pid}) - routing to ${backendTerminalType} terminal`);
      }
    } catch (error) {
      logger.error(`Failed to start backend server for fullstack app ${appId}:`, error);
    }

    // Start frontend server
    try {
      const frontendCommand = "npm run dev --port 32100";

      // Apply intelligent terminal routing for frontend commands
      const isNodeFrontend = frontendCommand.toLowerCase().includes("npm") ||
                            frontendCommand.toLowerCase().includes("yarn") ||
                            frontendCommand.toLowerCase().includes("pnpm") ||
                            frontendCommand.toLowerCase().includes("node") ||
                            frontendCommand.toLowerCase().includes("npx") ||
                            frontendCommand.toLowerCase().includes("vite") ||
                            frontendCommand.toLowerCase().includes("next") ||
                            frontendCommand.toLowerCase().includes("react") ||
                            frontendCommand.toLowerCase().includes("webpack");

      const frontendTerminalType = isNodeFrontend ? "frontend" : "main";

      logger.info(`[FRONTEND_ROUTING] App ${appId} - Frontend command: "${frontendCommand}"`);
      logger.info(`[FRONTEND_ROUTING] App ${appId} - Node.js frontend detected: ${isNodeFrontend}`);
      logger.info(`[FRONTEND_ROUTING] App ${appId} - Routing frontend to ${frontendTerminalType.toUpperCase()} terminal`);

      const frontendProcess = spawn(frontendCommand, [], {
        cwd: frontendPath,
        shell: true,
        stdio: "pipe",
        detached: false,
      });

      if (frontendProcess.pid) {
        const frontendProcessId = processCounter.increment();
        // For fullstack, we need multiple processes - store them with different keys
        runningApps.set(`${appId}-frontend`, {
          process: frontendProcess,
          processId: frontendProcessId,
          isDocker: false,
        });

        listenToProcess({
          process: frontendProcess,
          appId,
          isNeon,
          event,
          terminalType: frontendTerminalType,
        });

        logger.info(`Frontend server started for fullstack app ${appId} (PID: ${frontendProcess.pid}) - routing to ${frontendTerminalType} terminal`);
      }
    } catch (error) {
      logger.error(`Failed to start frontend server for fullstack app ${appId}:`, error);
    }

    return;
  }

  // For single-server modes (frontend-only or backend-only)
  let workingDir = appPath; // Default to root for backward compatibility

  if (hasFrontend && !hasBackend) {
    // Only frontend exists (frontend-only app)
    workingDir = frontendPath;
  } else if (hasBackend && !hasFrontend) {
    // Only backend exists (backend-only app)
    workingDir = backendPath;
  } else if (hasFrontend) {
    // Only frontend exists
    workingDir = frontendPath;
  } else if (hasBackend) {
    // Only backend exists
    workingDir = backendPath;
  }

  const command = getCommand({ installCommand, startCommand });

  // Apply intelligent terminal routing for app startup commands
  const isPythonCommand = command.toLowerCase().includes("python") ||
                         command.toLowerCase().includes("pip") ||
                         command.toLowerCase().includes("conda") ||
                         command.toLowerCase().includes("venv") ||
                         command.toLowerCase().includes("py ");

  const isNodeCommand = command.toLowerCase().includes("npm") ||
                       command.toLowerCase().includes("yarn") ||
                       command.toLowerCase().includes("pnpm") ||
                       command.toLowerCase().includes("node") ||
                       command.toLowerCase().includes("npx") ||
                       command.toLowerCase().includes("vite") ||
                       command.toLowerCase().includes("next") ||
                       command.toLowerCase().includes("react") ||
                       command.toLowerCase().includes("webpack");

  logger.info(`[APP_STARTUP_ROUTING] App ${appId} - Command: "${command}"`);
  logger.info(`[APP_STARTUP_ROUTING] App ${appId} - Working dir: ${workingDir}`);
  logger.info(`[APP_STARTUP_ROUTING] App ${appId} - Python command detected: ${isPythonCommand}`);
  logger.info(`[APP_STARTUP_ROUTING] App ${appId} - Node.js command detected: ${isNodeCommand}`);

  // Determine terminal type based on command content
  let terminalType: "frontend" | "backend" | "main" = "main";
  if (isPythonCommand) {
    terminalType = "backend";
    // Adjust working directory for Python commands
    if (hasBackend) {
      workingDir = backendPath;
    }
    logger.info(`[APP_STARTUP_ROUTING] App ${appId} - Routing to BACKEND terminal (Python command)`);
  } else if (isNodeCommand) {
    terminalType = "frontend";
    // Adjust working directory for Node.js commands
    if (hasFrontend) {
      workingDir = frontendPath;
    }
    logger.info(`[APP_STARTUP_ROUTING] App ${appId} - Routing to FRONTEND terminal (Node.js command)`);
  } else {
    // Default terminal type based on working directory
    terminalType = workingDir === backendPath ? "backend" : workingDir === frontendPath ? "frontend" : "main";
    logger.info(`[APP_STARTUP_ROUTING] App ${appId} - Routing to ${terminalType.toUpperCase()} terminal (default)`);
  }

  const spawnedProcess = spawn(command, [], {
    cwd: workingDir,
    shell: true,
    stdio: "pipe", // Ensure stdio is piped so we can capture output/errors and detect close
    detached: false, // Ensure child process is attached to the main process lifecycle unless explicitly backgrounded
  });

  // Check if process spawned correctly
  if (!spawnedProcess.pid) {
    // Attempt to capture any immediate errors if possible
    let errorOutput = "";
    spawnedProcess.stderr?.on("data", (data) => (errorOutput += data));
    await new Promise((resolve) => spawnedProcess.on("error", resolve)); // Wait for error event
    throw new Error(
      `Failed to spawn process for app ${appId}. Error: ${
        errorOutput || "Unknown spawn error"
      }`,
    );
  }

  // Increment the counter and store the process reference with its ID
  const currentProcessId = processCounter.increment();
  runningApps.set(appId, {
    process: spawnedProcess,
    processId: currentProcessId,
    isDocker: false,
  });

  listenToProcess({
    process: spawnedProcess,
    appId,
    isNeon,
    event,
    terminalType,
  });
}

function listenToProcess({
  process: spawnedProcess,
  appId,
  isNeon,
  event,
  terminalType,
}: {
  process: ChildProcess;
  appId: number;
  isNeon: boolean;
  event: Electron.IpcMainInvokeEvent;
  terminalType?: "frontend" | "backend" | "main";
}) {
  // Import the terminal output function for specific terminal routing
  const { addTerminalOutput } = require("../handlers/terminal_handlers");

  // Log output
  spawnedProcess.stdout?.on("data", async (data) => {
    const message = util.stripVTControlCharacters(data.toString());
    logger.debug(
      `App ${appId} (PID: ${spawnedProcess.pid}) stdout: ${message}`,
    );

    // This is a hacky heuristic to pick up when drizzle is asking for user
    // to select from one of a few choices. We automatically pick the first
    // option because it's usually a good default choice. We guard this with
    // isNeon because: 1) only Neon apps (for the official Dyad templates) should
    // get this template and 2) it's safer to do this with Neon apps because
    // their databases have point in time restore built-in.
    if (isNeon && message.includes("created or renamed from another")) {
      spawnedProcess.stdin?.write(`\r\n`);
      logger.info(
        `App ${appId} (PID: ${spawnedProcess.pid}) wrote enter to stdin to automatically respond to drizzle push input`,
      );
    }

    // Check if this is an interactive prompt requiring user input
    const inputRequestPattern = /\s*›\s*\([yY]\/[nN]\)\s*$/;
    const isInputRequest = inputRequestPattern.test(message);
    if (isInputRequest) {
      // Send special input-requested event for interactive prompts
      safeSend(event.sender, "app:output", {
        type: "input-requested",
        message,
        appId,
      });
    } else {
      // Route output based on terminal type
      if (terminalType === "frontend" || terminalType === "backend") {
        // Send to specific terminal using the Jotai atoms approach
        addTerminalOutput(appId, terminalType, message, "output");
      } else {
        // Send to main app output (System Console) using IPC approach
        safeSend(event.sender, "app:output", {
          type: "stdout",
          message,
          appId,
        });
      }

      const urlMatch = message.match(/(https?:\/\/localhost:\d+\/?)/);
      if (urlMatch) {
        proxyWorker = await startProxy(urlMatch[1], {
          onStarted: (proxyUrl) => {
            safeSend(event.sender, "app:output", {
              type: "stdout",
              message: `[AliFullStack-proxy-server]started=[${proxyUrl}] original=[${urlMatch[1]}]`,
              appId,
            });
          },
        });
      }
    }
  });

  spawnedProcess.stderr?.on("data", (data) => {
    const message = util.stripVTControlCharacters(data.toString());
    logger.error(
      `App ${appId} (PID: ${spawnedProcess.pid}) stderr: ${message}`,
    );

    // Route error output based on terminal type
    if (terminalType === "frontend" || terminalType === "backend") {
      // Send to specific terminal using the Jotai atoms approach
      addTerminalOutput(appId, terminalType, message, "error");
    } else {
      // Send to main app output (System Console) using IPC approach
      safeSend(event.sender, "app:output", {
        type: "stderr",
        message,
        appId,
      });
    }
  });

  // Handle process exit/close
  spawnedProcess.on("close", (code, signal) => {
    logger.log(
      `App ${appId} (PID: ${spawnedProcess.pid}) process closed with code ${code}, signal ${signal}.`,
    );
    removeAppIfCurrentProcess(appId, spawnedProcess);
  });

  // Handle errors during process lifecycle (e.g., command not found)
  spawnedProcess.on("error", (err) => {
    logger.error(
      `Error in app ${appId} (PID: ${spawnedProcess.pid}) process: ${err.message}`,
    );
    removeAppIfCurrentProcess(appId, spawnedProcess);
    // Note: We don't throw here as the error is asynchronous. The caller got a success response already.
    // Consider adding ipcRenderer event emission to notify UI of the error.
  });
}

async function executeAppInDocker({
  appPath,
  appId,
  event,
  isNeon,
  installCommand,
  startCommand,
}: {
  appPath: string;
  appId: number;
  event: Electron.IpcMainInvokeEvent;
  isNeon: boolean;
  installCommand?: string | null;
  startCommand?: string | null;
}): Promise<void> {
  const containerName = `dyad-app-${appId}`;

  // First, check if Docker is available
  try {
    await new Promise<void>((resolve, reject) => {
      const checkDocker = spawn("docker", ["--version"], { stdio: "pipe" });
      checkDocker.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error("Docker is not available"));
        }
      });
      checkDocker.on("error", () => {
        reject(new Error("Docker is not available"));
      });
    });
  } catch {
    throw new Error(
      "Docker is required but not available. Please install Docker Desktop and ensure it's running.",
    );
  }

  // Stop and remove any existing container with the same name
  try {
    await new Promise<void>((resolve) => {
      const stopContainer = spawn("docker", ["stop", containerName], {
        stdio: "pipe",
      });
      stopContainer.on("close", () => {
        const removeContainer = spawn("docker", ["rm", containerName], {
          stdio: "pipe",
        });
        removeContainer.on("close", () => resolve());
        removeContainer.on("error", () => resolve()); // Container might not exist
      });
      stopContainer.on("error", () => resolve()); // Container might not exist
    });
  } catch (error) {
    logger.info(
      `Docker container ${containerName} not found. Ignoring error: ${error}`,
    );
  }

  // Create a Dockerfile in the app directory if it doesn't exist
  const dockerfilePath = path.join(appPath, "Dockerfile.dyad");
  if (!fs.existsSync(dockerfilePath)) {
    const dockerfileContent = `FROM node:22-alpine

# Install pnpm
RUN npm install -g pnpm
`;

    try {
      await fsPromises.writeFile(dockerfilePath, dockerfileContent, "utf-8");
    } catch (error) {
      logger.error(`Failed to create Dockerfile for app ${appId}:`, error);
      throw new Error(`Failed to create Dockerfile: ${error}`);
    }
  }

  // Build the Docker image
  const buildProcess = spawn(
    "docker",
    ["build", "-f", "Dockerfile.dyad", "-t", `dyad-app-${appId}`, "."],
    {
      cwd: appPath,
      stdio: "pipe",
    },
  );

  let buildError = "";
  buildProcess.stderr?.on("data", (data) => {
    buildError += data.toString();
  });

  await new Promise<void>((resolve, reject) => {
    buildProcess.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Docker build failed: ${buildError}`));
      }
    });
    buildProcess.on("error", (err) => {
      reject(new Error(`Docker build process error: ${err.message}`));
    });
  });

  // Determine working directory based on available folders
  const frontendPath = path.join(appPath, "frontend");
  const backendPath = path.join(appPath, "backend");

  let workingDir = "/app"; // Default to root for backward compatibility

  if (fs.existsSync(frontendPath) && !fs.existsSync(backendPath)) {
    // Only frontend exists (frontend-only app)
    workingDir = "/app/frontend";
  } else if (fs.existsSync(backendPath) && !fs.existsSync(frontendPath)) {
    // Only backend exists (backend-only app)
    workingDir = "/app/backend";
  } else if (fs.existsSync(frontendPath) && fs.existsSync(backendPath)) {
    // Both exist - prefer frontend since it has the package.json and dev server
    workingDir = "/app/frontend";
  } else if (fs.existsSync(frontendPath)) {
    // Only frontend exists
    workingDir = "/app/frontend";
  } else if (fs.existsSync(backendPath)) {
    // Only backend exists
    workingDir = "/app/backend";
  }

  // Run the Docker container
  const process = spawn(
    "docker",
    [
      "run",
      "--rm",
      "--name",
      containerName,
      "-p",
      "32100:32100",
      "-v",
      `${appPath}:/app`,
      "-v",
      `dyad-pnpm-${appId}:/app/.pnpm-store`,
      "-e",
      "PNPM_STORE_PATH=/app/.pnpm-store",
      "-w",
      workingDir,
      `dyad-app-${appId}`,
      "sh",
      "-c",
      getCommand({ installCommand, startCommand }),
    ],
    {
      stdio: "pipe",
      detached: false,
    },
  );

  // Check if process spawned correctly
  if (!process.pid) {
    // Attempt to capture any immediate errors if possible
    let errorOutput = "";
    process.stderr?.on("data", (data) => (errorOutput += data));
    await new Promise((resolve) => process.on("error", resolve)); // Wait for error event
    throw new Error(
      `Failed to spawn Docker container for app ${appId}. Error: ${
        errorOutput || "Unknown spawn error"
      }`,
    );
  }

  // Increment the counter and store the process reference with its ID
  const currentProcessId = processCounter.increment();
  runningApps.set(appId, {
    process,
    processId: currentProcessId,
    isDocker: true,
    containerName,
  });

  listenToProcess({
    process,
    appId,
    isNeon,
    event,
  });
}

// Helper to kill process on a specific port (cross-platform, using kill-port)
async function killProcessOnPort(port: number): Promise<void> {
  try {
    await killPort(port, "tcp");
  } catch {
    // Ignore if nothing was running on that port
  }
}

// Helper to stop any Docker containers publishing a given host port
async function stopDockerContainersOnPort(port: number): Promise<void> {
  try {
    // List container IDs that publish the given port
    const list = spawn("docker", ["ps", "--filter", `publish=${port}`, "-q"], {
      stdio: "pipe",
    });

    let stdout = "";
    list.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    await new Promise<void>((resolve) => {
      list.on("close", () => resolve());
      list.on("error", () => resolve());
    });

    const containerIds = stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    if (containerIds.length === 0) {
      return;
    }

    // Stop each container best-effort
    await Promise.all(
      containerIds.map(
        (id) =>
          new Promise<void>((resolve) => {
            const stop = spawn("docker", ["stop", id], { stdio: "pipe" });
            stop.on("close", () => resolve());
            stop.on("error", () => resolve());
          }),
      ),
    );
  } catch (e) {
    logger.warn(`Failed stopping Docker containers on port ${port}: ${e}`);
  }
}

export function registerAppHandlers() {
  handle("restart-dyad", async () => {
    app.relaunch();
    app.quit();
  });

  handle(
    "create-app",
    async (
      _,
      params: CreateAppParams,
    ): Promise<{ app: any; chatId: number }> => {
      const appPath = params.name;
      const fullAppPath = getDyadAppPath(appPath);
      if (fs.existsSync(fullAppPath)) {
        throw new Error(`App already exists at: ${fullAppPath}`);
      }
      // Create a new app
      const [app] = await db
        .insert(apps)
        .values({
          name: params.name,
          // Use the name as the path for now
          path: appPath,
        })
        .returning();

      // Create an initial chat for this app
      const [chat] = await db
        .insert(chats)
        .values({
          appId: app.id,
        })
        .returning();

      await createFromTemplate({
        fullAppPath,
        selectedTemplateId: params.selectedTemplateId,
        selectedBackendFramework: params.selectedBackendFramework,
        isFullStack: params.isFullStack,
      });

      // Initialize git repo and create first commit
      try {
        logger.info(`Initializing Git repository for app: ${fullAppPath}`);

        // Check if .git already exists (might happen if copy/app creation already set it up)
        if (!fs.existsSync(path.join(fullAppPath, '.git'))) {
          await git.init({
            fs: fs,
            dir: fullAppPath,
            defaultBranch: "main",
          });
          logger.info(`Git repository initialized successfully`);
        } else {
          logger.info(`Git repository already exists, verifying...`);

          // Verify the main branch exists
          try {
            const branches = await git.listBranches({ fs, dir: fullAppPath });
            if (!branches.includes('main')) {
              logger.warn(`Main branch not found, checking out main`);
              await git.checkout({
                fs,
                dir: fullAppPath,
                ref: 'main',
                force: true, // Force checkout if needed
              });
            }
          } catch (branchError) {
            logger.warn(`Error checking branches, forcing main branch creation:`, branchError);
            // Try to create main branch explicitly
            try {
              await git.checkout({
                fs,
                dir: fullAppPath,
                ref: 'main',
                force: true,
              });
            } catch (createError) {
              logger.warn(`Failed to create main branch:`, createError);
            }
          }
        }

        // Stage all files
        let addedSuccess = false;
        try {
          await git.add({
            fs: fs,
            dir: fullAppPath,
            filepath: ".",
          });
          addedSuccess = true;
          logger.info(`Files staged successfully`);
        } catch (addError) {
          logger.warn(`Failed to stage files:`, addError);
          // Continue anyway - might be empty directory
        }

        // Create initial commit
        if (addedSuccess) {
          try {
            const commitHash = await gitCommit({
              path: fullAppPath,
              message: "Init AliFullStack app",
            });
            logger.info(`Initial commit created: ${commitHash}`);

            // Update chat with initial commit hash
            await db
              .update(chats)
              .set({
                initialCommitHash: commitHash,
              })
              .where(eq(chats.id, chat.id));
          } catch (commitError) {
            logger.error(`Failed to create initial commit:`, commitError);
            // Don't fail the app creation for commit errors
          }
        } else {
          logger.warn(`Skipping commit due to staging failure`);
        }

        logger.info(`Git setup completed for app ${app.id}`);
      } catch (gitError) {
        logger.error(`Failed to initialize Git repository:`, gitError);
        // Don't fail app creation for Git errors - Git is optional
        logger.warn(`App ${app.id} created without Git repository`);
      }

      // Start autonomous development process
      try {
        logger.info(`Starting autonomous development for app ${app.id}`);
        const requirements: string[] = []; // Requirements will be gathered during development
        developmentOrchestrator.startAutonomousDevelopment(
          app.id,
          "react", // default frontend framework
          params.selectedBackendFramework || undefined,
          requirements
        );
        logger.info(`Autonomous development started for app ${app.id}`);
      } catch (devError) {
        logger.error(`Failed to start autonomous development for app ${app.id}:`, devError);
        // Don't fail app creation if autonomous development fails to start
        logger.warn(`App ${app.id} created but autonomous development failed to start`);
      }

      return { app, chatId: chat.id };
    },
  );

  handle(
    "create-missing-folder",
    async (
      _,
      params: CreateMissingFolderParams,
    ): Promise<void> => {
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, params.appId),
      });

      if (!app) {
        throw new Error("App not found");
      }

      const fullAppPath = getDyadAppPath(app.path);
      const settings = readSettings();

      if (params.folderType === "frontend") {
        const templateId = params.templateId || settings.selectedTemplateId;
        logger.info(`Creating missing frontend folder for app ${params.appId} with template: ${templateId}`);

        await createFromTemplate({
          fullAppPath,
          selectedTemplateId: templateId,
          selectedBackendFramework: null, // Don't create backend when just adding frontend
        });

        // Install frontend dependencies if they exist
        const frontendPath = path.join(fullAppPath, "frontend");
        logger.info(`Checking frontend path: ${frontendPath}`);
        if (fs.existsSync(frontendPath)) {
          logger.info(`Frontend directory exists at: ${frontendPath}`);
          const packageJsonPath = path.join(frontendPath, "package.json");
          logger.info(`Checking for package.json at: ${packageJsonPath}`);
          if (fs.existsSync(packageJsonPath)) {
            logger.info(`Found package.json, installing frontend dependencies in ${frontendPath}`);
            try {
              await installDependencies(frontendPath, "nodejs");
            } catch (installError) {
              logger.warn(`Failed to install frontend dependencies:`, installError);
              // Continue with the process even if dependency installation fails
            }
          } else {
            logger.error(`package.json not found at ${packageJsonPath}`);
            // List files in frontend directory to debug
            try {
              const files = fs.readdirSync(frontendPath);
              logger.info(`Files in frontend directory after creation: ${files.join(', ')}`);
            } catch (listError) {
              logger.error(`Could not list files in frontend directory:`, listError);
            }

            // Create a fallback package.json if the copy failed
            logger.info(`Creating fallback package.json for frontend`);
            const fallbackPackageJson = `{
  "name": "frontend",
  "version": "0.1.0",
  "private": true,
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.0.0",
    "vite": "^4.3.0",
    "typescript": "^5.0.0"
  },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}`;

            try {
              await fsPromises.writeFile(packageJsonPath, fallbackPackageJson, 'utf-8');
              logger.info(`Created fallback package.json at ${packageJsonPath}`);
              // Now try to install dependencies
              await installDependencies(frontendPath, "nodejs");
            } catch (fallbackError) {
              logger.error(`Failed to create fallback package.json:`, fallbackError);
            }
          }
        } else {
          logger.error(`Frontend directory not found at ${frontendPath}`);
        }
      } else if (params.folderType === "backend") {
        const backendFramework = params.backendFramework || settings.selectedBackendFramework;
        if (!backendFramework) {
          throw new Error("No backend framework selected. Please select a backend framework first.");
        }

        logger.info(`Creating missing backend folder for app ${params.appId} with framework: ${backendFramework}`);

        // Only create backend folder
        const backendPath = path.join(fullAppPath, "backend");
        if (!fs.existsSync(backendPath)) {
          await fsPromises.mkdir(backendPath, { recursive: true });
          await setupBackendFramework(backendPath, backendFramework);

          // Install dependencies for the backend framework
          try {
            logger.info(`Installing dependencies for ${backendFramework} in ${backendPath}`);
            await installDependencies(backendPath, backendFramework);
          } catch (installError) {
            logger.warn(`Failed to install dependencies for ${backendFramework}:`, installError);
            // Continue with the process even if dependency installation fails
          }

          // Commit the changes
          await git.add({
            fs: fs,
            dir: fullAppPath,
            filepath: "backend",
          });

          await gitCommit({
            path: fullAppPath,
            message: `Add backend folder with ${backendFramework}`,
          });
        }
      }
    },
  );

  handle(
    "copy-app",
    async (_, params: CopyAppParams): Promise<{ app: any }> => {
      const { appId, newAppName, withHistory } = params;

      // 1. Check if an app with the new name already exists
      const existingApp = await db.query.apps.findFirst({
        where: eq(apps.name, newAppName),
      });

      if (existingApp) {
        throw new Error(`An app named "${newAppName}" already exists.`);
      }

      // 2. Find the original app
      const originalApp = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });

      if (!originalApp) {
        throw new Error("Original app not found.");
      }

      const originalAppPath = getDyadAppPath(originalApp.path);
      const newAppPath = getDyadAppPath(newAppName);

      // 3. Copy the app folder
      try {
        await copyDir(originalAppPath, newAppPath, (source: string) => {
          if (!withHistory && path.basename(source) === ".git") {
            return false;
          }
          return true;
        });
      } catch (error) {
        logger.error("Failed to copy app directory:", error);
        throw new Error("Failed to copy app directory.");
      }

      if (!withHistory) {
        // Initialize git repo and create first commit
        await git.init({
          fs: fs,
          dir: newAppPath,
          defaultBranch: "main",
        });

        // Stage all files
        await git.add({
          fs: fs,
          dir: newAppPath,
          filepath: ".",
        });

        // Create initial commit
        await gitCommit({
          path: newAppPath,
          message: "Init AliFullStack app",
        });
      }

      // 4. Create a new app entry in the database
      const [newDbApp] = await db
        .insert(apps)
        .values({
          name: newAppName,
          path: newAppName, // Use the new name for the path
          // Explicitly set these to null because we don't want to copy them over.
          // Note: we could just leave them out since they're nullable field, but this
          // is to make it explicit we intentionally don't want to copy them over.
          supabaseProjectId: null,
          githubOrg: null,
          githubRepo: null,
          installCommand: originalApp.installCommand,
          startCommand: originalApp.startCommand,
        })
        .returning();

      return { app: newDbApp };
    },
  );

  handle("get-app", async (_, appId: number): Promise<App> => {
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      throw new Error("App not found");
    }

    // Get app files
    const appPath = getDyadAppPath(app.path);
    let allFiles: string[] = [];

    // Scan frontend folder if it exists
    const frontendPath = path.join(appPath, "frontend");
    if (fs.existsSync(frontendPath)) {
      try {
        const frontendFiles = getFilesRecursively(frontendPath, frontendPath);
        const frontendFilesWithPrefix = frontendFiles.map((filePath) => {
          const normalized = normalizePath(filePath);
          return `frontend/${normalized}`;
        });
        allFiles.push(...frontendFilesWithPrefix);
      } catch (error) {
        logger.error(`Error reading frontend files for app ${appId}:`, error);
      }
    }

    // Scan backend folder if it exists
    const backendPath = path.join(appPath, "backend");
    if (fs.existsSync(backendPath)) {
      try {
        const backendFiles = getFilesRecursively(backendPath, backendPath);
        const backendFilesWithPrefix = backendFiles.map((filePath) => {
          const normalized = normalizePath(filePath);
          return `backend/${normalized}`;
        });
        allFiles.push(...backendFilesWithPrefix);
      } catch (error) {
        logger.error(`Error reading backend files for app ${appId}:`, error);
      }
    }

    // If no frontend/backend folders exist, scan the root (for backward compatibility)
    if (allFiles.length === 0) {
      try {
        allFiles = getFilesRecursively(appPath, appPath);
        // Normalize the path to use forward slashes so file tree (UI)
        // can parse it more consistently across platforms.
        allFiles = allFiles.map((filePath) => normalizePath(filePath));
      } catch (error) {
        logger.error(`Error reading files for app ${appId}:`, error);
      }
    }

    const files = allFiles;

    let supabaseProjectName: string | null = null;
    const settings = readSettings();
    if (app.supabaseProjectId && settings.supabase?.accessToken?.value) {
      supabaseProjectName = await getSupabaseProjectName(app.supabaseProjectId);
    }

    let vercelTeamSlug: string | null = null;
    if (app.vercelTeamId) {
      vercelTeamSlug = await getVercelTeamSlug(app.vercelTeamId);
    }

    return {
      ...app,
      files,
      supabaseProjectName,
      vercelTeamSlug,
    };
  });

  ipcMain.handle("list-apps", async () => {
    const allApps = await db.query.apps.findMany({
      orderBy: [desc(apps.createdAt)],
    });
    return {
      apps: allApps,
      appBasePath: getDyadAppPath("$APP_BASE_PATH"),
    };
  });

  ipcMain.handle(
    "read-app-file",
    async (_, { appId, filePath }: { appId: number; filePath: string }) => {
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });

      if (!app) {
        throw new Error("App not found");
      }

      const appPath = getDyadAppPath(app.path);
      let fullPath: string;

      // Check if the filePath starts with frontend/ or backend/
      if (filePath.startsWith("frontend/")) {
        const frontendPath = path.join(appPath, "frontend");
        const relativePath = filePath.substring("frontend/".length);
        fullPath = path.join(frontendPath, relativePath);
      } else if (filePath.startsWith("backend/")) {
        const backendPath = path.join(appPath, "backend");
        const relativePath = filePath.substring("backend/".length);
        fullPath = path.join(backendPath, relativePath);
      } else {
        // For backward compatibility, try frontend first, then backend, then root
        const frontendPath = path.join(appPath, "frontend", filePath);
        const backendPath = path.join(appPath, "backend", filePath);
        const rootPath = path.join(appPath, filePath);

        if (fs.existsSync(frontendPath)) {
          fullPath = frontendPath;
        } else if (fs.existsSync(backendPath)) {
          fullPath = backendPath;
        } else {
          fullPath = rootPath;
        }
      }

      // Check if the path is within the app directory (security check)
      if (!fullPath.startsWith(appPath)) {
        throw new Error("Invalid file path");
      }

      if (!fs.existsSync(fullPath)) {
        throw new Error("File not found");
      }

      try {
        const contents = fs.readFileSync(fullPath, "utf-8");
        return contents;
      } catch (error) {
        logger.error(`Error reading file ${filePath} for app ${appId}:`, error);
        throw new Error("Failed to read file");
      }
    },
  );

  // Do NOT use handle for this, it contains sensitive information.
  ipcMain.handle("get-env-vars", async () => {
    const envVars: Record<string, string | undefined> = {};
    const providers = await getLanguageModelProviders();
    for (const provider of providers) {
      if (provider.envVarName) {
        envVars[provider.envVarName] = getEnvVar(provider.envVarName);
      }
    }
    return envVars;
  });

  ipcMain.handle(
    "run-app",
    async (
      event: Electron.IpcMainInvokeEvent,
      { appId, terminalType }: { appId: number; terminalType?: "frontend" | "backend" | "main" },
    ): Promise<void> => {
      return withLock(appId, async () => {
        // Check if app is already running
        if (runningApps.has(appId)) {
          logger.debug(`App ${appId} is already running.`);
          return;
        }

        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });

        if (!app) {
          throw new Error("App not found");
        }

        logger.debug(`Starting app ${appId} in path ${app.path}`);

        const appPath = getDyadAppPath(app.path);
        try {
          // There may have been a previous run that left a process on port 32100.
          await cleanUpPort(32100);
    await executeApp({
      appPath,
      appId,
      event,
      isNeon: !!app.neonProjectId,
      installCommand: app.installCommand,
      startCommand: app.startCommand,
      terminalType,
    });

          return;
        } catch (error: any) {
          logger.error(`Error running app ${appId}:`, error);
          // Ensure cleanup if error happens during setup but before process events are handled
          if (
            runningApps.has(appId) &&
            runningApps.get(appId)?.processId === processCounter.value
          ) {
            runningApps.delete(appId);
          }
          throw new Error(`Failed to run app ${appId}: ${error.message}`);
        }
      });
    },
  );

  ipcMain.handle(
    "stop-app",
    async (_, { appId }: { appId: number }): Promise<void> => {
      logger.log(
        `Attempting to stop app ${appId}. Current running apps: ${runningApps.size}`,
      );
      return withLock(appId, async () => {
        // For fullstack apps, we need to stop both backend and frontend processes
        const processesToStop: { key: string | number; appInfo: any }[] = [];

        // Check for main app process
        const mainAppInfo = runningApps.get(appId);
        if (mainAppInfo) {
          processesToStop.push({ key: appId, appInfo: mainAppInfo });
        }

        // Check for frontend process (for fullstack apps)
        const frontendAppInfo = runningApps.get(`${appId}-frontend`);
        if (frontendAppInfo) {
          processesToStop.push({ key: `${appId}-frontend`, appInfo: frontendAppInfo });
        }

        if (processesToStop.length === 0) {
          logger.log(
            `No processes found for app ${appId}. Assuming already stopped.`,
          );
          return;
        }

        // Stop all processes
        for (const { key, appInfo } of processesToStop) {
          const { process, processId } = appInfo;
          logger.log(
            `Found running process for app ${key} with processId ${processId} (PID: ${process.pid}). Attempting to stop.`,
          );

          // Check if the process is already exited or closed
          if (process.exitCode !== null || process.signalCode !== null) {
            logger.log(
              `Process for app ${key} (PID: ${process.pid}) already exited (code: ${process.exitCode}, signal: ${process.signalCode}). Cleaning up map.`,
            );
            runningApps.delete(key as any); // Ensure cleanup if somehow missed
            continue;
          }

          try {
            await stopAppByInfo(key as any, appInfo);
          } catch (error: any) {
            logger.error(
              `Error stopping process for app ${key} (PID: ${process.pid}, processId: ${processId}):`,
              error,
            );
          }
        }

        return;
      });
    },
  );

  ipcMain.handle(
    "restart-app",
    async (
      event: Electron.IpcMainInvokeEvent,
      {
        appId,
        removeNodeModules,
        terminalType,
      }: { appId: number; removeNodeModules?: boolean; terminalType?: "frontend" | "backend" | "main" },
    ): Promise<void> => {
      logger.log(`Restarting app ${appId}`);
      return withLock(appId, async () => {
        try {
          // First stop the app if it's running
          const appInfo = runningApps.get(appId);
          if (appInfo) {
            const { processId } = appInfo;
            logger.log(
              `Stopping app ${appId} (processId ${processId}) before restart`,
            );
            await stopAppByInfo(appId, appInfo);
          } else {
            logger.log(`App ${appId} not running. Proceeding to start.`);
          }

          // There may have been a previous run that left a process on port 32100.
          await cleanUpPort(32100);

          // Now start the app again
          const app = await db.query.apps.findFirst({
            where: eq(apps.id, appId),
          });

          if (!app) {
            throw new Error("App not found");
          }

          const appPath = getDyadAppPath(app.path);

          // Remove node_modules if requested
          if (removeNodeModules) {
            const settings = readSettings();
            const runtimeMode = settings.runtimeMode2 ?? "host";

            const nodeModulesPath = path.join(appPath, "node_modules");
            logger.log(
              `Removing node_modules for app ${appId} at ${nodeModulesPath}`,
            );
            if (fs.existsSync(nodeModulesPath)) {
              await fsPromises.rm(nodeModulesPath, {
                recursive: true,
                force: true,
              });
              logger.log(`Successfully removed node_modules for app ${appId}`);
            } else {
              logger.log(`No node_modules directory found for app ${appId}`);
            }

            // If running in Docker mode, also remove container volumes so deps reinstall freshly
            if (runtimeMode === "docker") {
              logger.log(
                `Docker mode detected for app ${appId}. Removing Docker volumes dyad-pnpm-${appId}...`,
              );
              try {
                await removeDockerVolumesForApp(appId);
                logger.log(
                  `Removed Docker volumes for app ${appId} (dyad-pnpm-${appId}).`,
                );
              } catch (e) {
                // Best-effort cleanup; log and continue
                logger.warn(
                  `Failed to remove Docker volumes for app ${appId}. Continuing: ${e}`,
                );
              }
            }
          }

          logger.debug(
            `Executing app ${appId} in path ${app.path} after restart request`,
          ); // Adjusted log

          await executeApp({
            appPath,
            appId,
            event,
            isNeon: !!app.neonProjectId,
            installCommand: app.installCommand,
            startCommand: app.startCommand,
          }); // This will handle starting either mode

          return;
        } catch (error) {
          logger.error(`Error restarting app ${appId}:`, error);
          throw error;
        }
      });
    },
  );

  ipcMain.handle(
    "edit-app-file",
    async (
      _,
      {
        appId,
        filePath,
        content,
      }: { appId: number; filePath: string; content: string },
    ): Promise<EditAppFileReturnType> => {
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });

      if (!app) {
        throw new Error("App not found");
      }

      const appPath = getDyadAppPath(app.path);
      let finalFullPath: string;

      // Check if the filePath starts with frontend/ or backend/
      if (filePath.startsWith("frontend/")) {
        const frontendPath = path.join(appPath, "frontend");
        const relativePath = filePath.substring("frontend/".length);
        finalFullPath = path.join(frontendPath, relativePath);
      } else if (filePath.startsWith("backend/")) {
        const backendPath = path.join(appPath, "backend");
        const relativePath = filePath.substring("backend/".length);
        finalFullPath = path.join(backendPath, relativePath);
      } else {
        // For backward compatibility, try frontend first, then backend, then root
        const frontendPath = path.join(appPath, "frontend", filePath);
        const backendPath = path.join(appPath, "backend", filePath);
        const rootPath = path.join(appPath, filePath);

        if (fs.existsSync(path.dirname(frontendPath))) {
          finalFullPath = frontendPath;
        } else if (fs.existsSync(path.dirname(backendPath))) {
          finalFullPath = backendPath;
        } else {
          finalFullPath = rootPath;
        }
      }

      // Check if the path is within the app directory (security check)
      if (!finalFullPath.startsWith(appPath)) {
        throw new Error("Invalid file path");
      }

      if (app.neonProjectId && app.neonDevelopmentBranchId) {
        try {
          await storeDbTimestampAtCurrentVersion({
            appId: app.id,
          });
        } catch (error) {
          logger.error(
            "Error storing Neon timestamp at current version:",
            error,
          );
          throw new Error(
            "Could not store Neon timestamp at current version; database versioning functionality is not working: " +
              error,
          );
        }
      }

      // Ensure directory exists
      const dirPath = path.dirname(finalFullPath);
      await fsPromises.mkdir(dirPath, { recursive: true });

      try {
        await fsPromises.writeFile(finalFullPath, content, "utf-8");

        // Check if git repository exists and commit the change
        if (fs.existsSync(path.join(appPath, ".git"))) {
          await git.add({
            fs,
            dir: appPath,
            filepath: filePath,
          });

          await gitCommit({
            path: appPath,
            message: `Updated ${filePath}`,
          });
        }
      } catch (error: any) {
        logger.error(`Error writing file ${filePath} for app ${appId}:`, error);
        throw new Error(`Failed to write file: ${error.message}`);
      }

      if (isServerFunction(filePath) && app.supabaseProjectId) {
        try {
          await deploySupabaseFunctions({
            supabaseProjectId: app.supabaseProjectId,
            functionName: path.basename(path.dirname(filePath)),
            content: content,
          });
        } catch (error) {
          logger.error(`Error deploying Supabase function ${filePath}:`, error);
          return {
            warning: `File saved, but failed to deploy Supabase function: ${filePath}: ${error}`,
          };
        }
      }
      return {};
    },
  );

  ipcMain.handle(
    "delete-app",
    async (_, { appId }: { appId: number }): Promise<void> => {
      // Static server worker is NOT terminated here anymore

      return withLock(appId, async () => {
        // Check if app exists
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });

        if (!app) {
          throw new Error("App not found");
        }

        // Stop the app if it's running
        if (runningApps.has(appId)) {
          const appInfo = runningApps.get(appId)!;
          try {
            logger.log(`Stopping app ${appId} before deletion.`); // Adjusted log
            await stopAppByInfo(appId, appInfo);
          } catch (error: any) {
            logger.error(`Error stopping app ${appId} before deletion:`, error); // Adjusted log
            // Continue with deletion even if stopping fails
          }
        }

        // Delete app from database
        try {
          await db.delete(apps).where(eq(apps.id, appId));
          // Note: Associated chats will cascade delete
        } catch (error: any) {
          logger.error(`Error deleting app ${appId} from database:`, error);
          throw new Error(
            `Failed to delete app from database: ${error.message}`,
          );
        }

        // Delete app files
        const appPath = getDyadAppPath(app.path);
        try {
          await fsPromises.rm(appPath, { recursive: true, force: true });
        } catch (error: any) {
          logger.error(`Error deleting app files for app ${appId}:`, error);
          throw new Error(
            `App deleted from database, but failed to delete app files. Please delete app files from ${appPath} manually.\n\nError: ${error.message}`,
          );
        }
      });
    },
  );

  ipcMain.handle("delete-all-apps", async (): Promise<void> => {
    logger.log("start: deleting all apps and their files.");
    // Stop all running apps first
    logger.log("stopping all running apps...");
    const runningAppIds = Array.from(runningApps.keys());
    for (const appId of runningAppIds) {
      try {
        const appInfo = runningApps.get(appId)!;
        await stopAppByInfo(appId, appInfo);
      } catch (error) {
        logger.error(`Error stopping app ${appId} during delete all:`, error);
        // Continue with deletion even if stopping fails
      }
    }
    logger.log("all running apps stopped.");

    // Get all apps
    const allApps = await db.query.apps.findMany();

    // Delete all apps from database
    logger.log("deleting all apps from database...");
    try {
      await db.delete(apps);
      // Note: Associated chats will cascade delete
    } catch (error: any) {
      logger.error("Error deleting all apps from database:", error);
      throw new Error(`Failed to delete apps from database: ${error.message}`);
    }
    logger.log("all apps deleted from database.");

    // Delete all app files
    logger.log("deleting all app files...");
    for (const app of allApps) {
      const appPath = getDyadAppPath(app.path);
      if (fs.existsSync(appPath)) {
        try {
          await fsPromises.rm(appPath, { recursive: true, force: true });
          logger.log(`Deleted app files for ${app.name} at ${appPath}`);
        } catch (error: any) {
          logger.warn(`Error deleting app files for ${app.name}:`, error);
          // Continue with other apps even if one fails
        }
      }
    }
    logger.log("all app files deleted.");
    logger.log("delete all apps complete.");
  });

  ipcMain.handle(
    "rename-app",
    async (
      _,
      {
        appId,
        appName,
        appPath,
      }: { appId: number; appName: string; appPath: string },
    ): Promise<void> => {
      return withLock(appId, async () => {
        // Check if app exists
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });

        if (!app) {
          throw new Error("App not found");
        }

        // Check for conflicts with existing apps
        const nameConflict = await db.query.apps.findFirst({
          where: eq(apps.name, appName),
        });

        const pathConflict = await db.query.apps.findFirst({
          where: eq(apps.path, appPath),
        });

        if (nameConflict && nameConflict.id !== appId) {
          throw new Error(`An app with the name '${appName}' already exists`);
        }

        if (pathConflict && pathConflict.id !== appId) {
          throw new Error(`An app with the path '${appPath}' already exists`);
        }

        // Stop the app if it's running
        if (runningApps.has(appId)) {
          const appInfo = runningApps.get(appId)!;
          try {
            await stopAppByInfo(appId, appInfo);
          } catch (error: any) {
            logger.error(`Error stopping app ${appId} before renaming:`, error);
            throw new Error(
              `Failed to stop app before renaming: ${error.message}`,
            );
          }
        }

        const oldAppPath = getDyadAppPath(app.path);
        const newAppPath = getDyadAppPath(appPath);
        // Only move files if needed
        if (newAppPath !== oldAppPath) {
          // Move app files
          try {
            // Check if destination directory already exists
            if (fs.existsSync(newAppPath)) {
              throw new Error(
                `Destination path '${newAppPath}' already exists`,
              );
            }

            // Create parent directory if it doesn't exist
            await fsPromises.mkdir(path.dirname(newAppPath), {
              recursive: true,
            });

            // Copy the directory without node_modules
            await copyDir(oldAppPath, newAppPath);
          } catch (error: any) {
            logger.error(
              `Error moving app files from ${oldAppPath} to ${newAppPath}:`,
              error,
            );
            throw new Error(`Failed to move app files: ${error.message}`);
          }

          try {
            // Delete the old directory
            await fsPromises.rm(oldAppPath, { recursive: true, force: true });
          } catch (error: any) {
            // Why is this just a warning? This happens quite often on Windows
            // because it has an aggressive file lock.
            //
            // Not deleting the old directory is annoying, but not a big deal
            // since the user can do it themselves if they need to.
            logger.warn(
              `Error deleting old app directory ${oldAppPath}:`,
              error,
            );
          }
        }

        // Update app in database
        try {
          await db
            .update(apps)
            .set({
              name: appName,
              path: appPath,
            })
            .where(eq(apps.id, appId))
            .returning();

          return;
        } catch (error: any) {
          // Attempt to rollback the file move
          if (newAppPath !== oldAppPath) {
            try {
              // Copy back from new to old
              await copyDir(newAppPath, oldAppPath);
              // Delete the new directory
              await fsPromises.rm(newAppPath, { recursive: true, force: true });
            } catch (rollbackError) {
              logger.error(
                `Failed to rollback file move during rename error:`,
                rollbackError,
              );
            }
          }

          logger.error(`Error updating app ${appId} in database:`, error);
          throw new Error(`Failed to update app in database: ${error.message}`);
        }
      });
    },
  );

  ipcMain.handle("reset-all", async (): Promise<void> => {
    logger.log("start: resetting all apps and settings.");
    // Stop all running apps first
    logger.log("stopping all running apps...");
    const runningAppIds = Array.from(runningApps.keys());
    for (const appId of runningAppIds) {
      try {
        const appInfo = runningApps.get(appId)!;
        await stopAppByInfo(appId, appInfo);
      } catch (error) {
        logger.error(`Error stopping app ${appId} during reset:`, error);
        // Continue with reset even if stopping fails
      }
    }
    logger.log("all running apps stopped.");
    logger.log("deleting database...");
    // 1. Drop the database by deleting the SQLite file
    const dbPath = getDatabasePath();
    if (fs.existsSync(dbPath)) {
      // Close database connections first
      if (db.$client) {
        db.$client.close();
      }
      await fsPromises.unlink(dbPath);
      logger.log(`Database file deleted: ${dbPath}`);
    }
    logger.log("database deleted.");
    logger.log("deleting settings...");
    // 2. Remove settings
    const userDataPath = getUserDataPath();
    const settingsPath = path.join(userDataPath, "user-settings.json");

    if (fs.existsSync(settingsPath)) {
      await fsPromises.unlink(settingsPath);
      logger.log(`Settings file deleted: ${settingsPath}`);
    }
    logger.log("settings deleted.");
    // 3. Remove all app files recursively
    // Doing this last because it's the most time-consuming and the least important
    // in terms of resetting the app state.
    logger.log("removing all app files...");
    const dyadAppPath = getDyadAppPath(".");
    if (fs.existsSync(dyadAppPath)) {
      await fsPromises.rm(dyadAppPath, { recursive: true, force: true });
      // Recreate the base directory
      await fsPromises.mkdir(dyadAppPath, { recursive: true });
    }
    logger.log("all app files removed.");
    logger.log("reset all complete.");
  });

  ipcMain.handle("get-app-version", async (): Promise<{ version: string }> => {
    // Read version from package.json at project root
    const packageJsonPath = path.resolve(__dirname, "..", "..", "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    return { version: packageJson.version };
  });

  handle("rename-branch", async (_, params: RenameBranchParams) => {
    const { appId, oldBranchName, newBranchName } = params;
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      throw new Error("App not found");
    }

    const appPath = getDyadAppPath(app.path);

    return withLock(appId, async () => {
      try {
        // Check if the old branch exists
        const branches = await git.listBranches({ fs, dir: appPath });
        if (!branches.includes(oldBranchName)) {
          throw new Error(`Branch '${oldBranchName}' not found.`);
        }

        // Check if the new branch name already exists
        if (branches.includes(newBranchName)) {
          // If newBranchName is 'main' and oldBranchName is 'master',
          // and 'main' already exists, we might want to allow this if 'main' is the current branch
          // and just switch to it, or delete 'master'.
          // For now, let's keep it simple and throw an error.
          throw new Error(
            `Branch '${newBranchName}' already exists. Cannot rename.`,
          );
        }

        await git.renameBranch({
          fs: fs,
          dir: appPath,
          oldref: oldBranchName,
          ref: newBranchName,
        });
        logger.info(
          `Branch renamed from '${oldBranchName}' to '${newBranchName}' for app ${appId}`,
        );
      } catch (error: any) {
        logger.error(
          `Failed to rename branch for app ${appId}: ${error.message}`,
        );
        throw new Error(
          `Failed to rename branch '${oldBranchName}' to '${newBranchName}': ${error.message}`,
        );
      }
    });
  });

  handle(
    "respond-to-app-input",
    async (_, { appId, response }: RespondToAppInputParams) => {
      if (response !== "y" && response !== "n") {
        throw new Error(`Invalid response: ${response}`);
      }
      const appInfo = runningApps.get(appId);

      if (!appInfo) {
        throw new Error(`App ${appId} is not running`);
      }

      const { process } = appInfo;

      if (!process.stdin) {
        throw new Error(`App ${appId} process has no stdin available`);
      }

      try {
        // Write the response to stdin with a newline
        process.stdin.write(`${response}\n`);
        logger.debug(`Sent response '${response}' to app ${appId} stdin`);
      } catch (error: any) {
        logger.error(`Error sending response to app ${appId}:`, error);
        throw new Error(`Failed to send response to app: ${error.message}`);
      }
    },
  );

  handle(
    "search-app",
    async (_, searchQuery: string): Promise<AppSearchResult[]> => {
      // Use parameterized query to prevent SQL injection
      const pattern = `%${searchQuery.replace(/[%_]/g, "\\$&")}%`;

      // 1) Apps whose name matches
      const appNameMatches = await db
        .select({
          id: apps.id,
          name: apps.name,
          createdAt: apps.createdAt,
        })
        .from(apps)
        .where(like(apps.name, pattern))
        .orderBy(desc(apps.createdAt));

      const appNameMatchesResult: AppSearchResult[] = appNameMatches.map(
        (r) => ({
          id: r.id,
          name: r.name,
          createdAt: r.createdAt,
          matchedChatTitle: null,
          matchedChatMessage: null,
        }),
      );

      // 2) Apps whose chat title matches
      const chatTitleMatches = await db
        .select({
          id: apps.id,
          name: apps.name,
          createdAt: apps.createdAt,
          matchedChatTitle: chats.title,
        })
        .from(apps)
        .innerJoin(chats, eq(apps.id, chats.appId))
        .where(like(chats.title, pattern))
        .orderBy(desc(apps.createdAt));

      const chatTitleMatchesResult: AppSearchResult[] = chatTitleMatches.map(
        (r) => ({
          id: r.id,
          name: r.name,
          createdAt: r.createdAt,
          matchedChatTitle: r.matchedChatTitle,
          matchedChatMessage: null,
        }),
      );

      // 3) Apps whose chat message content matches
      const chatMessageMatches = await db
        .select({
          id: apps.id,
          name: apps.name,
          createdAt: apps.createdAt,
          matchedChatTitle: chats.title,
          matchedChatMessage: messages.content,
        })
        .from(apps)
        .innerJoin(chats, eq(apps.id, chats.appId))
        .innerJoin(messages, eq(chats.id, messages.chatId))
        .where(like(messages.content, pattern))
        .orderBy(desc(apps.createdAt));

      // Flatten and dedupe by app id
      const allMatches: AppSearchResult[] = [
        ...appNameMatchesResult,
        ...chatTitleMatchesResult,
        ...chatMessageMatches,
      ];
      const uniqueApps = Array.from(
        new Map(allMatches.map((app) => [app.id, app])).values(),
      );

      // Sort newest apps first
      uniqueApps.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      return uniqueApps;
    },
  );
}

function getCommand({
  installCommand,
  startCommand,
}: {
  installCommand?: string | null;
  startCommand?: string | null;
}) {
  const hasCustomCommands = !!installCommand?.trim() && !!startCommand?.trim();
  return hasCustomCommands
    ? `${installCommand!.trim()} && ${startCommand!.trim()}`
    : DEFAULT_COMMAND;
}

async function cleanUpPort(port: number) {
  const settings = readSettings();
  if (settings.runtimeMode2 === "docker") {
    await stopDockerContainersOnPort(port);
  } else {
    await killProcessOnPort(port);
  }
}

async function installDependencies(projectPath: string, framework: string) {
  const installCommand = getInstallCommand(framework);

  return new Promise<void>((resolve, reject) => {
    const installProcess = spawn(installCommand, [], {
      cwd: projectPath,
      shell: true,
      stdio: "pipe",
    });

    logger.info(`Running install command: ${installCommand} in ${projectPath}`);

    let installOutput = "";
    let installError = "";

    installProcess.stdout?.on("data", (data) => {
      installOutput += data.toString();
    });

    installProcess.stderr?.on("data", (data) => {
      installError += data.toString();
    });

    installProcess.on("close", (code) => {
      if (code === 0) {
        logger.info(`Successfully installed dependencies for ${framework}`);
        resolve();
      } else {
        logger.warn(`Dependency installation failed for ${framework} (code: ${code}): ${installError}`);
        // Don't reject here - we want to continue even if installation fails
        // as the framework files are still created and user can install manually
        resolve();
      }
    });

    installProcess.on("error", (err) => {
      logger.error(`Failed to start dependency installation for ${framework}:`, err);
      // Don't reject here for the same reason as above
      resolve();
    });
  });
}

function getInstallCommand(framework: string): string {
  switch (framework) {
    case "nodejs":
      return "npm install";
    case "django":
    case "fastapi":
    case "flask":
      return "pip install -r requirements.txt";
    default:
      logger.warn(`Unknown framework for dependency installation: ${framework}`);
      return "";
  }
}

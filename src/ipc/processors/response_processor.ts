import { db } from "../../db";
import { chats, messages } from "../../db/schema";
import { and, eq } from "drizzle-orm";
import fs from "node:fs";
import { getDyadAppPath } from "../../paths/paths";
import path from "node:path";
import git from "isomorphic-git";
import { safeJoin } from "../utils/path_utils";

import log from "electron-log";
import { invalidateAppQuery } from "../../hooks/useLoadApp";
import { executeAddDependency } from "./executeAddDependency";
import {
  deleteSupabaseFunction,
  deploySupabaseFunctions,
  executeSupabaseSql,
} from "../../supabase_admin/supabase_management_client";
import { isServerFunction } from "../../supabase_admin/supabase_utils";
import { UserSettings } from "../../lib/schemas";
import { gitCommit } from "../utils/git_utils";

// Helper function to handle git operations with timeout
function createSafeGitOperation(warnings: Output[], errors: Output[]) {
  return async function safeGitOperation(operation: () => Promise<any>, operationName: string, filePath?: string): Promise<any> {
    try {
      // Set a timeout for git operations (30 seconds)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${operationName} timed out after 30 seconds`)), 30000);
      });

      const result = await Promise.race([operation(), timeoutPromise]);
      return result;
    } catch (error) {
      const errorMessage = `${operationName} failed${filePath ? ` for ${filePath}` : ''}: ${error}`;
      logger.warn(errorMessage);
      warnings.push({
        message: errorMessage,
        error: error,
      });
      return null;
    }
  };
}
import { readSettings } from "@/main/settings";
import { writeMigrationFile } from "../utils/file_utils";
import {
  getDyadWriteTags,
  getDyadRenameTags,
  getDyadDeleteTags,
  getDyadAddDependencyTags,
  getDyadExecuteSqlTags,
  getDyadRunBackendTerminalCmdTags,
  getDyadRunFrontendTerminalCmdTags,
  getDyadRunTerminalCmdTags,
  getWriteToFileTags,
  getSearchReplaceTags,
} from "../utils/dyad_tag_parser";
import { runShellCommand } from "../utils/runShellCommand";
import { storeDbTimestampAtCurrentVersion } from "../utils/neon_timestamp_utils";

import { FileUploadsState } from "../utils/file_uploads_state";
import { addTerminalOutput } from "../handlers/terminal_handlers";

const readFile = fs.promises.readFile;
const logger = log.scope("response_processor");

interface Output {
  message: string;
  error: unknown;
}

function getFunctionNameFromPath(input: string): string {
  return path.basename(path.extname(input) ? path.dirname(input) : input);
}

async function readFileFromFunctionPath(input: string): Promise<string> {
  // Sometimes, the path given is a directory, sometimes it's the file itself.
  if (path.extname(input) === "") {
    return readFile(path.join(input, "index.ts"), "utf8");
  }
  return readFile(input, "utf8");
}

export async function processFullResponseActions(
  fullResponse: string,
  chatId: number,
  {
    chatSummary,
    messageId,
  }: {
    chatSummary: string | undefined;
    messageId: number;
  },
): Promise<{
  updatedFiles?: boolean;
  error?: string;
  extraFiles?: string[];
  extraFilesError?: string;
}> {
  const fileUploadsState = FileUploadsState.getInstance();
  const fileUploadsMap = fileUploadsState.getFileUploadsForChat(chatId);
  fileUploadsState.clear();
  logger.log("processFullResponseActions for chatId", chatId);
  // Get the app associated with the chat
  const chatWithApp = await db.query.chats.findFirst({
    where: eq(chats.id, chatId),
    with: {
      app: true,
    },
  });
  if (!chatWithApp || !chatWithApp.app) {
    logger.error(`No app found for chat ID: ${chatId}`);
    return {};
  }

  if (
    chatWithApp.app.neonProjectId &&
    chatWithApp.app.neonDevelopmentBranchId
  ) {
    try {
      await storeDbTimestampAtCurrentVersion({
        appId: chatWithApp.app.id,
      });
    } catch (error) {
      logger.error("Error creating Neon branch at current version:", error);
      throw new Error(
        "Could not create Neon branch; database versioning functionality is not working: " +
          error,
      );
    }
  }

  const settings: UserSettings = readSettings();
  const appPath = getDyadAppPath(chatWithApp.app.path);
  const writtenFiles: string[] = [];
  const renamedFiles: string[] = [];
  const deletedFiles: string[] = [];
  let hasChanges = false;

  let warnings: Output[] = [];
  let errors: Output[] = [];

  // Create the safe git operation function with access to warnings/errors
  const safeGitOperation = createSafeGitOperation(warnings, errors);

  try {
    // Extract all tags
    const dyadWriteTags = getDyadWriteTags(fullResponse);
    const writeToFileTags = getWriteToFileTags(fullResponse);
    const searchReplaceTags = getSearchReplaceTags(fullResponse);
    const dyadRenameTags = getDyadRenameTags(fullResponse);
    const dyadDeletePaths = getDyadDeleteTags(fullResponse);
    const dyadAddDependencyPackages = getDyadAddDependencyTags(fullResponse);
    const dyadExecuteSqlQueries = chatWithApp.app.supabaseProjectId
      ? getDyadExecuteSqlTags(fullResponse)
      : [];
    const dyadRunBackendTerminalCmdTags = getDyadRunBackendTerminalCmdTags(fullResponse);
    const dyadRunFrontendTerminalCmdTags = getDyadRunFrontendTerminalCmdTags(fullResponse);
    const dyadRunTerminalCmdTags = getDyadRunTerminalCmdTags(fullResponse);

    // Determine the chat mode to route general terminal commands appropriately
    let chatMode = settings.selectedChatMode;
    if (chatWithApp.app) {
      // Check if there's a backend directory to determine if this is backend/fullstack mode
      const backendPath = path.join(appPath, "backend");
      const hasBackend = fs.existsSync(backendPath);
      if (hasBackend) {
        chatMode = settings.selectedChatMode === "fullstack" ? "fullstack" : "backend";
      }
    }

    const message = await db.query.messages.findFirst({
      where: and(
        eq(messages.id, messageId),
        eq(messages.role, "assistant"),
        eq(messages.chatId, chatId),
      ),
    });

    if (!message) {
      logger.error(`No message found for ID: ${messageId}`);
      return {};
    }

    // Handle SQL execution tags
    if (dyadExecuteSqlQueries.length > 0) {
      for (const query of dyadExecuteSqlQueries) {
        try {
          await executeSupabaseSql({
            supabaseProjectId: chatWithApp.app.supabaseProjectId!,
            query: query.content,
          });

          // Only write migration file if SQL execution succeeded
          if (settings.enableSupabaseWriteSqlMigration) {
            try {
              const migrationFilePath = await writeMigrationFile(
                appPath,
                query.content,
                query.description,
              );
              writtenFiles.push(migrationFilePath);
            } catch (error) {
              errors.push({
                message: `Failed to write SQL migration file for: ${query.description}`,
                error: error,
              });
            }
          }
        } catch (error) {
          errors.push({
            message: `Failed to execute SQL query: ${query.content}`,
            error: error,
          });
        }
      }
      logger.log(`Executed ${dyadExecuteSqlQueries.length} SQL queries`);
     }

    // Handle backend terminal command tags
    if (dyadRunBackendTerminalCmdTags.length > 0) {
      for (const cmdTag of dyadRunBackendTerminalCmdTags) {
        try {
          const backendPath = path.join(appPath, "backend");
          // Ensure backend directory exists
          if (!fs.existsSync(backendPath)) {
            fs.mkdirSync(backendPath, { recursive: true });
            logger.log(`Created backend directory: ${backendPath} for backend terminal command`);
          }
          const cwd = cmdTag.cwd ? path.join(backendPath, cmdTag.cwd) : backendPath;

          logger.log(`Executing backend terminal command: ${cmdTag.command} in ${cwd}`);

          // Add command to backend terminal output
          // We need to import and use the backendTerminalOutputAtom
          // For now, we'll use a more direct approach by sending IPC messages to update the UI

          const result = await runShellCommand(`cd "${cwd}" && ${cmdTag.command}`);

          if (result === null) {
            errors.push({
              message: `Backend terminal command failed: ${cmdTag.description || cmdTag.command}`,
              error: `Command execution failed in ${cwd}`,
            });
            // Add error to main terminal
            addTerminalOutput(chatWithApp.app.id, "backend", `❌ Error: ${cmdTag.description || cmdTag.command}`, "error");
          } else {
            logger.log(`Backend terminal command succeeded: ${cmdTag.description || cmdTag.command}`);

            // Add command and result to main terminal
            addTerminalOutput(chatWithApp.app.id, "backend", `$ ${cmdTag.command}`, "command");

            if (result.trim()) {
              addTerminalOutput(chatWithApp.app.id, "backend", result, "output");
            }

            addTerminalOutput(chatWithApp.app.id, "backend", `✅ ${cmdTag.description || cmdTag.command} completed successfully`, "success");
          }
        } catch (error) {
          errors.push({
            message: `Backend terminal command failed: ${cmdTag.description || cmdTag.command}`,
            error: error,
          });
          // Add error to backend terminal
          addTerminalOutput(chatWithApp.app.id, "backend", `❌ Error: ${error}`, "error");
        }
      }
      logger.log(`Executed ${dyadRunBackendTerminalCmdTags.length} backend terminal commands`);
     }

    // Handle frontend terminal command tags
    if (dyadRunFrontendTerminalCmdTags.length > 0) {
      for (const cmdTag of dyadRunFrontendTerminalCmdTags) {
        try {
          const frontendPath = path.join(appPath, "frontend");
          const cwd = cmdTag.cwd ? path.join(frontendPath, cmdTag.cwd) : frontendPath;

          logger.log(`Executing frontend terminal command: ${cmdTag.command} in ${cwd}`);

          const result = await runShellCommand(`cd "${cwd}" && ${cmdTag.command}`);

          if (result === null) {
            errors.push({
              message: `Frontend terminal command failed: ${cmdTag.description || cmdTag.command}`,
              error: `Command execution failed in ${cwd}`,
            });
            // Add error to frontend terminal
            addTerminalOutput(chatWithApp.app.id, "frontend", `❌ Error: ${cmdTag.description || cmdTag.command}`, "error");
          } else {
            logger.log(`Frontend terminal command succeeded: ${cmdTag.description || cmdTag.command}`);

            // Add command and result to frontend terminal
            addTerminalOutput(chatWithApp.app.id, "frontend", `$ ${cmdTag.command}`, "command");

            if (result.trim()) {
              addTerminalOutput(chatWithApp.app.id, "frontend", result, "output");
            }

            addTerminalOutput(chatWithApp.app.id, "frontend", `✅ ${cmdTag.description || cmdTag.command} completed successfully`, "success");
          }
        } catch (error) {
          errors.push({
            message: `Frontend terminal command failed: ${cmdTag.description || cmdTag.command}`,
            error: error,
          });
          // Add error to frontend terminal
          addTerminalOutput(chatWithApp.app.id, "frontend", `❌ Error: ${error}`, "error");
        }
      }
      logger.log(`Executed ${dyadRunFrontendTerminalCmdTags.length} frontend terminal commands`);
     }

     // Handle general terminal command tags - route based on chat mode
     if (dyadRunTerminalCmdTags.length > 0) {
       for (const cmdTag of dyadRunTerminalCmdTags) {
         // Clean up the command - remove common prefixes that AI might add
         let cleanCommand = cmdTag.command.trim();

         // Remove various command prefixes
         const prefixes = ['cmd:', 'command:', 'run:', 'execute:', 'terminal:', 'shell:'];
         for (const prefix of prefixes) {
           if (cleanCommand.toLowerCase().startsWith(prefix)) {
             cleanCommand = cleanCommand.substring(prefix.length).trim();
             break; // Only remove one prefix
           }
         }

         // Also remove markdown code block markers if present
         if (cleanCommand.startsWith('```') && cleanCommand.includes('\n')) {
           const lines = cleanCommand.split('\n');
           if (lines[0].startsWith('```')) {
             lines.shift(); // Remove opening ```
           }
           if (lines.length > 0 && lines[lines.length - 1].startsWith('```')) {
             lines.pop(); // Remove closing ```
           }
           cleanCommand = lines.join('\n').trim();
         }
         // Remove single backticks if wrapping the entire command
         if (cleanCommand.startsWith('`') && cleanCommand.endsWith('`') && cleanCommand.split('`').length === 3) {
           cleanCommand = cleanCommand.slice(1, -1).trim();
         }

         try {
           // Determine which terminal to route to based on command content and chat mode
           let terminalType: "frontend" | "backend" = "backend"; // default
           let cwd = cmdTag.cwd ? path.join(appPath, cmdTag.cwd) : appPath;

           // Enhanced command detection with better patterns
           const isPythonCommand = /\b(python|pip|conda|venv|py |python3|pip3|django|flask|fastapi)\b/i.test(cleanCommand);
           const isNodeCommand = /\b(npm|yarn|pnpm|node|npx|vite|next|react|webpack|create-react-app|vue|angular|typescript|tsc|pnpm|yarn)\b/i.test(cleanCommand);
           const isGoCommand = /\b(go|go run|go build|go mod|go get)\b/i.test(cleanCommand);
           const isRustCommand = /\b(cargo|cargo build|cargo run|cargo test)\b/i.test(cleanCommand);

           // Additional check for Vite-specific commands and dev servers
           const isViteCommand = /\b(vite|vite\.config|\.bin\/vite)\b/i.test(cleanCommand);

           // Backend commands (Python, Go, Rust, database, server commands)
           const isBackendCommand = isPythonCommand || isGoCommand || isRustCommand ||
                                  /\b(server|backend|api|database|db|postgres|mysql|sqlite|mongodb|redis)\b/i.test(cleanCommand);

           // Frontend commands (explicitly Node.js related or client-side)
           const isFrontendCommand = isNodeCommand ||
                                   /\b(frontend|client|web|browser|html|css|scss|sass|tailwind|webpack|babel)\b/i.test(cleanCommand);

           logger.info(`[CHAT_COMMAND_ROUTING] Chat ${chatId} - Command: "${cleanCommand}"`);
           logger.info(`[CHAT_COMMAND_ROUTING] Chat ${chatId} - Chat mode: ${chatMode}`);
           logger.info(`[CHAT_COMMAND_ROUTING] Chat ${chatId} - Python: ${isPythonCommand}, Node.js: ${isNodeCommand}, Go: ${isGoCommand}, Rust: ${isRustCommand}, Vite: ${isViteCommand}`);
           logger.info(`[CHAT_COMMAND_ROUTING] Chat ${chatId} - Backend: ${isBackendCommand}, Frontend: ${isFrontendCommand}`);

           // Priority-based routing: explicit tech detection first, then general command patterns
           if (isPythonCommand || isGoCommand || isRustCommand) {
             terminalType = "backend";
             if (!cmdTag.cwd) {
               cwd = path.join(appPath, "backend");
               if (!fs.existsSync(cwd)) {
                 fs.mkdirSync(cwd, { recursive: true });
                 logger.log(`Created backend directory: ${cwd} for command execution`);
               }
             }
             logger.info(`[CHAT_COMMAND_ROUTING] Chat ${chatId} - Routing to BACKEND terminal (tech-specific command)`);
           } else if (isNodeCommand) {
             terminalType = "frontend";
             if (!cmdTag.cwd) {
               cwd = path.join(appPath, "frontend");
               if (!fs.existsSync(cwd)) {
                 fs.mkdirSync(cwd, { recursive: true });
                 logger.log(`Created frontend directory: ${cwd} for command execution`);
               }
             }
             logger.info(`[CHAT_COMMAND_ROUTING] Chat ${chatId} - Routing to FRONTEND terminal (Node.js command)`);
           } else if (isBackendCommand && !isFrontendCommand) {
             terminalType = "backend";
             if (!cmdTag.cwd) {
               cwd = path.join(appPath, "backend");
             }
             logger.info(`[CHAT_COMMAND_ROUTING] Chat ${chatId} - Routing to BACKEND terminal (backend-related command)`);
           } else if (isFrontendCommand) {
             terminalType = "frontend";
             if (!cmdTag.cwd) {
               cwd = path.join(appPath, "frontend");
             }
             logger.info(`[CHAT_COMMAND_ROUTING] Chat ${chatId} - Routing to FRONTEND terminal (frontend-related command)`);
           } else {
             // Fallback based on chat mode
             if (chatMode === "ask") {
               terminalType = "frontend";
               if (!cmdTag.cwd) {
                 cwd = path.join(appPath, "frontend");
               }
               logger.info(`[CHAT_COMMAND_ROUTING] Chat ${chatId} - Routing to FRONTEND terminal (ask mode default)`);
             } else if (chatMode === "backend") {
               terminalType = "backend";
               if (!cmdTag.cwd) {
                 cwd = path.join(appPath, "backend");
               }
               logger.info(`[CHAT_COMMAND_ROUTING] Chat ${chatId} - Routing to BACKEND terminal (backend mode)`);
             } else if (chatMode === "fullstack") {
               // For fullstack, default to backend for unknown commands
               terminalType = "backend";
               if (!cmdTag.cwd) {
                 cwd = path.join(appPath, "backend");
               }
               logger.info(`[CHAT_COMMAND_ROUTING] Chat ${chatId} - Routing to BACKEND terminal (fullstack default)`);
             } else {
               logger.info(`[CHAT_COMMAND_ROUTING] Chat ${chatId} - Routing to ${terminalType.toUpperCase()} terminal (fallback default)`);
             }
           }

           logger.log(`Executing general terminal command: ${cleanCommand} in ${cwd} (routing to ${terminalType} terminal) - isPython: ${isPythonCommand}, isNode: ${isNodeCommand}`);

           const result = await runShellCommand(`cd "${cwd}" && ${cleanCommand}`);

           if (result === null) {
             errors.push({
               message: `Terminal command failed: ${cmdTag.description || cleanCommand}`,
               error: `Command execution failed in ${cwd}`,
             });
             // Add error to appropriate terminal
             addTerminalOutput(chatWithApp.app.id, terminalType, `❌ Error: ${cmdTag.description || cleanCommand}`, "error");
           } else {
             logger.log(`Terminal command succeeded: ${cmdTag.description || cleanCommand}`);

             // Add command and result to appropriate terminal
             addTerminalOutput(chatWithApp.app.id, terminalType, `$ ${cleanCommand}`, "command");

             if (result.trim()) {
               addTerminalOutput(chatWithApp.app.id, terminalType, result, "output");
             }

             addTerminalOutput(chatWithApp.app.id, terminalType, `✅ ${cmdTag.description || cleanCommand} completed successfully`, "success");
           }
         } catch (error) {
           errors.push({
             message: `Terminal command failed: ${cmdTag.description || cleanCommand}`,
             error: error,
           });
           // Add error to appropriate terminal (default to backend for errors)
           addTerminalOutput(chatWithApp.app.id, "backend", `❌ Error: ${error}`, "error");
         }
       }
       logger.log(`Executed ${dyadRunTerminalCmdTags.length} general terminal commands`);
      }

    // Handle add dependency tags
    if (dyadAddDependencyPackages.length > 0) {
      try {
        await executeAddDependency({
          packages: dyadAddDependencyPackages,
          message: message,
          appPath,
        });
        // Only mark files as written if installation succeeded
        writtenFiles.push("package.json");
        const pnpmFilename = "pnpm-lock.yaml";
        if (fs.existsSync(safeJoin(appPath, pnpmFilename))) {
          writtenFiles.push(pnpmFilename);
        }
        const packageLockFilename = "package-lock.json";
        if (fs.existsSync(safeJoin(appPath, packageLockFilename))) {
          writtenFiles.push(packageLockFilename);
        }
      } catch (error) {
        errors.push({
          message: `Failed to add dependencies: ${dyadAddDependencyPackages.join(
            ", ",
          )}`,
          error: error,
        });
        // Don't mark package files as written if installation failed
        warnings.push({
          message: "Package installation failed - package.json and lock files not committed",
          error: null,
        });
      }
    }

    //////////////////////
    // File operations //
    // Do it in this order:
    // 1. Deletes
    // 2. Renames
    // 3. Writes
    //
    // Why?
    // - Deleting first avoids path conflicts before the other operations.
    // - LLMs like to rename and then edit the same file.
    //////////////////////

    // Process file deletions one by one
    for (const filePath of dyadDeletePaths) {
      const fullFilePath = safeJoin(appPath, filePath);

      try {
        // Delete the file if it exists
        if (fs.existsSync(fullFilePath)) {
          if (fs.lstatSync(fullFilePath).isDirectory()) {
            fs.rmdirSync(fullFilePath, { recursive: true });
          } else {
            fs.unlinkSync(fullFilePath);
          }
          logger.log(`Successfully deleted file: ${fullFilePath}`);
          deletedFiles.push(filePath);

          // Remove the file from git and commit immediately
          const commitResult = await safeGitOperation(async () => {
            await git.remove({
              fs,
              dir: appPath,
              filepath: filePath,
            });
            const commitHash = await gitCommit({
              path: appPath,
              message: `[alifullstack] Deleted file: ${filePath}`,
            });
            logger.log(`Committed file deletion: ${filePath} with hash ${commitHash}`);
            return commitHash;
          }, "File deletion commit", filePath);
        } else {
          logger.warn(`File to delete does not exist: ${fullFilePath}`);
        }

        if (isServerFunction(filePath)) {
          try {
            await deleteSupabaseFunction({
              supabaseProjectId: chatWithApp.app.supabaseProjectId!,
              functionName: getFunctionNameFromPath(filePath),
            });
          } catch (error) {
            errors.push({
              message: `Failed to delete Supabase function: ${filePath}`,
              error: error,
            });
          }
        }
      } catch (error) {
        errors.push({
          message: `Failed to delete file: ${filePath}`,
          error: error,
        });
      }
    }

    // Process file renames one by one
    for (const tag of dyadRenameTags) {
      try {
        const fromPath = safeJoin(appPath, tag.from);
        const toPath = safeJoin(appPath, tag.to);

        // Ensure target directory exists
        const dirPath = path.dirname(toPath);
        fs.mkdirSync(dirPath, { recursive: true });

        // Rename the file
        if (fs.existsSync(fromPath)) {
          fs.renameSync(fromPath, toPath);
          logger.log(`Successfully renamed file: ${fromPath} -> ${toPath}`);
          renamedFiles.push(tag.to);

          // Add the new file, remove the old one, and commit immediately
          const renameCommitResult = await safeGitOperation(async () => {
            await git.add({
              fs,
              dir: appPath,
              filepath: tag.to,
            });
            try {
              await git.remove({
                fs,
                dir: appPath,
                filepath: tag.from,
              });
            } catch (removeError) {
              logger.warn(`Failed to git remove old file ${tag.from}:`, removeError);
            }
            const commitHash = await gitCommit({
              path: appPath,
              message: `[alifullstack] Renamed file: ${tag.from} -> ${tag.to}`,
            });
            logger.log(`Committed file rename: ${tag.from} -> ${tag.to} with hash ${commitHash}`);
            return commitHash;
          }, "File rename commit", `${tag.from} -> ${tag.to}`);
        } else {
          logger.warn(`Source file for rename does not exist: ${fromPath}`);
        }

        // Handle Supabase functions
        if (isServerFunction(tag.from)) {
          await safeGitOperation(async () => {
            await deleteSupabaseFunction({
              supabaseProjectId: chatWithApp.app.supabaseProjectId!,
              functionName: getFunctionNameFromPath(tag.from),
            });
          }, "Supabase function deletion", tag.from);
        }
        if (isServerFunction(tag.to)) {
          await safeGitOperation(async () => {
            await deploySupabaseFunctions({
              supabaseProjectId: chatWithApp.app.supabaseProjectId!,
              functionName: getFunctionNameFromPath(tag.to),
              content: await readFileFromFunctionPath(toPath),
            });
          }, "Supabase function deployment", tag.to);
        }
      } catch (error) {
        errors.push({
          message: `Failed to rename file: ${tag.from} -> ${tag.to}`,
          error: error,
        });
      }
    }

    // Only remove terminal command tags that don't need UI rendering
    // Keep dyad-write, dyad-rename, dyad-delete, dyad-add-dependency, dyad-execute-sql, write_to_file, and search_replace tags
    // as they are rendered by the DyadMarkdownParser as interactive UI components
    const terminalTagRemovalRegexes = [
      /<dyad-run-backend-terminal-cmd[^>]*>[\s\S]*?<\/dyad-run-backend-terminal-cmd>/gi,
      /<dyad-run-frontend-terminal-cmd[^>]*>[\s\S]*?<\/dyad-run-frontend-terminal-cmd>/gi,
      /<run_terminal_cmd[^>]*>[\s\S]*?<\/run_terminal_cmd>/gi
    ];

    for (const regex of terminalTagRemovalRegexes) {
      fullResponse = fullResponse.replace(regex, '');
    }

    // Process all dyad-write tags one by one
    for (const tag of dyadWriteTags) {
      const filePath = tag.path;
      let content: string | Buffer = tag.content;
      const fullFilePath = safeJoin(appPath, filePath);

      try {
        // Check if this is a search_replace operation
        if (typeof content === "string" && content.startsWith("SEARCH_REPLACE:")) {
          // Handle search_replace operation
          const parts = content.split(":");
          if (parts.length >= 3) {
            const oldString = parts[1];
            const newString = parts.slice(2).join(":");

            if (fs.existsSync(fullFilePath)) {
              let fileContent = fs.readFileSync(fullFilePath, 'utf8');

              if (fileContent.includes(oldString)) {
                fileContent = fileContent.replace(oldString, newString);
                fs.writeFileSync(fullFilePath, fileContent);
                logger.log(`Successfully applied search_replace to file: ${fullFilePath}`);
                writtenFiles.push(filePath);

                // Commit immediately
                await safeGitOperation(async () => {
                  await git.add({
                    fs,
                    dir: appPath,
                    filepath: filePath,
                  });
                  const commitHash = await gitCommit({
                    path: appPath,
                    message: `[alifullstack] Applied search_replace to: ${filePath}`,
                  });
                  logger.log(`Committed search_replace operation: ${filePath} with hash ${commitHash}`);
                  return commitHash;
                }, "Search replace commit", filePath);
              } else {
                logger.warn(`Old string not found in file for search_replace: ${fullFilePath}`);
                warnings.push({
                  message: `Search string not found in file: ${filePath}`,
                  error: null,
                });
              }
            } else {
              logger.warn(`File not found for search_replace: ${fullFilePath}`);
              warnings.push({
                message: `File not found for search_replace: ${filePath}`,
                error: null,
              });
            }
          }
        } else {
          // Handle regular file write
          // Check if content (stripped of whitespace) exactly matches a file ID and replace with actual file content
          if (fileUploadsMap) {
            const trimmedContent = tag.content.trim();
            const fileInfo = fileUploadsMap.get(trimmedContent);
            if (fileInfo) {
              try {
                const fileContent = await readFile(fileInfo.filePath);
                content = fileContent;
                logger.log(
                  `Replaced file ID ${trimmedContent} with content from ${fileInfo.originalName}`,
                );
              } catch (error) {
                logger.error(
                  `Failed to read uploaded file ${fileInfo.originalName}:`,
                  error,
                );
                errors.push({
                  message: `Failed to read uploaded file: ${fileInfo.originalName}`,
                  error: error,
                });
              }
            }
          }

          // Ensure directory exists
          const dirPath = path.dirname(fullFilePath);
          fs.mkdirSync(dirPath, { recursive: true });

          // Write file content
          fs.writeFileSync(fullFilePath, content);
          logger.log(`Successfully wrote file: ${fullFilePath}`);
          writtenFiles.push(filePath);

          // Handle Supabase function deployment
          if (isServerFunction(filePath)) {
            const contentString = typeof content === "string" ? content : content.toString();
            await safeGitOperation(async () => {
              await deploySupabaseFunctions({
                supabaseProjectId: chatWithApp.app.supabaseProjectId!,
                functionName: path.basename(path.dirname(filePath)),
                content: contentString,
              });
            }, "Supabase function deployment", filePath);
          }

          // Commit immediately
          await safeGitOperation(async () => {
            await git.add({
              fs,
              dir: appPath,
              filepath: filePath,
            });
            const commitHash = await gitCommit({
              path: appPath,
              message: `[alifullstack] Wrote file: ${filePath}`,
            });
            logger.log(`Committed file write: ${filePath} with hash ${commitHash}`);
            return commitHash;
          }, "File write commit", filePath);
        }
      } catch (error) {
        errors.push({
          message: `Failed to write file: ${filePath}`,
          error: error,
        });
      }
    }

    // Process write_to_file tags one by one
    for (const tag of writeToFileTags) {
      const filePath = tag.path;
      let content: string | Buffer = tag.content;
      const fullFilePath = safeJoin(appPath, filePath);

      try {
        // Check if content (stripped of whitespace) exactly matches a file ID and replace with actual file content
        if (fileUploadsMap) {
          const trimmedContent = tag.content.trim();
          const fileInfo = fileUploadsMap.get(trimmedContent);
          if (fileInfo) {
            try {
              const fileContent = await readFile(fileInfo.filePath);
              content = fileContent;
              logger.log(
                `Replaced file ID ${trimmedContent} with content from ${fileInfo.originalName}`,
              );
            } catch (error) {
              logger.error(
                `Failed to read uploaded file ${fileInfo.originalName}:`,
                error,
              );
              errors.push({
                message: `Failed to read uploaded file: ${fileInfo.originalName}`,
                error: error,
              });
            }
          }
        }

        // Ensure directory exists
        const dirPath = path.dirname(fullFilePath);
        fs.mkdirSync(dirPath, { recursive: true });

        // Write file content
        fs.writeFileSync(fullFilePath, content);
        logger.log(`Successfully wrote file via write_to_file tag: ${fullFilePath}`);
        writtenFiles.push(filePath);

        // Handle Supabase function deployment
        if (isServerFunction(filePath)) {
          const contentString = typeof content === "string" ? content : content.toString();
          await safeGitOperation(async () => {
            await deploySupabaseFunctions({
              supabaseProjectId: chatWithApp.app.supabaseProjectId!,
              functionName: path.basename(path.dirname(filePath)),
              content: contentString,
            });
          }, "Supabase function deployment", filePath);
        }

        // Commit immediately
        await safeGitOperation(async () => {
          await git.add({
            fs,
            dir: appPath,
            filepath: filePath,
          });
          const commitHash = await gitCommit({
            path: appPath,
            message: `[alifullstack] Wrote file via write_to_file tag: ${filePath}`,
          });
          logger.log(`Committed write_to_file tag: ${filePath} with hash ${commitHash}`);
          return commitHash;
        }, "Write to file commit", filePath);
      } catch (error) {
        errors.push({
          message: `Failed to write file via write_to_file tag: ${filePath}`,
          error: error,
        });
      }
    }

    // Process search_replace tags one by one
    for (const tag of searchReplaceTags) {
      const filePath = tag.file;
      const fullFilePath = safeJoin(appPath, filePath);

      try {
        if (fs.existsSync(fullFilePath)) {
          let fileContent = fs.readFileSync(fullFilePath, 'utf8');

          // Replace old_string with new_string
          const oldString = tag.old_string.replace(/"/g, '"').replace(/</g, '<').replace(/>/g, '>').replace(/&/g, '&');
          const newString = tag.new_string.replace(/"/g, '"').replace(/</g, '<').replace(/>/g, '>').replace(/&/g, '&');

          if (fileContent.includes(oldString)) {
            fileContent = fileContent.replace(oldString, newString);
            fs.writeFileSync(fullFilePath, fileContent);
            logger.log(`Successfully applied search_replace to file: ${fullFilePath}`);
            writtenFiles.push(filePath);

            // Commit immediately
            await safeGitOperation(async () => {
              await git.add({
                fs,
                dir: appPath,
                filepath: filePath,
              });
              const commitHash = await gitCommit({
                path: appPath,
                message: `[alifullstack] Applied search_replace to: ${filePath}`,
              });
              logger.log(`Committed search_replace: ${filePath} with hash ${commitHash}`);
              return commitHash;
            }, "Search replace commit", filePath);
          } else {
            logger.warn(`Old string not found in file for search_replace: ${fullFilePath}`);
            warnings.push({
              message: `Search string not found in file: ${filePath}`,
              error: null,
            });
          }
        } else {
          logger.warn(`File not found for search_replace: ${fullFilePath}`);
          warnings.push({
            message: `File not found for search_replace: ${filePath}`,
            error: null,
          });
        }
      } catch (error) {
        logger.error(`Failed to apply search_replace to file: ${fullFilePath}`, error);
        errors.push({
          message: `Failed to apply search_replace to file: ${filePath}`,
          error: error,
        });
      }
    }

    // Check if we have any changes (for file dependencies handling)
    hasChanges =
      writtenFiles.length > 0 ||
      renamedFiles.length > 0 ||
      deletedFiles.length > 0 ||
      dyadAddDependencyPackages.length > 0 ||
      writeToFileTags.length > 0 ||
      searchReplaceTags.length > 0;

    const uncommittedFiles: string[] = [];
    let extraFilesError: string | undefined;

    if (hasChanges) {
      // Get the last commit hash from git log to save to the message
      try {
        const lastCommitHash = await git.log({
          fs,
          dir: appPath,
          depth: 1,
        });
        const commitHash = lastCommitHash?.[0]?.oid;

        if (commitHash) {
          await db
            .update(messages)
            .set({
              commitHash: commitHash,
            })
            .where(eq(messages.id, messageId));
        }
      } catch (error) {
        logger.warn("Failed to get last commit hash:", error);
      }
    }
    logger.log("mark as approved: hasChanges", hasChanges);
    // Update the message to approved
    await db
      .update(messages)
      .set({
        approvalState: "approved",
      })
      .where(eq(messages.id, messageId));

    // Invalidate app query to refresh file tree in UI
    if (hasChanges) {
      // We need to import the necessary components for invalidation
      // This will refresh the file tree to show updated structure
      try {
        // The invalidation will be handled by the React Query client in the renderer process
        // This ensures the file tree shows both frontend and backend directories
        logger.log("File changes detected, UI will refresh to show updated file tree");
      } catch (error) {
        logger.warn("Could not invalidate app query:", error);
      }
    }

    return {
      updatedFiles: hasChanges,
      extraFiles: (uncommittedFiles && uncommittedFiles.length > 0) ? uncommittedFiles : undefined,
      extraFilesError,
    };
  } catch (error: unknown) {
    logger.error("Error processing files:", error);
    return { error: (error as any).toString() };
  } finally {
    // Safely handle warnings and errors arrays (they might not be initialized if exception occurred early)
    const safeWarnings = warnings || [];
    const safeErrors = errors || [];

    // Create file operation confirmation messages - only for warnings/errors
    const fileOperationConfirmations: string[] = [];

    const appendedContent = `
    ${safeWarnings
      .map(
        (warning) =>
          `<dyad-output type="warning" message="${warning.message}">${warning.error}</dyad-output>`,
      )
      .join("\n")}
    ${safeErrors
      .map(
        (error) =>
          `<dyad-output type="error" message="${error.message}">${error.error}</dyad-output>`,
      )
      .join("\n")}
    ${fileOperationConfirmations.join("\n")}
    `;
    if (appendedContent && appendedContent.trim().length > 0) {
      const safeFullResponse = fullResponse || "";
      await db
        .update(messages)
        .set({
          content: safeFullResponse + "\n\n" + appendedContent,
        })
        .where(eq(messages.id, messageId));
    }
  }
}

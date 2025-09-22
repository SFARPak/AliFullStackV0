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

  const warnings: Output[] = [];
  const errors: Output[] = [];

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
            // Add error to backend terminal
            addTerminalOutput(chatWithApp.app.id, "backend", `❌ Error: ${cmdTag.description || cmdTag.command}`, "error");
          } else {
            logger.log(`Backend terminal command succeeded: ${cmdTag.description || cmdTag.command}`);

            // Add command and result to backend terminal
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

     // Handle general terminal command tags
     if (dyadRunTerminalCmdTags.length > 0) {
       for (const cmdTag of dyadRunTerminalCmdTags) {
         try {
           const cwd = cmdTag.cwd ? path.join(appPath, cmdTag.cwd) : appPath;

           logger.log(`Executing general terminal command: ${cmdTag.command} in ${cwd}`);

           const result = await runShellCommand(`cd "${cwd}" && ${cmdTag.command}`);

           if (result === null) {
             errors.push({
               message: `Terminal command failed: ${cmdTag.description || cmdTag.command}`,
               error: `Command execution failed in ${cwd}`,
             });
             // Add error to backend terminal
             addTerminalOutput(chatWithApp.app.id, "backend", `❌ Error: ${cmdTag.description || cmdTag.command}`, "error");
           } else {
             logger.log(`Terminal command succeeded: ${cmdTag.description || cmdTag.command}`);

             // Add command and result to backend terminal
             addTerminalOutput(chatWithApp.app.id, "backend", `$ ${cmdTag.command}`, "command");

             if (result.trim()) {
               addTerminalOutput(chatWithApp.app.id, "backend", result, "output");
             }

             addTerminalOutput(chatWithApp.app.id, "backend", `✅ ${cmdTag.description || cmdTag.command} completed successfully`, "success");
           }
         } catch (error) {
           errors.push({
             message: `Terminal command failed: ${cmdTag.description || cmdTag.command}`,
             error: error,
           });
           // Add error to backend terminal
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

    // Process all file deletions
    for (const filePath of dyadDeletePaths) {
      const fullFilePath = safeJoin(appPath, filePath);

      // Delete the file if it exists
      if (fs.existsSync(fullFilePath)) {
        if (fs.lstatSync(fullFilePath).isDirectory()) {
          fs.rmdirSync(fullFilePath, { recursive: true });
        } else {
          fs.unlinkSync(fullFilePath);
        }
        logger.log(`Successfully deleted file: ${fullFilePath}`);
        deletedFiles.push(filePath);

        // Remove the file from git
        try {
          await git.remove({
            fs,
            dir: appPath,
            filepath: filePath,
          });
        } catch (error) {
          logger.warn(`Failed to git remove deleted file ${filePath}:`, error);
          // Continue even if remove fails as the file was still deleted
        }
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
    }

    // Process all file renames
    for (const tag of dyadRenameTags) {
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

        // Add the new file and remove the old one from git
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
        } catch (error) {
          logger.warn(`Failed to git remove old file ${tag.from}:`, error);
          // Continue even if remove fails as the file was still renamed
        }
      } else {
        logger.warn(`Source file for rename does not exist: ${fromPath}`);
      }
      if (isServerFunction(tag.from)) {
        try {
          await deleteSupabaseFunction({
            supabaseProjectId: chatWithApp.app.supabaseProjectId!,
            functionName: getFunctionNameFromPath(tag.from),
          });
        } catch (error) {
          warnings.push({
            message: `Failed to delete Supabase function: ${tag.from} as part of renaming ${tag.from} to ${tag.to}`,
            error: error,
          });
        }
      }
      if (isServerFunction(tag.to)) {
        try {
          await deploySupabaseFunctions({
            supabaseProjectId: chatWithApp.app.supabaseProjectId!,
            functionName: getFunctionNameFromPath(tag.to),
            content: await readFileFromFunctionPath(toPath),
          });
        } catch (error) {
          errors.push({
            message: `Failed to deploy Supabase function: ${tag.to} as part of renaming ${tag.from} to ${tag.to}`,
            error: error,
          });
        }
      }
    }

    // Process all file writes (dyad-write tags)
    for (const tag of dyadWriteTags) {
      const filePath = tag.path;
      let content: string | Buffer = tag.content;
      const fullFilePath = safeJoin(appPath, filePath);

      // Check if this is a search_replace operation
      if (typeof content === "string" && content.startsWith("SEARCH_REPLACE:")) {
        // Handle search_replace operation
        const parts = content.split(":");
        if (parts.length >= 3) {
          const oldString = parts[1];
          const newString = parts.slice(2).join(":");

          if (fs.existsSync(fullFilePath)) {
            try {
              let fileContent = fs.readFileSync(fullFilePath, 'utf8');

              if (fileContent.includes(oldString)) {
                fileContent = fileContent.replace(oldString, newString);
                fs.writeFileSync(fullFilePath, fileContent);
                logger.log(`Successfully applied search_replace to file: ${fullFilePath}`);
                writtenFiles.push(filePath);
              } else {
                logger.warn(`Old string not found in file for search_replace: ${fullFilePath}`);
                warnings.push({
                  message: `Search string not found in file: ${filePath}`,
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
        if (isServerFunction(filePath) && typeof content === "string") {
          try {
            await deploySupabaseFunctions({
              supabaseProjectId: chatWithApp.app.supabaseProjectId!,
              functionName: path.basename(path.dirname(filePath)),
              content: content,
            });
          } catch (error) {
            errors.push({
              message: `Failed to deploy Supabase function: ${filePath}`,
              error: error,
            });
          }
        }
      }
    }

    // Process write_to_file tags
    for (const tag of writeToFileTags) {
      const filePath = tag.path;
      let content: string | Buffer = tag.content;
      const fullFilePath = safeJoin(appPath, filePath);

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
      if (isServerFunction(filePath) && typeof content === "string") {
        try {
          await deploySupabaseFunctions({
            supabaseProjectId: chatWithApp.app.supabaseProjectId!,
            functionName: path.basename(path.dirname(filePath)),
            content: content,
          });
        } catch (error) {
          errors.push({
            message: `Failed to deploy Supabase function: ${filePath}`,
            error: error,
          });
        }
      }
    }

    // Process search_replace tags
    for (const tag of searchReplaceTags) {
      const filePath = tag.file;
      const fullFilePath = safeJoin(appPath, filePath);

      if (fs.existsSync(fullFilePath)) {
        try {
          let fileContent = fs.readFileSync(fullFilePath, 'utf8');

          // Replace old_string with new_string
          const oldString = tag.old_string.replace(/"/g, '"').replace(/</g, '<').replace(/>/g, '>').replace(/&/g, '&');
          const newString = tag.new_string.replace(/"/g, '"').replace(/</g, '<').replace(/>/g, '>').replace(/&/g, '&');

          if (fileContent.includes(oldString)) {
            fileContent = fileContent.replace(oldString, newString);
            fs.writeFileSync(fullFilePath, fileContent);
            logger.log(`Successfully applied search_replace to file: ${fullFilePath}`);
            writtenFiles.push(filePath);
          } else {
            logger.warn(`Old string not found in file for search_replace: ${fullFilePath}`);
            warnings.push({
              message: `Search string not found in file: ${filePath}`,
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
      } else {
        logger.warn(`File not found for search_replace: ${fullFilePath}`);
        warnings.push({
          message: `File not found for search_replace: ${filePath}`,
          error: null,
        });
      }
    }

    // If we have any file changes, commit them all at once
    hasChanges =
      writtenFiles.length > 0 ||
      renamedFiles.length > 0 ||
      deletedFiles.length > 0 ||
      dyadAddDependencyPackages.length > 0 ||
      writeToFileTags.length > 0 ||
      searchReplaceTags.length > 0;

    let uncommittedFiles: string[] = [];
    let extraFilesError: string | undefined;

    if (hasChanges) {
      // Stage all written files
      for (const file of writtenFiles) {
        await git.add({
          fs,
          dir: appPath,
          filepath: file,
        });
      }

      // Create commit with details of all changes
      const changes = [];
      if (writtenFiles.length > 0)
        changes.push(`wrote ${writtenFiles.length} file(s)`);
      if (renamedFiles.length > 0)
        changes.push(`renamed ${renamedFiles.length} file(s)`);
      if (deletedFiles.length > 0)
        changes.push(`deleted ${deletedFiles.length} file(s)`);
      if (dyadAddDependencyPackages.length > 0)
        changes.push(
          `added ${dyadAddDependencyPackages.join(", ")} package(s)`,
        );
      if (dyadExecuteSqlQueries.length > 0)
        changes.push(`executed ${dyadExecuteSqlQueries.length} SQL queries`);

      const commitMessage = chatSummary
        ? `[alifullstack] ${chatSummary} - ${changes.join(", ")}`
        : `[alifullstack] ${changes.join(", ")}`;
      // Use chat summary, if provided, or default for commit message
      let commitHash = await gitCommit({
        path: appPath,
        message: commitMessage,
      });
      logger.log(`Successfully committed changes: ${changes.join(", ")}`);

      // Check for any uncommitted changes after the commit
      const statusMatrix = await git.statusMatrix({ fs, dir: appPath });
      uncommittedFiles = (statusMatrix || [])
        .filter((row) => row[1] !== 1 || row[2] !== 1 || row[3] !== 1)
        .map((row) => row[0]); // Get just the file paths

      if (uncommittedFiles.length > 0) {
        // Stage all changes
        await git.add({
          fs,
          dir: appPath,
          filepath: ".",
        });
        try {
          commitHash = await gitCommit({
            path: appPath,
            message: commitMessage + " + extra files edited outside of AliFullStack",
            amend: true,
          });
          logger.log(
            `Amend commit with changes outside of dyad: ${uncommittedFiles.join(", ")}`,
          );
        } catch (error) {
          // Just log, but don't throw an error because the user can still
          // commit these changes outside of Dyad if needed.
          logger.error(
            `Failed to commit changes outside of dyad: ${uncommittedFiles.join(
              ", ",
            )}`,
          );
          extraFilesError = (error as any).toString();
        }
      }

      // Save the commit hash to the message
      await db
        .update(messages)
        .set({
          commitHash: commitHash,
        })
        .where(eq(messages.id, messageId));
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

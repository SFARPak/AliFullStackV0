import { db } from "../../db";
import { messages } from "../../db/schema";
import { eq } from "drizzle-orm";
import { Message } from "../ipc_types";
import { exec } from "node:child_process";
import { promisify } from "node:util";

export const execPromise = promisify(exec);

export async function executeAddDependency({
  packages,
  message,
  appPath,
}: {
  packages: string[];
  message: Message;
  appPath: string;
}) {
  const packageStr = packages.join(" ");

  let installResults: string;
  try {
    const { stdout, stderr } = await execPromise(
      `(pnpm add ${packageStr}) || (npm install --legacy-peer-deps ${packageStr})`,
      {
        cwd: appPath,
      },
    );
    installResults = stdout + (stderr ? `\n${stderr}` : "");
  } catch (installError) {
    // If package installation fails, try cleaning node_modules and retrying
    console.warn(`Package installation failed for ${packageStr}, attempting cleanup and retry:`, installError);

    try {
      // Clean up potential corrupted files and temporary directories
      await execPromise(`rm -rf node_modules/.tmp-* node_modules/*_tmp_* node_modules/.pnpm-debug.log* node_modules/.*-* node_modules/*-*`, {
        cwd: appPath,
      });

      // Clear package manager caches
      await execPromise(`pnpm store prune || npm cache clean --force || true`, {
        cwd: appPath,
      });

      // Retry installation with fresh state
      const { stdout, stderr } = await execPromise(
        `(pnpm add ${packageStr} --ignore-scripts) || (npm install --legacy-peer-deps ${packageStr} --ignore-scripts)`,
        {
          cwd: appPath,
        },
      );
      installResults = `Installation failed initially but succeeded after cleanup.\n${stdout}${stderr ? `\n${stderr}` : ""}`;
    } catch (retryError) {
      // If retry also fails, try one more time with different approach
      try {
        console.warn(`Retry also failed, trying alternative installation method:`, retryError);
        const { stdout, stderr } = await execPromise(
          `npm install ${packageStr} --no-package-lock --legacy-peer-deps`,
          {
            cwd: appPath,
          },
        );
        installResults = `Installation succeeded with npm fallback.\n${stdout}${stderr ? `\n${stderr}` : ""}`;
      } catch (finalError) {
        // If all methods fail, return the error information
        installResults = `Package installation failed after multiple attempts:\nInitial error: ${(installError as Error).message}\nRetry error: ${(retryError as Error).message}\nFinal attempt error: ${(finalError as Error).message}`;
      }
    }
  }

  // Update the message content with the installation results
  const updatedContent = message.content.replace(
    new RegExp(
      `<dyad-add-dependency packages="${packages.join(
        " ",
      )}">[^<]*</dyad-add-dependency>`,
      "g",
    ),
    `<dyad-add-dependency packages="${packages.join(
      " ",
    )}">${installResults}</dyad-add-dependency>`,
  );

  // Save the updated message back to the database
  await db
    .update(messages)
    .set({ content: updatedContent })
    .where(eq(messages.id, message.id));
}

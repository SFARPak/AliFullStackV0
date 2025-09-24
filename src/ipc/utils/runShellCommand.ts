import { spawn } from "child_process";
import log from "electron-log";

const logger = log.scope("runShellCommand");

export function runShellCommand(command: string, cwd?: string): Promise<string | null> {
  logger.log(`Running command: ${command}${cwd ? ` in ${cwd}` : ''}`);
  return new Promise((resolve) => {
    let output = "";
    let stderrOutput = "";
    const process = spawn(command, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"], // ignore stdin, pipe stdout/stderr
      cwd: cwd, // Set working directory if provided
    });

    process.stdout?.on("data", (data) => {
      output += data.toString();
    });

    process.stderr?.on("data", (data) => {
      stderrOutput += data.toString();
      // Log stderr but don't treat it as a failure unless the exit code is non-zero
      logger.warn(`Stderr from "${command}": ${data.toString().trim()}`);
    });

    process.on("error", (error) => {
      logger.error(`Error executing command "${command}":`, error.message);
      resolve(null); // Command execution failed
    });

    process.on("close", (code) => {
      if (code === 0) {
        logger.debug(
          `Command "${command}" succeeded with code ${code}: ${output.trim()}`,
        );
        resolve(output.trim()); // Command succeeded, return trimmed output
      } else {
        logger.error(`Command "${command}" failed with code ${code}. Stderr: ${stderrOutput.trim()}`);
        resolve(null); // Command failed
      }
    });
  });
}

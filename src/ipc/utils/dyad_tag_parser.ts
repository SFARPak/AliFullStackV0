import { normalizePath } from "../../../shared/normalizePath";
import log from "electron-log";
import { SqlQuery } from "../../lib/schemas";

const logger = log.scope("dyad_tag_parser");

export function getDyadWriteTags(fullResponse: string): {
  path: string;
  content: string;
  description?: string;
}[] {
  const dyadWriteRegex = /<dyad-write([^>]*)>([\s\S]*?)<\/dyad-write>/gi;
  const pathRegex = /path="([^"]+)"/;
  const descriptionRegex = /description="([^"]+)"/;

  let match;
  const tags: { path: string; content: string; description?: string }[] = [];

  while ((match = dyadWriteRegex.exec(fullResponse)) !== null) {
    const attributesString = match[1];
    let content = match[2].trim();

    const pathMatch = pathRegex.exec(attributesString);
    const descriptionMatch = descriptionRegex.exec(attributesString);

    if (pathMatch && pathMatch[1]) {
      // Direct dyad-write tag with path attribute
      const path = pathMatch[1];
      const description = descriptionMatch?.[1];

      const contentLines = content.split("\n");
      if (contentLines[0]?.startsWith("```")) {
        contentLines.shift();
      }
      if (contentLines[contentLines.length - 1]?.startsWith("```")) {
        contentLines.pop();
      }
      content = contentLines.join("\n");

      tags.push({ path: normalizePath(path), content, description });
    } else {
      // Check if content contains nested write_to_file or search_replace tags
      const writeToFileTags = getWriteToFileTags(content);
      const searchReplaceTags = getSearchReplaceTags(content);

      // Add nested write_to_file tags
      for (const tag of writeToFileTags) {
        tags.push({ path: tag.path, content: tag.content, description: undefined });
      }

      // Add nested search_replace tags (convert to write operations)
      for (const tag of searchReplaceTags) {
        // For search_replace in dyad-write context, we need to read the file and apply the changes
        // But since this is parsing, we'll mark it for later processing
        tags.push({
          path: tag.file,
          content: `SEARCH_REPLACE:${tag.old_string}:${tag.new_string}`,
          description: undefined
        });
      }

      if (writeToFileTags.length === 0 && searchReplaceTags.length === 0) {
        logger.warn(
          "Found <dyad-write> tag without a valid 'path' attribute and no nested tags:",
          match[0],
        );
      }
    }
  }
  return tags;
}

export function getDyadRenameTags(fullResponse: string): {
  from: string;
  to: string;
}[] {
  const dyadRenameRegex =
    /<dyad-rename from="([^"]+)" to="([^"]+)"[^>]*>([\s\S]*?)<\/dyad-rename>/g;
  let match;
  const tags: { from: string; to: string }[] = [];
  while ((match = dyadRenameRegex.exec(fullResponse)) !== null) {
    tags.push({
      from: normalizePath(match[1]),
      to: normalizePath(match[2]),
    });
  }
  return tags;
}

export function getDyadDeleteTags(fullResponse: string): string[] {
  const dyadDeleteRegex =
    /<dyad-delete path="([^"]+)"[^>]*>([\s\S]*?)<\/dyad-delete>/g;
  let match;
  const paths: string[] = [];
  while ((match = dyadDeleteRegex.exec(fullResponse)) !== null) {
    paths.push(normalizePath(match[1]));
  }
  return paths;
}

export function getDyadAddDependencyTags(fullResponse: string): string[] {
  const dyadAddDependencyRegex =
    /<dyad-add-dependency packages="([^"]+)">[^<]*<\/dyad-add-dependency>/g;
  let match;
  const packages: string[] = [];
  while ((match = dyadAddDependencyRegex.exec(fullResponse)) !== null) {
    packages.push(...match[1].split(" "));
  }
  return packages;
}

export function getDyadChatSummaryTag(fullResponse: string): string | null {
  const dyadChatSummaryRegex =
    /<dyad-chat-summary>([\s\S]*?)<\/dyad-chat-summary>/g;
  const match = dyadChatSummaryRegex.exec(fullResponse);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
}

export function getDyadExecuteSqlTags(fullResponse: string): SqlQuery[] {
  const dyadExecuteSqlRegex =
    /<dyad-execute-sql([^>]*)>([\s\S]*?)<\/dyad-execute-sql>/g;
  const descriptionRegex = /description="([^"]+)"/;
  let match;
  const queries: { content: string; description?: string }[] = [];

  while ((match = dyadExecuteSqlRegex.exec(fullResponse)) !== null) {
    const attributesString = match[1] || "";
    let content = match[2].trim();
    const descriptionMatch = descriptionRegex.exec(attributesString);
    const description = descriptionMatch?.[1];

    // Handle markdown code blocks if present
    const contentLines = content.split("\n");
    if (contentLines[0]?.startsWith("```")) {
      contentLines.shift();
    }
    if (contentLines[contentLines.length - 1]?.startsWith("```")) {
      contentLines.pop();
    }
    content = contentLines.join("\n");

    queries.push({ content, description });
  }

  return queries;
}

export function getDyadCommandTags(fullResponse: string): string[] {
  const dyadCommandRegex =
    /<dyad-command type="([^"]+)"[^>]*><\/dyad-command>/g;
  let match;
  const commands: string[] = [];

  while ((match = dyadCommandRegex.exec(fullResponse)) !== null) {
    commands.push(match[1]);
  }

  return commands;
}

export function getDyadRunBackendTerminalCmdTags(fullResponse: string): {
  command: string;
  cwd?: string;
  description?: string;
}[] {
  const dyadRunBackendTerminalCmdRegex =
    /<dyad-run-backend-terminal-cmd([^>]*)>([\s\S]*?)<\/dyad-run-backend-terminal-cmd>/g;
  const cwdRegex = /cwd="([^"]+)"/;
  const descriptionRegex = /description="([^"]+)"/;

  let match;
  const commands: { command: string; cwd?: string; description?: string }[] = [];

  while ((match = dyadRunBackendTerminalCmdRegex.exec(fullResponse)) !== null) {
    const attributesString = match[1];
    const command = match[2].trim();

    const cwdMatch = cwdRegex.exec(attributesString);
    const descriptionMatch = descriptionRegex.exec(attributesString);

    const cwd = cwdMatch?.[1];
    const description = descriptionMatch?.[1];

    commands.push({ command, cwd, description });
  }

  return commands;
}

export function getDyadRunFrontendTerminalCmdTags(fullResponse: string): {
  command: string;
  cwd?: string;
  description?: string;
}[] {
  const dyadRunFrontendTerminalCmdRegex =
    /<dyad-run-frontend-terminal-cmd([^>]*)>([\s\S]*?)<\/dyad-run-frontend-terminal-cmd>/g;
  const cwdRegex = /cwd="([^"]+)"/;
  const descriptionRegex = /description="([^"]+)"/;

  let match;
  const commands: { command: string; cwd?: string; description?: string }[] = [];

  while ((match = dyadRunFrontendTerminalCmdRegex.exec(fullResponse)) !== null) {
    const attributesString = match[1];
    const command = match[2].trim();

    const cwdMatch = cwdRegex.exec(attributesString);
    const descriptionMatch = descriptionRegex.exec(attributesString);

    const cwd = cwdMatch?.[1];
    const description = descriptionMatch?.[1];

    commands.push({ command, cwd, description });
  }

  return commands;
}

export function getDyadRunTerminalCmdTags(fullResponse: string): {
  command: string;
  cwd?: string;
  description?: string;
}[] {
  const dyadRunTerminalCmdRegex =
    /<run_terminal_cmd([^>]*)>([\s\S]*?)<\/run_terminal_cmd>/g;
  const cwdRegex = /cwd="([^"]+)"/;
  const descriptionRegex = /description="([^"]+)"/;

  let match;
  const commands: { command: string; cwd?: string; description?: string }[] = [];

  while ((match = dyadRunTerminalCmdRegex.exec(fullResponse)) !== null) {
    const attributesString = match[1];
    const command = match[2].trim();

    const cwdMatch = cwdRegex.exec(attributesString);
    const descriptionMatch = descriptionRegex.exec(attributesString);

    const cwd = cwdMatch?.[1];
    const description = descriptionMatch?.[1];

    commands.push({ command, cwd, description });
  }

  return commands;
}

export function getWriteToFileTags(fullResponse: string): {
  path: string;
  content: string;
}[] {
  const writeToFileRegex = /<write_to_file path="([^"]+)">([\s\S]*?)<\/write_to_file>/g;

  let match;
  const tags: { path: string; content: string }[] = [];

  while ((match = writeToFileRegex.exec(fullResponse)) !== null) {
    const path = match[1];
    let content = match[2];

    // Remove leading/trailing whitespace and markdown code blocks
    content = content.trim();
    const contentLines = content.split("\n");
    if (contentLines[0]?.startsWith("```")) {
      contentLines.shift();
    }
    if (contentLines[contentLines.length - 1]?.startsWith("```")) {
      contentLines.pop();
    }
    content = contentLines.join("\n");

    tags.push({ path: normalizePath(path), content });
  }

  return tags;
}

export function getSearchReplaceTags(fullResponse: string): {
  file: string;
  old_string: string;
  new_string: string;
}[] {
  // Match the search_replace format: <search_replace file="..." old_string="...">content</search_replace>
  const searchReplaceRegex = /<search_replace\s+file="([^"]+)"\s+old_string="([^"]*)">([\s\S]*?)<\/search_replace>/g;

  let match;
  const tags: { file: string; old_string: string; new_string: string }[] = [];

  while ((match = searchReplaceRegex.exec(fullResponse)) !== null) {
    const file = match[1];
    const old_string = match[2];
    let new_string = match[3].trim();

    // Remove leading/trailing whitespace and markdown code blocks
    const contentLines = new_string.split("\n");
    if (contentLines[0]?.startsWith("```")) {
      contentLines.shift();
    }
    if (contentLines[contentLines.length - 1]?.startsWith("```")) {
      contentLines.pop();
    }
    new_string = contentLines.join("\n");

    tags.push({ file: normalizePath(file), old_string, new_string });
  }

  return tags;
}

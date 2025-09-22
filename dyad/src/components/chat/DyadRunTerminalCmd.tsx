import React, { useState } from "react";
import { Terminal, ChevronUp, ChevronDown, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { CustomTagState } from "./stateTypes";

interface DyadRunTerminalCmdProps {
  children: React.ReactNode;
  node?: {
    properties?: {
      description?: string;
      cwd?: string;
      state?: CustomTagState;
    };
  };
}

export const DyadRunTerminalCmd: React.FC<DyadRunTerminalCmdProps> = ({
  children,
  node,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const state = node?.properties?.state;
  const description = node?.properties?.description;
  const cwd = node?.properties?.cwd;

  const getStateIcon = () => {
    switch (state) {
      case "pending":
        return <Loader2 size={16} className="text-blue-500 animate-spin" />;
      case "finished":
        return <CheckCircle size={16} className="text-green-500" />;
      case "aborted":
        return <XCircle size={16} className="text-red-500" />;
      default:
        return <Terminal size={16} className="text-gray-500" />;
    }
  };

  const getBorderColor = () => {
    switch (state) {
      case "pending":
        return "border-blue-500";
      case "finished":
        return "border-green-500";
      case "aborted":
        return "border-red-500";
      default:
        return "border-gray-500";
    }
  };

  return (
    <div
      className={`relative bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg px-4 py-3 border border-l-4 my-2 cursor-pointer transition-colors ${getBorderColor()}`}
      onClick={() => setIsExpanded(!isExpanded)}
      role="button"
      aria-expanded={isExpanded}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setIsExpanded(!isExpanded);
        }
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {getStateIcon()}
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
            Terminal Command
          </span>
          {description && (
            <span className="text-xs text-gray-600 dark:text-gray-400">
              {description}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {cwd && (
            <span className="text-xs text-gray-500 dark:text-gray-500 bg-gray-200 dark:bg-gray-800 px-2 py-1 rounded">
              cwd: {cwd}
            </span>
          )}
          {isExpanded ? (
            <ChevronUp size={16} className="text-gray-500" />
          ) : (
            <ChevronDown size={16} className="text-gray-500" />
          )}
        </div>
      </div>

      {/* Expandable content */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isExpanded ? "max-h-96 opacity-100 mt-3" : "max-h-0 opacity-0"
        }`}
      >
        <div className="bg-gray-900 dark:bg-black rounded-md p-3 font-mono text-sm text-green-400 dark:text-green-300">
          <pre className="whitespace-pre-wrap break-words">{children}</pre>
        </div>
      </div>
    </div>
  );
};

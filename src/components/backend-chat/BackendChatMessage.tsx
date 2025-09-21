import type { Message } from "@/ipc/ipc_types";
import {
  DyadMarkdownParser,
  VanillaMarkdownParser,
} from "../chat/DyadMarkdownParser";
import { motion } from "framer-motion";
import { useStreamChat } from "@/hooks/useStreamChat";
import { CheckCircle, XCircle, Clock, GitCommit, Server } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useVersions } from "@/hooks/useVersions";
import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useMemo } from "react";

interface BackendChatMessageProps {
  message: Message;
  isLastMessage?: boolean;
}

const BackendChatMessage = ({ message, isLastMessage }: BackendChatMessageProps) => {
  const { isStreaming } = useStreamChat();
  const appId = useAtomValue(selectedAppIdAtom);
  const { versions: liveVersions } = useVersions(appId);

  // Find the version that was active when this message was sent
  const messageVersion = useMemo(() => {
    if (
      message.role === "assistant" &&
      message.commitHash &&
      liveVersions.length
    ) {
      return (
        liveVersions.find(
          (version) =>
            message.commitHash &&
            version.oid.slice(0, 7) === message.commitHash.slice(0, 7),
        ) || null
      );
    }
    return null;
  }, [message.commitHash, message.role, liveVersions]);

  // Format the message timestamp
  const formatTimestamp = (timestamp: string | Date) => {
    const now = new Date();
    const messageTime = new Date(timestamp);
    const diffInHours =
      (now.getTime() - messageTime.getTime()) / (1000 * 60 * 60);
    if (diffInHours < 24) {
      return formatDistanceToNow(messageTime, { addSuffix: true });
    } else {
      return format(messageTime, "MMM d, yyyy 'at' h:mm a");
    }
  };

  return (
    <div
      className={`flex ${
        message.role === "assistant" ? "justify-start" : "justify-end"
      }`}
    >
      <div className={`mt-2 w-full max-w-3xl mx-auto group`}>
        <div
          className={`rounded-lg p-2 border ${
            message.role === "assistant"
              ? "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20"
              : "ml-24 bg-blue-100 dark:bg-blue-900/50 border-blue-300 dark:border-blue-700"
          }`}
        >
          {/* Backend mode indicator for assistant messages */}
          {message.role === "assistant" && (
            <div className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 mb-2">
              <Server size={12} />
              <span>Roo-Code Logic</span>
            </div>
          )}

          {message.role === "assistant" &&
          !message.content &&
          isStreaming &&
          isLastMessage ? (
            <div className="flex h-6 items-center space-x-2 p-2">
              <motion.div
                className="h-3 w-3 rounded-full bg-blue-500"
                animate={{ y: [0, -12, 0] }}
                transition={{
                  repeat: Number.POSITIVE_INFINITY,
                  duration: 0.4,
                  ease: "easeOut",
                  repeatDelay: 1.2,
                }}
              />
              <motion.div
                className="h-3 w-3 rounded-full bg-blue-500"
                animate={{ y: [0, -12, 0] }}
                transition={{
                  repeat: Number.POSITIVE_INFINITY,
                  duration: 0.4,
                  ease: "easeOut",
                  delay: 0.4,
                  repeatDelay: 1.2,
                }}
              />
              <motion.div
                className="h-3 w-3 rounded-full bg-blue-500"
                animate={{ y: [0, -12, 0] }}
                transition={{
                  repeat: Number.POSITIVE_INFINITY,
                  duration: 0.4,
                  ease: "easeOut",
                  delay: 0.8,
                  repeatDelay: 1.2,
                }}
              />
            </div>
          ) : (
            <div
              className="prose dark:prose-invert prose-headings:mb-2 prose-p:my-1 prose-pre:my-0 max-w-none break-words"
              suppressHydrationWarning
            >
              {message.role === "assistant" ? (
                <>
                  <DyadMarkdownParser content={message.content} />
                  {isLastMessage && isStreaming && (
                    <div className="mt-4 ml-4 relative w-5 h-5 animate-spin">
                      <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-blue-500 rounded-full"></div>
                      <div className="absolute bottom-0 left-0 w-2 h-2 bg-blue-500 rounded-full opacity-80"></div>
                      <div className="absolute bottom-0 right-0 w-2 h-2 bg-blue-500 rounded-full opacity-60"></div>
                    </div>
                  )}
                </>
              ) : (
                <VanillaMarkdownParser content={message.content} />
              )}
            </div>
          )}
          {message.approvalState && (
            <div className="mt-2 flex items-center justify-end space-x-1 text-xs">
              {message.approvalState === "approved" ? (
                <>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span>Approved</span>
                </>
              ) : message.approvalState === "rejected" ? (
                <>
                  <XCircle className="h-4 w-4 text-red-500" />
                  <span>Rejected</span>
                </>
              ) : null}
            </div>
          )}
        </div>
        {/* Timestamp and commit info for assistant messages - only visible on hover */}
        {message.role === "assistant" && message.createdAt && (
          <div className="mt-1 flex items-center justify-start space-x-2 text-xs text-gray-500 dark:text-gray-400">
            <div className="flex items-center space-x-1">
              <Clock className="h-3 w-3" />
              <span>{formatTimestamp(message.createdAt)}</span>
            </div>
            {messageVersion && messageVersion.message && (
              <div className="flex items-center space-x-1">
                <GitCommit className="h-3 w-3" />
                {messageVersion && messageVersion.message && (
                  <span className="max-w-70 truncate font-medium">
                    {
                      messageVersion.message
                        .replace(/^\[alifullstack\]\s*/i, "")
                        .split("\n")[0]
                    }
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export { BackendChatMessage };
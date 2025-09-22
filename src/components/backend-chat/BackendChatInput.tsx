import {
  StopCircleIcon,
  X,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  AlertOctagon,
  FileText,
  Check,
  Loader2,
  Package,
  FileX,
  SendToBack,
  Database,
  ChevronsUpDown,
  ChevronsDownUp,
  ChartColumnIncreasing,
  SendHorizontalIcon,
  Server,
} from "lucide-react";
import type React from "react";
import { useState, useEffect, useCallback } from "react";
import log from "electron-log";

import { useSettings } from "@/hooks/useSettings";
import { IpcClient } from "@/ipc/ipc_client";
import {
  chatInputValueAtom,
  chatMessagesAtom,
  selectedChatIdAtom,
} from "@/atoms/chatAtoms";
import { atom, useAtom, useSetAtom, useAtomValue } from "jotai";
import { useStreamChat } from "@/hooks/useStreamChat";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { Button } from "../ui/button";
import { useProposal } from "@/hooks/useProposal";
import {
  ActionProposal,
  Proposal,
  SuggestedAction,
  FileChange,
  SqlQuery,
} from "@/lib/schemas";
import type { Message } from "@/ipc/ipc_types";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { useRunApp } from "@/hooks/useRunApp";
import { AutoApproveSwitch } from "../AutoApproveSwitch";
import { usePostHog } from "posthog-js/react";
import { CodeHighlight } from "../chat/CodeHighlight";
import { TokenBar } from "../chat/TokenBar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { useNavigate } from "@tanstack/react-router";
import { useVersions } from "@/hooks/useVersions";
import { useAttachments } from "@/hooks/useAttachments";
import { AttachmentsList } from "../chat/AttachmentsList";
import { DragDropOverlay } from "../chat/DragDropOverlay";
import { FileAttachmentDropdown } from "../chat/FileAttachmentDropdown";
import { showError, showExtraFilesToast } from "@/lib/toast";
import { ChatInputControls } from "../ChatInputControls";
import { ChatErrorBox } from "../chat/ChatErrorBox";
import { selectedComponentPreviewAtom } from "@/atoms/previewAtoms";
import { SelectedComponentDisplay } from "../chat/SelectedComponentDisplay";

const showTokenBarAtom = atom(false);
const logger = log.scope("BackendChatInput");

export function BackendChatInput({ chatId }: { chatId?: number }) {
  const posthog = usePostHog();
  const [inputValue, setInputValue] = useAtom(chatInputValueAtom);
  const { settings } = useSettings();
  const appId = useAtomValue(selectedAppIdAtom);
  const { refreshVersions } = useVersions(appId);
  const { streamMessage, isStreaming, setIsStreaming, error, setError } =
    useStreamChat();
  const [showError, setShowError] = useState(true);
  const [isApproving, setIsApproving] = useState(false); // State for approving
  const [isRejecting, setIsRejecting] = useState(false); // State for rejecting
  const [, setMessages] = useAtom<Message[]>(chatMessagesAtom);
  const setIsPreviewOpen = useSetAtom(isPreviewOpenAtom);
  const [showTokenBar, setShowTokenBar] = useAtom(showTokenBarAtom);
  const [selectedComponent, setSelectedComponent] = useAtom(
    selectedComponentPreviewAtom,
  );

  // Use the attachments hook
  const {
    attachments,
    isDraggingOver,
    handleFileSelect,
    removeAttachment,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    clearAttachments,
    handlePaste,
  } = useAttachments();

  // Auto-start servers when entering backend or fullstack mode
  useEffect(() => {
    const startServers = async () => {
      if (!appId) return;

      try {
        // Always start backend server for backend/fullstack modes
        logger.info(`Auto-starting backend server for app: ${appId}`);
        await IpcClient.getInstance().startBackendServer(appId);
        logger.info("Backend server started successfully");

        // For fullstack mode, also start frontend server
        if (settings?.selectedChatMode === "fullstack") {
          logger.info(`Auto-starting frontend server for fullstack app: ${appId}`);
          await IpcClient.getInstance().startFrontendServer(appId);
          logger.info("Frontend server started successfully");
        }
      } catch (error) {
        logger.error("Failed to auto-start servers:", error);
      }
    };

    // Small delay to ensure component is fully mounted
    const timeoutId = setTimeout(startServers, 1000);
    return () => clearTimeout(timeoutId);
  }, [appId, settings?.selectedChatMode]);

  // Use the hook to fetch the proposal
  const {
    proposalResult,
    isLoading: isProposalLoading,
    error: proposalError,
    refreshProposal,
  } = useProposal(chatId);
  const { proposal, messageId } = proposalResult ?? {};

  useEffect(() => {
    if (error) {
      setShowError(true);
    }
  }, [error]);

  const fetchChatMessages = useCallback(async () => {
    if (!chatId) {
      setMessages([]);
      return;
    }
    const chat = await IpcClient.getInstance().getChat(chatId);
    setMessages(chat.messages);
  }, [chatId, setMessages]);

  const handleSubmit = async () => {
    if (
      (!inputValue.trim() && attachments.length === 0) ||
      isStreaming ||
      !chatId
    ) {
      return;
    }

    const currentInput = inputValue;
    setInputValue("");
    setSelectedComponent(null);

    // Send message with attachments and clear them after sending
    await streamMessage({
      prompt: currentInput,
      chatId,
      chatMode: "backend",
      attachments,
      redo: false,
      selectedComponent,
    });
    clearAttachments();
    posthog.capture("backend-chat:submit");
  };

  const handleCancel = () => {
    if (chatId) {
      IpcClient.getInstance().cancelChatStream(chatId);
    }
    setIsStreaming(false);
  };

  const dismissError = () => {
    setShowError(false);
  };

  const handleApprove = async () => {
    if (!chatId || !messageId || isApproving || isRejecting || isStreaming)
      return;
    console.log(
      `Approving proposal for chatId: ${chatId}, messageId: ${messageId}`,
    );
    setIsApproving(true);
    posthog.capture("backend-chat:approve");
    try {
      const result = await IpcClient.getInstance().approveProposal({
        chatId,
        messageId,
      });
      if (result.extraFiles) {
        showExtraFilesToast({
          files: result.extraFiles,
          error: result.extraFilesError,
          posthog,
        });
      }
    } catch (err) {
      console.error("Error approving proposal:", err);
      setError((err as Error)?.message || "An error occurred while approving");
    } finally {
      setIsApproving(false);
      setIsPreviewOpen(true);
      refreshVersions();
      // Keep same as handleReject
      refreshProposal();
      fetchChatMessages();
    }
  };

  const handleReject = async () => {
    if (!chatId || !messageId || isApproving || isRejecting || isStreaming)
      return;
    console.log(
      `Rejecting proposal for chatId: ${chatId}, messageId: ${messageId}`,
    );
    setIsRejecting(true);
    posthog.capture("backend-chat:reject");
    try {
      await IpcClient.getInstance().rejectProposal({
        chatId,
        messageId,
      });
    } catch (err) {
      console.error("Error rejecting proposal:", err);
      setError((err as Error)?.message || "An error occurred while rejecting");
    } finally {
      setIsRejecting(false);

      // Keep same as handleApprove
      refreshProposal();
      fetchChatMessages();
    }
  };

  if (!settings) {
    return null; // Or loading state
  }

  return (
    <>
      {error && showError && (
        <ChatErrorBox
          onDismiss={dismissError}
          error={error}
          isAliFullStackProEnabled={settings.enableAliFullStackPro ?? false}
        />
      )}
      {/* Display loading or error state for proposal */}
      {isProposalLoading && (
        <div className="p-4 text-sm text-muted-foreground">
          Loading proposal...
        </div>
      )}
      {proposalError && (
        <div className="p-4 text-sm text-red-600">
          Error loading proposal: {proposalError}
        </div>
      )}
      <div className="p-4" data-testid="backend-chat-input-container">
        <div
          className={`relative flex flex-col border border-blue-200 dark:border-blue-800 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 shadow-sm ${
            isDraggingOver ? "ring-2 ring-blue-500 border-blue-500" : ""
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Backend Mode Indicator */}
          <div className="flex items-center justify-center px-3 py-2 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
            <Server size={16} className="mr-2" />
            <span className="text-sm font-medium">Backend Development Mode Active</span>
          </div>

          {/* Only render ChatInputActions if proposal is loaded */}
          {proposal &&
            proposalResult?.chatId === chatId &&
            settings.selectedChatMode !== "ask" && (
              <BackendChatInputActions
                proposal={proposal}
                onApprove={handleApprove}
                onReject={handleReject}
                isApprovable={
                  !isProposalLoading &&
                  !!proposal &&
                  !!messageId &&
                  !isApproving &&
                  !isRejecting &&
                  !isStreaming
                }
                isApproving={isApproving}
                isRejecting={isRejecting}
              />
            )}

          <SelectedComponentDisplay />

          {/* Use the AttachmentsList component */}
          <AttachmentsList
            attachments={attachments}
            onRemove={removeAttachment}
          />

          {/* Use the DragDropOverlay component */}
          <DragDropOverlay isDraggingOver={isDraggingOver} />

          <div className="flex items-start space-x-2 ">
            <div className="flex-1 relative">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                onPaste={handlePaste}
                placeholder="Ask about backend architecture, APIs, databases, or server development..."
                className="w-full p-3 pr-12 border-0 bg-transparent resize-none focus:ring-0 focus:outline-none text-sm placeholder:text-muted-foreground min-h-[60px] max-h-[200px]"
                rows={3}
                disabled={isStreaming}
              />
            </div>

            {isStreaming ? (
              <button
                onClick={handleCancel}
                className="px-2 py-2 mt-1 mr-1 hover:bg-red-100 dark:hover:bg-red-900 text-red-600 rounded-lg"
                title="Cancel generation"
              >
                <StopCircleIcon size={20} />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!inputValue.trim() && attachments.length === 0}
                className="px-2 py-2 mt-1 mr-1 hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-600 rounded-lg disabled:opacity-50"
                title="Send message"
              >
                <SendHorizontalIcon size={20} />
              </button>
            )}
          </div>
          <div className="pl-2 pr-1 flex items-center justify-between pb-2">
            <div className="flex items-center">
              <ChatInputControls showContextFilesPicker={true} appId={appId ?? undefined} />
              {/* File attachment dropdown */}
              <FileAttachmentDropdown
                onFileSelect={handleFileSelect}
                disabled={isStreaming}
              />
            </div>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => setShowTokenBar(!showTokenBar)}
                    variant="ghost"
                    className={`has-[>svg]:px-2 ${
                      showTokenBar ? "text-blue-500 bg-blue-100" : ""
                    }`}
                    size="sm"
                  >
                    <ChartColumnIncreasing size={14} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {showTokenBar ? "Hide token usage" : "Show token usage"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          {/* TokenBar is only displayed when showTokenBar is true */}
          {showTokenBar && <TokenBar chatId={chatId} />}
        </div>
      </div>
    </>
  );
}

// Backend-specific ChatInputActions component
interface BackendChatInputActionsProps {
  proposal: Proposal;
  onApprove: () => void;
  onReject: () => void;
  isApprovable: boolean;
  isApproving: boolean;
  isRejecting: boolean;
}

function BackendChatInputActions({
  proposal,
  onApprove,
  onReject,
  isApprovable,
  isApproving,
  isRejecting,
}: BackendChatInputActionsProps) {
  const [isDetailsVisible, setIsDetailsVisible] = useState(false);

  if (proposal.type === "tip-proposal") {
    return <div>Backend tip proposal</div>;
  }
  if (proposal.type === "action-proposal") {
    return <BackendActionProposalActions proposal={proposal}></BackendActionProposalActions>;
  }

  // Split files into server functions and other files - only for CodeProposal
  const serverFunctions =
    proposal.filesChanged?.filter((f: FileChange) => f.isServerFunction) ?? [];
  const otherFilesChanged =
    proposal.filesChanged?.filter((f: FileChange) => !f.isServerFunction) ?? [];

  function formatTitle({
    title,
    isDetailsVisible,
  }: {
    title: string;
    isDetailsVisible: boolean;
  }) {
    if (isDetailsVisible) {
      return title;
    }
    return title.slice(0, 60) + "...";
  }

  return (
    <div className="border-b border-blue-200 dark:border-blue-800">
      <div className="p-2">
        {/* Row 1: Title, Expand Icon, and Security Chip */}
        <div className="flex items-center gap-2 mb-1">
          <button
            className="flex flex-col text-left text-sm hover:bg-blue-50 dark:hover:bg-blue-900/50 p-1 rounded justify-start w-full"
            onClick={() => setIsDetailsVisible(!isDetailsVisible)}
          >
            <div className="flex items-center">
              {isDetailsVisible ? (
                <ChevronUp size={16} className="mr-1 flex-shrink-0" />
              ) : (
                <ChevronDown size={16} className="mr-1 flex-shrink-0" />
              )}
              <span className="font-medium text-blue-800 dark:text-blue-200">
                {formatTitle({ title: proposal.title, isDetailsVisible })}
              </span>
            </div>
            <div className="text-xs text-blue-600 dark:text-blue-400 ml-6">
              <BackendProposalSummary
                sqlQueries={proposal.sqlQueries}
                serverFunctions={serverFunctions}
                packagesAdded={proposal.packagesAdded}
                filesChanged={otherFilesChanged}
              />
            </div>
          </button>
          {proposal.securityRisks.length > 0 && (
            <span className="bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0">
              Security risks found
            </span>
          )}
        </div>

        {/* Row 2: Buttons and Toggle */}
        <div className="flex items-center justify-start space-x-2">
          <Button
            className="px-8 bg-blue-600 hover:bg-blue-700"
            size="sm"
            onClick={onApprove}
            disabled={!isApprovable || isApproving || isRejecting}
            data-testid="backend-approve-proposal-button"
          >
            {isApproving ? (
              <Loader2 size={16} className="mr-1 animate-spin" />
            ) : (
              <Check size={16} className="mr-1" />
            )}
            Approve
          </Button>
          <Button
            className="px-8"
            size="sm"
            variant="outline"
            onClick={onReject}
            disabled={!isApprovable || isApproving || isRejecting}
            data-testid="backend-reject-proposal-button"
          >
            {isRejecting ? (
              <Loader2 size={16} className="mr-1 animate-spin" />
            ) : (
              <X size={16} className="mr-1" />
            )}
            Reject
          </Button>
          <div className="flex items-center space-x-1 ml-auto">
            <AutoApproveSwitch />
          </div>
        </div>
      </div>

      <div className="overflow-y-auto max-h-[calc(100vh-300px)]">
        {isDetailsVisible && (
          <div className="p-3 border-t border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 text-sm">
            {!!proposal.securityRisks.length && (
              <div className="mb-3">
                <h4 className="font-semibold mb-1 text-blue-800 dark:text-blue-200">Security Risks</h4>
                <ul className="space-y-1">
                  {proposal.securityRisks.map((risk, index) => (
                    <li key={index} className="flex items-start space-x-2">
                      {risk.type === "warning" ? (
                        <AlertTriangle
                          size={16}
                          className="text-yellow-500 mt-0.5 flex-shrink-0"
                        />
                      ) : (
                        <AlertOctagon
                          size={16}
                          className="text-red-500 mt-0.5 flex-shrink-0"
                        />
                      )}
                      <div>
                        <span className="font-medium">{risk.title}:</span>{" "}
                        <span>{risk.description}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {proposal.sqlQueries?.length > 0 && (
              <div className="mb-3">
                <h4 className="font-semibold mb-1 text-blue-800 dark:text-blue-200">SQL Queries</h4>
                <ul className="space-y-2">
                  {proposal.sqlQueries.map((query, index) => (
                    <BackendSqlQueryItem key={index} query={query} />
                  ))}
                </ul>
              </div>
            )}

            {proposal.packagesAdded?.length > 0 && (
              <div className="mb-3">
                <h4 className="font-semibold mb-1 text-blue-800 dark:text-blue-200">Backend Packages Added</h4>
                <ul className="space-y-1">
                  {proposal.packagesAdded.map((pkg, index) => (
                    <li
                      key={index}
                      className="flex items-center space-x-2"
                      onClick={() => {
                        IpcClient.getInstance().openExternalUrl(
                          `https://www.npmjs.com/package/${pkg}`,
                        );
                      }}
                    >
                      <Package
                        size={16}
                        className="text-blue-500 flex-shrink-0"
                      />
                      <span className="cursor-pointer text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium">
                        {pkg}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {serverFunctions.length > 0 && (
              <div className="mb-3">
                <h4 className="font-semibold mb-1 text-blue-800 dark:text-blue-200">Server Functions Changed</h4>
                <ul className="space-y-1">
                  {serverFunctions.map((file: FileChange, index: number) => (
                    <li key={index} className="flex items-center space-x-2">
                      {getBackendIconForFileChange(file)}
                      <span
                        title={file.path}
                        className="truncate cursor-default"
                      >
                        {file.name}
                      </span>
                      <span className="text-blue-600 dark:text-blue-400 text-xs truncate">
                        - {file.summary}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {otherFilesChanged.length > 0 && (
              <div>
                <h4 className="font-semibold mb-1 text-blue-800 dark:text-blue-200">Backend Files Changed</h4>
                <ul className="space-y-1">
                  {otherFilesChanged.map((file: FileChange, index: number) => (
                    <li key={index} className="flex items-center space-x-2">
                      {getBackendIconForFileChange(file)}
                      <span
                        title={file.path}
                        className="truncate cursor-default"
                      >
                        {file.name}
                      </span>
                      <span className="text-blue-600 dark:text-blue-400 text-xs truncate">
                        - {file.summary}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BackendActionProposalActions({ proposal }: { proposal: ActionProposal }) {
  return (
    <div className="border-b border-blue-200 dark:border-blue-800 p-2 pb-0 flex items-center justify-between bg-blue-50/50 dark:bg-blue-950/20">
      <div className="flex items-center space-x-2 overflow-x-auto pb-2">
        <span className="text-sm font-medium text-blue-800 dark:text-blue-200">Backend Actions:</span>
        {proposal.actions.map((action) => mapBackendActionToButton(action))}
      </div>
    </div>
  );
}

// Backend-specific action mapping
function mapBackendActionToButton(action: SuggestedAction) {
  switch (action.id) {
    case "rebuild":
      return <BackendRebuildButton key={action.id} />;
    case "restart":
      return <BackendRestartButton key={action.id} />;
    case "keep-going":
      return <BackendKeepGoingButton key={action.id} />;
    default:
      console.error(`Unsupported backend action: ${action.id}`);
      return (
        <Button variant="outline" size="sm" disabled key={action.id}>
          Unsupported: {action.id}
        </Button>
      );
  }
}

function BackendRebuildButton() {
  const { restartApp } = useRunApp();
  const posthog = usePostHog();
  const selectedAppId = useAtomValue(selectedAppIdAtom);

  const onClick = useCallback(async () => {
    if (!selectedAppId) return;

    posthog.capture("backend:action:rebuild");
    await restartApp({ removeNodeModules: true });
  }, [selectedAppId, posthog, restartApp]);

  return (
    <BackendSuggestionButton onClick={onClick} tooltipText="Rebuild backend application">
      Rebuild Backend
    </BackendSuggestionButton>
  );
}

function BackendRestartButton() {
  const { restartApp } = useRunApp();
  const posthog = usePostHog();
  const selectedAppId = useAtomValue(selectedAppIdAtom);

  const onClick = useCallback(async () => {
    if (!selectedAppId) return;

    posthog.capture("backend:action:restart");
    await restartApp();
  }, [selectedAppId, posthog, restartApp]);

  return (
    <BackendSuggestionButton onClick={onClick} tooltipText="Restart backend server">
      Restart Backend
    </BackendSuggestionButton>
  );
}

function BackendKeepGoingButton() {
  const { streamMessage } = useStreamChat();
  const chatId = useAtomValue(selectedChatIdAtom);
  const onClick = () => {
    if (!chatId) {
      console.error("No chat id found");
      return;
    }
    streamMessage({
      prompt: "Keep going with the backend development",
      chatId,
      chatMode: "backend",
    });
  };
  return (
    <BackendSuggestionButton onClick={onClick} tooltipText="Continue backend development">
      Keep Going
    </BackendSuggestionButton>
  );
}

function BackendSuggestionButton({
  children,
  onClick,
  tooltipText,
}: {
  onClick: () => void;
  children: React.ReactNode;
  tooltipText: string;
}) {
  const { isStreaming } = useStreamChat();
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            disabled={isStreaming}
            className="bg-blue-100 hover:bg-blue-200 text-blue-800 border-blue-300"
            size="sm"
            onClick={onClick}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltipText}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function getBackendIconForFileChange(file: FileChange) {
  switch (file.type) {
    case "write":
      return (
        <FileText size={16} className="text-blue-500 flex-shrink-0" />
      );
    case "rename":
      return (
        <SendToBack size={16} className="text-blue-500 flex-shrink-0" />
      );
    case "delete":
      return (
        <FileX size={16} className="text-blue-500 flex-shrink-0" />
      );
  }
}

// Backend-specific Proposal summary
function BackendProposalSummary({
  sqlQueries = [],
  serverFunctions = [],
  packagesAdded = [],
  filesChanged = [],
}: {
  sqlQueries?: Array<SqlQuery>;
  serverFunctions?: FileChange[];
  packagesAdded?: string[];
  filesChanged?: FileChange[];
}) {
  // If no changes, show a simple message
  if (
    !sqlQueries.length &&
    !serverFunctions.length &&
    !packagesAdded.length &&
    !filesChanged.length
  ) {
    return <span>No backend changes</span>;
  }

  // Build parts array with only the segments that have content
  const parts: string[] = [];

  if (sqlQueries.length) {
    parts.push(
      `${sqlQueries.length} Backend SQL ${
        sqlQueries.length === 1 ? "query" : "queries"
      }`,
    );
  }

  if (serverFunctions.length) {
    parts.push(
      `${serverFunctions.length} Server ${
        serverFunctions.length === 1 ? "Function" : "Functions"
      }`,
    );
  }

  if (packagesAdded.length) {
    parts.push(
      `${packagesAdded.length} Backend ${
        packagesAdded.length === 1 ? "package" : "packages"
      }`,
    );
  }

  if (filesChanged.length) {
    parts.push(
      `${filesChanged.length} Backend ${filesChanged.length === 1 ? "file" : "files"}`,
    );
  }

  // Join all parts with separator
  return <span>{parts.join(" | ")}</span>;
}

// Backend-specific SQL Query item
function BackendSqlQueryItem({ query }: { query: SqlQuery }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const queryContent = query.content;
  const queryDescription = query.description;

  return (
    <li
      className="bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg px-3 py-2 border border-blue-200 dark:border-blue-800 cursor-pointer"
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-blue-500 flex-shrink-0" />
          <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
            {queryDescription || "Backend SQL Query"}
          </span>
        </div>
        <div>
          {isExpanded ? (
            <ChevronsDownUp size={18} className="text-blue-500" />
          ) : (
            <ChevronsUpDown size={18} className="text-blue-500" />
          )}
        </div>
      </div>
      {isExpanded && (
        <div className="mt-2 text-xs max-h-[200px] overflow-auto">
          <CodeHighlight className="language-sql">
            {queryContent}
          </CodeHighlight>
        </div>
      )}
    </li>
  );
}
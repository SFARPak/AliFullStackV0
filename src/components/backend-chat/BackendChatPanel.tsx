import { useState, useRef, useEffect, useCallback } from "react";
import { useAtom, useAtomValue } from "jotai";
import { chatMessagesAtom, chatStreamCountAtom } from "../../atoms/chatAtoms";
import { IpcClient } from "@/ipc/ipc_client";

import { BackendChatHeader } from "./BackendChatHeader";
import { BackendMessagesList } from "./BackendMessagesList";
import { BackendChatInput } from "./BackendChatInput";
import { BackendVersionPane } from "./BackendVersionPane";
import { ChatError } from "../chat/ChatError";

interface BackendChatPanelProps {
  chatId?: number;
  isPreviewOpen: boolean;
  onTogglePreview: () => void;
}

export function BackendChatPanel({
  chatId,
  isPreviewOpen,
  onTogglePreview,
}: BackendChatPanelProps) {
  const [messages, setMessages] = useAtom(chatMessagesAtom);
  const [isVersionPaneOpen, setIsVersionPaneOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamCount = useAtomValue(chatStreamCountAtom);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  // Scroll-related properties
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const userScrollTimeoutRef = useRef<number | null>(null);
  const lastScrollTopRef = useRef<number>(0);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  const handleScroll = () => {
    if (!messagesContainerRef.current) return;

    const container = messagesContainerRef.current;
    const currentScrollTop = container.scrollTop;

    if (currentScrollTop < lastScrollTopRef.current) {
      setIsUserScrolling(true);

      if (userScrollTimeoutRef.current) {
        window.clearTimeout(userScrollTimeoutRef.current);
      }

      userScrollTimeoutRef.current = window.setTimeout(() => {
        setIsUserScrolling(false);
      }, 1000);
    }

    lastScrollTopRef.current = currentScrollTop;
  };

  useEffect(() => {
    console.log("streamCount", streamCount);
    scrollToBottom();
  }, [streamCount]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.addEventListener("scroll", handleScroll, { passive: true });
    }

    return () => {
      if (container) {
        container.removeEventListener("scroll", handleScroll);
      }
      if (userScrollTimeoutRef.current) {
        window.clearTimeout(userScrollTimeoutRef.current);
      }
    };
  }, []);

  const fetchChatMessages = useCallback(async () => {
    if (!chatId) {
      setMessages([]);
      return;
    }
    const chat = await IpcClient.getInstance().getChat(chatId);
    setMessages(chat.messages);
  }, [chatId, setMessages]);

  useEffect(() => {
    fetchChatMessages();
  }, [fetchChatMessages]);

  // Auto-scroll effect when messages change
  useEffect(() => {
    if (
      !isUserScrolling &&
      messagesContainerRef.current &&
      messages.length > 0
    ) {
      const { scrollTop, clientHeight, scrollHeight } =
        messagesContainerRef.current;
      const threshold = 280;
      const isNearBottom =
        scrollHeight - (scrollTop + clientHeight) <= threshold;

      if (isNearBottom) {
        requestAnimationFrame(() => {
          scrollToBottom("instant");
        });
      }
    }
  }, [messages, isUserScrolling]);

  return (
    <div className="flex flex-col h-full">
      <BackendChatHeader
        isVersionPaneOpen={isVersionPaneOpen}
        isPreviewOpen={isPreviewOpen}
        onTogglePreview={onTogglePreview}
        onVersionClick={() => setIsVersionPaneOpen(!isVersionPaneOpen)}
      />
      <div className="flex flex-1 overflow-hidden">
        {!isVersionPaneOpen && (
          <div className="flex-1 flex flex-col min-w-0">
            <BackendMessagesList
              messages={messages}
              messagesEndRef={messagesEndRef}
              ref={messagesContainerRef}
            />
            <ChatError error={error} onDismiss={() => setError(null)} />
            <BackendChatInput chatId={chatId} />
          </div>
        )}
        <BackendVersionPane
          isVisible={isVersionPaneOpen}
          onClose={() => setIsVersionPaneOpen(false)}
        />
      </div>
    </div>
  );
}
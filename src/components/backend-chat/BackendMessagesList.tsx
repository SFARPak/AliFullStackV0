import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { Message } from "@/ipc/ipc_types";
import { BackendChatMessage } from "./BackendChatMessage";

interface BackendMessagesListProps {
  messages: Message[];
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

export const BackendMessagesList = forwardRef<
  HTMLDivElement,
  BackendMessagesListProps
>(({ messages, messagesEndRef }, ref) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => scrollRef.current!);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0"
      data-testid="messages-list"
    >
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center space-y-2">
            <div className="text-2xl">🚀</div>
            <h3 className="text-lg font-semibold">Backend Development Ready</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Start building your backend with Roo-Code logic. Ask questions about
              server architecture, API design, database schemas, or get help with
              backend development tasks.
            </p>
          </div>
        </div>
      ) : (
        <>
          {messages.map((message, index) => (
            <BackendChatMessage
              key={message.id || index}
              message={message}
            />
          ))}
          <div ref={messagesEndRef} />
        </>
      )}
    </div>
  );
});
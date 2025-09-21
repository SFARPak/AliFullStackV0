import type { Message } from "@/ipc/ipc_types";
import { atom } from "jotai";
import type { ChatSummary } from "@/lib/schemas";

// Atom to hold the chat history
export const chatMessagesAtom = atom<Message[]>([]);
export const chatErrorAtom = atom<string | null>(null);

// Atom to hold the currently selected chat ID
export const selectedChatIdAtom = atom<number | null>(null);

export const isStreamingAtom = atom<boolean>(false);
export const chatInputValueAtom = atom<string>("");
export const homeChatInputValueAtom = atom<string>("");

// Atoms for chat list management
export const chatsAtom = atom<ChatSummary[]>([]);
export const chatsLoadingAtom = atom<boolean>(false);

// Used for scrolling to the bottom of the chat messages
export const chatStreamCountAtom = atom<number>(0);

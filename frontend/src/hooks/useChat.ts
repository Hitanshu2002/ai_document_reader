// useChat hook — manages chat messages and API communication
import { useState, useCallback, useEffect, useRef } from 'react';
import type { Message } from '../types';
import { apiService } from '../services/api';

let messageCounter = 0;

function createMessage(
  role: 'user' | 'assistant',
  content: string,
  extras?: Partial<Message>
): Message {
  return {
    id: `msg-${++messageCounter}-${Date.now()}`,
    role,
    content,
    timestamp: new Date(),
    ...extras,
  };
}

const WELCOME_MESSAGE = `👋 **Namaste! / Hello!**\n\nI'm **DocMind**, your intelligent document assistant. I've processed your document and I'm ready to help!\n\n**I can help you with:**\n- 📋 Summarizing the entire document\n- ❓ Answering specific questions\n- 🧮 Solving math problems (with step-by-step working)\n- 🔬 Explaining research concepts and models\n- 📚 Translating and explaining Sanskrit shlokas\n- 🌐 Responding in **Hindi** or **English**\n- 🎤 Voice input/output in both languages\n\nAsk me anything about your document! आप हिंदी में भी पूछ सकते हैं!`;

function getStorageKey(sessionId: string | null): string | null {
  return sessionId ? `chatMessages_${sessionId}` : null;
}

function loadMessagesFromStorage(sessionId: string | null): Message[] | null {
  const key = getStorageKey(sessionId);
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown[];
    return parsed.map((m) => ({
      ...(m as Record<string, unknown>),
      timestamp: new Date((m as Record<string, unknown>).timestamp as string),
    })) as Message[];
  } catch {
    return null;
  }
}

function saveMessagesToStorage(sessionId: string | null, messages: Message[]): void {
  const key = getStorageKey(sessionId);
  if (!key) return;
  try {
    // Exclude transient loading placeholders from persistence
    const toSave = messages.filter((m) => !m.isLoading);
    sessionStorage.setItem(key, JSON.stringify(toSave));
  } catch {
    // Storage quota or serialisation errors — silently ignore
  }
}

export function useChat(sessionId: string | null) {
  // Initialise from sessionStorage if available, else start with the welcome message
  const [messages, setMessages] = useState<Message[]>(() => {
    const stored = loadMessagesFromStorage(sessionId);
    if (stored && stored.length > 0) return stored;
    return [createMessage('assistant', WELCOME_MESSAGE)];
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep a ref to sessionId so the save effect always sees the latest value
  const sessionIdRef = useRef(sessionId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Re-hydrate when sessionId changes (e.g. a new document is uploaded)
  const prevSessionIdRef = useRef<string | null>(sessionId);
  useEffect(() => {
    if (sessionId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = sessionId;
      const stored = loadMessagesFromStorage(sessionId);
      if (stored && stored.length > 0) {
        setMessages(stored);
      } else {
        setMessages([createMessage('assistant', WELCOME_MESSAGE)]);
      }
    }
  }, [sessionId]);

  // Persist messages to sessionStorage on every change
  useEffect(() => {
    saveMessagesToStorage(sessionIdRef.current, messages);
  }, [messages]);

  const sendMessage = useCallback(
    async (question: string, language?: string): Promise<Message | null> => {
      if (!sessionId || !question.trim() || isLoading) return null;

      setError(null);

      // Add user message
      const userMsg = createMessage('user', question.trim());
      setMessages((prev) => [...prev, userMsg]);

      // Add loading placeholder
      const loadingMsg = createMessage('assistant', '', { isLoading: true });
      setMessages((prev) => [...prev, loadingMsg]);
      setIsLoading(true);

      try {
        const response = await apiService.sendMessage(sessionId, question.trim(), language);

        // Replace loading placeholder with actual response
        const assistantMsg = createMessage('assistant', response.answer, {
          id: loadingMsg.id,
          sources: response.sources,
          processingTimeMs: response.processing_time_ms,
        });

        setMessages((prev) =>
          prev.map((msg) => (msg.id === loadingMsg.id ? assistantMsg : msg))
        );

        setIsLoading(false);
        return assistantMsg;
      } catch (err) {
        const errorText =
          err instanceof Error ? err.message : 'Failed to get response';

        // ── Clean, user-friendly error messages ──────────────────────────────
        const isRateLimit =
          errorText.includes('rate_limit') ||
          errorText.includes('Rate limit') ||
          errorText.includes('429');

        const waitMatch = errorText.match(
          /try again in ([\d]+m[\d.]+s|[\d.]+s|[\d]+ minute)/
        );
        const waitTime = waitMatch ? waitMatch[1] : null;

        const isSessionExpired =
          errorText.includes('404') ||
          (errorText.toLowerCase().includes('session') &&
            errorText.includes('not found'));

        let friendlyMessage: string;
        if (isRateLimit) {
          friendlyMessage = `⏱️ Rate limit reached${
            waitTime ? '. Try again in ' + waitTime : ''
          }. Please wait before asking another question.`;
        } else if (isSessionExpired) {
          friendlyMessage =
            '🔄 Session expired. Please re-upload your document to continue.';
        } else {
          friendlyMessage = '❌ Something went wrong. Please try again.';
        }
        // ────────────────────────────────────────────────────────────────────

        setError(errorText);

        const errorMsg = createMessage('assistant', friendlyMessage, {
          id: loadingMsg.id,
        });

        setMessages((prev) =>
          prev.map((msg) => (msg.id === loadingMsg.id ? errorMsg : msg))
        );

        setIsLoading(false);
        return null;
      }
    },
    [sessionId, isLoading]
  );

  const clearMessages = useCallback(() => {
    // Wipe persisted history for this session
    const key = getStorageKey(sessionIdRef.current);
    if (key) sessionStorage.removeItem(key);

    setMessages([
      createMessage(
        'assistant',
        'Document has been reset. Upload a new document to continue.'
      ),
    ]);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
    sessionId,
  };
}

export default useChat;

/* GroupChat — Real-time collaborative chat with @chatai AI support */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Bot, Users, WifiOff, Sparkles } from 'lucide-react';
import './GroupChat.css';

const getApiBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  const host = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;
  return `http://${host}:8000`;
};
const API_BASE_URL = getApiBaseUrl();
const WS_BASE_URL = API_BASE_URL.replace(/^https?/, (m: string) => (m === 'https' ? 'wss' : 'ws'));

interface GroupMessage {
  msg_id: string;
  user_id: string;
  user_name: string;
  content: string;
  is_ai: boolean;
  timestamp: number;
  optimistic?: boolean; // client-only flag for instantly-shown own messages
}

interface Member {
  user_id: string;
  name: string;
  is_host: boolean;
}

interface GroupChatProps {
  roomCode: string;
  userId: string;
  userName: string;
  sessionId: string;
  onMembersChange?: (members: Member[]) => void;
}

/** Deterministic color per username */
function userColor(name: string): string {
  const colors = ['#a855f7', '#06b6d4', '#f43f5e', '#22c55e', '#f59e0b', '#3b82f6', '#ec4899'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const GroupChat: React.FC<GroupChatProps> = ({
  roomCode, userId, userName, sessionId: _sessionId, onMembersChange,
}) => {
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [inputText, setInputText] = useState('');
  const [connected, setConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [aiThinking, setAiThinking] = useState(false);
  const [roomExpired, setRoomExpired] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const msgsRef = useRef<HTMLDivElement>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optimisticCounter = useRef(0);

  /** Scroll to bottom inside the messages container (NOT the page) */
  const scrollToBottom = useCallback(() => {
    if (msgsRef.current) {
      msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, typingUsers, aiThinking, scrollToBottom]);

  const updateMembers = useCallback((newMembers: Member[]) => {
    setMembers(newMembers);
    onMembersChange?.(newMembers);
  }, [onMembersChange]);

  const updateMembersRef = useRef(updateMembers);
  useEffect(() => {
    updateMembersRef.current = updateMembers;
  }, [updateMembers]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const wsUrl = `${WS_BASE_URL}/ws/${roomCode}/${userId}?name=${encodeURIComponent(userName)}`;
    console.log('[GroupChat] Connecting to:', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[GroupChat] Connected');
      if (wsRef.current === ws) {
        setConnected(true);
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      }
    };

    ws.onclose = (e) => {
      console.log('[GroupChat] Disconnected:', e.code, e.reason);
      if (wsRef.current === ws) {
        setConnected(false);
        wsRef.current = null;
        if (e.code === 4004) {
          setRoomExpired(true);
        } else if (e.code !== 1000) {
          // Auto-reconnect after 3 seconds (unless closed intentionally or room is 404)
          reconnectTimer.current = setTimeout(connect, 3000);
        }
      }
    };

    ws.onerror = (e) => {
      console.error('[GroupChat] WebSocket error:', e);
      ws.close();
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      try {
        const data = JSON.parse(event.data as string);
        console.log('[GroupChat] Received:', data.type, data);

        if (data.type === 'history') {
          setMessages(data.messages || []);
          updateMembersRef.current(data.members || []);

        } else if (data.type === 'message') {
          const incoming: GroupMessage = data.message;
          setMessages((prev) => {
            // If this is the server echo of our own optimistic message, replace it
            const optimisticIdx = prev.findIndex(
              (m) => m.optimistic && m.user_id === incoming.user_id && m.content === incoming.content
            );
            if (optimisticIdx !== -1) {
              const next = [...prev];
              next[optimisticIdx] = incoming; // replace optimistic with real
              return next;
            }
            // Deduplicate by msg_id
            if (prev.some((m) => m.msg_id === incoming.msg_id)) return prev;
            return [...prev, incoming];
          });
          // Clear AI thinking indicator when AI message arrives
          if (incoming.is_ai) setAiThinking(false);
          // Remove typing indicator for this user
          setTypingUsers((prev) => prev.filter((u) => u !== incoming.user_name));

        } else if (data.type === 'member_joined') {
          updateMembersRef.current(data.members || []);
        } else if (data.type === 'member_left') {
          updateMembersRef.current(data.members || []);
          setTypingUsers((prev) => prev.filter((u) => u !== data.user_name));
        } else if (data.type === 'typing') {
          if (data.user_id !== userId) {
            setTypingUsers((prev) => {
              if (prev.includes(data.user_name)) return prev;
              return [...prev, data.user_name];
            });
            setTimeout(() => {
              setTypingUsers((prev) => prev.filter((u) => u !== data.user_name));
            }, 3000);
          }
        }
      } catch (err) {
        console.error('[GroupChat] Parse error:', err, event.data);
      }
    };
  }, [roomCode, userId, userName]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close(1000, 'component unmounted');
    };
  }, [connect]);

  const sendTyping = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'typing', user_id: userId, user_name: userName }));
    }
  }, [userId, userName]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(sendTyping, 300);
  };

  const sendMessage = useCallback(() => {
    const text = inputText.trim();
    // Guard: need actual OPEN socket, not just the connected flag
    if (!text || wsRef.current?.readyState !== WebSocket.OPEN) {
      return;
    }

    const isAiQuery = text.toLowerCase().startsWith('@chatai');
    if (isAiQuery) setAiThinking(true);

    // Clear input immediately (before send) so UI feels instant
    setInputText('');

    // Optimistic update: show own message right away
    const tempId = `optimistic-${++optimisticCounter.current}`;
    const optimisticMsg: GroupMessage = {
      msg_id: tempId,
      user_id: userId,
      user_name: userName,
      content: text,
      is_ai: false,
      timestamp: Date.now() / 1000,
      optimistic: true,
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      wsRef.current!.send(JSON.stringify({ type: 'chat', content: text, language: 'en' }));
    } catch (err) {
      console.error('[GroupChat] Send failed:', err);
      // Remove the optimistic message if send failed
      setMessages((prev) => prev.filter((m) => m.msg_id !== tempId));
      if (isAiQuery) setAiThinking(false);
    }
  }, [inputText, userId, userName]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const isOwn = (msg: GroupMessage) => msg.user_id === userId;

  if (roomExpired) {
    return (
      <div className="group-chat gc-expired-panel">
        <div className="gc-expired-content">
          <div className="gc-expired-icon">🛑</div>
          <h3>Lobby Expired</h3>
          <p>
            The collaborative room code <strong>{roomCode}</strong> is no longer active on the server.
          </p>
          <button 
            className="btn btn-primary"
            onClick={() => {
              sessionStorage.clear();
              window.location.href = '/';
            }}
          >
            Create New Lobby
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group-chat">
      {/* Header */}
      <div className="gc-header">
        <div className="gc-header__left">
          <Users size={16} color="#a78bfa" />
          <span className="gc-header__title">Group Chat</span>
          <span
            className={`gc-conn-dot ${connected ? 'connected' : 'disconnected'}`}
            title={connected ? 'Connected' : 'Reconnecting...'}
          />
        </div>
        <div className="gc-members-pill">
          {members.slice(0, 4).map((m) => (
            <div
              key={m.user_id}
              className="gc-avatar-mini"
              style={{ background: userColor(m.name) }}
              title={m.name + (m.is_host ? ' (host)' : '')}
            >
              {m.name.charAt(0).toUpperCase()}
            </div>
          ))}
          {members.length > 4 && <span className="gc-members-more">+{members.length - 4}</span>}
          <span className="gc-members-count">{members.length} online</span>
        </div>
      </div>

      {/* AI hint */}
      <div className="gc-ai-hint">
        <Sparkles size={11} />
        Type <code>@chatai your question</code> to ask AI · Regular messages go to everyone
      </div>

      {/* Messages */}
      <div className="gc-messages" ref={msgsRef}>
        {messages.length === 0 && (
          <div className="gc-empty">
            <Users size={32} opacity={0.3} />
            <p>No messages yet. Say hello! 👋</p>
            <p style={{ fontSize: '0.72rem', color: '#374151' }}>
              Use <code style={{ color: '#6d28d9' }}>@chatai</code> to ask the AI
            </p>
          </div>
        )}

        {messages.map((msg) => {
          const own = isOwn(msg);
          const ai = msg.is_ai;
          return (
            <div
              key={msg.msg_id}
              className={`gc-msg ${own ? 'gc-msg--own' : ai ? 'gc-msg--ai' : 'gc-msg--peer'} ${msg.optimistic ? 'gc-msg--optimistic' : ''}`}
            >
              {!own && (
                <div
                  className="gc-msg__avatar"
                  style={{ background: ai ? 'linear-gradient(135deg,#7c3aed,#06b6d4)' : userColor(msg.user_name) }}
                  title={msg.user_name}
                >
                  {ai ? <Bot size={14} color="white" /> : msg.user_name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="gc-msg__body">
                {!own && (
                  <span className="gc-msg__sender" style={{ color: ai ? '#a78bfa' : userColor(msg.user_name) }}>
                    {ai ? '🤖 DocMind AI' : msg.user_name}
                  </span>
                )}
                <div className="gc-msg__bubble">
                  <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</span>
                </div>
                <span className="gc-msg__time">
                  {msg.optimistic ? 'sending…' : formatTime(msg.timestamp)}
                </span>
              </div>
            </div>
          );
        })}

        {/* Typing indicators */}
        {typingUsers.length > 0 && (
          <div className="gc-typing-row">
            <div className="gc-typing-dots">
              <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
            </div>
            <span>{typingUsers.slice(0, 2).join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...</span>
          </div>
        )}

        {/* AI thinking */}
        {aiThinking && (
          <div className="gc-typing-row gc-typing-row--ai">
            <div className="gc-typing-dots">
              <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
            </div>
            <span>🤖 DocMind AI is thinking...</span>
          </div>
        )}
      </div>

      {/* Offline banner */}
      {!connected && (
        <div className="gc-offline-banner">
          <WifiOff size={14} /> Reconnecting to room...
        </div>
      )}

      {/* Input */}
      <div className="gc-input-area">
        <textarea
          className="gc-input"
          value={inputText}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={connected ? "Type a message… or @chatai your question" : "Connecting to room..."}
          rows={1}
          disabled={!connected}
        />
        <button
          className="gc-send-btn"
          onClick={sendMessage}
          disabled={!inputText.trim() || !connected}
          title="Send"
        >
          <Send size={16} />
        </button>
      </div>
      <p className="gc-hint">Enter to send · Shift+Enter for new line · <code>@chatai</code> to ask AI</p>
    </div>
  );
};

export default GroupChat;

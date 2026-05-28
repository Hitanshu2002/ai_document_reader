// ChatInterface — collaborative chat interface supporting group chat + @chatai queries
import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  Send,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Bot,
  User,
  BookOpen,
  Clock,
} from 'lucide-react';
import type { Message, ChatSource } from '../../types';
import { useVoice } from '../../hooks/useVoice';
import './ChatInterface.css';

interface ChatInterfaceProps {
  messages: Message[];
  isLoading: boolean;
  onSendMessage: (text: string, language?: string) => Promise<Message | null>;
  sessionId: string | null;
}

// Custom markdown components with syntax highlighting
const markdownComponents = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  code({ node, inline, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '');
    return !inline && match ? (
      <SyntaxHighlighter
        style={vscDarkPlus}
        language={match[1]}
        PreTag="div"
        customStyle={{
          margin: '0.75rem 0',
          borderRadius: '0.5rem',
          border: '1px solid rgba(255,255,255,0.08)',
          fontSize: '0.82rem',
        }}
        {...props}
      >
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    ) : (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

// Typing indicator component
const TypingIndicator: React.FC = () => (
  <div className="typing-indicator">
    <div className="typing-dot" />
    <div className="typing-dot" />
    <div className="typing-dot" />
  </div>
);

// Source tags component
const SourceTags: React.FC<{ sources: ChatSource[] }> = ({ sources }) => (
  <div className="chat-sources">
    {sources.map((src, i) => (
      <span key={i} className="chat-source-tag">
        <BookOpen size={10} />
        Page {src.page}
      </span>
    ))}
  </div>
);

// Individual message component (Handles User vs Peer Group Chat vs DocMind AI)
const ChatMessage: React.FC<{
  message: Message;
  onSpeak: (text: string) => void;
  isSpeaking: boolean;
  onStopSpeak: () => void;
}> = ({ message, onSpeak, isSpeaking, onStopSpeak }) => {
  const isUser = message.role === 'user';
  const isAI = message.role === 'assistant' && !message.userNickname;
  const isPeer = message.role === 'assistant' && !!message.userNickname;

  const time = message.timestamp.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={`chat-message ${isUser ? 'chat-message--user' : isAI ? 'chat-message--ai' : 'chat-message--peer'}`}>
      <div className={`chat-message__avatar ${isUser ? 'chat-avatar--user' : isAI ? 'chat-avatar--ai' : 'chat-avatar--peer'}`}>
        {isUser ? <User size={14} /> : isAI ? <Bot size={14} /> : <User size={14} />}
      </div>
      <div className="chat-message__content">
        {isPeer && message.userNickname && (
          <span className="chat-message__sender-name">{message.userNickname}</span>
        )}
        <div className="chat-message__bubble">
          {message.isLoading ? (
            <TypingIndicator />
          ) : isUser || isPeer ? (
            <span>{message.content}</span>
          ) : (
            <div className="prose">
              <ReactMarkdown
                remarkPlugins={[remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={markdownComponents}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>

        <div className="chat-message__meta">
          <span className="chat-message__time">
            <Clock size={10} style={{ display: 'inline', marginRight: 2 }} />
            {time}
          </span>

          {isAI && !message.isLoading && message.content && (
            <button
              className={`speak-btn ${isSpeaking ? 'speaking' : ''}`}
              onClick={() => isSpeaking ? onStopSpeak() : onSpeak(message.content)}
              title={isSpeaking ? 'Stop speaking' : 'Read aloud'}
            >
              {isSpeaking ? <VolumeX size={10} /> : <Volume2 size={10} />}
              {isSpeaking ? 'Stop' : 'Speak'}
            </button>
          )}

          {message.processingTimeMs && (
            <span className="chat-source-tag">
              {message.processingTimeMs.toFixed(0)}ms
            </span>
          )}
        </div>

        {isAI && message.sources && message.sources.length > 0 && (
          <SourceTags sources={message.sources} />
        )}
      </div>
    </div>
  );
};

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  messages,
  isLoading,
  onSendMessage,
  sessionId,
}) => {
  const roomCode = sessionStorage.getItem('roomCode');
  const isCollab = !!roomCode;

  const [inputText, setInputText] = useState('');
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);

  // Ref for the scrollable messages container — used to scroll only the chat box
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { voiceState, startListening, stopListening, speak, stopSpeaking, setLanguage } =
    useVoice();

  // Scroll only the chat messages container (not the whole page)
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, [inputText]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isLoading || (!sessionId && !isCollab)) return;

    setInputText('');
    const langCode = voiceState.language.startsWith('hi') ? 'hi' : 'en';
    await onSendMessage(text, langCode);
  }, [inputText, isLoading, sessionId, isCollab, onSendMessage, voiceState.language]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleVoiceInput = () => {
    if (voiceState.isListening) {
      stopListening();
      return;
    }

    startListening(
      (transcript) => {
        setInputText(transcript);
        // Auto-send after voice input
        setTimeout(async () => {
          if (transcript.trim() && (sessionId || isCollab)) {
            setInputText('');
            const langCode = voiceState.language.startsWith('hi') ? 'hi' : 'en';
            await onSendMessage(transcript.trim(), langCode);
          }
        }, 500);
      },
      () => {
        // onEnd callback
      }
    );
  };

  const handleSpeak = (text: string, msgId: string) => {
    speak(
      text,
      voiceState.language,
      () => setSpeakingMsgId(msgId),
      () => setSpeakingMsgId(null)
    );
  };

  const handleStopSpeak = () => {
    stopSpeaking();
    setSpeakingMsgId(null);
  };

  return (
    <div className="chat-interface">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header__title">
          <div className="chat-header__icon">
            <Bot size={18} color="white" />
          </div>
          <div>
            <div className="chat-header__name">
              {isCollab ? 'Lobby Group Chat' : 'DocMind AI'}
            </div>
            <div className="chat-header__status">
              {isLoading ? 'Thinking...' : isCollab ? 'Online Lobby' : 'Ready'}
            </div>
          </div>
        </div>

        <div className="chat-header__actions">
          {/* Language Toggle */}
          <div className="lang-toggle" title="Switch response language">
            <button
              className={`lang-toggle__btn ${voiceState.language === 'en-US' ? 'active' : ''}`}
              onClick={() => setLanguage('en-US')}
            >
              EN
            </button>
            <button
              className={`lang-toggle__btn ${voiceState.language === 'hi-IN' ? 'active' : ''}`}
              onClick={() => setLanguage('hi-IN')}
            >
              हि
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable Messages container (scroll context locked to this div) */}
      <div ref={messagesContainerRef} className="chat-messages">
        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            message={msg}
            onSpeak={(text) => handleSpeak(text, msg.id)}
            isSpeaking={speakingMsgId === msg.id && voiceState.isSpeaking}
            onStopSpeak={handleStopSpeak}
          />
        ))}
      </div>

      {/* Input Area */}
      <div className="chat-input-area">
        {/* AI thinking banner — shown above input while loading */}
        {isLoading && (
          <div className="ai-thinking-banner">
            <div className="typing-indicator">
              <div className="typing-dot" />
              <div className="typing-dot" />
              <div className="typing-dot" />
            </div>
            <span>DocMind AI is thinking...</span>
          </div>
        )}

        <div className="chat-input-container">
          <textarea
            ref={textareaRef}
            className="chat-input"
            value={voiceState.isListening ? voiceState.transcript || inputText : inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isCollab
                ? 'Type message... (Prefix "@chatai" to ask AI)'
                : voiceState.language === 'hi-IN'
                ? 'अपना प्रश्न यहाँ लिखें... (Enter से भेजें)'
                : 'Ask anything about your document... (Enter to send)'
            }
            disabled={isLoading || voiceState.isListening}
            rows={1}
          />

          <div className="chat-input-actions">
            {voiceState.isSupported && (
              <button
                className={`mic-btn ${voiceState.isListening ? 'listening' : ''}`}
                onClick={handleVoiceInput}
                title={voiceState.isListening ? 'Stop listening' : `Voice input (${voiceState.language})`}
              >
                {voiceState.isListening ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
            )}

            <button
              className="send-btn"
              onClick={handleSend}
              disabled={!inputText.trim() || isLoading || (!sessionId && !isCollab) || voiceState.isListening}
              title="Send message"
            >
              {isLoading ? <div className="spinner" style={{ width: 16, height: 16 }} /> : <Send size={16} />}
            </button>
          </div>
        </div>

        {voiceState.isListening && (
          <div className="voice-transcript">
            <div className="voice-transcript-dot" />
            {voiceState.transcript
              ? `Heard: "${voiceState.transcript}"`
              : `Listening in ${voiceState.language === 'hi-IN' ? 'Hindi' : 'English'}...`}
          </div>
        )}

        <p className="chat-hint">
          {isCollab
            ? 'Chat with friends • Type "@chatai <question>" to get verified AI answers'
            : voiceState.language === 'hi-IN'
            ? 'हिंदी में भी पूछ सकते हैं • Shift+Enter for new line'
            : 'Ask in Hindi or English • Supports LaTeX math • Shift+Enter for new line'}
        </p>
      </div>
    </div>
  );
};

export default ChatInterface;

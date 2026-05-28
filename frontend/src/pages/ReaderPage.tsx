// ReaderPage — split layout with document preview and collaborative chat
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  MessageSquare,
  X,
  Brain,
  FileText,
  Hash,
} from 'lucide-react';
import type { UploadResponse } from '../types';
import { DocumentViewer } from '../components/DocumentViewer/DocumentViewer';
import { ChatInterface } from '../components/ChatInterface/ChatInterface';
import { GroupChat } from '../components/GroupChat/GroupChat';
import { useChat } from '../hooks/useChat';
import { apiService } from '../services/api';
import './ReaderPage.css';


interface ReaderPageProps {
  file: File | null;
  uploadResponse: UploadResponse | null;
  onReset: () => void;
}

export const ReaderPage: React.FC<ReaderPageProps> = ({
  file,
  uploadResponse,
  onReset,
}) => {
  // Lock body scrolling when the reader is active to prevent nested scrolling behavior
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    const originalHeight = document.body.style.height;
    document.body.style.overflow = 'hidden';
    document.body.style.height = '100%';
    
    const html = document.documentElement;
    const originalHtmlOverflow = html.style.overflow;
    const originalHtmlHeight = html.style.height;
    html.style.overflow = 'hidden';
    html.style.height = '100%';

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.height = originalHeight;
      html.style.overflow = originalHtmlOverflow;
      html.style.height = originalHtmlHeight;
    };
  }, []);

  const roomCode = sessionStorage.getItem('roomCode');
  const userName = sessionStorage.getItem('userName');
  const isHost = sessionStorage.getItem('isHost') === 'true';
  const isCollab = !!roomCode;

  const [isChatOpen, setIsChatOpen] = useState(isCollab);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  const { messages, isLoading, sendMessage, clearMessages } = useChat(
    uploadResponse?.session_id || null
  );
  // Live member list — updated via GroupChat's WebSocket onMembersChange callback
  const [liveMembers, setLiveMembers] = useState<{ user_id: string; name: string; is_host: boolean }[]>([]);
  const handleMembersChange = useCallback(
    (m: { user_id: string; name: string; is_host: boolean }[]) => setLiveMembers(m),
    []
  );
  // Stub for solo mode (no collab)
  const members = isCollab ? liveMembers : [];

  // Redirect if no file (e.g. direct URL access)
  if (!file || !uploadResponse) {
    navigate('/');
    return null;
  }

  const fileType = uploadResponse.file_type;

  const handleReset = async () => {
    // Delete session on backend asynchronously (best-effort, non-blocking)
    if (uploadResponse.session_id && (!isCollab || isHost)) {
      apiService.deleteSession(uploadResponse.session_id).catch(() => {});
    }
    clearMessages();
    setIsChatOpen(false);
    onReset();
    navigate('/');
  };

  const handleCopyCode = () => {
    if (roomCode) {
      navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const toggleChat = () => setIsChatOpen((prev) => !prev);

  const formatWordCount = (count: number): string => {
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k words`;
    return `${count} words`;
  };

  return (
    <div className="reader-page">
      {/* Navigation Bar */}
      <nav className="reader-navbar" role="navigation" aria-label="Reader controls">
        <a className="reader-navbar__brand" href="/" onClick={(e) => { e.preventDefault(); handleReset(); }}>
          <div className="reader-navbar__logo">
            <Brain size={18} color="white" />
          </div>
          <span className="reader-navbar__name">DocMind</span>
        </a>

        {/* Collab Badges Block */}
        {isCollab ? (
          <div className="reader-navbar__collab-stats">
            <span className="doc-stat-badge doc-stat-badge--name" title="Your nickname in this lobby">
              👤 {userName} {isHost ? '(Host)' : '(Guest)'}
            </span>
            <button
              onClick={handleCopyCode}
              className={`doc-stat-badge doc-stat-badge--code ${copied ? 'copied' : ''}`}
              title="Click to copy 6-digit room code to invite friends"
            >
              🔑 Room: <span className="highlight-code">{roomCode}</span> {copied ? '(Copied!)' : '(Copy invite)'}
            </button>
            <span
              className="doc-stat-badge doc-stat-badge--members"
              title={`Online members:\n${members.map((m: { name: string; is_host: boolean }) => `• ${m.name}${m.is_host ? ' (Host)' : ''}`).join('\n')}`}
              style={{ cursor: 'help' }}
            >
              👥 {members.length} {members.length === 1 ? 'reader' : 'readers'} online
            </span>
          </div>
        ) : (
          <div className="reader-navbar__doc-stats">
            <span className="doc-stat-badge">
              <Hash size={10} style={{ display: 'inline', marginRight: 2 }} />
              {uploadResponse.page_count} {uploadResponse.page_count === 1 ? 'page' : 'pages'}
            </span>
            <span className="doc-stat-badge">
              {formatWordCount(uploadResponse.word_count)}
            </span>
            {uploadResponse.metadata?.title && (
              <span className="doc-stat-badge" style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {uploadResponse.metadata.title}
              </span>
            )}
          </div>
        )}

        <div className="reader-navbar__doc-info">
          <FileText size={14} color="var(--color-text-muted)" />
          <span className="reader-navbar__doc-name">{uploadResponse.filename}</span>
        </div>

        <div className="reader-navbar__actions">
          <button
            id="reset-btn"
            className="btn btn-secondary"
            onClick={handleReset}
            title="Upload a new document or leave room"
          >
            <ArrowLeft size={15} />
            {isCollab ? 'Leave Room' : 'Reset'}
          </button>

          <button
            id="ask-btn"
            className={`btn ${isChatOpen ? 'btn-danger' : 'btn-primary'}`}
            onClick={toggleChat}
            title={isChatOpen ? 'Close chat' : 'Open chat interface'}
          >
            {isChatOpen ? (
              <>
                <X size={15} />
                Close Chat
              </>
            ) : (
              <>
                <MessageSquare size={15} />
                Open Chat
              </>
            )}
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="reader-content">
        <div className={`reader-layout ${isChatOpen ? 'chat-open' : ''}`}>
          {/* Document Viewer Panel */}
          <div className="reader-doc-panel">
            <DocumentViewer file={file} fileType={fileType} />
          </div>

          {/* Chat Panel — Group chat in collab mode, solo AI chat otherwise */}
          <div className={`reader-chat-panel ${isChatOpen ? 'open' : ''}`}>
            {isChatOpen && isCollab ? (
              <GroupChat
                roomCode={roomCode!}
                userId={sessionStorage.getItem('userId') || `user-${Math.random().toString(36).slice(2, 9)}`}
                userName={userName || 'Reader'}
                sessionId={uploadResponse.session_id}
                onMembersChange={handleMembersChange}
              />
            ) : isChatOpen ? (
              <ChatInterface
                messages={messages}
                isLoading={isLoading}
                onSendMessage={sendMessage}
                sessionId={uploadResponse.session_id}
              />
            ) : null}
          </div>
        </div>
      </main>


      {/* Mobile FAB — show Ask button when chat is closed on mobile */}
      {!isChatOpen && (
        <button
          className="ask-fab"
          onClick={toggleChat}
          id="ask-fab-btn"
          aria-label="Open AI chat"
        >
          <MessageSquare size={18} />
          Open Chat
        </button>
      )}
    </div>
  );
};

export default ReaderPage;

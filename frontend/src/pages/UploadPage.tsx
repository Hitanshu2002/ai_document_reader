// UploadPage — beautiful drag-and-drop document upload and room-sharing interface
import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, FileText, FileType, AlertCircle, Sparkles, Brain, ArrowRight, User, Key } from 'lucide-react';
import { apiService } from '../services/api';
import type { UploadResponse } from '../types';
import './UploadPage.css';

interface UploadPageProps {
  onUploadSuccess: (file: File, uploadResponse: UploadResponse) => void;
}

const FEATURES = [
  {
    icon: '🧠',
    title: 'Collaborative AI Reader',
    desc: 'Invite friends to read the same document and chat with them in real-time.',
  },
  {
    icon: '💬',
    title: '@chatai Smart Agent',
    desc: 'Talk to each other normally, or query DocMind AI by typing "@chatai your-question".',
  },
  {
    icon: '🌍',
    title: 'Bilingual Hindi/English',
    desc: 'Speak or type your doubts in Hindi or English, and get matching bilingual RAG answers.',
  },
  {
    icon: '🧮',
    title: 'LaTeX Math Support',
    desc: 'Renders equations, research papers, and formulas beautifully using LaTeX.',
  },
  {
    icon: '📿',
    title: 'Sanskrit Scriptures',
    desc: 'Auto-detects shlokas to provide transliterated metaphysical commentary.',
  },
  {
    icon: '🔒',
    title: 'In-Memory Privacy',
    desc: 'All documents are processed in-memory — secure, private, and temporary.',
  },
];

const ADJECTIVES = [
  "Swift", "Bright", "Bold", "Calm", "Wise", "Epic", "Cool", "Kind",
  "Smart", "Sharp", "Quick", "Eager", "Sunny", "Happy", "Brave", "Zesty",
];
const NOUNS = [
  "Reader", "Scholar", "Thinker", "Learner", "Explorer", "Seeker",
  "Student", "Wizard", "Coder", "Dreamer", "Helper", "Finder",
];
const generateRandomName = (): string => {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 90) + 10;
  return `${adj}${noun}${num}`;
};

export const UploadPage: React.FC<UploadPageProps> = ({ onUploadSuccess }) => {
  const [userNameHost, setUserNameHost] = useState('');
  const [userNameGuest, setUserNameGuest] = useState('');
  const [roomJoinCode, setRoomJoinCode] = useState('');

  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const validateFile = (file: File): string | null => {
    const validTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ];
    const validExtensions = ['.pdf', '.docx', '.doc'];
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();

    if (!validTypes.includes(file.type) && !validExtensions.includes(ext)) {
      return 'Please upload a PDF (.pdf) or Word document (.docx, .doc) file.';
    }

    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      return `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max allowed is 50MB.`;
    }

    return null;
  };

  // Host uploads a file to create a room
  const processFile = useCallback(async (file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }

    setUploadError(null);
    setIsUploading(true);
    setUploadProgress(15);
    setUploadStage('Reading document...');

    const finalHostName = userNameHost.trim() || generateRandomName();

    try {
      // Simulate progress stages
      const progressStages = [
        { progress: 30, stage: 'Extracting text content...' },
        { progress: 55, stage: 'Classifying document topics...' },
        { progress: 75, stage: 'Building vector embeddings...' },
        { progress: 90, stage: 'Initializing collaborative lobby...' },
      ];

      let stageIndex = 0;
      const progressInterval = setInterval(() => {
        if (stageIndex < progressStages.length) {
          const { progress, stage } = progressStages[stageIndex];
          setUploadProgress(progress);
          setUploadStage(stage);
          stageIndex++;
        }
      }, 1500);

      // Create cooperative room
      const response = await apiService.createRoom(file, finalHostName);
      clearInterval(progressInterval);

      setUploadProgress(100);
      setUploadStage('Ready!');

      // Short delay for visual feedback
      await new Promise((r) => setTimeout(r, 500));

      // Save user details to sessionStorage
      sessionStorage.setItem('userName', finalHostName);
      sessionStorage.setItem('roomCode', response.room_code);
      sessionStorage.setItem('isHost', 'true');
      sessionStorage.setItem('userId', response.host_id || `user-${Math.random().toString(36).substring(2, 11)}`);

      // Construct matching UploadResponse
      const uploadResp: UploadResponse = {
        session_id: response.session_id,
        filename: response.filename,
        file_type: response.file_type,
        page_count: response.page_count,
        word_count: response.word_count,
        metadata: response.metadata,
        message: 'Lobby established.',
      };

      onUploadSuccess(file, uploadResp);
      navigate('/reader');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to establish cooperative room.';
      setUploadError(message);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setUploadStage('');
    }
  }, [navigate, onUploadSuccess, userNameHost]);

  // Guest joins using a code
  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = roomJoinCode.trim().toUpperCase();
    if (!code) {
      setJoinError('Please enter a 6-digit room code.');
      return;
    }

    setJoinError(null);
    setIsJoining(true);

    const finalGuestName = userNameGuest.trim() || generateRandomName();

    try {
      // 1. Fetch room info
      const roomInfo = await apiService.getRoom(code);

      // 2. Download the document file bytes
      const fileBlob = await apiService.getRoomFile(code);
      const mimeType = roomInfo.file_type === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

      const file = new File([fileBlob], roomInfo.filename, { type: mimeType });

      // Save guest details to sessionStorage
      sessionStorage.setItem('userName', finalGuestName);
      sessionStorage.setItem('roomCode', code);
      sessionStorage.setItem('isHost', 'false');
      
      // Generate standard Guest User ID
      const guestId = `guest-${Math.random().toString(36).substring(2, 11)}`;
      sessionStorage.setItem('userId', guestId);

      // Construct standard UploadResponse
      const uploadResp: UploadResponse = {
        session_id: roomInfo.session_id,
        filename: roomInfo.filename,
        file_type: roomInfo.file_type,
        page_count: roomInfo.page_count || 1,
        word_count: roomInfo.word_count || 500,
        metadata: {},
        message: 'Lobby joined successfully.',
      };

      onUploadSuccess(file, uploadResp);
      navigate('/reader');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid code or backend server offline.';
      setJoinError(message);
    } finally {
      setIsJoining(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleZoneClick = () => {
    if (!isUploading) fileInputRef.current?.click();
  };

  return (
    <div className="upload-page">
      {/* Hero Section */}
      <div className="upload-hero">
        <div className="upload-hero__logo">
          <Brain size={40} color="white" />
        </div>
        <h1 className="upload-hero__title">
          <span className="gradient-text">DocMind Collab</span>
        </h1>
        <p className="upload-hero__subtitle">
          Read documents together, sync with friends, and ask questions to our high-accuracy domain-expert AI agent.
        </p>
      </div>

      {/* Side-by-Side Panels */}
      <div className="collab-panels-container">
        
        {/* PANEL 1: HOST LOBBY */}
        <div className="collab-panel collab-panel--host">
          <div className="panel-badge panel-badge--host">HOST A ROOM</div>
          <h2 className="collab-panel__title">Upload & Start Reading</h2>
          <p className="collab-panel__desc">Upload a PDF/DOCX to create an online room. Invite your friends to read and discuss it in real-time.</p>
          
          <div className="collab-input-group">
            <label className="collab-label">
              <User size={14} /> Nickname (Optional)
            </label>
            <input
              type="text"
              className="collab-textbox"
              placeholder="e.g. WiseScholar42 (or leave blank)"
              value={userNameHost}
              onChange={(e) => setUserNameHost(e.target.value)}
              disabled={isUploading}
            />
          </div>

          <div className="upload-zone-wrapper">
            <div
              id="upload-dropzone"
              className={`upload-zone ${isDragOver ? 'drag-over' : ''} ${isUploading ? 'uploading' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={handleZoneClick}
              role="button"
              tabIndex={0}
              aria-label="Upload document"
              onKeyDown={(e) => e.key === 'Enter' && handleZoneClick()}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden-input"
                accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={handleFileSelect}
                id="file-input"
              />

              <div className="upload-zone__icon">
                {isUploading ? (
                  <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
                ) : isDragOver ? (
                  <Sparkles size={32} color="#a855f7" />
                ) : (
                  <Upload size={32} color="#7c3aed" />
                )}
              </div>

              <div className="upload-zone__title">
                {isUploading
                  ? uploadStage || 'Processing...'
                  : isDragOver
                  ? 'Drop to upload!'
                  : 'Drop your document here'}
              </div>

              <div className="upload-zone__subtitle">
                {isUploading
                  ? 'Analyzing content with domain AI personas...'
                  : 'or click to browse your files'}
              </div>

              {!isUploading && (
                <div className="upload-zone__formats">
                  <span className="format-badge format-badge--pdf">
                    <FileType size={11} /> PDF
                  </span>
                  <span className="format-badge format-badge--docx">
                    <FileText size={11} /> DOCX
                  </span>
                  <span className="format-badge format-badge--docx" style={{ 
                    background: 'rgba(124, 58, 237, 0.12)',
                    color: '#a78bfa',
                    borderColor: 'rgba(124, 58, 237, 0.2)'
                  }}>
                    Max 50MB
                  </span>
                </div>
              )}

              {isUploading && (
                <div className="upload-progress">
                  <div className="upload-progress__bar">
                    <div
                      className="upload-progress__fill"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="upload-progress__text">{uploadProgress}% complete</p>
                </div>
              )}
            </div>

            {uploadError && (
              <div className="upload-error">
                <AlertCircle size={18} />
                <span>{uploadError}</span>
              </div>
            )}
          </div>
        </div>

        {/* PANEL 2: JOIN LOBBY */}
        <div className="collab-panel collab-panel--join">
          <div className="panel-badge panel-badge--join">JOIN A FRIEND</div>
          <h2 className="collab-panel__title">Join Collaborative Room</h2>
          <p className="collab-panel__desc">Enter the room code shared by your friend to join the session, load their document, and start chatting.</p>

          <form onSubmit={handleJoinRoom} className="collab-form">
            <div className="collab-input-group">
              <label className="collab-label">
                <User size={14} /> Nickname (Optional)
              </label>
              <input
                type="text"
                className="collab-textbox"
                placeholder="e.g. SwiftThinker99 (or leave blank)"
                value={userNameGuest}
                onChange={(e) => setUserNameGuest(e.target.value)}
                disabled={isJoining}
              />
            </div>

            <div className="collab-input-group">
              <label className="collab-label">
                <Key size={14} /> Room Code
              </label>
              <input
                type="text"
                className="collab-textbox collab-textbox--code"
                placeholder="Enter 6-character code"
                value={roomJoinCode}
                onChange={(e) => setRoomJoinCode(e.target.value.toUpperCase())}
                maxLength={6}
                disabled={isJoining}
                required
              />
            </div>

            <button
              type="submit"
              className="collab-join-btn"
              disabled={isJoining || !roomJoinCode.trim()}
            >
              {isJoining ? (
                <>
                  <div className="spinner" style={{ width: 16, height: 16, marginRight: 8, borderWidth: 2 }} />
                  Joining Lobby...
                </>
              ) : (
                <>
                  Join Room <ArrowRight size={16} style={{ marginLeft: 8 }} />
                </>
              )}
            </button>
          </form>

          {joinError && (
            <div className="upload-error" style={{ marginTop: '24px' }}>
              <AlertCircle size={18} />
              <span>{joinError}</span>
            </div>
          )}
        </div>

      </div>

      {/* Features Grid */}
      <div className="features-grid">
        {FEATURES.map((feature, i) => (
          <div key={i} className="feature-card">
            <div className="feature-card__icon">{feature.icon}</div>
            <div className="feature-card__title">{feature.title}</div>
            <div className="feature-card__desc">{feature.desc}</div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="upload-footer">
        <p>
          🔒 All connections are encrypted. Real-time synchronizations operate in-memory on WebSockets.
          &nbsp;•&nbsp; Powered by{' '}
          <span style={{ color: 'var(--color-purple-light)' }}>Groq LLaMA 3.3 70B</span>
          {' '}+{' '}
          <span style={{ color: 'var(--color-cyan-accent)' }}>FastAPI WebSockets</span>
        </p>
      </div>
    </div>
  );
};

export default UploadPage;

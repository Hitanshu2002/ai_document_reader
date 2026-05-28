// Global TypeScript types for AI Document Reader

export interface DocumentMetadata {
  title?: string;
  author?: string;
  subject?: string;
  creator?: string;
  created?: string;
}

export interface UploadResponse {
  session_id: string;
  filename: string;
  file_type: 'pdf' | 'docx';
  page_count: number;
  word_count: number;
  metadata: DocumentMetadata;
  message: string;
}

export interface ChatSource {
  chunk_index: number;
  page: number | string;
  excerpt: string;
}

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
  session_id: string;
  processing_time_ms: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  sources?: ChatSource[];
  isLoading?: boolean;
  language?: 'en' | 'hi' | 'auto';
  processingTimeMs?: number;
  userNickname?: string;
  peerId?: string;
}

export interface DocumentState {
  file: File | null;
  fileUrl: string | null;
  sessionId: string | null;
  uploadResponse: UploadResponse | null;
  isUploading: boolean;
  uploadError: string | null;
}

export type VoiceLanguage = 'en-US' | 'hi-IN';

export interface VoiceState {
  isListening: boolean;
  isSpeaking: boolean;
  transcript: string;
  language: VoiceLanguage;
  isSupported: boolean;
}

export type AppPage = 'upload' | 'reader';

export interface AppState {
  currentPage: AppPage;
  document: DocumentState;
  isChatOpen: boolean;
}

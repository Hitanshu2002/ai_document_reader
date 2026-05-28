// API service — communicates with the FastAPI backend
import axios from 'axios';
import type { UploadResponse, ChatResponse } from '../types';

const getApiBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  const host = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;
  return `http://${host}:8000`;
};
const API_BASE_URL = getApiBaseUrl();

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120000, // 2 minutes for chat/general requests
});

// Separate axios instance for document upload (OCR can take several minutes on large scanned PDFs)
const uploadApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 600000, // 10 minutes for uploads with OCR
});

// Response interceptor for error handling (shared helper)
const errorInterceptor = (error: any) => {
  const message =
    error.response?.data?.detail ||
    error.message ||
    'An unexpected error occurred';
  return Promise.reject(new Error(message));
};

api.interceptors.response.use((r) => r, errorInterceptor);
uploadApi.interceptors.response.use((r) => r, errorInterceptor);


export const apiService = {
  /**
   * Upload a PDF or DOCX document
   */
  async uploadDocument(file: File): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await uploadApi.post<UploadResponse>('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  /**
   * Create a collaborative room by uploading a document
   */
  async createRoom(file: File, hostName?: string, hostId?: string): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);

    const params = new URLSearchParams();
    if (hostName) params.append('host_name', hostName);
    if (hostId) params.append('host_id', hostId);

    const response = await uploadApi.post(`/room/create?${params.toString()}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  /**
   * Get room metadata by room code
   */
  async getRoom(code: string): Promise<any> {
    const response = await api.get(`/room/${code}`);
    return response.data;
  },

  /**
   * Get room's uploaded document as a Blob
   */
  async getRoomFile(code: string): Promise<Blob> {
    const response = await api.get(`/room/${code}/file`, {
      responseType: 'blob',
    });
    return response.data;
  },

  /**
   * Send a chat message and get AI response
   */
  async sendMessage(sessionId: string, question: string, language?: string): Promise<ChatResponse> {
    const response = await api.post<ChatResponse>('/chat', {
      session_id: sessionId,
      question,
      language,
    });
    return response.data;
  },

  /**
   * Delete session when user resets
   */
  async deleteSession(sessionId: string): Promise<void> {
    await api.delete(`/session/${sessionId}`);
  },

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await api.get('/health');
      return true;
    } catch {
      return false;
    }
  },
};

export default apiService;

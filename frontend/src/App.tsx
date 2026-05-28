// App.tsx — Root application with routing, state persistence, and restore logic
import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { UploadResponse } from './types';
import { UploadPage } from './pages/UploadPage';
import { ReaderPage } from './pages/ReaderPage';
import { fileStorage } from './services/storage';

function App() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadResponse, setUploadResponse] = useState<UploadResponse | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  // Restore session state on page refresh
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const cachedResponseStr = sessionStorage.getItem('uploadResponse');
        if (cachedResponseStr) {
          const response = JSON.parse(cachedResponseStr) as UploadResponse;
          const file = await fileStorage.getFile();
          
          if (file) {
            setUploadedFile(file);
            setUploadResponse(response);
          } else {
            // State is mismatched, do a clean reset
            sessionStorage.clear();
            await fileStorage.clear();
          }
        } else {
          // sessionStorage is empty, indicating a fresh tab/window load.
          // Clear any leftover IndexedDB files to reclaim disk space.
          await fileStorage.clear();
        }
      } catch (e) {
        console.error('Failed to restore session:', e);
      } finally {
        setIsRestoring(false);
      }
    };

    restoreSession();
  }, []);

  const handleUploadSuccess = async (file: File, response: UploadResponse) => {
    try {
      sessionStorage.setItem('uploadResponse', JSON.stringify(response));
      await fileStorage.saveFile(file);
    } catch (e) {
      console.error('Failed to save file to persistent storage:', e);
    }
    setUploadedFile(file);
    setUploadResponse(response);
  };

  const handleReset = async () => {
    sessionStorage.clear();
    try {
      await fileStorage.clear();
    } catch (e) {
      console.error('Failed to clear persistent storage:', e);
    }
    setUploadedFile(null);
    setUploadResponse(null);
  };

  if (isRestoring) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: '#0a0e1a',
        color: '#f8fafc',
        fontFamily: 'Inter, sans-serif'
      }}>
        <div style={{
          width: 36,
          height: 36,
          border: '3px solid rgba(124, 58, 237, 0.15)',
          borderTopColor: '#7c3aed',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          marginBottom: 16
        }} />
        <p style={{ opacity: 0.8, fontSize: '0.85rem', letterSpacing: '0.05em' }}>RESTORING SESSION...</p>
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={<UploadPage onUploadSuccess={handleUploadSuccess} />}
        />
        <Route
          path="/reader"
          element={
            uploadedFile && uploadResponse ? (
              <ReaderPage
                file={uploadedFile}
                uploadResponse={uploadResponse}
                onReset={handleReset}
              />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

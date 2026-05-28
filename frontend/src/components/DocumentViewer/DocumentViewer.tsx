// DocumentViewer — renders PDF and DOCX files in the browser
import React, { useState, useEffect, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  FileText,
  AlertCircle,
} from 'lucide-react';
import './DocumentViewer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure pdf.js worker using official unpkg CDN for flawless compatibility
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface DocumentViewerProps {
  file: File;
  fileType: 'pdf' | 'docx';
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({ file, fileType }) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.2);
  const [docxHtml, setDocxHtml] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  // Create object URL for PDF
  useEffect(() => {
    if (fileType === 'pdf') {
      const url = URL.createObjectURL(file);
      setFileUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [file, fileType]);

  // Convert DOCX to HTML using mammoth
  useEffect(() => {
    if (fileType !== 'docx') return;

    setIsLoading(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        const mammoth = await import('mammoth');
        const result = await mammoth.convertToHtml({ arrayBuffer });
        setDocxHtml(result.value);
        setIsLoading(false);
      } catch (err) {
        setError('Failed to render Word document.');
        setIsLoading(false);
      }
    };
    reader.onerror = () => {
      setError('Failed to read file.');
      setIsLoading(false);
    };
    reader.readAsArrayBuffer(file);
  }, [file, fileType]);

  const onDocumentLoadSuccess = useCallback(
    ({ numPages }: { numPages: number }) => {
      setNumPages(numPages);
      setIsLoading(false);
    },
    []
  );

  const onDocumentLoadError = useCallback((err: Error) => {
    console.error('PDF load error:', err);
    setError('Failed to load PDF. The file may be corrupted or password-protected.');
    setIsLoading(false);
  }, []);

  const goToPrevPage = () => setCurrentPage((p) => Math.max(1, p - 1));
  const goToNextPage = () => setCurrentPage((p) => Math.min(numPages, p + 1));
  const zoomIn = () => setScale((s) => Math.min(3.0, s + 0.2));
  const zoomOut = () => setScale((s) => Math.max(0.5, s - 0.2));

  return (
    <div className="doc-viewer">
      {/* Toolbar */}
      <div className="doc-viewer__toolbar">
        <div className="doc-viewer__filename">
          <FileText size={13} style={{ display: 'inline', marginRight: 4 }} />
          <span>{file.name}</span>
        </div>

        <div className="doc-viewer__controls">
          {fileType === 'pdf' && (
            <>
              <button
                className="doc-viewer__btn"
                onClick={goToPrevPage}
                disabled={currentPage <= 1}
                title="Previous page"
              >
                <ChevronLeft size={14} />
              </button>

              <span className="doc-viewer__page-info">
                {currentPage} / {numPages || '—'}
              </span>

              <button
                className="doc-viewer__btn"
                onClick={goToNextPage}
                disabled={currentPage >= numPages}
                title="Next page"
              >
                <ChevronRight size={14} />
              </button>

              <div style={{ width: 1, height: 20, background: 'var(--color-border)', margin: '0 4px' }} />
            </>
          )}

          <button
            className="doc-viewer__btn"
            onClick={zoomOut}
            disabled={scale <= 0.5}
            title="Zoom out"
          >
            <ZoomOut size={14} />
          </button>

          <span className="doc-viewer__zoom-badge">{Math.round(scale * 100)}%</span>

          <button
            className="doc-viewer__btn"
            onClick={zoomIn}
            disabled={scale >= 3.0}
            title="Zoom in"
          >
            <ZoomIn size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="doc-viewer__content">
        {error && (
          <div className="doc-viewer__error">
            <AlertCircle size={40} />
            <p>{error}</p>
          </div>
        )}

        {/* PDF Rendering */}
        {fileType === 'pdf' && fileUrl && !error && (
          <Document
            file={fileUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={
              <div className="doc-viewer__loading">
                <div className="spinner" />
                <p>Loading PDF...</p>
              </div>
            }
          >
            <div className="doc-viewer__pdf-page">
              <Page
                pageNumber={currentPage}
                scale={scale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
              />
            </div>
          </Document>
        )}

        {/* DOCX Rendering */}
        {fileType === 'docx' && !error && (
          <>
            {isLoading ? (
              <div className="doc-viewer__loading">
                <div className="spinner" />
                <p>Converting Word document...</p>
              </div>
            ) : (
              <div
                className="doc-viewer__docx-content"
                style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}
                dangerouslySetInnerHTML={{ __html: docxHtml }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default DocumentViewer;

import { useCallback } from 'react';

// Simplified file metadata for transfer request
interface FileRequestItem {
  name: string;
  type: string;
  size: number;
}

interface FileRequestDialogProps {
  files: FileRequestItem[];
  onAccept: () => void;
  onReject: () => void;
}

// Helper function to get an icon based on file type
const getFileIcon = (fileType: string): string => {
  if (fileType.startsWith('image/')) return '🖼️';
  if (fileType.startsWith('video/')) return '🎬';
  if (fileType.startsWith('audio/')) return '🎵';
  if (fileType.includes('pdf')) return '📄';
  if (fileType.includes('word') || fileType.includes('document')) return '📝';
  if (fileType.includes('excel') || fileType.includes('sheet')) return '📊';
  if (fileType.includes('zip') || fileType.includes('rar') || fileType.includes('tar')) return '🗜️';
  return '📁';
};

// Helper to format file sizes
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

export function FileRequestDialog({ files, onAccept, onReject }: FileRequestDialogProps) {
  const getTotalSize = useCallback(() => {
    return files.reduce((total, file) => total + file.size, 0);
  }, [files]);

  if (!files || files.length === 0) {
    return null;
  }

  return (
    <div className="file-request-dialog">
      <div className="file-request-header">
        <h3>File Transfer Request</h3>
      </div>
      
      <div className="file-request-content">
        <p className="file-request-message">
          {files.length === 1 
            ? "Someone wants to send you a file." 
            : `Someone wants to send you ${files.length} files.`}
        </p>
        
        <div className="file-list">
          {files.map((file, index) => (
            <div key={index} className="file-request-item">
              <div className="file-icon">{getFileIcon(file.type)}</div>
              <div className="file-info">
                <div className="file-name">{file.name}</div>
                <div className="file-meta">{formatFileSize(file.size)}</div>
              </div>
            </div>
          ))}
        </div>
        
        <div className="file-request-summary">
          <p>
            {files.length === 1 
              ? "1 file" 
              : `${files.length} files`} • {formatFileSize(getTotalSize())}
          </p>
        </div>
      </div>
      
      <div className="file-request-actions">
        <button 
          onClick={onReject}
          className="reject-button"
        >
          Decline
        </button>
        <button 
          onClick={onAccept}
          className="accept-button"
        >
          Accept
        </button>
      </div>
    </div>
  );
}
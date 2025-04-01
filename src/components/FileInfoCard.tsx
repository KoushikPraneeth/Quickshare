import { memo, useCallback } from 'react';

// Import the FileInfo type from FileDownload
import { FileInfo } from './FileDownload';

interface FileInfoCardProps {
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  fileInfo?: FileInfo;  // Add the fileInfo prop
  onDownload?: () => void;
  transferProgress?: number;
  status: 'transferring' | 'complete' | 'error' | 'waiting';
  errorMessage?: string;
}

// Helper to format file sizes
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

// Helper to get file type icon
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

// Memoized to prevent unnecessary re-renders
export const FileInfoCard = memo(function FileInfoCard({
  fileName,
  fileSize,
  fileType,
  fileInfo,  // Add fileInfo to destructuring
  onDownload,
  transferProgress = 0,
  status,
  errorMessage,
}: FileInfoCardProps) {
  
  // Use fileInfo properties if direct props are not provided
  const actualFileName = fileName || (fileInfo?.fileName || '');
  const actualFileSize = fileSize || (fileInfo?.fileSize || 0);
  const actualFileType = fileType || (fileInfo?.fileType || 'application/octet-stream');
  
  const getStatusText = useCallback(() => {
    switch (status) {
      case 'waiting': return 'Queued';
      case 'transferring': return `${Math.round(transferProgress * 100)}%`;
      case 'complete': return 'Completed';
      case 'error': return 'Failed';
      default: return '';
    }
  }, [status, transferProgress]);

  const getStatusColor = useCallback(() => {
    switch (status) {
      case 'waiting': return '#888';
      case 'transferring': return '#0078d7';
      case 'complete': return '#107c10';
      case 'error': return '#d83b01';
      default: return '#000';
    }
  }, [status]);

  // Truncate long filenames
  const displayName = actualFileName.length > 20 
    ? actualFileName.substring(0, 17) + '...' 
    : actualFileName;

  return (
    <div className="file-info-card" style={{ borderLeft: `4px solid ${getStatusColor()}` }}>
      <div className="file-icon">
        {getFileIcon(actualFileType)}
      </div>
      
      <div className="file-details">
        <div className="file-name" title={actualFileName}>
          {displayName}
        </div>
        
        <div className="file-meta">
          {formatFileSize(actualFileSize)} • {actualFileType.split('/')[1]?.toUpperCase() || actualFileType}
        </div>
        
        {status === 'error' && errorMessage && (
          <div className="file-error">{errorMessage}</div>
        )}
      </div>
      
      <div className="file-status">
        {status === 'transferring' && (
          <div className="progress-container">
            <div className="progress-bar" style={{ width: `${transferProgress * 100}%` }}></div>
          </div>
        )}
        
        <div className="status-text" style={{ color: getStatusColor() }}>
          {getStatusText()}
        </div>
        
        {status === 'complete' && onDownload && (
          <button onClick={onDownload} className="download-button">Save</button>
        )}
      </div>
    </div>
  );
});
import { useEffect } from 'react';
import { FileInfoCard } from './FileInfoCard';

// Export the FileInfo type
export interface FileInfo {
  fileName: string;
  fileSize: number;
  fileType: string;
  downloadUrl: string;
  id: string;
  canDownload: boolean; // Add the missing property
}

interface FileDownloadProps {
  files: FileInfo[];
  onDownload: (fileInfo: FileInfo) => void;
  onClear: () => void;
}

export function FileDownload({ files, onDownload, onClear }: FileDownloadProps) {
  useEffect(() => {
    // Cleanup function to clear completed transfers
    return () => {
      onClear();
    };
  }, [onClear]);

  return (
    <div className="file-download">
      <div className="file-download-header">
        <h3>Completed Transfers</h3>
        {files.length > 0 && (
          <button
            onClick={onClear} // Attach the onClear handler here
            className="clear-files-button"
          >
            Clear All
          </button>
        )}
      </div>

      <div className="file-download-container">
        {files.map((file) => (
          <FileInfoCard
            key={file.id}
            fileInfo={file}
            status="complete" // Add required status property
            // Only enable download if canDownload is true
            onDownload={file.canDownload ? () => onDownload(file) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
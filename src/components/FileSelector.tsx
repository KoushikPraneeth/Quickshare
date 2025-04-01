// src/components/FileSelector.tsx
import React from 'react';

interface FileSelectorProps {
  onFilesSelect: (files: File[]) => void;
  selectedFiles: File[];
  disabled?: boolean;
  multiple?: boolean;
}

export function FileSelector({ onFilesSelect, selectedFiles, disabled, multiple = true }: FileSelectorProps) {
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList) return;
    
    const filesArray: File[] = [];
    for (let i = 0; i < fileList.length; i++) {
      filesArray.push(fileList[i]);
    }
    
    onFilesSelect(filesArray);
  };

  const handleRemoveFile = (index: number) => {
    const updatedFiles = [...selectedFiles];
    updatedFiles.splice(index, 1);
    onFilesSelect(updatedFiles);
  };

  // Format file size in KB or MB
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024 * 1024) {
      return `${Math.round(bytes / 1024)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="card multiple-file-select">
      <h3>Select File{multiple ? 's' : ''}</h3>
      <input 
        type="file" 
        onChange={handleFileChange} 
        disabled={disabled}
        multiple={multiple}
      />
      
      {selectedFiles.length > 0 && (
        <div className="multiple-file-list">
          {selectedFiles.map((file, index) => (
            <div key={index} className="file-list-item">
              <div>
                {file.name} ({formatFileSize(file.size)})
              </div>
              <button onClick={() => handleRemoveFile(index)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
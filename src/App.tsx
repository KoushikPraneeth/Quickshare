import { useState, useCallback, useEffect } from 'react';
import './App.css';
import { useWebSocket } from './hooks/useWebSocket';
import { useWebRTC } from './hooks/useWebRTC';
import { useFileTransfer } from './hooks/useFileTransfer';
import { ConnectionStatus } from './components/ConnectionStatus'; // Removed unused ConnectionStatusProps
import { FileSelector } from './components/FileSelector';
import { MessageLog } from './components/MessageLog';
import { ErrorMessage } from './components/ErrorMessage';
import { LandingPage, UserRole } from './components/LandingPage';
import { ConnectionCode } from './components/ConnectionCode';
import { FileRequestDialog } from './components/FileRequestDialog';
import { FileDownload, FileInfo } from './components/FileDownload';

//const SIGNALING_SERVER_URL = 'ws://localhost:8080';
const SIGNALING_SERVER_URL = 'wss://web-production-c7d71.up.railway.app/';

// App state interface
interface AppState {
  role: UserRole;
  connectionPhase: 'landing' | 'code' | 'connected';
  connectionCode: string | null;
}

function App() {
  // Basic state
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  // App flow state
  const [appState, setAppState] = useState<AppState>({
    role: null,
    connectionPhase: 'landing',
    connectionCode: null
  });

  // File request dialog state
  const [fileRequest, setFileRequest] = useState<{
    files: { name: string; type: string; size: number }[];
    visible: boolean;
  }>({
    files: [],
    visible: false
  });

  // Hooks
  const signaling = useWebSocket(SIGNALING_SERVER_URL, appState.connectionCode || undefined);
  const webRTC = useWebRTC(signaling);
  const { 
    messages,
    sendFiles,
    cancelTransfer,
    transferProgress,
    transferStatus, 
    isBusy, 
    pendingSaveFiles, 
    acceptAndSaveFile, 
    completedTransfers,
    saveReceivedFile, 
    clearCompleted 
  } = useFileTransfer({ 
    webRTC, 
    onError: setError,
  });

  // Role selection handler
  const handleRoleSelect = useCallback((role: UserRole) => {
    setAppState(prev => ({
      ...prev,
      role,
      connectionPhase: 'code'
    }));
  }, []);

  // Connection code handler
  const handleConnectWithCode = useCallback((code: string) => {
    setAppState(prev => ({
      ...prev,
      connectionPhase: 'connected',
      connectionCode: code
    }));
    // WebSocket hook will automatically send join-room message due to useEffect
  }, []);

  // Back to landing handler (fixed)
  const handleBackToLanding = useCallback(() => {
    signaling.sendMessage({ type: 'leave-room' });
    webRTC.dataChannelRef.current?.close(); // Close data channel
    setAppState({ role: null, connectionPhase: 'landing', connectionCode: null });
    setSelectedFiles([]);
    setError(null);
    setFileRequest({ files: [], visible: false });
    if (transferStatus !== 'idle') {
        cancelTransfer(); // Use the hook's cancel function
    }
  }, [signaling, webRTC, transferStatus, cancelTransfer]);

  // Send file request handler
  const handleSendFileRequest = useCallback(() => {
    if (selectedFiles.length === 0 || !webRTC.isPeerConnected) return;
    const fileMetadata = selectedFiles.map(file => ({ name: file.name, type: file.type, size: file.size }));
    // Send request via WebRTC data channel (assuming this is the desired flow)
    webRTC.sendData(JSON.stringify({ type: 'file-request', payload: fileMetadata }));
    // Note: Actual file sending (sendFiles) is now triggered by 'file-request-accepted'
  }, [selectedFiles, webRTC]);

  // Handle file request response
  const handleAcceptFileRequest = useCallback(() => {
    setFileRequest({ files: [], visible: false });
    webRTC.sendData(JSON.stringify({ type: 'file-request-accepted' }));
  }, [webRTC]);

  const handleRejectFileRequest = useCallback(() => {
    setFileRequest({ files: [], visible: false });
    webRTC.sendData(JSON.stringify({ type: 'file-request-rejected' }));
  }, [webRTC]);

  // Effect for handling messages related to file request/response
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'file-request' && appState.role === 'receiver') {
            setFileRequest({ files: message.payload, visible: true });
          }
          
          // Trigger the actual file sending from the hook
          if (message.type === 'file-request-accepted' && appState.role === 'sender') {
            sendFiles(selectedFiles); // Call the hook's sendFiles function
          }
          
          if (message.type === 'file-request-rejected' && appState.role === 'sender') {
            setError('File transfer request was rejected by the receiver');
          }
        } catch (e) { /* Ignore parse errors */ }
      }
    };

    // Add listener to the data channel when it opens
    const originalOpenHandler = webRTC.onDataChannelOpen.current;
    webRTC.onDataChannelOpen.current = () => {
      originalOpenHandler?.();
      const currentDc = webRTC.dataChannelRef.current;
      if (currentDc) {
        currentDc.addEventListener('message', handleMessage);
        console.log("App: Added file request listener to data channel.");
      }
    };

    // Initial setup if channel is already open when effect runs
    const dc = webRTC.dataChannelRef.current;
    if (dc && dc.readyState === 'open') {
        dc.addEventListener('message', handleMessage);
        console.log("App: Added file request listener to existing data channel.");
    }

    return () => {
      const cleanupDc = webRTC.dataChannelRef.current;
      if (cleanupDc) {
        cleanupDc.removeEventListener('message', handleMessage);
        console.log("App: Removed file request listener.");
      }
    };
  }, [webRTC, selectedFiles, sendFiles, appState.role]);

  // Handler for saving fallback files from completed transfers
  const handleSaveFallbackFile = useCallback(async (fileInfo: FileInfo) => {
    const transfer = completedTransfers.find(t => t.id === fileInfo.id);
    if (!transfer || transfer.savedDirectly || !transfer.blob) {
        setError(`File "${fileInfo.fileName}" was saved directly or has no data to save.`);
        return;
    }
    await saveReceivedFile(transfer.blob, transfer.fileName, transfer.id);
  }, [completedTransfers, saveReceivedFile]);

  // --- Render Logic ---

  if (appState.connectionPhase === 'landing') {
    return <LandingPage onRoleSelect={handleRoleSelect} />;
  }

  if (appState.connectionPhase === 'code') {
    return (
      <ConnectionCode 
        role={appState.role} 
        onConnect={handleConnectWithCode} 
        onBack={handleBackToLanding} 
      />
    );
  }

  // Connected UI
  return (
    <div className="app-container">
      <div className="app-header">
        <h1>
          {appState.role === 'sender' ? 'Send Files' : 'Receive Files'}
          {appState.connectionCode && <span className="connection-code-small"> (Code: {appState.connectionCode})</span>}
        </h1>
        <button className="back-button" onClick={handleBackToLanding}>
          ← Start Over
        </button>
      </div>

      <div className="main-content">
        {/* --- Sender Column --- */}
        {appState.role === 'sender' && (
          <div className="column">
            <FileSelector 
              selectedFiles={selectedFiles} 
              onFilesSelect={setSelectedFiles} 
              disabled={isBusy}
              multiple={true}
            />
            <div className="card">
              <button 
                onClick={handleSendFileRequest}
                disabled={selectedFiles.length === 0 || !webRTC.isPeerConnected || isBusy}
              >
                Send File Request
              </button>
              {isBusy && (
                 <button 
                   onClick={cancelTransfer}
                   className="reject-button"
                 >
                   Cancel Transfer
                 </button>
              )}
            </div>
          </div>
        )}

        {/* --- Receiver Column --- */}
        {appState.role === 'receiver' && (
          <div className="column">
            {/* Section for files waiting for save confirmation */}
            {pendingSaveFiles.size > 0 && (
              <div className="card pending-saves">
                <h2>Incoming Files</h2>
                {[...pendingSaveFiles.entries()].map(([fileId, fileInfo]) => (
                  <div key={fileId} className="pending-file-item">
                    <span>{fileInfo.name} ({Math.round(fileInfo.size / 1024)} KB)</span>
                    <button 
                      onClick={() => acceptAndSaveFile(fileId)}
                      disabled={isBusy}
                    >
                      Save File
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Section for completed/downloadable files */}
            <FileDownload 
              files={completedTransfers.map((ct): FileInfo => ({
                  id: ct.id,
                  fileName: ct.fileName,
                  fileSize: ct.fileSize,
                  fileType: ct.fileType,
                  downloadUrl: ct.savedDirectly ? '' : (ct.downloadUrl || ''),
                  canDownload: !ct.savedDirectly && !!ct.blob
              }))}
              onDownload={handleSaveFallbackFile}
              onClear={clearCompleted}
            />
          </div>
        )}

        {/* --- Status & Log Column (Common) --- */}
        <div className="column">
          <ConnectionStatus
            wsConnected={signaling.isConnected}
            clientId={signaling.clientId}
            rtcConnected={webRTC.isPeerConnected}
            transferStatus={transferStatus}
            progress={transferProgress}
          />
          <div className="card">
            <MessageLog messages={messages} />
          </div>
        </div>
      </div>

      {/* File request dialog */}
      {fileRequest.visible && (
        <FileRequestDialog 
          files={fileRequest.files} 
          onAccept={handleAcceptFileRequest} 
          onReject={handleRejectFileRequest}
        />
      )}
      <ErrorMessage 
        message={error} 
        onDismiss={() => setError(null)} 
      />
    </div>
  );
}

export default App;

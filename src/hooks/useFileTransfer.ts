// src/hooks/useFileTransfer.ts
import { useState, useRef, useEffect, useCallback } from 'react';
import { useWebRTC } from './useWebRTC';

const CHUNK_SIZE = 64 * 1024; // 64 KB chunks

// --- Interfaces ---
export interface FileMetadata {
    name: string;
    size: number;
    type: string;
    id: string; // Made non-optional for consistency
}

interface UseFileTransferProps {
    webRTC: ReturnType<typeof useWebRTC>;
    onError?: (message: string | null) => void;
}

interface FileStreamInfo {
    fileId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    writer: WritableStreamDefaultWriter<Uint8Array>;
    fileHandle: FileSystemFileHandle;
    bytesWritten: number;
}

export interface CompletedTransfer {
    fileName: string;
    fileSize: number;
    fileType: string;
    downloadUrl?: string; // Optional for fallback
    blob?: Blob;         // Optional for fallback
    id: string;
    savedDirectly: boolean; // Indicate if saved via stream
}

export type TransferStatus = 'idle' | 'sending' | 'receiving';

export function useFileTransfer({ webRTC, onError }: UseFileTransferProps) {
    // --- State ---
    const [messages, setMessages] = useState<string[]>([]);
    const [transferStatus, setTransferStatus] = useState<TransferStatus>('idle');
    const [overallProgress, setOverallProgress] = useState(0);
    const [completedTransfers, setCompletedTransfers] = useState<CompletedTransfer[]>([]);
    const [pendingSaveFiles, setPendingSaveFiles] = useState<Map<string, FileMetadata>>(new Map());

    // --- Refs ---
    const receivedChunks = useRef<Map<string, ArrayBuffer[]>>(new Map()); // Buffer for early chunks / fallback
    const fileStreams = useRef<Map<string, FileStreamInfo>>(new Map());   // Active file streams
    const incomingFiles = useRef<Map<string, FileMetadata>>(new Map());   // Metadata for incoming files
    const fileReader = useRef<FileReader | null>(null);
    const cancelTransferRef = useRef(false);
    // Sender queue refs
    const fileQueue = useRef<Array<{file: File, id: string}>>([]);
    const currentFileIndex = useRef<number>(-1);
    const totalBytesToTransfer = useRef<number>(0);
    const totalBytesTransferred = useRef<number>(0);
    // Feature detection ref
    const streamsSupported = useRef<boolean>(
        typeof window !== 'undefined' && 'WritableStream' in window && 'showSaveFilePicker' in window
    );

    // --- Utility Functions ---
    const addMessage = useCallback((msg: string, type: 'info' | 'error' | 'success' | 'warning' = 'info') => {
        const prefix = {
            info: '[INFO]',
            error: '[ERROR]',
            success: '[SUCCESS]',
            warning: '[WARN]'
        }[type];
        const messageWithPrefix = `${prefix} ${msg}`;
        setMessages(prev => [...prev, messageWithPrefix]);
        // Log differently based on type
        switch(type) {
            case 'error': console.error(messageWithPrefix); break;
            case 'warning': console.warn(messageWithPrefix); break;
            default: console.log(messageWithPrefix);
        }
        // If it's an error, call the onError callback
        if (type === 'error') {
            onError?.(msg); // Pass the original message without prefix
        } else {
            // Clear the error when a non-error message arrives (optional, depends on desired UX)
            // onError?.(null);
        }
    }, [onError]);

    // --- State Reset Functions ---
    const resetReceiverState = useCallback(() => {
        addMessage('Resetting receiver state...', 'info');
        fileStreams.current.forEach(async (streamInfo) => {
            try {
                // Attempt to close, ignore errors if already closed
                await streamInfo.writer.close().catch(() => {});
                addMessage(`Closed file stream for ${streamInfo.fileName}`, 'info');
            } catch (err) { /* Ignore */ }
        });
        fileStreams.current.clear();
        incomingFiles.current.clear();
        receivedChunks.current.clear();
        setPendingSaveFiles(new Map()); // Clear pending saves
        setOverallProgress(0);
        if (transferStatus === 'receiving') {
            setTransferStatus('idle');
        }
    }, [addMessage, transferStatus]);

    const resetSenderState = useCallback(() => {
        addMessage('Resetting sender state...', 'info');
        fileReader.current?.abort();
        fileQueue.current = [];
        currentFileIndex.current = -1;
        totalBytesToTransfer.current = 0;
        totalBytesTransferred.current = 0;
        setOverallProgress(0);
        cancelTransferRef.current = false; // Reset cancel flag
        if (transferStatus === 'sending') {
            setTransferStatus('idle');
        }
    }, [addMessage, transferStatus]);

    // --- Cancellation ---
    const cancelTransfer = useCallback(() => {
        if (transferStatus === 'idle') {
            addMessage("No transfer in progress to cancel.", "warning");
            return;
        }
        addMessage("Transfer cancellation requested...", "warning");
        cancelTransferRef.current = true;

        const statusBeforeCancel = transferStatus;
        setTransferStatus('idle'); // Go to idle immediately

        if (statusBeforeCancel === 'sending') {
            resetSenderState();
        } else if (statusBeforeCancel === 'receiving') {
            resetReceiverState();
        }

        // Notify the peer (best effort)
        try {
            webRTC.sendData(JSON.stringify({ type: 'file-transfer-cancel' }));
            addMessage("Cancellation notification sent to peer.", "info");
        } catch (e) {
            addMessage("Failed to send cancellation notification (peer likely disconnected).", "warning");
        }

    }, [webRTC, addMessage, transferStatus, resetSenderState, resetReceiverState]);

    // --- Sender Logic ---
    const sendNextFile = useCallback(() => {
        if (cancelTransferRef.current || fileQueue.current.length === 0 ||
            currentFileIndex.current >= fileQueue.current.length - 1) {
            if (!cancelTransferRef.current && currentFileIndex.current >= 0) {
                webRTC.sendData(JSON.stringify({ type: 'all-files-complete' }));
                addMessage("All files have been sent.", 'success');
            }
            setTransferStatus('idle'); // Transition back to idle
            return;
        }
        currentFileIndex.current++;
        const current = fileQueue.current[currentFileIndex.current];
        sendSingleFile(current.file, current.id);
    }, [webRTC, addMessage]); // Removed transferStatus dependency, set inside

    const sendSingleFile = useCallback((file: File, fileId: string) => {
        // Check connection status
        if (!webRTC.isPeerConnected || !webRTC.dataChannelRef.current ||
            webRTC.dataChannelRef.current.readyState !== 'open') {
            addMessage('Cannot send file. WebRTC connection or DataChannel not open.', 'error');
            setTransferStatus('idle'); // Reset status on connection error
            return;
        }
        if (cancelTransferRef.current) return;

        const metadata: FileMetadata = { name: file.name, size: file.size, type: file.type, id: fileId };
        addMessage(`Sending file: ${metadata.name} (${Math.round(metadata.size / 1024)} KB)`, 'info');
        webRTC.sendData(JSON.stringify({ type: 'file-metadata', payload: metadata }));

        let offset = 0;
        fileReader.current = new FileReader();
        const dc = webRTC.dataChannelRef.current;

        const sendNextChunk = (currentOffset: number) => {
            if (cancelTransferRef.current) {
                addMessage("Send cancelled.", "warning");
                // resetSenderState(); // Already handled by cancelTransfer or sendNextFile completion
                return;
            }
            const slice = file.slice(currentOffset, currentOffset + CHUNK_SIZE);
            fileReader.current!.readAsArrayBuffer(slice);
        };

        fileReader.current.onload = (e) => {
            if (cancelTransferRef.current) return; // Check again after async read

            if (!e.target?.result || !(e.target.result instanceof ArrayBuffer) || !dc || dc.readyState !== 'open') {
                addMessage('Error during file read or send (channel closed?).', 'error');
                setTransferStatus('idle'); // Reset status
                return;
            }

            const chunk = e.target.result as ArrayBuffer;
            try {
                // Prepend file ID
                const encoder = new TextEncoder();
                const idBytes = encoder.encode(fileId.padEnd(36, ' '));
                const combinedBuffer = new ArrayBuffer(36 + chunk.byteLength);
                const combinedView = new Uint8Array(combinedBuffer);
                combinedView.set(idBytes, 0);
                combinedView.set(new Uint8Array(chunk), 36);

                // Backpressure
                if (dc.bufferedAmount > CHUNK_SIZE * 8) {
                    setTimeout(() => sendNextChunk(offset), 100); // Simple delay
                    return;
                }

                webRTC.sendData(combinedBuffer);
                offset += chunk.byteLength;
                totalBytesTransferred.current += chunk.byteLength;

                // Update progress
                if (totalBytesToTransfer.current > 0) {
                    setOverallProgress(Math.round((totalBytesTransferred.current / totalBytesToTransfer.current) * 100));
                }

                if (offset < file.size) {
                    sendNextChunk(offset);
                } else {
                    addMessage(`Finished sending "${file.name}".`, 'success');
                    webRTC.sendData(JSON.stringify({ type: 'file-transfer-complete', payload: { fileId } }));
                    setTimeout(sendNextFile, 100); // Slightly shorter delay
                }
            } catch (error) {
                addMessage(`Error sending file chunk: ${error instanceof Error ? error.message : String(error)}`, 'error');
                setTransferStatus('idle'); // Reset status
            }
        };

        fileReader.current.onerror = (error) => {
            addMessage(`Error reading file: ${error instanceof Error ? error.message : String(error)}`, 'error');
            setTransferStatus('idle'); // Reset status
        };

        sendNextChunk(0);
    }, [webRTC, addMessage, sendNextFile]); // Removed transferStatus dependency

    const sendFiles = useCallback((files: File[]) => {
        if (files.length === 0) return;
        if (transferStatus !== 'idle') {
            addMessage('Another transfer is already in progress.', 'warning');
            return;
        }
        if (!webRTC.isPeerConnected || !webRTC.dataChannelRef.current || webRTC.dataChannelRef.current.readyState !== 'open') {
            addMessage('Cannot send files. WebRTC connection or DataChannel not open.', 'error');
            return;
        }

        // Reset sender state variables (not full reset function)
        cancelTransferRef.current = false;
        fileQueue.current = files.map(file => ({ file, id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}` }));
        totalBytesToTransfer.current = files.reduce((sum, file) => sum + file.size, 0);
        totalBytesTransferred.current = 0;
        currentFileIndex.current = -1;
        setOverallProgress(0);

        setTransferStatus('sending'); // Set status
        sendNextFile(); // Start the process

    }, [webRTC, addMessage, transferStatus, sendNextFile]);

    // Function to send text messages
    const sendTextMessage = useCallback((text: string) => {
        if (webRTC.sendData(text)) {
            addMessage(`Sent Text: ${text}`, 'info');
        } else {
            addMessage('Cannot send message. Data channel not open.', 'error');
        }
    }, [webRTC, addMessage]);


    // --- Receiver Logic ---
    const writeChunkToStream = useCallback(async (fileId: string, chunk: ArrayBuffer): Promise<boolean> => {
        const streamInfo = fileStreams.current.get(fileId);
        if (!streamInfo) return false;

        try {
            await streamInfo.writer.write(new Uint8Array(chunk));
            streamInfo.bytesWritten += chunk.byteLength;

            // Update overall progress based on all *active* streams
            let totalSize = 0;
            let totalWritten = 0;
            fileStreams.current.forEach(info => {
                totalSize += info.fileSize;
                totalWritten += info.bytesWritten;
            });
            if (totalSize > 0) {
                setOverallProgress(Math.min(100, Math.round((totalWritten / totalSize) * 100)));
            }

            return true;
        } catch (err) {
            addMessage(`Error writing chunk to file ${streamInfo.fileName}: ${err instanceof Error ? err.message : String(err)}`, 'error');
            // Consider cancelling or cleaning up the specific stream on write error
            return false;
        }
    }, [addMessage]);

    const completeFileStream = useCallback(async (fileId: string): Promise<boolean> => {
        addMessage(`[DEBUG] completeFileStream called for fileId: ${fileId}`, 'info');
        const streamInfo = fileStreams.current.get(fileId);
        if (!streamInfo) {
            addMessage(`[WARN] completeFileStream called for unknown or already completed stream: ${fileId}`, 'warning');
            return false;
        }

        try {
            await streamInfo.writer.close();
            addMessage(`File "${streamInfo.fileName}" saved successfully!`, 'success');

            setCompletedTransfers(prev => [...prev, {
                fileName: streamInfo.fileName, fileSize: streamInfo.bytesWritten, fileType: streamInfo.fileType,
                id: fileId, savedDirectly: true
            }]);

            // Clean up
            fileStreams.current.delete(fileId);
            incomingFiles.current.delete(fileId); // Also remove from incoming metadata list

            // Check if this was the last active stream
            if (fileStreams.current.size === 0 && pendingSaveFiles.size === 0) {
                 // Only go idle if no streams AND no pending saves left
                 // Note: 'all-files-complete' message should ideally handle the final idle transition
            }

            return true;
        } catch (err) {
            addMessage(`Error closing stream for ${streamInfo.fileName}: ${err instanceof Error ? err.message : String(err)}`, 'error');
            return false;
        }
    }, [addMessage, pendingSaveFiles.size]); // Added pendingSaveFiles.size dependency

    const reconstructAndSaveFile = useCallback(async (fileId: string) => {
        if (cancelTransferRef.current) return;
        const fileInfo = incomingFiles.current.get(fileId);
        const chunks = receivedChunks.current.get(fileId);

        if (!fileInfo || !chunks) {
            addMessage(`Cannot reconstruct file ${fileId}. Missing info or chunks.`, 'error'); return;
        }
        if (chunks.length === 0) {
            addMessage(`Cannot reconstruct file ${fileId}. No data chunks received.`, 'error');
            incomingFiles.current.delete(fileId); receivedChunks.current.delete(fileId); return;
        }

        try {
            const fileBlob = new Blob(chunks, { type: fileInfo.type });
            if (fileBlob.size === 0) {
                 addMessage(`Warning: Reconstructed file ${fileInfo.name} is empty (0 bytes). Skipping.`, 'warning');
                 incomingFiles.current.delete(fileId); receivedChunks.current.delete(fileId); return;
            }
            if (fileInfo.size > 0 && fileBlob.size !== fileInfo.size) {
                 addMessage(`Warning: Reconstructed size (${fileBlob.size}) differs from metadata size (${fileInfo.size}) for ${fileInfo.name}.`, 'warning');
            }

            const downloadUrl = URL.createObjectURL(fileBlob);
            addMessage(`File "${fileInfo.name}" received (fallback). Ready to download.`, 'success');

            setCompletedTransfers(prev => [...prev, {
                fileName: fileInfo.name, fileSize: fileBlob.size, fileType: fileInfo.type,
                downloadUrl, blob: fileBlob, id: fileId, savedDirectly: false
            }]);

            // Clean up
            receivedChunks.current.delete(fileId);
            incomingFiles.current.delete(fileId);

        } catch (error) {
             addMessage(`Error reconstructing file ${fileInfo.name}: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }

        // Check if all files (using fallback) are processed
        if (incomingFiles.current.size === 0 && receivedChunks.current.size === 0 && fileStreams.current.size === 0) {
            // Note: 'all-files-complete' message should ideally handle the final idle transition
        }
    }, [addMessage]);

    const acceptAndSaveFile = useCallback(async (fileId: string) => {
        addMessage(`[DEBUG] acceptAndSaveFile called for fileId: ${fileId}`, 'info');
        const fileInfo = pendingSaveFiles.get(fileId);
        if (!fileInfo) { addMessage(`Cannot find pending file info for ID: ${fileId}`, 'error'); return; }

        // Handle Fallback First
        if (!streamsSupported.current) {
            addMessage('Streaming save not supported. Using fallback download method.', 'warning');
            if (receivedChunks.current.has(fileId)) {
                await reconstructAndSaveFile(fileId);
                // Remove from pending after fallback attempt
                setPendingSaveFiles(prev => { const next = new Map(prev); next.delete(fileId); return next; });
            } else {
                 addMessage(`Cannot save ${fileInfo.name} via fallback: No chunks buffered.`, 'error');
            }
            return;
        }

        // Streaming Path
        try {
            // --- Show Save File Picker (within user gesture) ---
            const fileExtension = fileInfo.name.includes('.')
                ? `.${fileInfo.name.split('.').pop()}`
                : undefined;

            const acceptConfig: Record<`${string}/${string}`, `.${string}`[]> = {};
            const mimeType = (fileInfo.type || 'application/octet-stream') as `${string}/${string}`;

            if (fileExtension) {
                acceptConfig[mimeType] = [fileExtension as `.${string}`];
            } else {
                acceptConfig[mimeType] = [];
            }

            const fileHandle = await window.showSaveFilePicker({
                suggestedName: fileInfo.name,
                types: [{ description: 'File', accept: acceptConfig }]
            });
            // --- End Save File Picker ---

            const writable = await fileHandle.createWritable();
            const writer = writable.getWriter();

            fileStreams.current.set(fileId, {
                 fileId, fileName: fileInfo.name, fileType: fileInfo.type, fileSize: fileInfo.size,
                 writer, fileHandle, bytesWritten: 0
            });
            addMessage(`[DEBUG] Stream created for ${fileInfo.name}.`, 'info');

            // Remove from pending list *before* writing chunks
            setPendingSaveFiles(prev => { const next = new Map(prev); next.delete(fileId); return next; });

            // Write any buffered chunks
            const pendingChunks = receivedChunks.current.get(fileId);
            if (pendingChunks?.length) {
                addMessage(`[DEBUG] Writing ${pendingChunks.length} stored chunks for ${fileInfo.name}...`, 'info');
                for (const chunk of pendingChunks) {
                    if (!(await writeChunkToStream(fileId, chunk))) {
                        addMessage(`[ERROR] Failed writing stored chunk for ${fileInfo.name}. Aborting stream.`, 'error');
                        await writer.abort().catch(() => {}); // Attempt to abort stream
                        fileStreams.current.delete(fileId); // Clean up failed stream
                        // Optionally put back in pendingSaveFiles or mark as failed
                        return; // Stop processing this file
                    }
                }
                receivedChunks.current.delete(fileId); // Clear buffer *after* successful write
                addMessage(`[DEBUG] Finished writing stored chunks for ${fileInfo.name}.`, 'info');
            } else {
                addMessage(`[DEBUG] No stored chunks found for ${fileInfo.name}.`, 'info');
            }
            addMessage(`[DEBUG] acceptAndSaveFile finished successfully for fileId: ${fileId}`, 'info');
        } catch (err) {
            addMessage(`[DEBUG] acceptAndSaveFile failed for fileId: ${fileId} with error: ${err}`, 'error');
            if (err instanceof Error && err.name === 'AbortError') {
                addMessage(`Save cancelled by user for ${fileInfo.name}.`, 'warning');
                // User cancelled picker - file remains in pendingSaveFiles
            } else {
                addMessage(`Failed to save file ${fileInfo.name}: ${err instanceof Error ? err.message : String(err)}`, 'error');
                // Keep in pendingSaveFiles on other errors? Or remove? Depends on desired retry behavior.
            }
        }
    }, [pendingSaveFiles, addMessage, writeChunkToStream, reconstructAndSaveFile]);

    // --- WebRTC Data Channel Message Handler --- 
    useEffect(() => {
        console.log("[DEBUG] useFileTransfer: Setting up onDataChannelMessage handler effect.");
        
        const handleDataChannelMessage = async (event: MessageEvent) => {
            // Access refs directly: cancelTransferRef.current, fileStreams.current, etc.
            // Call stable callbacks: addMessage, writeChunkToStream, etc.
            // Call state setters: setTransferStatus, setPendingSaveFiles, etc.

            if (cancelTransferRef.current) return; // Check ref

            if (typeof event.data === 'string') {
                try {
                    const message = JSON.parse(event.data);
                    switch (message.type) {
                        case 'file-metadata': {
                            const fileInfo = message.payload as FileMetadata;
                            if (!fileInfo.id) fileInfo.id = `file-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                            addMessage(`Receiving metadata: ${fileInfo.name} (${Math.round(fileInfo.size / 1024)} KB)`, 'info');
                            incomingFiles.current.set(fileInfo.id, fileInfo);
                            // Use callback form for state setter to avoid depending on pendingSaveFiles value
                            setPendingSaveFiles(prev => new Map(prev).set(fileInfo.id, fileInfo)); 
                            if (!receivedChunks.current.has(fileInfo.id)) {
                                receivedChunks.current.set(fileInfo.id, []);
                            }
                            // Use callback form for state setter to avoid depending on transferStatus value
                            setTransferStatus(currentStatus => currentStatus === 'idle' ? 'receiving' : currentStatus);
                            break;
                        }
                        case 'file-transfer-complete': {
                            const fileId = message.payload?.fileId;
                            if (!fileId) { addMessage('Received file completion message without file ID', 'warning'); break; }

                            if (fileStreams.current.has(fileId)) {
                                await completeFileStream(fileId);
                            } else if (incomingFiles.current.has(fileId) && receivedChunks.current.has(fileId)) {
                                addMessage(`Transfer complete (fallback) for file: ${incomingFiles.current.get(fileId)?.name}`, 'info');
                                await reconstructAndSaveFile(fileId);
                            } else { addMessage(`Transfer complete for unknown file ID: ${fileId}`, 'warning'); }
                            break;
                        }
                        case 'all-files-complete': {
                            addMessage("Sender indicated all files sent.", 'success');
                            // Check current state via refs/state size before setting idle
                            if (fileStreams.current.size === 0 && pendingSaveFiles.size === 0) { 
                                setTransferStatus('idle');
                            } else {
                                addMessage("Waiting for receiver to finish saving files...", 'info');
                            }
                            break;
                        }
                        case 'file-transfer-cancel': {
                            addMessage("Peer cancelled the transfer.", "warning");
                            cancelTransferRef.current = true;
                            // Call both reset functions; they have internal checks
                            resetReceiverState(); 
                            resetSenderState(); 
                            setTransferStatus('idle'); // Go idle
                            break;
                        }
                        default:
                            addMessage(`Received Text: ${event.data}`, 'info');
                    }
                } catch (e) {
                    addMessage(`Received Plain Text: ${event.data}`, 'info');
                }
            } else if (event.data instanceof ArrayBuffer) {
                if (event.data.byteLength <= 36) { addMessage('Received invalid file chunk: too small', 'warning'); return; }
                const idView = new Uint8Array(event.data, 0, 36);
                const decoder = new TextDecoder();
                const fileId = decoder.decode(idView).trim();
                const fileData = event.data.slice(36);

                if (fileStreams.current.has(fileId)) {
                    await writeChunkToStream(fileId, fileData);
                } else {
                    // Buffer chunk if metadata exists or create temporary metadata
                    if (!incomingFiles.current.has(fileId)) {
                        addMessage(`Received chunk for file ID: ${fileId} before metadata, storing temporarily`, 'info');
                        incomingFiles.current.set(fileId, { name: `pending-${fileId}`, size: 0, type: 'application/octet-stream', id: fileId });
                    }
                    if (!receivedChunks.current.has(fileId)) receivedChunks.current.set(fileId, []);
                    receivedChunks.current.get(fileId)!.push(fileData);
                }
            } else {
                addMessage(`Received unexpected message type: ${typeof event.data}`, 'warning');
            }
        };

        // Assign the handler
        webRTC.onDataChannelMessage.current = handleDataChannelMessage;
        console.log("[DEBUG] useFileTransfer: Set onDataChannelMessage handler.");

        // Cleanup function
        return () => {
            webRTC.onDataChannelMessage.current = null;
            console.log("[DEBUG] useFileTransfer: Cleared onDataChannelMessage handler.");
        };
    // Minimal dependencies: webRTC object and stable callbacks.
    // State setters are accessed via callback form or stable callbacks.
    }, [webRTC, addMessage, writeChunkToStream, completeFileStream, reconstructAndSaveFile, resetReceiverState, resetSenderState]);

    // --- Fallback Save & Cleanup ---
    const saveReceivedFile = useCallback(async (blob: Blob, fileName: string, fileId: string) => {
        // This is now only needed for the fallback (non-streaming) case
        // Or if you want to offer a re-save option from completedTransfers
        try {
            const fileHandle = await window.showSaveFilePicker({ suggestedName: fileName, types: [{ description: 'Received File' }] });
            const writableStream = await fileHandle.createWritable();
            await writableStream.write(blob);
            await writableStream.close();
            addMessage(`File "${fileName}" saved successfully!`, 'success');
            // Remove from completed transfers after successful save
            setCompletedTransfers(prev => prev.filter(item => item.id !== fileId));
        } catch (error) {
             if (error instanceof DOMException && error.name === 'AbortError') {
              addMessage('File save cancelled by user.', 'warning');
            } else {
              console.error('Error saving file:', error);
              addMessage(`Error saving file: ${error instanceof Error ? error.message : String(error)}`, 'error');
            }
        }
    }, [addMessage]);

    const clearCompleted = useCallback(() => {
        // Access completedTransfers via setCompletedTransfers' callback form to avoid dependency
        setCompletedTransfers(currentTransfers => {
            currentTransfers.forEach(transfer => {
                if (transfer.downloadUrl) URL.revokeObjectURL(transfer.downloadUrl); // Clean up blob URLs
            });
            return []; // Return the new empty array
        });
        addMessage("Cleared completed transfer list.", "info");
    }, [addMessage]);

    // --- Hook Return Value ---
    return {
        messages,
        // Simplified send functions
        sendFiles,
        sendTextMessage,
        cancelTransfer,
        transferProgress: overallProgress,
        transferStatus, // Use this instead of isBusy
        isBusy: transferStatus !== 'idle', // Keep isBusy for convenience if needed
        // Receiver state/actions
        pendingSaveFiles,
        acceptAndSaveFile,
        // Completed state/actions
        completedTransfers,
        saveReceivedFile, // For UI to trigger fallback save
        clearCompleted,
    };
}

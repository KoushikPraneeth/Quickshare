// src/components/ConnectionStatus.tsx
import { TransferStatus } from '../hooks/useFileTransfer'; // Import the type

// Export the props interface
export interface ConnectionStatusProps {
    wsConnected: boolean;
    clientId: number | null;
    rtcConnected: boolean;
    transferStatus: TransferStatus; // Use the new status type
    progress: number;
}

// Ensure the component itself is exported
export function ConnectionStatus({ wsConnected, clientId, rtcConnected, transferStatus, progress }: ConnectionStatusProps) {
    const wsStatusClass = wsConnected ? 'status-connected' : 'status-disconnected';
    
    let rtcStatusText = 'Disconnected';
    let rtcStatusClass = 'status-disconnected';
    const showProgress = transferStatus === 'sending' || transferStatus === 'receiving';

    if (transferStatus === 'sending') {
        rtcStatusText = `Sending (${progress}%)`;
        rtcStatusClass = 'status-transferring';
    } else if (transferStatus === 'receiving') {
        rtcStatusText = `Receiving (${progress}%)`;
        rtcStatusClass = 'status-transferring';
    } else if (rtcConnected) {
        rtcStatusText = 'Connected';
        rtcStatusClass = 'status-connected';
    } else if (wsConnected && clientId !== null) {
        rtcStatusText = 'Waiting for Peer / Connecting...';
        rtcStatusClass = 'status-transferring'; // Orange for intermediate
    }

    return (
        <div className="card">
            <p>
                <span className={`status-indicator ${wsStatusClass}`}></span>
                Signaling: {wsConnected ? `Connected (ID: ${clientId ?? 'N/A'})` : 'Disconnected'}
            </p>
            <p>
                <span className={`status-indicator ${rtcStatusClass}`}></span>
                WebRTC Status: {rtcStatusText}
            </p>
            {/* Progress Bar - show during sending or receiving */} 
            {showProgress && (
                <div className="progress-bar-container">
                    <div className="progress-bar" style={{ width: `${progress}%` }}></div>
                </div>
            )}
        </div>
    );
}
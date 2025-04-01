// src/hooks/useWebRTC.ts
import { useState, useRef, useEffect, useCallback } from 'react';
import { useWebSocket } from './useWebSocket';

const configuration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

export function useWebRTC(signaling: ReturnType<typeof useWebSocket>) {
    const peerConnection = useRef<RTCPeerConnection | null>(null);
    const dataChannel = useRef<RTCDataChannel | null>(null);
    const [isPeerConnected, setIsPeerConnected] = useState(false);
    const [isInitiator, setIsInitiator] = useState<boolean>(false);
    const onDataChannelOpen = useRef<(() => void) | null>(null);
    const onDataChannelMessage = useRef<((event: MessageEvent) => void) | null>(null);
    const onDataChannelClose = useRef<(() => void) | null>(null);
    const onDataChannelError = useRef<((event: Event) => void) | null>(null);
    // Ref to track if the initial offer has been sent for the current attempt
    const initialOfferSent = useRef(false);

    const initializePeerConnection = useCallback(() => {
        // Reset offer flag when initializing a new connection
        initialOfferSent.current = false;
        if (peerConnection.current) {
            // Clean up existing connection before creating a new one
            peerConnection.current.onicecandidate = null;
            peerConnection.current.ondatachannel = null;
            peerConnection.current.onconnectionstatechange = null;
            peerConnection.current.close();
            console.log("Closed existing Peer Connection before re-initializing.");
        }
        console.log("Initializing Peer Connection...");
        const pc = new RTCPeerConnection(configuration);
        peerConnection.current = pc;

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('Generated ICE candidate, sending via WebSocket...');
                signaling.sendMessage({ type: 'candidate', payload: event.candidate });
            } else {
                console.log('All ICE candidates have been generated and sent.');
            }
        };

        pc.ondatachannel = (event) => {
            console.log('Data channel received!');
            dataChannel.current = event.channel;
            setupDataChannelEvents(event.channel);
            // isPeerConnected state is handled by onconnectionstatechange
        };

        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            console.log('WebRTC Connection state:', state);
            const connected = state === 'connected';
            if (connected !== isPeerConnected) {
                 setIsPeerConnected(connected);
            }
            if (state === 'failed' || state === 'disconnected' || state === 'closed') {
                setIsPeerConnected(false);
                // Reset offer flag if connection drops
                initialOfferSent.current = false; 
            }
        };

        // If this peer is the initiator, create the data channel
        if (isInitiator) {
            console.log('Initiator creating data channel');
            const dc = pc.createDataChannel('fileTransferChannel');
            dataChannel.current = dc;
            setupDataChannelEvents(dc);
        }

    }, [signaling, isInitiator, isPeerConnected]); // isPeerConnected might be removable if state change handles it

    const setupDataChannelEvents = (dc: RTCDataChannel) => {
        dc.binaryType = 'arraybuffer';
        dc.onopen = () => {
            console.log('Data channel OPEN');
            setIsPeerConnected(true); // Often connection state lags, this is a good indicator too
            onDataChannelOpen.current?.();
        };
        dc.onclose = () => {
            console.log('Data channel CLOSED');
            setIsPeerConnected(false);
            onDataChannelClose.current?.();
        };
        dc.onmessage = (event) => {
            onDataChannelMessage.current?.(event);
        };
        dc.onerror = (event) => {
            console.error('Data channel error:', event);
            onDataChannelError.current?.(event);
        };
    };

    const createOffer = useCallback(async () => {
        if (!peerConnection.current || !isInitiator || initialOfferSent.current) {
            console.log('Skipping offer creation (PC not ready, not initiator, or offer already sent)');
            return;
        }
        // Ensure data channel exists
        if (!dataChannel.current) {
             console.log('Creating data channel before offer');
             const dc = peerConnection.current.createDataChannel('fileTransferChannel');
             dataChannel.current = dc;
             setupDataChannelEvents(dc);
        }

        console.log('Creating offer...');
        try {
            // Ensure state is stable before creating offer
            if (peerConnection.current.signalingState !== 'stable') {
                console.warn(`Attempted to create offer in non-stable state: ${peerConnection.current.signalingState}. Aborting.`);
                return;
            }
            const offer = await peerConnection.current.createOffer();
            await peerConnection.current.setLocalDescription(offer);
            initialOfferSent.current = true; // Mark offer as sent *after* setLocalDescription
            console.log('Offer created and set locally, sending via WebSocket...');
            signaling.sendMessage({ type: 'offer', payload: offer });
        } catch (error) {
            console.error('Error creating offer:', error);
            initialOfferSent.current = false; // Reset flag on error
        }
    }, [signaling, isInitiator]); // Removed peerConnection.current from deps, useRef value doesn't trigger effect

    const handleOffer = useCallback(async (offer: RTCSessionDescriptionInit) => {
        if (!peerConnection.current) {
            console.log("Received offer but no peer connection, initializing...");
            initializePeerConnection();
            if (!peerConnection.current) return; // Still failed
        }

        // Check if we already have a remote description
        const currentState = peerConnection.current.signalingState;
        console.log(`Current signaling state before handling offer: ${currentState}`);
        
        if (currentState === 'have-remote-offer' || currentState === 'have-local-pranswer') {
            console.log('Already have a remote offer. Ignoring redundant offer.');
            return;
        }

        // Only allow offers in 'stable' or 'have-local-offer' states
        if (currentState !== 'stable' && currentState !== 'have-local-offer') {
            console.log(`Cannot handle offer in ${currentState} state. Waiting for stable state.`);
            return;
        }

        // If we already have a local offer but received a remote offer,
        // we need to determine who wins the "glare" situation based on IDs
        // Lower ID gets to be the offerer (we'll use isInitiator for this)
        if (currentState === 'have-local-offer') {
            if (isInitiator) {
                console.log('Already created an offer as initiator. Ignoring incoming offer.');
                return;
            } else {
                // Roll back to stable state to accept the offer
                try {
                    console.log('Rolling back local offer to accept incoming offer.');
                    await peerConnection.current.setLocalDescription({type: 'rollback'});
                } catch (error) {
                    console.error('Error rolling back local description:', error);
                    return;
                }
            }
        }

        console.log('Handling received offer...');
        try {
            await peerConnection.current.setRemoteDescription(new RTCSessionDescription(offer));
            console.log('Remote description (offer) set, creating answer...');
            const answer = await peerConnection.current.createAnswer();
            await peerConnection.current.setLocalDescription(answer);
            console.log('Answer created, sending via WebSocket...');
            signaling.sendMessage({ type: 'answer', payload: answer });
        } catch (error) {
            console.error('Error handling offer or creating answer:', error);
        }
        // Reset offer flag if we accept an offer (we become the answerer)
        initialOfferSent.current = false; 
    }, [signaling, isInitiator, initializePeerConnection]);

    const handleAnswer = useCallback(async (answer: RTCSessionDescriptionInit) => {
        if (!peerConnection.current || !isInitiator) {
            console.log('Skipping answer handling (PC not ready or not initiator)');
            return;
        }
        console.log('Handling received answer...');
        
        try {
            // Check the current signaling state before proceeding
            const currentState = peerConnection.current.signalingState;
            console.log(`Current signaling state before handling answer: ${currentState}`);
            
            // Only apply answer when we're in have-local-offer state
            if (currentState !== 'have-local-offer') {
                console.log(`Cannot handle answer in ${currentState} state. Must be in 'have-local-offer' state.`);
                return;
            }
            
            await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer));
            console.log('Remote description (answer) set. Connection should establish.');
            // DO NOT trigger createOffer here
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }, [isInitiator]); // Removed signaling dependency as it's not used

    const handleCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
        if (!peerConnection.current) return;
        try {
            if (candidate && candidate.candidate) {
                await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
                console.log('Successfully added remote ICE candidate');
            } else {
                 console.log("Received empty or invalid ICE candidate, skipping.");
            }
        } catch (error) {
             if (!`${error}`.includes("Cannot add ICE candidate before setting remote description")) {
                 console.error('Error adding remote ICE candidate:', error);
             }
        }
    }, []); // No dependencies needed if only using peerConnection.current

    // Effect specifically for handling initiator status and creating the initial offer
    useEffect(() => {
        // Only create offer if we are initiator, have a connection, and haven't sent the initial offer yet
        if (isInitiator && peerConnection.current && !initialOfferSent.current) {
            // Check signaling state - should ideally be stable after initialization
            if (peerConnection.current.signalingState === 'stable') {
                console.log('Initiator ready and PC stable, creating initial offer...');
                createOffer(); 
            } else {
                // This might happen briefly during setup, add a small delay or wait for stable state
                console.log(`Initiator ready but PC not stable (${peerConnection.current.signalingState}). Waiting slightly.`);
                // Optional: Could add a signalingstatechange listener here for robustness
                // setTimeout(createOffer, 100); // Simple delay, but listener is better
            }
        }
    }, [isInitiator, createOffer]); // Depends on isInitiator state and the stable createOffer callback

    // Listen to signaling messages (Separate Effect)
    useEffect(() => {
        const cleanupFuncs: (()=>void)[] = [];

        cleanupFuncs.push(signaling.addMessageListener('peer-connected', (payload) => {
            console.log('Peer connected message received.');
            setIsInitiator(payload.isInitiator);
            // Initialize PC *after* initiator status is set
            initializePeerConnection(); 
            // Offer creation is handled by the dedicated effect above based on isInitiator change
        }));

        cleanupFuncs.push(signaling.addMessageListener('offer', (payload) => {
             // Check if we are NOT the initiator before handling offer
             // Need a way to access current isInitiator state reliably here.
             // Using a ref or ensuring handleOffer checks internally is best.
             // For now, assume handleOffer checks `isInitiator` state correctly.
             handleOffer(payload);
        }));
        cleanupFuncs.push(signaling.addMessageListener('answer', (payload) => {
             // Assume handleAnswer checks `isInitiator` state correctly.
             handleAnswer(payload);
        }));
        cleanupFuncs.push(signaling.addMessageListener('candidate', (payload) => {
             handleCandidate(payload);
        }));
        cleanupFuncs.push(signaling.addMessageListener('peer-disconnected', () => {
            console.log('Peer disconnected message received.');
            peerConnection.current?.close();
            peerConnection.current = null;
            dataChannel.current = null;
            setIsPeerConnected(false);
            setIsInitiator(false); // Reset initiator status
            initialOfferSent.current = false; // Reset offer flag
        }));

        return () => { 
            console.log("Cleaning up signaling listeners.");
            cleanupFuncs.forEach(cf => cf()); 
        };
    // Dependencies should only include stable functions/refs needed to add/remove listeners
    }, [signaling, initializePeerConnection, handleOffer, handleAnswer, handleCandidate]); // Removed isInitiator and createOffer

    const sendData = useCallback((data: string | Blob | ArrayBuffer) => {
        if (dataChannel.current && dataChannel.current.readyState === 'open') {
            // Use type assertion to bypass incorrect TS overload error
            dataChannel.current.send(data as any);
            return true;
        } else {
            console.error('Data channel is not open for sending.');
            return false;
        }
    }, []);

    return {
        isPeerConnected,
        isInitiator,
        sendData,
        onDataChannelOpen,
        onDataChannelMessage,
        onDataChannelClose,
        onDataChannelError,
        dataChannelRef: dataChannel
    };
}
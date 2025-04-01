// src/hooks/useWebSocket.ts
import { useState, useRef, useEffect, useCallback } from 'react';

export interface SignalingMessage {
    type: string;
    payload?: any;
    senderId?: number; // Optional: server might add this
    roomCode?: string; // Room code for directed signaling
}

export function useWebSocket(url: string, roomCode?: string) {
    const websocket = useRef<WebSocket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [clientId, setClientId] = useState<number | null>(null);
    const messageListeners = useRef<Map<string, ((payload: any) => void)[]>>(new Map());
    const reconnectAttempts = useRef<number>(0);
    const maxReconnectAttempts = 5;
    const reconnectTimeoutRef = useRef<number | null>(null);
    // Keep track of room code
    const currentRoomCode = useRef<string | undefined>(roomCode);

    // Update room code reference when prop changes
    useEffect(() => {
        currentRoomCode.current = roomCode;
        
        // If we're already connected and room code changes, send a room-join message
        if (isConnected && websocket.current?.readyState === WebSocket.OPEN && roomCode) {
            websocket.current.send(JSON.stringify({
                type: 'join-room',
                payload: roomCode
            }));
        }
    }, [roomCode, isConnected]);

    // Function to create and set up WebSocket connection
    const setupWebSocket = useCallback(() => {
        // Clean up any existing connection first
        if (websocket.current) {
            websocket.current.onclose = null;
            websocket.current.onerror = null;
            websocket.current.onmessage = null;
            websocket.current.onopen = null;
            websocket.current.close();
        }
        
        try {
            websocket.current = new WebSocket(url);
            
            websocket.current.onopen = () => {
                console.log('WebSocket connected');
                setIsConnected(true);
                reconnectAttempts.current = 0; // Reset reconnect counter on successful connection
                
                // If we have a room code, send a join-room message
                if (currentRoomCode.current) {
                    console.log(`Joining room: ${currentRoomCode.current}`);
                    websocket.current?.send(JSON.stringify({
                        type: 'join-room',
                        payload: currentRoomCode.current
                    }));
                }
            };
            
            websocket.current.onclose = (event) => {
                console.log('WebSocket disconnected');
                setIsConnected(false);
                
                // Don't reset clientId on temporary disconnects to maintain identity
                
                // Notify listeners about disconnection
                messageListeners.current.get('close')?.forEach(cb => cb(event));
                
                // Try to reconnect unless we've reached max attempts
                if (reconnectAttempts.current < maxReconnectAttempts) {
                    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
                    console.log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempts.current + 1})`);
                    
                    if (reconnectTimeoutRef.current !== null) {
                        window.clearTimeout(reconnectTimeoutRef.current);
                    }
                    
                    reconnectTimeoutRef.current = window.setTimeout(() => {
                        reconnectAttempts.current++;
                        setupWebSocket();
                    }, delay);
                } else {
                    console.error('Max reconnection attempts reached');
                    setClientId(null); // Reset clientId after all reconnect attempts fail
                    messageListeners.current.get('max-reconnect-failed')?.forEach(cb => cb(null));
                }
            };
            
            websocket.current.onerror = (error) => {
                console.error('WebSocket error:', error);
                messageListeners.current.get('error')?.forEach(cb => cb(error));
            };
            
            websocket.current.onmessage = (event) => {
                try {
                    const message: SignalingMessage = JSON.parse(event.data);
                    console.log('WebSocket message received:', message.type);
                    
                    if (message.type === 'your-id') {
                        setClientId(message.payload);
                    }
                    
                    // Notify specific listeners
                    messageListeners.current.get(message.type)?.forEach(cb => cb(message.payload));
                    // Notify wildcard listeners
                    messageListeners.current.get('*')?.forEach(cb => cb(message));
                } catch (error) {
                    console.error("Failed to parse WebSocket message:", event.data, error);
                }
            };
        } catch (err) {
            console.error('Failed to create WebSocket connection:', err);
            messageListeners.current.get('error')?.forEach(cb => cb(err));
        }
    }, [url]);

    // Set up WebSocket connection
    useEffect(() => {
        setupWebSocket();
        
        return () => {
            if (reconnectTimeoutRef.current !== null) {
                window.clearTimeout(reconnectTimeoutRef.current);
            }
            
            if (websocket.current) {
                websocket.current.onclose = null; // Prevent reconnection attempt on intentional close
                websocket.current.close();
            }
        };
    }, [url, setupWebSocket]);

    const sendMessage = useCallback((message: SignalingMessage) => {
        if (websocket.current && websocket.current.readyState === WebSocket.OPEN) {
            // Automatically include the room code if available
            const messageWithRoom = {
                ...message,
                roomCode: currentRoomCode.current
            };
            websocket.current.send(JSON.stringify(messageWithRoom));
            return true;
        } else {
            console.error('WebSocket is not connected.');
            return false;
        }
    }, []);

    // Function to manually reconnect
    const reconnect = useCallback(() => {
        reconnectAttempts.current = 0; // Reset counter
        setupWebSocket();
    }, [setupWebSocket]);

    // Function to add listeners for specific message types
    const addMessageListener = useCallback((type: string, callback: (payload: any) => void) => {
        if (!messageListeners.current.has(type)) {
            messageListeners.current.set(type, []);
        }
        messageListeners.current.get(type)?.push(callback);
        
        // Cleanup function
        return () => {
            const listeners = messageListeners.current.get(type);
            if (listeners) {
                const index = listeners.indexOf(callback);
                if (index > -1) {
                    listeners.splice(index, 1);
                }
            }
        };
    }, []);

    return {
        isConnected,
        clientId,
        sendMessage,
        addMessageListener,
        roomCode: currentRoomCode.current, // Expose current room code
        reconnect // Expose reconnect function
    };
}
// src/components/MessageLog.tsx
import { useEffect, useRef } from 'react';

interface LogMessage {
  type: 'info' | 'success' | 'error' | 'transfer';
  text: string;
  timestamp?: Date;
}

interface MessageLogProps {
  messages: string[];
}

export function MessageLog({ messages }: MessageLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to the bottom when new messages come in
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);
  
  // Format timestamp for display
  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  
  // Get icon for message type
  const getMessageIcon = (type: LogMessage['type']): string => {
    switch (type) {
      case 'info': return 'ℹ️';
      case 'success': return '✅';
      case 'error': return '❌';
      case 'transfer': return '📤';
      default: return '';
    }
  };
  
  // Truncate messages to the max specified
  const displayMessages = messages.slice(-50);
  
  return (
    <div className="message-log" ref={scrollRef}>
      {displayMessages.length === 0 ? (
        <div className="empty-log">No activity yet</div>
      ) : (
        displayMessages.map((msg, index) => (
          <div 
            key={index} 
            className={`log-message`}
          >
            <span className="message-time">{formatTime(new Date())}</span>
            <span className="message-icon">{getMessageIcon('info')}</span>
            <span className="message-text">{msg}</span>
          </div>
        ))
      )}
    </div>
  );
}
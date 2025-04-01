import { useState, useEffect } from 'react';

interface ErrorMessageProps {
  message: string | null;
  onDismiss: () => void;
}

export function ErrorMessage({ message, onDismiss }: ErrorMessageProps) {
  const [visible, setVisible] = useState(false);
  
  // Animate the error message appearance
  useEffect(() => {
    if (message) {
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [message]);

  if (!message) {
    return null;
  }

  return (
    <div 
      className={`error-message ${visible ? 'visible' : ''}`}
      role="alert"
    >
      <div className="error-content">
        <strong>Error:</strong> {message}
      </div>
      <button 
        className="dismiss-button" 
        onClick={() => {
          setVisible(false);
          // Short delay to allow animation to complete
          setTimeout(onDismiss, 300);
        }} 
        aria-label="Dismiss error"
      >
        ×
      </button>
    </div>
  );
}
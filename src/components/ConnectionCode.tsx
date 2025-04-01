import { useState, useEffect, useCallback } from 'react';
import { UserRole } from './LandingPage';

interface ConnectionCodeProps {
  role: UserRole;
  onConnect: (code: string) => void;
  onBack: () => void;
}

// Function to generate a random 6-character code
const generateRandomCode = (): string => {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed similar looking characters
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
};

export function ConnectionCode({ role, onConnect, onBack }: ConnectionCodeProps) {
  const [connectionCode, setConnectionCode] = useState<string>('');
  const [enteredCode, setEnteredCode] = useState<string>('');
  const [isCopied, setIsCopied] = useState(false);

  // Generate a code if we're the sender
  useEffect(() => {
    if (role === 'sender') {
      setConnectionCode(generateRandomCode());
    }
  }, [role]);

  // Handle the copy button
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(connectionCode);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000); // Reset after 2 seconds
  }, [connectionCode]);

  // Connect using the code
  const handleConnect = useCallback(() => {
    if (role === 'receiver' && enteredCode.trim()) {
      onConnect(enteredCode.trim().toUpperCase());
    } else if (role === 'sender') {
      onConnect(connectionCode);
    }
  }, [role, connectionCode, enteredCode, onConnect]);

  return (
    <div className="connection-screen">
      <div className="connection-back" onClick={onBack}>
        ← Back to role selection
      </div>
      
      <h2>{role === 'sender' ? 'Share Your Connection Code' : 'Enter Connection Code'}</h2>
      
      {role === 'sender' ? (
        <>
          <p>Share this code with the person you want to send files to:</p>
          <div className="connection-code-display">
            {connectionCode}
          </div>
          <button onClick={handleCopy}>
            {isCopied ? 'Copied!' : 'Copy Code'}
          </button>
          
          <div className="code-instructions">
            <p>Instructions:</p>
            <ol>
              <li>Share this code with the receiver through any messaging app</li>
              <li>Wait for them to enter the code and connect</li>
              <li>Once connected, you'll be able to select and send files</li>
            </ol>
          </div>
          
          <button onClick={handleConnect}>
            Continue
          </button>
        </>
      ) : (
        <>
          <p>Enter the code shared with you by the sender:</p>
          <div className="connection-input">
            <input 
              type="text" 
              value={enteredCode} 
              onChange={(e) => setEnteredCode(e.target.value.toUpperCase())}
              placeholder="Enter code (e.g. AB123C)"
              maxLength={6}
            />
            <button 
              onClick={handleConnect}
              disabled={enteredCode.length < 6}
            >
              Connect
            </button>
          </div>
          
          <div className="code-instructions">
            <p>Instructions:</p>
            <ol>
              <li>Get the 6-character code from the person sending you files</li>
              <li>Enter the code exactly as provided (not case sensitive)</li>
              <li>Click Connect to establish a secure connection</li>
            </ol>
          </div>
        </>
      )}
    </div>
  );
}
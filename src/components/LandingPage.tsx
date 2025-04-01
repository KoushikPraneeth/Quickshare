import { useState } from "react";
import { ArrowRight } from "lucide-react";

export type UserRole = "sender" | "receiver" | null;

interface LandingPageProps {
  onRoleSelect: (role: UserRole) => void;
}

export function LandingPage({ onRoleSelect }: LandingPageProps) {
  const [hoverRole, setHoverRole] = useState<UserRole>(null);

  return (
    <div className="landing-container apple-gradient-dark">
      <div className="flex flex-col items-center space-y-4 text-center max-w-3xl mx-auto">
        <h1 className="landing-title">P2P File Transfer</h1>
        <p className="landing-subtitle">
          Transfer files directly between browsers.
          <span className="block mt-1">No server storage.</span>
        </p>

        <div className="role-selection">
          <div
            className={`role-card ${hoverRole === "sender" ? "hover:bg-white/10" : ""}`}
            onClick={() => onRoleSelect("sender")}
            onMouseEnter={() => setHoverRole("sender")}
            onMouseLeave={() => setHoverRole(null)}
          >
            <div className="relative z-10 flex flex-col items-center">
              <h2>Send</h2>
              <p>Share files with others by generating a connection code</p>
              <div className={`get-started ${hoverRole === "sender" ? "text-white" : ""}`}>
                <span>Get started</span>
                <ArrowRight className={`ml-1 h-4 w-4 transition-transform ${hoverRole === "sender" ? "translate-x-1" : ""}`} />
              </div>
            </div>
          </div>

          <div
            className={`role-card ${hoverRole === "receiver" ? "hover:bg-white/10" : ""}`}
            onClick={() => onRoleSelect("receiver")}
            onMouseEnter={() => setHoverRole("receiver")}
            onMouseLeave={() => setHoverRole(null)}
          >
            <div className="relative z-10 flex flex-col items-center">
              <h2>Receive</h2>
              <p>Enter a connection code to receive files from someone</p>
              <div className={`get-started ${hoverRole === "receiver" ? "text-white" : ""}`}>
                <span>Get started</span>
                <ArrowRight className={`ml-1 h-4 w-4 transition-transform ${hoverRole === "receiver" ? "translate-x-1" : ""}`} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

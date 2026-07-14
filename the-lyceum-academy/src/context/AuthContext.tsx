import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { auth, onAuthStateChanged, getRedirectResult, reload, sendEmailVerification } from '../lib/firebase';
import type { User } from '../lib/firebase';
import { startTrial } from '../lib/trial';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  devMode: boolean;
  emailVerified: boolean;
  setDevMode: (v: boolean) => void;
  resendVerificationEmail: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  devMode: false,
  emailVerified: false,
  setDevMode: () => {},
  resendVerificationEmail: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [devMode, setDevMode] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll Firebase to detect when user verifies their email
  function startVerificationPoll(u: User) {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        await reload(u);
        if (u.emailVerified) {
          setEmailVerified(true);
          stopVerificationPoll();
        }
      } catch {
        // ignore transient errors
      }
    }, 5000);
  }

  function stopVerificationPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => {
    getRedirectResult(auth).catch(() => {});

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);

      if (u) {
        // Auto-start 3-day trial on first login
        startTrial(u.uid);
        // Email verification disabled — all authenticated users are treated as verified
        setEmailVerified(true);
        stopVerificationPoll();
      } else {
        setEmailVerified(false);
        stopVerificationPoll();
      }
    });

    return () => {
      unsub();
      stopVerificationPoll();
    };
  }, []);

  async function resendVerificationEmail() {
    if (user && !user.emailVerified) {
      await sendEmailVerification(user);
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, devMode, emailVerified, setDevMode, resendVerificationEmail }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

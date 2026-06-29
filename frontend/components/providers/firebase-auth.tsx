"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { onIdTokenChanged, type User } from "firebase/auth";

import { firebaseAuth } from "@/lib/firebase/client";

type FirebaseAuthState = {
  user: User | null;
  loading: boolean;
};

const FirebaseAuthContext = createContext<FirebaseAuthState>({ user: null, loading: true });

// Cookie name shared with the admin app on localhost:3001.
// Cookies are NOT port-scoped on localhost, so both origins can read this.
const SHARED_TOKEN_COOKIE = "pclick_fb_token";

function setSharedCookie(token: string) {
  // max-age=3600 matches Firebase ID token lifetime (1 hr).
  // onIdTokenChanged fires on every auto-refresh, so the cookie stays fresh.
  document.cookie = `${SHARED_TOKEN_COOKIE}=${token}; path=/; max-age=3600; SameSite=Strict`;
}

function clearSharedCookie() {
  document.cookie = `${SHARED_TOKEN_COOKIE}=; path=/; max-age=0; SameSite=Strict`;
}

export function FirebaseAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // onIdTokenChanged fires on sign-in, sign-out, AND on every silent token
    // refresh (~every 55 min), keeping the shared cookie current.
    const unsubscribe = onIdTokenChanged(firebaseAuth, async (nextUser) => {
      setUser(nextUser);
      setLoading(false);
      if (nextUser) {
        try {
          const token = await nextUser.getIdToken();
          setSharedCookie(token);
        } catch {
          // getIdToken failure is non-fatal for the main app
        }
      } else {
        clearSharedCookie();
      }
    });
    return unsubscribe;
  }, []);

  return (
    <FirebaseAuthContext.Provider value={{ user, loading }}>
      {children}
    </FirebaseAuthContext.Provider>
  );
}

export function useFirebaseAuth() {
  return useContext(FirebaseAuthContext);
}

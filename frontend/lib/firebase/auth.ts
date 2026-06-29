import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";

import { firebaseAuth } from "@/lib/firebase/client";

export async function firebaseSignIn(email: string, password: string) {
  await signInWithEmailAndPassword(firebaseAuth, email, password);
}

export async function firebaseSignUp(email: string, password: string) {
  await createUserWithEmailAndPassword(firebaseAuth, email, password);
}

export async function firebaseSignInWithGoogle() {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(firebaseAuth, provider);
}

export async function firebaseSignOut() {
  await signOut(firebaseAuth);
}

export async function getFirebaseIdToken() {
  const user = firebaseAuth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

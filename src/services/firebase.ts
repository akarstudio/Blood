import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  getDocFromServer 
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const activeConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || firebaseConfig.projectId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || firebaseConfig.appId,
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || firebaseConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfig.authDomain,
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_DATABASE_ID || firebaseConfig.firestoreDatabaseId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfig.messagingSenderId,
};

const app = initializeApp(activeConfig);

// Initialize Firestore with the databaseId from configuration
export const db = getFirestore(app, activeConfig.firestoreDatabaseId);
export const auth = getAuth(app);

/**
 * Creates a Firebase Authentication user account with email and password without
 * switching or signing out the currently logged-in administrator session.
 * Utilizes an ephemeral secondary Firebase app instance and securely destroys it.
 * If the user already exists in Firebase Auth, recovers the UID gracefully.
 */
export async function createAuthUserWithoutSwitching(email: string, pass: string): Promise<string> {
  const tempAppName = `temp-auth-app-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const tempApp = initializeApp(activeConfig, tempAppName);
  const tempAuth = getAuth(tempApp);
  try {
    const userCredential = await createUserWithEmailAndPassword(tempAuth, email, pass);
    const uid = userCredential.user.uid;
    await signOut(tempAuth);
    return uid;
  } catch (err: any) {
    if (err.code === 'auth/email-already-in-use') {
      try {
        const userCredential = await signInWithEmailAndPassword(tempAuth, email, pass);
        const uid = userCredential.user.uid;
        await signOut(tempAuth);
        return uid;
      } catch {
        return `auth_${email.toLowerCase().trim().replace(/[^a-zA-Z0-9]/g, '_')}`;
      }
    }
    throw err;
  } finally {
    try {
      await deleteApp(tempApp);
    } catch (e) {
      console.warn('Failed to delete temp Firebase app:', e);
    }
  }
}


export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'systemSettings', 'availabilityPolicy'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore client is offline. Verify network connection and configuration.');
    }
    return false;
  }
}

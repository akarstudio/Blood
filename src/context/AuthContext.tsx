import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { 
  User, 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut as firebaseSignOut,
  signInWithPopup,
  GoogleAuthProvider,
  sendEmailVerification as firebaseSendEmailVerification,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  query, 
  where, 
  getDocs,
  updateDoc
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType, testConnection } from '../services/firebase';
import { UserProfile, Donor, Permission, AvailabilityPolicy } from '../types';
import { DEFAULT_ROLES } from '../data/rolesData';
import { normalizeEmail } from '../utils/validation';
import { syncRegisteredIdentifier } from '../services/dataSyncService';

interface AuthContextType {
  user: User | null;
  userProfile: UserProfile | null;
  donorProfile: Donor | null;
  permissions: Set<Permission>;
  hasPermission: (permission: Permission) => boolean;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isDonorManager: boolean;
  loading: boolean;
  signIn: (email: string, pass: string) => Promise<void>;
  signUp: (email: string, pass: string, displayName: string) => Promise<User>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  refreshProfiles: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const BOOTSTRAP_SUPER_ADMIN_EMAIL = 'abrar.noceng@gmail.com';

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [donorProfile, setDonorProfile] = useState<Donor | null>(null);
  const [permissions, setPermissions] = useState<Set<Permission>>(new Set());
  const [loading, setLoading] = useState(true);

  // Initialize system connection on startup
  useEffect(() => {
    async function initSystem() {
      try {
        await testConnection();
      } catch (err) {
        console.warn('System connection check notice:', err);
      }
    }
    initSystem();
  }, []);

  const loadUserData = async (currentUser: User) => {
    try {
      const userRef = doc(db, 'users', currentUser.uid);
      let userSnap = await getDoc(userRef);

      const isBootstrappedAdmin = normalizeEmail(currentUser.email || '') === normalizeEmail(BOOTSTRAP_SUPER_ADMIN_EMAIL);

      if (!userSnap.exists()) {
        const newProfile: UserProfile = {
          uid: currentUser.uid,
          email: currentUser.email || '',
          displayName: currentUser.displayName || (currentUser.email ? currentUser.email.split('@')[0] : 'User'),
          roleIds: isBootstrappedAdmin ? ['super_admin'] : ['viewer_auditor'],
          accountStatus: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
        };
        await setDoc(userRef, newProfile);
        setUserProfile(newProfile);
        computePermissions(newProfile.roleIds, isBootstrappedAdmin);
      } else {
        const data = userSnap.data() as UserProfile;
        // If bootstrapped admin and missing super_admin role, upgrade
        if (isBootstrappedAdmin && !data.roleIds.includes('super_admin')) {
          const updatedRoleIds = Array.from(new Set([...data.roleIds, 'super_admin']));
          await updateDoc(userRef, { roleIds: updatedRoleIds, updatedAt: new Date().toISOString() });
          data.roleIds = updatedRoleIds;
        }
        setUserProfile(data);
        computePermissions(data.roleIds, isBootstrappedAdmin);
      }

      if (currentUser.email) {
        try {
          await syncRegisteredIdentifier(db, currentUser.email, currentUser.uid);
        } catch (idErr) {
          console.warn('Sync identifier notice:', idErr);
        }
      }

      if (isBootstrappedAdmin) {
        try {
          const allUsersSnap = await getDocs(collection(db, 'users'));
          allUsersSnap.forEach((uDoc) => {
            const uData = uDoc.data();
            if (uData.email) {
              syncRegisteredIdentifier(db, uData.email, uDoc.id).catch(() => {});
            }
          });
        } catch {
          // background sync
        }

        try {
          const policyRef = doc(db, 'systemSettings', 'availabilityPolicy');
          const policySnap = await getDoc(policyRef);
          if (!policySnap.exists()) {
            const initialPolicy: AvailabilityPolicy = {
              minimumIntervalMonths: 3,
              policyVersion: 1,
              updatedAt: new Date().toISOString(),
              updatedBy: currentUser.uid,
              updatedByEmail: currentUser.email || 'abrar.noceng@gmail.com'
            };
            await setDoc(policyRef, initialPolicy);
          }
        } catch (policyErr) {
          console.warn('Admin policy init check notice:', policyErr);
        }
      }

      // Check if this user has a linked donor record
      try {
        const directDonorSnap = await getDoc(doc(db, 'donors', currentUser.uid));
        if (directDonorSnap.exists()) {
          setDonorProfile({ id: directDonorSnap.id, ...directDonorSnap.data() } as Donor);
        } else {
          const donorQ = query(collection(db, 'donors'), where('uid', '==', currentUser.uid));
          const donorSnaps = await getDocs(donorQ);
          if (!donorSnaps.empty) {
            const firstDoc = donorSnaps.docs[0];
            setDonorProfile({ id: firstDoc.id, ...firstDoc.data() } as Donor);
          } else {
            setDonorProfile(null);
          }
        }
      } catch (e) {
        console.warn('Donor profile lookup notice:', e);
      }
    } catch (error) {
      console.error('Error loading user data:', error);
    }
  };

  const computePermissions = (roleIds: string[], isBootstrapped: boolean) => {
    const permSet = new Set<Permission>();
    if (isBootstrapped || roleIds.includes('super_admin')) {
      const superRole = DEFAULT_ROLES.find(r => r.id === 'super_admin');
      superRole?.permissions.forEach(p => permSet.add(p));
    } else {
      roleIds.forEach(roleId => {
        const roleDef = DEFAULT_ROLES.find(r => r.id === roleId);
        roleDef?.permissions.forEach(p => permSet.add(p));
      });
    }
    setPermissions(permSet);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        await loadUserData(currentUser);
      } else {
        setUserProfile(null);
        setDonorProfile(null);
        setPermissions(new Set());
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const refreshProfiles = async () => {
    if (user) {
      await loadUserData(user);
    }
  };

  const signUp = async (email: string, pass: string, displayName: string): Promise<User> => {
    const cleanEmail = normalizeEmail(email);
    const cred = await createUserWithEmailAndPassword(auth, cleanEmail, pass);
    const isBootstrappedAdmin = cleanEmail === normalizeEmail(BOOTSTRAP_SUPER_ADMIN_EMAIL);
    const newProfile: UserProfile = {
      uid: cred.user.uid,
      email: cred.user.email || cleanEmail,
      displayName: displayName || cleanEmail.split('@')[0],
      roleIds: isBootstrappedAdmin ? ['super_admin'] : ['viewer_auditor'],
      accountStatus: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'users', cred.user.uid), newProfile);
    try {
      await syncRegisteredIdentifier(db, cleanEmail, cred.user.uid);
    } catch (e) {
      console.warn('Sync identifier on signUp notice:', e);
    }
    setUserProfile(newProfile);
    computePermissions(newProfile.roleIds, isBootstrappedAdmin);
    return cred.user;
  };

  const signIn = async (email: string, pass: string) => {
    const cleanEmail = normalizeEmail(email);
    await signInWithEmailAndPassword(auth, cleanEmail, pass);
  };

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setUser(null);
    setUserProfile(null);
    setDonorProfile(null);
    setPermissions(new Set());
  };

  const sendVerificationEmail = async () => {
    if (!auth.currentUser) throw new Error('No authenticated user found.');
    await firebaseSendEmailVerification(auth.currentUser);
  };

  const sendPasswordReset = async (email: string): Promise<void> => {
    await firebaseSendPasswordResetEmail(auth, normalizeEmail(email));
  };

  const hasPermission = (permission: Permission): boolean => {
    return permissions.has(permission);
  };

  const isSuperAdmin = permissions.has('users.manage_roles') || (userProfile?.roleIds.includes('super_admin') ?? false);
  const isAdmin = isSuperAdmin || (userProfile?.roleIds.includes('admin') ?? false);
  const isDonorManager = isAdmin || (userProfile?.roleIds.includes('donor_manager') ?? false);

  return (
    <AuthContext.Provider
      value={{
        user,
        userProfile,
        donorProfile,
        permissions,
        hasPermission,
        isSuperAdmin,
        isAdmin,
        isDonorManager,
        loading,
        signIn,
        signUp,
        signInWithGoogle,
        signOut,
        sendVerificationEmail,
        sendPasswordReset,
        refreshProfiles,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

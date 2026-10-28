import { 
  Firestore, 
  doc, 
  getDoc, 
  writeBatch, 
  collection, 
  query, 
  where, 
  getDocs,
  setDoc
} from 'firebase/firestore';
import { Donor, UserProfile, BloodGroup, ApprovalStatus, ContactVerificationStatus, AccountStatus, AvailabilityStatus, PreferredContactMethod, ContactVisibilityPreference } from '../types';
import { logAuditEvent } from '../utils/audit';
import { normalizeBangladeshPhone } from '../utils/validation';
import { calculateDonorAvailability } from '../utils/availability';
import { limit } from 'firebase/firestore';

/**
 * Recursively strips any `undefined` values from an object before Firestore writes.
 * Firestore strictly rejects documents or updates containing `undefined`.
 */
export function cleanForFirestore<T extends Record<string, any>>(obj: T): T {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) {
      continue;
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      cleaned[key] = cleanForFirestore(value);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned as T;
}

/**
 * Atomically creates or replaces a donor profile along with its unique phone index mapping.
 */
export async function storeDonorWithPhoneIndex(
  db: Firestore,
  donorDocData: Record<string, any>,
  uid: string,
  normalizedPhone: string,
  actor?: { uid: string; email?: string }
): Promise<void> {
  const batch = writeBatch(db);
  const nowIso = new Date().toISOString();

  const sanitizedDonor: Record<string, any> = cleanForFirestore({
    ...donorDocData,
    uid,
    updatedAt: nowIso,
  });

  const donorRef = doc(db, 'donors', uid);
  batch.set(donorRef, sanitizedDonor);

  // Store protected contact record in donorContacts (restricted to authorized donors and staff by rules)
  const contactRef = doc(db, 'donorContacts', uid);
  batch.set(contactRef, {
    donorId: uid,
    phone: normalizedPhone,
    normalizedPhone,
    email: sanitizedDonor.email ? sanitizedDonor.email.toLowerCase().trim() : (actor?.email?.toLowerCase().trim() || ''),
    createdAt: donorDocData.createdAt || nowIso,
    updatedAt: nowIso,
  });

  const phoneRef = doc(db, 'registeredPhones', normalizedPhone);
  batch.set(phoneRef, {
    uid,
    phone: normalizedPhone,
    email: sanitizedDonor.email ? sanitizedDonor.email.toLowerCase().trim() : (actor?.email?.toLowerCase().trim() || ''),
    createdAt: donorDocData.createdAt || nowIso,
    updatedAt: nowIso,
  });

  const identifierEmail = (sanitizedDonor.email || actor?.email || '').toLowerCase().trim();
  if (identifierEmail) {
    const idRef = doc(db, 'registeredIdentifiers', emailToIdentifierDocId(identifierEmail));
    batch.set(idRef, {
      email: identifierEmail,
      uid,
      exists: true,
      updatedAt: nowIso,
    }, { merge: true });
  }

  await batch.commit();

  if (actor) {
    try {
      await logAuditEvent({
        actorUid: actor.uid,
        actorEmail: actor.email,
        action: 'donor.create',
        entityType: 'donor',
        entityId: uid,
        newValues: {
          fullName: sanitizedDonor.fullName,
          email: sanitizedDonor.email,
          phone: normalizedPhone,
          bloodGroup: sanitizedDonor.bloodGroup,
          division: sanitizedDonor.division,
          district: sanitizedDonor.district,
        },
        outcome: 'success',
      });
    } catch (auditErr) {
      console.warn('Audit log write notice:', auditErr);
    }
  }
}

/**
 * Atomically updates a donor profile, properly handling phone index migration if the phone number changed.
 */
export async function updateDonorWithPhoneSync(
  db: Firestore,
  donorId: string,
  updates: Record<string, any>,
  oldPhone?: string,
  newPhone?: string,
  actor?: { uid: string; email?: string }
): Promise<void> {
  const batch = writeBatch(db);
  const nowIso = new Date().toISOString();

  const sanitizedUpdates: Record<string, any> = cleanForFirestore({
    ...updates,
    updatedAt: nowIso,
  });

  const donorRef = doc(db, 'donors', donorId);
  batch.update(donorRef, sanitizedUpdates);

  // Sync donorContacts if phone or email updated
  const contactUpdates: Record<string, any> = { updatedAt: nowIso };
  if (newPhone) {
    contactUpdates.phone = newPhone;
    contactUpdates.normalizedPhone = newPhone;
  }
  if (sanitizedUpdates.email) {
    contactUpdates.email = String(sanitizedUpdates.email).toLowerCase().trim();
  }
  const contactRef = doc(db, 'donorContacts', donorId);
  batch.set(contactRef, { donorId, ...contactUpdates }, { merge: true });

  if (oldPhone && newPhone && oldPhone !== newPhone) {
    const oldPhoneRef = doc(db, 'registeredPhones', oldPhone);
    const newPhoneRef = doc(db, 'registeredPhones', newPhone);

    const emailValue = sanitizedUpdates.email
      ? String(sanitizedUpdates.email).toLowerCase().trim()
      : (actor?.email ? String(actor.email).toLowerCase().trim() : '');

    batch.delete(oldPhoneRef);
    batch.set(newPhoneRef, {
      uid: donorId,
      phone: newPhone,
      email: emailValue,
      updatedAt: nowIso,
    });
  }

  await batch.commit();

  if (actor) {
    try {
      await logAuditEvent({
        actorUid: actor.uid,
        actorEmail: actor.email,
        action: 'donor.update',
        entityType: 'donor',
        entityId: donorId,
        newValues: sanitizedUpdates,
        outcome: 'success',
      });
    } catch (auditErr) {
      console.warn('Audit log write notice:', auditErr);
    }
  }
}

/**
 * Atomically deletes a donor profile and its associated phone lookup mapping.
 * Writes an immutable audit trail entry preserving the previous values for accountability.
 */
export async function deleteDonorSafely(
  db: Firestore,
  donorId: string,
  actor: { uid: string; email?: string },
  reason?: string,
  options?: { cascadeDeleteUser?: boolean }
): Promise<{ success: boolean; donor?: Donor }> {
  // 1. Fetch current donor record to ensure it exists and get phone number & email
  const donorRef = doc(db, 'donors', donorId);
  const donorSnap = await getDoc(donorRef);

  if (!donorSnap.exists()) {
    throw new Error(`Donor with ID ${donorId} does not exist or has already been removed.`);
  }

  const donorData = donorSnap.data() as Donor;
  const batch = writeBatch(db);

  // 2. Queue donor deletion in Firebase Firestore
  batch.delete(donorRef);
  batch.delete(doc(db, 'donorContacts', donorId));

  // 3. Queue registered phone lookup deletion in Firebase if phone is indexed
  const phoneToDelete = donorData.normalizedPhone || donorData.phone;
  if (phoneToDelete) {
    const phoneRef = doc(db, 'registeredPhones', phoneToDelete);
    batch.delete(phoneRef);
  }

  // 4. Queue registered identifier lookup deletion in Firebase
  if (donorData.email) {
    const idDocId = emailToIdentifierDocId(donorData.email);
    batch.delete(doc(db, 'registeredIdentifiers', idDocId));
  }
  if (donorData.normalizedEmail && donorData.normalizedEmail !== donorData.email.toLowerCase().trim()) {
    const normIdDocId = emailToIdentifierDocId(donorData.normalizedEmail);
    batch.delete(doc(db, 'registeredIdentifiers', normIdDocId));
  }

  // 5. If cascadeDeleteUser is true or linked account exists, remove user profile doc (except protected admin)
  const targetUid = donorData.uid || donorId;
  if (options?.cascadeDeleteUser && targetUid) {
    const userRef = doc(db, 'users', targetUid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      const uData = userSnap.data() as UserProfile;
      if (!uData.email || uData.email.toLowerCase() !== 'abrar.noceng@gmail.com') {
        batch.delete(userRef);
      }
    }
  }

  // 6. Atomically commit deletions to Firebase Firestore
  await batch.commit();

  // 7. Record immutable audit log
  try {
    await logAuditEvent({
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: actor.uid === donorId ? 'donor.self_delete' : 'donor.delete',
      entityType: 'donor',
      entityId: donorId,
      previousValues: {
        fullName: donorData.fullName,
        email: donorData.email,
        phone: donorData.phone,
        bloodGroup: donorData.bloodGroup,
        division: donorData.division,
        district: donorData.district,
        approvalStatus: donorData.approvalStatus,
        accountStatus: donorData.accountStatus,
      },
      reason: reason || (actor.uid === donorId ? 'User self-requested profile removal' : 'Administrative deletion'),
      outcome: 'success',
    });
  } catch (auditErr) {
    console.warn('Audit trail logging notice during donor delete:', auditErr);
  }

  return { success: true, donor: donorData };
}

/**
 * Safely deletes a user account from Firestore.
 * Prevents accidental lockout of oneself or the primary bootstrapped administrator.
 * Cascades deletion to any linked donor record, registered phone mapping, and registered identifier.
 */
export async function deleteUserSafely(
  db: Firestore,
  userId: string,
  actor: { uid: string; email?: string },
  options?: { cascadeDeleteDonor?: boolean; reason?: string }
): Promise<{ success: boolean; deletedDonorId?: string }> {
  if (userId === actor.uid) {
    throw new Error('Self-deletion prevention: You cannot delete your own administrative user account.');
  }

  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    throw new Error(`User account with ID ${userId} does not exist.`);
  }

  const userData = userSnap.data() as UserProfile;
  if (userData.email && userData.email.toLowerCase() === 'abrar.noceng@gmail.com') {
    throw new Error('Protected Account: The primary bootstrapped Super Administrator cannot be deleted.');
  }

  const batch = writeBatch(db);
  batch.delete(userRef);

  // Clean registered identifier in Firebase
  if (userData.email) {
    const idDocId = emailToIdentifierDocId(userData.email);
    batch.delete(doc(db, 'registeredIdentifiers', idDocId));
  }

  // Clean registered phone in Firebase
  const userPhone = userData.normalizedPhone || userData.phone;
  if (userPhone) {
    batch.delete(doc(db, 'registeredPhones', userPhone));
  }

  let deletedDonorId: string | undefined;

  if (options?.cascadeDeleteDonor !== false) {
    // Check if donor doc exists with userId
    const donorRef = doc(db, 'donors', userId);
    const donorSnap = await getDoc(donorRef);

    if (donorSnap.exists()) {
      deletedDonorId = userId;
      batch.delete(donorRef);
      const donorData = donorSnap.data() as Donor;
      const phone = donorData.normalizedPhone || donorData.phone;
      if (phone) {
        batch.delete(doc(db, 'registeredPhones', phone));
      }
      if (donorData.email) {
        batch.delete(doc(db, 'registeredIdentifiers', emailToIdentifierDocId(donorData.email)));
      }
    } else {
      // Check if donor doc is linked via uid field
      const donorQ = query(collection(db, 'donors'), where('uid', '==', userId));
      const qSnap = await getDocs(donorQ);
      if (!qSnap.empty) {
        const dDoc = qSnap.docs[0];
        deletedDonorId = dDoc.id;
        batch.delete(dDoc.ref);
        const donorData = dDoc.data() as Donor;
        const phone = donorData.normalizedPhone || donorData.phone;
        if (phone) {
          batch.delete(doc(db, 'registeredPhones', phone));
        }
        if (donorData.email) {
          batch.delete(doc(db, 'registeredIdentifiers', emailToIdentifierDocId(donorData.email)));
        }
      }
    }
  }

  await batch.commit();

  try {
    await logAuditEvent({
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: 'user.delete',
      entityType: 'user',
      entityId: userId,
      previousValues: {
        email: userData.email,
        displayName: userData.displayName,
        roleIds: userData.roleIds,
        accountStatus: userData.accountStatus,
        cascadedDonorDeleted: !!deletedDonorId,
      },
      reason: options?.reason || 'Administrative removal of user account',
      outcome: 'success',
    });
  } catch (auditErr) {
    console.warn('Audit trail logging notice during user delete:', auditErr);
  }

  return { success: true, deletedDonorId };
}

/**
 * Atomically deletes multiple donor profiles and all their associated phone mappings and identifiers in Firebase Firestore.
 */
export async function deleteMultipleDonorsSafely(
  db: Firestore,
  donorIds: string[],
  actor: { uid: string; email?: string },
  reason?: string
): Promise<{ total: number; deleted: number }> {
  if (!donorIds || donorIds.length === 0) return { total: 0, deleted: 0 };

  let deleted = 0;
  const chunkSize = 100;
  for (let i = 0; i < donorIds.length; i += chunkSize) {
    const chunk = donorIds.slice(i, i + chunkSize);
    const batch = writeBatch(db);

    for (const dId of chunk) {
      const donorRef = doc(db, 'donors', dId);
      const donorSnap = await getDoc(donorRef);
      if (donorSnap.exists()) {
        const dData = donorSnap.data() as Donor;
        if (dData.email && dData.email.toLowerCase().trim() === 'abrar.noceng@gmail.com') {
          continue; // Protected Super Admin
        }
        batch.delete(donorRef);
        batch.delete(doc(db, 'donorContacts', dId));
        const phone = dData.normalizedPhone || dData.phone;
        if (phone) {
          batch.delete(doc(db, 'registeredPhones', phone));
        }
        if (dData.email) {
          batch.delete(doc(db, 'registeredIdentifiers', emailToIdentifierDocId(dData.email)));
        }
        if (dData.normalizedEmail) {
          batch.delete(doc(db, 'registeredIdentifiers', emailToIdentifierDocId(dData.normalizedEmail)));
        }
        deleted++;
      }
    }

    await batch.commit();
  }

  try {
    await logAuditEvent({
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: 'donor.bulk_delete',
      entityType: 'donor',
      entityId: 'multiple',
      newValues: { count: deleted, donorIds },
      reason: reason || 'Administrative bulk deletion',
      outcome: 'success',
    });
  } catch (auditErr) {
    console.warn('Audit log notice:', auditErr);
  }

  return { total: donorIds.length, deleted };
}

/**
 * Atomically deletes multiple user accounts and all their linked profiles and identifiers in Firebase Firestore.
 */
export async function deleteMultipleUsersSafely(
  db: Firestore,
  userIds: string[],
  actor: { uid: string; email?: string },
  reason?: string
): Promise<{ total: number; deleted: number; protectedSkipped: number }> {
  if (!userIds || userIds.length === 0) return { total: 0, deleted: 0, protectedSkipped: 0 };

  let deleted = 0;
  let protectedSkipped = 0;

  for (const uId of userIds) {
    if (uId === actor.uid) {
      protectedSkipped++;
      continue;
    }

    try {
      const res = await deleteUserSafely(db, uId, actor, { cascadeDeleteDonor: true, reason });
      if (res.success) deleted++;
    } catch (e) {
      console.warn(`Could not delete user ${uId}:`, e);
      protectedSkipped++;
    }
  }

  return { total: userIds.length, deleted, protectedSkipped };
}

/**
 * Purges all non-admin donors, users, registered phones, and registered identifiers from Firebase Firestore.
 * Strictly preserves the primary bootstrapped Super Administrator account (abrar.noceng@gmail.com).
 */
export async function purgeAllNonAdminData(
  db: Firestore,
  actor: { uid: string; email?: string }
): Promise<{ deletedDonors: number; deletedUsers: number; deletedPhones: number; deletedIdentifiers: number }> {
  // 1. Fetch donors
  const donorsSnap = await getDocs(collection(db, 'donors'));
  // 2. Fetch users
  const usersSnap = await getDocs(collection(db, 'users'));
  // 3. Fetch phones
  const phonesSnap = await getDocs(collection(db, 'registeredPhones'));
  // 4. Fetch identifiers
  const identifiersSnap = await getDocs(collection(db, 'registeredIdentifiers'));

  let deletedDonors = 0;
  let deletedUsers = 0;
  let deletedPhones = 0;
  let deletedIdentifiers = 0;

  const actorEmailLower = actor.email ? actor.email.toLowerCase().trim() : '';

  // Delete non-admin donors (preserve abrar.noceng@gmail.com and active actor)
  const donorDocs = donorsSnap.docs;
  for (let i = 0; i < donorDocs.length; i += 200) {
    const chunk = donorDocs.slice(i, i + 200);
    const batch = writeBatch(db);
    chunk.forEach(d => {
      const dData = d.data() as Donor;
      const dEmail = dData.email ? dData.email.toLowerCase().trim() : '';
      if (dEmail === 'abrar.noceng@gmail.com') return;
      if (d.id === actor.uid || (actorEmailLower && dEmail === actorEmailLower)) return;
      batch.delete(d.ref);
      deletedDonors++;
    });
    await batch.commit();
  }

  // Delete phones not belonging to super admin or actor
  const phoneDocs = phonesSnap.docs;
  for (let i = 0; i < phoneDocs.length; i += 200) {
    const chunk = phoneDocs.slice(i, i + 200);
    const batch = writeBatch(db);
    chunk.forEach(p => {
      const pData = p.data();
      const pEmail = pData?.email ? String(pData.email).toLowerCase().trim() : '';
      if (pEmail === 'abrar.noceng@gmail.com' || (actorEmailLower && pEmail === actorEmailLower)) return;
      if (pData?.uid === actor.uid) return;
      batch.delete(p.ref);
      deletedPhones++;
    });
    await batch.commit();
  }

  // Delete identifiers (strictly preserve abrar.noceng@gmail.com and actor)
  const idDocs = identifiersSnap.docs;
  for (let i = 0; i < idDocs.length; i += 200) {
    const chunk = idDocs.slice(i, i + 200);
    const batch = writeBatch(db);
    chunk.forEach(docSnap => {
      const dEmail = docSnap.data()?.email?.toLowerCase()?.trim();
      if (dEmail === 'abrar.noceng@gmail.com' || (actorEmailLower && dEmail === actorEmailLower)) {
        return;
      }
      batch.delete(docSnap.ref);
      deletedIdentifiers++;
    });
    await batch.commit();
  }

  // Delete non-admin users (strictly preserve abrar.noceng@gmail.com and active actor)
  const userDocs = usersSnap.docs;
  for (let i = 0; i < userDocs.length; i += 200) {
    const chunk = userDocs.slice(i, i + 200);
    const batch = writeBatch(db);
    chunk.forEach(uDoc => {
      const uData = uDoc.data() as UserProfile;
      const uEmail = uData.email ? uData.email.toLowerCase().trim() : '';
      if (uEmail === 'abrar.noceng@gmail.com' || uDoc.id === actor.uid || (actorEmailLower && uEmail === actorEmailLower)) {
        return; // Protected
      }
      batch.delete(uDoc.ref);
      deletedUsers++;
    });
    await batch.commit();
  }

  try {
    await logAuditEvent({
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: 'system.purge_non_admin_data',
      entityType: 'settings',
      entityId: 'database_purge',
      newValues: { deletedDonors, deletedUsers, deletedPhones, deletedIdentifiers },
      reason: 'Administrator requested complete database purge of all non-admin data',
      outcome: 'success',
    });
  } catch (auditErr) {
    console.warn('Audit log notice:', auditErr);
  }

  return { deletedDonors, deletedUsers, deletedPhones, deletedIdentifiers };
}

/**
 * Fast lookup of the registered user account email associated with a Bangladesh phone number.
 * Searches registeredPhones index, with fallback to users or donors collection if needed.
 */
export async function lookupEmailByPhone(db: Firestore, rawPhone: string): Promise<string | null> {
  const normalizedPhone = normalizeBangladeshPhone(rawPhone);
  if (!normalizedPhone) return null;

  try {
    const phoneRef = doc(db, 'registeredPhones', normalizedPhone);
    const phoneSnap = await getDoc(phoneRef);
    if (phoneSnap.exists()) {
      const pData = phoneSnap.data();
      if (pData?.email) {
        return pData.email.toLowerCase().trim();
      }
      if (pData?.uid) {
        try {
          const userSnap = await getDoc(doc(db, 'users', pData.uid));
          if (userSnap.exists() && userSnap.data()?.email) {
            return userSnap.data().email.toLowerCase().trim();
          }
        } catch {
          // fallback
        }
        try {
          const donorSnap = await getDoc(doc(db, 'donors', pData.uid));
          if (donorSnap.exists() && donorSnap.data()?.email) {
            return donorSnap.data().email.toLowerCase().trim();
          }
        } catch {
          // fallback
        }
      }
    }
  } catch (err) {
    console.warn('Phone index lookup error:', err);
  }

  // Secondary fallback: query donors collection directly by phone
  try {
    const donorQ = query(collection(db, 'donors'), where('phone', '==', normalizedPhone));
    const donorSnaps = await getDocs(donorQ);
    if (!donorSnaps.empty) {
      const donorData = donorSnaps.docs[0].data();
      if (donorData.email) {
        return donorData.email.toLowerCase().trim();
      }
    }
  } catch {
    // query fallback
  }

  return null;
}

/**
 * Registers a phone number into the fast lookup index for a user.
 */
export async function registerUserPhone(
  db: Firestore,
  uid: string,
  rawPhone: string,
  email: string
): Promise<void> {
  const normalizedPhone = normalizeBangladeshPhone(rawPhone);
  if (!normalizedPhone) return;

  const phoneRef = doc(db, 'registeredPhones', normalizedPhone);
  const nowIso = new Date().toISOString();
  await setDoc(phoneRef, {
    uid,
    phone: normalizedPhone,
    email: email.toLowerCase().trim(),
    createdAt: nowIso,
    updatedAt: nowIso,
  }, { merge: true });
}

/**
 * Converts an email address to a safe Firestore document ID for registeredIdentifiers collection.
 */
export function emailToIdentifierDocId(email: string): string {
  return email.toLowerCase().trim().replace(/[/\\#?]/g, '_');
}

/**
 * Checks whether an email matches an Identifier in the registeredIdentifiers lookup index.
 */
export async function checkEmailIdentifierExists(db: Firestore, email: string): Promise<boolean> {
  const cleanEmail = email.toLowerCase().trim();
  if (!cleanEmail) return false;

  // Bootstrapped Super Admin always matches
  if (cleanEmail === 'abrar.noceng@gmail.com') return true;

  try {
    const docId = emailToIdentifierDocId(cleanEmail);
    const idRef = doc(db, 'registeredIdentifiers', docId);
    const snap = await getDoc(idRef);
    if (snap.exists() && snap.data()?.exists) {
      return true;
    }
  } catch (e) {
    console.warn('Identifier lookup check notice:', e);
  }

  return false;
}

/**
 * Registers/syncs an email address into the registeredIdentifiers index.
 */
export async function syncRegisteredIdentifier(
  db: Firestore,
  email: string,
  uid?: string
): Promise<void> {
  const cleanEmail = email.toLowerCase().trim();
  if (!cleanEmail) return;

  const docId = emailToIdentifierDocId(cleanEmail);
  const idRef = doc(db, 'registeredIdentifiers', docId);
  const nowIso = new Date().toISOString();

  await setDoc(idRef, {
    email: cleanEmail,
    uid: uid || '',
    exists: true,
    updatedAt: nowIso,
  }, { merge: true });
}

/**
 * Synchronizes a user account into the donors collection so they also appear in Find Donors.
 * If a donor record already exists with this uid or email, it merges fields.
 * If not, it creates a new approved and verified donor record with valid defaults.
 */
export async function syncUserToDonor(
  db: Firestore,
  userProfile: {
    uid: string;
    email: string;
    displayName: string;
    phone?: string;
    bloodGroup?: BloodGroup;
    division?: string;
    district?: string;
    upazila?: string;
    gender?: 'male' | 'female' | 'other' | 'unspecified';
    dateOfBirth?: string;
    lastDonationDate?: string;
    approvalStatus?: ApprovalStatus;
    contactVerificationStatus?: ContactVerificationStatus;
    accountStatus?: AccountStatus;
    declaredAvailability?: AvailabilityStatus;
    preferredContactMethod?: PreferredContactMethod;
    contactVisibilityPreference?: ContactVisibilityPreference;
    additionalNotes?: string;
  },
  actor?: { uid: string; email?: string }
): Promise<string> {
  const normEmail = userProfile.email.toLowerCase().trim();
  const rawNormPhone = userProfile.phone ? normalizeBangladeshPhone(userProfile.phone) || userProfile.phone : '01700000000';
  const nowIso = new Date().toISOString();

  // Check if donor doc exists under uid
  const donorDocRef = doc(db, 'donors', userProfile.uid);
  const existingSnap = await getDoc(donorDocRef);

  let existingDonorData: Partial<Donor> = {};
  if (existingSnap.exists()) {
    existingDonorData = existingSnap.data() as Donor;
  } else {
    // Also check if donor exists by email
    const emailQ = query(collection(db, 'donors'), where('normalizedEmail', '==', normEmail), limit(1));
    const emailSnap = await getDocs(emailQ);
    if (!emailSnap.empty) {
      existingDonorData = emailSnap.docs[0].data() as Donor;
    }
  }

  const bloodGroup: BloodGroup = userProfile.bloodGroup || (existingDonorData.bloodGroup as BloodGroup) || 'O+';
  const division = userProfile.division || existingDonorData.division || 'Dhaka';
  const district = userProfile.district || existingDonorData.district || 'Dhaka';
  const upazila = userProfile.upazila || existingDonorData.upazila || 'Sadar';
  const approvalStatus: ApprovalStatus = userProfile.approvalStatus || (existingDonorData.approvalStatus as ApprovalStatus) || 'approved';
  const contactVerificationStatus: ContactVerificationStatus = userProfile.contactVerificationStatus || (existingDonorData.contactVerificationStatus as ContactVerificationStatus) || 'verified';
  const accountStatus: AccountStatus = userProfile.accountStatus || (existingDonorData.accountStatus as AccountStatus) || 'active';
  const declaredAvailability: AvailabilityStatus = userProfile.declaredAvailability || (existingDonorData.declaredAvailability as AvailabilityStatus) || 'available';
  const lastDonationDate = userProfile.lastDonationDate || existingDonorData.lastDonationDate || '';

  const calcResult = calculateDonorAvailability({
    approvalStatus,
    contactVerificationStatus,
    accountStatus,
    declaredAvailability,
    lastDonationDate: lastDonationDate || undefined,
  }, 3);

  const donorDocData = cleanForFirestore({
    id: userProfile.uid,
    uid: userProfile.uid,
    fullName: userProfile.displayName || existingDonorData.fullName || normEmail.split('@')[0],
    normalizedName: (userProfile.displayName || existingDonorData.fullName || normEmail.split('@')[0]).toLowerCase(),
    email: normEmail,
    normalizedEmail: normEmail,
    phone: userProfile.phone || existingDonorData.phone || rawNormPhone,
    normalizedPhone: rawNormPhone,
    bloodGroup,
    division,
    district,
    upazila,
    gender: userProfile.gender || existingDonorData.gender || 'unspecified',
    dateOfBirth: userProfile.dateOfBirth || existingDonorData.dateOfBirth || '',
    lastDonationDate,
    eligibilityDate: calcResult.eligibilityDate || '',
    declaredAvailability,
    calculatedAvailability: calcResult.calculatedAvailability,
    contactVerificationStatus,
    approvalStatus,
    accountStatus,
    publicContactConsent: true,
    publicProfileConsent: true,
    contactVisibilityPreference: userProfile.contactVisibilityPreference || existingDonorData.contactVisibilityPreference || 'public',
    preferredContactMethod: userProfile.preferredContactMethod || existingDonorData.preferredContactMethod || 'phone',
    additionalNotes: userProfile.additionalNotes || existingDonorData.additionalNotes || '',
    privacyConsentVersion: '1.0',
    privacyConsentAt: existingDonorData.privacyConsentAt || nowIso,
    approvedBy: actor?.uid || 'system_admin',
    approvedAt: existingDonorData.approvedAt || nowIso,
    createdAt: existingDonorData.createdAt || nowIso,
    updatedAt: nowIso,
  });

  await setDoc(donorDocRef, donorDocData, { merge: true });

  if (rawNormPhone && rawNormPhone !== '01700000000') {
    try {
      await registerUserPhone(db, userProfile.uid, rawNormPhone, normEmail);
    } catch (e) {
      console.warn('Phone registration notice:', e);
    }
  }

  await syncRegisteredIdentifier(db, normEmail, userProfile.uid);

  return userProfile.uid;
}

/**
 * Scans all existing users in the users collection and creates a matching donor
 * record for anyone who doesn't yet have one, ensuring they appear in Find Donors.
 */
export async function syncAllUsersToDonors(
  db: Firestore,
  actor?: { uid: string; email?: string }
): Promise<{ total: number; synced: number; alreadyExisted: number }> {
  const usersSnap = await getDocs(collection(db, 'users'));
  const donorsSnap = await getDocs(collection(db, 'donors'));

  const existingDonorUids = new Set<string>();
  const existingDonorEmails = new Set<string>();

  donorsSnap.forEach(d => {
    existingDonorUids.add(d.id);
    const data = d.data();
    if (data.uid) existingDonorUids.add(data.uid);
    if (data.normalizedEmail) existingDonorEmails.add(data.normalizedEmail);
    if (data.email) existingDonorEmails.add(data.email.toLowerCase().trim());
  });

  let synced = 0;
  let alreadyExisted = 0;

  for (const uDoc of usersSnap.docs) {
    const uData = uDoc.data() as UserProfile;
    const uid = uDoc.id;
    const email = uData.email?.toLowerCase().trim();

    if (existingDonorUids.has(uid) || (email && existingDonorEmails.has(email))) {
      alreadyExisted++;
      continue;
    }

    await syncUserToDonor(db, {
      uid,
      email: uData.email || `${uid}@demo.local`,
      displayName: uData.displayName || (uData.email ? uData.email.split('@')[0] : 'User'),
      phone: uData.phone || undefined,
      accountStatus: uData.accountStatus || 'active',
      approvalStatus: 'approved',
      contactVerificationStatus: 'verified',
    }, actor);

    synced++;
  }

  return { total: usersSnap.size, synced, alreadyExisted };
}

/**
 * Authoritatively fetches private contact details (phone, email) for an approved voluntary donor.
 * Governed strictly by Firestore Security Rules: only authenticated users with an approved active donor profile
 * or authorized staff can access donorContacts. Anonymous visitors or unapproved accounts receive permission denied.
 */
export async function fetchDonorContact(
  db: Firestore,
  donorId: string
): Promise<{ phone: string; email: string } | null> {
  try {
    const contactRef = doc(db, 'donorContacts', donorId);
    const snap = await getDoc(contactRef);
    if (snap.exists()) {
      const data = snap.data();
      return {
        phone: data.phone || data.normalizedPhone || '',
        email: data.email || '',
      };
    }

    // Fallback: Check donor doc directly (for authorized users and staff)
    const donorRef = doc(db, 'donors', donorId);
    const donorSnap = await getDoc(donorRef);
    if (donorSnap.exists()) {
      const dData = donorSnap.data();
      if (dData.phone) {
        return {
          phone: dData.phone || dData.normalizedPhone || '',
          email: dData.email || '',
        };
      }
    }

    return null;
  } catch (err: any) {
    throw err;
  }
}



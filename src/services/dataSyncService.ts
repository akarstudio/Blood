import { 
  Firestore, 
  doc, 
  getDoc, 
  writeBatch, 
  collection, 
  query, 
  where, 
  getDocs 
} from 'firebase/firestore';
import { Donor, UserProfile } from '../types';
import { logAuditEvent } from '../utils/audit';

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

  const phoneRef = doc(db, 'registeredPhones', normalizedPhone);
  batch.set(phoneRef, {
    uid,
    phone: normalizedPhone,
    createdAt: donorDocData.createdAt || nowIso,
    updatedAt: nowIso,
  });

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

  const sanitizedUpdates = cleanForFirestore({
    ...updates,
    updatedAt: nowIso,
  });

  const donorRef = doc(db, 'donors', donorId);
  batch.update(donorRef, sanitizedUpdates);

  if (oldPhone && newPhone && oldPhone !== newPhone) {
    const oldPhoneRef = doc(db, 'registeredPhones', oldPhone);
    const newPhoneRef = doc(db, 'registeredPhones', newPhone);

    batch.delete(oldPhoneRef);
    batch.set(newPhoneRef, {
      uid: donorId,
      phone: newPhone,
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
  reason?: string
): Promise<{ success: boolean; donor?: Donor }> {
  // 1. Fetch current donor record to ensure it exists and get phone number
  const donorRef = doc(db, 'donors', donorId);
  const donorSnap = await getDoc(donorRef);

  if (!donorSnap.exists()) {
    throw new Error(`Donor with ID ${donorId} does not exist or has already been removed.`);
  }

  const donorData = donorSnap.data() as Donor;
  const batch = writeBatch(db);

  // 2. Queue donor deletion
  batch.delete(donorRef);

  // 3. Queue registered phone lookup deletion if phone is indexed
  const phoneToDelete = donorData.normalizedPhone || donorData.phone;
  if (phoneToDelete) {
    const phoneRef = doc(db, 'registeredPhones', phoneToDelete);
    batch.delete(phoneRef);
  }

  // 4. Atomically commit deletions
  await batch.commit();

  // 5. Record immutable audit log
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
 * Optionally cascades deletion to any linked donor record and registered phone mapping.
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

  let deletedDonorId: string | undefined;

  if (options?.cascadeDeleteDonor) {
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

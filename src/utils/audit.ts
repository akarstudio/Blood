import { collection, addDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../services/firebase';
import { AuditLog } from '../types';

export async function logAuditEvent(params: {
  actorUid: string;
  actorEmail?: string;
  action: string;
  entityType: 'donor' | 'policy' | 'user' | 'role' | 'import' | 'settings';
  entityId: string;
  previousValues?: Record<string, any>;
  newValues?: Record<string, any>;
  outcome: 'success' | 'failure';
  reason?: string;
}): Promise<void> {
  // Build audit entry omitting any undefined values (Firestore rejects undefined)
  const auditEntry: Record<string, any> = {
    actorUid: params.actorUid,
    actorEmail: params.actorEmail || 'unknown@system',
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    timestamp: new Date().toISOString(),
    outcome: params.outcome,
  };

  if (params.reason !== undefined && params.reason !== null && params.reason.trim() !== '') {
    auditEntry.reason = params.reason.trim();
  }
  if (params.previousValues) {
    const sanitized = sanitizeLogValues(params.previousValues);
    if (Object.keys(sanitized).length > 0) {
      auditEntry.previousValues = sanitized;
    }
  }
  if (params.newValues) {
    const sanitized = sanitizeLogValues(params.newValues);
    if (Object.keys(sanitized).length > 0) {
      auditEntry.newValues = sanitized;
    }
  }

  try {
    await addDoc(collection(db, 'auditLogs'), auditEntry);
  } catch (error) {
    console.error('Failed to write immutable audit log:', error);
    // Don't crash user workflow if audit log write fails, but log context
  }
}

/**
 * Strips out sensitive fields like passwords, tokens, private keys before logging.
 * Also removes any undefined values to satisfy Firestore payload constraints.
 */
export function sanitizeLogValues(values: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  const sensitiveKeys = ['password', 'token', 'refreshToken', 'secret', 'otp'];
  for (const [key, val] of Object.entries(values)) {
    if (val === undefined) {
      continue;
    }
    if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

import type { Request } from 'express';
import {
  ADMIN_EMAILS,
  FIREBASE_PROJECT_ID,
  FIREBASE_WEB_API_KEY,
  FIRESTORE_DATABASE_ID,
} from './config.ts';
import { parseFirestoreTicketDocument } from './security.ts';
import type { ParsedFirestoreTicket } from './security.ts';

export interface VerifiedUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  isAdminClaim: boolean;
  idToken: string;
}

export async function verifyFirebaseBearerToken(req: Request): Promise<VerifiedUser | null> {
  if (!FIREBASE_WEB_API_KEY) return null;
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const idToken = authHeader.slice(7).trim();
  if (!idToken) return null;

  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      users?: Array<{
        localId?: string;
        email?: string;
        emailVerified?: boolean;
        customAttributes?: string;
      }>;
    };
    const user = data.users?.[0];
    if (!user || !user.localId || !user.email || !user.emailVerified) {
      return null;
    }

    let isAdminClaim = false;
    if (typeof user.customAttributes === 'string' && user.customAttributes.trim()) {
      try {
        const claims = JSON.parse(user.customAttributes) as Record<string, unknown>;
        isAdminClaim = claims.admin === true;
      } catch {
        isAdminClaim = false;
      }
    }

    return {
      uid: user.localId,
      email: user.email,
      emailVerified: Boolean(user.emailVerified),
      isAdminClaim,
      idToken,
    };
  } catch {
    return null;
  }
}

export function hasAdminAccessClaimOrEnv(
  user: Pick<VerifiedUser, 'email' | 'emailVerified' | 'isAdminClaim'>,
  adminEmails: string[] = ADMIN_EMAILS
): boolean {
  if (!user.emailVerified) return false;
  if (user.isAdminClaim) return true;
  return adminEmails.includes(user.email.toLowerCase());
}

export async function isAdminUser(user: VerifiedUser): Promise<boolean> {
  if (!user.emailVerified) return false;
  if (hasAdminAccessClaimOrEnv(user)) return true;
  if (!FIREBASE_PROJECT_ID) return false;

  try {
    const adminDocUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      FIREBASE_PROJECT_ID
    )}/databases/${encodeURIComponent(FIRESTORE_DATABASE_ID)}/documents/admins/${encodeURIComponent(
      user.uid
    )}`;
    const res = await fetch(adminDocUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${user.idToken}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchFirestoreTicketAsUser(
  ticketId: string,
  idToken: string
): Promise<{ status: number; ticket: ParsedFirestoreTicket | null }> {
  if (!FIREBASE_PROJECT_ID) {
    return { status: 500, ticket: null };
  }

  const docUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    FIREBASE_PROJECT_ID
  )}/databases/${encodeURIComponent(FIRESTORE_DATABASE_ID)}/documents/tickets/${encodeURIComponent(
    ticketId
  )}`;

  const res = await fetch(docUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
    signal: AbortSignal.timeout(6000),
  });

  if (!res.ok) {
    return { status: res.status, ticket: null };
  }

  const json = await res.json();
  return { status: 200, ticket: parseFirestoreTicketDocument(json) };
}

export async function writeBackendAuditLog(
  user: VerifiedUser,
  entry: {
    action: 'webhook.config_updated';
    targetId: string;
    summary: string;
  }
): Promise<void> {
  if (!FIREBASE_PROJECT_ID) return;
  const logId = `aud-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const docName = `projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents/auditLogs/${logId}`;
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    FIREBASE_PROJECT_ID
  )}/databases/${encodeURIComponent(FIRESTORE_DATABASE_ID)}/documents:commit`;

  try {
    await fetch(commitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user.idToken}`,
      },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: docName,
              fields: {
                action: { stringValue: entry.action },
                targetId: { stringValue: entry.targetId.slice(0, 128) },
                actorUid: { stringValue: user.uid },
                actorEmail: { stringValue: user.email },
                summary: { stringValue: entry.summary.slice(0, 500) },
              },
            },
            currentDocument: { exists: false },
            updateTransforms: [
              {
                fieldPath: 'createdAt',
                setToServerValue: 'REQUEST_TIME',
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Non-blocking audit persistence
  }
}

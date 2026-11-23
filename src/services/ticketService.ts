import { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  Unsubscribe,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { createInitialMockTickets } from '../data/mockTickets';
import { formatTicketId, resolveSeedCounterPlan } from '../utils/ticketCounter';
import {
  AdminAuthSource,
  AuditAction,
  AuditLogEntry,
  getPermissionsForRole,
  NewTicketInput,
  Permission,
  ProblemCategory,
  RepairTicket,
  resolveAccessFromSignals,
  TicketStatus,
  UserAccessProfile,
  UserRole,
} from '../types/ticket';

const ENV_ADMIN_EMAILS: string[] = String(import.meta.env.VITE_ADMIN_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function toIsoString(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string') {
    return val;
  }
  return new Date().toISOString();
}

function toNullableIsoString(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string') {
    return val;
  }
  return null;
}

function mapDocToTicket(id: string, data: Record<string, unknown>): RepairTicket {
  return {
    id,
    requesterName: String(data.requesterName ?? ''),
    department: data.department as RepairTicket['department'],
    contactInfo: String(data.contactInfo ?? ''),
    category: data.category as RepairTicket['category'],
    urgency: data.urgency as RepairTicket['urgency'],
    description: String(data.description ?? ''),
    assetTag: String(data.assetTag ?? ''),
    status: data.status as RepairTicket['status'],
    resolutionNote: String(data.resolutionNote ?? ''),
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
    completedAt: toNullableIsoString(data.completedAt),
    aiTroubleshooting:
      (data.aiTroubleshooting as RepairTicket['aiTroubleshooting']) ?? null,
  };
}

function mapDocToAuditLog(id: string, data: Record<string, unknown>): AuditLogEntry {
  return {
    id,
    action: data.action as AuditAction,
    targetId: String(data.targetId ?? ''),
    actorUid: String(data.actorUid ?? ''),
    actorEmail: String(data.actorEmail ?? ''),
    summary: String(data.summary ?? ''),
    createdAt: toIsoString(data.createdAt),
  };
}

function makeAuditId(): string {
  return `aud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export type { AdminAuthSource, UserAccessProfile };

export async function resolveUserAccess(
  user: User,
  forceRefresh = false
): Promise<UserAccessProfile> {
  if (!user.emailVerified) {
    return resolveAccessFromSignals({
      emailVerified: false,
      hasTokenAdminClaim: false,
    });
  }

  let hasTokenAdminClaim = false;
  let idToken = '';
  try {
    const tokenResult = await user.getIdTokenResult(forceRefresh);
    hasTokenAdminClaim = tokenResult.claims.admin === true;
    idToken = tokenResult.token;
  } catch {
    // Fallback to environment list, backend session, or Firestore lookup
  }

  let apiSession: {
    isAdmin?: boolean;
    claims?: { admin?: boolean };
    authSource?: AdminAuthSource;
  } | null = null;

  if (idToken) {
    try {
      const res = await fetch('/api/auth/session', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        apiSession = (await res.json()) as {
          isAdmin?: boolean;
          claims?: { admin?: boolean };
          authSource?: AdminAuthSource;
        };
      }
    } catch {
      // Fallback gracefully to token claim / client env / Firestore lookup if API is unreachable
    }
  }

  const isEnvAdmin = Boolean(
    user.email && ENV_ADMIN_EMAILS.includes(user.email.toLowerCase())
  );

  let hasAdminsDoc = false;
  if (!apiSession?.isAdmin && !hasTokenAdminClaim && !isEnvAdmin) {
    try {
      const adminSnap = await getDoc(doc(db, 'admins', user.uid));
      hasAdminsDoc = adminSnap.exists();
    } catch {
      // Non-admin users receive permission-denied or not-found gracefully
    }
  }

  return resolveAccessFromSignals({
    emailVerified: user.emailVerified,
    hasTokenAdminClaim,
    apiSession,
    isEnvAdmin,
    hasAdminsDoc,
  });
}

export function subscribeToTickets(
  user: User,
  canReadAll: boolean,
  onUpdate: (tickets: RepairTicket[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const ticketsRef = collection(db, 'tickets');
  const ticketsQuery = canReadAll
    ? query(ticketsRef)
    : query(ticketsRef, where('createdByUid', '==', user.uid));

  return onSnapshot(
    ticketsQuery,
    (snapshot) => {
      const list = snapshot.docs.map((docSnap) =>
        mapDocToTicket(docSnap.id, docSnap.data() as Record<string, unknown>)
      );
      list.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      onUpdate(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'tickets');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeToAiResolutionsCount(
  user: User,
  canReadAll: boolean,
  onUpdate: (count: number) => void
): Unsubscribe {
  const ref = collection(db, 'aiResolutions');
  const q = canReadAll
    ? query(ref)
    : query(ref, where('createdByUid', '==', user.uid));

  return onSnapshot(
    q,
    (snapshot) => {
      onUpdate(snapshot.size);
    },
    () => {
      // Non-critical stats listener
    }
  );
}

export function subscribeToAuditLogs(
  onUpdate: (logs: AuditLogEntry[]) => void
): Unsubscribe {
  const ref = collection(db, 'auditLogs');
  const q = query(ref, limit(100));

  return onSnapshot(
    q,
    (snapshot) => {
      const logs = snapshot.docs.map((docSnap) =>
        mapDocToAuditLog(docSnap.id, docSnap.data() as Record<string, unknown>)
      );
      logs.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      onUpdate(logs);
    },
    () => {
      // Only admins subscribe to auditLogs
    }
  );
}

export async function createTicketInFirestore(
  user: User,
  input: NewTicketInput
): Promise<RepairTicket> {
  const nowIso = new Date().toISOString();
  const year = new Date().getFullYear();

  const sanitizedAi = input.aiTroubleshooting
    ? {
        summary: input.aiTroubleshooting.summary.slice(0, 1000),
        steps: input.aiTroubleshooting.steps
          .slice(0, 5)
          .map((s) => s.slice(0, 600)),
        warningNote: input.aiTroubleshooting.warningNote.slice(0, 600),
        source: input.aiTroubleshooting.source,
        triedAt: input.aiTroubleshooting.triedAt.slice(0, 64),
      }
    : null;

  const counterRef = doc(db, 'counters', 'tickets');

  try {
    const allocatedId = await runTransaction(db, async (transaction) => {
      const counterSnap = await transaction.get(counterRef);
      const currentLast = counterSnap.exists()
        ? Number(counterSnap.data().lastNumber ?? 0)
        : 0;
      const nextNumber = currentLast + 1;
      const candidateId = formatTicketId(year, nextNumber);

      const ticketPayload: Record<string, unknown> = {
        id: candidateId,
        requesterName: input.requesterName.trim().slice(0, 100),
        department: input.department,
        contactInfo: input.contactInfo.trim().slice(0, 120),
        category: input.category,
        urgency: input.urgency,
        description: input.description.trim().slice(0, 2000),
        assetTag: input.assetTag.trim().slice(0, 64),
        status: 'รอดำเนินการ',
        resolutionNote: '',
        createdByUid: user.uid,
        createdByEmail: user.email || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        completedAt: null,
      };

      if (sanitizedAi) {
        ticketPayload.aiTroubleshooting = sanitizedAi;
      }

      transaction.set(counterRef, {
        lastNumber: nextNumber,
        lastTicketId: candidateId,
        updatedAt: serverTimestamp(),
      });
      transaction.set(doc(db, 'tickets', candidateId), ticketPayload);

      const auditId = makeAuditId();
      transaction.set(doc(db, 'auditLogs', auditId), {
        action: 'ticket.created',
        targetId: candidateId,
        actorUid: user.uid,
        actorEmail: user.email || '',
        summary: `สร้างใบแจ้งซ่อม ${candidateId} (${input.category} · แผนก${input.department})`,
        createdAt: serverTimestamp(),
      });

      return candidateId;
    });

    return {
      id: allocatedId,
      requesterName: input.requesterName.trim().slice(0, 100),
      department: input.department,
      contactInfo: input.contactInfo.trim().slice(0, 120),
      category: input.category,
      urgency: input.urgency,
      description: input.description.trim().slice(0, 2000),
      assetTag: input.assetTag.trim().slice(0, 64),
      status: 'รอดำเนินการ',
      resolutionNote: '',
      createdAt: nowIso,
      updatedAt: nowIso,
      completedAt: null,
      aiTroubleshooting: sanitizedAi,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'tickets');
  }
}

export async function updateTicketInFirestore(
  actor: User,
  ticketId: string,
  updates: { status: TicketStatus; resolutionNote: string },
  existingCompletedAt: string | null
): Promise<void> {
  const path = `tickets/${ticketId}`;
  const payload: Record<string, unknown> = {
    status: updates.status,
    resolutionNote: updates.resolutionNote.trim().slice(0, 2000),
    updatedAt: serverTimestamp(),
    completedAt:
      updates.status === 'เสร็จสิ้น'
        ? existingCompletedAt
          ? Timestamp.fromDate(new Date(existingCompletedAt))
          : serverTimestamp()
        : null,
  };

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'tickets', ticketId), payload);
    batch.set(doc(db, 'auditLogs', makeAuditId()), {
      action: 'ticket.updated',
      targetId: ticketId,
      actorUid: actor.uid,
      actorEmail: actor.email || '',
      summary: `อัปเดตสถานะ ${ticketId} เป็น "${updates.status}"`,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteTicketInFirestore(
  actor: User,
  ticketId: string
): Promise<void> {
  const path = `tickets/${ticketId}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'tickets', ticketId));
    batch.set(doc(db, 'auditLogs', makeAuditId()), {
      action: 'ticket.deleted',
      targetId: ticketId,
      actorUid: actor.uid,
      actorEmail: actor.email || '',
      summary: `ลบใบแจ้งซ่อม ${ticketId}`,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function logAiSelfResolutionInFirestore(
  user: User,
  category: ProblemCategory
): Promise<void> {
  const resolutionId = `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = `aiResolutions/${resolutionId}`;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'aiResolutions', resolutionId), {
      category,
      createdByUid: user.uid,
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'auditLogs', makeAuditId()), {
      action: 'ai.self_resolved',
      targetId: resolutionId,
      actorUid: user.uid,
      actorEmail: user.email || '',
      summary: `ผู้ใช้แก้ไขปัญหา "${category}" สำเร็จด้วย AI ผู้ช่วยซ่อมเบื้องต้น`,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function seedDemoTicketsToFirestore(user: User): Promise<void> {
  const demoTickets = createInitialMockTickets();
  const counterRef = doc(db, 'counters', 'tickets');

  try {
    await runTransaction(db, async (tx) => {
      const counterSnap = await tx.get(counterRef);
      const existingLastNumber = counterSnap.exists()
        ? Number(counterSnap.data().lastNumber ?? 0)
        : null;

      const plan = resolveSeedCounterPlan(demoTickets, existingLastNumber);

      const missingDemoTickets: typeof demoTickets = [];
      for (const ticket of demoTickets) {
        const docRef = doc(db, 'tickets', ticket.id);
        const existingSnap = await tx.get(docRef);
        if (!existingSnap.exists()) {
          missingDemoTickets.push(ticket);
        }
      }

      if (plan.shouldWriteCounter && plan.lastNumber && plan.lastTicketId) {
        tx.set(counterRef, {
          lastNumber: plan.lastNumber,
          lastTicketId: plan.lastTicketId,
          updatedAt: serverTimestamp(),
        });
      }

      for (const ticket of missingDemoTickets) {
        tx.set(doc(db, 'tickets', ticket.id), {
          id: ticket.id,
          requesterName: ticket.requesterName.slice(0, 100),
          department: ticket.department,
          contactInfo: ticket.contactInfo.slice(0, 120),
          category: ticket.category,
          urgency: ticket.urgency,
          description: ticket.description.slice(0, 2000),
          assetTag: ticket.assetTag.slice(0, 64),
          status: ticket.status,
          resolutionNote: ticket.resolutionNote.slice(0, 2000),
          createdByUid: user.uid,
          createdByEmail: user.email || 'admin@company.local',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          completedAt: ticket.status === 'เสร็จสิ้น' ? serverTimestamp() : null,
        });
      }

      tx.set(doc(db, 'auditLogs', makeAuditId()), {
        action: 'admin.demo_seeded',
        targetId: 'tickets',
        actorUid: user.uid,
        actorEmail: user.email || '',
        summary: `เพิ่มข้อมูลตัวอย่าง ${missingDemoTickets.length} รายการลงฐานข้อมูล Firestore`,
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'tickets');
  }
}

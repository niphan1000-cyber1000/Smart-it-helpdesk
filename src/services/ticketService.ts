import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  Unsubscribe,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { createInitialMockTickets } from '../data/mockTickets';
import {
  AuditAction,
  AuditLogEntry,
  getPermissionsForRole,
  NewTicketInput,
  Permission,
  ProblemCategory,
  RepairTicket,
  TicketStatus,
  UserRole,
} from '../types/ticket';

export const BOOTSTRAPPED_ADMIN_EMAIL = 'niphan1000@gmail.com';

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

function formatTicketId(year: number, seq: number): string {
  return `IT-${year}-${String(seq).padStart(3, '0')}`;
}

function makeAuditId(): string {
  return `aud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface UserAccessProfile {
  role: UserRole;
  permissions: Permission[];
}

export async function resolveUserAccess(user: User): Promise<UserAccessProfile> {
  if (!user.emailVerified) {
    return { role: 'employee', permissions: getPermissionsForRole('employee') };
  }

  if (user.email === BOOTSTRAPPED_ADMIN_EMAIL) {
    return { role: 'admin', permissions: getPermissionsForRole('admin') };
  }

  try {
    const adminSnap = await getDoc(doc(db, 'admins', user.uid));
    if (adminSnap.exists()) {
      return { role: 'admin', permissions: getPermissionsForRole('admin') };
    }
  } catch {
    // Non-admin users receive permission-denied or not-found gracefully
  }

  return { role: 'employee', permissions: getPermissionsForRole('employee') };
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
      let nextNumber = currentLast + 1;
      let candidateId = formatTicketId(year, nextNumber);

      // Guard against collision if demo tickets were seeded earlier
      let existingSnap = await transaction.get(doc(db, 'tickets', candidateId));
      while (existingSnap.exists()) {
        nextNumber += 1;
        candidateId = formatTicketId(year, nextNumber);
        existingSnap = await transaction.get(doc(db, 'tickets', candidateId));
      }

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
    await updateDoc(doc(db, 'tickets', ticketId), payload);
    const auditId = makeAuditId();
    await setDoc(doc(db, 'auditLogs', auditId), {
      action: 'ticket.updated',
      targetId: ticketId,
      actorUid: actor.uid,
      actorEmail: actor.email || '',
      summary: `อัปเดตสถานะ ${ticketId} เป็น "${updates.status}"`,
      createdAt: serverTimestamp(),
    });
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
    await deleteDoc(doc(db, 'tickets', ticketId));
    const auditId = makeAuditId();
    await setDoc(doc(db, 'auditLogs', auditId), {
      action: 'ticket.deleted',
      targetId: ticketId,
      actorUid: actor.uid,
      actorEmail: actor.email || '',
      summary: `ลบใบแจ้งซ่อม ${ticketId}`,
      createdAt: serverTimestamp(),
    });
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
    await setDoc(doc(db, 'aiResolutions', resolutionId), {
      category,
      createdByUid: user.uid,
      createdAt: serverTimestamp(),
    });
    const auditId = makeAuditId();
    await setDoc(doc(db, 'auditLogs', auditId), {
      action: 'ai.self_resolved',
      targetId: resolutionId,
      actorUid: user.uid,
      actorEmail: user.email || '',
      summary: `ผู้ใช้แก้ไขปัญหา "${category}" สำเร็จด้วย AI ผู้ช่วยซ่อมเบื้องต้น`,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function logWebhookConfigUpdated(
  actor: User,
  summaryText: string
): Promise<void> {
  try {
    const auditId = makeAuditId();
    await setDoc(doc(db, 'auditLogs', auditId), {
      action: 'webhook.config_updated',
      targetId: 'webhook',
      actorUid: actor.uid,
      actorEmail: actor.email || '',
      summary: summaryText.slice(0, 500),
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking audit log
  }
}

export async function seedDemoTicketsToFirestore(user: User): Promise<void> {
  const demoTickets = createInitialMockTickets();
  const counterRef = doc(db, 'counters', 'tickets');
  let currentMax = 0;

  try {
    const counterSnap = await getDoc(counterRef);
    if (counterSnap.exists()) {
      currentMax = Number(counterSnap.data().lastNumber ?? 0);
    }
  } catch {
    currentMax = 0;
  }

  const batch = writeBatch(db);
  batch.set(counterRef, {
    lastNumber: Math.max(currentMax, demoTickets.length),
    updatedAt: serverTimestamp(),
  });

  for (const ticket of demoTickets) {
    const docRef = doc(db, 'tickets', ticket.id);
    batch.set(docRef, {
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
      createdByEmail: user.email || BOOTSTRAPPED_ADMIN_EMAIL,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      completedAt: ticket.status === 'เสร็จสิ้น' ? serverTimestamp() : null,
    });
  }

  batch.set(doc(db, 'auditLogs', makeAuditId()), {
    action: 'admin.demo_seeded',
    targetId: 'tickets',
    actorUid: user.uid,
    actorEmail: user.email || '',
    summary: `เพิ่มข้อมูลตัวอย่าง ${demoTickets.length} รายการลงฐานข้อมูล Firestore`,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'tickets');
  }
}

import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
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
  NewTicketInput,
  ProblemCategory,
  RepairTicket,
  TicketStatus,
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

function generateTicketId(existingTickets: RepairTicket[]): string {
  const year = new Date().getFullYear();
  let maxNumber = 0;

  for (const ticket of existingTickets) {
    const match = ticket.id.match(/^IT-\d{4}-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!Number.isNaN(num) && num > maxNumber) {
        maxNumber = num;
      }
    }
  }

  const next = String(maxNumber + 1).padStart(3, '0');
  return `IT-${year}-${next}`;
}

export async function checkIsAdminUser(user: User): Promise<boolean> {
  if (!user.emailVerified) return false;
  if (user.email === BOOTSTRAPPED_ADMIN_EMAIL) return true;

  try {
    const adminSnap = await getDoc(doc(db, 'admins', user.uid));
    return adminSnap.exists();
  } catch (error) {
    // Non-admin users get permission-denied or not-found gracefully when checking admins
    if (
      error instanceof Error &&
      error.message.includes('Missing or insufficient permissions')
    ) {
      return false;
    }
    return false;
  }
}

export function subscribeToTickets(
  user: User,
  isBootstrappedAdmin: boolean,
  onUpdate: (tickets: RepairTicket[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const ticketsRef = collection(db, 'tickets');
  const ticketsQuery = isBootstrappedAdmin
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
  isBootstrappedAdmin: boolean,
  onUpdate: (count: number) => void
): Unsubscribe {
  const ref = collection(db, 'aiResolutions');
  const q = isBootstrappedAdmin
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

export async function createTicketInFirestore(
  user: User,
  input: NewTicketInput,
  existingTickets: RepairTicket[]
): Promise<RepairTicket> {
  const ticketId = generateTicketId(existingTickets);
  const path = `tickets/${ticketId}`;
  const nowIso = new Date().toISOString();

  const sanitizedAi = input.aiTroubleshooting
    ? {
        summary: input.aiTroubleshooting.summary.slice(0, 1000),
        steps: input.aiTroubleshooting.steps
          .slice(0, 10)
          .map((s) => s.slice(0, 600)),
        warningNote: input.aiTroubleshooting.warningNote.slice(0, 600),
        source: input.aiTroubleshooting.source,
        triedAt: input.aiTroubleshooting.triedAt.slice(0, 64),
      }
    : null;

  const payload: Record<string, unknown> = {
    id: ticketId,
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
    payload.aiTroubleshooting = sanitizedAi;
  }

  try {
    await setDoc(doc(db, 'tickets', ticketId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  return {
    id: ticketId,
    requesterName: String(payload.requesterName),
    department: input.department,
    contactInfo: String(payload.contactInfo),
    category: input.category,
    urgency: input.urgency,
    description: String(payload.description),
    assetTag: String(payload.assetTag),
    status: 'รอดำเนินการ',
    resolutionNote: '',
    createdAt: nowIso,
    updatedAt: nowIso,
    completedAt: null,
    aiTroubleshooting: sanitizedAi,
  };
}

export async function updateTicketInFirestore(
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
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteTicketInFirestore(ticketId: string): Promise<void> {
  const path = `tickets/${ticketId}`;
  try {
    await deleteDoc(doc(db, 'tickets', ticketId));
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
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function seedDemoTicketsToFirestore(user: User): Promise<void> {
  const demoTickets = createInitialMockTickets();
  const batch = writeBatch(db);

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

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'tickets');
  }
}

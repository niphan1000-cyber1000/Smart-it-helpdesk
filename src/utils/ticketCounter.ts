import { RepairTicket } from '../types/ticket';

export interface SeedCounterPlan {
  shouldWriteCounter: boolean;
  lastNumber?: number;
  lastTicketId?: string;
}

export function formatTicketId(year: number, seq: number): string {
  return `IT-${year}-${String(seq).padStart(3, '0')}`;
}

export function extractTicketSequence(ticketId: string): number | null {
  const match = /^IT-[0-9]{4}-([0-9]{1,6})$/.exec(ticketId.trim());
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
}

/**
 * Computes the counter update for seeding demo tickets regardless of array sort order.
 * Avoids fabricating a nonexistent lastTicketId when the counter is already ahead.
 */
export function resolveSeedCounterPlan(
  demoTickets: readonly Pick<RepairTicket, 'id'>[],
  existingLastNumber: number | null
): SeedCounterPlan {
  let maxSeq = 0;
  let maxId = '';

  for (const ticket of demoTickets) {
    const seq = extractTicketSequence(ticket.id);
    if (seq !== null && seq > maxSeq) {
      maxSeq = seq;
      maxId = ticket.id;
    }
  }

  if (maxSeq === 0 || !maxId) {
    return { shouldWriteCounter: false };
  }

  if (existingLastNumber !== null && existingLastNumber > maxSeq) {
    return { shouldWriteCounter: false };
  }

  return {
    shouldWriteCounter: true,
    lastNumber: maxSeq,
    lastTicketId: maxId,
  };
}

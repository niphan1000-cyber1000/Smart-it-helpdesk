import { AiStats, RepairTicket } from '../types/ticket';
import { createInitialMockTickets } from '../data/mockTickets';

const STORAGE_KEY = 'it_helpdesk_tickets_v1';
const AI_STATS_KEY = 'it_helpdesk_ai_stats_v1';

export function loadTicketsFromStorage(): RepairTicket[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = createInitialMockTickets();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      const initial = createInitialMockTickets();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }
    return parsed as RepairTicket[];
  } catch {
    return createInitialMockTickets();
  }
}

export function saveTicketsToStorage(tickets: RepairTicket[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tickets));
  } catch {
    // Ignore storage quota errors gracefully
  }
}

export function resetTicketsStorage(): RepairTicket[] {
  const initial = createInitialMockTickets();
  saveTicketsToStorage(initial);
  return initial;
}

export function loadAiStatsFromStorage(): AiStats {
  try {
    const raw = window.localStorage.getItem(AI_STATS_KEY);
    if (!raw) {
      return { selfResolvedCount: 0, lastResolvedAt: null };
    }
    const parsed = JSON.parse(raw) as Partial<AiStats>;
    return {
      selfResolvedCount:
        typeof parsed.selfResolvedCount === 'number' ? parsed.selfResolvedCount : 0,
      lastResolvedAt:
        typeof parsed.lastResolvedAt === 'string' ? parsed.lastResolvedAt : null,
    };
  } catch {
    return { selfResolvedCount: 0, lastResolvedAt: null };
  }
}

export function saveAiStatsToStorage(stats: AiStats): void {
  try {
    window.localStorage.setItem(AI_STATS_KEY, JSON.stringify(stats));
  } catch {
    // Ignore storage errors
  }
}

export function generateNextTicketId(tickets: RepairTicket[]): string {
  const year = new Date().getFullYear();
  let maxNumber = 0;

  for (const ticket of tickets) {
    const match = ticket.id.match(/(\d+)$/);
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

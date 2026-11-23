import { RepairTicket } from '../types/ticket';
import { formatCsvDateTime } from './formatters';

function escapeCsvCell(value: string): string {
  const safe = value ?? '';
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function exportTicketsToCsv(tickets: RepairTicket[], filenamePrefix = 'it-repair-report'): void {
  const headers = [
    'รหัสใบงาน',
    'วันที่เวลาแจ้งซ่อม',
    'ชื่อผู้แจ้ง',
    'แผนก/ฝ่าย',
    'ช่องทางติดต่อ',
    'ประเภทปัญหา',
    'ระดับความเร่งด่วน',
    'หมายเลขครุภัณฑ์ (Asset Tag)',
    'รายละเอียดอาการเสีย',
    'สถานะ',
    'บันทึกการแก้ไข',
    'วันที่เวลาซ่อมเสร็จ',
    'ประวัติคำแนะนำ AI ที่ผู้ใช้ลองแล้ว',
  ];

  const rows = tickets.map((ticket) => [
    ticket.id,
    formatCsvDateTime(ticket.createdAt),
    ticket.requesterName,
    ticket.department,
    ticket.contactInfo,
    ticket.category,
    ticket.urgency,
    ticket.assetTag || '-',
    ticket.description,
    ticket.status,
    ticket.resolutionNote || '-',
    ticket.completedAt ? formatCsvDateTime(ticket.completedAt) : '-',
    ticket.aiTroubleshooting
      ? ticket.aiTroubleshooting.steps.map((s, i) => `${i + 1}. ${s}`).join(' | ')
      : '-',
  ]);

  const csvLines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ];

  // Add UTF-8 BOM (\uFEFF) so Thai characters render cleanly in Microsoft Excel
  const csvContent = '\uFEFF' + csvLines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const now = new Date();
  const dateStamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;

  const link = document.createElement('a');
  link.href = url;
  link.download = `${filenamePrefix}-${dateStamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

import { useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import {
  BellRing,
  CheckCircle2,
  ClipboardList,
  Database,
  Download,
  History,
  Inbox,
  LayoutGrid,
  Loader2,
  Package,
  RefreshCw,
  Search,
  ShieldAlert,
  Table2,
  Wrench,
} from 'lucide-react';
import {
  AuditLogEntry,
  hasPermission,
  Permission,
  RepairTicket,
  TICKET_STATUSES,
  TicketStatus,
  URGENCY_LEVELS,
  UrgencyLevel,
} from '../types/ticket';
import { formatThaiDateTime, isToday } from '../utils/formatters';
import { StatusIndicator, UrgencyIndicator } from './StatusIndicator';
import { TicketDetailDrawer } from './TicketDetailDrawer';
import { WebhookSettingsPanel } from './WebhookSettingsPanel';

interface AdminDashboardProps {
  user: User;
  permissions: Permission[];
  tickets: RepairTicket[];
  auditLogs: AuditLogEntry[];
  ticketsLoading: boolean;
  aiSelfResolvedCount: number;
  webhookConfigured: boolean;
  onWebhookStatusChanged: (configured: boolean) => void;
  onUpdateTicket: (
    ticketId: string,
    updates: { status: TicketStatus; resolutionNote: string }
  ) => Promise<void>;
  onDeleteTicket: (ticketId: string) => Promise<void>;
  onExportCsv: (filteredTickets: RepairTicket[]) => void;
  onSeedDemoData: () => Promise<void>;
  onSwitchToUser: () => void;
  onRefreshAccess?: () => Promise<void>;
  refreshingAccess?: boolean;
}

type AdminViewLayout = 'table' | 'board' | 'audit';

export function AdminDashboard({
  user,
  permissions,
  tickets,
  auditLogs,
  ticketsLoading,
  aiSelfResolvedCount,
  webhookConfigured,
  onWebhookStatusChanged,
  onUpdateTicket,
  onDeleteTicket,
  onExportCsv,
  onSeedDemoData,
  onSwitchToUser,
  onRefreshAccess,
  refreshingAccess = false,
}: AdminDashboardProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ทั้งหมด' | TicketStatus>(
    'ทั้งหมด'
  );
  const [urgencyFilter, setUrgencyFilter] = useState<'ทั้งหมด' | UrgencyLevel>(
    'ทั้งหมด'
  );
  const [viewLayout, setViewLayout] = useState<AdminViewLayout>('table');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [webhookModalOpen, setWebhookModalOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const selectedTicket = useMemo(
    () => tickets.find((t) => t.id === selectedTicketId) ?? null,
    [tickets, selectedTicketId]
  );

  // KPI computations
  const kpis = useMemo(() => {
    const newTodayCount = tickets.filter((t) => isToday(t.createdAt)).length;
    const pendingTotal = tickets.filter(
      (t) => t.status === 'รอดำเนินการ'
    ).length;
    const inProgressCount = tickets.filter(
      (t) => t.status === 'กำลังซ่อม'
    ).length;
    const waitingPartsCount = tickets.filter(
      (t) => t.status === 'รออะไหล่'
    ).length;
    const completedCount = tickets.filter(
      (t) => t.status === 'เสร็จสิ้น'
    ).length;
    const completionRate =
      tickets.length > 0
        ? Math.round((completedCount / tickets.length) * 100)
        : 0;

    return {
      newTodayCount,
      pendingTotal,
      inProgressCount,
      waitingPartsCount,
      completedCount,
      completionRate,
    };
  }, [tickets]);

  const filteredTickets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tickets.filter((ticket) => {
      if (statusFilter !== 'ทั้งหมด' && ticket.status !== statusFilter) {
        return false;
      }
      if (urgencyFilter !== 'ทั้งหมด' && ticket.urgency !== urgencyFilter) {
        return false;
      }
      if (!q) return true;
      return (
        ticket.id.toLowerCase().includes(q) ||
        ticket.requesterName.toLowerCase().includes(q) ||
        ticket.department.toLowerCase().includes(q) ||
        ticket.category.toLowerCase().includes(q) ||
        ticket.description.toLowerCase().includes(q) ||
        ticket.assetTag.toLowerCase().includes(q)
      );
    });
  }, [tickets, searchQuery, statusFilter, urgencyFilter]);

  const canManageTickets = hasPermission(permissions, 'ticket:read_all');

  if (!canManageTickets) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" aria-hidden="true" />
          </div>
          <h1 className="font-display text-xl font-bold text-slate-900">
            มุมมองนี้สงวนสิทธิ์เฉพาะเจ้าหน้าที่ไอที (IT Admin)
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            บัญชีปัจจุบันของคุณ ({user.email}) ยังไม่ได้รับสิทธิ์เจ้าหน้าที่ไอที (Custom Claim{' '}
            <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">admin: true</code>{' '}
            หรือรายชื่อในระบบ) จึงใช้งานได้เฉพาะส่วนผู้แจ้งซ่อม (User Portal)
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {onRefreshAccess && (
              <button
                type="button"
                onClick={() => void onRefreshAccess()}
                disabled={refreshingAccess}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-lg transition-colors"
              >
                <RefreshCw
                  className={`w-4 h-4 ${refreshingAccess ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>ตรวจสอบสิทธิ์ Custom Claim ใหม่</span>
              </button>
            )}
            <button
              type="button"
              onClick={onSwitchToUser}
              className="inline-flex items-center px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors"
            >
              กลับไปหน้าสำหรับผู้แจ้งซ่อม (User)
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleQuickAcceptJob = async (ticket: RepairTicket) => {
    await onUpdateTicket(ticket.id, {
      status: 'กำลังซ่อม',
      resolutionNote: ticket.resolutionNote || 'เจ้าหน้าที่ไอทีรับงานและกำลังตรวจสอบ',
    });
  };

  const handleSeedDemo = async () => {
    setSeeding(true);
    try {
      await onSeedDemoData();
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header Row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            แดชบอร์ดจัดการงานซ่อม (IT Support)
          </h1>
          <p className="text-sm text-slate-600 mt-1 tabular-nums">
            เชื่อมต่อฐานข้อมูล Firestore แบบ Real-time และวิเคราะห์เชิงลึกด้วย AI
            {aiSelfResolvedCount > 0 && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="font-medium text-emerald-700">
                  AI ช่วยผู้ใช้แก้ปัญหาสำเร็จก่อนส่งซ่อม {aiSelfResolvedCount} ครั้ง
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setWebhookModalOpen(true)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
              webhookConfigured
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <BellRing className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>
              {webhookConfigured ? 'Webhook: เชื่อมต่อแล้ว' : 'ตั้งค่า Webhook แจ้งเตือน'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => void handleSeedDemo()}
            disabled={seeding}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 hover:text-slate-900 disabled:opacity-60 transition-colors whitespace-nowrap"
          >
            {seeding ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />
            ) : (
              <Database className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            )}
            <span>เพิ่มข้อมูลตัวอย่าง</span>
          </button>

          <button
            type="button"
            onClick={() => onExportCsv(filteredTickets)}
            disabled={filteredTickets.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>ส่งออกรายงาน CSV ({filteredTickets.length})</span>
          </button>
        </div>
      </div>

      {/* KPI Summary Cards (4 Columns) */}
      <section
        aria-label="สรุปภาพรวมงานซ่อม"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500">งานเข้าใหม่วันนี้</p>
            <p className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">
              {kpis.newTodayCount}
            </p>
            <p className="mt-1 text-xs text-slate-500 tabular-nums">
              รอดำเนินการทั้งหมด {kpis.pendingTotal} งาน
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-100 text-slate-700 shrink-0">
            <Inbox className="w-5 h-5" aria-hidden="true" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500">กำลังดำเนินการ</p>
            <p className="mt-2 text-3xl font-bold text-blue-700 tabular-nums">
              {kpis.inProgressCount}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              อยู่ระหว่างตรวจสอบและซ่อมแซม
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-blue-50 text-blue-700 shrink-0">
            <Wrench className="w-5 h-5" aria-hidden="true" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500">รออะไหล่</p>
            <p className="mt-2 text-3xl font-bold text-amber-700 tabular-nums">
              {kpis.waitingPartsCount}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              รอเบิกคลังหรือสั่งซื้อทดแทน
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-amber-50 text-amber-700 shrink-0">
            <Package className="w-5 h-5" aria-hidden="true" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500">ซ่อมเสร็จแล้ว</p>
            <p className="mt-2 text-3xl font-bold text-emerald-700 tabular-nums">
              {kpis.completedCount}
            </p>
            <p className="mt-1 text-xs text-slate-500 tabular-nums">
              ปิดงานแล้ว {kpis.completionRate}% ของทั้งหมด
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-700 shrink-0">
            <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
          </div>
        </div>
      </section>

      {/* Filter & View Switcher Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหารหัสใบงาน, ผู้แจ้ง, อาการ, Asset Tag..."
              aria-label="ค้นหารายการแจ้งซ่อมในระบบแอดมิน"
              className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <label htmlFor="admin-status-filter" className="text-xs font-medium text-slate-600 whitespace-nowrap">
              สถานะ:
            </label>
            <select
              id="admin-status-filter"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as 'ทั้งหมด' | TicketStatus)
              }
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
            >
              <option value="ทั้งหมด">ทุกสถานะ</option>
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Urgency Filter */}
          <div className="flex items-center gap-2">
            <label htmlFor="admin-urgency-filter" className="text-xs font-medium text-slate-600 whitespace-nowrap">
              ความเร่งด่วน:
            </label>
            <select
              id="admin-urgency-filter"
              value={urgencyFilter}
              onChange={(e) =>
                setUrgencyFilter(e.target.value as 'ทั้งหมด' | UrgencyLevel)
              }
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
            >
              <option value="ทั้งหมด">ทุกระดับ</option>
              {URGENCY_LEVELS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* View Mode Switcher: Table vs Board vs Audit Log */}
        <div
          role="group"
          aria-label="รูปแบบการแสดงผล"
          className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200/80 self-start lg:self-auto shrink-0"
        >
          <button
            type="button"
            onClick={() => setViewLayout('table')}
            aria-pressed={viewLayout === 'table'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              viewLayout === 'table'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Table2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>ตารางงาน</span>
          </button>
          <button
            type="button"
            onClick={() => setViewLayout('board')}
            aria-pressed={viewLayout === 'board'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              viewLayout === 'board'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
            <span>บอร์ดสถานะ</span>
          </button>
          <button
            type="button"
            onClick={() => setViewLayout('audit')}
            aria-pressed={viewLayout === 'audit'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap tabular-nums ${
              viewLayout === 'audit'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <History className="w-3.5 h-3.5" aria-hidden="true" />
            <span>บันทึกตรวจสอบ ({auditLogs.length})</span>
          </button>
        </div>
      </div>

      {/* Main Content Area: Audit Log, Table, or Kanban Board */}
      {viewLayout === 'audit' ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {auditLogs.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              ยังไม่มีบันทึกประวัติการใช้งาน (Audit Log)
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4 whitespace-nowrap">วันเวลา</th>
                    <th className="py-3 px-4 whitespace-nowrap">กิจกรรม</th>
                    <th className="py-3 px-4 whitespace-nowrap">เป้าหมาย</th>
                    <th className="py-3 px-4 whitespace-nowrap">ผู้ดำเนินการ</th>
                    <th className="py-3 px-4">รายละเอียด</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 whitespace-nowrap text-slate-600 tabular-nums">
                        {formatThaiDateTime(log.createdAt)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-mono text-slate-800">
                        {log.action}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-mono text-slate-700">
                        {log.targetId}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-slate-700">
                        {log.actorEmail}
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        {log.summary}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : ticketsLoading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <Loader2 className="w-6 h-6 text-blue-700 animate-spin mx-auto" />
          <p className="text-sm text-slate-600">กำลังเชื่อมต่อข้อมูลงานซ่อมจาก Firestore...</p>
        </div>
      ) : filteredTickets.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3">
          <ClipboardList
            className="w-8 h-8 text-slate-400 mx-auto"
            aria-hidden="true"
          />
          <p className="text-base font-semibold text-slate-900">
            {tickets.length === 0
              ? 'ยังไม่มีใบแจ้งซ่อมในฐานข้อมูล Firestore'
              : 'ไม่พบรายการแจ้งซ่อมตามตัวกรองที่เลือก'}
          </p>
          <p className="text-sm text-slate-500">
            {tickets.length === 0
              ? 'สามารถกดเพิ่มข้อมูลตัวอย่าง 5 รายการเพื่อทดสอบระบบ หรือรอพนักงานส่งใบแจ้งซ่อมเข้ามาแบบ Real-time'
              : 'ลองล้างตัวกรองสถานะ ความเร่งด่วน หรือคำค้นหาเพื่อดูรายการทั้งหมด'}
          </p>
          {tickets.length === 0 ? (
            <button
              type="button"
              onClick={() => void handleSeedDemo()}
              disabled={seeding}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors"
            >
              <Database className="w-3.5 h-3.5" aria-hidden="true" />
              <span>โหลดข้อมูลตัวอย่าง 5 รายการลง Firestore</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('ทั้งหมด');
                setUrgencyFilter('ทั้งหมด');
              }}
              className="inline-flex items-center px-4 py-2 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
            >
              ล้างตัวกรองทั้งหมด
            </button>
          )}
        </div>
      ) : viewLayout === 'table' ? (
        /* Table View */
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                  <th className="py-3.5 px-4 whitespace-nowrap">รหัส / ความเร่งด่วน</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">ผู้แจ้ง / แผนก</th>
                  <th className="py-3.5 px-4 min-w-[260px]">ประเภทปัญหา / อาการเสีย</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">เวลาแจ้งซ่อม</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">เวลาซ่อมเสร็จ</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">สถานะ</th>
                  <th className="py-3.5 px-4 text-right whitespace-nowrap">จัดการงาน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredTickets.map((ticket) => (
                  <tr
                    key={ticket.id}
                    className="hover:bg-slate-50/70 transition-colors align-top"
                  >
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="font-mono font-semibold text-slate-900 tabular-nums">
                        {ticket.id}
                      </div>
                      <div className="mt-1">
                        <UrgencyIndicator urgency={ticket.urgency} />
                      </div>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="font-medium text-slate-900">
                        {ticket.requesterName}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        แผนก{ticket.department} · {ticket.contactInfo}
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-medium text-slate-900">
                          {ticket.category}
                        </span>
                        {ticket.assetTag && (
                          <>
                            <span className="text-slate-300" aria-hidden="true">
                              ·
                            </span>
                            <span className="font-mono text-xs text-slate-600">
                              {ticket.assetTag}
                            </span>
                          </>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 mt-1 line-clamp-2 max-w-md">
                        {ticket.description}
                      </p>
                      {ticket.aiTroubleshooting && (
                        <p className="text-xs text-slate-500 mt-1">
                          ผู้แจ้งลองทำตาม AI แล้ว {ticket.aiTroubleshooting.steps.length} ขั้นตอน
                        </p>
                      )}
                      {ticket.resolutionNote && (
                        <p className="text-xs text-blue-800 mt-1.5 line-clamp-1">
                          บันทึกแก้ไข: {ticket.resolutionNote}
                        </p>
                      )}
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap text-xs text-slate-600 tabular-nums">
                      {formatThaiDateTime(ticket.createdAt)}
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap text-xs text-slate-600 tabular-nums">
                      {formatThaiDateTime(ticket.completedAt)}
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <StatusIndicator status={ticket.status} />
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap text-right">
                      <div className="inline-flex items-center justify-end gap-2">
                        {ticket.status === 'รอดำเนินการ' && (
                          <button
                            type="button"
                            onClick={() => void handleQuickAcceptJob(ticket)}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap"
                          >
                            รับงาน
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedTicketId(ticket.id)}
                          className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
                        >
                          {ticket.status === 'เสร็จสิ้น'
                            ? 'ดูรายละเอียด'
                            : 'อัปเดตสถานะ'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Kanban Board View */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
          {TICKET_STATUSES.map((columnStatus) => {
            const columnTickets = filteredTickets.filter(
              (t) => t.status === columnStatus
            );
            return (
              <div
                key={columnStatus}
                className="bg-slate-100/80 border border-slate-200 rounded-xl p-3.5 space-y-3"
              >
                <div className="flex items-center justify-between px-1">
                  <StatusIndicator status={columnStatus} />
                  <span className="text-xs font-semibold text-slate-600 tabular-nums">
                    {columnTickets.length} งาน
                  </span>
                </div>

                {columnTickets.length === 0 ? (
                  <div className="bg-white/70 border border-dashed border-slate-300 rounded-lg p-6 text-center text-xs text-slate-500">
                    ไม่มีรายการในสถานะนี้
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {columnTickets.map((ticket) => (
                      <div
                        key={ticket.id}
                        className="bg-white border border-slate-200 rounded-lg p-3.5 space-y-2.5 hover:border-slate-300 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                            {ticket.id}
                          </span>
                          <UrgencyIndicator urgency={ticket.urgency} />
                        </div>

                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">
                            {ticket.category}
                          </h3>
                          <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                            {ticket.description}
                          </p>
                        </div>

                        <div className="text-[11px] text-slate-500 space-y-0.5 tabular-nums">
                          <div>
                            {ticket.requesterName} · แผนก{ticket.department}
                          </div>
                          <div>แจ้ง: {formatThaiDateTime(ticket.createdAt)}</div>
                          {ticket.completedAt && (
                            <div className="text-emerald-700">
                              เสร็จ: {formatThaiDateTime(ticket.completedAt)}
                            </div>
                          )}
                        </div>

                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                          {ticket.status === 'รอดำเนินการ' ? (
                            <button
                              type="button"
                              onClick={() => void handleQuickAcceptJob(ticket)}
                              className="flex-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors"
                            >
                              รับงาน
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setSelectedTicketId(ticket.id)}
                            className="flex-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-md transition-colors"
                          >
                            {ticket.status === 'เสร็จสิ้น'
                              ? 'ดูรายละเอียด'
                              : 'อัปเดต / ปิดงาน'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Slide-over Detail & Status Editor Drawer */}
      <TicketDetailDrawer
        user={user}
        ticket={selectedTicket}
        onClose={() => setSelectedTicketId(null)}
        onUpdateTicket={(id, updates) => {
          void onUpdateTicket(id, updates);
        }}
        onDeleteTicket={(id) => {
          void onDeleteTicket(id);
        }}
      />

      {/* Webhook Settings Modal */}
      <WebhookSettingsPanel
        isOpen={webhookModalOpen}
        user={user}
        onClose={() => setWebhookModalOpen(false)}
        onStatusChanged={onWebhookStatusChanged}
      />
    </div>
  );
}

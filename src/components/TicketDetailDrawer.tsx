import { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock,
  Loader2,
  Package,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import {
  AiDiagnosticResult,
  RepairTicket,
  TICKET_STATUSES,
  TicketStatus,
} from '../types/ticket';
import { formatThaiDateTime } from '../utils/formatters';
import { requestTechDiagnostic } from '../services/aiService';
import { StatusIndicator, UrgencyIndicator } from './StatusIndicator';

interface TicketDetailDrawerProps {
  user: User;
  ticket: RepairTicket | null;
  onClose: () => void;
  onUpdateTicket: (
    ticketId: string,
    updates: { status: TicketStatus; resolutionNote: string }
  ) => void;
  onDeleteTicket: (ticketId: string) => void;
}

const QUICK_RESOLUTION_TEMPLATES = [
  'ลง Windows 11 ใหม่และติดตั้งโปรแกรมพื้นฐานเรียบร้อย',
  'ตรวจสอบและเชื่อมต่อเครือข่าย Wi-Fi / LAN ใหม่เรียบร้อย',
  'แก้ไขคิวพิมพ์และตั้งค่าไดรเวอร์ปริ้นเตอร์เรียบร้อย',
  'เปลี่ยนอุปกรณ์ต่อพ่วง/อะไหล่ทดแทนเรียบร้อย',
  'อยู่ระหว่างเบิก/รอสั่งซื้ออะไหล่จากผู้จำหน่าย',
];

export function TicketDetailDrawer({
  user,
  ticket,
  onClose,
  onUpdateTicket,
  onDeleteTicket,
}: TicketDetailDrawerProps) {
  const [status, setStatus] = useState<TicketStatus>('รอดำเนินการ');
  const [resolutionNote, setResolutionNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // AI IT Diagnostic states
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [diagResult, setDiagResult] = useState<{
    data: AiDiagnosticResult;
    source: 'gemini' | 'fallback';
    notice?: string;
  } | null>(null);

  useEffect(() => {
    if (ticket) {
      setStatus(ticket.status);
      setResolutionNote(ticket.resolutionNote || '');
      setConfirmDelete(false);
      setDiagLoading(false);
      setDiagError(null);
      setDiagResult(null);
    }
  }, [ticket]);

  useEffect(() => {
    if (!ticket) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [ticket, onClose]);

  if (!ticket) return null;

  const handleRunDiagnostic = async () => {
    setDiagLoading(true);
    setDiagError(null);
    try {
      const response = await requestTechDiagnostic(user, ticket);
      setDiagResult({
        data: response.data,
        source: response.source,
        notice: response.notice,
      });
    } catch (err) {
      setDiagError(
        err instanceof Error
          ? err.message
          : 'ไม่สามารถวิเคราะห์เชิงลึกได้ในขณะนี้'
      );
    } finally {
      setDiagLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateTicket(ticket.id, {
      status,
      resolutionNote: resolutionNote.trim(),
    });
    onClose();
  };

  const handleQuickComplete = () => {
    const noteToSave =
      resolutionNote.trim() || 'ดำเนินการตรวจสอบและแก้ไขเรียบร้อย';
    onUpdateTicket(ticket.id, {
      status: 'เสร็จสิ้น',
      resolutionNote: noteToSave,
    });
    onClose();
  };

  const statusButtonIcon = (s: TicketStatus) => {
    switch (s) {
      case 'รอดำเนินการ':
        return <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />;
      case 'กำลังซ่อม':
        return <Wrench className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />;
      case 'รออะไหล่':
        return <Package className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />;
      case 'เสร็จสิ้น':
        return <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/35 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-ticket-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white h-full border-l border-slate-200 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span
              id="drawer-ticket-title"
              className="font-mono text-base font-semibold text-slate-900 tabular-nums"
            >
              {ticket.id}
            </span>
            <StatusIndicator status={ticket.status} />
            <UrgencyIndicator urgency={ticket.urgency} />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่างรายละเอียด"
            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Problem & Description */}
          <section className="space-y-2">
            <div className="text-xs font-medium text-slate-500">
              {ticket.category}
            </div>
            <p className="text-sm leading-relaxed text-slate-800 whitespace-pre-line">
              {ticket.description}
            </p>
          </section>

          {/* Metadata Table */}
          <section className="border-t border-b border-slate-200 py-4 grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
            <div>
              <div className="text-xs text-slate-500">ผู้แจ้งซ่อม</div>
              <div className="font-medium text-slate-900 mt-0.5">
                {ticket.requesterName}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">แผนก / ฝ่าย</div>
              <div className="font-medium text-slate-900 mt-0.5">
                {ticket.department}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">ช่องทางติดต่อ</div>
              <div className="font-medium text-slate-900 mt-0.5">
                {ticket.contactInfo}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">หมายเลขครุภัณฑ์ (Asset Tag)</div>
              <div className="font-mono text-slate-900 mt-0.5">
                {ticket.assetTag || 'ไม่ระบุ'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">เวลาที่แจ้งซ่อม</div>
              <div className="text-slate-900 tabular-nums mt-0.5">
                {formatThaiDateTime(ticket.createdAt)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">เวลาที่ซ่อมเสร็จ</div>
              <div className="text-slate-900 tabular-nums mt-0.5">
                {formatThaiDateTime(ticket.completedAt)}
              </div>
            </div>
          </section>

          {/* User's AI Attempt History (if attached) */}
          {ticket.aiTroubleshooting && (
            <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-900">
                  ประวัติขั้นตอนที่ผู้แจ้งทดลองทำตาม AI แล้ว
                </span>
                <span className="text-[11px] text-slate-500 tabular-nums">
                  {formatThaiDateTime(ticket.aiTroubleshooting.triedAt)}
                </span>
              </div>
              <ol className="space-y-1 text-xs text-slate-700 list-decimal list-inside">
                {ticket.aiTroubleshooting.steps.map((step, idx) => (
                  <li key={idx} className="leading-relaxed">
                    {step}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* AI Deep Diagnostic for IT Technician */}
          <section className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-slate-900">
                  AI วิเคราะห์เชิงลึกสำหรับช่าง (IT Diagnostic)
                </h3>
              </div>
              <button
                type="button"
                onClick={handleRunDiagnostic}
                disabled={diagLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
              >
                {diagLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    <span>กำลังวิเคราะห์...</span>
                  </>
                ) : (
                  <span>
                    {diagResult ? 'วิเคราะห์ใหม่อีกครั้ง' : 'เริ่มวิเคราะห์เชิงลึก'}
                  </span>
                )}
              </button>
            </div>

            {!diagResult && !diagLoading && !diagError && (
              <p className="text-xs text-slate-600">
                ให้ Gemini 2.5 Flash ช่วยสรุปสาเหตุหลัก (Root Cause) อุปกรณ์ที่ต้องเตรียมไปหน้างาน และแนวทางแก้ไขระดับเทคนิคสำหรับใบงานนี้
              </p>
            )}

            {diagError && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2 text-xs text-red-800"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{diagError}</span>
              </div>
            )}

            {diagResult && (
              <div className="space-y-3 pt-1">
                {diagResult.notice && (
                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                    {diagResult.notice}
                  </p>
                )}

                <div>
                  <h4 className="text-xs font-semibold text-slate-900">
                    1) สาเหตุหลักที่เป็นไปได้ (Root Cause)
                  </h4>
                  <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                    {diagResult.data.rootCause}
                  </p>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-slate-900">
                    2) อุปกรณ์ / โปรแกรมที่ควรเตรียมไปหน้างาน
                  </h4>
                  <ul className="mt-1 space-y-1 text-xs text-slate-700 list-disc list-inside">
                    {diagResult.data.toolsAndParts.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-slate-900">
                    3) แนวทางการแก้ไขระดับเทคนิค
                  </h4>
                  <ol className="mt-1 space-y-1 text-xs text-slate-700 list-decimal list-inside">
                    {diagResult.data.technicalSteps.map((step, idx) => (
                      <li key={idx} className="leading-relaxed">
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}
          </section>

          {/* Status Update */}
          <section className="space-y-2.5">
            <label className="block text-sm font-semibold text-slate-900">
              อัปเดตสถานะงานซ่อม
            </label>
            <div className="grid grid-cols-2 gap-2">
              {TICKET_STATUSES.map((item) => {
                const isSelected = status === item;
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setStatus(item)}
                    className={`inline-flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium rounded-lg border transition-colors ${
                      isSelected
                        ? 'bg-blue-50 border-blue-600 text-blue-800'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {statusButtonIcon(item)}
                    <span>{item}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Resolution Note */}
          <section className="space-y-2.5">
            <label
              htmlFor="resolution-note-input"
              className="block text-sm font-semibold text-slate-900"
            >
              บันทึกการแก้ไข / หมายเหตุจากเจ้าหน้าที่ไอที
            </label>
            <textarea
              id="resolution-note-input"
              rows={4}
              value={resolutionNote}
              onChange={(e) => setResolutionNote(e.target.value)}
              placeholder="เช่น ลง Windows 11 ใหม่เรียบร้อย, เปลี่ยนสาย LAN หรือรอเบิกอะไหล่..."
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
            <div className="space-y-1.5">
              <div className="text-xs text-slate-500">ข้อความด่วน (คลิกเพื่อเติม):</div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_RESOLUTION_TEMPLATES.map((template) => (
                  <button
                    key={template}
                    type="button"
                    onClick={() => setResolutionNote(template)}
                    className="text-left text-xs px-2.5 py-1.5 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                  >
                    {template}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Danger / Delete Zone */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-red-600 transition-colors py-1"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>ลบใบแจ้งซ่อมนี้</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-700 font-medium">
                  ยืนยันการลบใบงาน {ticket.id}?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onDeleteTicket(ticket.id);
                    onClose();
                  }}
                  className="px-2.5 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors"
                >
                  ยืนยันลบ
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-md"
                >
                  ยกเลิก
                </button>
              </div>
            )}
          </div>

          {/* Sticky Drawer Footer inside form */}
          <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
            >
              ยกเลิก
            </button>
            {status !== 'เสร็จสิ้น' && (
              <button
                type="button"
                onClick={handleQuickComplete}
                className="px-4 py-2 text-sm font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors"
              >
                ปิดงานเป็น &ldquo;เสร็จสิ้น&rdquo; ทันที
              </button>
            )}
            <button
              type="submit"
              className="px-5 py-2 text-sm font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors"
            >
              บันทึกการอัปเดต
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

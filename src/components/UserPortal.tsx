import { useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Download,
  FilePlus2,
  Loader2,
  Search,
  Send,
  Wrench,
} from 'lucide-react';
import {
  AiTroubleshootResult,
  DEPARTMENTS,
  Department,
  NewTicketInput,
  PROBLEM_CATEGORIES,
  ProblemCategory,
  RepairTicket,
  TICKET_STATUSES,
  TicketStatus,
  URGENCY_LEVELS,
  UrgencyLevel,
} from '../types/ticket';
import { formatThaiDateTime } from '../utils/formatters';
import { requestUserTroubleshoot } from '../services/aiService';
import {
  StatusIndicator,
  TicketProgressBar,
  UrgencyIndicator,
} from './StatusIndicator';

interface UserPortalProps {
  user: User;
  tickets: RepairTicket[];
  ticketsLoading: boolean;
  aiSelfResolvedCount: number;
  onCreateTicket: (input: NewTicketInput) => Promise<RepairTicket>;
  onAiSelfResolved: (category: ProblemCategory) => Promise<void>;
  onExportCsv: () => void;
}

export function UserPortal({
  user,
  tickets,
  ticketsLoading,
  aiSelfResolvedCount,
  onCreateTicket,
  onAiSelfResolved,
  onExportCsv,
}: UserPortalProps) {
  const [requesterName, setRequesterName] = useState(user.displayName || '');
  const [department, setDepartment] = useState<Department>('บัญชี');
  const [contactInfo, setContactInfo] = useState('');
  const [category, setCategory] = useState<ProblemCategory>(
    'คอมพิวเตอร์เปิดไม่ติด/จอดำ'
  );
  const [urgency, setUrgency] = useState<UrgencyLevel>('ปกติ');
  const [assetTag, setAssetTag] = useState('');
  const [description, setDescription] = useState('');

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastCreatedId, setLastCreatedId] = useState<string | null>(null);
  const [selfResolvedNotice, setSelfResolvedNotice] = useState<string | null>(null);

  // AI Troubleshooting Assistant states
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{
    data: AiTroubleshootResult;
    source: 'gemini' | 'fallback';
    notice?: string;
    triedAt: string;
  } | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ทั้งหมด' | TicketStatus>(
    'ทั้งหมด'
  );

  useEffect(() => {
    if (user.displayName && !requesterName) {
      setRequesterName(user.displayName);
    }
  }, [user.displayName, requesterName]);

  const validateRequiredTicketFields = (): boolean => {
    const errors: Record<string, string> = {};

    if (!requesterName.trim()) {
      errors.requesterName = 'กรุณาระบุชื่อผู้แจ้งซ่อม';
    }
    if (!contactInfo.trim()) {
      errors.contactInfo = 'กรุณาระบุเบอร์ติดต่อภายใน หรือ LINE ID';
    }
    if (!description.trim()) {
      errors.description = 'กรุณาระบุรายละเอียดอาการเสีย';
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return false;
    }
    return true;
  };

  const submitTicketToAdmin = async (attachAiHistory: boolean) => {
    if (!validateRequiredTicketFields()) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const created = await onCreateTicket({
        requesterName: requesterName.trim(),
        department,
        contactInfo: contactInfo.trim(),
        category,
        urgency,
        assetTag: assetTag.trim().toUpperCase(),
        description: description.trim(),
        aiTroubleshooting:
          attachAiHistory && aiResult
            ? {
                summary: aiResult.data.summary,
                steps: aiResult.data.steps,
                warningNote: aiResult.data.warningNote,
                source: aiResult.source,
                triedAt: aiResult.triedAt,
              }
            : null,
      });

      setLastCreatedId(created.id);
      setSelfResolvedNotice(null);
      setFormErrors({});
      setAssetTag('');
      setDescription('');
      setUrgency('ปกติ');
      setAiResult(null);
      setAiError(null);
      setStatusFilter('ทั้งหมด');
      setSearchQuery('');
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'ไม่สามารถบันทึกใบแจ้งซ่อมลงฐานข้อมูลได้ กรุณาลองใหม่อีกครั้ง'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitTicketToAdmin(Boolean(aiResult));
  };

  const handleAskAiTroubleshoot = async () => {
    if (!description.trim()) {
      setFormErrors((prev) => ({
        ...prev,
        description: 'กรุณาระบุรายละเอียดอาการเสียก่อนให้ AI ช่วยวิเคราะห์',
      }));
      return;
    }

    setFormErrors((prev) => ({ ...prev, description: '' }));
    setAiLoading(true);
    setAiError(null);
    setSelfResolvedNotice(null);

    try {
      const response = await requestUserTroubleshoot(user, category, description.trim());
      setAiResult({
        data: response.data,
        source: response.source,
        notice: response.notice,
        triedAt: new Date().toISOString(),
      });
    } catch (err) {
      setAiError(
        err instanceof Error
          ? err.message
          : 'ไม่สามารถเรียกใช้ผู้ช่วย AI ได้ในขณะนี้'
      );
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiResolvedSuccess = async () => {
    try {
      await onAiSelfResolved(category);
      setSelfResolvedNotice(
        `บันทึกสถิติเรียบร้อยแล้ว — ผู้ช่วย AI ช่วยแก้ไขปัญหาเบื้องต้นสำเร็จสะสม ${aiSelfResolvedCount + 1} ครั้ง`
      );
      setLastCreatedId(null);
      setAiResult(null);
      setAiError(null);
      setDescription('');
      setAssetTag('');
      setFormErrors({});
    } catch (err) {
      setAiError(
        err instanceof Error ? err.message : 'ไม่สามารถบันทึกสถิติได้'
      );
    }
  };

  const filteredTickets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tickets.filter((ticket) => {
      const matchesStatus =
        statusFilter === 'ทั้งหมด' || ticket.status === statusFilter;
      if (!matchesStatus) return false;
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
  }, [tickets, searchQuery, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ทั้งหมด: tickets.length };
    for (const s of TICKET_STATUSES) counts[s] = 0;
    for (const t of tickets) counts[t.status] = (counts[t.status] || 0) + 1;
    return counts;
  }, [tickets]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="space-y-1.5">
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
            แจ้งซ่อมคอมพิวเตอร์และอุปกรณ์ไอที
          </h1>
          <p className="text-sm sm:text-base text-slate-600 max-w-2xl">
            ส่งใบแจ้งซ่อมเข้าฐานข้อมูล Real-time พร้อมระบบ AI ช่วยแนะนำวิธีแก้เบื้องต้นและแจ้งเตือนเจ้าหน้าที่ทันที
          </p>
        </div>
        {tickets.length > 0 && (
          <button
            type="button"
            onClick={onExportCsv}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>ส่งออก CSV</span>
          </button>
        )}
      </div>

      {/* Main 2-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Repair Request Form + AI Assistant */}
        <section
          aria-labelledby="repair-form-heading"
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6"
        >
          <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <FilePlus2 className="w-5 h-5 text-blue-700 shrink-0" aria-hidden="true" />
              <h2
                id="repair-form-heading"
                className="text-lg font-semibold text-slate-900"
              >
                แบบฟอร์มแจ้งซ่อม
              </h2>
            </div>
            {aiSelfResolvedCount > 0 && (
              <span className="text-xs text-slate-500 tabular-nums">
                AI แก้สำเร็จแล้ว {aiSelfResolvedCount} ครั้ง
              </span>
            )}
          </div>

          {lastCreatedId && (
            <div
              role="status"
              className="mt-4 p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-2.5"
            >
              <CheckCircle2
                className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div className="text-sm text-emerald-900">
                <p className="font-semibold">
                  ส่งใบแจ้งซ่อมเรียบร้อยแล้ว (รหัส{' '}
                  <span className="font-mono">{lastCreatedId}</span>)
                </p>
                <p className="text-xs text-emerald-800 mt-0.5">
                  ข้อมูลถูกบันทึกขึ้นระบบ Real-time แล้ว สามารถติดตามสถานะได้ทันที
                </p>
              </div>
            </div>
          )}

          {selfResolvedNotice && (
            <div
              role="status"
              className="mt-4 p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-2.5"
            >
              <CheckCircle2
                className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div className="text-sm text-emerald-900">
                <p className="font-semibold">แก้ไขปัญหาด้วยตนเองสำเร็จ</p>
                <p className="text-xs text-emerald-800 mt-0.5">
                  {selfResolvedNotice}
                </p>
              </div>
            </div>
          )}

          {submitError && (
            <div
              role="alert"
              className="mt-4 p-3.5 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-800"
            >
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{submitError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
            {/* Requester & Department */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="requesterName"
                  className="block text-sm font-medium text-slate-800 mb-1.5"
                >
                  ชื่อผู้แจ้ง <span className="text-red-600">*</span>
                </label>
                <input
                  id="requesterName"
                  type="text"
                  maxLength={100}
                  value={requesterName}
                  onChange={(e) => {
                    setRequesterName(e.target.value);
                    if (formErrors.requesterName) {
                      setFormErrors((prev) => ({ ...prev, requesterName: '' }));
                    }
                  }}
                  placeholder="เช่น สมชาย ใจดี"
                  className={`w-full rounded-lg border px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/15 ${
                    formErrors.requesterName
                      ? 'border-red-500 focus:border-red-500'
                      : 'border-slate-300 focus:border-blue-600'
                  }`}
                />
                {formErrors.requesterName && (
                  <p className="mt-1 text-xs text-red-600">
                    {formErrors.requesterName}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="department"
                  className="block text-sm font-medium text-slate-800 mb-1.5"
                >
                  แผนก / ฝ่าย <span className="text-red-600">*</span>
                </label>
                <select
                  id="department"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value as Department)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                >
                  {DEPARTMENTS.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Contact Info & Asset Tag */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="contactInfo"
                  className="block text-sm font-medium text-slate-800 mb-1.5"
                >
                  เบอร์ภายใน / LINE ID <span className="text-red-600">*</span>
                </label>
                <input
                  id="contactInfo"
                  type="text"
                  maxLength={120}
                  value={contactInfo}
                  onChange={(e) => {
                    setContactInfo(e.target.value);
                    if (formErrors.contactInfo) {
                      setFormErrors((prev) => ({ ...prev, contactInfo: '' }));
                    }
                  }}
                  placeholder="เช่น ต่อ 214 หรือ LINE: somchai"
                  className={`w-full rounded-lg border px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/15 ${
                    formErrors.contactInfo
                      ? 'border-red-500 focus:border-red-500'
                      : 'border-slate-300 focus:border-blue-600'
                  }`}
                />
                {formErrors.contactInfo && (
                  <p className="mt-1 text-xs text-red-600">
                    {formErrors.contactInfo}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="assetTag"
                  className="block text-sm font-medium text-slate-800 mb-1.5"
                >
                  หมายเลขครุภัณฑ์ / Asset Tag
                </label>
                <input
                  id="assetTag"
                  type="text"
                  maxLength={64}
                  value={assetTag}
                  onChange={(e) => setAssetTag(e.target.value)}
                  placeholder="ถ้ามี เช่น IT-PC-042"
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-mono text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                />
              </div>
            </div>

            {/* Problem Category */}
            <div>
              <label
                htmlFor="category"
                className="block text-sm font-medium text-slate-800 mb-1.5"
              >
                ประเภทปัญหา <span className="text-red-600">*</span>
              </label>
              <select
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value as ProblemCategory)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              >
                {PROBLEM_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {/* Urgency Level */}
            <div>
              <span className="block text-sm font-medium text-slate-800 mb-1.5">
                ระดับความเร่งด่วน
              </span>
              <div
                role="radiogroup"
                aria-label="ระดับความเร่งด่วน"
                className="grid grid-cols-1 sm:grid-cols-3 gap-2"
              >
                {URGENCY_LEVELS.map((level) => {
                  const selected = urgency === level;
                  let activeClasses =
                    'bg-blue-50 border-blue-600 text-blue-800 font-semibold';
                  if (selected && level === 'ด่วน') {
                    activeClasses =
                      'bg-amber-50 border-amber-500 text-amber-900 font-semibold';
                  } else if (selected && level === 'ด่วนมาก - ทำงานต่อไม่ได้') {
                    activeClasses =
                      'bg-red-50 border-red-600 text-red-800 font-semibold';
                  }

                  return (
                    <button
                      key={level}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setUrgency(level)}
                      className={`px-3 py-2 text-xs rounded-lg border text-center transition-colors ${
                        selected
                          ? activeClasses
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {level === 'ด่วนมาก - ทำงานต่อไม่ได้'
                        ? 'ด่วนมาก (ทำงานไม่ได้)'
                        : level}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="description"
                className="block text-sm font-medium text-slate-800 mb-1.5"
              >
                รายละเอียดอาการเสีย <span className="text-red-600">*</span>
              </label>
              <textarea
                id="description"
                rows={4}
                maxLength={2000}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (formErrors.description) {
                    setFormErrors((prev) => ({ ...prev, description: '' }));
                  }
                }}
                placeholder="อธิบายอาการที่พบ ข้อความ Error ที่ขึ้น หรือช่วงเวลาที่เริ่มเกิดปัญหา..."
                className={`w-full rounded-lg border px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/15 ${
                  formErrors.description
                    ? 'border-red-500 focus:border-red-500'
                    : 'border-slate-300 focus:border-blue-600'
                }`}
              />
              {formErrors.description && (
                <p className="mt-1 text-xs text-red-600">
                  {formErrors.description}
                </p>
              )}

              {/* AI Troubleshooting Trigger Button */}
              <div className="mt-2.5">
                <button
                  type="button"
                  onClick={handleAskAiTroubleshoot}
                  disabled={aiLoading || submitting}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs sm:text-sm font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {aiLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
                      <span>กำลังวิเคราะห์อาการและแนะนำวิธีแก้...</span>
                    </>
                  ) : (
                    <>
                      <Bot className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>ให้ AI ช่วยวิเคราะห์และแนะนำวิธีแก้เบื้องต้น</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* AI Error Display */}
            {aiError && (
              <div
                role="alert"
                className="p-3.5 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-800"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="font-semibold">ไม่สามารถวิเคราะห์ด้วย AI ได้</p>
                  <p className="mt-0.5">{aiError}</p>
                </div>
              </div>
            )}

            {/* AI Step-by-Step Troubleshooting Panel */}
            {aiResult && (
              <div
                aria-live="polite"
                className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-slate-900">
                      คำแนะนำการแก้ไขเบื้องต้น (AI ผู้ช่วยซ่อม)
                    </h3>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 shrink-0">
                    {aiResult.source === 'gemini' ? 'gemini-2.5-flash' : 'โหมดจำลอง'}
                  </span>
                </div>

                {aiResult.notice && (
                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                    {aiResult.notice}
                  </p>
                )}

                <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
                  {aiResult.data.summary}
                </p>

                <ol className="space-y-2 text-xs sm:text-sm text-slate-800">
                  {aiResult.data.steps.map((step, index) => (
                    <li key={index} className="flex items-start gap-2.5">
                      <span className="font-mono text-xs font-semibold text-blue-700 bg-white border border-blue-200 rounded w-5 h-5 flex items-center justify-center shrink-0 mt-0.5 tabular-nums">
                        {index + 1}
                      </span>
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>

                {aiResult.data.warningNote && (
                  <p className="text-xs text-slate-600 pt-2 border-t border-blue-200/70">
                    <span className="font-semibold text-slate-800">ข้อควรระวัง: </span>
                    {aiResult.data.warningNote}
                  </p>
                )}

                {/* 2 Action Buttons under AI guidance */}
                <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void handleAiResolvedSuccess()}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-lg hover:bg-emerald-100 disabled:opacity-60 transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>แก้ไขได้แล้ว (ไม่ต้องแจ้งช่าง)</span>
                  </button>

                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void submitTicketToAdmin(true)}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-60 transition-colors"
                  >
                    {submitting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />
                    ) : (
                      <Wrench className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <span>ลองแล้วยังไม่ได้ผล (ส่งเรื่องให้ช่างไอที)</span>
                  </button>
                </div>
              </div>
            )}

            {!aiResult && (
              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-60 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
                    <span>กำลังบันทึกใบแจ้งซ่อม...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>ส่งใบแจ้งซ่อม</span>
                  </>
                )}
              </button>
            )}
          </form>
        </section>

        {/* Right Column: My Tickets Tracker */}
        <section
          aria-labelledby="my-tickets-heading"
          className="lg:col-span-7 space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2
                id="my-tickets-heading"
                className="text-lg font-semibold text-slate-900"
              >
                ติดตามสถานะงานซ่อม (My Tickets)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                แสดง {filteredTickets.length} จากทั้งหมด {tickets.length} รายการ (ซิงค์อัปเดต Real-time)
              </p>
            </div>

            <div className="relative w-full sm:w-64">
              <Search
                className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาชื่อ, รหัส, อาการ..."
                aria-label="ค้นหารายการแจ้งซ่อม"
                className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
            </div>
          </div>

          {/* Interactive Filter Tabs */}
          <div
            role="tablist"
            aria-label="กรองตามสถานะงานซ่อม"
            className="flex items-center gap-1.5 overflow-x-auto pb-1"
          >
            {(['ทั้งหมด', ...TICKET_STATUSES] as const).map((tab) => {
              const active = statusFilter === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setStatusFilter(tab)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                    active
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  {tab} ({statusCounts[tab] ?? 0})
                </button>
              );
            })}
          </div>

          {/* Ticket List */}
          {ticketsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 animate-pulse"
                >
                  <div className="h-4 w-32 bg-slate-200 rounded" />
                  <div className="h-5 w-48 bg-slate-200 rounded" />
                  <div className="h-3 w-full bg-slate-100 rounded" />
                </div>
              ))}
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
              <p className="text-sm font-medium text-slate-800">
                {tickets.length === 0
                  ? 'ยังไม่มีรายการแจ้งซ่อมของคุณในระบบ'
                  : 'ไม่พบรายการแจ้งซ่อมที่ตรงกับเงื่อนไข'}
              </p>
              <p className="text-xs text-slate-500">
                {tickets.length === 0
                  ? 'กรอกแบบฟอร์มด้านซ้ายเพื่อส่งใบแจ้งซ่อมแรกของคุณ'
                  : 'ลองเปลี่ยนคำค้นหา หรือเลือกดูสถานะทั้งหมด'}
              </p>
              {tickets.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setStatusFilter('ทั้งหมด');
                  }}
                  className="inline-flex items-center px-4 py-2 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  แสดงรายการทั้งหมด
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTickets.map((ticket) => {
                const isNew = ticket.id === lastCreatedId;
                return (
                  <article
                    key={ticket.id}
                    className={`bg-white rounded-xl p-5 border transition-colors ${
                      isNew
                        ? 'border-blue-500 ring-2 ring-blue-500/10'
                        : 'border-slate-200'
                    }`}
                  >
                    {/* Card Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                          {ticket.id}
                        </span>
                        <UrgencyIndicator urgency={ticket.urgency} />
                      </div>
                      <StatusIndicator status={ticket.status} />
                    </div>

                    {/* Problem Category & Description */}
                    <div className="mt-2.5 space-y-1">
                      <h3 className="text-base font-semibold text-slate-900">
                        {ticket.category}
                      </h3>
                      <p className="text-sm text-slate-600 leading-relaxed">
                        {ticket.description}
                      </p>
                    </div>

                    {/* Unboxed Metadata Line */}
                    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 tabular-nums">
                      <span>ผู้แจ้ง: {ticket.requesterName}</span>
                      <span aria-hidden="true">·</span>
                      <span>แผนก{ticket.department}</span>
                      {ticket.assetTag && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-slate-700">
                            {ticket.assetTag}
                          </span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>แจ้งเมื่อ {formatThaiDateTime(ticket.createdAt)}</span>
                      {ticket.aiTroubleshooting && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-blue-700 font-medium">
                            แนบประวัติคำแนะนำ AI ({ticket.aiTroubleshooting.steps.length} ขั้นตอน)
                          </span>
                        </>
                      )}
                    </div>

                    {/* 4-Step Progress Bar */}
                    <TicketProgressBar status={ticket.status} />

                    {/* IT Technician Resolution Note (if any) */}
                    {(ticket.resolutionNote || ticket.completedAt) && (
                      <div className="mt-3.5 pt-3 border-t border-slate-100 text-xs space-y-1">
                        {ticket.resolutionNote && (
                          <p className="text-slate-700">
                            <span className="font-semibold text-slate-900">
                              บันทึกจากเจ้าหน้าที่ไอที:{' '}
                            </span>
                            {ticket.resolutionNote}
                          </p>
                        )}
                        {ticket.completedAt && (
                          <p className="text-emerald-700 tabular-nums">
                            ซ่อมเสร็จเมื่อ {formatThaiDateTime(ticket.completedAt)}
                          </p>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

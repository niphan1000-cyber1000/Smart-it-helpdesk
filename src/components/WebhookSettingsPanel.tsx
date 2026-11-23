import { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  Loader2,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import {
  clearWebhookConfig,
  fetchWebhookStatus,
  saveWebhookConfig,
  sendWebhookTest,
  WebhookStatusResponse,
  WebhookType,
} from '../services/webhookService';

interface WebhookSettingsPanelProps {
  isOpen: boolean;
  user: User;
  onClose: () => void;
  onStatusChanged?: (configured: boolean) => void;
}

export function WebhookSettingsPanel({
  isOpen,
  user,
  onClose,
  onStatusChanged,
}: WebhookSettingsPanelProps) {
  const [status, setStatus] = useState<WebhookStatusResponse | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [typeInput, setTypeInput] = useState<WebhookType>('auto');
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setFeedback(null);
    fetchWebhookStatus(user)
      .then((res) => {
        setStatus(res);
        setTypeInput(res.type);
        onStatusChanged?.(res.configured);
      })
      .catch((err) => {
        setFeedback({
          type: 'error',
          message: err instanceof Error ? err.message : 'โหลดสถานะ Webhook ไม่สำเร็จ',
        });
      });
  }, [isOpen, user, onStatusChanged]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setFeedback(null);
    try {
      const updated = await saveWebhookConfig(user, urlInput, typeInput);
      setStatus(updated);
      setUrlInput('');
      onStatusChanged?.(updated.configured);
      setFeedback({
        type: 'success',
        message: 'บันทึก Webhook URL เรียบร้อยแล้ว ระบบจะยิงแจ้งเตือนทันทีเมื่อมีใบแจ้งซ่อมใหม่',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const updated = await clearWebhookConfig(user);
      setStatus(updated);
      onStatusChanged?.(updated.configured);
      setFeedback({
        type: 'success',
        message: 'ยกเลิกการเชื่อมต่อ Webhook ชั่วคราวแล้ว',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'ยกเลิกไม่สำเร็จ',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      const res = await sendWebhookTest(user);
      setFeedback({ type: 'success', message: res.message });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'ทดสอบส่งไม่สำเร็จ',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="webhook-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <BellRing className="w-5 h-5 text-blue-700 shrink-0" aria-hidden="true" />
            <h2
              id="webhook-modal-title"
              className="text-base font-semibold text-slate-900"
            >
              ตั้งค่าแจ้งเตือนทันทีผ่าน Webhook
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่างตั้งค่า Webhook"
            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4">
          {/* Current Status */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-800">สถานะปัจจุบัน:</span>
              <span
                className={`font-semibold ${
                  status?.configured ? 'text-emerald-700' : 'text-slate-500'
                }`}
              >
                {status?.configured ? 'เชื่อมต่อแล้ว' : 'ยังไม่ได้ตั้งค่า'}
              </span>
            </div>
            {status?.configured && (
              <p className="text-slate-600 font-mono truncate">
                ปลายทาง ({status.source === 'env' ? 'ENV' : 'Runtime'}):{' '}
                {status.maskedUrl}
              </p>
            )}
          </div>

          {feedback && (
            <div
              role="status"
              className={`p-3 rounded-lg border flex items-start gap-2 text-xs ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}

          <div>
            <label
              htmlFor="webhook-type"
              className="block text-sm font-medium text-slate-800 mb-1.5"
            >
              รูปแบบปลายทาง Webhook
            </label>
            <select
              id="webhook-type"
              value={typeInput}
              onChange={(e) => setTypeInput(e.target.value as WebhookType)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
            >
              <option value="auto">ตรวจจับอัตโนมัติ (Discord / Telegram / Custom)</option>
              <option value="discord">Discord Webhook (Embed Card)</option>
              <option value="telegram">Telegram Bot API (HTML Message)</option>
              <option value="custom">Custom JSON (LINE Gateway / n8n / Make / Slack)</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="webhook-url"
              className="block text-sm font-medium text-slate-800 mb-1.5"
            >
              Webhook URL (HTTPS)
            </label>
            <input
              id="webhook-url"
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-mono text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
            <p className="mt-1.5 text-xs text-slate-500">
              URL จะถูกเก็บไว้ฝั่งเซิร์ฟเวอร์เท่านั้น ไม่เปิดเผยไปยังฝั่งผู้ใช้งาน (การตั้งค่าในหน้านี้เป็น Runtime Memory สำหรับทดสอบ หากใช้งานหลาย Instance/Production แนะนำให้กำหนดตัวแปร WEBHOOK_URL ใน Secret Manager / Environment)
            </p>
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100">
            <div className="flex items-center gap-2">
              {status?.configured && (
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testing}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-60"
                >
                  {testing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>ทดสอบส่ง</span>
                </button>
              )}
              {status?.source === 'runtime' && (
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={loading}
                  className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-slate-600 hover:text-red-600"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>ล้างค่า</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                ปิด
              </button>
              <button
                type="submit"
                disabled={loading || !urlInput.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg"
              >
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>บันทึก Webhook</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

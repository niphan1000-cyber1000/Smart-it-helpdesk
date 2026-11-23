import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Minus,
  Package,
  Wrench,
} from 'lucide-react';
import { TicketStatus, UrgencyLevel } from '../types/ticket';

interface StatusIndicatorProps {
  status: TicketStatus;
}

export function StatusIndicator({ status }: StatusIndicatorProps) {
  const config: Record<
    TicketStatus,
    { label: string; classes: string; Icon: typeof Clock }
  > = {
    รอดำเนินการ: {
      label: 'รอดำเนินการ',
      classes: 'bg-slate-100 text-slate-700 border-slate-200',
      Icon: Clock,
    },
    กำลังซ่อม: {
      label: 'กำลังซ่อม',
      classes: 'bg-blue-50 text-blue-700 border-blue-200',
      Icon: Wrench,
    },
    รออะไหล่: {
      label: 'รออะไหล่',
      classes: 'bg-amber-50 text-amber-800 border-amber-200',
      Icon: Package,
    },
    เสร็จสิ้น: {
      label: 'เสร็จสิ้น',
      classes: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      Icon: CheckCircle2,
    },
  };

  const { label, classes, Icon } = config[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 ${classes}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

interface UrgencyIndicatorProps {
  urgency: UrgencyLevel;
}

export function UrgencyIndicator({ urgency }: UrgencyIndicatorProps) {
  if (urgency === 'ด่วนมาก - ทำงานต่อไม่ได้') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 whitespace-nowrap shrink-0">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>ด่วนมาก</span>
      </span>
    );
  }

  if (urgency === 'ด่วน') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 whitespace-nowrap shrink-0">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>ด่วน</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 whitespace-nowrap shrink-0">
      <Minus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>ปกติ</span>
    </span>
  );
}

interface TicketProgressBarProps {
  status: TicketStatus;
}

const PROGRESS_STEPS: TicketStatus[] = [
  'รอดำเนินการ',
  'กำลังซ่อม',
  'รออะไหล่',
  'เสร็จสิ้น',
];

export function TicketProgressBar({ status }: TicketProgressBarProps) {
  const currentIndex = PROGRESS_STEPS.indexOf(status);

  return (
    <div className="pt-3" aria-label={`สถานะปัจจุบัน: ${status}`}>
      <div className="grid grid-cols-4 gap-1.5">
        {PROGRESS_STEPS.map((step, index) => {
          const isCompleted = status === 'เสร็จสิ้น' || index < currentIndex;
          const isCurrent = index === currentIndex;
          const isSkippedSpareParts =
            step === 'รออะไหล่' && status === 'เสร็จสิ้น';

          let barColor = 'bg-slate-200';
          let textColor = 'text-slate-400';

          if (status === 'เสร็จสิ้น') {
            barColor = 'bg-emerald-600';
            textColor = isSkippedSpareParts ? 'text-slate-400' : 'text-emerald-700 font-medium';
          } else if (isCurrent) {
            if (step === 'รออะไหล่') {
              barColor = 'bg-amber-500';
              textColor = 'text-amber-800 font-semibold';
            } else if (step === 'กำลังซ่อม') {
              barColor = 'bg-blue-600';
              textColor = 'text-blue-700 font-semibold';
            } else {
              barColor = 'bg-slate-700';
              textColor = 'text-slate-900 font-semibold';
            }
          } else if (isCompleted) {
            barColor = 'bg-blue-600';
            textColor = 'text-slate-700 font-medium';
          }

          return (
            <div key={step} className="flex flex-col gap-1.5">
              <div className={`h-1.5 w-full rounded-sm transition-colors duration-200 ${barColor}`} />
              <span className={`text-[11px] leading-tight truncate ${textColor}`}>
                {step}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

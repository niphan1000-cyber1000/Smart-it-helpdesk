import { User } from 'firebase/auth';
import { LogIn, LogOut, MonitorCog, ShieldCheck, UserCheck } from 'lucide-react';
import { AppViewMode } from '../types/ticket';

interface HeaderProps {
  activeMode: AppViewMode;
  onModeChange: (mode: AppViewMode) => void;
  user: User | null;
  isAdmin: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
}

export function Header({
  activeMode,
  onModeChange,
  user,
  isAdmin,
  onSignIn,
  onSignOut,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4 sm:gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
          <MonitorCog className="w-5 h-5 text-blue-700 shrink-0" aria-hidden="true" />
          <span className="font-display text-base sm:text-lg font-bold tracking-tight text-slate-900">
            ศูนย์แจ้งซ่อมไอที
          </span>
        </div>

        {/* Zone 2: Mode Switcher (User vs IT Admin) */}
        <nav
          aria-label="สลับมุมมองการใช้งาน"
          className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200/80 shrink-0"
        >
          <button
            type="button"
            onClick={() => onModeChange('user')}
            aria-pressed={activeMode === 'user'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all duration-150 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
              activeMode === 'user'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="hidden md:inline">หน้าสำหรับผู้แจ้งซ่อม (User)</span>
            <span className="md:hidden">ผู้แจ้งซ่อม</span>
          </button>

          {user && isAdmin && (
            <button
              type="button"
              onClick={() => onModeChange('admin')}
              aria-pressed={activeMode === 'admin'}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all duration-150 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                activeMode === 'admin'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden md:inline">หน้าสำหรับเจ้าหน้าที่ไอที (IT Admin)</span>
              <span className="md:hidden">เจ้าหน้าที่ไอที</span>
            </button>
          )}
        </nav>

        {/* Zone 3: Single Primary Account Action */}
        <div className="flex items-center gap-3 shrink-0">
          {user ? (
            <div className="flex items-center gap-3">
              <span className="hidden lg:inline text-xs text-slate-600 max-w-[180px] truncate">
                {user.email}
              </span>
              <button
                type="button"
                onClick={onSignOut}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>ออกจากระบบ</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
            >
              <LogIn className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>เข้าสู่ระบบ</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

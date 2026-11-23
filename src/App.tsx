import { useCallback, useEffect, useState } from 'react';
import { onIdTokenChanged, User } from 'firebase/auth';
import {
  BellRing,
  CheckCircle2,
  Database,
  Loader2,
  LogIn,
  MonitorCog,
  ShieldCheck,
} from 'lucide-react';
import { Header } from './components/Header';
import { UserPortal } from './components/UserPortal';
import { AdminDashboard } from './components/AdminDashboard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { auth, signInWithGoogle, signOutUser } from './firebase';
import {
  createTicketInFirestore,
  deleteTicketInFirestore,
  logAiSelfResolutionInFirestore,
  resolveUserAccess,
  seedDemoTicketsToFirestore,
  subscribeToAiResolutionsCount,
  subscribeToAuditLogs,
  subscribeToTickets,
  updateTicketInFirestore,
} from './services/ticketService';
import {
  fetchWebhookStatus,
  notifyTicketWebhook,
} from './services/webhookService';
import {
  AppViewMode,
  AuditLogEntry,
  canAccessAdminDashboard,
  getPermissionsForRole,
  hasPermission,
  NewTicketInput,
  Permission,
  ProblemCategory,
  RepairTicket,
  TicketStatus,
} from './types/ticket';
import { exportTicketsToCsv } from './utils/csvExport';

export default function App() {
  const [activeMode, setActiveMode] = useState<AppViewMode>('user');
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [permissions, setPermissions] = useState<Permission[]>(() =>
    getPermissionsForRole('employee')
  );

  const [tickets, setTickets] = useState<RepairTicket[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [aiSelfResolvedCount, setAiSelfResolvedCount] = useState(0);
  const [webhookConfigured, setWebhookConfigured] = useState(false);

  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [refreshingAccess, setRefreshingAccess] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const isAdmin = canAccessAdminDashboard(permissions);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
  }, []);

  // Firebase ID Token listener (reacts to Custom Claims admin: true updates + API session check)
  useEffect(() => {
    let active = true;
    const unsubscribe = onIdTokenChanged(auth, async (nextUser) => {
      if (!active) return;
      setUser(nextUser);
      if (nextUser) {
        const access = await resolveUserAccess(nextUser);
        if (!active) return;
        setPermissions(access.permissions);
        const adminAllowed = canAccessAdminDashboard(access.permissions);
        if (!adminAllowed) {
          setActiveMode('user');
        }
        if (hasPermission(access.permissions, 'webhook:manage')) {
          fetchWebhookStatus(nextUser)
            .then((res) => {
              if (active) setWebhookConfigured(res.configured);
            })
            .catch(() => {});
        } else {
          setWebhookConfigured(false);
        }
      } else {
        setPermissions(getPermissionsForRole('employee'));
        setActiveMode('user');
        setTickets([]);
        setAuditLogs([]);
        setAiSelfResolvedCount(0);
        setWebhookConfigured(false);
        setTicketsLoading(false);
      }
      if (active) setAuthReady(true);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const handleRefreshAccess = useCallback(async () => {
    if (!user) return;
    setRefreshingAccess(true);
    try {
      const access = await resolveUserAccess(user, true);
      setPermissions(access.permissions);
      const adminAllowed = hasPermission(access.permissions, 'ticket:read_all');
      if (adminAllowed) {
        if (hasPermission(access.permissions, 'webhook:manage')) {
          fetchWebhookStatus(user)
            .then((res) => setWebhookConfigured(res.configured))
            .catch(() => {});
        }
        showToast(
          access.hasAdminClaim
            ? 'ยืนยันสิทธิ์เจ้าหน้าที่ไอที (Custom Claim: admin) เรียบร้อยแล้ว'
            : 'ยืนยันสิทธิ์เจ้าหน้าที่ไอทีเรียบร้อยแล้ว'
        );
      } else {
        setActiveMode('user');
        showToast('ยังไม่พบสิทธิ์เจ้าหน้าที่ไอทีในโทเค็นปัจจุบัน');
      }
    } finally {
      setRefreshingAccess(false);
    }
  }, [user, showToast]);

  // Real-time Firestore listeners (unified RBAC permissions)
  useEffect(() => {
    if (!authReady || !user) return;
    setTicketsLoading(true);

    const canReadAll = hasPermission(permissions, 'ticket:read_all');
    const canReadAudit = hasPermission(permissions, 'audit:read');

    const unsubTickets = subscribeToTickets(
      user,
      canReadAll,
      (list) => {
        setTickets(list);
        setTicketsLoading(false);
      },
      (err) => {
        setTicketsLoading(false);
        showToast(err.message);
      }
    );

    const unsubAiStats = subscribeToAiResolutionsCount(
      user,
      canReadAll,
      (count) => setAiSelfResolvedCount(count)
    );

    const unsubAudit = canReadAudit
      ? subscribeToAuditLogs((logs) => setAuditLogs(logs))
      : () => {};

    return () => {
      unsubTickets();
      unsubAiStats();
      unsubAudit();
    };
  }, [authReady, user, permissions, showToast]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  const handleSignIn = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : 'ไม่สามารถเข้าสู่ระบบด้วย Google ได้ กรุณาลองใหม่'
      );
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOutUser();
    setActiveMode('user');
  };

  const handleCreateTicket = async (
    input: NewTicketInput
  ): Promise<RepairTicket> => {
    if (!user) {
      throw new Error('กรุณาเข้าสู่ระบบก่อนส่งใบแจ้งซ่อม');
    }

    const created = await createTicketInFirestore(user, input);

    // Notify Webhook server-side using verified ticketId only
    let webhookNote = '';
    try {
      const hookResult = await notifyTicketWebhook(user, created.id);
      if (hookResult.sent) {
        webhookNote = ' และส่งแจ้งเตือน Webhook แล้ว';
      }
    } catch {
      // Do not fail ticket creation if external webhook endpoint is unreachable
    }

    showToast(`สร้างใบแจ้งซ่อม ${created.id} เรียบร้อยแล้ว${webhookNote}`);
    return created;
  };

  const handleAiSelfResolved = async (category: ProblemCategory) => {
    if (!user) return;
    await logAiSelfResolutionInFirestore(user, category);
    showToast(`บันทึกสถิติ: แก้ไขปัญหา "${category}" ด้วย AI สำเร็จแล้ว`);
  };

  const handleUpdateTicket = async (
    ticketId: string,
    updates: { status: TicketStatus; resolutionNote: string }
  ) => {
    if (!user) return;
    const target = tickets.find((t) => t.id === ticketId);
    await updateTicketInFirestore(
      user,
      ticketId,
      updates,
      target?.completedAt ?? null
    );
    showToast(`อัปเดตสถานะ ${ticketId} เป็น "${updates.status}" เรียบร้อย`);
  };

  const handleDeleteTicket = async (ticketId: string) => {
    if (!user) return;
    await deleteTicketInFirestore(user, ticketId);
    showToast(`ลบใบแจ้งซ่อม ${ticketId} แล้ว`);
  };

  const handleExportCsv = (listToExport?: RepairTicket[]) => {
    const target =
      listToExport && listToExport.length > 0 ? listToExport : tickets;
    if (target.length === 0) return;
    exportTicketsToCsv(target);
    showToast(`ส่งออกรายงาน CSV จำนวน ${target.length} รายการเรียบร้อย`);
  };

  const handleSeedDemoData = async () => {
    if (!user) return;
    await seedDemoTicketsToFirestore(user);
    showToast('เพิ่มข้อมูลตัวอย่าง 5 รายการลง Firestore เรียบร้อยแล้ว');
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
        <Header
          activeMode={activeMode}
          onModeChange={(mode) => {
            if (mode === 'admin' && !isAdmin) return;
            setActiveMode(mode);
          }}
          user={user}
          isAdmin={isAdmin}
          onSignIn={() => void handleSignIn()}
          onSignOut={() => void handleSignOut()}
        />

        <main className="flex-1">
          {!authReady ? (
            <div className="max-w-md mx-auto px-4 py-24 text-center space-y-3">
              <Loader2 className="w-7 h-7 text-blue-700 animate-spin mx-auto" />
              <p className="text-sm text-slate-600">
                กำลังตรวจสอบสถานะการเข้าสู่ระบบ...
              </p>
            </div>
          ) : !user ? (
            <div className="max-w-xl mx-auto px-4 sm:px-6 py-16">
              <div className="bg-white border border-slate-200 rounded-xl p-8 space-y-6">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 text-blue-700 text-xs font-semibold">
                    <MonitorCog className="w-4 h-4" aria-hidden="true" />
                    <span>IT Helpdesk &amp; Repair Ticketing</span>
                  </div>
                  <h1 className="font-display text-2xl font-bold text-slate-900">
                    เข้าสู่ระบบศูนย์บริการแจ้งซ่อมไอที
                  </h1>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    เข้าสู่ระบบด้วยบัญชี Google เพื่อบันทึกข้อมูลใบแจ้งซ่อมแบบ Real-time ข้ามเครื่องระหว่างแผนก พร้อมระบบ AI ช่วยซ่อมเบื้องต้นและแจ้งเตือน Webhook ทันที
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100 text-xs text-slate-600">
                  <div className="flex items-start gap-2">
                    <Database className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>ซิงค์ข้อมูลข้ามเครื่องผ่าน Cloud Firestore</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <BellRing className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>ยิงแจ้งเตือน Webhook ทันทีเมื่อมีใบงานใหม่</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>แยกสิทธิ์ผู้แจ้งซ่อมและเจ้าหน้าที่ไอทีชัดเจน</span>
                  </div>
                </div>

                {authError && (
                  <p role="alert" className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                    {authError}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => void handleSignIn()}
                  disabled={signingIn}
                  className="w-full inline-flex items-center justify-center gap-2.5 px-5 py-3 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors"
                >
                  {signingIn ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <LogIn className="w-4 h-4" aria-hidden="true" />
                  )}
                  <span>เข้าสู่ระบบด้วยบัญชี Google</span>
                </button>
              </div>
            </div>
          ) : activeMode === 'user' || !isAdmin ? (
            <UserPortal
              user={user}
              tickets={tickets}
              ticketsLoading={ticketsLoading}
              aiSelfResolvedCount={aiSelfResolvedCount}
              onCreateTicket={handleCreateTicket}
              onAiSelfResolved={handleAiSelfResolved}
              onExportCsv={() => handleExportCsv(tickets)}
            />
          ) : (
            <AdminDashboard
              user={user}
              permissions={permissions}
              tickets={tickets}
              auditLogs={auditLogs}
              ticketsLoading={ticketsLoading}
              aiSelfResolvedCount={aiSelfResolvedCount}
              webhookConfigured={webhookConfigured}
              onWebhookStatusChanged={setWebhookConfigured}
              onUpdateTicket={handleUpdateTicket}
              onDeleteTicket={handleDeleteTicket}
              onExportCsv={handleExportCsv}
              onSeedDemoData={handleSeedDemoData}
              onSwitchToUser={() => setActiveMode('user')}
              onRefreshAccess={handleRefreshAccess}
              refreshingAccess={refreshingAccess}
            />
          )}
        </main>

        <footer className="border-t border-slate-200 bg-white mt-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
            <span>ระบบแจ้งซ่อมคอมพิวเตอร์และอุปกรณ์ไอที</span>
            <span>ซิงค์ข้อมูล Real-time ผ่าน Firebase Firestore</span>
          </div>
        </footer>

        {/* Non-intrusive Action Toast */}
        {toastMessage && (
          <div
            role="status"
            aria-live="polite"
            className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 bg-slate-900 text-white text-xs sm:text-sm font-medium px-4 py-3 rounded-lg shadow-lg border border-slate-700"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
            <span>{toastMessage}</span>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}

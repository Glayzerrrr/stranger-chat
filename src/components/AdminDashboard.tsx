'use client';

import { useState, useMemo, useCallback, type FormEvent } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { Message } from '@/lib/types';

export type AdminReport = {
  id: string;
  reporter_id: string;
  reporter_email: string | null;
  reported_id: string;
  reported_email: string | null;
  reported_is_banned: boolean;
  reported_report_count: number;
  room_id: string;
  chat_log: Message[] | null;
  reason: string | null;
  status: 'pending' | 'reviewed' | 'dismissed';
  created_at: string;
};

export type AdminProfile = {
  id: string;
  email: string | null;
  is_banned: boolean;
  ban_reason: string | null;
  report_count: number;
  is_admin: boolean;
  created_at: string;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AdminDashboard({
  initialReports,
  initialProfiles,
  currentUserId,
}: {
  initialReports: AdminReport[];
  initialProfiles: AdminProfile[];
  currentUserId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [reports, setReports] = useState<AdminReport[]>(initialReports);
  const [profiles, setProfiles] = useState<AdminProfile[]>(initialProfiles);
  const [activeTab, setActiveTab] = useState<'reports' | 'users'>('reports');
  const [reportFilter, setReportFilter] = useState<'pending' | 'all'>('pending');
  const [userSearch, setUserSearch] = useState('');
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Ban modal state
  const [banTarget, setBanTarget] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [banReasonInput, setBanReasonInput] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    tone: 'neutral' | 'error';
  } | null>(null);

  const showToast = useCallback(
    (message: string, tone: 'neutral' | 'error' = 'neutral') => {
      setToast({ message, tone });
      setTimeout(() => setToast(null), 3500);
    },
    [],
  );

  const reloadAll = useCallback(async () => {
    setRefreshing(true);
    const [repRes, profRes] = await Promise.all([
      supabase.rpc('admin_list_reports'),
      supabase.rpc('admin_list_profiles'),
    ]);

    if (repRes.error || profRes.error) {
      showToast('Failed to refresh admin data.', 'error');
    } else {
      setReports((repRes.data as AdminReport[]) || []);
      setProfiles((profRes.data as AdminProfile[]) || []);
    }
    setRefreshing(false);
  }, [supabase, showToast]);

  const handleBanSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!banTarget) return;
    setBusyId(banTarget.id);

    const { error } = await supabase.rpc('admin_set_ban', {
      target_user_id: banTarget.id,
      ban_status: true,
      reason: banReasonInput.trim() || 'Suspended by moderator',
    });

    setBusyId(null);

    if (error) {
      showToast(error.message || 'Could not ban user.', 'error');
      return;
    }

    showToast(`Banned ${banTarget.label}.`);
    setBanTarget(null);
    setBanReasonInput('');
    await reloadAll();
  };

  const handleUnban = async (userId: string, label: string) => {
    setBusyId(userId);
    const { error } = await supabase.rpc('admin_set_ban', {
      target_user_id: userId,
      ban_status: false,
      reason: null,
    });
    setBusyId(null);

    if (error) {
      showToast(error.message || 'Could not unban user.', 'error');
      return;
    }

    showToast(`Unbanned ${label}.`);
    await reloadAll();
  };

  const handleReportStatus = async (
    reportId: string,
    newStatus: 'reviewed' | 'dismissed' | 'pending',
  ) => {
    setBusyId(reportId);
    const { error } = await supabase.rpc('admin_update_report_status', {
      target_report_id: reportId,
      new_status: newStatus,
    });
    setBusyId(null);

    if (error) {
      showToast(error.message || 'Could not update report.', 'error');
      return;
    }

    setReports((prev) =>
      prev.map((r) => (r.id === reportId ? { ...r, status: newStatus } : r)),
    );
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  const pendingReportsCount = useMemo(
    () => reports.filter((r) => r.status === 'pending').length,
    [reports],
  );
  const bannedCount = useMemo(
    () => profiles.filter((p) => p.is_banned).length,
    [profiles],
  );

  const visibleReports = useMemo(() => {
    if (reportFilter === 'all') return reports;
    return reports.filter((r) => r.status === 'pending');
  }, [reports, reportFilter]);

  const visibleProfiles = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(
      (p) =>
        p.email?.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q),
    );
  }, [profiles, userSearch]);

  return (
    <div className="min-h-[100dvh] bg-canvas text-[#f4f4f0]">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-surface/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/chat" className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-accent" />
              <span className="text-base font-bold tracking-tight sm:text-lg">
                StrangerChat
              </span>
            </Link>
            <span className="rounded-md border border-white/15 bg-surface-lighter px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-accent">
              Admin
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={reloadAll}
              disabled={refreshing}
              className="cursor-pointer rounded-lg border border-white/[0.08] bg-surface-light px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-surface-lighter disabled:opacity-50"
            >
              {refreshing ? 'Syncing...' : 'Refresh'}
            </button>
            <Link
              href="/chat"
              className="rounded-lg border border-white/[0.08] bg-surface-light px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-surface-lighter"
            >
              Chat
            </Link>
            <button
              onClick={handleSignOut}
              className="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-200"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Toast */}
      {toast && (
        <div className="pointer-events-none fixed left-1/2 top-16 z-40 w-full max-w-sm -translate-x-1/2 px-4">
          <div
            className={`rounded-xl border px-4 py-2.5 text-center text-xs font-medium shadow-xl backdrop-blur-md ${
              toast.tone === 'error'
                ? 'border-red-500/30 bg-red-950/90 text-red-200'
                : 'border-white/10 bg-surface-lighter/95 text-zinc-200'
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {/* Stats */}
        <div className="mb-6 grid grid-cols-3 gap-3 sm:gap-4">
          <div className="rounded-2xl border border-white/[0.08] bg-surface p-4">
            <div className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
              Accounts
            </div>
            <div className="mt-1 text-2xl font-bold">{profiles.length}</div>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-surface p-4">
            <div className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
              Pending Reports
            </div>
            <div className="mt-1 text-2xl font-bold text-amber-300">
              {pendingReportsCount}
            </div>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-surface p-4">
            <div className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
              Suspended
            </div>
            <div className="mt-1 text-2xl font-bold text-red-400">
              {bannedCount}
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-xl border border-white/[0.08] bg-surface p-1">
            <button
              onClick={() => setActiveTab('reports')}
              className={`cursor-pointer rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === 'reports'
                  ? 'bg-accent text-[#0c0c0e]'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Reports ({reports.length})
            </button>
            <button
              onClick={() => setActiveTab('users')}
              className={`cursor-pointer rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === 'users'
                  ? 'bg-accent text-[#0c0c0e]'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Users ({profiles.length})
            </button>
          </div>

          {activeTab === 'reports' && (
            <div className="inline-flex rounded-xl border border-white/[0.08] bg-surface p-1">
              <button
                onClick={() => setReportFilter('pending')}
                className={`cursor-pointer rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                  reportFilter === 'pending'
                    ? 'bg-surface-lighter text-white'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Pending
              </button>
              <button
                onClick={() => setReportFilter('all')}
                className={`cursor-pointer rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                  reportFilter === 'all'
                    ? 'bg-surface-lighter text-white'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                All
              </button>
            </div>
          )}

          {activeTab === 'users' && (
            <input
              type="text"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search email or UUID..."
              className="w-full rounded-xl border border-white/[0.08] bg-surface px-3.5 py-2 text-xs text-[#f4f4f0] placeholder-zinc-500 outline-none focus:border-accent/60 sm:w-64"
            />
          )}
        </div>

        {/* Reports View */}
        {activeTab === 'reports' && (
          <div className="space-y-3">
            {visibleReports.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.08] bg-surface p-10 text-center text-sm text-zinc-500">
                {reportFilter === 'pending'
                  ? 'No pending reports.'
                  : 'No reports submitted yet.'}
              </div>
            ) : (
              visibleReports.map((rep) => {
                const isExpanded = expandedReportId === rep.id;
                const reportedLabel = rep.reported_email || rep.reported_id;
                const reporterLabel = rep.reporter_email || rep.reporter_id;
                const logs = Array.isArray(rep.chat_log) ? rep.chat_log : [];

                return (
                  <div
                    key={rep.id}
                    className="rounded-2xl border border-white/[0.08] bg-surface p-4 sm:p-5"
                  >
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-[#f4f4f0]">
                            {reportedLabel}
                          </span>
                          {rep.reported_is_banned && (
                            <span className="rounded-md border border-red-500/30 bg-red-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-red-300">
                              Banned
                            </span>
                          )}
                          <span
                            className={`rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase ${
                              rep.status === 'pending'
                                ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                                : rep.status === 'reviewed'
                                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                                  : 'border-white/10 bg-surface-light text-zinc-400'
                            }`}
                          >
                            {rep.status}
                          </span>
                        </div>

                        <p className="text-xs text-zinc-300">
                          <span className="text-zinc-500">Reason:</span>{' '}
                          {rep.reason || 'No reason provided'}
                        </p>
                        <p className="font-mono text-[11px] text-zinc-500">
                          By: {reporterLabel} &middot; {formatDate(rep.created_at)}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          onClick={() =>
                            setExpandedReportId(isExpanded ? null : rep.id)
                          }
                          className="cursor-pointer rounded-lg border border-white/10 bg-surface-light px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-surface-lighter"
                        >
                          {isExpanded ? 'Hide Log' : `Chat Log (${logs.length})`}
                        </button>

                        {rep.status === 'pending' && (
                          <>
                            <button
                              onClick={() =>
                                handleReportStatus(rep.id, 'reviewed')
                              }
                              disabled={busyId === rep.id}
                              className="cursor-pointer rounded-lg border border-white/10 bg-surface-light px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-surface-lighter disabled:opacity-40"
                            >
                              Mark Reviewed
                            </button>
                            <button
                              onClick={() =>
                                handleReportStatus(rep.id, 'dismissed')
                              }
                              disabled={busyId === rep.id}
                              className="cursor-pointer rounded-lg border border-white/10 bg-surface-light px-3 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-200 disabled:opacity-40"
                            >
                              Dismiss
                            </button>
                          </>
                        )}

                        {rep.reported_is_banned ? (
                          <button
                            onClick={() =>
                              handleUnban(rep.reported_id, reportedLabel)
                            }
                            disabled={busyId === rep.reported_id}
                            className="cursor-pointer rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
                          >
                            Unban
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setBanReasonInput(rep.reason || '');
                              setBanTarget({
                                id: rep.reported_id,
                                label: reportedLabel,
                              });
                            }}
                            disabled={rep.reported_id === currentUserId}
                            className="cursor-pointer rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-40"
                          >
                            Ban User
                          </button>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-4 rounded-xl border border-white/[0.06] bg-canvas p-3.5">
                        {logs.length === 0 ? (
                          <p className="text-xs text-zinc-500">
                            No messages were exchanged before the report.
                          </p>
                        ) : (
                          <div className="max-h-60 space-y-1.5 overflow-y-auto text-xs">
                            {logs.map((msg, idx) => (
                              <div key={msg.id || idx} className="leading-relaxed">
                                <span
                                  className={`font-mono font-semibold ${
                                    msg.sender === 'me'
                                      ? 'text-zinc-400'
                                      : 'text-red-300'
                                  }`}
                                >
                                  {msg.sender === 'me'
                                    ? 'Reporter'
                                    : 'Reported'}
                                  :
                                </span>{' '}
                                <span className="text-zinc-200">{msg.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Users View */}
        {activeTab === 'users' && (
          <div className="space-y-2.5">
            {visibleProfiles.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.08] bg-surface p-10 text-center text-sm text-zinc-500">
                No matching accounts found.
              </div>
            ) : (
              visibleProfiles.map((prof) => {
                const label = prof.email || prof.id;
                return (
                  <div
                    key={prof.id}
                    className="flex flex-col justify-between gap-3 rounded-2xl border border-white/[0.08] bg-surface p-4 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-[#f4f4f0]">
                          {prof.email || 'Unknown email'}
                        </span>
                        {prof.is_admin && (
                          <span className="rounded-md border border-white/20 bg-white/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-accent">
                            Admin
                          </span>
                        )}
                        {prof.is_banned && (
                          <span className="rounded-md border border-red-500/30 bg-red-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-red-300">
                            Banned
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate font-mono text-[11px] text-zinc-500">
                        {prof.id} &middot; Reports: {prof.report_count}
                      </p>
                      {prof.is_banned && prof.ban_reason && (
                        <p className="mt-1 text-xs text-red-300/80">
                          {prof.ban_reason}
                        </p>
                      )}
                    </div>

                    {!prof.is_admin && (
                      <div className="shrink-0">
                        {prof.is_banned ? (
                          <button
                            onClick={() => handleUnban(prof.id, label)}
                            disabled={busyId === prof.id}
                            className="cursor-pointer rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
                          >
                            Unban
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setBanReasonInput('');
                              setBanTarget({ id: prof.id, label });
                            }}
                            disabled={busyId === prof.id}
                            className="cursor-pointer rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-40"
                          >
                            Ban
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </main>

      {/* Ban Modal */}
      {banTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm"
          onClick={() => !busyId && setBanTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-surface p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-[#f4f4f0]">Ban User</h3>
            <p className="mt-1 truncate text-xs text-zinc-400">
              Account: {banTarget.label}
            </p>

            <form onSubmit={handleBanSubmit} className="mt-4 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                  Ban reason (shown to user)
                </label>
                <input
                  type="text"
                  value={banReasonInput}
                  onChange={(e) => setBanReasonInput(e.target.value)}
                  maxLength={200}
                  placeholder="Suspended by moderator"
                  autoFocus
                  className="w-full rounded-xl border border-white/10 bg-surface-light px-3.5 py-2.5 text-sm text-[#f4f4f0] placeholder-zinc-500 outline-none focus:border-red-500/50"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBanTarget(null)}
                  disabled={Boolean(busyId)}
                  className="cursor-pointer rounded-xl border border-white/10 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-surface-lighter"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={Boolean(busyId)}
                  className="cursor-pointer rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {busyId ? 'Banning...' : 'Confirm Ban'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

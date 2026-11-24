'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function SuspendedView({
  reason,
  userId,
}: {
  reason?: string | null;
  userId?: string;
}) {
  const [signingOut, setSigningOut] = useState(false);
  const [checking, setChecking] = useState(false);

  // Guard against stale browser cache / bfcache if user was just unbanned
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    supabase
      .from('profiles')
      .select('is_banned')
      .eq('id', userId)
      .single()
      .then(({ data, error }) => {
        if (!error && data && data.is_banned === false) {
          window.location.replace('/chat');
        }
      });
  }, [userId]);

  const handleRefresh = async () => {
    setChecking(true);
    window.location.replace('/chat');
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-canvas bg-dot-grid px-4">
      <div className="w-full max-w-md rounded-2xl border border-red-500/25 bg-surface p-8 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-red-500/25 bg-red-500/10 text-red-400">
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
            />
          </svg>
        </div>

        <span className="font-mono text-[11px] uppercase tracking-widest text-red-400/90">
          Access Restricted
        </span>
        <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-[#f4f4f0]">
          Account Suspended
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          {reason ||
            'Your account has been suspended due to violations of community guidelines.'}
        </p>

        {userId && (
          <p className="mt-4 rounded-lg border border-white/[0.06] bg-surface-light px-3 py-1.5 font-mono text-[11px] text-zinc-500 select-all">
            ID: {userId}
          </p>
        )}

        <div className="mt-6 flex items-center gap-2.5">
          <button
            onClick={handleRefresh}
            disabled={checking || signingOut}
            className="flex-1 cursor-pointer rounded-xl border border-white/10 bg-surface-light px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-surface-lighter disabled:opacity-50"
          >
            {checking ? 'Checking...' : 'Check again'}
          </button>
          <button
            onClick={handleSignOut}
            disabled={signingOut || checking}
            className="flex-1 cursor-pointer rounded-xl border border-white/10 bg-surface-lighter px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {signingOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
      </div>
    </main>
  );
}

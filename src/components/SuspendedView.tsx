'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function SuspendedView({ reason }: { reason?: string | null }) {
  const [signingOut, setSigningOut] = useState(false);

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

        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="mt-6 w-full cursor-pointer rounded-xl border border-white/10 bg-surface-lighter px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          {signingOut ? 'Signing out...' : 'Sign out'}
        </button>
      </div>
    </main>
  );
}

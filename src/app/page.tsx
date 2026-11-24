import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import LoginButton from '@/components/LoginButton';

export default async function Home({
  searchParams,
}: {
  searchParams?: { error?: string };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && !user.is_anonymous) redirect('/chat');

  const authError = searchParams?.error === 'auth';

  return (
    <main className="relative flex min-h-[100dvh] flex-col items-center justify-center bg-canvas bg-dot-grid px-4 py-12">
      <div className="w-full max-w-md">
        {/* Brand Header */}
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-surface px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-zinc-400">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            1-on-1 Text Chat
          </div>

          <h1 className="text-4xl font-extrabold tracking-tight text-[#f4f4f0] sm:text-5xl">
            StrangerChat<span className="text-accent">.</span>
          </h1>

          <p className="mt-3 text-base leading-relaxed text-zinc-400">
            Talk one-on-one with someone random.
            <br />
            No profiles, no history — just live text.
          </p>
        </div>

        {/* Auth Card */}
        <div className="rounded-2xl border border-white/[0.09] bg-surface p-6 shadow-2xl sm:p-7">
          {authError && (
            <div className="mb-4 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-2.5 text-center text-xs text-red-300">
              Sign-in did not complete. Please try again.
            </div>
          )}

          <LoginButton />

        </div>
      </div>
    </main>
  );
}

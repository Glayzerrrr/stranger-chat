import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import LoginButton from '@/components/LoginButton';

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect('/chat');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="text-center max-w-lg">
        {/* Logo */}
        <div className="mb-8">
          <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight">
            Stranger<span className="text-blue-500">Chat</span>
          </h1>
          <p className="mt-3 text-lg text-gray-400">
            Talk to random strangers anonymously.
            <br />
            No names, no profiles — just conversations.
          </p>
        </div>

        {/* Login */}
        <LoginButton />

        {/* Fine print */}
        <p className="mt-8 text-sm text-gray-600 leading-relaxed">
          We use Google sign-in only to verify you&apos;re human and to enforce
          bans.
          <br />
          Your identity is <strong>never</strong> shown to the person you chat
          with.
        </p>

        {/* Features */}
        <div className="mt-12 grid grid-cols-3 gap-6 text-center text-gray-500 text-sm">
          <div>
            <div className="text-2xl mb-1">🔒</div>
            <span>Anonymous</span>
          </div>
          <div>
            <div className="text-2xl mb-1">⚡</div>
            <span>Instant</span>
          </div>
          <div>
            <div className="text-2xl mb-1">🛡️</div>
            <span>Moderated</span>
          </div>
        </div>
      </div>
    </main>
  );
}

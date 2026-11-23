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
            <div className="text-2xl mb-1 text-gray-400 font-bold">
              <svg className="w-6 h-6 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
            </div>
            <span>Anonymous</span>
          </div>
          <div>
            <div className="text-2xl mb-1 text-gray-400 font-bold">
              <svg className="w-6 h-6 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
              </svg>
            </div>
            <span>Instant</span>
          </div>
          <div>
            <div className="text-2xl mb-1 text-gray-400 font-bold">
              <svg className="w-6 h-6 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
              </svg>
            </div>
            <span>Moderated</span>
          </div>
        </div>
      </div>
    </main>
  );
}

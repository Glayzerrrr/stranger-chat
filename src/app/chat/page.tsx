import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import ChatWindow from '@/components/ChatWindow';

export default async function ChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Only verified Google OAuth users are allowed — no anonymous sessions
  if (!user || user.is_anonymous) {
    redirect('/');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_banned, ban_reason')
    .eq('id', user.id)
    .single();

  if (profile?.is_banned) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-4">
        <div className="text-center max-w-md p-8 rounded-2xl bg-surface border border-red-500/30">
          <h1 className="text-2xl font-bold text-red-400">Account Suspended</h1>
          <p className="text-gray-400 mt-3">
            {profile.ban_reason ||
              'Your account has been suspended due to violations of our community guidelines.'}
          </p>
        </div>
      </main>
    );
  }

  return <ChatWindow userId={user.id} />;
}

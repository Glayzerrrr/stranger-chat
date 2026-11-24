import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import ChatWindow from '@/components/ChatWindow';
import SuspendedView from '@/components/SuspendedView';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
    .select('is_banned, ban_reason, is_admin')
    .eq('id', user.id)
    .single();

  if (profile?.is_banned) {
    return <SuspendedView reason={profile.ban_reason} userId={user.id} />;
  }

  return <ChatWindow userId={user.id} isAdmin={Boolean(profile?.is_admin)} />;
}

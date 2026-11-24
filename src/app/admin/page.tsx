import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import AdminDashboard, {
  type AdminProfile,
  type AdminReport,
} from '@/components/AdminDashboard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.is_anonymous) {
    redirect('/');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();

  if (!profile?.is_admin) {
    redirect('/chat');
  }

  const [reportsRes, profilesRes] = await Promise.all([
    supabase.rpc('admin_list_reports'),
    supabase.rpc('admin_list_profiles'),
  ]);

  return (
    <AdminDashboard
      initialReports={(reportsRes.data as AdminReport[]) || []}
      initialProfiles={(profilesRes.data as AdminProfile[]) || []}
      currentUserId={user.id}
    />
  );
}

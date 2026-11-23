import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/chat';

  if (code) {
    const cookieStore = cookies();
    const cookiesToSetLater: { name: string; value: string; options: CookieOptions }[] = [];

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(
            cookiesToSet: {
              name: string;
              value: string;
              options: CookieOptions;
            }[],
          ) {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
              cookiesToSetLater.push({ name, value, options });
            });
          },
        },
      },
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      console.log('Successfully exchanged code for session, redirecting to:', `${origin}${next}`);
      const response = NextResponse.redirect(`${origin}${next}`);
      // Explicitly set cookies on the redirect response object to guarantee delivery
      cookiesToSetLater.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options);
      });
      return response;
    } else {
      console.error('Failed to exchange code for session:', error);
    }
  }

  // Something went wrong — send back to landing page with error
  return NextResponse.redirect(`${origin}/?error=auth`);
}

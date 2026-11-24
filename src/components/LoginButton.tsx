'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginButton() {
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Check if user already has an active Google session
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user && !session.user.is_anonymous) {
        window.location.href = '/chat';
      } else {
        if (session?.user?.is_anonymous) {
          // Clear any legacy anonymous session
          supabase.auth.signOut().then(() => setCheckingSession(false));
        } else {
          setCheckingSession(false);
        }
      }
    }).catch(() => {
      setCheckingSession(false);
    });
  }, []);

  // Google OAuth sign-in
  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        console.error('Supabase OAuth error:', error);
        setErrorMsg(error.message);
        setLoading(false);
      } else if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err: any) {
      console.error('Unexpected login error:', err);
      setErrorMsg(err?.message || 'Failed to sign in');
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="flex items-center justify-center gap-2 text-gray-400 py-4">
        <svg className="w-5 h-5 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span>Checking session...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-xs mx-auto">
      <button
        onClick={handleGoogleLogin}
        disabled={loading}
        className="w-full inline-flex items-center justify-center gap-3 bg-white hover:bg-gray-100
                   text-gray-900 font-bold px-6 py-4 rounded-xl shadow-lg shadow-white/10
                   active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 text-base"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        <span>{loading ? 'Connecting...' : 'Sign in with Google'}</span>
      </button>

      {errorMsg && (
        <p className="text-red-400 text-xs text-center bg-red-950/40 border border-red-500/30 px-3 py-1.5 rounded-lg w-full">
          {errorMsg}
        </p>
      )}
    </div>
  );
}

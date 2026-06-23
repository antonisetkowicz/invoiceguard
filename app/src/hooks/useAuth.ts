import { useEffect, useState } from 'react';
import { supabase } from '../config/supabase';
import type { Session } from '@supabase/supabase-js';

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function signInAnonymously() {
    setLoading(true);
    const { data, error } = await supabase.auth.signInAnonymously();
    setLoading(false);
    if (error) throw error;
    return data;
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
  }

  return { session, loading, signInAnonymously, signOut };
}

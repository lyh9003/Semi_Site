"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export default function FooterUserStatus() {
  const [email, setEmail] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (!email) return null;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setEmail(null);
  };

  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
      <span>{email} 로그인 중</span>
      <button
        onClick={handleLogout}
        className="text-slate-400 hover:text-red-500 transition-colors font-medium"
        title="로그아웃"
      >
        로그아웃
      </button>
    </span>
  );
}

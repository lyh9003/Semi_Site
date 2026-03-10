"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const handleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "kakao",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.refresh();
  };

  const navLinks = [
    { href: "/", label: "홈" },
    { href: "/news", label: "뉴스" },
    { href: "/reports", label: "증권 리포트" },
  ];

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-slate-200 shadow-sm">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* 로고 */}
        <Link href="/" className="flex items-center gap-2">
          <span className="text-2xl font-bold text-blue-600">⬡</span>
          <span className="text-xl font-bold text-slate-800">SemiCon</span>
          <span className="text-sm font-medium text-slate-400 hidden sm:block">Weekly</span>
        </Link>

        {/* 네비게이션 */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === href
                  ? "bg-blue-50 text-blue-600"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* 로그인/로그아웃 */}
        <div className="flex items-center gap-3">
          {loading ? (
            <div className="w-20 h-8 bg-slate-100 rounded-lg animate-pulse" />
          ) : user ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-500 hidden sm:block">
                {user.user_metadata?.name ?? user.email?.split("@")[0]}
              </span>
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                로그아웃
              </button>
            </div>
          ) : (
            <button
              onClick={handleLogin}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-yellow-400 hover:bg-yellow-500 rounded-lg transition-colors"
            >
              <span>🗨️</span>
              <span>카카오 로그인</span>
            </button>
          )}
        </div>
      </div>

      {/* 모바일 네비게이션 */}
      <div className="md:hidden border-t border-slate-100 px-4 py-2 flex gap-1">
        {navLinks.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={`flex-1 text-center px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              pathname === href
                ? "bg-blue-50 text-blue-600"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
    </header>
  );
}

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { Sidebar, BottomNav } from '@/components/ui/Navigation';

function AppShell({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/');
  }, [user, loading, router]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <div style={{ fontSize: '2.5rem' }}>🌊</div>
          <div style={{ width: 36, height: 36, border: '3px solid var(--color-border)', borderTopColor: 'var(--lake-safe)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>載入中...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <>
      <Sidebar role={profile?.role} />
      <main className="main-with-sidebar">
        {children}
      </main>
      <BottomNav />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}

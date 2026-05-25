'use client';

import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { Sidebar, BottomNav } from '@/components/ui/Navigation';

function AppShell({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();

  return (
    <>
      <Sidebar role={profile?.role} />
      <main className="main-with-sidebar">{children}</main>
      <BottomNav />
    </>
  );
}

export default function HonorLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}

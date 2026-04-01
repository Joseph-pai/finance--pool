'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, AuthProvider } from '@/hooks/useAuth';

export default function Page() {
  return (
    <AuthProvider>
      <LoginPage />
    </AuthProvider>
  );
}

function LoginPage() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const { signIn, user, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && user) router.replace('/dashboard');
  }, [user, authLoading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: err } = await signIn(email, password);
    if (err) {
      setError('帳號或密碼錯誤，請確認後重試。');
    } else {
      router.replace('/dashboard');
    }
    setLoading(false);
  };

  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 40, height: 40, border: '3px solid var(--color-border)', borderTopColor: 'var(--lake-safe)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    );
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-6)' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-10)' }}>
          <div style={{ fontSize: '3.5rem', marginBottom: 'var(--space-3)' }}>🌊</div>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.03em' }}>
            Family<span style={{ color: 'var(--lake-safe)' }}>Pool</span>
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: 'var(--space-2)', fontSize: '0.9rem' }}>
            家庭資金池 — 共享財務管理
          </p>
        </div>

        {/* Login Card */}
        <div className="card" style={{ padding: 'var(--space-8)' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 'var(--space-6)' }}>登入帳號</h2>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="login-email">電子郵件</label>
              <input
                id="login-email"
                type="email"
                className="form-input"
                placeholder="請輸入電子郵件"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="login-password">密碼</label>
              <input
                id="login-password"
                type="password"
                className="form-input"
                placeholder="請輸入密碼"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="alert alert-error" style={{ fontSize: '0.85rem' }}>
                <span>⚠️</span> {error}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary btn-lg"
              disabled={loading}
              id="login-submit"
              style={{ marginTop: 'var(--space-2)' }}
            >
              {loading ? '登入中...' : '登入'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: 'var(--space-6)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            帳號由家庭管理員建立，如需帳號請聯繫您的家庭管理員
          </p>
        </div>

        <p style={{ textAlign: 'center', marginTop: 'var(--space-6)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          FamilyPool © 2025 — 家庭財務共享管理
        </p>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </main>
  );
}

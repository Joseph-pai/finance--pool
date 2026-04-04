'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase';
import { PondA, PondB, IncomeItem, ExpenseItem, Transaction } from '@/types';
import { formatTWD, calcWaterLevel } from '@/lib/predictions';
import WaterWave from '@/components/animations/WaterWave';
import { format, parseISO } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { useRouter } from 'next/navigation';

export default function MyPondsPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const router = useRouter();

  const [pondA, setPondA]         = useState<PondA | null>(null);
  const [pondB, setPondB]         = useState<PondB | null>(null);
  const [incomes, setIncomes]     = useState<IncomeItem[]>([]);
  const [expenses, setExpenses]   = useState<ExpenseItem[]>([]);
  const [totalExpense, setTotalExpense] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState<'overview' | 'history'>('overview');

  const load = useCallback(async () => {
    if (!profile?.id || !profile?.family_id) return;
    setLoading(true);
    const [pARes, pBRes, incRes, expRes, txRes] = await Promise.all([
      supabase.from('pond_a').select('*').eq('user_id', profile.id).single(),
      supabase.from('pond_b').select('*').eq('user_id', profile.id).single(),
      supabase.from('income_items').select('*').eq('user_id', profile.id).order('expected_date', { ascending: false }).limit(5),
      supabase.from('expense_items').select('*').eq('user_id', profile.id).order('expected_date', { ascending: false }),
      supabase.from('transactions').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(20),
    ]);
    const expData = (expRes.data ?? []) as ExpenseItem[];
    const sum = expData.reduce((acc, curr) => acc + curr.amount, 0);

    setPondA(pARes.data as PondA | null);
    setPondB(pBRes.data as PondB | null);
    setIncomes((incRes.data ?? []) as IncomeItem[]);
    setExpenses(expData.slice(0, 5));
    setTotalExpense(sum);
    setTransactions((txRes.data ?? []) as Transaction[]);
    setLoading(false);
  }, [profile?.id, profile?.family_id, supabase]);

  useEffect(() => { load(); }, [load]);

  const maxBalance = Math.max(pondA?.current_balance ?? 0, totalExpense, 1) * 1.3;
  const aLevel = calcWaterLevel(pondA?.current_balance ?? 0, maxBalance);
  const bLevel = calcWaterLevel(totalExpense, maxBalance);

  const typeLabel: Record<string, { text: string; color: string }> = {
    income:           { text: '收入',   color: 'var(--status-success)' },
    expense:          { text: '支出',   color: 'var(--status-error)' },
    transfer_to_lake: { text: '注入湖泊', color: 'var(--text-accent)' },
    lake_expense:     { text: '湖泊支出', color: 'var(--status-error)' },
    lake_to_member:   { text: '湖泊撥入', color: 'var(--status-success)' },
  };

  if (loading) {
    return (
      <div className="page-container">
        <div style={{ display: 'grid', gap: 'var(--space-6)' }}>
          {[1, 2].map(i => <div key={i} className="skeleton" style={{ height: 200, borderRadius: 'var(--radius-lg)' }} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">🪣 我的池塘</h1>
        <p className="page-subtitle">{profile?.display_name} 的個人資金池</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2" style={{ marginBottom: 'var(--space-6)' }}>
        {(['overview', 'history'] as const).map(t => (
          <button key={t} id={`ponds-tab-${t}`} onClick={() => setTab(t)} className="btn btn-sm" style={{
            background: tab === t ? 'rgba(26,111,181,0.15)' : 'transparent',
            color: tab === t ? 'var(--text-accent)' : 'var(--text-muted)',
            border: `1px solid ${tab === t ? 'rgba(26,111,181,0.3)' : 'var(--color-border)'}`,
          }}>
            {{ overview: '水位概覽', history: '交易記錄' }[t]}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          {/* Two Ponds */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--space-6)', marginBottom: 'var(--space-8)' }}>
            {/* Pond A */}
            <div className="card" style={{ padding: 0, overflow: 'hidden', borderColor: 'rgba(26,158,92,0.3)' }}>
              <WaterWave level={aLevel} variant="pond-a" height={180} label="💰 收入池 (池塘A)" amount={formatTWD(pondA?.current_balance ?? 0)} />
              <div style={{ padding: 'var(--space-5)' }}>
                <div className="flex gap-3">
                  <button className="btn btn-success btn-sm flex-1" onClick={() => router.push('/income')} id="ponds-go-income">+ 記錄收入</button>
                  <button className="btn btn-ghost btn-sm flex-1" onClick={() => router.push('/income')} id="ponds-go-transfer">→ 注入湖泊</button>
                </div>
                {incomes.length > 0 && (
                  <div style={{ marginTop: 'var(--space-4)' }}>
                    <p className="text-xs text-muted" style={{ marginBottom: 'var(--space-2)' }}>最近收入</p>
                    {incomes.slice(0, 3).map(inc => (
                      <div key={inc.id} className="flex justify-between items-center" style={{ padding: '6px 0', borderBottom: '1px solid var(--color-border-light)', fontSize: '0.85rem' }}>
                        <span className="text-secondary">{inc.name}</span>
                        <span style={{ color: 'var(--status-success)' }}>+{formatTWD(inc.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Pond B */}
            <div className="card" style={{ padding: 0, overflow: 'hidden', borderColor: 'rgba(124,58,237,0.3)' }}>
              <WaterWave level={bLevel} variant="pond-b" height={180} label="💸 支出池 (池塘B)" amount={`-${formatTWD(totalExpense)}`} />
              <div style={{ padding: 'var(--space-5)' }}>
                <div className="flex gap-3">
                  <button className="btn btn-primary btn-sm flex-1" onClick={() => router.push('/expenses')} id="ponds-go-expense">+ 記錄支出</button>
                  <button className="btn btn-ghost btn-sm flex-1" onClick={() => router.push('/requests')} id="ponds-go-request">申請湖泊</button>
                </div>
                {expenses.length > 0 && (
                  <div style={{ marginTop: 'var(--space-4)' }}>
                    <p className="text-xs text-muted" style={{ marginBottom: 'var(--space-2)' }}>最近支出</p>
                    {expenses.slice(0, 3).map(exp => (
                      <div key={exp.id} className="flex justify-between items-center" style={{ padding: '6px 0', borderBottom: '1px solid var(--color-border-light)', fontSize: '0.85rem' }}>
                        <span className="text-secondary">{exp.name}</span>
                        <span style={{ color: 'var(--status-error)' }}>-{formatTWD(exp.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'history' && (
        <div>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 'var(--space-5)' }}>交易記錄（最近20筆）</h2>
          {transactions.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-icon">📊</span>
              <p className="empty-state-title">尚無交易記錄</p>
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>類型</th>
                    <th>備註</th>
                    <th style={{ textAlign: 'right' }}>金額</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(tx => {
                    const tl = typeLabel[tx.type] ?? { text: tx.type, color: 'var(--text-primary)' };
                    const isIn = ['income', 'lake_to_member'].includes(tx.type);
                    return (
                      <tr key={tx.id}>
                        <td className="text-secondary">{format(parseISO(tx.transaction_date), 'MM/dd', { locale: zhTW })}</td>
                        <td><span style={{ color: tl.color, fontWeight: 500, fontSize: '0.85rem' }}>{tl.text}</span></td>
                        <td className="text-secondary">{tx.note || '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'Inter', fontWeight: 600, color: isIn ? 'var(--status-success)' : 'var(--status-error)' }}>
                          {isIn ? '+' : '-'}{formatTWD(tx.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

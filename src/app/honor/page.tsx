'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase';
import { HonorLake, HonorExpense, Transaction } from '@/types';
import { formatTWD } from '@/lib/predictions';
import { format, parseISO } from 'date-fns';
import { zhTW } from 'date-fns/locale';

export default function HonorLakePage() {
  const { profile, isAdmin } = useAuth();
  const supabase = createClient();

  const [honorLake, setHonorLake] = useState<HonorLake | null>(null);
  const [expenses, setExpenses] = useState<HonorExpense[]>([]);
  const [contributions, setContributions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  // 新增支出表單
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    recipient: '',
    amount: '',
    expense_date: format(new Date(), 'yyyy-MM-dd'),
    note: '',
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.family_id) return;
    setLoading(true);

    const [hlRes, expRes, txRes] = await Promise.all([
      supabase.from('honor_lake').select('*').eq('family_id', profile.family_id).maybeSingle(),
      supabase.from('honor_expenses').select('*').eq('family_id', profile.family_id).order('expense_date', { ascending: false }),
      supabase.from('transactions').select('*').eq('family_id', profile.family_id).eq('type', 'honor_contribution').order('transaction_date', { ascending: false }),
    ]);

    setHonorLake(hlRes.data as HonorLake | null);
    setExpenses((expRes.data ?? []) as HonorExpense[]);
    setContributions((txRes.data ?? []) as Transaction[]);
    setLoading(false);
  }, [profile?.family_id, supabase]);

  useEffect(() => { load(); }, [load]);

  const handleAddExpense = async () => {
    if (!profile?.family_id || !profile?.id) return;
    const amountNum = Number(expenseForm.amount);
    if (!expenseForm.recipient || !amountNum) return;

    setSaving(true);
    try {
      // 檢查 honor_lake 餘額是否足夠
      const { data: hl } = await supabase.from('honor_lake').select('current_balance').eq('family_id', profile.family_id).single();
      if (!hl) {
        alert('榮耀湖泊尚未初始化');
        return;
      }
      if (hl.current_balance < amountNum) {
        alert(`餘額不足！目前什一奉獻餘額為 ${formatTWD(hl.current_balance)}，但捐獻金額為 ${formatTWD(amountNum)}`);
        return;
      }

      // 1. 扣 honor_lake 餘額
      const { error: updateErr } = await supabase
        .from('honor_lake')
        .update({ current_balance: hl.current_balance - amountNum })
        .eq('family_id', profile.family_id);
      if (updateErr) throw updateErr;

      // 2. 建立 honor_expense 記錄
      const { error: expenseErr } = await supabase
        .from('honor_expenses')
        .insert({
          family_id: profile.family_id,
          recipient: expenseForm.recipient,
          amount: amountNum,
          expense_date: expenseForm.expense_date,
          note: expenseForm.note || null,
        });
      if (expenseErr) throw expenseErr;

      // 3. 建立 transaction 記錄
      const { error: txErr } = await supabase
        .from('transactions')
        .insert({
          family_id: profile.family_id,
          user_id: profile.id,
          type: 'honor_expense',
          amount: amountNum,
          source: 'honor_lake',
          note: `捐獻給 ${expenseForm.recipient}${expenseForm.note ? `（${expenseForm.note}）` : ''}`,
          transaction_date: expenseForm.expense_date,
        });
      if (txErr) throw txErr;

      // 重置表單
      setExpenseForm({
        recipient: '',
        amount: '',
        expense_date: format(new Date(), 'yyyy-MM-dd'),
        note: '',
      });
      setShowAddExpense(false);
      load();
    } catch (err: any) {
      alert('操作失敗：' + err.message);
      console.error('捐獻支出失敗：', err);
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="page-container">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 60, borderRadius: 'var(--radius-md)' }} />)}
        </div>
      </div>
    );
  }

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">🌟 榮耀歸主湖泊</h1>
        <p className="page-subtitle">什一奉獻 — 自動提撥收入的 10%，成為家庭的祝福基金</p>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
        <div className="card card-sm" style={{ borderColor: 'rgba(245,166,35,0.3)' }}>
          <p className="text-xs text-muted" style={{ marginBottom: 4 }}>🌟 可奉獻金額</p>
          <p className="amount-display amount-medium" style={{ color: 'var(--status-warning)' }}>{formatTWD(honorLake?.current_balance ?? 0)}</p>
        </div>
        <div className="card card-sm" style={{ borderColor: 'rgba(224,82,82,0.3)' }}>
          <p className="text-xs text-muted" style={{ marginBottom: 4 }}>累計捐獻支出</p>
          <p className="amount-display amount-medium" style={{ color: 'var(--status-error)' }}>{formatTWD(totalExpenses)}</p>
        </div>
        <div className="card card-sm">
          <p className="text-xs text-muted" style={{ marginBottom: 4 }}>捐獻筆數</p>
          <p className="amount-display amount-medium">{expenses.length}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-4" style={{ marginBottom: 'var(--space-6)' }}>
        <div />
        <button
          className="btn btn-primary"
          onClick={() => setShowAddExpense(true)}
          disabled={!isAdmin}
          id="honor-add-expense"
        >
          + 記錄捐獻支出
        </button>
        {!isAdmin && (
          <span className="text-xs text-muted">僅管理員可記錄捐獻</span>
        )}
      </div>

      {/* 捐獻支出記錄 */}
      <section style={{ marginBottom: 'var(--space-8)' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
          捐獻記錄
        </h2>
        {expenses.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon">🙏</span>
            <p className="empty-state-title">尚無捐獻記錄</p>
            <p className="empty-state-desc">當累積足夠的什一奉獻後，可以從這裡記錄實際的捐獻</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {expenses.map((exp) => (
              <div key={exp.id} className="card card-sm">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <div className="font-semibold">{exp.recipient}</div>
                    <div className="text-xs text-secondary" style={{ marginTop: 4 }}>
                      {format(parseISO(exp.expense_date), 'yyyy/MM/dd', { locale: zhTW })}
                      {exp.note && <span> · {exp.note}</span>}
                    </div>
                  </div>
                  <span className="amount-display amount-small" style={{ color: 'var(--status-error)' }}>
                    -{formatTWD(exp.amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 什一奉獻歷史 */}
      <section>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
          什一奉獻歷史
        </h2>
        {contributions.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon">💰</span>
            <p className="empty-state-title">尚無什一奉獻記錄</p>
            <p className="empty-state-desc">新增收入時，系統會自動提撥 10% 作為什一奉獻</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {contributions.map((tx) => (
              <div key={tx.id} className="card card-sm">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <div className="font-semibold">{tx.note || '什一奉獻'}</div>
                    <div className="text-xs text-secondary" style={{ marginTop: 4 }}>
                      {format(parseISO(tx.transaction_date), 'yyyy/MM/dd', { locale: zhTW })}
                    </div>
                  </div>
                  <span className="amount-display amount-small" style={{ color: 'var(--status-warning)' }}>
                    +{formatTWD(tx.amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 新增捐獻支出 Modal */}
      {showAddExpense && (
        <div className="modal-overlay" onClick={() => setShowAddExpense(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">記錄捐獻支出</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAddExpense(false)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              <div className="form-group">
                <label className="form-label">捐獻對象</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="例：教會、宣教士、機構名稱"
                  value={expenseForm.recipient}
                  onChange={e => setExpenseForm(f => ({ ...f, recipient: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">金額（台幣）</label>
                <input
                  type="number"
                  className="form-input"
                  placeholder="0"
                  min="0"
                  value={expenseForm.amount}
                  onChange={e => setExpenseForm(f => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">捐獻日期</label>
                <input
                  type="date"
                  className="form-input"
                  value={expenseForm.expense_date}
                  onChange={e => setExpenseForm(f => ({ ...f, expense_date: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">備註（選填）</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="例：感恩奉獻、宣教基金"
                  value={expenseForm.note}
                  onChange={e => setExpenseForm(f => ({ ...f, note: e.target.value }))}
                />
              </div>
              <div className="flex gap-3" style={{ justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setShowAddExpense(false)}>取消</button>
                <button
                  className="btn btn-primary"
                  onClick={handleAddExpense}
                  disabled={saving || !expenseForm.recipient || !expenseForm.amount}
                >
                  {saving ? '儲存中...' : '確認捐獻'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

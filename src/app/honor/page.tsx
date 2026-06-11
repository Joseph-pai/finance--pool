'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase';
import { HonorLake, HonorExpense, Transaction, PondA, IncomeItem } from '@/types';
import { formatTWD } from '@/lib/predictions';
import { format, parseISO } from 'date-fns';
import { zhTW } from 'date-fns/locale';

export default function HonorLakePage() {
  const { profile, isAdmin, canManageLake } = useAuth();
  const supabase = useMemo(() => createClient(), []);

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

  // ── 調整奉獻金額 (管理員/湖泊管理員專用) ──
  const [showSetBalance, setShowSetBalance] = useState(false);
  const [newBalance, setNewBalance] = useState('');

  // ── 注入奉獻 (所有成員可用) ──
  const [showInject, setShowInject] = useState(false);
  const [injectAmount, setInjectAmount] = useState('');
  const [pondA, setPondA] = useState<PondA | null>(null);
  const [incomes, setIncomes] = useState<IncomeItem[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const load = useCallback(async () => {
    if (!profile?.family_id) return;
    setLoading(true);

    const [hlRes, expRes, txRes, pARes, incRes, allTxRes] = await Promise.all([
      supabase.from('honor_lake').select('*').eq('family_id', profile.family_id).maybeSingle(),
      supabase.from('honor_expenses').select('*').eq('family_id', profile.family_id).order('expense_date', { ascending: false }),
      supabase.from('transactions').select('*').eq('family_id', profile.family_id).eq('type', 'honor_contribution').order('transaction_date', { ascending: false }),
      supabase.from('pond_a').select('*').eq('user_id', profile.id).maybeSingle(),
      supabase.from('income_items').select('*').eq('user_id', profile.id),
      supabase.from('transactions').select('*').eq('family_id', profile.family_id),
    ]);

    setHonorLake(hlRes.data as HonorLake | null);
    setExpenses((expRes.data ?? []) as HonorExpense[]);
    setContributions((txRes.data ?? []) as Transaction[]);
    setPondA(pARes.data as PondA | null);
    setIncomes((incRes.data ?? []) as IncomeItem[]);
    setTransactions((allTxRes.data ?? []) as Transaction[]);
    setLoading(false);
  }, [profile?.family_id, profile?.id, supabase]);

  useEffect(() => { load(); }, [load]);

  // ── 計算目前用戶的 Pond A 可用餘額 ──
  const currentPondABalance = (() => {
    if (!pondA) return 0;
    // 已確認且目的地為 pond_a 的收入
    const confirmedIncome = incomes
      .filter(i => i.status === 'confirmed' && i.destination === 'pond_a')
      .reduce((sum, i) => sum + (i.actual_amount ?? i.amount), 0);
    // 從 pond_a 扣除的交易
    const deductions = transactions
      .filter(tx => (tx.user_id ?? '') === profile?.id && tx.source === 'pond_a')
      .reduce((sum, tx) => sum + tx.amount, 0);
    // 從 pond_b 轉入 pond_a
    const additions = transactions
      .filter(tx => (tx.user_id ?? '') === profile?.id && tx.destination === 'pond_a' && tx.type === 'transfer_from_pond_b')
      .reduce((sum, tx) => sum + tx.amount, 0);
    return Math.max(0, confirmedIncome - deductions + additions);
  })();

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

  // ── 管理員調整奉獻金額 ──
  const handleSetBalance = async () => {
    if (!profile?.family_id || !newBalance) return;
    const amountNum = Number(newBalance);
    if (amountNum < 0) { alert('金額不能為負數'); return; }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('honor_lake')
        .update({ current_balance: amountNum })
        .eq('family_id', profile.family_id);
      if (error) throw error;
      setShowSetBalance(false);
      setNewBalance('');
      load();
    } catch (err: any) {
      alert('調整失敗：' + err.message);
      console.error('調整奉獻金額失敗：', err);
    }
    setSaving(false);
  };

  // ── 成員注入奉獻 ──
  const handleInject = async () => {
    if (!profile?.family_id || !profile?.id) return;
    const amt = Number(injectAmount);
    if (!amt) return;
    if (amt > currentPondABalance) {
      alert(`注入金額（${formatTWD(amt)}）不能超過收入池餘額（${formatTWD(currentPondABalance)}）`);
      return;
    }

    setSaving(true);
    try {
      // 1. 增加 honor_lake 餘額
      const { data: hl } = await supabase.from('honor_lake').select('current_balance').eq('family_id', profile.family_id).single();
      if (!hl) {
        // 若 honor_lake 尚未初始化，先建立
        const { data: newHl } = await supabase.from('honor_lake').insert({ family_id: profile.family_id, current_balance: 0 }).select('current_balance').single();
        if (!newHl) throw new Error('無法初始化榮耀湖泊');
        await supabase.from('honor_lake').update({ current_balance: amt }).eq('family_id', profile.family_id);
      } else {
        await supabase.from('honor_lake').update({ current_balance: (hl.current_balance ?? 0) + amt }).eq('family_id', profile.family_id);
      }

      // 2. 建立 transaction（DB trigger 會自動從 Pond A 扣除）
      const { error: txErr } = await supabase.from('transactions').insert({
        family_id: profile.family_id,
        user_id: profile.id,
        type: 'honor_contribution',
        amount: amt,
        source: 'pond_a',
        destination: 'honor_lake',
        note: `手動注入榮耀歸主奉獻`,
        transaction_date: new Date().toISOString().substring(0, 10),
      });
      if (txErr) throw txErr;

      setShowInject(false);
      setInjectAmount('');
      load();
    } catch (err: any) {
      alert('注入失敗：' + err.message);
      console.error('注入奉獻失敗：', err);
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
        <div className="flex gap-2 flex-wrap">
          {/* 注入奉獻按鈕 — 所有成員可用 */}
          <button
            className="btn btn-primary"
            onClick={() => { setInjectAmount(''); setShowInject(true); }}
            id="honor-inject-btn"
          >
            🌟 注入奉獻
          </button>
          {/* 調整奉獻金額 — 管理員/湖泊管理員專用 */}
          {canManageLake && (
            <button
              className="btn btn-ghost"
              onClick={() => { setNewBalance(String(honorLake?.current_balance ?? 0)); setShowSetBalance(true); }}
              id="honor-set-balance-btn"
            >
              調整奉獻金額
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
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

      {/* ── 新增捐獻支出 Modal ── */}
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

      {/* ── 調整奉獻金額 Modal (管理員/湖泊管理員) ── */}
      {showSetBalance && (
        <div className="modal-overlay" onClick={() => setShowSetBalance(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">⚙️ 調整奉獻金額</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowSetBalance(false)} id="honor-balance-close">✕</button>
            </div>
            <p className="text-secondary text-sm" style={{ marginBottom: 'var(--space-4)' }}>
              直接設定榮耀歸主湖泊的可奉獻金額。調整時不會產生交易記錄。
            </p>
            <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
              <label className="form-label">可奉獻金額（台幣）</label>
              <input
                id="honor-balance-input"
                type="number"
                className="form-input"
                placeholder="0"
                min="0"
                value={newBalance}
                onChange={e => setNewBalance(e.target.value)}
              />
            </div>
            <div className="flex gap-3" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowSetBalance(false)} id="honor-balance-cancel">取消</button>
              <button
                className="btn btn-primary"
                onClick={handleSetBalance}
                disabled={saving || !newBalance}
                id="honor-balance-save"
              >
                {saving ? '更新中...' : '確認更新'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 注入奉獻 Modal (所有成員) ── */}
      {showInject && (
        <div className="modal-overlay" onClick={() => setShowInject(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h3 className="modal-title">🌟 注入榮耀歸主奉獻</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowInject(false)}>✕</button>
            </div>
            <p className="text-secondary text-sm" style={{ marginBottom: 'var(--space-4)' }}>
              從您的個人收入池（Pond A）注入資金到榮耀歸主湖泊，作為額外的奉獻。
            </p>
            <div style={{ padding: '10px 14px', background: 'rgba(245,166,35,0.1)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-5)', border: '1px solid rgba(245,166,35,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="text-xs" style={{ color: 'var(--status-warning)' }}>💰 您的收入池可用餘額</span>
              <span className="text-sm font-semibold" style={{ color: 'var(--status-warning)' }}>{formatTWD(currentPondABalance)}</span>
            </div>
            <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                注入金額
                <span className="text-xs text-muted" style={{ marginLeft: 8, fontWeight: 400 }}>
                  （最多 {formatTWD(currentPondABalance)}）
                </span>
              </label>
              <input
                id="honor-inject-amount"
                type="number"
                className="form-input"
                placeholder="0"
                min="0"
                max={currentPondABalance}
                value={injectAmount}
                onChange={e => setInjectAmount(e.target.value)}
              />
            </div>
            <div className="flex gap-3" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowInject(false)}>取消</button>
              <button
                className="btn btn-primary"
                onClick={handleInject}
                disabled={saving || !injectAmount || Number(injectAmount) <= 0 || Number(injectAmount) > currentPondABalance}
                id="honor-inject-confirm"
              >
                {saving ? '處理中...' : '✓ 確認注入'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

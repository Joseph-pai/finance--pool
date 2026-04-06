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

  const [pondA, setPondA]               = useState<PondA | null>(null);
  const [pondB, setPondB]               = useState<PondB | null>(null);
  const [incomes, setIncomes]           = useState<IncomeItem[]>([]);
  const [expenses, setExpenses]         = useState<ExpenseItem[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading]           = useState(true);
  const [tab, setTab]                   = useState<'overview' | 'history'>('overview');
  // 支出池注入 modal
  const [showInjectModal, setShowInjectModal] = useState(false);
  const [injectAmount, setInjectAmount] = useState('');
  const [injecting, setInjecting]       = useState(false);
  // 湖泊注入 modal
  const [showLakeModal, setShowLakeModal]       = useState(false);
  const [injectLakeAmount, setInjectLakeAmount] = useState('');
  const [injectingLake, setInjectingLake]       = useState(false);

  const load = useCallback(async () => {
    if (!profile?.id || !profile?.family_id) return;
    setLoading(true);
    const [pARes, pBRes, incRes, expRes, txRes] = await Promise.all([
      supabase.from('pond_a').select('*').eq('user_id', profile.id).single(),
      supabase.from('pond_b').select('*').eq('user_id', profile.id).single(),
      supabase.from('income_items').select('*').eq('user_id', profile.id).order('expected_date', { ascending: false }),
      supabase.from('expense_items').select('*').eq('user_id', profile.id).order('expected_date', { ascending: false }),
      supabase.from('transactions').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(20),
    ]);

    setPondA(pARes.data as PondA | null);
    setPondB(pBRes.data as PondB | null);
    setIncomes((incRes.data ?? []) as IncomeItem[]);
    setExpenses((expRes.data ?? []) as ExpenseItem[]);
    setTransactions((txRes.data ?? []) as Transaction[]);
    setLoading(false);
  }, [profile?.id, profile?.family_id, supabase]);

  useEffect(() => { load(); }, [load]);

  // ── 計算核心：全部基於資料庫取得的實際值 ──────────────────────────

  // Pond A 實際餘額（資料庫值，由觸發器維護）
  const pondABalance = pondA?.current_balance ?? 0;

  // Pond B 欠款金額（資料庫值為負，取絕對值顯示）
  const pondBBalance = pondB?.current_balance ?? 0;
  const pondBDebt    = Math.abs(pondBBalance); // 顯示用正數

  // 待入帳的預計收入（pending 狀態，用預計金額）
  const pendingIncomeTotal = incomes
    .filter(i => i.status === 'pending')
    .reduce((sum, i) => sum + i.amount, 0);

  // 計畫中支出（planned + approved 狀態，尚未完成）
  const plannedExpenseTotal = expenses
    .filter(e => e.status === 'planned' || e.status === 'approved')
    .reduce((sum, e) => sum + e.amount, 0);

  // 調節後水量 = 收入池實際餘額 + 待入帳收入 - 計畫中支出
  // （代表個人資金的預估淨值）
  const adjustedBalance = pondABalance + pendingIncomeTotal - plannedExpenseTotal;

  // 水位顯示基準值
  const maxBalance   = Math.max(pondABalance, pondBDebt, Math.abs(adjustedBalance), pendingIncomeTotal, plannedExpenseTotal, 1) * 1.3;
  const aLevel       = calcWaterLevel(pondABalance, maxBalance);
  const bLevel       = calcWaterLevel(pondBDebt, maxBalance);
  const adjustedLevel = calcWaterLevel(Math.max(0, adjustedBalance), maxBalance);

  // ── 分類顯示用 ────────────────────────────────────────────────────
  const confirmedIncomes = incomes.filter(i => i.status === 'confirmed');
  const pendingIncomes   = incomes.filter(i => i.status === 'pending');
  const completedExpenses = expenses.filter(e => e.status === 'completed');
  const plannedExpenses   = expenses.filter(e => e.status === 'planned' || e.status === 'approved');

  const statusLabel: Record<string, { text: string; color: string; badge: string }> = {
    pending:   { text: '待確認', color: 'var(--status-warning)', badge: 'badge-warning' },
    confirmed: { text: '已到帳', color: 'var(--status-success)', badge: 'badge-success' },
    failed:    { text: '未到帳', color: 'var(--status-error)',   badge: 'badge-error' },
    planned:   { text: '計畫中', color: 'var(--text-muted)',     badge: 'badge-ghost' },
    approved:  { text: '已核准', color: 'var(--status-info)',    badge: 'badge-info' },
    completed: { text: '已完成', color: 'var(--status-success)', badge: 'badge-success' },
    rejected:  { text: '已拒絕', color: 'var(--status-error)',   badge: 'badge-error' },
  };

  const typeLabel: Record<string, { text: string; color: string }> = {
    income:             { text: '收入',     color: 'var(--status-success)' },
    expense:            { text: '支出',     color: 'var(--status-error)' },
    transfer_to_lake:   { text: '注入湖泊', color: 'var(--text-accent)' },
    transfer_to_pond_b: { text: '注入支出池', color: 'var(--pond-b)' },
    lake_expense:       { text: '湖泊支出', color: 'var(--status-error)' },
    lake_to_member:     { text: '湖泊撥入', color: 'var(--status-success)' },
  };

  // ── 收入池注水至支出池 ─────────────────────────────────────────────
  const handleTransferToPondB = async () => {
    const amt = Number(injectAmount);
    if (!amt || !profile || !pondA || !pondB) return;
    if (amt > pondABalance) { alert('注入金額不能超過收入池餘額'); return; }
    setInjecting(true);
    try {
      const { error } = await supabase.from('transactions').insert({
        family_id: profile.family_id, user_id: profile.id,
        type: 'transfer_to_pond_b', amount: amt,
        source: 'pond_a', destination: 'pond_b',
        note: '收入池注水至支出池',
        transaction_date: new Date().toISOString().split('T')[0],
      });
      if (error) {
        throw new Error(error.message);
      }
      setShowInjectModal(false); setInjectAmount(''); load();
    } catch (err: any) { alert('注水失敗：' + (err.message || '發生未知錯誤')); console.error('注水失敗：', err); }
    finally { setInjecting(false); }
  };

  // ── 收入池注入湖泊 ──────────────────────────────────────────────────
  const handleTransferToLake = async () => {
    const amt = Number(injectLakeAmount);
    if (!amt || !profile) return;
    if (amt > pondABalance) { alert('注入金額不能超過收入池餘額'); return; }
    setInjectingLake(true);
    try {
      const { error } = await supabase.from('transactions').insert({
        family_id: profile.family_id, user_id: profile.id,
        type: 'transfer_to_lake', amount: amt,
        source: 'pond_a', destination: 'lake',
        note: '收入池注入湖泊',
        transaction_date: new Date().toISOString().split('T')[0],
      });
      if (error) {
        throw new Error(error.message);
      }
      setShowLakeModal(false); setInjectLakeAmount(''); load();
    } catch (err: any) { alert('注入湖泊失敗：' + (err.message || '發生未知錯誤')); console.error('注入湖泊失敗：', err); }
    finally { setInjectingLake(false); }
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
          {/* Three Ponds Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-6)', marginBottom: 'var(--space-8)' }}>

            {/* ── Card 1: 收入池 (池塘A) ── */}
            <div className="card" style={{ padding: 0, overflow: 'hidden', borderColor: 'rgba(26,158,92,0.3)' }}>
              <WaterWave level={aLevel} variant="pond-a" height={180} label="💰 收入池 (池塘A)" amount={formatTWD(pondABalance)} />
              <div style={{ padding: 'var(--space-5)' }}>
                {/* 待入帳提示 */}
                {pendingIncomeTotal > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)', padding: '8px 12px', background: 'rgba(237,188,26,0.1)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(237,188,26,0.25)' }}>
                    <span className="text-xs" style={{ color: 'var(--status-warning)' }}>⏳ 待入帳</span>
                    <span className="text-xs font-semibold" style={{ color: 'var(--status-warning)' }}>+{formatTWD(pendingIncomeTotal)}</span>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                  <button className="btn btn-success btn-sm" onClick={() => router.push('/income')} id="ponds-go-income">+ 記錄收入</button>
                  <button className="btn btn-primary btn-sm" onClick={() => setShowLakeModal(true)} id="ponds-inject-lake">→ 湖泊</button>
                  <button className="btn btn-ghost btn-sm" style={{ borderColor: 'rgba(124,58,237,0.4)', color: 'var(--pond-b-light)' }} onClick={() => setShowInjectModal(true)} id="ponds-inject-b">→ 支出池</button>
                </div>
                <div>
                  <p className="text-xs text-muted" style={{ marginBottom: 'var(--space-2)' }}>最近已確認收入</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {confirmedIncomes.slice(0, 5).map(inc => (
                      <div key={inc.id} className="flex justify-between items-center" style={{ padding: '6px 0', borderBottom: '1px solid var(--color-border-light)', fontSize: '0.8rem' }}>
                        <div className="flex flex-col">
                          <span className="font-medium text-secondary">{inc.name}</span>
                          <span className="text-xs opacity-60">{format(parseISO(inc.expected_date), 'MM/dd')} · 已到帳</span>
                        </div>
                        <span style={{ color: 'var(--status-success)', fontWeight: 600 }}>+{formatTWD(inc.actual_amount ?? inc.amount)}</span>
                      </div>
                    ))}
                    {confirmedIncomes.length === 0 && <p className="text-xs text-muted italic">暫無已到帳收入</p>}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Card 2: 支出池 (池塘B) ── */}
            <div className="card" style={{ padding: 0, overflow: 'hidden', borderColor: 'rgba(124,58,237,0.3)' }}>
              <WaterWave level={bLevel} variant="pond-b" height={180} label="💸 支出池 (池塘B)" amount={pondBDebt > 0 ? `-${formatTWD(pondBDebt)}` : formatTWD(0)} />
              <div style={{ padding: 'var(--space-5)' }}>
                {/* 計畫中支出提示 */}
                {plannedExpenseTotal > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)', padding: '8px 12px', background: 'rgba(224,82,82,0.1)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(224,82,82,0.25)' }}>
                    <span className="text-xs" style={{ color: 'var(--status-error)' }}>📋 計畫中支出</span>
                    <span className="text-xs font-semibold" style={{ color: 'var(--status-error)' }}>-{formatTWD(plannedExpenseTotal)}</span>
                  </div>
                )}
                <div className="flex gap-3" style={{ marginBottom: 'var(--space-4)' }}>
                  <button className="btn btn-primary btn-sm flex-1" onClick={() => router.push('/expenses')} id="ponds-go-expense">+ 記錄支出</button>
                  <button className="btn btn-ghost btn-sm flex-1" onClick={() => router.push('/requests')} id="ponds-go-request">申請湖泊</button>
                </div>
                <div>
                  <p className="text-xs text-muted" style={{ marginBottom: 'var(--space-2)' }}>最近已完成支出</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {completedExpenses.slice(0, 5).map(exp => (
                      <div key={exp.id} className="flex justify-between items-center" style={{ padding: '6px 0', borderBottom: '1px solid var(--color-border-light)', fontSize: '0.8rem' }}>
                        <div className="flex flex-col">
                          <span className="font-medium text-secondary">{exp.name}</span>
                          <span className="text-xs opacity-60">{format(parseISO(exp.expected_date), 'MM/dd')} · 已完成</span>
                        </div>
                        <span style={{ color: 'var(--status-error)', fontWeight: 600 }}>-{formatTWD(exp.amount)}</span>
                      </div>
                    ))}
                    {completedExpenses.length === 0 && <p className="text-xs text-muted italic">暫無已完成支出</p>}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Card 3: 調節後水量 ── */}
            {/* 調節後水量 = 收入池餘額 + 待入帳收入 - 計畫中支出 */}
            <div className="card" style={{ padding: 0, overflow: 'hidden', borderColor: 'rgba(14,165,233,0.3)' }}>
              <WaterWave
                level={adjustedLevel}
                variant="adjusted"
                height={180}
                label="⚖️ 調節後水量"
                amount={formatTWD(adjustedBalance)}
              />
              <div style={{ padding: 'var(--space-5)' }}>
                {/* 計算明細 */}
                <div style={{ marginBottom: 'var(--space-4)', padding: '10px 12px', background: 'rgba(14,165,233,0.07)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(14,165,233,0.2)' }}>
                  <p className="text-xs text-muted" style={{ marginBottom: 6 }}>計算明細</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.78rem' }}>
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-secondary)' }}>收入池餘額</span>
                      <span style={{ color: 'var(--status-success)', fontWeight: 600 }}>+{formatTWD(pondABalance)}</span>
                    </div>
                    {pendingIncomeTotal > 0 && (
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--text-secondary)' }}>待入帳收入</span>
                        <span style={{ color: 'var(--status-warning)', fontWeight: 600 }}>+{formatTWD(pendingIncomeTotal)}</span>
                      </div>
                    )}
                    {plannedExpenseTotal > 0 && (
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--text-secondary)' }}>計畫中支出</span>
                        <span style={{ color: 'var(--status-error)', fontWeight: 600 }}>-{formatTWD(plannedExpenseTotal)}</span>
                      </div>
                    )}
                    <div className="flex justify-between" style={{ paddingTop: 4, borderTop: '1px solid var(--color-border-light)', marginTop: 2 }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>預估淨值</span>
                      <span style={{ color: adjustedBalance >= 0 ? 'var(--status-success)' : 'var(--status-error)', fontWeight: 700 }}>
                        {formatTWD(adjustedBalance)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 未執行的預計項目 */}
                <div>
                  <p className="text-xs font-semibold text-accent" style={{ marginBottom: 'var(--space-2)' }}>
                    ⏳ 未執行預計項目
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {pendingIncomes.map(inc => (
                      <div key={inc.id} className="flex justify-between items-center" style={{ padding: '6px 0', borderBottom: '1px solid var(--color-border-light)', fontSize: '0.8rem' }}>
                        <div className="flex flex-col">
                          <span className="font-medium text-secondary">{inc.name}</span>
                          <span className="text-xs opacity-60">{format(parseISO(inc.expected_date), 'MM/dd')} · 待入帳</span>
                        </div>
                        <span style={{ color: 'var(--status-success)', opacity: 0.85 }}>+{formatTWD(inc.amount)}</span>
                      </div>
                    ))}
                    {plannedExpenses.map(exp => (
                      <div key={exp.id} className="flex justify-between items-center" style={{ padding: '6px 0', borderBottom: '1px solid var(--color-border-light)', fontSize: '0.8rem' }}>
                        <div className="flex flex-col">
                          <span className="font-medium text-secondary">{exp.name}</span>
                          <span className="text-xs opacity-60">{format(parseISO(exp.expected_date), 'MM/dd')} · {statusLabel[exp.status]?.text || exp.status}</span>
                        </div>
                        <span style={{ color: 'var(--status-error)', opacity: 0.85 }}>-{formatTWD(exp.amount)}</span>
                      </div>
                    ))}
                    {pendingIncomes.length === 0 && plannedExpenses.length === 0 && (
                      <p className="text-xs text-muted italic">暫無預計變動項目</p>
                    )}
                  </div>
                </div>
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
                    const tl   = typeLabel[tx.type] ?? { text: tx.type, color: 'var(--text-primary)' };
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

      {/* 注水至支出池彈窗 */}
      {/* 注入支出池 Modal */}
      {showInjectModal && (
        <div className="modal-overlay" onClick={() => setShowInjectModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h3 className="modal-title">💸 收入池 → 支出池</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowInjectModal(false)}>✕</button>
            </div>
            <div style={{ marginBottom: 'var(--space-5)' }}>
              <p className="text-sm text-secondary">將收入池資金移轉至支出池，減少個人支出欠款。</p>
              <div className="flex justify-between text-xs font-mono" style={{ marginTop: 12, padding: 8, background: 'rgba(0,0,0,0.2)', borderRadius: 4 }}>
                <span>收入池可用：{formatTWD(pondABalance)}</span>
                <span>支出池欠款：{pondBDebt > 0 ? `-${formatTWD(pondBDebt)}` : formatTWD(0)}</span>
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
              <label className="form-label">注入金額</label>
              <input type="number" className="form-input" placeholder="0" max={pondABalance} value={injectAmount} onChange={e => setInjectAmount(e.target.value)} autoFocus />
            </div>
            <div className="flex gap-3" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowInjectModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleTransferToPondB} disabled={injecting || !injectAmount || Number(injectAmount) <= 0 || Number(injectAmount) > pondABalance}>
                {injecting ? '處理中...' : '確認注入'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 注入湖泊 Modal */}
      {showLakeModal && (
        <div className="modal-overlay" onClick={() => setShowLakeModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h3 className="modal-title">🌊 收入池 → 湖泊</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowLakeModal(false)}>✕</button>
            </div>
            <div style={{ marginBottom: 'var(--space-5)' }}>
              <p className="text-sm text-secondary">將收入池資金注入家庭湖泊，增加公共資金池。</p>
              <div className="flex justify-between text-xs font-mono" style={{ marginTop: 12, padding: 8, background: 'rgba(0,0,0,0.2)', borderRadius: 4 }}>
                <span>收入池可用：{formatTWD(pondABalance)}</span>
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
              <label className="form-label">注入金額</label>
              <input type="number" className="form-input" placeholder="0" max={pondABalance} value={injectLakeAmount} onChange={e => setInjectLakeAmount(e.target.value)} autoFocus />
            </div>
            <div className="flex gap-3" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowLakeModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleTransferToLake} disabled={injectingLake || !injectLakeAmount || Number(injectLakeAmount) <= 0 || Number(injectLakeAmount) > pondABalance}>
                {injectingLake ? '處理中...' : '確認注入'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

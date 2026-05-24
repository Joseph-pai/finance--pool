'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase';
import { PondA, PondB, IncomeItem, ExpenseItem, Transaction, Profile } from '@/types';
import { formatTWD, calcWaterLevel } from '@/lib/predictions';
import WaterWave from '@/components/animations/WaterWave';
import { format, parseISO } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { useRouter } from 'next/navigation';
import { LabelTooltip } from '@/components/ui/Tooltip';

export default function MyPondsPage() {
  const { profile, isAdmin } = useAuth();
  const supabase = createClient();
  const router = useRouter();

  const [pondA, setPondA]               = useState<PondA | null>(null);
  const [pondB, setPondB]               = useState<PondB | null>(null);
  const [incomes, setIncomes]           = useState<IncomeItem[]>([]);
  const [expenses, setExpenses]         = useState<ExpenseItem[]>([]);
  const [transactions, setTransactions] = useState<(Transaction & { profile?: Profile })[]>([]);
  const [loading, setLoading]           = useState(true);
  const [tab, setTab]                   = useState<'overview' | 'history'>('overview');
  
  // 支出池注入 modal
  const [showInjectModal, setShowInjectModal] = useState(false);
  const [injectAmount, setInjectAmount] = useState('');
  const [injecting, setInjecting]       = useState(false);
  
  // 湖泊注入 modal
  const [showLakeModal, setShowLakeModal]       = useState(false);
  const [lakeInjectSource, setLakeInjectSource] = useState<'pond_a' | 'pending'>('pond_a');
  const [injectLakeAmount, setInjectLakeAmount] = useState('');
  const [injectingLake, setInjectingLake]       = useState(false);

  // 支出池退款 modal
  const [showRefundModal, setShowRefundModal]   = useState(false);
  const [refundTarget, setRefundTarget]         = useState<'lake' | 'pond_a'>('pond_a');
  const [refundAmount, setRefundAmount]         = useState('');
  const [refunding, setRefunding]               = useState(false);

  // 成員與過濾交易 (Admin專用)
  const [filterUser, setFilterUser] = useState<string>('all');
  const [members, setMembers]       = useState<Profile[]>([]);
  
  // 編輯交易 (Admin專用)
  const [editTxModal, setEditTxModal] = useState<Transaction | null>(null);
  const [editTxForm, setEditTxForm]   = useState({ amount: '', transaction_date: '', note: '' });
  const [saving, setSaving]           = useState(false);

  const load = useCallback(async () => {
    if (!profile?.id || !profile?.family_id) return;
    setLoading(true);

    let txQuery = supabase.from('transactions').select('*, profile:profiles(*)');
    if (isAdmin && filterUser !== 'self') {
      if (filterUser === 'all') {
        txQuery = txQuery.eq('family_id', profile.family_id);
      } else {
        txQuery = txQuery.eq('user_id', filterUser);
      }
    } else {
      txQuery = txQuery.eq('user_id', profile.id);
    }

    const [pARes, pBRes, incRes, expRes, txRes, profRes] = await Promise.all([
      supabase.from('pond_a').select('*').eq('user_id', profile.id).single(),
      supabase.from('pond_b').select('*').eq('user_id', profile.id).single(),
      supabase.from('income_items').select('*').eq('user_id', profile.id).order('expected_date', { ascending: false }),
      supabase.from('expense_items').select('*').eq('user_id', profile.id).order('expected_date', { ascending: false }),
      txQuery.order('created_at', { ascending: false }).limit(50),
      supabase.from('profiles').select('*').eq('family_id', profile.family_id),
    ]);

    setPondA(pARes.data as PondA | null);
    setPondB(pBRes.data as PondB | null);
    setIncomes((incRes.data ?? []) as IncomeItem[]);
    setExpenses((expRes.data ?? []) as ExpenseItem[]);
    setTransactions((txRes.data ?? []) as (Transaction & { profile?: Profile })[]);
    setMembers((profRes.data ?? []) as Profile[]);
    setLoading(false);
  }, [profile?.id, profile?.family_id, filterUser, isAdmin, supabase]);

  useEffect(() => { load(); }, [load]);

  // ── 計算核心：全部基於資料庫取得的實際值 ──────────────────────────

  // Pond A 實際餘額（資料庫值，由觸發器維護）
  const pondABalance = pondA?.current_balance ?? 0;

  // Pond B 餘額（可能為正預付或負欠款）
  const pondBBalance = pondB?.current_balance ?? 0;
  const pondBDisplayStr = pondBBalance < 0 ? `-${formatTWD(Math.abs(pondBBalance))}` : pondBBalance > 0 ? `+${formatTWD(pondBBalance)}` : formatTWD(0);

  // 待入帳的預計收入（pending 狀態，用預計金額）
  const pendingIncomeTotal = incomes
    .filter(i => i.status === 'pending')
    .reduce((sum, i) => sum + i.amount, 0);

  // 可匯入湖泊的待入帳收入（尚未指定湖泊的 pending 項目）
  const pendingToLakeAmount = incomes
    .filter(i => i.status === 'pending' && i.destination !== 'lake')
    .reduce((sum, i) => sum + i.amount, 0);

  useEffect(() => {
    if (!showLakeModal) return;
    if (lakeInjectSource === 'pending') {
      setInjectLakeAmount(String(pendingToLakeAmount));
    } else {
      setInjectLakeAmount('');
    }
  }, [showLakeModal, lakeInjectSource, pendingToLakeAmount]);

  // 計畫中支出（planned + approved 狀態，尚未完成）
  const plannedExpenseTotal = expenses
    .filter(e => e.status === 'planned' || e.status === 'approved')
    .reduce((sum, e) => sum + e.amount, 0);

  // 已完成支出（completed 狀態）
  const completedExpenseTotal = expenses
    .filter(e => e.status === 'completed')
    .reduce((sum, e) => sum + e.amount, 0);

  // 方案 A：收入池顯示預估全貌，支出池大圖顯示計畫中的數值
  const incomeWaveAmount  = pondABalance + pendingIncomeTotal;
  const expenseWaveAmount = plannedExpenseTotal;

  // 調節後水量 = 收入池實際餘額 + 待入帳收入 - 計畫中支出
  // （代表個人資金的預估淨值）
  const adjustedBalance = pondABalance + pendingIncomeTotal - plannedExpenseTotal;

  // 水位顯示基準值
  const maxBalance   = Math.max(incomeWaveAmount, expenseWaveAmount, Math.abs(adjustedBalance), 1) * 1.3;
  const aLevel       = calcWaterLevel(incomeWaveAmount, maxBalance);
  const bLevel       = calcWaterLevel(expenseWaveAmount, maxBalance);
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
    income:             { text: '外部收入', color: 'var(--status-success)' },
    expense:            { text: '個人支出', color: 'var(--status-error)' },
    transfer_to_lake:   { text: '注水至湖泊', color: 'var(--text-accent)' },
    transfer_to_pond_b: { text: '注水至支出池', color: 'var(--pond-b)' },
    lake_expense:       { text: '湖泊支出', color: 'var(--status-error)' },
    lake_to_member:     { text: '湖泊撥款', color: 'var(--status-success)' },
    transfer_from_pond_b: { text: '支出池退款', color: 'var(--status-success)' },
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

    if (lakeInjectSource === 'pond_a') {
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
      } catch (err: any) {
        alert('注入湖泊失敗：' + (err.message || '發生未知錯誤'));
        console.error('注入湖泊失敗：', err);
        setInjectingLake(false);
        return;
      }
    } else {
      const pendingItems = incomes.filter(i => i.status === 'pending' && i.destination !== 'lake');
      if (pendingItems.length === 0) {
        alert('目前沒有可匯入湖泊的待入帳收入');
        return;
      }

      const targetAmount = pendingItems.reduce((sum, i) => sum + i.amount, 0);
      if (amt !== targetAmount) {
        alert(`待入帳匯入湖泊時，金額需等於目前可匯入湖泊的待入帳總額：${formatTWD(targetAmount)}`);
        return;
      }

      setInjectingLake(true);
      try {
        const { error } = await supabase
          .from('income_items')
          .update({ destination: 'lake' })
          .in('id', pendingItems.map(i => i.id));

        if (error) {
          throw new Error(error.message);
        }
      } catch (err: any) {
        alert('匯入湖泊預計收入失敗：' + (err.message || '發生未知錯誤'));
        console.error('匯入湖泊預計收入失敗：', err);
        setInjectingLake(false);
        return;
      }
    }

    setShowLakeModal(false);
    setInjectLakeAmount('');
    setLakeInjectSource('pond_a');
    load();
    setInjectingLake(false);
  };

  // ── 退回支出池資金 (Pond B) ─────────────────────────────────────────────
  const handleRefundPondB = async () => {
    const amt = Number(refundAmount);
    if (!amt || !profile || !pondB) return;
    if (amt > pondBBalance) { alert('退回金額不能超過支出池餘額'); return; }
    setRefunding(true);
    try {
      const type = refundTarget === 'lake' ? 'transfer_to_lake' : 'transfer_from_pond_b';
      const dest = refundTarget === 'lake' ? 'lake' : 'pond_a';
      const { error } = await supabase.from('transactions').insert({
        family_id: profile.family_id, user_id: profile.id,
        type: type, amount: amt,
        source: 'pond_b', destination: dest,
        note: `支出池退回資金至${refundTarget === 'lake' ? '湖泊' : '收入池'}`,
        transaction_date: new Date().toISOString().split('T')[0],
      });
      if (error) {
        throw new Error(error.message);
      }
      setShowRefundModal(false); setRefundAmount(''); load();
    } catch (err: any) { alert('退回資金失敗：' + (err.message || '發生未知錯誤')); console.error('退回資金失敗：', err); }
    finally { setRefunding(false); }
  };

  // ── 管理員編輯與刪除交易 ─────────────────────────────────────────────
  const openEditTx = (tx: Transaction) => {
    setEditTxModal(tx);
    setEditTxForm({
      amount: String(tx.amount),
      transaction_date: tx.transaction_date,
      note: tx.note ?? '',
    });
  };

  const handleSaveEditTx = async () => {
    if (!editTxModal) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('transactions')
        .update({
          amount: Number(editTxForm.amount),
          transaction_date: editTxForm.transaction_date,
          note: editTxForm.note,
        })
        .eq('id', editTxModal.id);

      if (error) throw error;
      setEditTxModal(null);
      load();
    } catch (err: any) {
      alert('修改交易失敗：' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTx = async (tx: Transaction) => {
    if (confirm(`⚠️ 確定要刪除此筆交易嗎？\n\n項目：${tx.note || tx.type}\n金額：${formatTWD(tx.amount)}\n成員：${tx.profile?.display_name ?? '未知'}\n\n注意：刪除此交易會自動觸發系統跨池水位重新對齊，且此操作無法復原。`)) {
      setSaving(true);
      try {
        const { error } = await supabase.from('transactions').delete().eq('id', tx.id);
        if (error) throw error;
        load();
      } catch (err: any) {
        alert('刪除交易失敗：' + err.message);
      } finally {
        setSaving(false);
      }
    }
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
              <WaterWave level={aLevel} variant="pond-a" height={180} label="💰 收入池 (預估總量)" amount={formatTWD(incomeWaveAmount)} />
              <div style={{ padding: 'var(--space-5)' }}>
                {/* 目前存量 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)', padding: '6px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>💵 目前可用 (未分配)</span>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--status-success)' }}>{formatTWD(pondABalance)}</span>
                </div>
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
              <WaterWave level={bLevel} variant="pond-b" height={180} label="💸 支出池 (計畫中支出)" amount={formatTWD(expenseWaveAmount)} />
              <div style={{ padding: 'var(--space-5)' }}>
                {/* 已完成的支出總額 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)', padding: '6px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>💸 已完成支出 (累計)</span>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--status-error)' }}>-{formatTWD(completedExpenseTotal)}</span>
                </div>
                {/* Pond B 語意說明 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 'var(--space-3)', padding: '6px 10px', background: pondBBalance < 0 ? 'rgba(224,82,82,0.08)' : pondBBalance > 0 ? 'rgba(26,158,92,0.08)' : 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-sm)', border: `1px solid ${pondBBalance < 0 ? 'rgba(224,82,82,0.2)' : pondBBalance > 0 ? 'rgba(26,158,92,0.2)' : 'var(--color-border)'}` }}>
                  <div className="flex gap-2 items-center">
                    <span style={{ fontSize: '0.72rem', color: pondBBalance < 0 ? 'var(--status-error)' : pondBBalance > 0 ? 'var(--status-success)' : 'var(--text-muted)' }}>
                      {pondBBalance < 0 ? '🔴 欠款中' : pondBBalance > 0 ? '🟢 預付餘額' : '⚪ 收支平衡'}
                    </span>
                    <LabelTooltip text={
                      "系統設計說明：Pond A（個人收入池）與 Lake（家庭湖泊）不會顯示負值；若支出超過收入，欠款會顯示在支出池（Pond B）的負數中。支出池負值表示有尚未補足的支出缺口，需由個人或管理員處理。"
                    } />
                  </div>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: pondBBalance < 0 ? 'var(--status-error)' : pondBBalance > 0 ? 'var(--status-success)' : 'var(--text-muted)' }}>
                    {pondBDisplayStr}
                  </span>
                </div>
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
                {pondBBalance > 0 && (
                  <button className="btn btn-ghost btn-sm w-full" style={{ marginBottom: 'var(--space-4)', borderColor: 'rgba(124,58,237,0.4)', color: 'var(--pond-b-light)' }} onClick={() => setShowRefundModal(true)}>
                    ← 退回 / 轉出資金
                  </button>
                )}
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
          <div className="flex items-center justify-between flex-wrap gap-4" style={{ marginBottom: 'var(--space-5)' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>交易記錄（最近50筆）</h2>
            
            {/* 系統管理員專用成員過濾下拉選單 */}
            {isAdmin && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted font-semibold">成員交易過濾:</span>
                <select
                  className="form-input form-select"
                  style={{ width: 'auto', padding: '4px 8px', fontSize: '0.85rem' }}
                  value={filterUser}
                  onChange={e => setFilterUser(e.target.value)}
                  id="ponds-tx-filter"
                >
                  <option value="all">🌐 所有成員交易</option>
                  <option value="self">👤 僅看我的交易</option>
                  {members.filter(m => m.id !== profile?.id).map(m => (
                    <option key={m.id} value={m.id}>👤 {m.display_name} 的交易</option>
                  ))}
                </select>
              </div>
            )}
          </div>

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
                    {isAdmin && <th>成員</th>}
                    <th>類型</th>
                    <th>備註</th>
                    <th style={{ textAlign: 'right' }}>金額</th>
                    {isAdmin && <th style={{ textAlign: 'center' }}>操作</th>}
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(tx => {
                    const tl   = typeLabel[tx.type] ?? { text: tx.type, color: 'var(--text-primary)' };
                    const isIn = ['income', 'lake_to_member', 'transfer_from_pond_b'].includes(tx.type);
                    
                    return (
                      <tr key={tx.id}>
                        <td className="text-secondary">{format(parseISO(tx.transaction_date), 'MM/dd', { locale: zhTW })}</td>
                        {isAdmin && (
                          <td className="font-semibold text-secondary">
                            {tx.profile?.display_name ?? '未知'}
                          </td>
                        )}
                        <td><span style={{ color: tl.color, fontWeight: 500, fontSize: '0.85rem' }}>{tl.text}</span></td>
                        <td className="text-secondary">{tx.note || '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'Inter', fontWeight: 600, color: isIn ? 'var(--status-success)' : 'var(--status-error)' }}>
                          {isIn ? '+' : '-'}{formatTWD(tx.amount)}
                        </td>
                        {isAdmin && (
                          <td style={{ textAlign: 'center' }}>
                            <div className="flex gap-2 justify-center">
                              <button className="btn btn-ghost btn-sm" onClick={() => openEditTx(tx)} id={`tx-edit-${tx.id}`}>編輯</button>
                              <button className="btn btn-danger btn-sm" onClick={() => handleDeleteTx(tx)} id={`tx-delete-${tx.id}`}>刪除</button>
                            </div>
                          </td>
                        )}
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
      {showInjectModal && (
        <div className="modal-overlay" onClick={() => setShowInjectModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h3 className="modal-title">💸 收入池 → 支出池</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowInjectModal(false)}>✕</button>
            </div>
            <div style={{ marginBottom: 'var(--space-5)' }}>
              <p className="text-sm text-secondary">將收入池資金移轉至支出池，增加個人可用餘額。</p>
              <div className="flex justify-between text-xs font-mono" style={{ marginTop: 12, padding: 8, background: 'rgba(0,0,0,0.2)', borderRadius: 4 }}>
                <span>收入池可用：{formatTWD(pondABalance)}</span>
                <span>支出池餘額：{pondBDisplayStr}</span>
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                注入金額
                <span className="text-xs text-muted" style={{ marginLeft: 8, fontWeight: 400 }}>（最多 {formatTWD(pondABalance)}）</span>
                <LabelTooltip text={`從收入池轉入支出池，最多可注入 ${formatTWD(pondABalance)}。注入後支出池餘額會增加，可用於支付支出。`} />
              </label>
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
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h3 className="modal-title">🌊 收入池 → 湖泊</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowLakeModal(false)}>✕</button>
            </div>
            <div style={{ marginBottom: 'var(--space-5)' }}>
              <p className="text-sm text-secondary">選擇要匯入湖泊的來源，再輸入要匯入的金額。</p>
              <div style={{ marginTop: 12, padding: 10, background: 'rgba(0,0,0,0.2)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="flex justify-between text-xs font-mono">
                  <span>收入池可用：{formatTWD(pondABalance)}</span>
                  <span>待入帳：{formatTWD(pendingToLakeAmount)}</span>
                </div>
                <div className="text-xs text-secondary">
                  <span>目前可匯入湖泊的待入帳收入：{formatTWD(pendingToLakeAmount)}</span>
                </div>
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
              <label className="form-label">匯入來源</label>
              <select
                className="form-input form-select"
                value={lakeInjectSource}
                onChange={e => {
                  setLakeInjectSource(e.target.value as 'pond_a' | 'pending');
                  setInjectLakeAmount('');
                }}
              >
                <option value="pond_a">💰 收入池可用</option>
                <option value="pending">⏳ 待入帳</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                注入金額
                <span className="text-xs text-muted" style={{ marginLeft: 8, fontWeight: 400 }}>
                  （最多 {formatTWD(lakeInjectSource === 'pond_a' ? pondABalance : pendingToLakeAmount)}）
                </span>
                <LabelTooltip text={lakeInjectSource === 'pond_a' ? `從個人收入池注入家庭公共湖泊，最多可注入 ${formatTWD(pondABalance)}。此操作不可撤銷，注入後由管理員統一調配。` : `將尚未確認的預計收入標記為匯入湖泊，湖泊預估水位會立即增加。選擇此來源後，會一次將目前可匯入湖泊的待入帳收入加入湖泊。`} />
              </label>
              <input
                type="number"
                className="form-input"
                placeholder={lakeInjectSource === 'pond_a' ? '0' : String(pendingToLakeAmount)}
                max={lakeInjectSource === 'pond_a' ? pondABalance : pendingToLakeAmount}
                value={injectLakeAmount}
                onChange={e => setInjectLakeAmount(e.target.value)}
                disabled={lakeInjectSource === 'pending'}
                autoFocus
              />
            </div>
            <div className="flex gap-3" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowLakeModal(false)}>取消</button>
              <button
                className="btn btn-primary"
                onClick={handleTransferToLake}
                disabled={
                  injectingLake ||
                  !injectLakeAmount ||
                  Number(injectLakeAmount) <= 0 ||
                  Number(injectLakeAmount) > (lakeInjectSource === 'pond_a' ? pondABalance : pendingToLakeAmount)
                }
              >
                {injectingLake ? '處理中...' : '確認注入'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 退回支出池資金 Modal */}
      {showRefundModal && (
        <div className="modal-overlay" onClick={() => setShowRefundModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h3 className="modal-title">💸 支出池退回資金</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowRefundModal(false)}>✕</button>
            </div>
            <div style={{ marginBottom: 'var(--space-5)' }}>
              <p className="text-sm text-secondary">將支出池的預付餘額轉出至其他池塘。</p>
              <div className="flex justify-between text-xs font-mono" style={{ marginTop: 12, padding: 8, background: 'rgba(0,0,0,0.2)', borderRadius: 4 }}>
                <span>支出池可退餘額：{formatTWD(pondBBalance)}</span>
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                退回目標
                <LabelTooltip text="選擇將多餘資金退回到收入池（個人使用）或湖泊（家庭公用）" />
              </label>
              <select className="form-input" value={refundTarget} onChange={e => setRefundTarget(e.target.value as 'lake' | 'pond_a')}>
                <option value="pond_a">💰 我的收入池 (池塘 A)</option>
                <option value="lake">🌊 家庭湖泊</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                退回金額
                <span className="text-xs text-muted" style={{ marginLeft: 8, fontWeight: 400 }}>（最多 {formatTWD(pondBBalance)}）</span>
                <LabelTooltip text={`支出池目前有 ${formatTWD(pondBBalance)} 預付餘額，全部或部分可退回至所選目標`} />
              </label>
              <input type="number" className="form-input" placeholder="0" max={pondBBalance} value={refundAmount} onChange={e => setRefundAmount(e.target.value)} autoFocus />
            </div>
            <div className="flex gap-3" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowRefundModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleRefundPondB} disabled={refunding || !refundAmount || Number(refundAmount) <= 0 || Number(refundAmount) > pondBBalance}>
                {refunding ? '處理中...' : '確認退回'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 編輯交易記錄 Modal (Admin Only) */}
      {editTxModal && (
        <div className="modal-overlay" onClick={() => setEditTxModal(null)}>
          <div className="modal" style={{ maxWidth: 450 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">⚙️ 編輯交易紀錄 (管理員專用)</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditTxModal(null)} id="tx-edit-close">✕</button>
            </div>
            <div style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-3)', background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <p className="text-xs text-muted">交易類型與關聯</p>
              <p className="text-sm"><span className="text-muted">類型：</span>{typeLabel[editTxModal.type]?.text || editTxModal.type}</p>
              <p className="text-sm"><span className="text-muted">成員：</span>{editTxModal.profile?.display_name ?? '系統'}</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div className="form-group">
                <label className="form-label">交易金額</label>
                <input type="number" className="form-input" value={editTxForm.amount} onChange={e => setEditTxForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">交易日期</label>
                <input type="date" className="form-input" value={editTxForm.transaction_date} onChange={e => setEditTxForm(f => ({ ...f, transaction_date: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">備註/摘要</label>
                <input type="text" className="form-input" value={editTxForm.note} onChange={e => setEditTxForm(f => ({ ...f, note: e.target.value }))} />
              </div>
              <div className="flex gap-3" style={{ justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
                <button className="btn btn-ghost" onClick={() => setEditTxModal(null)}>取消</button>
                <button className="btn btn-primary" onClick={handleSaveEditTx} disabled={saving || !editTxForm.amount} id="tx-edit-save">
                  {saving ? '儲存中...' : '✓ 儲存變更'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

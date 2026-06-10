'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase';
import { Lake, LakeExpense, LakeRequest, DryPrediction, IncomeItem, Transaction, ExpenseItem } from '@/types';
import { formatTWD, calculateLakeDryDate, calculateLakeBalanceToDate } from '@/lib/predictions';
import type { BalanceToDateResult } from '@/lib/predictions';
import { format, parseISO } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { useRouter } from 'next/navigation';
import WaterWave from '@/components/animations/WaterWave';
import { Profile } from '@/types';
import { LabelTooltip } from '@/components/ui/Tooltip';

type ModalMode = 'add' | 'edit' | 'set-balance' | 'inject' | null;

interface ConflictWarning {
  approvedRequests: LakeRequest[];
  injectedIncomes: IncomeItem[];
  totalConflict: number;
}

export default function LakePage() {
  const { profile, canManageLake } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const [lake, setLake]             = useState<Lake | null>(null);
  const [expenses, setExpenses]     = useState<LakeExpense[]>([]);
  const [lakeRequests, setLakeRequests] = useState<LakeRequest[]>([]);
  const [incomes, setIncomes]       = useState<IncomeItem[]>([]);
  const [lakeTransactions, setLakeTransactions] = useState<Transaction[]>([]);
  const [allExpenses, setAllExpenses] = useState<ExpenseItem[]>([]);
  const [computedLakeBalance, setComputedLakeBalance] = useState(0);
  const [prediction, setPrediction] = useState<DryPrediction | null>(null);
  const [predMode, setPredMode]     = useState<'current' | 'estimated'>('current');
  const [predEndDate, setPredEndDate] = useState<string>('');
  const [balanceToDate, setBalanceToDate] = useState<BalanceToDateResult | null>(null);
  const [loading, setLoading]       = useState(true);
  const [modal, setModal]           = useState<ModalMode>(null);
  const [selected, setSelected]     = useState<LakeExpense | null>(null);
  const [saving, setSaving]         = useState(false);
  const [newBalance, setNewBalance] = useState('');
  const [members, setMembers]       = useState<Profile[]>([]);
  // 調整餘額彈窗步驟（1=選類型, 2=輸入數值）
  const [balanceStep, setBalanceStep]   = useState<1 | 2>(1);
  const [balanceType, setBalanceType]   = useState<'current' | 'estimated'>('current');
  const [conflictWarning, setConflictWarning] = useState<ConflictWarning | null>(null);

  const [injectForm, setInjectForm] = useState({
    user_id: '',
    amount: '',
    is_immediate: true,
    expected_date: format(new Date(), 'yyyy-MM-dd'),
  });

  const [form, setForm] = useState({
    name: '', expected_date: '', amount: '',
    is_recurring: false,
    recurrence_rule: 'monthly' as 'monthly' | 'quarterly' | 'yearly',
  });

  // 初始化預測模式
  useEffect(() => {
    const stored = localStorage.getItem('family-pool-pred-mode');
    if (stored === 'current' || stored === 'estimated') {
      setPredMode(stored);
    }
  }, []);

  const load = useCallback(async () => {
    if (!profile?.family_id) return;
    setLoading(true);
    const [lakeRes, expRes, reqRes, profRes, incRes, txRes, allExpRes] = await Promise.all([
      supabase.from('lake').select('*').eq('family_id', profile.family_id).single(),
      supabase.from('lake_expenses').select('*').eq('family_id', profile.family_id).order('expected_date'),
      supabase.from('lake_requests').select('*').eq('family_id', profile.family_id).eq('status', 'approved'),
      supabase.from('profiles').select('*').eq('family_id', profile.family_id),
      supabase.from('income_items').select('*').eq('family_id', profile.family_id),
      supabase.from('transactions').select('*').eq('family_id', profile.family_id),
      supabase.from('expense_items').select('*').eq('family_id', profile.family_id),
    ]);
    const lakeData = lakeRes.data as Lake | null;
    const expData   = (expRes.data ?? []) as LakeExpense[];
    const reqData   = (reqRes.data ?? []) as LakeRequest[];
    const incData   = (incRes.data ?? []) as IncomeItem[];
    const txData    = (txRes.data ?? []) as Transaction[];
    const allExpData = (allExpRes.data ?? []) as ExpenseItem[];

    setLake(lakeData);
    setExpenses(expData);
    setLakeRequests(reqData);
    setIncomes(incData);
    setLakeTransactions(txData);
    setAllExpenses(allExpData);
    setMembers((profRes.data ?? []) as Profile[]);

    const computedLakeBalance = Math.max(0,
      txData
        .filter(t => t.type === 'transfer_to_lake')
        .reduce((sum, t) => sum + t.amount, 0)
      + txData
        .filter(t => t.type === 'transfer_from_pond_b' && t.destination === 'lake')
        .reduce((sum, t) => sum + t.amount, 0)
      + incData
        .filter(i => i.status === 'confirmed' && i.destination === 'lake')
        .reduce((sum, i) => sum + (i.actual_amount ?? i.amount), 0)
      - txData
        .filter(t => t.type === 'lake_to_member')
        .reduce((sum, t) => sum + t.amount, 0)
      - txData
        .filter(t => t.type === 'lake_expense')
        .reduce((sum, t) => sum + t.amount, 0)
      // 管理員餘額校正交易
      + txData
        .filter(t => t.type === 'lake_balance_adjustment' && t.source === 'adjustment_add')
        .reduce((sum, t) => sum + t.amount, 0)
      - txData
        .filter(t => t.type === 'lake_balance_adjustment' && t.source === 'adjustment_subtract')
        .reduce((sum, t) => sum + t.amount, 0)
    );
    setComputedLakeBalance(computedLakeBalance);
    setLoading(false);
  }, [profile?.family_id, supabase]);

  useEffect(() => {
    if (profile && !canManageLake) router.replace('/dashboard');
    else load();
  }, [profile, router, load]);

  useEffect(() => {
    if (!profile?.family_id) return;
    const channel = supabase.channel('lake-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lake', filter: `family_id=eq.${profile.family_id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `family_id=eq.${profile.family_id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'income_items', filter: `family_id=eq.${profile.family_id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lake_expenses', filter: `family_id=eq.${profile.family_id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lake_requests', filter: `family_id=eq.${profile.family_id}` }, load)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile?.family_id, supabase, load]);

  const pendingLakeIncome = incomes
    .filter(i => i.destination === 'lake' && i.status === 'pending')
    .reduce((sum, i) => sum + i.amount, 0);

  // 已批准的湖泊調撥申請（尚未執行交易）
  const approvedLakeRequests = lakeRequests
    .filter(r => r.status === 'approved')
    .reduce((sum, r) => sum + (r.approved_amount ?? r.requested_amount), 0);

  // 啟用中的湖泊必要支出
  const activeLakeExpensesTotal = expenses
    .filter(e => e.status === 'active')
    .reduce((sum, e) => sum + e.amount, 0);

  // 預估餘額 = 當前餘額 + 待入帳收入 - 已批准申請 - 啟用中支出
  const estimatedLakeBalance = computedLakeBalance + pendingLakeIncome - approvedLakeRequests - activeLakeExpensesTotal;

  // 動態監聽並計算乾涸預測（永遠使用今天為起始日）
  useEffect(() => {
    const pred = calculateLakeDryDate(
      computedLakeBalance,
      expenses.filter(e => e.status === 'active'),
      lakeRequests,
      incomes,
      predMode,
    );
    setPrediction(pred);
    // 非同步更新資料庫中儲存的乾涸日期
    if (lake) {
      supabase.from('lake').update({ dry_date: pred.dry_date ?? null }).eq('id', lake.id).then();
    }
  }, [computedLakeBalance, expenses, lakeRequests, incomes, predMode, supabase, lake]);

  // 當截止日選擇後，計算資金缺口/充裕分析
  useEffect(() => {
    if (!predEndDate) {
      setBalanceToDate(null);
      return;
    }
    const result = calculateLakeBalanceToDate(
      computedLakeBalance,
      expenses.filter(e => e.status === 'active'),
      lakeRequests,
      incomes,
      parseISO(predEndDate),
      allExpenses,
      predMode,
      pendingLakeIncome,
      activeLakeExpensesTotal,
      approvedLakeRequests,
    );
    setBalanceToDate(result);
  }, [predEndDate, computedLakeBalance, expenses, lakeRequests, incomes, allExpenses, predMode, pendingLakeIncome, activeLakeExpensesTotal, approvedLakeRequests]);


  const openAdd = () => {
    setForm({ name: '', expected_date: format(new Date(), 'yyyy-MM-dd'), amount: '', is_recurring: false, recurrence_rule: 'monthly' });
    setSelected(null);
    setModal('add');
  };

  const openEdit = (exp: LakeExpense) => {
    setForm({ name: exp.name, expected_date: exp.expected_date, amount: String(exp.amount), is_recurring: exp.is_recurring, recurrence_rule: exp.recurrence_rule ?? 'monthly' });
    setSelected(exp);
    setModal('edit');
  };

  const closeModal = () => { setModal(null); setSelected(null); setSaving(false); };

  const handleSaveExpense = async () => {
    if (!profile?.family_id) return;
    setSaving(true);
    const data = {
      name: form.name,
      expected_date: form.expected_date,
      amount: Number(form.amount),
      is_recurring: form.is_recurring,
      recurrence_rule: form.is_recurring ? form.recurrence_rule : null,
      family_id: profile.family_id,
      status: 'active' as const,
    };
    if (modal === 'add') {
      await supabase.from('lake_expenses').insert(data);
    } else if (modal === 'edit' && selected) {
      await supabase.from('lake_expenses').update(data).eq('id', selected.id);
    }
    closeModal();
    load();
  };

  const handleDelete = async (id: string) => {
    await supabase.from('lake_expenses').delete().eq('id', id);
    load();
  };

  const handleToggleStatus = async (exp: LakeExpense) => {
    const newStatus = exp.status === 'active' ? 'paused' : 'active';
    await supabase.from('lake_expenses').update({ status: newStatus }).eq('id', exp.id);
    load();
  };

  // 衝突檢查：調整後餘額是否足夠支付已批准申請與已注入收入池
  const checkConflicts = (targetValue: number, type: 'current' | 'estimated') => {
    const baseValue = type === 'current' ? computedLakeBalance : estimatedLakeBalance;
    const delta = targetValue - baseValue;
    if (delta >= 0) {
      setConflictWarning(null);
      return;
    }
    // 已批准的調撥申請
    const approvedReqs = lakeRequests.filter(r => r.status === 'approved');
    const approvedTotal = approvedReqs.reduce(
      (sum, r) => sum + (r.approved_amount ?? r.requested_amount), 0
    );
    // 已從湖泊注入收入池但尚未確認到帳（source='lake', status='pending'）
    const injectedInc = incomes.filter(i => i.source === 'lake' && i.status === 'pending');
    const injectedTotal = injectedInc.reduce((sum, i) => sum + i.amount, 0);
    const totalConflict = approvedTotal + injectedTotal;
    if (targetValue < totalConflict) {
      setConflictWarning({ approvedRequests: approvedReqs, injectedIncomes: injectedInc, totalConflict });
    } else {
      setConflictWarning(null);
    }
  };

  const handleSetBalance = async (forceConfirm = false) => {
    if (!lake || !newBalance || !profile?.family_id) return;
    const targetValue = Number(newBalance);
    const baseValue = balanceType === 'current' ? computedLakeBalance : estimatedLakeBalance;
    const delta = targetValue - baseValue;

    // 若有衝突且未強制確認，不執行
    if (conflictWarning && !forceConfirm) return;

    setSaving(true);

    if (delta !== 0) {
      const { error } = await supabase.from('transactions').insert({
        family_id: profile.family_id,
        user_id: profile.id,
        type: 'lake_balance_adjustment',
        amount: Math.abs(delta),
        source: delta > 0 ? 'adjustment_add' : 'adjustment_subtract',
        destination: 'lake',
        note: `管理員調整${balanceType === 'current' ? '當前' : '預估'}餘額（${formatTWD(baseValue)} → ${formatTWD(targetValue)}，差額 ${delta > 0 ? '+' : ''}${formatTWD(delta)}）`,
        transaction_date: new Date().toISOString().substring(0, 10),
      });
      if (error) {
        alert('更新失敗：' + error.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setModal(null);
    setNewBalance('');
    setBalanceStep(1);
    setBalanceType('current');
    setConflictWarning(null);
    load();
  };

  const handleInject = async () => {
    if (!profile?.family_id || !lake) return;
    const amt = Number(injectForm.amount);
    if (!amt || !injectForm.user_id) return;
    if (amt > currentLakeBalance) {
      alert('注入金額不能超過湖泊餘額');
      return;
    }
    setSaving(true);
    
    try {
      const today = new Date().toISOString().substring(0, 10);
      
      // 1. 永遠立即扣除湖泊
      const { error: txErr } = await supabase.from('transactions').insert({
        family_id: profile.family_id,
        user_id: injectForm.user_id,
        type: 'lake_to_member',
        amount: amt,
        source: 'lake',
        destination: 'pond_a',
        note: `湖泊撥款至成員收入池${injectForm.is_immediate ? '' : '(預約)'}`,
        transaction_date: today,
      });
      if (txErr) throw new Error(txErr.message);

      // 2. 建立收入紀錄供成員確認/顯示
      const isNow = injectForm.is_immediate;
      const { error: incErr } = await supabase.from('income_items').insert({
        family_id: profile.family_id,
        user_id: injectForm.user_id,
        name: '湖泊資金撥入',
        expected_date: isNow ? today : injectForm.expected_date,
        amount: amt,
        actual_amount: isNow ? amt : null,
        status: isNow ? 'confirmed' : 'pending',
        source: 'lake',
        confirmed_at: isNow ? new Date().toISOString() : null,
      });
      if (incErr) throw new Error(incErr.message);
      
      setModal(null);
      setInjectForm(f => ({ ...f, amount: '' }));
      load();
    } catch (err: any) {
      alert('調撥失敗：' + err.message);
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const initLake = async () => {
    if (!profile?.family_id) return;
    await supabase.from('lake').upsert({ family_id: profile.family_id, current_balance: 0 }, { onConflict: 'family_id' });
    load();
  };

  const warningColor = {
    safe: 'var(--status-success)',
    warning: 'var(--status-warning)',
    danger: 'var(--lake-danger)',
    critical: 'var(--status-error)',
  }[prediction?.warning_level ?? 'safe'];

  const currentLakeBalance = computedLakeBalance;

  const currentWaterLevel = Math.min(100, Math.max(0, (currentLakeBalance / Math.max(currentLakeBalance * 1.5, 1)) * 100));
  const estimatedWaterLevel = Math.min(100, Math.max(0, (estimatedLakeBalance / Math.max(estimatedLakeBalance * 1.5, 1)) * 100));

  const lakeStatusMessage = currentLakeBalance === 0 ? '💡 請先設定湖泊初始餘額' : '✅ 暫無乾涸風險';

  const recurringLabel: Record<string, string> = { monthly: '每月', quarterly: '每季', yearly: '每年' };
  const statusLabel: Record<string, string>    = { active: '啟用', paused: '暫停', completed: '完成' };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">🌊 湖泊管理</h1>
        <p className="page-subtitle">管理家庭共同資金池 — 僅限管理員</p>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gap: 'var(--space-6)' }}>
          {[1,2].map(i => <div key={i} className="skeleton" style={{ height: 200, borderRadius: 'var(--radius-lg)' }} />)}
        </div>
      ) : !lake ? (
        <div className="empty-state">
          <span className="empty-state-icon">🌊</span>
          <p className="empty-state-title">尚未初始化湖泊</p>
          <p className="empty-state-desc">點擊下方按鈕初始化家庭湖泊（初始餘額 $0）</p>
          <button className="btn btn-primary btn-lg" onClick={initLake} id="lake-init-btn">初始化湖泊</button>
        </div>
      ) : (
        <>
          {/* Lake Status */}

          <div className="card" style={{ marginBottom: 'var(--space-8)', padding: 'var(--space-6)', background: 'rgba(30,60,120,0.10)' }}>

            <div style={{ display: 'flex', flexDirection: 'row', gap: '48px', justifyContent: 'center', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 'var(--space-5)' }}>
              {/* 預估餘額湖泊（左） */}
              <div style={{ minWidth: 320, maxWidth: 400, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'rgba(60,120,180,0.10)', borderRadius: 18, boxShadow: '0 2px 16px 0 rgba(0,0,0,0.08)', padding: '32px 16px 24px 16px', margin: 8 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--pond-a-light)', marginBottom: 8 }}>家庭湖泊（預估餘額）</div>
                <WaterWave
                  level={estimatedWaterLevel}
                  variant="lake"
                  height={220}
                  label="預估餘額"
                  amount={formatTWD(estimatedLakeBalance)}
                  warningLevel={prediction?.warning_level ?? 'safe'}
                />
                <div style={{ fontSize: 48, fontWeight: 900, color: 'var(--pond-a-light)', marginTop: 12, textAlign: 'center' }}>{formatTWD(estimatedLakeBalance)}</div>
                <div className="text-xs text-secondary" style={{ marginTop: 6 }}>包含已確認與所有待入帳的預計收入</div>
              </div>

              {/* 當前餘額湖泊（右） */}
              <div style={{ minWidth: 320, maxWidth: 400, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'rgba(30,60,120,0.13)', borderRadius: 18, boxShadow: '0 2px 16px 0 rgba(0,0,0,0.08)', padding: '32px 16px 24px 16px', margin: 8 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--lake-safe)', marginBottom: 8 }}>家庭湖泊（當前餘額）</div>
                <WaterWave
                  level={currentWaterLevel}
                  variant="lake"
                  height={220}
                  label="當前餘額"
                  amount={formatTWD(currentLakeBalance)}
                  warningLevel={prediction?.warning_level ?? 'safe'}
                />
                <div style={{ fontSize: 48, fontWeight: 900, color: 'var(--lake-safe)', marginTop: 12, textAlign: 'center' }}>{formatTWD(currentLakeBalance)}</div>
                <div className="text-xs text-secondary" style={{ marginTop: 6 }}>只包含已確認收入與已發生支出</div>
              </div>
            </div>

            <div className="flex items-center justify-between flex-wrap gap-4" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 'var(--space-5)' }}>
              <div>
                <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 'var(--space-2)' }}>
                  <select
                    value={predMode}
                    onChange={(e) => {
                      const val = e.target.value as 'current' | 'estimated';
                      setPredMode(val);
                      localStorage.setItem('family-pool-pred-mode', val);
                    }}
                    className="text-xs font-semibold"
                    style={{
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: 'var(--radius-md)',
                      padding: '2px 8px',
                      color: 'var(--text-primary)',
                      outline: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="current" style={{ backgroundColor: 'var(--card-bg)' }}>當前水位預測</option>
                    <option value="estimated" style={{ backgroundColor: 'var(--card-bg)' }}>預估餘額預測</option>
                  </select>
                  <span className="text-xs text-muted" style={{ margin: '0 4px' }}>截止日</span>
                  <input
                    type="date"
                    value={predEndDate}
                    onChange={e => setPredEndDate(e.target.value)}
                    className="form-input"
                    style={{ width: 150, padding: '2px 8px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', outline: 'none' }}
                    title="選擇截止日期，計算從今天到該日期間的資金缺口或充裕結餘"
                  />
                  {predEndDate && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPredEndDate('')}
                      style={{ padding: '2px 6px', fontSize: '0.7rem' }}
                      title="清除截止日"
                    >✕</button>
                  )}
                </div>
                {prediction?.dry_date ? (
                  <div>
                    <span className="text-secondary text-sm">🔴 經濟安全到期日：</span>
                    <span className="font-bold" style={{ color: warningColor, marginLeft: 6 }}>
                      {format(parseISO(prediction.dry_date), 'yyyy年M月d日', { locale: zhTW })}
                      {prediction.days_remaining !== null && <span className="text-secondary font-normal" style={{ marginLeft: 8 }}>（{prediction.days_remaining} 天後）</span>}
                    </span>
                    {prediction.deficit_amount && prediction.deficit_amount > 0 && (
                      <div style={{ marginTop: 6, padding: '8px 12px', background: 'rgba(224,82,82,0.12)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: 'var(--status-error)' }}>
                        ⚠️ 要在 {format(new Date(prediction.dry_date), 'yyyy年MM月dd日')} 前補充 {formatTWD(prediction.deficit_amount)} 資金
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="text-secondary text-sm">
                    經濟安全到期日：—
                  </span>
                )}

                {/* 截止日資金分析 */}
                {predEndDate && balanceToDate && (
                  <div style={{
                    marginTop: 'var(--space-4)',
                    padding: 'var(--space-4)',
                    borderRadius: 'var(--radius-md)',
                    background: balanceToDate.is_surplus
                      ? 'rgba(40,167,69,0.08)'
                      : 'rgba(224,82,82,0.10)',
                    border: `1px solid ${balanceToDate.is_surplus ? 'rgba(40,167,69,0.25)' : 'rgba(224,82,82,0.25)'}`,
                  }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                      📊 截止至 {format(parseISO(balanceToDate.end_date), 'yyyy/MM/dd')} 資金分析
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', fontSize: '0.82rem' }}>
                      <div>
                        <span className="text-muted">起始餘額：</span>
                        <span style={{ fontWeight: 600 }}>{formatTWD(balanceToDate.starting_balance)}</span>
                      </div>
                      <div>
                        <span className="text-muted">預計收入：</span>
                        <span style={{ color: 'var(--status-success)', fontWeight: 600 }}>+{formatTWD(balanceToDate.total_inflow)}</span>
                      </div>
                      <div>
                        <span className="text-muted">預計支出：</span>
                        <span style={{ color: 'var(--status-error)', fontWeight: 600 }}>-{formatTWD(balanceToDate.total_outflow)}</span>
                      </div>
                      <div>
                        <span className="text-muted">預估餘額：</span>
                        <span style={{
                          fontWeight: 700,
                          fontSize: '0.95rem',
                          color: balanceToDate.is_surplus ? 'var(--status-success)' : 'var(--status-error)',
                        }}>
                          {formatTWD(Math.abs(balanceToDate.ending_balance))}
                          {balanceToDate.is_surplus ? ' (充裕)' : ' (缺口)'}
                        </span>
                      </div>
                    </div>
                    {balanceToDate.events.length > 0 && (
                      <details style={{ marginTop: 'var(--space-3)' }}>
                        <summary style={{ cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          查看明細（{balanceToDate.events.length} 筆）
                        </summary>
                        <div style={{ marginTop: 'var(--space-2)', maxHeight: 200, overflowY: 'auto' }}>
                          {balanceToDate.events.map((ev, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '0.78rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                              <span style={{ color: 'var(--text-muted)' }}>{format(parseISO(ev.date), 'M/d')}</span>
                              <span>{ev.name}</span>
                              <span style={{ fontWeight: 600, color: ev.type === 'inflow' ? 'var(--status-success)' : 'var(--status-error)' }}>
                                {ev.type === 'inflow' ? '+' : '-'}{formatTWD(ev.amount)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}

              </div>
              <div className="flex gap-2">
                <button className="btn btn-primary" onClick={() => setModal('inject')} id="lake-inject-member-btn">
                  調撥給成員
                </button>
                <button className="btn btn-ghost" onClick={() => { setNewBalance(''); setBalanceStep(1); setBalanceType('current'); setConflictWarning(null); setModal('set-balance'); }} id="lake-set-balance-btn">
                  調整餘額
                </button>
              </div>
            </div>
          </div>

          {/* Prediction Timeline */}
          {prediction && prediction.scheduled_outflows.length > 0 && (
            <div className="card" style={{ marginBottom: 'var(--space-8)' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 'var(--space-5)' }}>
                {predMode === 'estimated' ? '📊 家庭收支預測時間軸' : '📊 支出時間軸預測'}
              </h2>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>項目</th>
                      <th style={{ textAlign: 'right' }}>金額</th>
                      <th style={{ textAlign: 'right' }}>累計淨支出</th>
                      <th style={{ textAlign: 'right' }}>預估餘額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prediction.scheduled_outflows.slice(0, 12).map((o, i) => {
                      const isInflow = (o as any).type === 'inflow';
                      const remaining = currentLakeBalance - o.cumulative;
                      return (
                        <tr key={i}>
                          <td>{format(parseISO(o.date), 'yyyy/MM/dd')}</td>
                          <td>{o.name}</td>
                          <td style={{ textAlign: 'right', color: isInflow ? 'var(--status-success)' : 'var(--status-error)', fontWeight: isInflow ? 600 : 500 }}>
                            {isInflow ? '+' : '-'}{formatTWD(o.amount)}
                          </td>
                          <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                            {o.cumulative > 0 ? '' : '-'}{formatTWD(Math.abs(o.cumulative))}
                          </td>
                          <td style={{ textAlign: 'right', color: remaining < 0 ? 'var(--status-error)' : remaining < currentLakeBalance * 0.2 ? 'var(--status-warning)' : 'var(--status-success)', fontWeight: 600 }}>
                            {formatTWD(Math.max(0, remaining))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Lake Expenses Management */}
          <div>
            <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-5)' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>🏠 家庭必要支出</h2>
              <button className="btn btn-primary btn-sm" onClick={openAdd} id="lake-add-expense-btn">+ 新增支出</button>
            </div>

            {expenses.length === 0 ? (
              <div className="empty-state" style={{ padding: 'var(--space-10) var(--space-8)' }}>
                <span className="empty-state-icon">🏠</span>
                <p className="empty-state-title">尚無支出項目</p>
                <p className="empty-state-desc">新增家庭必要支出項目，如房租、水電費</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {expenses.map((exp) => (
                  <div key={exp.id} className="card card-sm" style={{ opacity: exp.status === 'paused' ? 0.6 : 1 }}>
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div className="flex gap-3 items-start" style={{ flex: 1 }}>
                        <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>🏠</span>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold">{exp.name}</span>
                            <span className={`badge ${exp.status === 'active' ? 'badge-success' : 'badge-warning'}`}>
                              {statusLabel[exp.status]}
                            </span>
                            {exp.is_recurring && (
                              <span className="badge badge-info">{recurringLabel[exp.recurrence_rule ?? 'monthly']}</span>
                            )}
                          </div>
                          <div className="text-xs text-secondary" style={{ marginTop: 2 }}>
                            下次日期：{format(parseISO(exp.expected_date), 'yyyy/MM/dd', { locale: zhTW })}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="amount-display amount-small amount-negative">-{formatTWD(exp.amount)}</span>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleToggleStatus(exp)} id={`lake-toggle-${exp.id}`}>
                          {exp.status === 'active' ? '暫停' : '啟用'}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(exp)} id={`lake-edit-${exp.id}`}>編輯</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(exp.id)} id={`lake-delete-${exp.id}`}>刪除</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Add/Edit Expense Modal */}
      {(modal === 'add' || modal === 'edit') && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{modal === 'add' ? '新增湖泊支出' : '編輯湖泊支出'}</h3>
              <button className="btn btn-ghost btn-sm" onClick={closeModal} id="lake-modal-close">✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                  支出名稱
                  <LabelTooltip text="家庭固定支出的名稱，例如：房租、水電費、網路費、保險" />
                </label>
                <input id="lake-form-name" type="text" className="form-input" placeholder="例：房租、水電費、保險" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                  預計日期
                  <LabelTooltip text="此支出下次或本次預計從湖泊扣除的日期" />
                </label>
                <input id="lake-form-date" type="date" className="form-input" value={form.expected_date} onChange={e => setForm(f => ({...f, expected_date: e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                  金額（台幣）
                  <LabelTooltip text="每次支出的金額，將用於計算湖泊乾涸日預測" />
                </label>
                <input id="lake-form-amount" type="number" className="form-input" placeholder="0" value={form.amount} onChange={e => setForm(f => ({...f, amount: e.target.value}))} />
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input id="lake-form-recurring" type="checkbox" checked={form.is_recurring} onChange={e => setForm(f => ({...f, is_recurring: e.target.checked}))} style={{ width: 16, height: 16 }} />
                  <span className="form-label" style={{ margin: 0 }}>循環支出</span>
                  <LabelTooltip text="勾選後可設定每月/每季/每年自動重複，用於計算未來乾涸日" />
                </label>
              </div>
              {form.is_recurring && (
                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                    循環週期
                    <LabelTooltip text="選擇此支出的重複週期，系統將據此預測未來支出時間軸" />
                  </label>
                  <select id="lake-form-rule" className="form-input form-select" value={form.recurrence_rule} onChange={e => setForm(f => ({...f, recurrence_rule: e.target.value as 'monthly' | 'quarterly' | 'yearly'}))}>
                    <option value="monthly">每月</option>
                    <option value="quarterly">每季（3個月）</option>
                    <option value="yearly">每年</option>
                  </select>
                </div>
              )}
              <div className="flex gap-3" style={{ justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
                <button className="btn btn-ghost" onClick={closeModal} id="lake-modal-cancel">取消</button>
                <button className="btn btn-primary" onClick={handleSaveExpense} disabled={saving || !form.name || !form.amount} id="lake-modal-save">
                  {saving ? '儲存中...' : '儲存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Set Balance Modal — 兩步驟 */}
      {modal === 'set-balance' && (
        <div className="modal-overlay" onClick={() => { setModal(null); setBalanceStep(1); setConflictWarning(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <h3 className="modal-title">🎚️ 調整湖泊餘額</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => { setModal(null); setBalanceStep(1); setConflictWarning(null); }} id="lake-balance-close">✕</button>
            </div>

            {/* ── 步驟 1：選擇調整類型 ── */}
            {balanceStep === 1 && (
              <div>
                <p className="text-secondary text-sm" style={{ marginBottom: 'var(--space-5)' }}>
                  請選擇要調整的餘額類型：
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
                  {/* 當前餘額選項 */}
                  <label style={{
                    display: 'flex', alignItems: 'flex-start', gap: 14,
                    padding: 'var(--space-4)',
                    borderRadius: 'var(--radius-md)',
                    border: `2px solid ${balanceType === 'current' ? 'var(--lake-safe)' : 'rgba(255,255,255,0.1)'}`,
                    background: balanceType === 'current' ? 'rgba(34,200,112,0.07)' : 'rgba(255,255,255,0.03)',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}>
                    <input
                      type="radio"
                      name="balance-type"
                      checked={balanceType === 'current'}
                      onChange={() => setBalanceType('current')}
                      style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }}
                    />
                    <div>
                      <div className="font-semibold" style={{ color: 'var(--lake-safe)', marginBottom: 4 }}>調整當前餘額</div>
                      <div className="text-xs text-muted">只含已確認收入與已發生支出</div>
                      <div className="font-bold" style={{ color: 'var(--lake-safe)', fontSize: '1.2rem', marginTop: 6 }}>
                        {formatTWD(computedLakeBalance)}
                      </div>
                    </div>
                  </label>

                  {/* 預估餘額選項 */}
                  <label style={{
                    display: 'flex', alignItems: 'flex-start', gap: 14,
                    padding: 'var(--space-4)',
                    borderRadius: 'var(--radius-md)',
                    border: `2px solid ${balanceType === 'estimated' ? 'var(--pond-a-light)' : 'rgba(255,255,255,0.1)'}`,
                    background: balanceType === 'estimated' ? 'rgba(60,120,220,0.07)' : 'rgba(255,255,255,0.03)',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}>
                    <input
                      type="radio"
                      name="balance-type"
                      checked={balanceType === 'estimated'}
                      onChange={() => setBalanceType('estimated')}
                      style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }}
                    />
                    <div>
                      <div className="font-semibold" style={{ color: 'var(--pond-a-light)', marginBottom: 4 }}>調整預估餘額</div>
                      <div className="text-xs text-muted">含待入帳收入、已批准申請及啟用中支出</div>
                      <div className="font-bold" style={{ color: 'var(--pond-a-light)', fontSize: '1.2rem', marginTop: 6 }}>
                        {formatTWD(estimatedLakeBalance)}
                      </div>
                    </div>
                  </label>
                </div>
                <div className="flex gap-3" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost" onClick={() => setModal(null)} id="lake-balance-cancel-step1">取消</button>
                  <button
                    className="btn btn-primary"
                    onClick={() => setBalanceStep(2)}
                    id="lake-balance-next"
                  >
                    下一步 →
                  </button>
                </div>
              </div>
            )}

            {/* ── 步驟 2：輸入目標數值 ── */}
            {balanceStep === 2 && (() => {
              const baseValue = balanceType === 'current' ? computedLakeBalance : estimatedLakeBalance;
              const targetValue = Number(newBalance) || 0;
              const delta = newBalance ? targetValue - baseValue : null;
              const isIncrease = delta !== null && delta > 0;
              const isDecrease = delta !== null && delta < 0;
              const noChange = delta === 0;
              return (
                <div>
                  {/* 目前餘額提示 */}
                  <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3) var(--space-4)', marginBottom: 'var(--space-4)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="text-sm text-muted">目前{balanceType === 'current' ? '當前' : '預估'}餘額</span>
                    <span className="font-bold" style={{ color: balanceType === 'current' ? 'var(--lake-safe)' : 'var(--pond-a-light)', fontSize: '1.1rem' }}>
                      {formatTWD(baseValue)}
                    </span>
                  </div>

                  {/* 輸入框 */}
                  <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                      目標金額（台幣）
                      <LabelTooltip text={`輸入您希望將${balanceType === 'current' ? '當前' : '預估'}餘額調整到的數值，可以增加或減少`} />
                    </label>
                    <input
                      id="lake-balance-input"
                      type="number"
                      className="form-input"
                      placeholder="輸入目標金額"
                      min="0"
                      value={newBalance}
                      onChange={e => {
                        setNewBalance(e.target.value);
                        checkConflicts(Number(e.target.value), balanceType);
                      }}
                      autoFocus
                    />
                  </div>

                  {/* 即時顯示差額 */}
                  {delta !== null && !noChange && (
                    <div style={{
                      padding: 'var(--space-3) var(--space-4)',
                      borderRadius: 'var(--radius-md)',
                      marginBottom: 'var(--space-4)',
                      background: isIncrease ? 'rgba(34,200,112,0.09)' : 'rgba(224,82,82,0.09)',
                      border: `1px solid ${isIncrease ? 'rgba(34,200,112,0.25)' : 'rgba(224,82,82,0.25)'}`,
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                      <span style={{ fontSize: '1.2rem' }}>{isIncrease ? '📈' : '📉'}</span>
                      <div>
                        <span className="text-sm">
                          {isIncrease ? '增加 ' : '減少 '}
                        </span>
                        <span className="font-bold" style={{ color: isIncrease ? 'var(--status-success)' : 'var(--status-error)', fontSize: '1.05rem' }}>
                          {isIncrease ? '+' : '-'}{formatTWD(Math.abs(delta))}
                        </span>
                        <span className="text-sm text-muted" style={{ marginLeft: 8 }}>
                          {formatTWD(baseValue)} → {formatTWD(targetValue)}
                        </span>
                      </div>
                    </div>
                  )}
                  {delta !== null && noChange && (
                    <div className="text-sm text-muted" style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-2) var(--space-3)' }}>
                      ℹ️ 金額與目前相同，無需調整
                    </div>
                  )}

                  {/* 衝突警告 */}
                  {conflictWarning && (
                    <div style={{
                      marginBottom: 'var(--space-4)',
                      padding: 'var(--space-4)',
                      borderRadius: 'var(--radius-md)',
                      background: 'rgba(224,82,82,0.10)',
                      border: '1px solid rgba(224,82,82,0.35)',
                    }}>
                      <div className="font-semibold text-sm" style={{ color: 'var(--status-error)', marginBottom: 'var(--space-3)' }}>
                        ⚠️ 餘額不足警告
                      </div>
                      <div className="text-xs text-secondary" style={{ marginBottom: 'var(--space-3)' }}>
                        調整後餘額（{formatTWD(targetValue)}）低於以下待付項目合計（{formatTWD(conflictWarning.totalConflict)}），建議先處理後再調整：
                      </div>

                      {conflictWarning.approvedRequests.length > 0 && (
                        <div style={{ marginBottom: 'var(--space-3)' }}>
                          <div className="text-xs font-semibold" style={{ color: 'var(--status-warning)', marginBottom: 4 }}>
                            📋 已批准調撥申請（共 {formatTWD(conflictWarning.approvedRequests.reduce((s, r) => s + (r.approved_amount ?? r.requested_amount), 0))}）
                          </div>
                          {conflictWarning.approvedRequests.map(r => (
                            <div key={r.id} className="text-xs" style={{ padding: '3px 8px', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                              <span style={{ color: 'var(--text-muted)' }}>{r.item_name}</span>
                              <span style={{ color: 'var(--status-error)', fontWeight: 600 }}>{formatTWD(r.approved_amount ?? r.requested_amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {conflictWarning.injectedIncomes.length > 0 && (
                        <div style={{ marginBottom: 'var(--space-3)' }}>
                          <div className="text-xs font-semibold" style={{ color: 'var(--status-warning)', marginBottom: 4 }}>
                            💸 已注入收入池待確認（共 {formatTWD(conflictWarning.injectedIncomes.reduce((s, i) => s + i.amount, 0))}）
                          </div>
                          {conflictWarning.injectedIncomes.map(i => (
                            <div key={i.id} className="text-xs" style={{ padding: '3px 8px', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                              <span style={{ color: 'var(--text-muted)' }}>{i.name}</span>
                              <span style={{ color: 'var(--status-error)', fontWeight: 600 }}>{formatTWD(i.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="text-xs" style={{ color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
                        建議先至「湖泊調撥申請」退回申請，或至「調撥給成員」取消待確認項目後再調整。
                      </div>
                    </div>
                  )}

                  {/* 底部備註 */}
                  <div className="text-xs text-muted" style={{ marginBottom: 'var(--space-5)', padding: 'var(--space-2) var(--space-3)', borderLeft: '2px solid rgba(255,255,255,0.1)' }}>
                    ℹ️ 此調整不會自動扣除 10% 到榮耀歸於主湖泊（內部調控）
                  </div>

                  <div className="flex gap-3" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost" onClick={() => { setBalanceStep(1); setConflictWarning(null); }} id="lake-balance-back">← 上一步</button>
                    <button className="btn btn-ghost" onClick={() => { setModal(null); setBalanceStep(1); setConflictWarning(null); }} id="lake-balance-cancel-step2">取消</button>
                    {conflictWarning ? (
                      <button
                        className="btn btn-danger"
                        onClick={() => handleSetBalance(true)}
                        disabled={saving || !newBalance || noChange}
                        id="lake-balance-force-save"
                      >
                        {saving ? '更新中...' : '⚠️ 強制確認'}
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary"
                        onClick={() => handleSetBalance(false)}
                        disabled={saving || !newBalance || noChange}
                        id="lake-balance-save"
                      >
                        {saving ? '更新中...' : '✅ 確認更新'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Inject to Member Modal */}
      {modal === 'inject' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <h3 className="modal-title">💸 調撥湖泊資金至成員收入池</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <p className="text-secondary text-sm" style={{ marginBottom: 'var(--space-5)' }}>
              資金將從湖泊中扣除，並進入該成員的收入池 (Pond A)。<br/>
              <span style={{color: 'var(--status-warning)'}}>※ 預約到帳：湖泊立刻扣除，成員須在指定日期確認入帳。</span>
            </p>
            <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                選擇接收成員
                <LabelTooltip text="選擇要接收這筆湖泊資金的家庭成員，資金會進入該成員的收入池（池塘A）" />
              </label>
              <select className="form-input form-select" value={injectForm.user_id} onChange={e => setInjectForm(f => ({ ...f, user_id: e.target.value }))}>
                <option value="">-- 請選擇 --</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.display_name} ({m.role === 'admin' ? '系統管理員' : m.role === 'lake_manager' ? '湖泊管理員' : '成員'})</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                調撥金額
                <span className="text-xs text-muted" style={{ marginLeft: 8, fontWeight: 400 }}>（可用餘額：{formatTWD(currentLakeBalance)}）</span>
                <LabelTooltip text={`最多可調撥 ${formatTWD(currentLakeBalance)}，不能超過目前可用湖泊餘額`} />
              </label>
              <input type="number" className="form-input" placeholder="0" min="1" max={currentLakeBalance} value={injectForm.amount} onChange={e => setInjectForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            
            <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                到帳方式
                <LabelTooltip text="即時入帳：立即確認加入收入池。預約入帳：湖泊立刻扣款，但成員要等到指定日期才能在收入池看到這筆款項。" />
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
                  <input type="radio" checked={injectForm.is_immediate} onChange={() => setInjectForm(f => ({ ...f, is_immediate: true }))} style={{ width: '1.2rem', height: '1.2rem'}} />
                  <span style={{fontSize: '0.95rem'}}>即時入帳</span>
                </label>
                <label className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
                  <input type="radio" checked={!injectForm.is_immediate} onChange={() => setInjectForm(f => ({ ...f, is_immediate: false }))} style={{ width: '1.2rem', height: '1.2rem'}} />
                  <span style={{fontSize: '0.95rem'}}>預約日期入帳</span>
                </label>
              </div>
            </div>

            {!injectForm.is_immediate && (
              <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                  預計入帳日期
                  <LabelTooltip text="成員將在此日期收到撥款通知，需自行點擊確認到帳後才會計入收入池" />
                </label>
                <input type="date" className="form-input" value={injectForm.expected_date} onChange={e => setInjectForm(f => ({ ...f, expected_date: e.target.value }))} />
              </div>
            )}

            <div className="flex gap-3" style={{ justifyContent: 'flex-end', marginTop: 'var(--space-6)' }}>
              <button className="btn btn-ghost" onClick={() => setModal(null)}>取消</button>
              <button className="btn btn-primary" onClick={handleInject} disabled={saving || !injectForm.user_id || !injectForm.amount}>
                {saving ? '處理中...' : '確認調撥'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase';
import WaterWave from '@/components/animations/WaterWave';
import { LabelTooltip } from '@/components/ui/Tooltip';
import { formatTWD, calcWaterLevel, calculateLakeDryDate } from '@/lib/predictions';
import { Lake, PondA, PondB, Profile, LakeExpense, LakeRequest, DryPrediction, ExpenseItem, IncomeItem, Transaction } from '@/types';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';

interface MemberData {
  profile: Profile;
  pond_a: PondA | null;
  pond_b: PondB | null;
  /** 待入帳的預計收入合計（pending 狀態） */
  pendingIncomeTotal: number;
  /** 計畫中尚未完成的支出合計（planned + approved 狀態） */
  plannedExpenseTotal: number;
  /** 已完成的支出合計（completed 狀態） */
  completedExpenseTotal: number;
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const [lake, setLake]                 = useState<Lake | null>(null);
  const [members, setMembers]           = useState<MemberData[]>([]);
  const [lakeExpenses, setLakeExpenses] = useState<LakeExpense[]>([]);
  const [lakeRequests, setLakeRequests] = useState<LakeRequest[]>([]);
  const [allIncomes, setAllIncomes]     = useState<IncomeItem[]>([]);
  const [lakeTransactions, setLakeTransactions] = useState<Transaction[]>([]);
  const [computedLakeBalance, setComputedLakeBalance] = useState(0);
  const [prediction, setPrediction]     = useState<DryPrediction | null>(null);
  const [predMode, setPredMode]         = useState<'current' | 'estimated'>('current');
  const [loading, setLoading]           = useState(true);
  const [maxBalance, setMaxBalance]     = useState(1);

  // 初始化預測模式
  useEffect(() => {
    const stored = localStorage.getItem('family-pool-pred-mode');
    if (stored === 'current' || stored === 'estimated') {
      setPredMode(stored);
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!profile?.family_id) return;
    setLoading(true);

    const [lakeRes, profilesRes, pondARes, pondBRes, lakeExpRes, requestsRes, expenseItemsRes, incomeItemsRes, transactionsRes] = await Promise.all([
      supabase.from('lake').select('*').eq('family_id', profile.family_id).single(),
      supabase.from('profiles').select('*').eq('family_id', profile.family_id),
      supabase.from('pond_a').select('*').eq('family_id', profile.family_id),
      supabase.from('pond_b').select('*').eq('family_id', profile.family_id),
      supabase.from('lake_expenses').select('*').eq('family_id', profile.family_id).eq('status', 'active'),
      supabase.from('lake_requests').select('*').eq('family_id', profile.family_id).eq('status', 'approved'),
      supabase.from('expense_items').select('*').eq('family_id', profile.family_id),
      supabase.from('income_items').select('*').eq('family_id', profile.family_id),
      supabase.from('transactions').select('*').eq('family_id', profile.family_id),
    ]);

    const lakeData         = lakeRes.data as Lake | null;
    const profilesData     = (profilesRes.data ?? []) as Profile[];
    const pondAData        = (pondARes.data ?? []) as PondA[];
    const pondBData        = (pondBRes.data ?? []) as PondB[];
    const expensesData     = (lakeExpRes.data ?? []) as LakeExpense[];
    const requestsData     = (requestsRes.data ?? []) as LakeRequest[];
    const allExpenses      = (expenseItemsRes.data ?? []) as ExpenseItem[];
    const incomesData      = (incomeItemsRes.data ?? []) as IncomeItem[];
    const transactionsData = (transactionsRes.data ?? []) as Transaction[];

    setLake(lakeData);
    setLakeExpenses(expensesData);
    setLakeRequests(requestsData);
    setAllIncomes(incomesData);
    setLakeTransactions(transactionsData);

    const computedLakeBalance = Math.max(0,
      transactionsData
        .filter(t => t.type === 'transfer_to_lake')
        .reduce((sum, t) => sum + t.amount, 0)
      + transactionsData
        .filter(t => t.type === 'transfer_from_pond_b' && t.destination === 'lake')
        .reduce((sum, t) => sum + t.amount, 0)
      + incomesData
        .filter(i => i.status === 'confirmed' && i.destination === 'lake')
        .reduce((sum, i) => sum + (i.actual_amount ?? i.amount), 0)
      - transactionsData
        .filter(t => t.type === 'lake_to_member')
        .reduce((sum, t) => sum + t.amount, 0)
      - transactionsData
        .filter(t => t.type === 'lake_expense')
        .reduce((sum, t) => sum + t.amount, 0)
    );

    setComputedLakeBalance(computedLakeBalance);

    const memberList: MemberData[] = profilesData.map((p) => {
      const pIncomes  = incomesData.filter(i => i.user_id === p.id);
      const pExpenses = allExpenses.filter(e => e.user_id === p.id);

      // 待入帳（pending）收入合計
      const pendingIncomeTotal = pIncomes
        .filter(i => i.status === 'pending')
        .reduce((acc, i) => acc + i.amount, 0);

      // 計畫中支出合計（planned + approved，不含 completed 和 rejected）
      const plannedExpenseTotal = pExpenses
        .filter(e => e.status === 'planned' || e.status === 'approved')
        .reduce((acc, e) => acc + e.amount, 0);

      // 已完成支出合計
      const completedExpenseTotal = pExpenses
        .filter(e => e.status === 'completed')
        .reduce((acc, e) => acc + e.amount, 0);

      return {
        profile: p,
        pond_a: pondAData.find(a => a.user_id === p.id) ?? null,
        pond_b: pondBData.find(b => b.user_id === p.id) ?? null,
        pendingIncomeTotal,
        plannedExpenseTotal,
        completedExpenseTotal,
      };
    });
    setMembers(memberList);

    // 計算最大參考水位：取所有池塘 A 的最大值和湖泊餘額的最大值
    const maxA = Math.max(0, ...memberList.map(m => (m.pond_a?.current_balance ?? 0) + m.pendingIncomeTotal));
    const maxB = Math.max(0, ...memberList.map(m => m.plannedExpenseTotal));
    const mx = Math.max(computedLakeBalance, maxA, maxB, 1);
    setMaxBalance(mx * 1.3);

    setLoading(false);
  }, [profile?.family_id, supabase]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // Realtime 訂閱
  useEffect(() => {
    if (!profile?.family_id) return;
    const channel = supabase.channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lake', filter: `family_id=eq.${profile.family_id}` }, loadDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pond_a', filter: `family_id=eq.${profile.family_id}` }, loadDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pond_b', filter: `family_id=eq.${profile.family_id}` }, loadDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'income_items', filter: `family_id=eq.${profile.family_id}` }, loadDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_items', filter: `family_id=eq.${profile.family_id}` }, loadDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `family_id=eq.${profile.family_id}` }, loadDashboard)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.family_id, supabase, loadDashboard]);

  const pendingLakeIncome = allIncomes
    .filter(i => i.destination === 'lake' && i.status === 'pending')
    .reduce((sum, i) => sum + i.amount, 0);

  // 已批准的湖泊調撥申請（尚未執行交易）
  const approvedLakeRequests = lakeRequests
    .filter(r => r.status === 'approved')
    .reduce((sum, r) => sum + (r.approved_amount ?? r.requested_amount), 0);

  // 啟用中的湖泊必要支出
  const activeLakeExpensesTotal = lakeExpenses
    .filter(e => e.status === 'active')
    .reduce((sum, e) => sum + e.amount, 0);

  // 預估餘額 = 當前餘額 + 待入帳收入 - 已批准申請 - 啟用中支出
  const estimatedLakeBalance = computedLakeBalance + pendingLakeIncome - approvedLakeRequests - activeLakeExpensesTotal;

  // 動態監聽並計算乾涸預測
  useEffect(() => {
    if (lake) {
      // 預估模式下使用預估餘額作為起始金額
      const balanceForPrediction = predMode === 'estimated'
        ? estimatedLakeBalance
        : computedLakeBalance;
      const pred = calculateLakeDryDate(
        balanceForPrediction,
        lakeExpenses,
        lakeRequests,
        allIncomes,
        predMode
      );
      setPrediction(pred);
    }
  }, [lake, computedLakeBalance, estimatedLakeBalance, lakeExpenses, lakeRequests, allIncomes, predMode]);

  const actualLakeBalance = computedLakeBalance;
  const displayedLakeBalance = actualLakeBalance;

  const warningLevel = prediction?.warning_level ?? 'safe';
  const lakeLevel    = calcWaterLevel(actualLakeBalance, maxBalance);

  const warningColors: Record<string, string> = {
    safe:     'var(--status-success)',
    warning:  'var(--status-warning)',
    danger:   'var(--lake-danger)',
    critical: 'var(--status-error)',
  };

  const warningLabels: Record<string, string> = {
    safe:     '💧 水量充足',
    warning:  '⚠️ 注意水量',
    danger:   '🔶 水量不足',
    critical: '🚨 即將乾涸',
  };

  if (loading) {
    return (
      <div className="page-container">
        <div style={{ display: 'grid', gap: 'var(--space-6)' }}>
          {[1, 2, 3].map(i => <div key={i} className="card skeleton" style={{ height: 200 }} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title">家庭資金池</h1>
          <p className="page-subtitle">
            {format(new Date(), 'yyyy年M月d日 EEEE', { locale: zhTW })} · {profile?.display_name}
          </p>
        </div>
        <div className="flex gap-3">
          <button className="btn btn-ghost btn-sm" onClick={() => router.push('/income')} id="dash-add-income">
            + 新增收入
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => router.push('/expenses')} id="dash-add-expense">
            + 新增支出
          </button>
        </div>
      </div>

      {/* Lake Section */}
      <section style={{ marginBottom: 'var(--space-8)' }}>
        <div className="card" style={{ padding: 'var(--space-6)' }}>
          <div style={{ display: 'flex', flexDirection: 'row', gap: '32px', justifyContent: 'center', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 'var(--space-5)' }}>
            {/* 預估餘額湖泊（左） */}
            <div style={{ minWidth: 280, maxWidth: 380, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'rgba(60,120,180,0.10)', borderRadius: 18, boxShadow: '0 2px 16px 0 rgba(0,0,0,0.08)', padding: '24px 16px 20px 16px' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--pond-a-light)', marginBottom: 8 }}>🌊 家庭湖泊（預估餘額）</div>
              <WaterWave
                level={lakeLevel}
                variant="lake"
                height={200}
                label="預估餘額"
                amount={formatTWD(estimatedLakeBalance)}
                warningLevel={warningLevel}
              />
              <div style={{ fontSize: 48, fontWeight: 900, color: 'var(--pond-a-light)', marginTop: 12, textAlign: 'center' }}>{formatTWD(estimatedLakeBalance)}</div>
              <div className="text-xs text-secondary" style={{ marginTop: 6 }}>含待入帳收入、已批准申請及啟用中支出</div>
            </div>

            {/* 當前餘額湖泊（右） */}
            <div style={{ minWidth: 280, maxWidth: 380, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'rgba(30,60,120,0.13)', borderRadius: 18, boxShadow: '0 2px 16px 0 rgba(0,0,0,0.08)', padding: '24px 16px 20px 16px' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--lake-safe)', marginBottom: 8 }}>🌊 家庭湖泊（當前餘額）</div>
              <WaterWave
                level={lakeLevel}
                variant="lake"
                height={200}
                label="當前餘額"
                amount={formatTWD(actualLakeBalance)}
                warningLevel={warningLevel}
              />
              <div style={{ fontSize: 48, fontWeight: 900, color: 'var(--lake-safe)', marginTop: 12, textAlign: 'center' }}>{formatTWD(actualLakeBalance)}</div>
              <div className="text-xs text-secondary" style={{ marginTop: 6 }}>只包含已確認收入與已發生支出</div>
            </div>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-4">
            {/* Prediction */}
            <div>
              <div className="flex items-center gap-2" style={{ marginBottom: 'var(--space-2)' }}>
                <span className="badge" style={{
                  background: `${warningColors[warningLevel]}22`,
                  color: warningColors[warningLevel],
                }}>
                  {warningLabels[warningLevel]}
                </span>
                
                {/* 預測模式選擇器 */}
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
              </div>
              {prediction?.dry_date ? (
                <div>
                  <span className="text-sm text-secondary">經濟安全到期日：</span>
                  <span className="font-semibold" style={{ color: warningColors[warningLevel], marginLeft: 6 }}>
                    {format(new Date(prediction.dry_date), 'yyyy/MM/dd')}
                    {prediction.days_remaining !== null && (
                      <span className="text-secondary font-normal" style={{ marginLeft: 8 }}>
                        （還有 {prediction.days_remaining} 天）
                      </span>
                    )}
                  </span>
                  {prediction.deficit_amount && prediction.deficit_amount > 0 && (
                    <div style={{ marginTop: 6, padding: '8px 12px', background: 'rgba(224,82,82,0.12)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: 'var(--status-error)' }}>
                      ⚠️ 要在 {format(new Date(prediction.dry_date), 'yyyy年MM月dd日')} 前補充 {formatTWD(prediction.deficit_amount)} 資金
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-sm text-secondary">
                  {computedLakeBalance === 0 && estimatedLakeBalance === 0 ? '經濟安全到期日：—' : '經濟安全到期日：—'}
                </span>
              )}

            </div>

            {/* Quick actions (admin or manager) */}
            {(profile?.role === 'admin' || profile?.role === 'lake_manager') && (
              <button className="btn btn-ghost btn-sm" onClick={() => router.push('/lake')} id="dash-manage-lake">
                管理湖泊 →
              </button>
            )}
          </div>

          {/* Upcoming lake expenses */}
          {lakeExpenses.length > 0 && (
            <div style={{ marginTop: 'var(--space-5)' }}>
              <p className="text-xs text-muted" style={{ marginBottom: 'var(--space-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                即將支出
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                {lakeExpenses.slice(0, 4).map((exp) => (
                  <div key={exp.id} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-md)', padding: '6px 12px', fontSize: '0.8rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{exp.name}</span>
                    <span style={{ color: 'var(--status-error)', marginLeft: 6, fontWeight: 600 }}>
                      -{formatTWD(exp.amount)}
                    </span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                      {format(new Date(exp.expected_date), 'M/d')}
                    </span>
                  </div>
                ))}
                {lakeExpenses.length > 4 && (
                  <span className="text-xs text-muted" style={{ alignSelf: 'center' }}>+{lakeExpenses.length - 4} 項</span>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Members Ponds */}
      <section>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          家庭成員池塘
        </h2>
        <div style={{ display: 'grid', gap: 'var(--space-5)', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {members.map((m) => {
            const aBalance = m.pond_a?.current_balance ?? 0;
            const bRawBalance = m.pond_b?.current_balance ?? 0;
            
            const incomeWaveAmount = aBalance + m.pendingIncomeTotal;
            const expenseWaveAmount = m.plannedExpenseTotal;

            const aLevel   = calcWaterLevel(incomeWaveAmount, maxBalance);
            const bLevel   = calcWaterLevel(expenseWaveAmount, maxBalance);
            const isMe     = m.profile.id === profile?.id;

            return (
              <div key={m.profile.id} className="card" style={{ border: isMe ? '1px solid rgba(26,111,181,0.4)' : undefined }}>
                {/* Member header */}
                <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-5)' }}>
                  <div className="flex items-center gap-3">
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%',
                      background: 'linear-gradient(135deg, var(--lake-safe), var(--pond-a))',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '1.1rem', fontWeight: 700, color: 'white',
                    }}>
                      {m.profile.display_name[0]}
                    </div>
                    <div>
                      <div className="font-semibold" style={{ fontSize: '0.95rem' }}>
                        {m.profile.display_name}
                        {isMe && <span className="badge badge-info" style={{ marginLeft: 8, fontSize: '0.65rem' }}>我</span>}
                      </div>
                      <div className="text-xs text-muted">
                        {m.profile.role === 'admin' ? '🛡️ 系統管理員' :
                         m.profile.role === 'lake_manager' ? '🌊 湖泊管理員' : '👤 家庭成員'}
                      </div>
                    </div>
                  </div>
                  {isMe && (
                    <button className="btn btn-ghost btn-sm" onClick={() => router.push('/my-ponds')} id={`dash-my-ponds-${m.profile.id}`}>
                      管理 →
                    </button>
                  )}
                </div>

                {/* Two ponds */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                  {/* Pond A — 收入池 */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                      <span className="text-xs" style={{ color: 'var(--pond-a-light)', fontWeight: 600 }}>💰 收入池</span>
                    </div>
                    <WaterWave level={aLevel} variant="pond-a" height={100} />
                    {/* 預估總量 */}
                    <div className="amount-display amount-small amount-pond-a" style={{ marginTop: 'var(--space-2)', textAlign: 'center' }}>
                      {formatTWD(incomeWaveAmount)}
                    </div>
                    {/* 可用餘額 */}
                    <div style={{ textAlign: 'center', marginTop: 2, fontSize: '0.72rem', color: 'var(--text-muted)', opacity: 0.85 }}>
                      可用 {formatTWD(aBalance)}
                    </div>
                  </div>

                  {/* Pond B — 支出池 */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                      <span className="text-xs" style={{ color: 'var(--pond-b-light)', fontWeight: 600 }}>💸 支出池</span>
                    </div>
                    <WaterWave level={bLevel} variant="pond-b" height={100} />
                    {/* 計畫中支出 */}
                    <div className="amount-display amount-small amount-pond-b" style={{ marginTop: 'var(--space-2)', textAlign: 'center' }}>
                      {formatTWD(expenseWaveAmount)}
                    </div>
                    {/* 已完成與狀態 */}
                    <div style={{ textAlign: 'center', marginTop: 2, fontSize: '0.72rem', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ color: 'var(--status-error)', opacity: 0.85 }}>已花費 -{formatTWD(m.completedExpenseTotal)}</span>
                      <span style={{ color: bRawBalance < 0 ? 'var(--status-error)' : bRawBalance > 0 ? 'var(--status-success)' : 'var(--text-muted)', opacity: 0.85 }}>
                        狀態: {bRawBalance < 0 ? '🔴 欠款中' : bRawBalance > 0 ? '🟢 預付餘額' : '⚪ 收支平衡'}
                      </span>
                      <LabelTooltip text={"系統設計說明：Pond A（個人收入池）與 Lake（家庭湖泊）不會顯示負值；若出現欠款，會顯示在支出池（Pond B）的負數中。"} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {members.length === 0 && (
            <div className="empty-state" style={{ gridColumn: '1/-1' }}>
              <span className="empty-state-icon">👨‍👩‍👧‍👦</span>
              <p className="empty-state-title">尚無家庭成員</p>
              {profile?.role === 'admin' && (
                <button className="btn btn-primary" onClick={() => router.push('/settings/members')}>
                  新增成員
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

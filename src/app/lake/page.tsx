'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase';
import { Lake, LakeExpense, LakeRequest, DryPrediction } from '@/types';
import { formatTWD, calculateLakeDryDate } from '@/lib/predictions';
import { format, parseISO } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { useRouter } from 'next/navigation';
import WaterWave from '@/components/animations/WaterWave';
import { Profile } from '@/types';
import { LabelTooltip } from '@/components/ui/Tooltip';

type ModalMode = 'add' | 'edit' | 'set-balance' | 'inject' | null;

export default function LakePage() {
  const { profile, canManageLake } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const [lake, setLake]         = useState<Lake | null>(null);
  const [expenses, setExpenses] = useState<LakeExpense[]>([]);
  const [prediction, setPrediction] = useState<DryPrediction | null>(null);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState<ModalMode>(null);
  const [selected, setSelected] = useState<LakeExpense | null>(null);
  const [saving, setSaving]     = useState(false);
  const [newBalance, setNewBalance] = useState('');
  const [members, setMembers] = useState<Profile[]>([]);

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

  const load = useCallback(async () => {
    if (!profile?.family_id) return;
    setLoading(true);
    const [lakeRes, expRes, reqRes, profRes] = await Promise.all([
      supabase.from('lake').select('*').eq('family_id', profile.family_id).single(),
      supabase.from('lake_expenses').select('*').eq('family_id', profile.family_id).order('expected_date'),
      supabase.from('lake_requests').select('*').eq('family_id', profile.family_id).eq('status', 'approved'),
      supabase.from('profiles').select('*').eq('family_id', profile.family_id),
    ]);
    const lakeData = lakeRes.data as Lake | null;
    const expData   = (expRes.data ?? []) as LakeExpense[];
    const reqData   = (reqRes.data ?? []) as LakeRequest[];

    setLake(lakeData);
    setExpenses(expData);
    setMembers((profRes.data ?? []) as Profile[]);
    if (lakeData) {
      const pred = calculateLakeDryDate(lakeData.current_balance, expData.filter(e => e.status === 'active'), reqData);
      setPrediction(pred);
      // 更新 dry_date 到資料庫
      await supabase.from('lake').update({ dry_date: pred.dry_date ?? null }).eq('id', lakeData.id);
    }
    setLoading(false);
  }, [profile?.family_id, supabase]);

  useEffect(() => {
    if (profile && !canManageLake) router.replace('/dashboard');
    else load();
  }, [profile, router, load]);

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

  const handleSetBalance = async () => {
    if (!lake || !newBalance) return;
    setSaving(true);
    await supabase.from('lake').update({ current_balance: Number(newBalance) }).eq('id', lake.id);
    setSaving(false);
    setModal(null);
    setNewBalance('');
    load();
  };

  const handleInject = async () => {
    if (!profile?.family_id || !lake) return;
    const amt = Number(injectForm.amount);
    if (!amt || !injectForm.user_id) return;
    if (amt > lake.current_balance) {
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
          <div className="card" style={{ marginBottom: 'var(--space-8)', padding: 0, overflow: 'hidden' }}>
            <WaterWave
              level={Math.min(100, Math.max(0, (lake.current_balance / Math.max(lake.current_balance * 1.5, 1)) * 100))}
              variant="lake"
              height={200}
              label="🌊 湖泊當前餘額"
              amount={formatTWD(lake.current_balance)}
              warningLevel={prediction?.warning_level ?? 'safe'}
            />
            <div style={{ padding: 'var(--space-6)' }}>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  {prediction?.dry_date ? (
                    <div>
                      <span className="text-secondary text-sm">🔴 預計乾涸：</span>
                      <span className="font-bold" style={{ color: warningColor, marginLeft: 6 }}>
                        {format(parseISO(prediction.dry_date), 'yyyy年M月d日', { locale: zhTW })}
                        {prediction.days_remaining !== null && <span className="text-secondary font-normal" style={{ marginLeft: 8 }}>（{prediction.days_remaining} 天後）</span>}
                      </span>
                    </div>
                  ) : (
                    <span className="text-secondary text-sm">
                      {lake.current_balance === 0 ? '💡 請先設定湖泊初始餘額' : '✅ 暫無乾涸風險'}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-primary" onClick={() => setModal('inject')} id="lake-inject-member-btn">
                    調撥給成員
                  </button>
                  <button className="btn btn-ghost" onClick={() => { setNewBalance(String(lake.current_balance)); setModal('set-balance'); }} id="lake-set-balance-btn">
                    調整餘額
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Prediction Timeline */}
          {prediction && prediction.scheduled_outflows.length > 0 && (
            <div className="card" style={{ marginBottom: 'var(--space-8)' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 'var(--space-5)' }}>📊 支出時間軸預測</h2>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>項目</th>
                      <th style={{ textAlign: 'right' }}>金額</th>
                      <th style={{ textAlign: 'right' }}>累計支出</th>
                      <th style={{ textAlign: 'right' }}>預估餘額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prediction.scheduled_outflows.slice(0, 12).map((o, i) => {
                      const remaining = lake.current_balance - o.cumulative;
                      return (
                        <tr key={i}>
                          <td>{format(parseISO(o.date), 'yyyy/MM/dd')}</td>
                          <td>{o.name}</td>
                          <td style={{ textAlign: 'right', color: 'var(--status-error)' }}>-{formatTWD(o.amount)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{formatTWD(o.cumulative)}</td>
                          <td style={{ textAlign: 'right', color: remaining < 0 ? 'var(--status-error)' : remaining < lake.current_balance * 0.2 ? 'var(--status-warning)' : 'var(--status-success)', fontWeight: 600 }}>
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

      {/* Set Balance Modal */}
      {modal === 'set-balance' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">調整湖泊餘額</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setModal(null)} id="lake-balance-close">✕</button>
            </div>
            {/* ⚠️ 警告：直接調整會繞過交易記錄 */}
            <div className="alert" style={{ background: 'rgba(245,166,35,0.1)', border: '1px solid rgba(245,166,35,0.3)', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 'var(--space-4)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: '1rem' }}>⚠️</span>
              <div className="text-sm" style={{ color: 'var(--status-warning)' }}>
                <strong>注意：</strong>直接調整餘額不會產生交易記錄，會導致餘額與歷史記錄不一致。<br />
                <span style={{ opacity: 0.8 }}>建議改用「收入池→湖泊」轉帳功能，以保留完整稽核軌跡。</span>
              </div>
            </div>
            <p className="text-secondary text-sm" style={{ marginBottom: 'var(--space-4)' }}>
              若需更正初始餘額或修復錯誤，可直接輸入目前實際餘額（台幣）。
            </p>
            <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                湖泊餘額
                <LabelTooltip text="輸入現在湖泊的實際餘額（例如查看銀行存款後的正確數字）" />
              </label>
              <input id="lake-balance-input" type="number" className="form-input" placeholder="0" min="0" value={newBalance} onChange={e => setNewBalance(e.target.value)} />
            </div>
            <div className="flex gap-3" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setModal(null)} id="lake-balance-cancel">取消</button>
              <button className="btn btn-primary" onClick={handleSetBalance} disabled={saving || !newBalance} id="lake-balance-save">
                {saving ? '更新中...' : '確認更新'}
              </button>
            </div>
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
                <span className="text-xs text-muted" style={{ marginLeft: 8, fontWeight: 400 }}>（可用餘額：{formatTWD(lake?.current_balance ?? 0)}）</span>
                <LabelTooltip text={`最多可調撥 ${formatTWD(lake?.current_balance ?? 0)}，不能超過湖泊現有餘額`} />
              </label>
              <input type="number" className="form-input" placeholder="0" min="1" max={lake?.current_balance} value={injectForm.amount} onChange={e => setInjectForm(f => ({ ...f, amount: e.target.value }))} />
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

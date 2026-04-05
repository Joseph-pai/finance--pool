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

type ModalMode = 'add' | 'edit' | 'set-balance' | null;

export default function LakePage() {
  const { profile } = useAuth();
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

  const [form, setForm] = useState({
    name: '', expected_date: '', amount: '',
    is_recurring: false,
    recurrence_rule: 'monthly' as 'monthly' | 'quarterly' | 'yearly',
  });

  const load = useCallback(async () => {
    if (!profile?.family_id) return;
    setLoading(true);
    const [lakeRes, expRes, reqRes] = await Promise.all([
      supabase.from('lake').select('*').eq('family_id', profile.family_id).single(),
      supabase.from('lake_expenses').select('*').eq('family_id', profile.family_id).order('expected_date'),
      supabase.from('lake_requests').select('*').eq('family_id', profile.family_id).eq('status', 'approved'),
    ]);
    const lakeData = lakeRes.data as Lake | null;
    const expData   = (expRes.data ?? []) as LakeExpense[];
    const reqData   = (reqRes.data ?? []) as LakeRequest[];

    setLake(lakeData);
    setExpenses(expData);
    if (lakeData) {
      const pred = calculateLakeDryDate(lakeData.current_balance, expData.filter(e => e.status === 'active'), reqData);
      setPrediction(pred);
      // 更新 dry_date 到資料庫
      await supabase.from('lake').update({ dry_date: pred.dry_date ?? null }).eq('id', lakeData.id);
    }
    setLoading(false);
  }, [profile?.family_id, supabase]);

  useEffect(() => {
    if (profile && profile.role !== 'admin') router.replace('/dashboard');
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
                <button className="btn btn-ghost" onClick={() => { setNewBalance(String(lake.current_balance)); setModal('set-balance'); }} id="lake-set-balance-btn">
                  調整餘額
                </button>
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
                <label className="form-label">支出名稱</label>
                <input id="lake-form-name" type="text" className="form-input" placeholder="例：房租、水電費、保險" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">預計日期</label>
                <input id="lake-form-date" type="date" className="form-input" value={form.expected_date} onChange={e => setForm(f => ({...f, expected_date: e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">金額（台幣）</label>
                <input id="lake-form-amount" type="number" className="form-input" placeholder="0" value={form.amount} onChange={e => setForm(f => ({...f, amount: e.target.value}))} />
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input id="lake-form-recurring" type="checkbox" checked={form.is_recurring} onChange={e => setForm(f => ({...f, is_recurring: e.target.checked}))} style={{ width: 16, height: 16 }} />
                  <span className="form-label" style={{ margin: 0 }}>循環支出</span>
                </label>
              </div>
              {form.is_recurring && (
                <div className="form-group">
                  <label className="form-label">循環週期</label>
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
            <p className="text-secondary text-sm" style={{ marginBottom: 'var(--space-5)' }}>
              直接設定湖泊的當前實際餘額（台幣）
            </p>
            <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
              <label className="form-label">湖泊餘額</label>
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
    </div>
  );
}

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase';
import { IncomeItem, Profile, PondA } from '@/types';
import { formatTWD } from '@/lib/predictions';
import { format, isAfter, parseISO } from 'date-fns';
import { zhTW } from 'date-fns/locale';

type ModalMode = 'add' | 'edit' | 'confirm' | null;

export default function IncomePage() {
  const { profile, isAdmin } = useAuth();
  const supabase = createClient();

  const [items, setItems]         = useState<(IncomeItem & { profile?: Profile })[]>([]);
  const [pondA, setPondA]         = useState<PondA | null>(null);
  const [loading, setLoading]     = useState(true);
  const [modal, setModal]         = useState<ModalMode>(null);
  const [selected, setSelected]   = useState<IncomeItem | null>(null);
  const [saving, setSaving]       = useState(false);
  const [filterUser, setFilterUser] = useState<string>('all');
  const [members, setMembers]     = useState<Profile[]>([]);

  // Form state
  const [form, setForm] = useState({ name: '', expected_date: '', amount: '', user_id: '' });
  const [transferAmount, setTransferAmount] = useState('');
  const [confirmActual, setConfirmActual] = useState('');
  // 追蹤目前正在操作哪一個 item 的輸入框（避免多列共用 state 混淆）
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile?.family_id || !profile?.id) return;
    setLoading(true);
    const [incRes, profRes, pondARes] = await Promise.all([
      supabase.from('income_items').select('*, profile:profiles(*)').eq('family_id', profile.family_id).order('expected_date', { ascending: true }),
      supabase.from('profiles').select('*').eq('family_id', profile.family_id),
      supabase.from('pond_a').select('*').eq('user_id', profile.id).single(),
    ]);
    setItems((incRes.data ?? []) as (IncomeItem & { profile?: Profile })[]);
    setMembers((profRes.data ?? []) as Profile[]);
    setPondA(pondARes.data as PondA | null);
    setLoading(false);
  }, [profile?.family_id, profile?.id, supabase]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setForm({ name: '', expected_date: format(new Date(), 'yyyy-MM-dd'), amount: '', user_id: profile?.id || '' });
    setModal('add');
    setSelected(null);
  };

  const openEdit = (item: IncomeItem) => {
    setForm({ name: item.name, expected_date: item.expected_date, amount: String(item.amount), user_id: item.user_id });
    setSelected(item);
    setModal('edit');
  };

  const openConfirm = (item: IncomeItem) => {
    setSelected(item);
    setConfirmActual(String(item.amount));
    setModal('confirm');
  };

  const closeModal = () => { setModal(null); setSelected(null); setSaving(false); };

  const handleSave = async () => {
    if (!profile?.family_id) return;
    setSaving(true);
    const targetUserId = form.user_id || profile.id;
    const data = { name: form.name, expected_date: form.expected_date, amount: Number(form.amount), family_id: profile.family_id, user_id: targetUserId };

    if (modal === 'add') {
      await supabase.from('income_items').insert(data);
    } else if (modal === 'edit' && selected) {
      await supabase.from('income_items').update({ name: form.name, expected_date: form.expected_date, amount: Number(form.amount), user_id: targetUserId }).eq('id', selected.id);
    }
    closeModal();
    load();
  };

  const handleConfirmIncome = async (confirmed: boolean) => {
    if (!selected || !profile) return;
    setSaving(true);
    const actualAmount = Number(confirmActual);

    if (confirmed) {
      // 狀態更新與金額紀錄 (其餘由資料庫觸發器同步至 pond_a)
      await supabase.from('income_items').update({
        status: 'confirmed',
        actual_amount: actualAmount,
        confirmed_at: new Date().toISOString(),
      }).eq('id', selected.id);
    } else {
      await supabase.from('income_items').update({ status: 'failed' }).eq('id', selected.id);
    }

    closeModal();
    load();
  };

  const handleTransferToLake = async (item: IncomeItem) => {
    const amt = Number(transferAmount);
    if (!amt || !profile) return;
    setSaving(true);

    try {
      const { error } = await supabase.from('transactions').insert({
        family_id: profile.family_id,
        user_id: item.user_id,
        type: 'transfer_to_lake',
        amount: amt,
        source: 'pond_a',
        destination: 'lake',
        note: `注入湖泊：${item.name}`,
        transaction_date: new Date().toISOString().substring(0, 10),
      });
      if (error) {
        throw new Error(error.message);
      }
    } catch (err: any) {
      alert('系統錯誤：' + err.message);
      console.error('注入湖泊失敗：', err);
    }

    setTransferAmount('');
    setSaving(false);
    load();
  };

  // 注入支出池（從已到帳收入直接撥至個人支出池）
  const handleTransferToPondBFromIncome = async (item: IncomeItem) => {
    const amt = Number(transferAmount);
    if (!amt || !profile) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('transactions').insert({
        family_id: profile.family_id,
        user_id: item.user_id,
        type: 'transfer_to_pond_b',
        amount: amt,
        source: 'pond_a',
        destination: 'pond_b',
        note: `注入支出池：${item.name}`,
        transaction_date: new Date().toISOString().substring(0, 10),
      });
      if (error) {
        throw new Error(error.message);
      }
    } catch (err: any) {
      alert('系統錯誤：' + err.message);
      console.error('注入支出池失敗：', err);
    }
    setTransferAmount('');
    setActiveItemId(null);
    setSaving(false);
    load();
  };

  const handleDelete = async (id: string) => {
    await supabase.from('income_items').delete().eq('id', id);
    load();
  };

  const filtered = items.filter(i => filterUser === 'all' || i.user_id === filterUser);
  const myItems = items.filter(i => i.user_id === profile?.id);
  const totalPending = myItems.filter(i => i.status === 'pending').reduce((s, i) => s + i.amount, 0);
  const totalConfirmed = myItems.filter(i => i.status === 'confirmed').reduce((s, i) => s + (i.actual_amount ?? i.amount), 0);

  const statusLabel: Record<string, { text: string; badge: string }> = {
    pending:   { text: '待確認', badge: 'badge-warning' },
    confirmed: { text: '已到帳', badge: 'badge-success' },
    failed:    { text: '未到帳', badge: 'badge-error' },
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">💰 收入管理</h1>
        <p className="page-subtitle">池塘A — 記錄並確認您的收入</p>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
        <div className="card card-sm" style={{ borderColor: 'rgba(26,158,92,0.3)' }}>
          <p className="text-xs text-muted" style={{ marginBottom: 4 }}>待入帳合計</p>
          <p className="amount-display amount-medium amount-pond-a">{formatTWD(totalPending)}</p>
        </div>
        <div className="card card-sm" style={{ borderColor: 'rgba(99,179,237,0.3)' }}>
          <p className="text-xs text-muted" style={{ marginBottom: 4 }}>已確認合計</p>
          <p className="amount-display amount-medium" style={{ color: 'var(--status-info)' }}>{formatTWD(totalConfirmed)}</p>
        </div>
        <div className="card card-sm" style={{ borderColor: 'rgba(26,111,181,0.4)', background: 'rgba(26,111,181,0.06)' }}>
          <p className="text-xs text-muted" style={{ marginBottom: 4 }}>池塘A 剩餘餘額</p>
          <p className="amount-display amount-medium" style={{ color: 'var(--text-accent)' }}>{formatTWD(pondA?.current_balance ?? 0)}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)', marginTop: 2 }}>（已確認 - 已轉出）</p>
        </div>
        <div className="card card-sm">
          <p className="text-xs text-muted" style={{ marginBottom: 4 }}>收入筆數</p>
          <p className="amount-display amount-medium">{myItems.length}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-4" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="flex gap-3">
          <select className="form-input form-select" style={{ width: 'auto' }} value={filterUser} onChange={e => setFilterUser(e.target.value)} id="income-filter-user">
            <option value="all">所有成員</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
          </select>
        </div>
        <button className="btn btn-success" onClick={openAdd} id="income-add-btn">
          + 新增收入
        </button>
      </div>

      {/* Income Table */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 60, borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">💰</span>
          <p className="empty-state-title">尚無收入記錄</p>
          <p className="empty-state-desc">點擊「新增收入」來記錄您的預期收入</p>
          <button className="btn btn-success" onClick={openAdd}>+ 新增收入</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {filtered.map((item) => {
            const isOverdue = item.status === 'pending' && isAfter(new Date(), parseISO(item.expected_date));
            const isMe = item.user_id === profile?.id;
            const canEdit = isMe || isAdmin;
            const sl = statusLabel[item.status];

            return (
              <div key={item.id} className="card card-sm" style={{ borderColor: isOverdue ? 'rgba(224,82,82,0.3)' : undefined }}>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex gap-3 items-start" style={{ flex: 1 }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,var(--pond-a),var(--pond-a-light))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', color: 'white', fontWeight: 700, flexShrink: 0 }}>
                      {(item as IncomeItem & { profile?: Profile }).profile?.display_name?.[0] ?? '?'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{item.name}</span>
                        <span className={`badge ${sl.badge}`}>{sl.text}</span>
                        {isOverdue && <span className="badge badge-error">逾期</span>}
                      </div>
                      <div className="text-xs text-secondary" style={{ marginTop: 2 }}>
                        {(item as IncomeItem & { profile?: Profile }).profile?.display_name}
                        · 預計到帳：{format(parseISO(item.expected_date), 'yyyy/MM/dd', { locale: zhTW })}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="amount-display amount-small amount-pond-a">{formatTWD(item.amount)}</span>

                    {/* Actions — only for own items */}
                    {canEdit && (
                      <>
                        {item.status === 'pending' && (
                          <button className="btn btn-success btn-sm" onClick={() => openConfirm(item)} id={`income-confirm-${item.id}`}>
                            確認到帳
                          </button>
                        )}
                        {item.status === 'confirmed' && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <input
                              type="number"
                              className="form-input"
                              style={{ width: 90, padding: '4px 8px', fontSize: '0.85rem' }}
                              placeholder="金額"
                              value={activeItemId === item.id ? transferAmount : ''}
                              onFocus={() => {
                                setActiveItemId(item.id);
                                setTransferAmount('');
                              }}
                              onChange={e => setTransferAmount(e.target.value)}
                              id={`income-transfer-input-${item.id}`}
                            />
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => { setActiveItemId(item.id); handleTransferToLake(item); }}
                              disabled={saving || activeItemId !== item.id || !transferAmount}
                              id={`income-transfer-lake-${item.id}`}
                            >
                              注入湖泊
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ borderColor: 'rgba(124,58,237,0.5)', color: 'var(--pond-b-light)' }}
                              onClick={() => { setActiveItemId(item.id); handleTransferToPondBFromIncome(item); }}
                              disabled={saving || activeItemId !== item.id || !transferAmount}
                              id={`income-transfer-pond-b-${item.id}`}
                            >
                              注入支出池
                            </button>
                          </div>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(item)} id={`income-edit-${item.id}`}>編輯</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(item.id)} id={`income-delete-${item.id}`}>刪除</button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      {(modal === 'add' || modal === 'edit') && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{modal === 'add' ? '新增收入' : '編輯收入'}</h3>
              <button className="btn btn-ghost btn-sm" onClick={closeModal} id="income-modal-close">✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              {isAdmin && (
                <div className="form-group">
                  <label className="form-label">所屬成員</label>
                  <select id="income-form-user" className="form-input form-select" value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}>
                    {members.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">收入名稱</label>
                <input id="income-form-name" type="text" className="form-input" placeholder="例：薪資、獎金" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">預計到帳日期</label>
                <input id="income-form-date" type="date" className="form-input" value={form.expected_date} onChange={e => setForm(f => ({ ...f, expected_date: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">金額（台幣）</label>
                <input id="income-form-amount" type="number" className="form-input" placeholder="0" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="flex gap-3" style={{ justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
                <button className="btn btn-ghost" onClick={closeModal} id="income-modal-cancel">取消</button>
                <button className="btn btn-success" onClick={handleSave} disabled={saving || !form.name || !form.amount} id="income-modal-save">
                  {saving ? '儲存中...' : '儲存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      {modal === 'confirm' && selected && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">確認收入到帳</h3>
              <button className="btn btn-ghost btn-sm" onClick={closeModal}>✕</button>
            </div>
            <p className="text-secondary" style={{ marginBottom: 'var(--space-5)' }}>
              「{selected.name}」是否實際到帳？
            </p>
            <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
              <label className="form-label">實際到帳金額</label>
              <input id="income-confirm-amount" type="number" className="form-input" value={confirmActual} onChange={e => setConfirmActual(e.target.value)} />
            </div>
            <div className="flex gap-3" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-danger" onClick={() => handleConfirmIncome(false)} disabled={saving} id="income-confirm-no">
                未到帳
              </button>
              <button className="btn btn-success" onClick={() => handleConfirmIncome(true)} disabled={saving || !confirmActual} id="income-confirm-yes">
                ✓ 已到帳，加入池塘
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

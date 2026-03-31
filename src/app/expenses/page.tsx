'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase';
import { ExpenseItem, Profile } from '@/types';
import { formatTWD } from '@/lib/predictions';
import { format, parseISO } from 'date-fns';
import { zhTW } from 'date-fns/locale';

type ModalMode = 'add' | 'edit' | null;

export default function ExpensesPage() {
  const { profile } = useAuth();
  const supabase = createClient();

  const [items, setItems]       = useState<(ExpenseItem & { profile?: Profile })[]>([]);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState<ModalMode>(null);
  const [selected, setSelected] = useState<ExpenseItem | null>(null);
  const [saving, setSaving]     = useState(false);
  const [filterUser, setFilterUser] = useState('all');
  const [members, setMembers]   = useState<Profile[]>([]);

  const [form, setForm] = useState({
    name: '',
    expected_date: '',
    amount: '',
    source: 'pond_a' as 'pond_a' | 'lake',
    reason: '',
  });

  const load = useCallback(async () => {
    if (!profile?.family_id) return;
    setLoading(true);
    const [expRes, profRes] = await Promise.all([
      supabase.from('expense_items').select('*, profile:profiles(*)').eq('family_id', profile.family_id).order('expected_date', { ascending: true }),
      supabase.from('profiles').select('*').eq('family_id', profile.family_id),
    ]);
    setItems((expRes.data ?? []) as (ExpenseItem & { profile?: Profile })[]);
    setMembers((profRes.data ?? []) as Profile[]);
    setLoading(false);
  }, [profile?.family_id, supabase]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setForm({ name: '', expected_date: format(new Date(), 'yyyy-MM-dd'), amount: '', source: 'pond_a', reason: '' });
    setSelected(null);
    setModal('add');
  };

  const openEdit = (item: ExpenseItem) => {
    setForm({ name: item.name, expected_date: item.expected_date, amount: String(item.amount), source: item.source, reason: '' });
    setSelected(item);
    setModal('edit');
  };

  const closeModal = () => { setModal(null); setSelected(null); setSaving(false); };

  const handleSave = async () => {
    if (!profile?.family_id) return;
    setSaving(true);

    if (modal === 'add') {
      const { data: newItem } = await supabase.from('expense_items').insert({
        name: form.name,
        expected_date: form.expected_date,
        amount: Number(form.amount),
        source: form.source,
        family_id: profile.family_id,
        user_id: profile.id,
        status: form.source === 'lake' ? 'planned' : 'planned',
      }).select().single();

      // 如果選擇用湖泊資金，自動建立申請
      if (form.source === 'lake' && newItem) {
        await supabase.from('lake_requests').insert({
          requester_id: profile.id,
          family_id: profile.family_id,
          item_name: form.name,
          requested_amount: Number(form.amount),
          requested_date: form.expected_date,
          reason: form.reason || `支出申請：${form.name}`,
          status: 'pending',
        });

        // 發送通知給管理員
        const { data: admins } = await supabase.from('profiles').select('id').eq('family_id', profile.family_id).eq('role', 'admin');
        if (admins && admins.length > 0) {
          await supabase.from('notifications').insert(
            admins.map(a => ({
              user_id: a.id,
              family_id: profile.family_id,
              type: 'lake_request',
              title: '新的湖泊調撥申請',
              message: `${profile.display_name} 申請使用湖泊資金 ${formatTWD(Number(form.amount))} 用於「${form.name}」`,
              reference_id: newItem.id,
            }))
          );
        }
      } else if (form.source === 'pond_a' && newItem) {
        // 從 pond_a 扣除
        const { data: pondA } = await supabase.from('pond_a').select('current_balance').eq('user_id', profile.id).single();
        const newBalance = Math.max(0, (pondA?.current_balance ?? 0) - Number(form.amount));
        await supabase.from('pond_a').update({ current_balance: newBalance }).eq('user_id', profile.id);
        await supabase.from('expense_items').update({ status: 'completed' }).eq('id', newItem.id);
        await supabase.from('transactions').insert({
          family_id: profile.family_id, user_id: profile.id,
          type: 'expense', amount: Number(form.amount),
          source: 'pond_a', reference_id: newItem.id,
          note: form.name, transaction_date: form.expected_date,
        });
      }
    } else if (modal === 'edit' && selected) {
      await supabase.from('expense_items').update({
        name: form.name,
        expected_date: form.expected_date,
        amount: Number(form.amount),
      }).eq('id', selected.id);
    }

    closeModal();
    load();
  };

  const handleDelete = async (id: string) => {
    await supabase.from('expense_items').delete().eq('id', id);
    load();
  };

  const filtered = items.filter(i => filterUser === 'all' || i.user_id === filterUser);
  const myItems = items.filter(i => i.user_id === profile?.id);
  const totalPlanned = myItems.filter(i => i.status === 'planned').reduce((s, i) => s + i.amount, 0);

  const statusLabel: Record<string, { text: string; badge: string }> = {
    planned:   { text: '計劃中', badge: 'badge-info' },
    approved:  { text: '已批准', badge: 'badge-success' },
    rejected:  { text: '已拒絕', badge: 'badge-error' },
    completed: { text: '已完成', badge: 'badge-success' },
  };

  const sourceLabel: Record<string, { text: string; color: string }> = {
    pond_a: { text: '收入池', color: 'var(--pond-a-light)' },
    lake:   { text: '湖泊',   color: 'var(--text-accent)' },
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">💸 支出管理</h1>
        <p className="page-subtitle">池塘B — 記錄並管理您的支出計劃</p>
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
        <div className="card card-sm" style={{ borderColor: 'rgba(124,58,237,0.3)' }}>
          <p className="text-xs text-muted" style={{ marginBottom: 4 }}>計劃支出合計</p>
          <p className="amount-display amount-medium amount-pond-b">{formatTWD(totalPlanned)}</p>
        </div>
        <div className="card card-sm">
          <p className="text-xs text-muted" style={{ marginBottom: 4 }}>支出筆數</p>
          <p className="amount-display amount-medium">{myItems.length}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-4" style={{ marginBottom: 'var(--space-6)' }}>
        <select className="form-input form-select" style={{ width: 'auto' }} value={filterUser} onChange={e => setFilterUser(e.target.value)} id="expense-filter-user">
          <option value="all">所有成員</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
        <button className="btn btn-primary" onClick={openAdd} id="expense-add-btn">
          + 新增支出
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 60, borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">💸</span>
          <p className="empty-state-title">尚無支出記錄</p>
          <p className="empty-state-desc">點擊「新增支出」來記錄您的支出計劃</p>
          <button className="btn btn-primary" onClick={openAdd}>+ 新增支出</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {filtered.map((item) => {
            const isMe = item.user_id === profile?.id;
            const sl = statusLabel[item.status] ?? statusLabel.planned;
            const src = sourceLabel[item.source] ?? sourceLabel.pond_a;

            return (
              <div key={item.id} className="card card-sm">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex gap-3 items-start" style={{ flex: 1 }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,var(--pond-b),var(--pond-b-light))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', color: 'white', fontWeight: 700, flexShrink: 0 }}>
                      {(item as ExpenseItem & { profile?: Profile }).profile?.display_name?.[0] ?? '?'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{item.name}</span>
                        <span className={`badge ${sl.badge}`}>{sl.text}</span>
                        <span className="badge" style={{ background: 'rgba(255,255,255,0.05)', color: src.color }}>
                          來源：{src.text}
                        </span>
                      </div>
                      <div className="text-xs text-secondary" style={{ marginTop: 2 }}>
                        {(item as ExpenseItem & { profile?: Profile }).profile?.display_name}
                        · 日期：{format(parseISO(item.expected_date), 'yyyy/MM/dd', { locale: zhTW })}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="amount-display amount-small amount-negative">-{formatTWD(item.amount)}</span>
                    {isMe && item.status !== 'completed' && (
                      <>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(item)} id={`expense-edit-${item.id}`}>編輯</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(item.id)} id={`expense-delete-${item.id}`}>刪除</button>
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
      {modal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{modal === 'add' ? '新增支出' : '編輯支出'}</h3>
              <button className="btn btn-ghost btn-sm" onClick={closeModal} id="expense-modal-close">✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              <div className="form-group">
                <label className="form-label">支出名稱</label>
                <input id="expense-form-name" type="text" className="form-input" placeholder="例：餐費、交通費" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">預計日期</label>
                <input id="expense-form-date" type="date" className="form-input" value={form.expected_date} onChange={e => setForm(f => ({ ...f, expected_date: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">金額（台幣）</label>
                <input id="expense-form-amount" type="number" className="form-input" placeholder="0" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">資金來源</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                  <button id="expense-source-pond" onClick={() => setForm(f => ({ ...f, source: 'pond_a' }))} style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', border: `2px solid ${form.source === 'pond_a' ? 'var(--pond-a)' : 'var(--color-border)'}`, background: form.source === 'pond_a' ? 'rgba(26,158,92,0.1)' : 'transparent', cursor: 'pointer', color: 'var(--text-primary)', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.3rem', marginBottom: 4 }}>💰</div>
                    <div className="text-sm font-semibold">收入池 (池塘A)</div>
                    <div className="text-xs text-muted">立即扣除</div>
                  </button>
                  <button id="expense-source-lake" onClick={() => setForm(f => ({ ...f, source: 'lake' }))} style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', border: `2px solid ${form.source === 'lake' ? 'var(--lake-safe)' : 'var(--color-border)'}`, background: form.source === 'lake' ? 'rgba(26,111,181,0.1)' : 'transparent', cursor: 'pointer', color: 'var(--text-primary)', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.3rem', marginBottom: 4 }}>🌊</div>
                    <div className="text-sm font-semibold">湖泊資金</div>
                    <div className="text-xs text-muted">需管理員批准</div>
                  </button>
                </div>
              </div>
              {form.source === 'lake' && (
                <div className="form-group">
                  <label className="form-label">申請原因</label>
                  <input id="expense-form-reason" type="text" className="form-input" placeholder="說明為何需要使用湖泊資金" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
                </div>
              )}
              {form.source === 'lake' && (
                <div className="alert alert-info">
                  <span>ℹ️</span>
                  <span>選擇湖泊資金將自動建立調撥申請，需等待管理員批准後才會從湖泊扣除。</span>
                </div>
              )}
              <div className="flex gap-3" style={{ justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
                <button className="btn btn-ghost" onClick={closeModal} id="expense-modal-cancel">取消</button>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.name || !form.amount} id="expense-modal-save">
                  {saving ? '儲存中...' : '儲存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase';
import { IncomeItem, Profile, PondA } from '@/types';
import { formatTWD } from '@/lib/predictions';
import { format, isAfter, parseISO } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { LabelTooltip } from '@/components/ui/Tooltip';

type ModalMode = 'add' | 'edit' | 'confirm' | null;

export default function IncomePage() {
  const { profile, isAdmin, canManageLake } = useAuth();
  const supabase = createClient();

  const [items, setItems]         = useState<(IncomeItem & { profile?: Profile })[]>([]);
  const [pondA, setPondA]         = useState<PondA | null>(null);
  const [loading, setLoading]     = useState(true);
  const [modal, setModal]         = useState<ModalMode>(null);
  const [selected, setSelected]   = useState<IncomeItem | null>(null);
  const [saving, setSaving]       = useState(false);
  const [filterUser, setFilterUser] = useState<string>('all');
  const [members, setMembers]     = useState<Profile[]>([]);
  
  // 刪除確認相關
  const [deleteTarget, setDeleteTarget] = useState<IncomeItem | null>(null);
  const [showDeleteOptions, setShowDeleteOptions] = useState(false);

  // 編輯循環選項相關
  const [showEditOptions, setShowEditOptions] = useState(false);

  // Form state
  const [form, setForm] = useState({
    name: '',
    expected_date: '',
    amount: '',
    user_id: '',
    destination: 'pond_a' as 'pond_a' | 'lake',
    is_recurring: false,
    recurrence_rule: 'monthly' as 'monthly' | 'quarterly' | 'yearly',
    recurrence_end_date: '',
  });
  const [transferAmount, setTransferAmount] = useState('');
  const [confirmActual, setConfirmActual] = useState('');
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
    setForm({
      name: '',
      expected_date: format(new Date(), 'yyyy-MM-dd'),
      amount: '',
      user_id: profile?.id || '',
      destination: 'pond_a',
      is_recurring: false,
      recurrence_rule: 'monthly',
      recurrence_end_date: format(new Date(), 'yyyy-MM-dd'),
    });
    setModal('add');
    setSelected(null);
  };

  const openEdit = (item: IncomeItem) => {
    setForm({
      name: item.name,
      expected_date: item.expected_date,
      amount: String(item.amount),
      user_id: item.user_id,
      destination: item.destination ?? 'pond_a',
      is_recurring: item.is_recurring ?? false,
      recurrence_rule: item.recurrence_rule ?? 'monthly',
      recurrence_end_date: item.recurrence_end_date ?? item.expected_date,
    });
    setSelected(item);
    setModal('edit');
  };

  const openConfirm = (item: IncomeItem) => {
    setSelected(item);
    setConfirmActual(String(item.amount));
    setModal('confirm');
  };

  const closeModal = () => {
    setModal(null);
    setSelected(null);
    setShowEditOptions(false);
    setSaving(false);
  };

  const handleSave = async (editType?: 'single' | 'future') => {
    if (!profile?.family_id) return;
    setSaving(true);
    const targetUserId = form.user_id || profile.id;
    const amountNum = Number(form.amount);

    if (modal === 'add') {
      if (form.is_recurring) {
        const recurrence_group_id = crypto.randomUUID();
        const occurrences: any[] = [];
        let current = new Date(form.expected_date + 'T00:00:00');
        const endLimit = new Date(form.recurrence_end_date + 'T23:59:59');

        while (current <= endLimit) {
          const expectedStr = format(current, 'yyyy-MM-dd');
          occurrences.push({
            name: form.name,
            expected_date: expectedStr,
            amount: amountNum,
            family_id: profile.family_id,
            user_id: targetUserId,
            destination: form.destination,
            is_recurring: true,
            recurrence_rule: form.recurrence_rule,
            recurrence_start_date: form.expected_date,
            recurrence_end_date: form.recurrence_end_date,
            recurrence_group_id,
            status: 'pending',
          });

          if (form.recurrence_rule === 'monthly') {
            current.setMonth(current.getMonth() + 1);
          } else if (form.recurrence_rule === 'quarterly') {
            current.setMonth(current.getMonth() + 3);
          } else if (form.recurrence_rule === 'yearly') {
            current.setFullYear(current.getFullYear() + 1);
          } else {
            break;
          }
        }
        if (occurrences.length > 0) {
          await supabase.from('income_items').insert(occurrences);
        }
      } else {
        await supabase.from('income_items').insert({
          name: form.name,
          expected_date: form.expected_date,
          amount: amountNum,
          family_id: profile.family_id,
          user_id: targetUserId,
          destination: form.destination,
          is_recurring: false,
          status: 'pending',
        });
      }
      closeModal();
      load();
    } else if (modal === 'edit' && selected) {
      if (selected.is_recurring && !editType) {
        setShowEditOptions(true);
        setSaving(false);
        return;
      }

      const updatePayload: any = {
        name: form.name,
        amount: amountNum,
        destination: form.destination,
        user_id: targetUserId,
      };

      const singleUpdate = {
        ...updatePayload,
        expected_date: form.expected_date,
      };

      if (selected.status === 'confirmed') {
        singleUpdate.actual_amount = amountNum;
      }

      if (selected.is_recurring && editType === 'future') {
        await supabase
          .from('income_items')
          .update(updatePayload)
          .eq('recurrence_group_id', selected.recurrence_group_id)
          .gte('expected_date', selected.expected_date);

        if (selected.status === 'confirmed') {
          await supabase
            .from('income_items')
            .update({ actual_amount: amountNum })
            .eq('recurrence_group_id', selected.recurrence_group_id)
            .gte('expected_date', selected.expected_date)
            .eq('status', 'confirmed');
        }
      } else {
        await supabase
          .from('income_items')
          .update(singleUpdate)
          .eq('id', selected.id);
      }
      setShowEditOptions(false);
      closeModal();
      load();
    }
  };

  const handleConfirmIncome = async (confirmed: boolean) => {
    if (!selected || !profile) return;
    setSaving(true);
    const actualAmount = Number(confirmActual);

    if (confirmed) {
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
    if (!profile) return;

    if (item.status === 'pending' && item.destination !== 'lake') {
      setSaving(true);
      try {
        const { error } = await supabase
          .from('income_items')
          .update({ destination: 'lake' })
          .eq('id', item.id);
        if (error) throw new Error(error.message);
      } catch (err: any) {
        alert('系統錯誤：' + err.message);
        console.error('加入湖泊預計收入失敗：', err);
      } finally {
        setSaving(false);
        load();
      }
      return;
    }

    const amt = Number(transferAmount);
    if (!amt) return;
    const pondABalance = pondA?.current_balance ?? 0;
    if (amt > pondABalance) {
      alert(`注入金額（${formatTWD(amt)}）不能超過收入池餘額（${formatTWD(pondABalance)}）`);
      return;
    }
    setSaving(true);

    try {
      const { error } = await supabase.from('transactions').insert({
        family_id: profile.family_id,
        user_id: item.user_id,
        reference_id: item.id,
        type: 'transfer_to_lake',
        amount: amt,
        source: 'pond_a',
        destination: 'lake',
        note: `注入湖泊：${item.name}`,
        transaction_date: new Date().toISOString().substring(0, 10),
      });
      if (error) throw new Error(error.message);
    } catch (err: any) {
      alert('系統錯誤：' + err.message);
      console.error('注入湖泊失敗：', err);
    }

    setTransferAmount('');
    setSaving(false);
    load();
  };

  const handleTransferToPondBFromIncome = async (item: IncomeItem) => {
    const amt = Number(transferAmount);
    if (!amt || !profile) return;
    const pondABalance = pondA?.current_balance ?? 0;
    if (amt > pondABalance) {
      alert(`注入金額（${formatTWD(amt)}）不能超過收入池餘額（${formatTWD(pondABalance)}）`);
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('transactions').insert({
        family_id: profile.family_id,
        user_id: item.user_id,
        reference_id: item.id,
        type: 'transfer_to_pond_b',
        amount: amt,
        source: 'pond_a',
        destination: 'pond_b',
        note: `注入支出池：${item.name}`,
        transaction_date: new Date().toISOString().substring(0, 10),
      });
      if (error) throw new Error(error.message);
    } catch (err: any) {
      alert('系統錯誤：' + err.message);
      console.error('注入支出池失敗：', err);
    }
    setTransferAmount('');
    setActiveItemId(null);
    setSaving(false);
    load();
  };

  /** 刪除確認 */
  const confirmDelete = (item: IncomeItem) => {
    setDeleteTarget(item);
    setShowDeleteOptions(item.is_recurring ?? false);
  };

  const handleDelete = async (deleteType?: 'single' | 'future') => {
    if (!deleteTarget) return;

    if (deleteTarget.is_recurring && deleteType === 'future') {
      const { error } = await supabase
        .from('income_items')
        .delete()
        .eq('recurrence_group_id', deleteTarget.recurrence_group_id)
        .gte('expected_date', deleteTarget.expected_date);
      if (error) {
        console.error('Failed to delete recurring income (future):', error);
        alert('刪除失敗：' + error.message);
      }
    } else {
      const { error } = await supabase.from('income_items').delete().eq('id', deleteTarget.id);
      if (error) {
        console.error('Failed to delete income:', error);
        alert('刪除失敗：' + error.message);
      }
    }

    setDeleteTarget(null);
    setShowDeleteOptions(false);
    load();
  };

  const filtered = items.filter(i => filterUser === 'all' || i.user_id === filterUser);
  const myItems = items.filter(i => i.user_id === profile?.id);
  const totalPending = myItems.filter(i => i.status === 'pending').reduce((s, i) => s + i.amount, 0);
  const totalConfirmed = myItems.filter(i => i.status === 'confirmed').reduce((s, i) => s + (i.actual_amount ?? i.amount), 0);
  const pondABalance = pondA?.current_balance ?? 0;

  const statusLabel: Record<string, { text: string; badge: string }> = {
    pending:   { text: '待確認', badge: 'badge-warning' },
    confirmed: { text: '已到帳', badge: 'badge-success' },
    failed:    { text: '未到帳', badge: 'badge-error' },
  };

  const recurringLabel: Record<string, string> = { monthly: '每月', quarterly: '每季', yearly: '每年' };

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
          <p className="amount-display amount-medium" style={{ color: 'var(--text-accent)' }}>{formatTWD(pondABalance)}</p>
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

      {/* Income List */}
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
            
            // 普通成員無法編輯/刪除已確認(confirmed)或失敗(failed)的歷史收入，限管理員。
            // 待確認(pending)的項目，本人與湖泊管理員均可編輯/刪除。
            const isHistory = item.status === 'confirmed' || item.status === 'failed';
            const canEdit = isAdmin || (!isHistory && (isMe || canManageLake));
            const canDelete = isAdmin || (!isHistory && (isMe || canManageLake));
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
                        {item.is_recurring && (
                          <span className="badge badge-info" style={{ gap: 4, display: 'flex', alignItems: 'center' }}>
                            🔄 循環 ({recurringLabel[item.recurrence_rule ?? 'monthly']})
                          </span>
                        )}
                        <span className="badge badge-ghost text-xs">
                          🎯 {item.destination === 'lake' ? '🌊 家庭湖泊' : '💰 個人池塘A'}
                        </span>
                      </div>
                      <div className="text-xs text-secondary" style={{ marginTop: 4 }}>
                        成員：{(item as IncomeItem & { profile?: Profile }).profile?.display_name}
                        · 預計到帳：{format(parseISO(item.expected_date), 'yyyy/MM/dd', { locale: zhTW })}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="amount-display amount-small amount-pond-a">{formatTWD(item.amount)}</span>

                    {canEdit && (
                      <>
                        {item.status === 'pending' && (
                          <button className="btn btn-success btn-sm" onClick={() => openConfirm(item)} id={`income-confirm-${item.id}`}>
                            確認到帳
                          </button>
                        )}
                        {item.status === 'confirmed' && item.destination !== 'lake' && isMe && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <div style={{ position: 'relative' }}>
                              <input
                                type="number"
                                className="form-input"
                                style={{ width: 90, padding: '4px 8px', fontSize: '0.85rem' }}
                                placeholder="金額"
                                title={`最多可轉出：${formatTWD(pondABalance)}`}
                                value={activeItemId === item.id ? transferAmount : ''}
                                onFocus={() => {
                                  setActiveItemId(item.id);
                                  setTransferAmount('');
                                }}
                                onChange={e => setTransferAmount(e.target.value)}
                                id={`income-transfer-input-${item.id}`}
                              />
                            </div>
                            <span className="text-xs text-muted" style={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                              可用 {formatTWD(pondABalance)}
                            </span>
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
                              onClick={() => { setActiveItemId(item.id); handleTransferToPondBFromIncome(item); }}
                              disabled={saving || activeItemId !== item.id || !transferAmount}
                              id={`income-transfer-pond-b-${item.id}`}
                            >
                              注入支出池
                            </button>
                          </div>
                        )}
                        {item.status === 'pending' && item.destination !== 'lake' && isMe && (
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleTransferToLake(item)}
                            disabled={saving}
                            id={`income-plan-to-lake-${item.id}`}
                          >
                            加入湖泊預計收入
                          </button>
                        )}
                        {item.status === 'pending' && item.destination === 'lake' && isMe && (
                          <span className="badge badge-success" style={{ whiteSpace: 'nowrap' }}>
                            已加入湖泊預計收入
                          </span>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(item)} id={`income-edit-${item.id}`}>編輯</button>
                      </>
                    )}
                    {canDelete && (
                      <button className="btn btn-danger btn-sm" onClick={() => confirmDelete(item)} id={`income-delete-${item.id}`}>刪除</button>
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
            
            {showEditOptions ? (
              /* 編輯循環收入選項詢問 */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                <p className="text-secondary">
                  這是一筆循環收入。請問您希望如何儲存此修改？
                </p>
                <div className="flex flex-col gap-3" style={{ marginTop: 'var(--space-2)' }}>
                  <button className="btn btn-success w-full" onClick={() => handleSave('single')} disabled={saving}>
                    僅修改此單筆項目
                  </button>
                  <button className="btn btn-primary w-full" onClick={() => handleSave('future')} disabled={saving}>
                    修改此項目及未來所有關聯項目
                  </button>
                  <button className="btn btn-ghost w-full" onClick={() => setShowEditOptions(false)}>
                    返回編輯
                  </button>
                </div>
              </div>
            ) : (
              /* 收入表單內容 */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                {canManageLake && (
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                      所屬成員
                      <LabelTooltip text="選擇此收入屬於哪位家庭成員（管理員專用）" />
                    </label>
                    <select id="income-form-user" className="form-input form-select" value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}>
                      {members.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                    </select>
                  </div>
                )}
                
                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                    收入名稱
                    <LabelTooltip text="描述這筆收入的來源，例如：薪資、獎金、兼職收入" />
                  </label>
                  <input id="income-form-name" type="text" className="form-input" placeholder="例：薪資、獎金" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                    入帳目標
                    <LabelTooltip text={
                      "選擇此收入是匯入個人池塘A，或是直接匯入家庭共同湖泊。注意：系統設計上若出現欠款，會顯示在支出池（Pond B）；Pond A 與 Lake 不會顯示負數。"
                    } />
                  </label>
                  <select
                    id="income-form-destination"
                    className="form-input form-select"
                    value={form.destination}
                    onChange={e => setForm(f => ({ ...f, destination: e.target.value as 'pond_a' | 'lake' }))}
                  >
                    <option value="pond_a">💰 個人池塘 A (Pond A)</option>
                    <option value="lake">🌊 家庭共同湖泊 (Lake)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                    預計到帳日期
                    <LabelTooltip text="這筆收入預計匯入帳戶的日期，到帳後需回來點擊「確認到帳」" />
                  </label>
                  <input id="income-form-date" type="date" className="form-input" value={form.expected_date} onChange={e => setForm(f => ({ ...f, expected_date: e.target.value }))} />
                </div>
                
                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                    金額（台幣）
                    <LabelTooltip text="預計收入金額，確認到帳時可填寫實際到帳金額（可能與預計不同）" />
                  </label>
                  <input id="income-form-amount" type="number" className="form-input" placeholder="0" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                </div>

                {/* 循環收入開關 (僅在新增模式下顯示，編輯循環收入走分開的批次處理) */}
                {modal === 'add' && (
                  <>
                    <div className="form-group flex items-center" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                      <input
                        id="income-form-recurring"
                        type="checkbox"
                        checked={form.is_recurring}
                        onChange={e => setForm(f => ({ ...f, is_recurring: e.target.checked }))}
                        style={{ width: 18, height: 18, cursor: 'pointer' }}
                      />
                      <label htmlFor="income-form-recurring" className="form-label font-semibold" style={{ margin: 0, cursor: 'pointer', userSelect: 'none' }}>
                        🔄 設定為循環定期收入
                      </label>
                    </div>

                    {form.is_recurring && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', padding: '12px', background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <div className="form-group">
                          <label className="form-label">循環週期</label>
                          <select
                            id="income-form-recurrence-rule"
                            className="form-input form-select"
                            value={form.recurrence_rule}
                            onChange={e => setForm(f => ({ ...f, recurrence_rule: e.target.value as any }))}
                          >
                            <option value="monthly">每月</option>
                            <option value="quarterly">每季</option>
                            <option value="yearly">每年</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label className="form-label">結束日期</label>
                          <input
                            id="income-form-recurrence-end"
                            type="date"
                            className="form-input"
                            value={form.recurrence_end_date}
                            onChange={e => setForm(f => ({ ...f, recurrence_end_date: e.target.value }))}
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}

                <div className="flex gap-3" style={{ justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
                  <button className="btn btn-ghost" onClick={closeModal} id="income-modal-cancel">取消</button>
                  <button className="btn btn-success" onClick={() => handleSave()} disabled={saving || !form.name || !form.amount} id="income-modal-save">
                    {saving ? '儲存中...' : '儲存'}
                  </button>
                </div>
              </div>
            )}
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
              <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                實際到帳金額
                <LabelTooltip text="請填入實際匯入帳戶的金額（可能與原預計不同），確認後將自動加入收入池" />
              </label>
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

      {/* 刪除確認 Modal */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h3 className="modal-title">⚠️ 確認刪除</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setDeleteTarget(null)}>✕</button>
            </div>
            <p className="text-secondary" style={{ marginBottom: 'var(--space-3)' }}>
              確定要刪除這筆收入記錄嗎？若已確認到帳，池塘水位將自動重算。
            </p>
            <div style={{ padding: '10px 14px', background: 'rgba(224,82,82,0.08)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-5)', border: '1px solid rgba(224,82,82,0.2)' }}>
              <span className="font-semibold">{deleteTarget.name}</span>
              <span className="text-secondary" style={{ marginLeft: 8 }}>— {formatTWD(deleteTarget.amount)}</span>
            </div>
            
            {showDeleteOptions ? (
              /* 刪除循環項目選項 */
              <div className="flex flex-col gap-2 w-full">
                <button className="btn btn-danger w-full" onClick={() => handleDelete('single')} id="income-delete-single">
                  僅刪除此單筆項目
                </button>
                <button className="btn btn-primary w-full" onClick={() => handleDelete('future')} id="income-delete-future" style={{ backgroundColor: 'var(--status-error-dark, #bd2130)', borderColor: 'var(--status-error-dark, #bd2130)' }}>
                  刪除此筆及未來所有關聯項目
                </button>
                <button className="btn btn-ghost w-full" onClick={() => setDeleteTarget(null)}>
                  取消
                </button>
              </div>
            ) : (
              /* 一般刪除確認 */
              <div className="flex gap-3" style={{ justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)} id="income-delete-cancel">取消</button>
                <button className="btn btn-danger" onClick={() => handleDelete('single')} id="income-delete-confirm">確認刪除</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

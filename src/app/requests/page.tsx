'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase';
import { LakeRequest, Profile } from '@/types';
import { formatTWD } from '@/lib/predictions';
import { format, parseISO } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { LabelTooltip } from '@/components/ui/Tooltip';

export default function RequestsPage() {
  const { profile, isAdmin, canManageLake } = useAuth();
  const supabase = createClient();

  const [requests, setRequests] = useState<(LakeRequest & { profile?: Profile })[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [reviewModal, setReviewModal] = useState<LakeRequest | null>(null);
  const [reviewForm, setReviewForm]   = useState({ approved_amount: '', approved_date: '', admin_note: '' });
  
  // 管理員編輯歷史申請
  const [editModal, setEditModal]     = useState<LakeRequest | null>(null);
  const [editForm, setEditForm]       = useState({ item_name: '', status: 'approved' as 'pending' | 'approved' | 'rejected', approved_amount: '', approved_date: '', admin_note: '' });

  const [saving, setSaving]     = useState(false);

  // 多選批量操作
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchAction, setBatchAction] = useState<'approve' | 'reject' | 'delete' | null>(null);

  const load = useCallback(async () => {
    if (!profile?.family_id) return;
    setLoading(true);
    const { data } = await supabase
      .from('lake_requests')
      .select('*, profile:profiles(*)')
      .eq('family_id', profile.family_id)
      .order('created_at', { ascending: false });
    setRequests((data ?? []) as (LakeRequest & { profile?: Profile })[]);
    setSelectedIds(new Set());
    setLoading(false);
  }, [profile?.family_id, supabase]);

  useEffect(() => { load(); }, [load]);

  const openReview = (req: LakeRequest) => {
    setReviewModal(req);
    setReviewForm({
      approved_amount: String(req.requested_amount),
      approved_date: req.requested_date,
      admin_note: '',
    });
  };

  const handleApprove = async () => {
    if (!reviewModal || !profile) return;
    setSaving(true);
    const approvedAmt = Number(reviewForm.approved_amount);

    await supabase.from('lake_requests').update({
      status: 'approved',
      approved_amount: approvedAmt,
      approved_date: reviewForm.approved_date,
      admin_note: reviewForm.admin_note,
      reviewed_at: new Date().toISOString(),
    }).eq('id', reviewModal.id);

    await supabase.from('notifications').insert({
      user_id: reviewModal.requester_id,
      family_id: profile.family_id,
      type: 'request_approved',
      title: '湖泊調撥申請已批准',
      message: `您申請的「${reviewModal.item_name}」已批准，金額 ${formatTWD(approvedAmt)}，預計 ${reviewForm.approved_date} 到帳`,
      reference_id: reviewModal.id,
    });

    setSaving(false);
    setReviewModal(null);
    load();
  };

  const handleReject = async () => {
    if (!reviewModal || !profile) return;
    setSaving(true);

    await supabase.from('lake_requests').update({
      status: 'rejected',
      admin_note: reviewForm.admin_note,
      reviewed_at: new Date().toISOString(),
    }).eq('id', reviewModal.id);

    await supabase.from('notifications').insert({
      user_id: reviewModal.requester_id,
      family_id: profile.family_id,
      type: 'request_rejected',
      title: '湖泊調撥申請未通過',
      message: `您申請的「${reviewModal.item_name}」未通過${reviewForm.admin_note ? `，原因：${reviewForm.admin_note}` : ''}`,
      reference_id: reviewModal.id,
    });

    setSaving(false);
    setReviewModal(null);
    load();
  };

  // 管理員歷史編輯功能
  const openEdit = (req: LakeRequest) => {
    setEditModal(req);
    setEditForm({
      item_name: req.item_name,
      status: req.status,
      approved_amount: String(req.approved_amount ?? req.requested_amount),
      approved_date: req.approved_date ?? req.requested_date,
      admin_note: req.admin_note ?? '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editModal || !profile) return;
    setSaving(true);

    const isApp = editForm.status === 'approved';
    await supabase.from('lake_requests').update({
      item_name: editForm.item_name,
      status: editForm.status,
      approved_amount: isApp ? Number(editForm.approved_amount) : null,
      approved_date: isApp ? editForm.approved_date : null,
      admin_note: editForm.admin_note,
      reviewed_at: new Date().toISOString(),
    }).eq('id', editModal.id);

    setSaving(false);
    setEditModal(null);
    load();
  };

  const handleDelete = async (req: LakeRequest) => {
    if (confirm(`確定要刪除對成員「${req.profile?.display_name}」的「${req.item_name}」調撥申請嗎？\n\n⚠️ 注意：若已批准，關聯的交易流水將自動被資料庫移除，且餘額會同步自動重算！此動作無法復原。`)) {
      setSaving(true);
      await supabase.from('lake_requests').delete().eq('id', req.id);
      setSaving(false);
      load();
    }
  };

  // ---- 批量操作 ----

  const handleSelectAll = () => {
    const current = filtered;
    if (selectedIds.size === current.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(current.map(r => r.id)));
    }
  };

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const confirmBatchAction = (action: 'approve' | 'reject' | 'delete') => {
    setBatchAction(action);
  };

  const executeBatchAction = async () => {
    if (!batchAction || !profile) return;
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    setSaving(true);

    if (batchAction === 'approve') {
      const now = new Date().toISOString();
      const { data: batchData } = await supabase
        .from('lake_requests')
        .select('*')
        .in('id', ids);
      const items = (batchData ?? []) as LakeRequest[];

      // 逐筆處理（因無法使用資料庫子查詢優化）
      for (const item of items) {
        if (item.status !== 'pending') continue;
        const approvedAmt = item.requested_amount;
        await supabase.from('lake_requests').update({
          status: 'approved',
          approved_amount: approvedAmt,
          approved_date: item.requested_date,
          reviewed_at: now,
        }).eq('id', item.id);

        await supabase.from('notifications').insert({
          user_id: item.requester_id,
          family_id: profile.family_id,
          type: 'request_approved',
          title: '湖泊調撥申請已批准（批量）',
          message: `您申請的「${item.item_name}」已批量批准，金額 ${formatTWD(approvedAmt)}，預計 ${item.requested_date} 到帳`,
          reference_id: item.id,
        });
      }

    } else if (batchAction === 'reject') {
      const now = new Date().toISOString();
      const { data: batchData } = await supabase
        .from('lake_requests')
        .select('*')
        .in('id', ids);
      const items = (batchData ?? []) as LakeRequest[];

      for (const item of items) {
        if (item.status !== 'pending') continue;
        await supabase.from('lake_requests').update({
          status: 'rejected',
          admin_note: '批量拒絕',
          reviewed_at: now,
        }).eq('id', item.id);

        await supabase.from('notifications').insert({
          user_id: item.requester_id,
          family_id: profile.family_id,
          type: 'request_rejected',
          title: '湖泊調撥申請未通過（批量）',
          message: `您申請的「${item.item_name}」已被批量拒絕`,
          reference_id: item.id,
        });
      }
    } else if (batchAction === 'delete') {
      for (const id of ids) {
        await supabase.from('lake_requests').delete().eq('id', id);
      }
    }

    setSaving(false);
    setBatchAction(null);
    load();
  };

  const filtered = requests.filter(r => filter === 'all' || r.status === filter);

  const statusConfig: Record<string, { text: string; badge: string; icon: string }> = {
    pending:  { text: '待審批', badge: 'badge-warning', icon: '⏳' },
    approved: { text: '已批准', badge: 'badge-success', icon: '✅' },
    rejected: { text: '已拒絕', badge: 'badge-error',   icon: '❌' },
  };

  const selectedCount = selectedIds.size;
  const pendingSelected = filtered.filter(r => selectedIds.has(r.id) && r.status === 'pending').length;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">📋 湖泊調撥申請</h1>
        <p className="page-subtitle">
          {canManageLake ? '審批成員的湖泊資金申請' : '查看您的湖泊資金申請狀態'}
        </p>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2" style={{ marginBottom: 'var(--space-6)', flexWrap: 'wrap' }}>
        {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
          <button key={f} id={`req-filter-${f}`} onClick={() => setFilter(f)} className="btn btn-sm" style={{
            background: filter === f ? 'rgba(26,111,181,0.15)' : 'transparent',
            color: filter === f ? 'var(--text-accent)' : 'var(--text-muted)',
            border: `1px solid ${filter === f ? 'rgba(26,111,181,0.3)' : 'var(--color-border)'}`,
          }}>
            {{ all: '全部', pending: '⏳ 待審批', approved: '✅ 已批准', rejected: '❌ 已拒絕' }[f]}
            <span style={{ marginLeft: 4, opacity: 0.7 }}>
              ({f === 'all' ? requests.length : requests.filter(r => r.status === f).length})
            </span>
          </button>
        ))}
      </div>

      {/* 批量操作按鈕列 */}
      {canManageLake && selectedCount > 0 && (
        <div style={{
          marginBottom: 'var(--space-4)',
          padding: '10px 16px',
          background: 'rgba(26,111,181,0.12)',
          border: '1px solid rgba(26,111,181,0.25)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
        }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-accent)' }}>
            ✓ 已選取 {selectedCount} 項
            {pendingSelected > 0 && selectedCount > pendingSelected && (
              <span className="text-muted font-normal" style={{ marginLeft: 6 }}>
                （其中 {pendingSelected} 項待審批可操作）
              </span>
            )}
          </span>
          <div className="flex gap-2">
            {pendingSelected > 0 && (
              <>
                <button
                  className="btn btn-success btn-sm"
                  onClick={() => confirmBatchAction('approve')}
                  disabled={saving}
                  id="req-batch-approve"
                >
                  ✅ 批量批准
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => confirmBatchAction('reject')}
                  disabled={saving}
                  id="req-batch-reject"
                >
                  ❌ 批量拒絕
                </button>
              </>
            )}
            <button
              className="btn btn-danger btn-sm"
              onClick={() => confirmBatchAction('delete')}
              disabled={saving}
              id="req-batch-delete"
            >
              🗑️ 批量刪除
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setSelectedIds(new Set())}
              disabled={saving}
            >
              取消選取
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 80, borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">📋</span>
          <p className="empty-state-title">目前沒有申請記錄</p>
          <p className="empty-state-desc">在「支出管理」選擇湖泊資金來源，即可提交申請</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* 全選列 */}
          {canManageLake && filtered.length > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '6px 12px',
              fontSize: '0.85rem',
              color: 'var(--text-muted)',
            }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selectedIds.size === filtered.length}
                  onChange={handleSelectAll}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <span>全選（{filtered.length} 項）</span>
              </label>
            </div>
          )}

          {filtered.map((req) => {
            const sc = statusConfig[req.status] ?? statusConfig.pending;
            const isPending = req.status === 'pending';

            return (
              <div key={req.id} className="card" style={{
                borderColor: req.status === 'pending' ? 'rgba(245,166,35,0.25)' : undefined,
                display: 'flex', alignItems: 'flex-start', gap: 12,
              }}>
                {/* 多選核取方塊 */}
                {canManageLake && (
                  <div style={{ paddingTop: 6, flexShrink: 0 }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(req.id)}
                      onChange={() => handleToggleSelect(req.id)}
                      style={{ width: 18, height: 18, cursor: 'pointer' }}
                    />
                  </div>
                )}

                <div className="flex items-start justify-between flex-wrap gap-4" style={{ flex: 1, minWidth: 0 }}>
                  <div className="flex gap-3" style={{ flex: 1 }}>
                    <div style={{ fontSize: '1.5rem', flexShrink: 0, marginTop: 2 }}>{sc.icon}</div>
                    <div style={{ flex: 1 }}>
                      <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 'var(--space-2)' }}>
                        <span className="font-semibold">{req.item_name}</span>
                        <span className={`badge ${sc.badge}`}>{sc.text}</span>
                      </div>
                      <div className="text-sm text-secondary">
                        申請人：{(req as LakeRequest & { profile?: Profile }).profile?.display_name ?? '未知'}
                        {' · '}申請金額：<span className="amount-display" style={{ color: 'var(--text-accent)' }}>{formatTWD(req.requested_amount)}</span>
                        {' · '}所需日期：{format(parseISO(req.requested_date), 'yyyy/MM/dd', { locale: zhTW })}
                      </div>
                      {req.reason && (
                        <div className="text-sm text-muted" style={{ marginTop: 4 }}>
                          原因：{req.reason}
                        </div>
                      )}
                      {req.status === 'approved' && req.approved_amount && (
                        <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(34,200,112,0.08)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}>
                          ✅ 批准金額：{formatTWD(req.approved_amount)} · 到帳日：{req.approved_date}
                          {req.admin_note && <span className="text-muted"> · {req.admin_note}</span>}
                        </div>
                      )}
                      {req.status === 'rejected' && req.admin_note && (
                        <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(224,82,82,0.08)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: 'var(--status-error)' }}>
                          ❌ 拒絕原因：{req.admin_note}
                        </div>
                      )}
                      <div className="text-xs text-muted" style={{ marginTop: 6 }}>
                        申請時間：{format(parseISO(req.created_at), 'yyyy/MM/dd HH:mm', { locale: zhTW })}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2" style={{ flexShrink: 0 }}>
                    {/* 一般審審批 */}
                    {canManageLake && isPending && (
                      <button className="btn btn-primary btn-sm" onClick={() => openReview(req)} id={`req-review-${req.id}`}>
                        審批
                      </button>
                    )}
                    
                    {/* 管理員專屬歷史編輯與刪除 */}
                    {isAdmin && !isPending && (
                      <>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(req)} id={`req-edit-${req.id}`}>
                          編輯歷史
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(req)} id={`req-delete-${req.id}`}>
                          刪除
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Review Modal (Admin/Manager Only) */}
      {reviewModal && (
        <div className="modal-overlay" onClick={() => setReviewModal(null)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">審批申請</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setReviewModal(null)} id="req-review-close">✕</button>
            </div>
            <div style={{ marginBottom: 'var(--space-5)', padding: 'var(--space-4)', background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-md)' }}>
              <p className="text-sm"><span className="text-muted">項目：</span>{reviewModal.item_name}</p>
              <p className="text-sm"><span className="text-muted">申請金額：</span>{formatTWD(reviewModal.requested_amount)}</p>
              <p className="text-sm"><span className="text-muted">所需日期：</span>{reviewModal.requested_date}</p>
              {reviewModal.reason && <p className="text-sm"><span className="text-muted">原因：</span>{reviewModal.reason}</p>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                  批准金額（可調整）
                  <LabelTooltip text="可以批准比申請少的金額，調整後的金額將直接撥入申請人的支出池。" />
                </label>
                <input id="req-review-amount" type="number" className="form-input" value={reviewForm.approved_amount} onChange={e => setReviewForm(f => ({ ...f, approved_amount: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                  到帳日期
                  <LabelTooltip text="資金預計從湖泊撥出的日期，此日期將出現在交易記錄中" />
                </label>
                <input id="req-review-date" type="date" className="form-input" value={reviewForm.approved_date} onChange={e => setReviewForm(f => ({ ...f, approved_date: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center' }}>
                  備註（可選）
                  <LabelTooltip text="填寫批准或拒絕的原因，申請人將收到包含此備註的通知" />
                </label>
                <input id="req-review-note" type="text" className="form-input" placeholder="批准/拒絕原因" value={reviewForm.admin_note} onChange={e => setReviewForm(f => ({ ...f, admin_note: e.target.value }))} />
              </div>
              <div className="flex gap-3" style={{ justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
                <button className="btn btn-danger" onClick={handleReject} disabled={saving} id="req-reject-btn">
                  {saving ? '處理中...' : '❌ 拒絕'}
                </button>
                <button className="btn btn-success" onClick={handleApprove} disabled={saving || !reviewForm.approved_amount} id="req-approve-btn">
                  {saving ? '處理中...' : '✅ 批准'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal (Admin Only) */}
      {editModal && (
        <div className="modal-overlay" onClick={() => setEditModal(null)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">⚙️ 編輯歷史申請 (管理員專用)</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditModal(null)} id="req-edit-close">✕</button>
            </div>
            <div style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-3)', background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <p className="text-xs text-muted">原申請資訊</p>
              <p className="text-sm"><span className="text-muted">成員：</span>{editModal.profile?.display_name}</p>
              <p className="text-sm"><span className="text-muted">申請：</span>{editModal.item_name} ({formatTWD(editModal.requested_amount)})</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div className="form-group">
                <label className="form-label">申請項目名稱</label>
                <input type="text" className="form-input" value={editForm.item_name} onChange={e => setEditForm(f => ({ ...f, item_name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">審批狀態</label>
                <select className="form-input form-select" value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value as any }))}>
                  <option value="pending">待審批 (此操作將同步自動「刪除」關聯交易餘額)</option>
                  <option value="approved">已批准 (此操作將同步自動「新增或更新」關聯交易餘額)</option>
                  <option value="rejected">已拒絕 (此操作將同步自動「刪除」關聯交易餘額)</option>
                </select>
              </div>
              
              {editForm.status === 'approved' && (
                <>
                  <div className="form-group">
                    <label className="form-label">批准金額</label>
                    <input type="number" className="form-input" value={editForm.approved_amount} onChange={e => setEditForm(f => ({ ...f, approved_amount: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">到帳日期</label>
                    <input type="date" className="form-input" value={editForm.approved_date} onChange={e => setEditForm(f => ({ ...f, approved_date: e.target.value }))} />
                  </div>
                </>
              )}

              <div className="form-group">
                <label className="form-label">管理員備註</label>
                <input type="text" className="form-input" placeholder="拒絕原因或批准備註" value={editForm.admin_note} onChange={e => setEditForm(f => ({ ...f, admin_note: e.target.value }))} />
              </div>
              <div className="flex gap-3" style={{ justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
                <button className="btn btn-ghost" onClick={() => setEditModal(null)}>取消</button>
                <button className="btn btn-primary" onClick={handleSaveEdit} disabled={saving || !editForm.item_name} id="req-edit-save">
                  {saving ? '儲存中...' : '✓ 儲存變更'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 批量操作確認對話框 */}
      {batchAction && (
        <div className="modal-overlay" onClick={() => setBatchAction(null)}>
          <div className="modal" style={{ maxWidth: 450 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                {batchAction === 'approve' ? '✅ 批量批准' :
                 batchAction === 'reject' ? '❌ 批量拒絕' : '🗑️ 批量刪除'}
              </h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setBatchAction(null)}>✕</button>
            </div>
            <div style={{ marginBottom: 'var(--space-5)' }}>
              <p className="text-sm" style={{ marginBottom: 'var(--space-3)' }}>
                確定要對以下 {selectedIds.size} 項申請執行
                <strong>
                  {batchAction === 'approve' ? ' 批量批准' :
                   batchAction === 'reject' ? ' 批量拒絕' : ' 批量刪除'}
                </strong>
                操作？
              </p>
              {batchAction === 'approve' && (
                <div style={{ padding: '10px 14px', background: 'rgba(34,200,112,0.08)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: 'var(--status-success)' }}>
                  ℹ️ 批量批准將以申請金額（requested_amount）為準，到帳日設為各申請的所需日期（requested_date）。

                </div>
              )}
              {batchAction === 'delete' && (
                <div style={{ padding: '10px 14px', background: 'rgba(224,82,82,0.08)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: 'var(--status-error)' }}>
                  ⚠️ 刪除操作無法復原！若申請已批准，關聯交易將同步移除。
                </div>
              )}
              {batchAction === 'reject' && (
                <div style={{ padding: '10px 14px', background: 'rgba(245,166,35,0.08)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: 'var(--status-warning)' }}>
                  ℹ️ 批量拒絕將拒絕對話框中選取的所有待審批申請。
                </div>
              )}
            </div>
            <div className="flex gap-3" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setBatchAction(null)}>取消</button>
              <button className={`btn ${batchAction === 'approve' ? 'btn-success' : 'btn-danger'}`}
                onClick={executeBatchAction} disabled={saving} id={`req-batch-confirm-${batchAction}`}>
                {saving ? '處理中...' : '確認執行'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

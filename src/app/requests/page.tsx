'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase';
import { LakeRequest, Profile } from '@/types';
import { formatTWD } from '@/lib/predictions';
import { format, parseISO } from 'date-fns';
import { zhTW } from 'date-fns/locale';

export default function RequestsPage() {
  const { profile } = useAuth();
  const supabase = createClient();

  const [requests, setRequests] = useState<(LakeRequest & { profile?: Profile })[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [reviewModal, setReviewModal] = useState<LakeRequest | null>(null);
  const [reviewForm, setReviewForm]   = useState({ approved_amount: '', approved_date: '', admin_note: '' });
  const [saving, setSaving]     = useState(false);

  const load = useCallback(async () => {
    if (!profile?.family_id) return;
    setLoading(true);
    const { data } = await supabase
      .from('lake_requests')
      .select('*, profile:profiles(*)')
      .eq('family_id', profile.family_id)
      .order('created_at', { ascending: false });
    setRequests((data ?? []) as (LakeRequest & { profile?: Profile })[]);
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

    // 更新申請狀態
    await supabase.from('lake_requests').update({
      status: 'approved',
      approved_amount: approvedAmt,
      approved_date: reviewForm.approved_date,
      admin_note: reviewForm.admin_note,
      reviewed_at: new Date().toISOString(),
    }).eq('id', reviewModal.id);

    // 扣減湖泊餘額
    const { data: lake } = await supabase.from('lake').select('current_balance, id').eq('family_id', profile.family_id).single();
    const newBalance = Math.max(0, (lake?.current_balance ?? 0) - approvedAmt);
    await supabase.from('lake').update({ current_balance: newBalance }).eq('id', lake?.id);

    // 記錄交易
    await supabase.from('transactions').insert({
      family_id: profile.family_id,
      user_id: reviewModal.requester_id,
      type: 'lake_to_member',
      amount: approvedAmt,
      source: 'lake',
      destination: 'pond_b',
      reference_id: reviewModal.id,
      note: reviewModal.item_name,
      transaction_date: reviewForm.approved_date,
    });

    // 通知申請者
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

  const filtered = requests.filter(r => filter === 'all' || r.status === filter);

  const statusConfig: Record<string, { text: string; badge: string; icon: string }> = {
    pending:  { text: '待審批', badge: 'badge-warning', icon: '⏳' },
    approved: { text: '已批准', badge: 'badge-success', icon: '✅' },
    rejected: { text: '已拒絕', badge: 'badge-error',   icon: '❌' },
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">📋 湖泊調撥申請</h1>
        <p className="page-subtitle">
          {profile?.role === 'admin' ? '審批成員的湖泊資金申請' : '查看您的湖泊資金申請狀態'}
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
          {filtered.map((req) => {
            const sc = statusConfig[req.status] ?? statusConfig.pending;
            const isMe = req.requester_id === profile?.id;

            return (
              <div key={req.id} className="card" style={{ borderColor: req.status === 'pending' ? 'rgba(245,166,35,0.25)' : undefined }}>
                <div className="flex items-start justify-between flex-wrap gap-4">
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

                  {/* Admin Actions */}
                  {profile?.role === 'admin' && req.status === 'pending' && (
                    <button className="btn btn-primary btn-sm" onClick={() => openReview(req)} id={`req-review-${req.id}`}>
                      審批
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Review Modal (Admin Only) */}
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
                <label className="form-label">批准金額（可調整）</label>
                <input id="req-review-amount" type="number" className="form-input" value={reviewForm.approved_amount} onChange={e => setReviewForm(f => ({ ...f, approved_amount: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">到帳日期</label>
                <input id="req-review-date" type="date" className="form-input" value={reviewForm.approved_date} onChange={e => setReviewForm(f => ({ ...f, approved_date: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">備註（可選）</label>
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
    </div>
  );
}

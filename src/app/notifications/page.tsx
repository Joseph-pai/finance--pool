'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase';
import { Notification } from '@/types';
import { format, parseISO } from 'date-fns';
import { zhTW } from 'date-fns/locale';

export default function NotificationsPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setNotifications((data ?? []) as Notification[]);
    setLoading(false);
  }, [profile?.id, supabase]);

  useEffect(() => { load(); }, [load]);

  const markAllRead = async () => {
    if (!profile?.id) return;
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', profile.id).eq('is_read', false);
    load();
  };

  const markRead = async (id: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifications(ns => ns.map(n => n.id === id ? { ...n, is_read: true } : n));
  };

  const typeIcon: Record<string, string> = {
    lake_request:     '📋',
    request_approved: '✅',
    request_rejected: '❌',
    income_reminder:  '💰',
    lake_warning:     '⚠️',
    dry_warning:      '🚨',
    member_update:    '👥',
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div className="page-container">
      <div className="page-header flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title">
            🔔 通知
            {unreadCount > 0 && (
              <span style={{ marginLeft: 10, background: 'var(--status-error)', color: 'white', fontSize: '0.75rem', fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-full)' }}>
                {unreadCount}
              </span>
            )}
          </h1>
          <p className="page-subtitle">您的所有通知記錄</p>
        </div>
        {unreadCount > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={markAllRead} id="notif-mark-all-read">全部標為已讀</button>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 70, borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : notifications.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">🔔</span>
          <p className="empty-state-title">目前沒有通知</p>
          <p className="empty-state-desc">系統通知將顯示在這裡</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {notifications.map((n) => (
            <div
              key={n.id}
              className="card card-sm"
              onClick={() => !n.is_read && markRead(n.id)}
              id={`notif-${n.id}`}
              style={{
                cursor: !n.is_read ? 'pointer' : 'default',
                borderColor: !n.is_read ? 'rgba(99,179,237,0.3)' : undefined,
                background: !n.is_read ? 'rgba(99,179,237,0.04)' : undefined,
              }}
            >
              <div className="flex gap-3 items-start">
                <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>{typeIcon[n.type] ?? '📣'}</span>
                <div style={{ flex: 1 }}>
                  <div className="flex items-center gap-2" style={{ marginBottom: 2 }}>
                    <span className="font-semibold text-sm">{n.title}</span>
                    {!n.is_read && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--status-info)', flexShrink: 0 }} />}
                  </div>
                  <p className="text-sm text-secondary">{n.message}</p>
                  <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                    {format(parseISO(n.created_at), 'yyyy/MM/dd HH:mm', { locale: zhTW })}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

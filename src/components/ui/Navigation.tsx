'use client';

import { usePathname, useRouter } from 'next/navigation';

const navItems = [
  {
    href: '/dashboard',
    label: '總覽',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        <polyline points="9,22 9,12 15,12 15,22" />
      </svg>
    ),
  },
  {
    href: '/my-ponds',
    label: '我的池塘',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <ellipse cx="12" cy="16" rx="9" ry="5" />
        <ellipse cx="12" cy="12" rx="9" ry="5" />
        <ellipse cx="12" cy="8"  rx="9" ry="5" />
      </svg>
    ),
  },
  {
    href: '/income',
    label: '收入',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <line x1="12" y1="19" x2="12" y2="5" />
        <polyline points="5,12 12,5 19,12" />
        <line x1="5" y1="19" x2="19" y2="19" />
      </svg>
    ),
  },
  {
    href: '/expenses',
    label: '支出',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <line x1="12" y1="5" x2="12" y2="19" />
        <polyline points="19,12 12,19 5,12" />
        <line x1="5" y1="5" x2="19" y2="5" />
      </svg>
    ),
  },
  {
    href: '/requests',
    label: '申請',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14,2 14,8 20,8" />
        <line x1="12" y1="18" x2="12" y2="12" />
        <line x1="9"  y1="15" x2="15" y2="15" />
      </svg>
    ),
  },
];

const moreItems = [
  {
    href: '/lake',
    label: '湖泊管理',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
        <path d="M6.5 10.5q1.5-2 3 0t3 0 3 0" />
        <path d="M6.5 14.5q1.5-2 3 0t3 0 3 0" />
      </svg>
    ),
  },
  {
    href: '/notifications',
    label: '通知',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 01-3.46 0" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: '設定',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav className="bottom-nav">
      {navItems.map((item) => (
        <button
          key={item.href}
          className={`bottom-nav-item ${pathname === item.href || pathname.startsWith(item.href + '/') ? 'active' : ''}`}
          onClick={() => router.push(item.href)}
          id={`nav-${item.href.replace('/', '')}`}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
      <button
        className={`bottom-nav-item ${['/lake','/notifications','/settings'].some(p => pathname.startsWith(p)) ? 'active' : ''}`}
        onClick={() => router.push('/settings')}
        id="nav-more"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <circle cx="5" cy="12" r="1.5" fill="currentColor" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          <circle cx="19" cy="12" r="1.5" fill="currentColor" />
        </svg>
        <span>更多</span>
      </button>
    </nav>
  );
}

export function Sidebar({ role }: { role?: string }) {
  const pathname = usePathname();
  const router = useRouter();

  const allItems = [
    ...navItems,
    ...(role === 'admin' ? moreItems : moreItems.filter(i => i.href !== '/lake')),
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        Family<span>Pool</span>
      </div>
      <nav style={{ flex: 1 }}>
        {allItems.map((item) => (
          <button
            key={item.href}
            className={`nav-item w-full ${pathname === item.href || pathname.startsWith(item.href + '/') ? 'active' : ''}`}
            onClick={() => router.push(item.href)}
            style={{ textAlign: 'left' }}
            id={`sidebar-${item.href.replace('/', '')}`}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

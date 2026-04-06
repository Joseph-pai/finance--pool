'use client';

import { useState, useRef } from 'react';

interface TooltipProps {
  text: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'right';
}

export function Tooltip({ text, children, position = 'top' }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(true);
  };

  const hide = () => {
    timerRef.current = setTimeout(() => setVisible(false), 120);
  };

  const positionStyle: React.CSSProperties =
    position === 'top'
      ? { bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)' }
      : position === 'bottom'
      ? { top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)' }
      : { left: 'calc(100% + 8px)', top: '50%', transform: 'translateY(-50%)' };

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            ...positionStyle,
            zIndex: 9999,
            background: 'rgba(15,20,30,0.95)',
            color: '#d1d8e8',
            fontSize: '0.75rem',
            lineHeight: 1.5,
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            whiteSpace: 'nowrap',
            maxWidth: 240,
            pointerEvents: 'none',
            backdropFilter: 'blur(8px)',
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

/** 帶 ℹ️ 圖示的 label tooltip，放在 form-label 旁邊 */
export function LabelTooltip({ text }: { text: string }) {
  return (
    <Tooltip text={text} position="right">
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: 'rgba(99,179,237,0.15)',
          color: 'var(--text-accent)',
          fontSize: '0.65rem',
          fontWeight: 700,
          cursor: 'help',
          marginLeft: 6,
          flexShrink: 0,
          border: '1px solid rgba(99,179,237,0.25)',
        }}
        tabIndex={0}
        aria-label={`說明：${text}`}
      >
        i
      </span>
    </Tooltip>
  );
}

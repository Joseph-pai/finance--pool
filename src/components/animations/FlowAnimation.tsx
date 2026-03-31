'use client';

import { useEffect, useRef } from 'react';

interface FlowAnimationProps {
  from: 'pond-a' | 'lake';
  to: 'lake' | 'pond-b';
  active: boolean;
  amount?: string;
}

export default function FlowAnimation({ from, to, active, amount }: FlowAnimationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const progressRef = useRef(0);

  useEffect(() => {
    if (!active) {
      cancelAnimationFrame(animRef.current);
      progressRef.current = 0;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const W = canvas.width = canvas.offsetWidth;
      const H = canvas.height = canvas.offsetHeight;
      ctx.clearRect(0, 0, W, H);

      const startX = from === 'pond-a' ? W * 0.15 : W * 0.85;
      const endX   = to   === 'lake'   ? W * 0.5  : W * 0.85;
      const midY   = H * 0.5;
      const ctrlX  = (startX + endX) / 2;
      const ctrlY  = from === 'pond-a' ? H * 0.15 : H * 0.85;

      // Draw flow path (dashed line)
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX, midY);
      ctx.quadraticCurveTo(ctrlX, ctrlY, endX, midY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw animated droplets along path
      for (let i = 0; i < 3; i++) {
        const t = ((progressRef.current + i * 0.33) % 1);
        const x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * ctrlX + t * t * endX;
        const y = (1 - t) * (1 - t) * midY   + 2 * (1 - t) * t * ctrlY  + t * t * midY;
        const alpha = t < 0.1 ? t * 10 : t > 0.9 ? (1 - t) * 10 : 1;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(99,179,237,${alpha * 0.9})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(99,179,237,${alpha * 0.2})`;
        ctx.fill();
      }

      progressRef.current = (progressRef.current + 0.008) % 1;
      animRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [active, from, to]);

  if (!active) return null;

  return (
    <div style={{ position: 'relative' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: 80 }} />
      {amount && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'rgba(14,30,55,0.8)', borderRadius: 'var(--radius-full)', padding: '2px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-accent)', border: '1px solid var(--color-border)' }}>
          {amount}
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useRef } from 'react';

interface WaterWaveProps {
  level: number;           // 0–100 水位百分比
  variant?: 'lake' | 'pond-a' | 'pond-b';
  height?: number;         // 容器高度 px（預設 200）
  showPercent?: boolean;
  label?: string;
  amount?: string;
  warningLevel?: 'safe' | 'warning' | 'danger' | 'critical';
}

export default function WaterWave({
  level,
  variant = 'lake',
  height = 200,
  showPercent = false,
  label,
  amount,
  warningLevel = 'safe',
}: WaterWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const offsetRef = useRef(0);

  const colors: Record<string, { wave: string; fill: string; glow: string }> = {
    lake: {
      wave: warningLevel === 'critical' ? 'rgba(192,57,43,0.9)'
          : warningLevel === 'danger'   ? 'rgba(224,112,33,0.9)'
          : warningLevel === 'warning'  ? 'rgba(212,148,58,0.9)'
          : 'rgba(33,150,243,0.9)',
      fill: warningLevel === 'critical' ? 'rgba(192,57,43,0.6)'
          : warningLevel === 'danger'   ? 'rgba(224,112,33,0.6)'
          : warningLevel === 'warning'  ? 'rgba(212,148,58,0.6)'
          : 'rgba(26,111,181,0.6)',
      glow: warningLevel === 'critical' ? 'rgba(192,57,43,0.3)'
          : 'rgba(26,111,181,0.25)',
    },
    'pond-a': { wave: 'rgba(34,200,112,0.9)', fill: 'rgba(26,158,92,0.6)', glow: 'rgba(26,158,92,0.25)' },
    'pond-b': { wave: 'rgba(157,101,250,0.9)', fill: 'rgba(124,58,237,0.6)', glow: 'rgba(124,58,237,0.25)' },
  };

  const c = colors[variant] || colors.lake;
  const speed = warningLevel === 'critical' ? 0.04 : 0.018;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const W = canvas.width = canvas.offsetWidth;
      const H = canvas.height = canvas.offsetHeight;
      ctx.clearRect(0, 0, W, H);

      const fillH = (level / 100) * H;
      const waveAmpMain = Math.max(4, fillH * 0.06);
      const waveAmpSub  = waveAmpMain * 0.5;

      const drawWave = (amp: number, speed2: number, color: string, alpha: number) => {
        ctx.beginPath();
        ctx.moveTo(0, H);
        const waveY = H - fillH;
        for (let x = 0; x <= W; x++) {
          const y = waveY
            + Math.sin((x / W) * 2 * Math.PI * 2 + offsetRef.current * speed2) * amp
            + Math.sin((x / W) * 2 * Math.PI * 3 + offsetRef.current * 0.7) * (amp * 0.4);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W, H);
        ctx.lineTo(0, H);
        ctx.closePath();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;
      };

      drawWave(waveAmpSub, 1.3, c.fill, 0.7);
      drawWave(waveAmpMain, 1.0, c.wave, 0.9);

      // Glow at surface
      if (fillH > 10) {
        const grad = ctx.createLinearGradient(0, H - fillH - 12, 0, H - fillH + 8);
        grad.addColorStop(0, 'transparent');
        grad.addColorStop(0.5, c.glow);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(0, H - fillH - 12, W, 20);
      }

      offsetRef.current += speed;
      animRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [level, variant, warningLevel, c, speed]);

  return (
    <div style={{ position: 'relative', height, borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'rgba(0,0,0,0.25)' }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      {/* Info overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: '4px', zIndex: 1,
      }}>
        {label && (
          <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'rgba(255,255,255,0.7)' }}>
            {label}
          </span>
        )}
        {amount && (
          <span className="amount-display amount-large" style={{ color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,0.5)', fontSize: '1.8rem' }}>
            {amount}
          </span>
        )}
        {showPercent && (
          <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)' }}>
            {Math.round(level)}%
          </span>
        )}
      </div>
    </div>
  );
}

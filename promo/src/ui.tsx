import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, FONT } from './theme';

// Spring from 0 to 1 starting at `delay` frames.
export const useIn = (delay = 0, damping = 200) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping } });
};

export const FadeUp: React.FC<{ delay?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ delay = 0, children, style }) => {
  const p = useIn(delay);
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 30}px)`, ...style }}>{children}</div>;
};

export const Scene: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ position: 'absolute', inset: 0, background: C.bg, color: C.text, fontFamily: FONT, overflow: 'hidden', ...style }}>{children}</div>
);

// The caption-box mark from the app header.
export const Logo: React.FC<{ size: number; color?: string }> = ({ size, color = C.text }) => (
  <svg viewBox="0 0 30 22" width={size} height={(size * 22) / 30} style={{ color }}>
    <rect x="1" y="1" width="28" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
    <rect x="6" y="10" width="11" height="3" fill="currentColor" />
    <rect x="19" y="10" width="5" height="3" fill="currentColor" />
    <rect x="6" y="15" width="18" height="3" fill="currentColor" />
  </svg>
);

export const Kicker: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = C.yellow }) => (
  <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color }}>{children}</div>
);

export const Speaker: React.FC<{ size: number; waves?: number; color?: string }> = ({ size, waves = 1, color = 'currentColor' }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} style={{ color }}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
    <path d="M16 8.5a4.5 4.5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity={waves} />
  </svg>
);

const NAMES: Record<string, string> = { en: 'English', es: 'Español', pt: 'Português' };

export type Line = { text: string; at: number };

// The audience page, redrawn in its dark theme so lines can arrive live.
export const Phone: React.FC<{
  lines: Line[];
  lang: string;
  langs?: string[];
  listening?: boolean;
  scale?: number;
  highlight?: number; // 0..1 progress of the line being read aloud
}> = ({ lines, lang, langs = ['en', 'es', 'pt'], listening = false, scale = 1, highlight }) => {
  const frame = useCurrentFrame();
  const shown = lines.filter((l) => frame >= l.at);
  return (
    <div style={{ width: 430 * scale, height: 900 * scale, flexShrink: 0 }}>
      <div style={{ width: 430, height: 900, transform: `scale(${scale})`, transformOrigin: 'top left', borderRadius: 64, background: '#1f2022', padding: 14, boxShadow: '0 40px 120px rgba(0,0,0,.6), 0 0 0 2px #3a3c3f' }}>
        <div style={{ width: 402, height: 872, borderRadius: 52, overflow: 'hidden', background: C.bg, fontFamily: FONT, position: 'relative' }}>
          <div style={{ height: 44, background: '#000' }} />
          <div style={{ background: '#000', borderBottom: `4px solid ${C.link}`, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px 16px', fontSize: 19 }}>
            <span style={{ color: '#fff', textDecoration: 'underline' }}>‹ Salas</span>
            <b style={{ flex: 1, color: '#fff', whiteSpace: 'nowrap' }}>Sala A — Keynotes</b>
            <span style={{ color: C.live, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 13, height: 13, borderRadius: 7, background: C.live, display: 'inline-block' }} />
              {lang === 'pt' ? 'Ao vivo' : lang === 'en' ? 'Live' : 'En vivo'}
            </span>
          </div>
          <div style={{ padding: '8px 16px', borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: 'flex', gap: 14, fontSize: 18 }}>
              {langs.map((l) => (
                <span key={l} style={{ padding: '8px 4px', color: l === lang ? C.text : C.link, fontWeight: l === lang ? 700 : 400, textDecoration: l === lang ? 'none' : 'underline', borderBottom: `4px solid ${l === lang ? C.link : 'transparent'}` }}>{NAMES[l]}</span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, margin: '8px 0 6px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', border: `2px solid ${listening ? C.live : C.border}`, color: listening ? C.live : C.text, background: C.surface, borderRadius: 4, fontWeight: 700, fontSize: 18 }}>
                <Speaker size={20} waves={listening ? 1 : 0.35} />
                {lang === 'pt' ? 'Ouvir' : lang === 'en' ? 'Listen' : 'Escuchar'}
              </span>
              <span style={{ padding: '8px 16px', border: `2px solid ${C.border}`, background: C.surface, borderRadius: 4, fontWeight: 700, fontSize: 18 }}>{lang === 'pt' ? 'Ajustes' : lang === 'en' ? 'Settings' : 'Ajustes'}</span>
            </div>
          </div>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 210, bottom: 0, padding: '0 18px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', paddingTop: 22, overflow: 'hidden' }}>
            {shown.slice(-6).map((l, i, arr) => {
              const age = frame - l.at;
              const p = Math.min(1, age / 10);
              const last = i === arr.length - 1;
              return (
                <p key={l.text + l.at} style={{ margin: '0 0 16px', fontSize: 25, lineHeight: 1.45, color: last ? C.text : C.text2, opacity: p, transform: `translateY(${(1 - p) * 14}px)`, position: 'relative' }}>
                  {l.text}
                  {last && highlight !== undefined ? (
                    <span style={{ position: 'absolute', left: 0, bottom: -6, height: 4, width: `${highlight * 100}%`, background: C.live, borderRadius: 2 }} />
                  ) : null}
                </p>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export const Frame: React.FC<{ src: string; width: number; label?: string; delay?: number; style?: React.CSSProperties; radius?: number }> = ({ src, width, label, delay = 0, style, radius = 18 }) => {
  const p = useIn(delay);
  return (
    <div style={{ opacity: p, transform: `translateY(${(1 - p) * 40}px) scale(${0.96 + 0.04 * p})`, ...style }}>
      <img src={src} style={{ width, display: 'block', borderRadius: radius, boxShadow: '0 30px 90px rgba(0,0,0,.55), 0 0 0 2px #2c2e30' }} />
      {label ? <div style={{ marginTop: 22, fontSize: 32, fontWeight: 700 }}>{label}</div> : null}
    </div>
  );
};

export const Chip: React.FC<{ children: React.ReactNode; delay: number; color?: string }> = ({ children, delay, color = C.text }) => {
  const p = useIn(delay, 14);
  return (
    <div style={{ opacity: Math.min(1, p * 1.5), transform: `scale(${0.8 + 0.2 * p})`, padding: '20px 30px', border: `3px solid ${C.border}`, borderRadius: 10, background: C.surface, fontSize: 40, fontWeight: 700, color }}>{children}</div>
  );
};

export const typed = (text: string, frame: number, start: number, cps = 32) => {
  const n = Math.floor(interpolate(frame, [start, start + (text.length / cps) * 30], [0, text.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  return text.slice(0, n);
};

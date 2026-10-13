import React, { createContext, useContext } from "react";
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const C = {
  bg: "#0b1220",
  panel: "#131d33",
  panel2: "#1a2744",
  line: "#2a3a5c",
  text: "#e8eefc",
  muted: "#8fa3c7",
  green: "#22c55e",
  red: "#ef4444",
  amber: "#f59e0b",
  blue: "#3b82f6",
  purple: "#a855f7",
};
export const FONT = `-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif`;

export const LEVELS = {
  100: { name: "Foundations", color: C.green },
  200: { name: "Intermediate", color: C.blue },
  300: { name: "Technical Differentiators", color: C.purple },
  400: { name: "Capstone", color: C.amber },
} as const;

export type SceneCtx = {
  /** Frame, relative to the start of the scene, at which `phrase` starts being spoken. */
  at: (phrase: string, nth?: number) => number;
  /** Frame at which `phrase` has been fully spoken. */
  atEnd: (phrase: string, nth?: number) => number;
  accent: string;
};
const Ctx = createContext<SceneCtx>(null as unknown as SceneCtx);
export const SceneProvider = Ctx.Provider;
export const useScene = () => useContext(Ctx);

export const ease = (frame: number, start: number, dur = 18) =>
  interpolate(frame, [start, start + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });

export const useAppear = (start: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return frame < start ? 0 : spring({ frame: frame - start, fps, config: { damping: 13, stiffness: 150 } });
};

/** Fades and slides children in at `start`; optionally fades them out at `end`. */
export const Reveal: React.FC<{
  start: number;
  end?: number;
  dx?: number;
  dy?: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({ start, end, dx = 0, dy = 24, style, children }) => {
  const frame = useCurrentFrame();
  const e = ease(frame, start);
  const out = end === undefined ? 1 : 1 - ease(frame, end, 12);
  return (
    <div style={{ opacity: e * out, transform: `translate(${(1 - e) * dx}px, ${(1 - e) * dy}px)`, ...style }}>{children}</div>
  );
};

/** Bounces children in at `start` with a spring. */
export const Pop: React.FC<{ start: number; end?: number; style?: React.CSSProperties; children?: React.ReactNode }> = ({ start, end, style, children }) => {
  const frame = useCurrentFrame();
  const s = useAppear(start);
  const out = end === undefined ? 1 : 1 - ease(frame, end, 10);
  return <div style={{ opacity: Math.min(1, s * 2) * out, transform: `scale(${s})`, ...style }}>{children}</div>;
};

export const Emoji: React.FC<{ size: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ size, children, style }) => (
  <span style={{ fontSize: size, lineHeight: 1, ...style }}>{children}</span>
);

export const Card: React.FC<{ style?: React.CSSProperties; children?: React.ReactNode }> = ({ style, children }) => (
  <div style={{ background: C.panel, border: `2px solid ${C.line}`, borderRadius: 28, padding: "28px 34px", ...style }}>{children}</div>
);

/** Big scene headline, top of the content area. */
export const Headline: React.FC<{ start?: number; children: React.ReactNode; sub?: string; subStart?: number }> = ({ start = 6, children, sub, subStart }) => {
  const { accent } = useScene();
  return (
    <div style={{ position: "absolute", top: 150, left: 0, right: 0, textAlign: "center" }}>
      <Reveal start={start} dy={-18}>
        <div style={{ fontSize: 76, fontWeight: 800, color: C.text, letterSpacing: -1 }}>
          {children}
        </div>
      </Reveal>
      {sub && (
        <Reveal start={subStart ?? start + 10} dy={10}>
          <div style={{ fontSize: 36, color: accent, fontWeight: 600, marginTop: 8 }}>{sub}</div>
        </Reveal>
      )}
    </div>
  );
};

/** A conveyor belt with moving stripes. */
export const Belt: React.FC<{ x: number; y: number; width: number; speed?: number; progress?: number; offset?: number }> = ({ x, y, width, speed = 6, progress = 1, offset }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", left: x, top: y, width: width * progress, opacity: progress > 0.02 ? 1 : 0, height: 26, borderRadius: 13, overflow: "hidden", background: C.panel2, border: `2px solid ${C.line}` }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `repeating-linear-gradient(115deg, transparent 0 22px, ${C.line} 22px 30px)`,
          backgroundPosition: `${offset ?? frame * speed}px 0`,
        }}
      />
    </div>
  );
};

/** A labelled stop on the line. */
export const Station: React.FC<{ x: number; y: number; icon: React.ReactNode; label: string; start: number; color?: string; active?: boolean; w?: number; sub?: { text: string; start: number }; tint?: string }> = ({
  x, y, icon, label, start, color, active, w = 270, sub, tint,
}) => {
  const { accent } = useScene();
  const c = color ?? accent;
  return (
    <Pop start={start} style={{ position: "absolute", left: x - w / 2, top: y, width: w }}>
      <div
        style={{
          background: C.panel,
          border: `3px solid ${active ? c : tint ?? C.line}`,
          boxShadow: active ? `0 0 40px ${c}55` : "none",
          borderRadius: 26,
          padding: "22px 12px",
          textAlign: "center",
        }}
      >
        <Emoji size={78}>{icon}</Emoji>
        <div style={{ fontSize: 34, fontWeight: 700, color: C.text, marginTop: 12, whiteSpace: "nowrap" }}>{label}</div>
        {sub && (
          <Reveal start={sub.start} dy={6}>
            <div style={{ fontSize: 26, fontWeight: 600, color: C.muted, marginTop: 4, whiteSpace: "nowrap" }}>{sub.text}</div>
          </Reveal>
        )}
      </div>
    </Pop>
  );
};

export const Bubble: React.FC<{
  start: number;
  end?: number;
  x: number;
  y: number;
  children: React.ReactNode;
  color?: string;
  /** Frame at which a red strike-through is drawn across the bubble. */
  crossAt?: number;
  style?: React.CSSProperties;
}> = ({ start, end, x, y, children, color = C.text, crossAt, style }) => {
  const frame = useCurrentFrame();
  return (
    <Pop start={start} end={end} style={{ position: "absolute", left: x, top: y, ...style }}>
      <div style={{ position: "relative", background: C.panel2, border: `2px solid ${C.line}`, borderRadius: 22, padding: "14px 24px", fontSize: 32, fontWeight: 600, color, whiteSpace: "nowrap" }}>
        {children}
        {crossAt !== undefined && (
          <div style={{ position: "absolute", left: 0, top: "50%", height: 6, marginTop: -3, borderRadius: 3, background: C.red, width: `${ease(frame, crossAt, 10) * 100}%` }} />
        )}
      </div>
    </Pop>
  );
};

/** Red strike-through that draws left to right. */
export const Strike: React.FC<{ start: number; width: number; top: number; left?: number }> = ({ start, width, top, left = 0 }) => {
  const frame = useCurrentFrame();
  return <div style={{ position: "absolute", left, top, height: 8, borderRadius: 4, background: C.red, width: width * ease(frame, start, 10) }} />;
};

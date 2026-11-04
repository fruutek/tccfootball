import { useState, type ReactNode } from 'react';
import type { Result } from '../shared/stats';
import { hueFrom, initials } from '../lib/format';

/* ------------------------------------------------------------------ icons */

type IconProps = { className?: string };
const cx = (c?: string) => (c ? `ico ${c}` : 'ico');
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const IconBall = ({ className }: IconProps) => (
  <svg {...base} className={cx(className)}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M12 7.2l3.9 2.8-1.5 4.6H9.6L8.1 10 12 7.2z" fill="currentColor" stroke="none" />
    <path d="M12 7.2V2.6M15.9 10l4.4-1.4M14.4 14.6l2.7 3.8M9.6 14.6l-2.7 3.8M8.1 10L3.7 8.6" />
  </svg>
);
export const IconAssist = ({ className }: IconProps) => (
  <svg {...base} className={cx(className)}>
    <circle cx="5" cy="17" r="2.2" fill="currentColor" stroke="none" />
    <path d="M7 15.5C10 8 14 7 19 7M15.5 3.5L19.5 7l-3.5 4" />
  </svg>
);
export const IconStar = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={cx(className)}>
    <path d="M12 2.2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.8l1.4-6.8L2.2 9.3l6.9-.8L12 2.2z" />
  </svg>
);
export const IconPin = ({ className }: IconProps) => (
  <svg {...base} className={cx(className)}>
    <path d="M12 21s7-6.2 7-11.5A7 7 0 005 9.5C5 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.4" />
  </svg>
);
export const IconClock = ({ className }: IconProps) => (
  <svg {...base} className={cx(className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.2l3.4 2" />
  </svg>
);
export const IconArrow = ({ className }: IconProps) => (
  <svg {...base} className={cx(className)} width="16" height="16">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const IconHome = ({ className }: IconProps) => (
  <svg {...base} className={cx(className)}>
    <path d="M3.5 11L12 3.5 20.5 11V20a1 1 0 01-1 1H15v-6H9v6H4.5a1 1 0 01-1-1v-9z" />
  </svg>
);
export const IconResults = ({ className }: IconProps) => (
  <svg {...base} className={cx(className)}>
    <rect x="3.5" y="4.5" width="17" height="16" rx="1.5" />
    <path d="M3.5 9.5h17M8 2.8v3.4M16 2.8v3.4M8 14h3M8 17h6" />
  </svg>
);
export const IconPlayers = ({ className }: IconProps) => (
  <svg {...base} className={cx(className)}>
    <circle cx="9" cy="8" r="3.4" />
    <path d="M2.8 20c.4-3.6 3-5.6 6.2-5.6s5.8 2 6.2 5.6" />
    <path d="M16 4.8a3.2 3.2 0 010 6.2M18.2 14.8c1.8.8 2.8 2.4 3 5.2" />
  </svg>
);
export const IconTable = ({ className }: IconProps) => (
  <svg {...base} className={cx(className)}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);
export const IconNews = ({ className }: IconProps) => (
  <svg {...base} className={cx(className)}>
    <path d="M5 4.5h11a1 1 0 011 1V20H6a2 2 0 01-2-2V5.5a1 1 0 011-1z" />
    <path d="M17 9h3v9a2 2 0 01-2 2M8 8.5h6M8 12h6M8 15.5h4" />
  </svg>
);
export const PitchMark = ({ className }: IconProps) => (
  <svg viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden className={className}>
    <circle cx="100" cy="100" r="52" />
    <circle cx="100" cy="100" r="4" fill="currentColor" />
    <path d="M100 0v200" />
  </svg>
);

/** Full-bleed faint pitch markings behind the scoreboard. */
export const PitchBackdrop = () => (
  <svg className="board__pitch" viewBox="0 0 600 260" preserveAspectRatio="xMidYMid slice" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M300 0v260" />
    <circle cx="300" cy="130" r="62" />
    <circle cx="300" cy="130" r="3" fill="currentColor" />
    <path d="M0 70h70v120H0M600 70h-70v120h70" />
    <path d="M0 105h26v50H0M600 105h-26v50h26" />
  </svg>
);

/* ----------------------------------------------------------------- avatar */

export function Avatar({ id, name, photo, size = 40, className = '' }: { id: string; name: string; photo?: string | undefined; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const hue = hueFrom(id);
  const style = { '--h': hue, '--s': `${size}px` } as React.CSSProperties;
  return (
    <span className={`avatar ${className}`} style={style} role="img" aria-label={name}>
      {photo && !failed ? <img src={photo} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(true)} /> : initials(name)}
    </span>
  );
}

/* ------------------------------------------------------------------ form */

/** Results oldest → newest, left to right (the order you read a run of form). */
export function FormStrip({ form, small }: { form: Result[]; small?: boolean }) {
  if (form.length === 0) return <span className="faint">—</span>;
  const chrono = [...form].reverse();
  return (
    <span className={`form ${small ? 'form--sm' : ''}`} aria-label={`Recent form, oldest to newest: ${chrono.join(' ')}`}>
      {chrono.map((r, i) => (
        <i key={i} className={r}>
          {r}
        </i>
      ))}
    </span>
  );
}

export const ResultBadge = ({ r }: { r: Result }) => (
  <span className={`badge ${r}`} title={r === 'W' ? 'Win' : r === 'D' ? 'Draw' : 'Loss'}>
    {r}
  </span>
);

/* ----------------------------------------------------------------- layout */

export function SectionHead({ title, href, linkLabel = 'View all' }: { title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="sec-head">
      <h2>{title}</h2>
      {href && (
        <a href={href}>
          {linkLabel} →
        </a>
      )}
    </div>
  );
}

export function Empty({ title, children, icon = <IconBall /> }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty card">
      {icon}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <div className="skel" style={{ height: 280 }} />
      <div className="two-col">
        <div className="skel" style={{ height: 220 }} />
        <div className="skel" style={{ height: 220 }} />
      </div>
    </div>
  );
}

export const DemoTag = () => <span className="tag tag--demo">Demo</span>;

import React from 'react';
import { Loader2 } from 'lucide-react';

export function Button({
  children,
  variant = 'default',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger' }) {
  const styles: Record<string, string> = {
    default: 'bg-elevated border border-border-default text-text-primary hover:border-border-strong',
    primary: 'bg-accent text-white hover:bg-accent-hover border border-transparent',
    ghost: 'bg-transparent text-text-secondary hover:bg-elevated border border-transparent',
    danger: 'bg-transparent text-error hover:bg-error/10 border border-error/40',
  };
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-md text-[13px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface border border-border-subtle rounded-lg ${className}`}>{children}</div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-text-secondary text-[13px]">
      <Loader2 size={16} className="animate-spin" />
      {label && <span>{label}</span>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-8 gap-3">
      {icon && <div className="text-text-tertiary">{icon}</div>}
      <div className="text-subhead font-semibold text-text-primary">{title}</div>
      {children && <div className="text-[13px] text-text-secondary max-w-md leading-relaxed">{children}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'success' | 'warning' | 'error' | 'accent' }) {
  const tones: Record<string, string> = {
    default: 'bg-elevated text-text-secondary border-border-default',
    success: 'bg-success/15 text-success border-success/30',
    warning: 'bg-warning/15 text-warning border-warning/30',
    error: 'bg-error/15 text-error border-error/30',
    accent: 'bg-accent/15 text-accent border-accent/30',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-caption font-medium border ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function SectionHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div>
        <h1 className="text-title font-semibold">{title}</h1>
        {subtitle && <p className="text-[13px] text-text-secondary mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

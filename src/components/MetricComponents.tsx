import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  trend?: string;
  trendDirection?: "up" | "down" | "flat";
}

export function StatCard({ label, value, subtitle, trend, trendDirection }: StatCardProps) {
  const trendClass = trendDirection ? ` ${trendDirection}` : "";
  return (
    <div className="metric-stat-card">
      <div className="metric-stat-card-label">{label}</div>
      <div className="metric-stat-card-value">{value}</div>
      {subtitle && <div className="metric-stat-card-subtitle">{subtitle}</div>}
      {trend && <div className={`metric-stat-card-trend${trendClass}`}>{trend}</div>}
    </div>
  );
}

interface MetricSectionProps {
  children: ReactNode;
  title?: string;
}

export function MetricSection({ children, title }: MetricSectionProps) {
  return (
    <div className="metric-section">
      {title && <div className="metric-section-title">{title}</div>}
      {children}
    </div>
  );
}

interface MetricRowProps {
  children: ReactNode;
}

export function MetricRow({ children }: MetricRowProps) {
  return <div className="metric-row">{children}</div>;
}

interface MetricTextProps {
  children: ReactNode;
}

export function MetricText({ children }: MetricTextProps) {
  return <p className="metric-text">{children}</p>;
}

interface MetricNoteProps {
  children: ReactNode;
}

export function MetricNote({ children }: MetricNoteProps) {
  return <p className="metric-note">{children}</p>;
}

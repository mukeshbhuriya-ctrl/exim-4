import { cn } from '@/lib/utils'
import { TrendingUp, TrendingDown } from 'lucide-react'

/**
 * KPI stat card for dashboards — shows a metric with optional icon,
 * trend indicator, and subtitle.
 * Pure Tailwind + Lucide — zero AntD.
 */
export default function StatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  trendValue,
  color = 'var(--exim-primary)',
  onClick,
  style,
  className,
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'relative overflow-hidden rounded-lg border border-slate-200 bg-white p-5',
        onClick && 'cursor-pointer transition-colors duration-200 hover:bg-slate-50 hover:border-slate-300',
        className,
      )}
      style={style}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {title}
          </div>
          <div className="mt-2 text-[28px] font-bold leading-none tracking-tight text-slate-900">
            {value ?? '—'}
          </div>
          {subtitle && (
            <div className="mt-1.5 text-[13px] text-slate-400">
              {subtitle}
            </div>
          )}
          {trend != null && (
            <div className={cn(
              'mt-2 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-semibold',
              trend === 'up' && 'bg-emerald-50 text-emerald-600',
              trend === 'down' && 'bg-red-50 text-red-600',
              trend !== 'up' && trend !== 'down' && 'bg-slate-100 text-slate-500',
            )}>
              {trend === 'up' ? <TrendingUp className="h-3 w-3" /> : trend === 'down' ? <TrendingDown className="h-3 w-3" /> : null}
              {trendValue}
            </div>
          )}
        </div>
        {icon && (
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-xl"
            style={{ background: color === 'var(--exim-success)' ? '#ECFDF5' : color === 'var(--exim-warning)' ? '#FFFBEB' : color === 'var(--exim-error)' ? '#FEF2F2' : '#F0F4FF', color }}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}

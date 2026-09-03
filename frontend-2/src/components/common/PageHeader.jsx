import { cn } from '@/lib/utils'

/**
 * PageHeader — title, optional description, and action buttons.
 * Used at the top of every page inside AppShell.
 * Pure Tailwind — no AntD dependency.
 */
export default function PageHeader({ title, description, actions, breadcrumbs, className }) {
  return (
    <div className={cn('mb-4', className)}>
      {breadcrumbs?.length ? (
        <div className="mb-1 flex items-center gap-1 flex-wrap">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              {i > 0 && <span className="text-xs text-slate-300">/</span>}
              <span
                className={cn(
                  'text-xs',
                  i === breadcrumbs.length - 1
                    ? 'font-medium text-slate-900'
                    : 'text-slate-400',
                )}
              >
                {crumb}
              </span>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold tracking-tight text-slate-900 leading-tight">
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 text-[13px] text-slate-500 leading-relaxed">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2 flex-wrap">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  )
}

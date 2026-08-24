import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons'

/**
 * KPI stat card for dashboards — shows a metric with optional icon,
 * trend indicator, and subtitle.
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
}) {
  const bgLight = color === 'var(--exim-success)' ? 'var(--exim-success-light)'
    : color === 'var(--exim-warning)' ? 'var(--exim-warning-light)'
    : color === 'var(--exim-error)' ? 'var(--exim-error-light)'
    : 'var(--exim-primary-50)'

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--exim-surface)',
        border: '1px solid var(--exim-border-light)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 24px',
        flex: '1 1 220px',
        minWidth: 200,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all var(--transition-base)',
        boxShadow: 'var(--shadow-xs)',
        position: 'relative',
        overflow: 'hidden',
        ...(onClick ? {} : {}),
        ...style,
      }}
      onMouseEnter={(e) => {
        if (onClick) {
          e.currentTarget.style.boxShadow = 'var(--shadow-md)'
          e.currentTarget.style.transform = 'translateY(-2px)'
          e.currentTarget.style.borderColor = 'var(--exim-primary-100)'
        }
      }}
      onMouseLeave={(e) => {
        if (onClick) {
          e.currentTarget.style.boxShadow = 'var(--shadow-xs)'
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.borderColor = 'var(--exim-border-light)'
        }
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--exim-text-secondary)',
            marginBottom: 8,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            {title}
          </div>
          <div style={{
            fontSize: 28,
            fontWeight: 700,
            color: 'var(--exim-text-primary)',
            lineHeight: 1.1,
            letterSpacing: '-0.5px',
          }}>
            {value ?? '—'}
          </div>
          {subtitle ? (
            <div style={{
              fontSize: 13,
              color: 'var(--exim-text-muted)',
              marginTop: 6,
            }}>
              {subtitle}
            </div>
          ) : null}
          {trend != null && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              marginTop: 8,
              fontSize: 12,
              fontWeight: 600,
              color: trend === 'up' ? 'var(--exim-success)' : trend === 'down' ? 'var(--exim-error)' : 'var(--exim-text-muted)',
              background: trend === 'up' ? 'var(--exim-success-light)' : trend === 'down' ? 'var(--exim-error-light)' : 'var(--exim-gray-100)',
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
            }}>
              {trend === 'up' ? <ArrowUpOutlined style={{ fontSize: 10 }} /> : trend === 'down' ? <ArrowDownOutlined style={{ fontSize: 10 }} /> : null}
              {trendValue}
            </div>
          )}
        </div>
        {icon ? (
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 'var(--radius-md)',
            background: bgLight,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: color,
            fontSize: 20,
            flexShrink: 0,
          }}>
            {icon}
          </div>
        ) : null}
      </div>
    </div>
  )
}

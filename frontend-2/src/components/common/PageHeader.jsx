import { Typography } from 'antd'

const { Text } = Typography

/**
 * Page header — title, optional description, and action buttons.
 * Used at the top of every page inside AppShell.
 */
export default function PageHeader({ title, description, actions, breadcrumbs }) {
  return (
    <div className="exim-fade-in" style={{ marginBottom: 12 }}>
      {breadcrumbs?.length ? (
        <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {breadcrumbs.map((crumb, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {i > 0 && (
                <span style={{ color: 'var(--exim-gray-300)', fontSize: 12 }}>/</span>
              )}
              <Text
                style={{
                  fontSize: 12,
                  color: i === breadcrumbs.length - 1 ? 'var(--exim-text-primary)' : 'var(--exim-text-muted)',
                  fontWeight: i === breadcrumbs.length - 1 ? 500 : 400,
                }}
              >
                {crumb}
              </Text>
            </span>
          ))}
        </div>
      ) : null}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 style={{
            fontSize: 20,
            fontWeight: 700,
            color: 'var(--exim-text-primary)',
            lineHeight: 1.1,
            margin: 0,
            letterSpacing: '-0.3px',
          }}>
            {title}
          </h2>
          {description ? (
            <Text style={{
              color: 'var(--exim-text-secondary)',
              fontSize: 13,
              marginTop: 2,
              display: 'block',
            }}>
              {description}
            </Text>
          ) : null}
        </div>
        {actions ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flexShrink: 0, alignItems: 'center' }}>
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  )
}

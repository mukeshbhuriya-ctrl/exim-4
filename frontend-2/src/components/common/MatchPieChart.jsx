import { Typography } from 'antd'

const { Text } = Typography

const SLICE_META = [
  { key: 'matched', label: 'Matched', color: '#059669' },
  { key: 'unmatched', label: 'Unmatched', color: '#DC2626' },
  { key: 'partially_matched', label: 'Partially matched', color: '#D97706' },
]

export default function MatchPieChart({ stats, onSliceClick, size = 180 }) {
  const slices = SLICE_META.map((meta) => ({
    ...meta,
    value: Number(stats?.[meta.key]) || 0,
  })).filter((slice) => slice.value > 0)

  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  const cx = size / 2
  const cy = size / 2
  const strokeWidth = Math.max(28, Math.round(size * 0.16))
  const radius = size / 2 - strokeWidth / 2 - 2
  const circumference = 2 * Math.PI * radius

  let offset = 0
  const rings = slices.map((slice) => {
    const length = (slice.value / total) * circumference
    const ring = {
      ...slice,
      dasharray: `${length} ${circumference - length}`,
      dashoffset: -offset,
    }
    offset += length
    return ring
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, minWidth: size }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        {total > 0 ? (
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            role="img"
            aria-label="Match status pie chart"
            style={{ display: 'block' }}
          >
            <g transform={`rotate(-90 ${cx} ${cy})`}>
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke="#F0F1F3"
                strokeWidth={strokeWidth}
              />
              {rings.map((ring) => (
                <circle
                  key={ring.key}
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill="none"
                  stroke={ring.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={ring.dasharray}
                  strokeDashoffset={ring.dashoffset}
                  strokeLinecap="butt"
                  style={{ cursor: onSliceClick ? 'pointer' : 'default' }}
                  onClick={() => onSliceClick?.(ring.key, ring.label)}
                />
              ))}
            </g>
          </svg>
        ) : (
          <div
            style={{
              width: size,
              height: size,
              borderRadius: '50%',
              background: 'var(--exim-gray-100)',
              border: '1px dashed var(--exim-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text type="secondary" style={{ fontSize: 12 }}>
              No data
            </Text>
          </div>
        )}
        {total > 0 ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--exim-text-primary)', lineHeight: 1 }}>
                {total}
              </div>
              <div style={{ fontSize: 11, color: 'var(--exim-text-muted)', marginTop: 4 }}>Total</div>
            </div>
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
        {SLICE_META.map((meta) => {
          const value = Number(stats?.[meta.key]) || 0
          return (
            <button
              key={meta.key}
              type="button"
              onClick={() => onSliceClick?.(meta.key, meta.label)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                border: 'none',
                background: 'transparent',
                padding: '2px 0',
                cursor: onSliceClick ? 'pointer' : 'default',
                textAlign: 'left',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: meta.color,
                    flexShrink: 0,
                  }}
                />
                <Text style={{ fontSize: 12 }}>{meta.label}</Text>
              </span>
              <Text strong style={{ fontSize: 12 }}>
                {value}
              </Text>
            </button>
          )
        })}
      </div>
    </div>
  )
}

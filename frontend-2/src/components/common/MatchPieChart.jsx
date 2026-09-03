/**
 * Match status pie chart — SVG donut with interactive slices.
 * Pure React + Tailwind — zero AntD.
 */

const SLICE_META = [
  { key: 'matched', label: 'Matched', color: '#10B981' },
  { key: 'unmatched', label: 'Unmatched', color: '#EF4444' },
  { key: 'partially_matched', label: 'Partially matched', color: '#F59E0B' },
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
    const ring = { ...slice, dasharray: `${length} ${circumference - length}`, dashoffset: -offset }
    offset += length
    return ring
  })

  return (
    <div className="flex flex-col items-center gap-3" style={{ minWidth: size }}>
      <div className="relative" style={{ width: size, height: size }}>
        {total > 0 ? (
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Match status pie chart" className="block">
            <g transform={`rotate(-90 ${cx} ${cy})`}>
              <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#F1F5F9" strokeWidth={strokeWidth} />
              {rings.map((ring) => (
                <circle
                  key={ring.key} cx={cx} cy={cy} r={radius} fill="none"
                  stroke={ring.color} strokeWidth={strokeWidth}
                  strokeDasharray={ring.dasharray} strokeDashoffset={ring.dashoffset}
                  strokeLinecap="butt"
                  className={onSliceClick ? 'cursor-pointer transition-opacity hover:opacity-80' : ''}
                  onClick={() => onSliceClick?.(ring.key, ring.label)}
                />
              ))}
            </g>
          </svg>
        ) : (
          <div className="flex items-center justify-center rounded-full border border-dashed border-slate-200 bg-slate-50" style={{ width: size, height: size }}>
            <span className="text-xs text-slate-400">No data</span>
          </div>
        )}
        {total > 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="text-[22px] font-bold leading-none text-slate-900">{total}</div>
              <div className="mt-1 text-[11px] text-slate-400">Total</div>
            </div>
          </div>
        )}
      </div>
      <div className="flex w-full flex-col gap-1.5">
        {SLICE_META.map((meta) => {
          const value = Number(stats?.[meta.key]) || 0
          return (
            <button
              key={meta.key} type="button"
              onClick={() => onSliceClick?.(meta.key, meta.label)}
              className="flex items-center justify-between gap-2 rounded-md border-none bg-transparent px-0 py-0.5 text-left transition-colors hover:bg-slate-50"
              style={{ cursor: onSliceClick ? 'pointer' : 'default' }}
            >
              <span className="inline-flex items-center gap-2 min-w-0">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: meta.color }} />
                <span className="text-xs text-slate-500">{meta.label}</span>
              </span>
              <span className="text-xs font-semibold text-slate-700">{value}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

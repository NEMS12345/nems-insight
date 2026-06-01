export interface BarChartDatum {
  label: string;
  value: number;
}

/**
 * Minimal, dependency-free SVG bar chart. Pure presentation: it takes already-computed
 * points (from the analytics core) and draws them. No charting library needed for v1.
 */
export function BarChart({
  data,
  unit = "",
  height = 160,
}: {
  data: BarChartDatum[];
  unit?: string;
  height?: number;
}) {
  if (data.length === 0) {
    return <p className="text-sm text-foreground/50">No data to chart.</p>;
  }

  const width = 720;
  const padding = { top: 8, right: 8, bottom: 28, left: 8 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  const barW = plotW / data.length;
  const labelEvery = Math.ceil(data.length / 8);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      preserveAspectRatio="none"
    >
      {data.map((d, i) => {
        const h = (d.value / max) * plotH;
        const x = padding.left + i * barW;
        const y = padding.top + (plotH - h);
        return (
          <g key={i}>
            <rect
              x={x + barW * 0.1}
              y={y}
              width={barW * 0.8}
              height={Math.max(h, 0)}
              fill="#171717"
            >
              <title>{`${d.label}: ${d.value.toLocaleString("en-AU", {
                maximumFractionDigits: 2,
              })} ${unit}`}</title>
            </rect>
            {i % labelEvery === 0 && (
              <text
                x={x + barW / 2}
                y={height - 10}
                fontSize="10"
                fill="#a1a1aa"
                textAnchor="middle"
              >
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

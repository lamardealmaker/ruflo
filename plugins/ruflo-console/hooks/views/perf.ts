import type { RenderElement } from 'claude-code'

import { isPerfResult, PERF, perfMemo, sparkline } from '../perf'
import { ago, col, row, rule, text, THEME, type Ctx } from './common'
import { COST_KEY, entryRow, naRow, resultRows } from './secure'

/** One latency series: its name, the line of blocks, and its newest, lowest and highest sample. */
function seriesRow(ctx: Ctx, key: string, name: string, values: readonly number[], empty: string): RenderElement {
  if (values.length === 0) return text(ctx, ` ${name.padEnd(12)} ${empty}`, { dimColor: true })

  const width = Math.max(8, Math.min(40, ctx.columns - 50))
  const shown = values.slice(-width)
  const fmt = (value: number) => `${value.toFixed(3)}ms`

  return row(
    ctx,
    [
      ctx.kit.Text({ color: THEME.info, children: ` ${name.padEnd(12)} ` }),
      ctx.kit.Text({ bold: true, color: THEME.ok, children: sparkline(shown, width) }),
      ctx.kit.Text({ dimColor: true, wrap: 'truncate-end', children: ` now ${fmt(shown[shown.length - 1] ?? 0)} · min ${fmt(Math.min(...shown))} · max ${fmt(Math.max(...shown))} · ${shown.length} samples` }),
    ],
    key,
  )
}

/**
 * Performance: a latency sparkline per series (each `metrics` run adds a sample; `report` reads the stored history),
 * every measuring verb by cost, and the last run's output. Nothing runs on open.
 */
export function perfView(ctx: Ctx): RenderElement {
  const memo = perfMemo(ctx.state)
  const rows: RenderElement[] = [
    rule(ctx, 'Latency', memo.atMs === 0 ? 'no sample yet' : `last sample ${ago(memo.atMs, ctx.nowMs)}${memo.heapMb !== null ? ` · heap ${memo.heapMb.toFixed(1)} MB` : ''}`),
    seriesRow(ctx, 'spark-loop', 'event loop', memo.loop, '▸ METRICS adds one sample per run (in-process, $0)'),
    seriesRow(ctx, 'spark-report', 'report', memo.report, '▸ REPORT reads the stored history of .claude-flow/performance/metrics.json'),
    rule(ctx, 'Measure', 'local · in-process or a probe file'),
  ]

  for (const entry of PERF) rows.push(entryRow(ctx, entry))
  rows.push(naRow(ctx, 'CLI BOTTLENECK', '`performance bottleneck` and `optimize` print a fixed table: the MCP tools above measure'))
  rows.push(naRow(ctx, 'MCP METRICS', '`performance_metrics` reports fixed latency figures, so the sparkline reads `metrics` instead'))
  rows.push(text(ctx, COST_KEY, { dimColor: true }))
  rows.push(...resultRows(ctx, isPerfResult))

  return col(ctx, rows, 'perf')
}

/** This view's result block alone: the pane asks for it to place under the row that was clicked. */
export const perfResult = (ctx: Ctx): RenderElement[] => resultRows(ctx, isPerfResult)

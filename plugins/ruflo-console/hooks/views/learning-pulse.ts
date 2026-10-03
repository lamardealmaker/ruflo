import type { RenderElement } from 'claude-code'

import { gauge, sparkline } from '../memory-lines'
import { count, rule, row, text, THEME, type Ctx } from './common'
import { stagesOf } from './frames'

/** One step of the animation every 160 ms; nothing moves while the pane is hidden (the frame loop stops). */
const beat = (ctx: Ctx, ms: number): number => Math.floor(ctx.nowMs / ms)

/**
 * The learning pulse: text charts that move while the pane is open. A marker travels the pipeline (RETRIEVE → JUDGE → DISTILL →
 * CONSOLIDATE), the router's model mix is a bar chart with a highlight that sweeps along each bar, and the success rate is a sparkline
 * with a scanning cursor. They draw what was measured and nothing else: no data, no chart.
 */
export function pulseRows(ctx: Ctx): RenderElement[] {
  const { state } = ctx
  const rows: RenderElement[] = [rule(ctx, 'Learning pulse', 'live: the marker moves, the data is what ruflo measured')]
  const stages = stagesOf(state)
  const at = beat(ctx, 700) % Math.max(1, stages.length)

  rows.push(
    row(
      ctx,
      stages.flatMap((stage, i) => [
        ctx.kit.Text({ bold: i === at, color: i === at ? THEME.warn : THEME.info, children: ` ${i === at ? '●' : '○'} ${stage.name} ${stage.count ?? 'n/a'}` }),
        ...(i < stages.length - 1 ? [ctx.kit.Text({ dimColor: true, children: ' ━━' })] : []),
      ]),
      'pulse-pipeline',
    ),
  )

  const router = state.snapshot?.router ?? null
  const mix = router?.distribution.filter(entry => entry.count > 0) ?? []

  if (mix.length > 0) {
    const top = Math.max(...mix.map(entry => entry.count))
    const width = Math.max(8, Math.min(32, ctx.columns - 36))
    const sweep = beat(ctx, 160)

    for (const entry of mix.slice(0, 6)) {
      const bar = gauge(entry.count, top, width).split('')
      const filled = bar.filter(cell => cell === '█').length

      if (filled > 1) bar[sweep % filled] = '▓'
      rows.push(text(ctx, ` ${entry.model.slice(0, 14).padEnd(14)} ${bar.join('')} ${count(entry.count)}`, { color: THEME.ok }))
    }
  } else rows.push(text(ctx, ' model mix: n/a — no .swarm/model-router-state.json', { dimColor: true }))

  const points = state.snapshot?.outcomes?.points ?? []

  if (points.length > 1) {
    // Running success rate over the last 24 outcomes, as eight-level bars; the cursor sweeps left to right.
    const window = points.slice(-24)
    const rates = window.map((_, i) => Math.round((window.slice(0, i + 1).filter(point => point.ok).length / (i + 1)) * 8))
    const bars = sparkline(rates.map(rate => rate + 1)).split('')

    bars[beat(ctx, 200) % bars.length] = '┃'
    rows.push(text(ctx, ` success ${bars.join('')}  ${window.filter(point => point.ok).length}/${window.length} of the last ${window.length}`, { color: THEME.ok }))
  } else rows.push(text(ctx, ' success rate: n/a — fewer than two routed outcomes', { dimColor: true }))

  const neural = state.snapshot?.neural ?? null

  if (neural !== null) {
    const sizes = { trajectories: neural.trajectories ?? 0, patterns: neural.patterns ?? 0, signals: neural.signals ?? 0 }
    const top = Math.max(1, sizes.trajectories, sizes.patterns, sizes.signals)

    for (const [name, value] of Object.entries(sizes)) rows.push(text(ctx, ` ${name.padEnd(14)} ${gauge(value, top, 24)} ${count(value)}`, { color: THEME.info }))
  }

  return rows
}

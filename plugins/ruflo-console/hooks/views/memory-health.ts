import type { RenderElement } from 'claude-code'

import { analyseHealth, HEALTH_CAP, type HealthReport, type HealthSample, NEAR_JACCARD, PAIR_CAP, STALE_DAYS } from '../data/memory-health'
import { gauge } from '../memory-lines'
import { ago, button, clip, confirmHere, count, kv, live, row, sourceLine, text, THEME, type Ctx } from './common'

/** The probe id the integrator registers (data/memory-health.ts memoryHealthProbe). */
export const HEALTH_PROBE = 'memory-health'
/** Clusters and stale entries drawn at once; the counts above are exact, the lists are bounded and say so. */
const SHOW_CLUSTERS = 5
const SHOW_STALE = 5

const share = (part: number, whole: number): string => (whole <= 0 ? 'n/a' : `${Math.round((part / whole) * 100)}%`)

/** What limits the figures, in one line: the list cap, the pair budget, and what was left out. Never omitted. */
export function limitsLine(report: HealthReport, total: number | undefined): string {
  const listCut = total !== undefined && total > report.analysed ? ` of ${count(total)} stored (the newest ${HEALTH_CAP} are read)` : ''
  const pairs = report.isTruncated ? `pair budget ${count(PAIR_CAP)} reached: only the newest ${report.entriesCompared} entries were compared` : `${count(report.pairsCompared)} of ${count(report.pairsPossible)} pairs compared`

  return `${report.analysed} entries${listCut} · ${pairs} · from key and size only, no values read`
}

function summaryRows(ctx: Ctx, report: HealthReport, total: number | undefined): RenderElement[] {
  const width = Math.max(8, Math.min(24, ctx.columns - 50))

  return [
    text(ctx, ` ${limitsLine(report, total)}`, report.isTruncated ? { color: THEME.warn } : { dimColor: true }),
    kv(ctx, 'duplicates', `${gauge(report.duplicateEntries, report.analysed, width)} ${report.duplicateEntries} entries in ${report.clusterCount} cluster${report.clusterCount === 1 ? '' : 's'} (${share(report.duplicateEntries, report.analysed)})`, report.clusterCount === 0 ? THEME.ok : THEME.warn),
    kv(ctx, 'stale', `${gauge(report.staleCount, report.analysed, width)} ${report.staleCount} never recalled and not updated for ${STALE_DAYS}d (${share(report.staleCount, report.analysed)})`, report.staleCount === 0 ? THEME.ok : THEME.warn),
    kv(ctx, 'never recalled', `${report.neverRecalledEntries} of ${report.analysed} entries have an access count of 0 · ${report.neverRecalledNamespaces.length} whole namespace${report.neverRecalledNamespaces.length === 1 ? '' : 's'}`),
  ]
}

function clusterRows(ctx: Ctx, report: HealthReport): RenderElement[] {
  if (report.clusterCount === 0) return [text(ctx, ` no duplicate or near-duplicate keys among these entries (near = key words ≥ ${Math.round(NEAR_JACCARD * 100)}% alike and a close size)`, { color: THEME.ok })]

  const rows: RenderElement[] = []

  for (const cluster of report.clusters.slice(0, SHOW_CLUSTERS)) {
    const names = cluster.members.slice(0, 3).map(member => `${member.namespace}/${member.key}`).join(' · ')
    const more = cluster.size > 3 ? ` +${cluster.size - 3}` : ''

    rows.push(row(ctx, [ctx.kit.Text({ bold: true, color: cluster.kind === 'exact' ? THEME.bad : THEME.warn, children: ` ${cluster.kind === 'exact' ? 'same ' : 'near '}×${cluster.size} ` }), text(ctx, clip(`${names}${more}`, Math.max(10, ctx.columns - 14)), { color: THEME.info })]))
  }

  if (report.clusterCount > SHOW_CLUSTERS) rows.push(text(ctx, `   +${report.clusterCount - SHOW_CLUSTERS} more cluster${report.clusterCount - SHOW_CLUSTERS === 1 ? '' : 's'} not drawn (the counts above include them)`, { dimColor: true }))

  return rows
}

function staleRows(ctx: Ctx, report: HealthReport): RenderElement[] {
  const rows = report.stale.slice(0, SHOW_STALE).map(entry => text(ctx, ` ${clip(`${entry.namespace}/${entry.key}`, Math.max(10, ctx.columns - 24))}  updated ${ago(entry.updatedAtMs, ctx.nowMs)}`, { color: THEME.warn }))

  if (report.staleCount > SHOW_STALE) rows.push(text(ctx, `   +${report.staleCount - SHOW_STALE} more, oldest shown first`, { dimColor: true }))
  if (rows.length === 0) rows.push(text(ctx, ` no entry is both unrecalled and ${STALE_DAYS}+ days untouched`, { color: THEME.ok }))

  return rows
}

function namespaceRows(ctx: Ctx, report: HealthReport): RenderElement[] {
  const width = Math.max(6, Math.min(20, ctx.columns - 60))
  const rows = report.namespaces.slice(0, 8).map(space =>
    row(ctx, [
      ctx.kit.Text({ color: space.isNeverRecalled ? THEME.warn : THEME.info, children: ` ${clip(space.name, 18).padEnd(19)}` }),
      ctx.kit.Text({ dimColor: true, children: `${gauge(space.recalled, space.count, width)} ${space.recalled}/${space.count} recalled${space.stale > 0 ? ` · ${space.stale} stale` : ''}${space.isNeverRecalled ? ' · never recalled' : ''}` }),
    ]),
  )

  if (report.namespaces.length > 8) rows.push(text(ctx, `   +${report.namespaces.length - 8} smaller namespaces not drawn`, { dimColor: true }))

  return rows
}

/**
 * Consolidate runs the existing AgentDB consolidate (mem-consolidate) behind the lab's confirm card. Its answer is drawn
 * here, so the person who pressed it sees it: the run is raised under the AgentDB group and re-homed to this section.
 */
function consolidateRows(ctx: Ctx): RenderElement[] {
  const lab = ctx.state.memoryLab
  const press = () => {
    ctx.act.memory.run('mem-consolidate')
    lab.origin = 'health'
  }

  return [
    row(ctx, [
      button(ctx, 'mem-health-consolidate', '▸ consolidate', press, { primary: true }),
      text(ctx, ' asks first · merges across tiers, never deletes these keys (DELETE does)', { dimColor: true }),
    ]),
    ...(lab.origin === 'health' ? confirmHere(ctx, 'mem:agentdb') : []),
  ]
}

/**
 * The analysis is O(pairs) (up to PAIR_CAP, ~100 ms at the cap) and the view renders every frame, so it is computed once per
 * probe result and per minute (the stale cutoff is the only thing the clock changes), never per frame.
 */
const reports = new WeakMap<HealthSample, { minute: number; report: HealthReport }>()

export function reportFor(sample: HealthSample, nowMs: number): HealthReport {
  const minute = Math.floor(nowMs / 60_000)
  const cached = reports.get(sample)

  if (cached !== undefined && cached.minute === minute) return cached.report

  const report = analyseHealth(sample, nowMs)

  reports.set(sample, { minute, report })

  return report
}

/** The health section's rows, or one honest line when the probe has not answered. */
export function healthRows(ctx: Ctx, now: () => number = () => ctx.nowMs): RenderElement[] {
  const result = ctx.state.probes.get(HEALTH_PROBE)
  const sample = live<HealthSample>(result)

  if (sample === null) return [text(ctx, ` ${sourceLine(result, ctx.nowMs, 'memory health (memory list)').text}${result === undefined ? ' (the health probe is not registered in this build)' : ''}`, { dimColor: true })]

  if (sample.entries.length === 0) return [text(ctx, ' no entries to analyse: store one, or import your Claude memories (IMPORT CLAUDE)', { dimColor: true })]

  const report = reportFor(sample, now())
  const total = live<{ total?: number }>(ctx.state.probes.get('memory'))?.total

  return [
    ...summaryRows(ctx, report, total),
    text(ctx, ' duplicate clusters', { bold: true, color: THEME.head }),
    ...clusterRows(ctx, report),
    text(ctx, ' stale entries', { bold: true, color: THEME.head }),
    ...staleRows(ctx, report),
    text(ctx, ' recall by namespace', { bold: true, color: THEME.head }),
    ...namespaceRows(ctx, report),
    ...consolidateRows(ctx),
  ]
}

import type { RenderElement } from 'claude-code'

import { money, type Mission } from '../data/missions'
import { ago, kv, rule, text, THEME, type Ctx } from './common'

const STATE_COLOR: Record<string, string> = { running: THEME.warn, verifying: THEME.warn, completed: THEME.ok, failed: THEME.bad, blocked: THEME.bad, paused: THEME.info, queued: THEME.info }

/** Task status as recorded by the runtime, in words that never claim more: only evidence is verified. */
const TASK_GLYPH: Record<string, string> = { pending: '○', running: '◐', 'recorded-done': '●', failed: '✖', unknown: '?' }

function missionRows(ctx: Ctx, mission: Mission, isFirst: boolean): RenderElement[] {
  const budget = mission.budget
  const rows: RenderElement[] = [
    text(ctx, `${isFirst ? '▸' : ' '} ${mission.objective || '(no objective)'}`, { bold: true, ...(STATE_COLOR[mission.state] !== undefined && { color: STATE_COLOR[mission.state] }) }),
    text(
      ctx,
      `    ${mission.state} · rev ${mission.revision} · ${mission.executionMode === 'session-bound' ? 'session-bound (runs only while a session drives it)' : mission.executionMode} · ${mission.id}`,
      { dimColor: true },
    ),
    text(
      ctx,
      `    plan rev ${mission.plan.revision}: ${mission.plan.taskCount === 0 ? 'no tasks yet' : mission.plan.tasks.map(task => `${TASK_GLYPH[task.status] ?? '?'} ${task.id}`).join(' → ')}${mission.plan.taskCount > mission.plan.tasks.length ? ` (+${mission.plan.taskCount - mission.plan.tasks.length})` : ''}`,
    ),
    text(
      ctx,
      `    evidence ${mission.evidence.verified}/${mission.evidence.count} verified · budget ${budget === null ? 'none' : `${money(budget.settledMinor, budget.currency)} settled, ${money(budget.reservedMinor, budget.currency)} reserved of ${money(budget.ceilingMinor, budget.currency)} (estimate ${money(budget.estimatedMinor, budget.currency)})`}`,
      { dimColor: true },
    ),
  ]

  if (mission.executor !== null) rows.push(text(ctx, `    executor ${mission.executor.connection} (seen ${ago(mission.executor.observedAtMs, ctx.nowMs)}; not connected is not failed)`, { dimColor: true }))
  if (mission.blockedReason !== undefined) rows.push(text(ctx, `    blocked: ${mission.blockedReason}`, { color: THEME.bad }))
  if (mission.unresolvedOperations > 0) rows.push(text(ctx, `    ${mission.unresolvedOperations} operation(s) unresolved`, { color: THEME.warn }))

  return rows
}

/**
 * ADR-406 missions, observed only: what `.claude-flow/missions/observation.json` says, as of its own `observedAt`. The
 * console takes no mission action here; those go through `ruflo mission action` (a button is never authorization).
 */
export function observationRows(ctx: Ctx): RenderElement[] {
  const observation = ctx.state.snapshot?.missions ?? null
  const rows: RenderElement[] = [rule(ctx, 'Mission record', observation === null ? 'no observation' : `${observation.missions.length}${observation.isTruncated ? '+' : ''} · observed ${ago(observation.observedAtMs, ctx.nowMs)}`)]

  if (observation === null) {
    rows.push(text(ctx, ' No mission record yet (ADR-406): create one from a goal in Plan.', { color: THEME.warn }))

    return rows
  }

  if (observation.missions.length === 0) rows.push(text(ctx, 'No missions yet.', { dimColor: true }))

  const ordered = [...observation.missions].sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0))

  ordered.slice(0, 6).forEach((mission, i) => rows.push(...missionRows(ctx, mission, i === 0)))

  if (ordered.length > 6) rows.push(text(ctx, `+${ordered.length - 6} more`, { dimColor: true }))

  rows.push(kv(ctx, 'legend', '○ pending · ◐ running · ● recorded done (recorded, not verified) · ✖ failed'))
  rows.push(text(ctx, 'observation only: actions go through `npx ruflo mission action` with a request id and the expected revision', { dimColor: true }))

  return rows
}

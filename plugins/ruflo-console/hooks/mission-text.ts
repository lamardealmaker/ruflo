/** Mission Control as text for the transcript: the plan, the status, and what a headless `/ruflo run mission-…` answers. */
import { lifecycleOf, type Plan, stageOf } from './goap'
import { activeMission, derive, mcOf, nextTask, progressOf } from './mission-control'
import type { State } from './state'

/** The plan as text for the transcript (`/ruflo plan <goal>`): phases, waves and what each step must show. */
export function planText(p: Plan, goal: string): string {
  const lines = [`SPARC plan (${p.profile}, ${p.rigor}) for: ${goal}`, `${p.steps.length} tasks · cost ${p.totalCost} · critical path ${p.criticalCost} · ${p.waves.length} waves`, `lifecycle: ${lifecycleOf(p).map(entry => entry.stage).join(' → ')}`]

  for (const [i, wave] of p.waves.entries()) {
    lines.push(`wave ${i + 1}:`)

    for (const id of wave) {
      const step = p.steps.find(candidate => candidate.id === id)

      if (step !== undefined) lines.push(`  ${step.id} [${stageOf(step.action)}] ${step.action.title}${step.dependsOn.length > 0 ? ` (after ${step.dependsOn.join(', ')})` : ''} — ${step.action.agent}`)
    }
  }

  return lines.join('\n')
}

/** The active mission's state for the transcript: progress, each task's status from the ruflo task store, and what is next. */
export function statusText(state: State): string {
  const mission = activeMission(state)

  if (mission === null) return 'No active mission. /ruflo plan <goal> shows a SPARC plan; the Missions view creates the mission from it.'

  const tasks = state.snapshot?.tasks ?? []
  const status = derive(mission, tasks)
  const { done, total } = progressOf(mission, tasks)
  const next = nextTask(mission, tasks)
  const lines = [`Mission ${mission.id}: ${mission.objective}`, `${mission.cancelled ? 'cancelled' : mission.paused ? 'paused' : done === total ? 'complete' : 'running'} · ${done}/${total} tasks done${mission.auto ? ' · auto-run on' : ''}`]

  for (const task of mission.tasks) lines.push(`  ${task.id} ${status.get(task.id) ?? '?'} — ${task.title} (${task.agent})`)

  lines.push(next === null ? 'next: nothing to hand out now' : `next: ${next.id} ${next.title} (/ruflo run mission-next hands it to Claude)`)

  return lines.join('\n')
}

/** What a headless `/ruflo run mission-<verb>` answers, or null for an id that is not a mission one. */
export function missionAnswer(state: State, paletteId: string | null): string | null {
  if (paletteId === null || !paletteId.startsWith('mission-')) return null

  const mc = mcOf(state)

  if (paletteId === 'mission-goal') return mc.planned === null ? 'type a goal after the id: /ruflo plan <goal>' : planText(mc.planned, mc.goal)
  if (paletteId === 'mission-status') return statusText(state)

  return mc.last === null ? null : `${mc.last.ok ? '✓' : '✗'} ${mc.last.label}${mc.last.detail === '' ? '' : ` — ${mc.last.detail}`}`
}

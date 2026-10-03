/**
 * The band above the prompt: one row saying what is happening here now, with a mark that pulses while Claude works.
 * Parts come most-urgent first, so a narrow band truncates the least useful ones: what needs a person, who is
 * working on what (and for how long), the AI terminal's runs, the newest event while it is fresh; only then the
 * standing context (claims, this session's spend). With nothing happening it says so, and when it last did.
 * Each part is a fact on disk or n/a; a part with nothing to say is left out rather than shown as zero.
 */
import { activeMission, derive, progressOf } from '../mission-control'
import type { RenderElement } from 'claude-code'

import { alertsOf, approvalsOf } from '../data/alerts'
import { agentLabels } from '../data/parse'
import type { State, ViewId } from '../state'
import { ago, clip, type Kit } from './common'

export const BAR_KEY = 'mark'

/** One part of the band: its words, how loud, and the view a click on it opens. */
export type BarPart = { text: string; tone: 'attention' | 'live' | 'plain'; go?: ViewId }

/** How long an event counts as "now" on the band. */
const FRESH_MS = 60_000

const since = (atMs: number | undefined, nowMs: number): string => (atMs === undefined ? '' : ` ${ago(atMs, nowMs).replace(' ago', '')}`)

/** Who is working, each on what: the agent's in-progress task, or just "working". At most two, then a count. */
function workingParts(state: State, nowMs: number): BarPart[] {
  const snap = state.snapshot

  if (snap === null) return []

  const busy = snap.agents.filter(agent => /busy|active|working/i.test(agent.status))
  const labels = agentLabels(snap.agents)
  const parts = busy.slice(0, 2).map(agent => {
    const task = snap.tasks.find(entry => entry.assignedTo.includes(agent.id) && /progress|running|active/i.test(entry.status))
    const what = task !== undefined ? ` on ${clip(task.description || task.type, 40)}` : ' working'
    const span = state.statusLog.get(agent.id)?.at(-1)?.atMs

    return { text: `▶ ${labels.get(agent.id) ?? agent.type}${what}${since(span, nowMs)}`, tone: 'live' as const, go: 'swarm' as const }
  })

  if (busy.length > 2) parts.push({ text: `+${busy.length - 2} more working`, tone: 'live', go: 'swarm' })

  return parts
}

/** Dollars a person reads at a glance: cents under $100, whole dollars with separators above. */
export function money(usd: number): string {
  return usd < 100 ? `$${usd.toFixed(2)}` : `$${Math.round(usd).toLocaleString('en-US')}`
}

/** The active mission as a band part: progress and the running task, or paused; none when there is no mission, or it is done or cancelled. */
export function missionPart(state: State): BarPart | null {
  const mission = activeMission(state)

  if (mission === null || mission.cancelled) return null

  const tasks = state.snapshot?.tasks ?? []
  const { done, total } = progressOf(mission, tasks)
  const status = derive(mission, tasks)
  const running = mission.tasks.find(task => status.get(task.id) === 'running')

  if (total === 0 || done >= total) return null

  return { text: `🎯 ${done}/${total}${mission.paused ? ' paused' : running !== undefined ? ` · ${running.id} ${clip(running.title, 28)}` : ''} (1)`, tone: running !== undefined ? 'live' : 'plain', go: 'missions' }
}

export function barParts(state: State, nowMs: number = Date.now()): BarPart[] {
  const snap = state.snapshot
  const parts: BarPart[] = []

  // What needs a person: approvals waiting and warn/bad alerts. Info alerts (a claim held for days) stay in the pane.
  const approvals = approvalsOf(state).length
  const alerts = alertsOf(state, nowMs, state.loadedAtMs).filter(alert => alert.level !== 'info').length

  if (approvals > 0) parts.push({ text: `${approvals} to approve (q)`, tone: 'attention', go: 'approvals' })
  if (alerts > 0) parts.push({ text: `⚠ ${alerts} alert${alerts === 1 ? '' : 's'}`, tone: 'attention', go: 'overview' })

  // The active mission: how far along, and the task Claude is on (or that it is paused); a click opens Mission Control.
  const missing = missionPart(state)

  if (missing !== null) parts.push(missing)

  // What is happening now: agents at work, the AI terminal's runs, and the newest event while it is fresh.
  parts.push(...workingParts(state, nowMs))

  for (const [agent, run] of state.terminal.runs) parts.push({ text: `💻 ${agent} answering${since(run.startedAtMs, nowMs)}`, tone: 'live', go: 'terminal' })

  const latest = state.events.at(-1)
  const isFresh = latest !== undefined && nowMs - latest.atMs < FRESH_MS

  if (isFresh) parts.push({ text: `${clip(latest.text, 44)} ·${since(latest.atMs, nowMs)} ago`, tone: 'plain', go: 'events' })

  // Nothing moving: say so, with how many agents stand ready and when something last happened.
  if (!parts.some(part => part.tone === 'live') && !isFresh && snap?.swarm != null) {
    const ready = snap.agents.length

    parts.push({ text: `${ready > 0 ? `idle · ${ready} agent${ready === 1 ? '' : 's'} ready` : 'swarm, no agents'}${latest !== undefined ? ` · last activity${since(latest.atMs, nowMs)} ago` : ''}`, tone: 'plain', go: 'swarm' })
  }

  // Standing context last: claims held, this session's spend.
  const claims = snap?.claims ?? []

  if (claims.length > 0) {
    const stealable = claims.filter(claim => claim.isStealable).length

    parts.push({ text: `${claims.length} claim${claims.length === 1 ? '' : 's'}${stealable > 0 ? ` (${stealable} stealable)` : ''}`, tone: 'plain', go: 'claims' })
  }

  if (state.usage?.costUsd !== undefined && state.usage.costUsd >= 0.01) parts.push({ text: `${money(state.usage.costUsd)} this session`, tone: 'plain', go: 'cost' })

  return parts
}

/** The band's words, for `/ruflo status` and anything that wants it as one line. */
export function barText(state: State, nowMs: number = Date.now()): string {
  return ['ruflo', ...barParts(state, nowMs).map(part => part.text)].join(' · ')
}

/**
 * The band. Each part is a link: a click opens the console on the view it is about (approvals, the swarm, the
 * terminal, the event stream, claims, cost). `onGo` opens the console there; `onOpen` opens it as it was.
 */
export function barView(kit: Kit, state: State, columns: number, mark: RenderElement | null, onOpen: () => void, onGo?: (view: ViewId) => void): RenderElement {
  // A stale marketplace clone is one of the alerts, so it already turns the band's attention part on.
  const parts = barParts(state)
  let room = Math.max(8, columns - (state.pane.isOpen ? 4 : 22))
  const children: RenderElement[] = [mark !== null ? mark : kit.Text({ color: 'claude', children: '◆ ' }), kit.Text({ dimColor: true, children: 'ruflo' })]

  room -= 5

  for (const [i, part] of parts.entries()) {
    const words = part.text

    if (room <= 6) break
    children.push(kit.Text({ dimColor: true, children: ' · ' }))

    const go = part.go

    // Attention and live parts keep their colour; a part with somewhere to go is a button to it.
    if (go !== undefined && onGo !== undefined && part.tone === 'plain') {
      children.push(kit.Button({ key: `band-${i}`, label: clip(words, room - 3), plain: true, dimColor: true, onPress: () => onGo(go) }))
    } else if (go !== undefined && onGo !== undefined) {
      children.push(kit.Button({ key: `band-${i}`, label: clip(words, room - 3), plain: true, onPress: () => onGo(go) }))
    } else {
      children.push(kit.Text({ wrap: 'truncate-end', ...(part.tone === 'attention' ? { color: 'warning' } : part.tone === 'live' ? { color: 'success' } : { dimColor: true }), children: clip(words, room - 3) }))
    }

    room -= words.length + 3
  }

  if (!state.pane.isOpen) children.push(kit.Text({ children: '  ' }), kit.Button({ key: 'open-console', label: 'open console', plain: true, onPress: onOpen }))

  return kit.Box({ flexDirection: 'row', children })
}

/**
 * What the Workflows page's buttons call (ADR-464). Keys move the cursor through the pure reducer in data/workflows-nav;
 * the one write the page has, stopping or spawning a ruflo agent, goes through the runner's confirm card as a fixed argv.
 * Nothing in THIS file stops or messages a running Claude Code workflow: that is the control tab (views/wf-control.ts, ADR-465), which calls the engine's own tools through the host.
 */
import type { ActionSpec } from './actions'
import { walk, type WfKey, type WfUi } from './data/workflows-nav'
import type { Host } from './host'
import type { Runner } from './runner'
import type { State } from './state'
import { workflowsModelOf } from './wf-live'
import { DETAIL_TAB, slotsFor } from './views/wf-slots'

export type WorkflowsActions = {
  /** j k h l [ ] Enter Escape, as the page's reducer reads them. */
  key: (key: WfKey) => void
  /** Goes to the inspector tab `id` (`detail` or a registered slot tab); an unknown id falls back to `detail`. */
  tab: (id: string) => void
  /** Merges a change into the cursor (for a slot's key handler), then redraws. */
  setUi: (patch: Partial<WfUi>) => void
  /** Asks to run a spec (the confirm card shows its exact command); a null spec says `why`. */
  ask: (spec: ActionSpec | null, why?: string) => void
  /** Names a transcript's path on the footer outcome row, after checking it is inside the config directory's projects folder. */
  show: (path: string) => void
}

/** True for a path under `<configDir>/projects/` with no `..` part: the only place a run's files live. */
export function isRunPath(path: string, configDir: string | null): boolean {
  if (configDir === null || path.includes('\0') || path.split('/').includes('..')) return false

  return path.startsWith(`${configDir.replace(/\/+$/, '')}/projects/`)
}

export function workflowsActions(state: State, host: Host, runner: Runner): WorkflowsActions {
  return {
    key: key => {
      const model = workflowsModelOf(state, Date.now())

      state.wf.ui = walk(state.wf.ui, model?.runs ?? [], key)
      // Closing the inspector, or moving to another agent, goes back to the page's own tab.
      if (key === 'escape' || key === 'enter' || key === '[' || key === ']') state.wf.tab = DETAIL_TAB
      host.invalidate()
    },
    tab: id => {
      state.wf.tab = id === DETAIL_TAB || slotsFor('tab').some(slot => slot.id === id) ? id : DETAIL_TAB
      host.invalidate()
    },
    setUi: patch => {
      state.wf.ui = { ...state.wf.ui, ...patch }
      host.invalidate()
    },
    ask: (spec, why = 'that cannot run here') => runner.ask(spec, why),
    show: path => {
      const ok = isRunPath(path, state.configDir)

      state.outcome = { label: 'transcript', ok, verified: 'n/a', detail: ok ? path : 'that path is outside Claude Code\'s projects folder, so it is not shown', atMs: Date.now() }
      host.invalidate()
    },
  }
}

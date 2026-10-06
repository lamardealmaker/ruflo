/**
 * Stop, Message and Redirect on the Workflows page (ADR-465), through the page's slot registry only: one inspector tab (`control`) and one
 * action button (`ctl-stop`), no hotkey, no edit of any shared file. Importing this module registers them (the merge owner adds
 * `import './wf-control'` to views/wf-register.ts and calls `wireWfControl(state, host)` from hooks/wf-wire.ts). Each action draws the EXACT
 * engine call it will make and how far that path is proven; the engine's own permission check and dialog decide it, and its answer is what the
 * footer outcome row says. Where this build binds no tool calls, the tab says so and offers the prompt-box text instead.
 */
import type { RenderElement } from 'claude-code'

import { cleanText } from '../data/wf-clean'
import { controlActions, type ControlAction, type ControlInput } from '../data/wf-control'
import { tidy } from '../data/wf-send'
import type { Host } from '../host'
import type { State } from '../state'
import { isRunPath } from '../wf-actions'
import { button, col, kv, text, THEME, type Ctx } from './common'
import { registerSlot, type SlotEnv } from './wf-slots'

const hosts = new WeakMap<State, Host>()
const drafts = new WeakMap<State, { text: string }>()

/** The wiring: the host whose tool bridge the actions call. A slot is handed none, so this is bound once per console state. */
export const wireWfControl = (state: State, host: Host): void => void hosts.set(state, host)

/** For tests. */
export function resetControl(state: State): void {
  hosts.delete(state)
  drafts.delete(state)
}

const draftOf = (state: State): { text: string } => {
  let held = drafts.get(state)

  if (held === undefined) {
    held = { text: '' }
    drafts.set(state, held)
  }

  return held
}

const COLOR: Record<ControlAction['proof'], string | undefined> = { verified: THEME.ok, 'queued-only': THEME.warn, unverified: THEME.warn, prefill: undefined }

/** The inputs the data module needs, from the page's cursor; null where there is no run or no host to act through. */
export function inputOf(env: Pick<SlotEnv, 'ctx' | 'run' | 'agent'>, text: string): ControlInput | null {
  const host = hosts.get(env.ctx.state)

  if (env.run === null || host === undefined) return null

  const { state } = env.ctx

  return {
    run: env.run,
    agent: env.agent,
    text,
    bridge: { toolCall: host.toolCall, toolCheck: host.toolCheck, fillPrompt: host.fillPrompt },
    report: (label, ok, detail) => {
      state.outcome = { label: tidy(label, 80), ok, verified: 'n/a', detail: tidy(detail, 240), atMs: Date.now() }
      host.invalidate()
    },
    isRunPath: path => isRunPath(path, state.configDir),
  }
}

function controlTab(env: SlotEnv): RenderElement[] {
  const { ctx, run, agent } = env
  const input = inputOf(env, draftOf(ctx.state).text)

  if (run === null) return [text(ctx, 'No run picked.', { dimColor: true })]
  if (input === null) return [text(ctx, 'The console is not wired to a host here: nothing can be called.', { dimColor: true })]

  const draft = draftOf(ctx.state)
  const actions = controlActions(input)
  const host = hosts.get(ctx.state)
  const field = ctx.kit.Input === undefined ? text(ctx, 'this surface has no text field: message and redirect need one', { dimColor: true }) : ctx.kit.Input({ key: 'wf-control-text', label: 'message', placeholder: 'what to tell the agent, or what to change on a redirect', submitLabel: 'set', onSubmit: value => { draft.text = value; ctx.act.workflows.setUi({}) } })
  const rows: RenderElement[] = [kv(ctx, 'run', cleanText(run.name)), kv(ctx, 'agent', agent === null ? 'none picked: stop and message need one' : cleanText(agent.label)), kv(ctx, 'tool calls', host?.toolCall === undefined ? 'not bound in this build: only the prompt-box text is offered' : 'bound: each call goes through the engine\'s permission check and dialog', host?.toolCall === undefined ? THEME.warn : undefined), field, text(ctx, draft.text === '' ? 'message: none typed yet' : `message: ${draft.text}`, { color: draft.text === '' ? undefined : THEME.info })]

  for (const action of actions) {
    rows.push(button(ctx, `wf-control-${action.id}`, action.label, () => ctx.act.workflows.ask(action.spec, action.why)))
    rows.push(text(ctx, `   call: ${action.spec === null ? `none (${action.why})` : action.call}`, { dimColor: true }))
    rows.push(text(ctx, `   proof: ${action.proof} · ${action.proofText}`, { ...(COLOR[action.proof] === undefined ? { dimColor: true } : { color: COLOR[action.proof] as string }) }))
  }

  rows.push(text(ctx, 'A refusal by the engine is shown and nothing else is tried in its place. Stopping is not undone by resuming.', { dimColor: true }))

  return [col(ctx, rows, 'wf-control')]
}

/** The stop action of the extras row: the picked agent if one is picked, else the run. Null (with the reason on the confirm row) where it cannot be made. */
export function stopSlotSpec(env: SlotEnv): ReturnType<typeof controlActions>[number]['spec'] {
  const input = inputOf(env, '')

  if (input === null) return null

  const actions = controlActions(input)

  return (env.agent === null ? actions.find(action => action.id === 'stop-run') : actions.find(action => action.id === 'stop-agent'))?.spec ?? null
}

/** Registers this module's slots; a repeat is refused harmlessly (the registry keeps the first). */
export function registerControlSlots(): void {
  registerSlot({ kind: 'tab', id: 'control', label: 'control', when: env => env.run !== null && env.run.kind === 'workflow', render: controlTab })
  registerSlot({ kind: 'action', id: 'ctl-stop', label: 'stop', why: 'nothing to stop: a ruflo swarm run (use x), an id the engine would not accept, or a build with no tool bridge', spec: stopSlotSpec })
}

registerControlSlots()

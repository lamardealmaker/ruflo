import type { RenderElement } from 'claude-code'

import { plain } from '../data/parse'
import { cleanText } from '../data/wf-clean'
import { CONTROL_TAB, controlLine } from '../data/wf-control'
import { pick } from '../data/workflows-nav'
import { workflowsModelOf } from '../wf-live'
import { ago, button, clip, col, row, rule, text, THEME, type Ctx } from './common'
import './wf-register'
import { DETAIL_TAB, slotsFor, type SlotEnv } from './wf-slots'
import { workflowsView } from './workflows'

/** A slot's own drawing or handler may throw: that costs one line naming the slot, never the page. */
function guarded<T>(id: string, ctx: Ctx, draw: () => T, fallback: (line: RenderElement) => T): T {
  try {
    return draw()
  } catch (error) {
    return fallback(text(ctx, `slot ${id} failed: ${cleanText(plain(error instanceof Error ? error.message : String(error), 60))}`, { color: THEME.bad }))
  }
}

const press = (run: () => void): (() => void) => () => {
  try {
    run()
  } catch {
    // A slot's handler that throws changes nothing; the page stays as it was.
  }
}

/** The movement and run-switch buttons: j k move, b and l pick the column (h is Help's), u and i switch run (a hotkey is one letter or digit, so not [ and ]), d inspects. */
function moves(ctx: Ctx, isInspecting: boolean): RenderElement {
  const act = ctx.act.workflows

  return row(ctx, [
    button(ctx, 'wf-prev', 'prev', () => act.key('k'), { hotkey: 'k' }),
    button(ctx, 'wf-next', 'next', () => act.key('j'), { hotkey: 'j' }),
    button(ctx, 'wf-col-phases', '◂ phases', () => act.key('h'), { hotkey: 'b' }),
    button(ctx, 'wf-col-agents', 'agents ▸', () => act.key('l'), { hotkey: 'l' }),
    button(ctx, 'wf-run-prev', '◂ run', () => act.key('['), { hotkey: 'u' }),
    button(ctx, 'wf-run-next', 'run ▸', () => act.key(']'), { hotkey: 'i' }),
    button(ctx, 'wf-inspect', isInspecting ? 'Close inspector' : 'Inspect', () => act.key('enter'), { hotkey: 'd' }),
  ], 'wf-moves')
}

/**
 * The Workflows page as the person meets it (ADR-464): the run board (views/workflows.ts), the buttons that move its cursor,
 * the buttons of any registered key and action slots, the inspector's tabs, then the board slots. Everything a slot draws or does is
 * guarded; the page reads the folders only while it is open (wf-live.ts) and says so, with how old the read is.
 */
export function workflowsPage(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const wf = state.wf
  const act = ctx.act.workflows
  const model = workflowsModelOf(state, nowMs)
  const here = model === null ? null : pick(wf.ui, model.runs)
  const env: SlotEnv | null = here === null || model === null ? null : { ctx, runs: model.runs, run: here.run, phase: here.phase, agent: here.agent, ui: here.ui, nowMs }
  const tabs = env === null || !env.ui.isInspecting ? [] : slotsFor('tab').filter(slot => guarded(slot.id, ctx, () => slot.when?.(env) ?? true, () => false))
  const slotTab = tabs.find(slot => slot.id === wf.tab)
  const ui = slotTab === undefined ? wf.ui : { ...wf.ui, isInspecting: false }
  const rows: RenderElement[] = [workflowsView(ctx, model, ui, { ask: spec => act.ask(spec), show: act.show })]

  if (env !== null && env.run !== null && ctx.columns >= 44) {
    rows.push(moves(ctx, env.ui.isInspecting))

    const extras = [
      ...slotsFor('key').map(slot => button(ctx, `wf-key-${slot.id}`, slot.label, press(() => slot.run(env)), { hotkey: slot.key })),
      ...slotsFor('action').map(slot => button(ctx, `wf-act-${slot.id}`, slot.label, press(() => act.ask(slot.spec(env), slot.why)), slot.hotkey === undefined ? {} : { hotkey: slot.hotkey })),
    ]

    if (extras.length > 0) rows.push(row(ctx, extras, 'wf-extras'))

    // Stop and message are the control tab's (ADR-465) where it is registered; where it is not, this says where that is done instead of a dead button.
    if (env.run.kind === 'workflow') rows.push(text(ctx, controlLine(slotsFor('tab').some(slot => slot.id === CONTROL_TAB)), { dimColor: true }))
  }

  if (env !== null && tabs.length > 0) {
    rows.push(row(ctx, [text(ctx, 'tabs'), button(ctx, 'wf-tab-detail', `${slotTab === undefined ? '●' : '○'} detail`, () => act.tab(DETAIL_TAB)), ...tabs.map(slot => button(ctx, `wf-tab-${slot.id}`, `${slot.id === slotTab?.id ? '●' : '○'} ${slot.label}`, () => act.tab(slot.id)))], 'wf-tabs'))
    if (slotTab !== undefined) rows.push(...guarded(slotTab.id, ctx, () => slotTab.render(env), line => [line]))
  }

  if (env !== null) {
    for (const slot of slotsFor('board')) {
      rows.push(rule(ctx, slot.title))
      rows.push(...guarded(slot.id, ctx, () => slot.render(env), line => [line]))
    }
  }

  if (wf.error !== null) rows.push(text(ctx, `the last read failed (${clip(wf.error, 80)}): showing the read before it`, { color: THEME.warn }))
  rows.push(text(ctx, wf.readAtMs === 0 ? 'read when this page opens, then on each refresh while it stays open' : `read ${ago(wf.readAtMs, nowMs)} · re-read on each refresh while this page is open, never while it is closed`, { dimColor: true }))

  return col(ctx, rows, 'workflows-page')
}

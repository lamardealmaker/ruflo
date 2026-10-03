import type { RenderElement } from 'claude-code'

import type { DevField } from '../data/devtools'
import { DEV, DEV_GROUPS, devSpec, type DevCost, type DevEntry, type DevGroup } from '../devtools'
import { slot } from './attention'
import { ago, button, clip, col, row, rule, text, THEME, type Ctx } from './common'

/** Result lines in view at once; j/k scroll the rest. */
const RESULT_ROWS = 14

/** Each cost as a four-cell tag, as the MetaHarness lab tags its rows. */
const TAG: Record<DevCost, { text: string; color: () => string }> = {
  read: { text: ' $0 ', color: () => THEME.ok },
  local: { text: 'cpu ', color: () => THEME.info },
  writes: { text: ' wr ', color: () => THEME.info },
  network: { text: 'net ', color: () => THEME.warn },
  spends: { text: ' $$ ', color: () => THEME.bad },
  deletes: { text: 'del ', color: () => THEME.bad },
}

/** The fields each section shows above its rows: one field may serve several sections, and says so. */
const FIELDS: Partial<Record<DevGroup, readonly { field: DevField; label: string; placeholder: string; submit?: string }[]>> = {
  brain: [{ field: 'task', label: 'ask', placeholder: 'what should I do? e.g. review my pull request, add OAuth login …', submit: 'ask' }],
  analyze: [{ field: 'ref', label: 'ref', placeholder: 'HEAD · HEAD~3 · main..HEAD · a sha', submit: 'diff' }],
  cow: [
    { field: 'path', label: 'path', placeholder: 'an .rvf memory file under the project (also file risk, appliance)', submit: 'status' },
    { field: 'label', label: 'label', placeholder: 'a checkpoint or branch label (also a DAA workflow / target agent)' },
  ],
  wasm: [{ field: 'query', label: 'search', placeholder: 'words to search the WASM gallery or the plugin registry' }],
  browser: [
    { field: 'url', label: 'url', placeholder: 'https://… to open in the ruflo-console session', submit: 'open' },
    { field: 'target', label: 'target', placeholder: '@e1: an element ref from SNAPSHOT', submit: 'click' },
  ],
  terminal: [
    { field: 'cmd', label: 'command', placeholder: 'one command line: Enter shows it, then asks before it runs', submit: 'run' },
    { field: 'id', label: 'id', placeholder: 'a session / agent id (terminal, DAA, managed agents)' },
  ],
  plugins: [{ field: 'query', label: 'search', placeholder: 'words to search the plugin registry (IPFS: asks first)', submit: 'search' }],
  daa: [{ field: 'note', label: 'note', placeholder: 'feedback or knowledge to send (also a managed-agent prompt)' }],
}

/** One dotted-leader row: the cost tag, the name, what it does, and its ▸ button; an n/a row says why instead. */
function entryRow(ctx: Ctx, entry: DevEntry, lead: number): RenderElement {
  const tag = TAG[entry.cost]
  const isNa = entry.na !== undefined
  const isBlocked = !isNa && devSpec(entry, ctx.state.devtools.fields) === null

  return row(
    ctx,
    [
      ctx.kit.Text({ bold: true, color: isNa ? THEME.info : tag.color(), dimColor: isNa, children: ` ${isNa ? 'n/a ' : tag.text}` }),
      ctx.kit.Text({ bold: true, color: entry.cost === 'spends' || entry.cost === 'deletes' ? THEME.warn : THEME.head, dimColor: isNa, children: clip(` ${entry.name} `, lead).padEnd(lead, '.') }),
      ctx.kit.Text({ color: THEME.info, dimColor: isNa || isBlocked, wrap: 'truncate-end', children: clip(` ${entry.about}`, Math.max(4, ctx.columns - lead - 16)) }),
      // A blocked row keeps its button: pressing it says which field to fill.
      ...(isNa ? [] : [ctx.kit.Button({ key: `dt-${entry.id.slice(3)}`, label: ' ▸ run', plain: true, dimColor: true, onPress: () => void ctx.act.run(entry.id) })]),
    ],
    `dt-row-${entry.id}`,
  )
}

function fieldRows(ctx: Ctx, group: DevGroup): RenderElement[] {
  const fields = FIELDS[group] ?? []

  const Input = ctx.kit.Input

  if (fields.length === 0) return []
  if (Input === undefined) return [text(ctx, ` this surface has no text field: /ruflo run <id> <text> fills one (${fields.map(entry => entry.field).join(', ')})`, { dimColor: true })]

  return fields.map(({ field, label, placeholder, submit }) =>
    Input({
      key: `dt-field-${group}-${field}`,
      label,
      placeholder,
      value: ctx.state.devtools.fields[field],
      submitLabel: submit ?? 'keep',
      onInput: value => ctx.act.devtools.draft(field, value),
      onSubmit: value => ctx.act.devtools.submit(field, value),
    }),
  )
}

/** The last Dev Tools run: what it was, how it exited, its note, and a window of its lines. */
function resultRows(ctx: Ctx): RenderElement[] {
  const { state, nowMs } = ctx
  const running = state.lab.running?.id.startsWith('dt-') === true ? state.lab.running : null
  const result = state.lab.result?.id.startsWith('dt-') === true ? state.lab.result : null
  const right = running !== null ? `running ${Math.round((nowMs - running.startedAtMs) / 1000)}s` : result === null ? 'nothing run yet' : `${result.ok ? '✓' : '✗'} exit ${result.exitCode ?? 'n/a'} · ${ago(result.atMs, nowMs)}`
  const rows: RenderElement[] = [rule(ctx, 'Result', right)]

  if (running !== null) rows.push(text(ctx, ` ▸ ${running.label} … ${Math.floor(nowMs / 500) % 2 === 0 ? '█' : ' '}`, { color: THEME.warn }))

  if (result === null) {
    if (running === null) rows.push(text(ctx, ' ▸ press a row: a $0 read shows here at once; the rest ask first (y), their cost on the confirm row', { dimColor: true }))

    return rows
  }

  rows.push(text(ctx, ` ${result.label}`, { bold: true, color: result.ok ? THEME.ok : THEME.bad }))
  if (result.note !== undefined) rows.push(text(ctx, ` ${result.note}`, { color: /MONEY|DELETES|DISCARDS|SHELL/.test(result.note) ? THEME.bad : THEME.warn }))

  const top = Math.max(0, Math.min(state.select.item, result.lines.length - RESULT_ROWS))

  for (const line of result.lines.slice(top, top + RESULT_ROWS)) rows.push(text(ctx, `   ${line}`))

  if (result.lines.length > RESULT_ROWS) {
    rows.push(
      row(ctx, [
        text(ctx, ` lines ${top + 1}-${Math.min(result.lines.length, top + RESULT_ROWS)} of ${result.lines.length} `, { dimColor: true }),
        button(ctx, 'dt-up', 'up', () => ctx.act.select(-1), { hotkey: 'k' }),
        button(ctx, 'dt-down', 'down', () => ctx.act.select(1), { hotkey: 'j' }),
      ]),
    )
  }

  return slot(ctx, rows)
}

/**
 * ruflo's integration surface by purpose: each section its fields and its rows, the last run's output under the first
 * section so it stays in view, and a key to the cost tags. Drawing it runs nothing; every row is a press.
 */
export function devtoolsView(ctx: Ctx): RenderElement {
  const lead = Math.max(16, Math.min(24, ctx.columns - 44))
  const rows: RenderElement[] = [text(ctx, ' $0 local read, runs at once · cpu/wr local work or a write · net the network · $$ may spend · del deletes: each of these asks first', { dimColor: true })]

  DEV_GROUPS.forEach((group, i) => {
    rows.push(rule(ctx, group.title, group.right))
    rows.push(...fieldRows(ctx, group.id))

    for (const entry of DEV.filter(candidate => candidate.group === group.id)) rows.push(entryRow(ctx, entry, lead))

    // The result sits under the brain and the diff tools, so a read's answer appears beside what asked for it.
    if (i === 1) rows.push(...resultRows(ctx))
  })

  rows.push(text(ctx, ' every row is a palette id too: /ruflo run dt-diff HEAD~3, /ruflo run dt-brain review my PR', { dimColor: true }))

  return col(ctx, rows, 'devtools')
}

/** This lab's result block alone: the pane asks for it to place under the row that was clicked. */
export const devtoolsResult = (ctx: Ctx): RenderElement[] => resultRows(ctx)

import type { RenderElement } from 'claude-code'

import { DOCTOR_COMPONENTS, isSecureResult, SECURE, SECURE_TEXT, secMemo, SEVERITIES, type SecCost, type Severity } from '../secure'
import { slot } from './attention'
import { ago, button, clip, col, row, rule, text, THEME, type Ctx } from './common'

/** Result lines in view at once; j/k scroll the rest. */
export const RESULT_ROWS = 14

/** Each cost as a four-cell tag: $0 reads, local writes, and what reaches the network. */
const TAG: Record<SecCost, { text: string; color: () => string }> = {
  read: { text: ' $0 ', color: () => THEME.ok },
  writes: { text: ' wr ', color: () => THEME.info },
  network: { text: 'net ', color: () => THEME.warn },
}

export const COST_KEY = ' $0 local read, runs at once · wr writes a file · net reaches the network: each of these asks, its cost on the confirm row'

/** One dotted-leader row: the cost tag, the name, what it does, and its ▸ run button (with the field's text, if it takes one). */
export function entryRow(ctx: Ctx, entry: { id: string; name: string; about: string; cost: SecCost }, textOf?: () => string): RenderElement {
  const lead = Math.max(14, Math.min(19, ctx.columns - 40))
  const tag = TAG[entry.cost]

  return row(
    ctx,
    [
      ctx.kit.Text({ bold: true, color: tag.color(), children: ` ${tag.text}` }),
      ctx.kit.Text({ bold: true, color: THEME.head, children: ` ${entry.name} `.padEnd(lead, '.') }),
      ctx.kit.Text({ color: THEME.info, wrap: 'truncate-end', children: clip(` ${entry.about}`, Math.max(4, ctx.columns - lead - 18)) }),
      ctx.kit.Button({ key: `run-${entry.id}`, label: ' ▸ run', plain: true, dimColor: true, onPress: () => void ctx.act.run(entry.id, textOf?.() ?? '') }),
    ],
    `row-${entry.id}`,
  )
}

/** A verb the CLI does not have, said as such rather than invented. */
export const naRow = (ctx: Ctx, name: string, why: string): RenderElement => text(ctx, `  n/a  ${name.padEnd(14, '.')} ${why}`, { dimColor: true })

/** The last run of this view's verbs: what it was, how it exited, its cost note, and a window of its lines. */
export function resultRows(ctx: Ctx, isMine: (id: string) => boolean): RenderElement[] {
  const { state, nowMs } = ctx
  const running = state.lab.running !== null && isMine(state.lab.running.id) ? state.lab.running : null
  const result = state.lab.result !== null && isMine(state.lab.result.id) ? state.lab.result : null
  const right = running !== null ? `running ${Math.round((nowMs - running.startedAtMs) / 1000)}s` : result === null ? 'nothing run yet' : `${result.ok ? '✓' : '✗'} exit ${result.exitCode ?? 'n/a'} · ${ago(result.atMs, nowMs)}`
  const rows: RenderElement[] = [rule(ctx, 'Result', right)]

  if (running !== null) rows.push(text(ctx, ` ▸ ${running.label} … ${Math.floor(nowMs / 500) % 2 === 0 ? '█' : ' '}`, { color: THEME.warn }))

  if (result === null) {
    if (running === null) rows.push(text(ctx, ' ▸ run an entry: a $0 read shows here at once; the rest show here after you confirm (y)', { dimColor: true }))

    return rows
  }

  rows.push(text(ctx, ` ${result.label}`, { bold: true, color: result.ok ? THEME.ok : THEME.bad }))
  if (result.note !== undefined) rows.push(text(ctx, ` ${result.note}`, { color: THEME.warn }))

  const top = Math.max(0, Math.min(state.select.item, result.lines.length - RESULT_ROWS))
  const tone = (line: string) => (/^(✗|\[critical\]|\[high\]|UNSAFE|ATTENTION|error)/.test(line) ? THEME.bad : /^(⚠|\[medium\]|PII FOUND|REVIEW)/.test(line) ? THEME.warn : /^(✓|SAFE|CLEAN)/.test(line) ? THEME.ok : undefined)

  for (const line of result.lines.slice(top, top + RESULT_ROWS)) {
    const color = tone(line)

    rows.push(text(ctx, `   ${line}`, color === undefined ? {} : { color }))
  }

  if (result.lines.length > RESULT_ROWS) {
    rows.push(
      row(ctx, [
        text(ctx, ` lines ${top + 1}-${Math.min(result.lines.length, top + RESULT_ROWS)} of ${result.lines.length} `, { dimColor: true }),
        button(ctx, 'result-up', 'up', () => ctx.act.select(-1), { hotkey: 'k' }),
        button(ctx, 'result-down', 'down', () => ctx.act.select(1), { hotkey: 'j' }),
      ]),
    )
  }

  return slot(ctx, rows)
}

const SEVERITY_COLOR: Record<Severity, () => string> = { critical: () => THEME.bad, high: () => THEME.bad, medium: () => THEME.warn, low: () => THEME.info }

/** The last findings by severity as bars, each scaled to the largest count. */
export function meterRows(ctx: Ctx): RenderElement[] {
  const findings = secMemo(ctx.state).findings
  const rows: RenderElement[] = [rule(ctx, 'Findings', findings === null ? 'none measured yet' : `${findings.source} · ${ago(findings.atMs, ctx.nowMs)}`)]

  if (findings === null) {
    rows.push(text(ctx, ' ▸ a scan, a channel/plan check or a paste check fills this meter with its findings by severity', { dimColor: true }))

    return rows
  }

  const most = Math.max(1, ...SEVERITIES.map(level => findings.counts[level]))
  const width = Math.max(8, Math.min(40, ctx.columns - 30))

  for (const level of SEVERITIES) {
    const n = findings.counts[level]
    const filled = n === 0 ? 0 : Math.max(1, Math.round((n / most) * width))

    rows.push(
      row(ctx, [
        ctx.kit.Text({ bold: n > 0, color: n > 0 ? SEVERITY_COLOR[level]() : THEME.info, dimColor: n === 0, children: ` ${level.padEnd(9)}` }),
        ctx.kit.Text({ color: SEVERITY_COLOR[level](), children: '█'.repeat(filled) }),
        ctx.kit.Text({ dimColor: true, children: `${'░'.repeat(width - filled)} ${n}` }),
      ], `meter-${level}`),
    )
  }

  return rows
}

/** The paste field: Enter runs the local check at once; the buttons run the other checks on the same text. */
function pasteRows(ctx: Ctx): RenderElement[] {
  const memo = secMemo(ctx.state)
  const rows: RenderElement[] = [rule(ctx, 'Check text', 'AIDefence · injection, jailbreak, PII · policy')]

  if (ctx.kit.Input !== undefined) {
    rows.push(
      ctx.kit.Input({
        key: 'sec-text',
        label: 'text',
        placeholder: 'paste a prompt, a message or a plan: Enter checks it locally (it is passed as one argv value)',
        value: memo.draft,
        submitLabel: 'check',
        onInput: value => {
          memo.draft = value
        },
        onSubmit: value => {
          memo.draft = value
          void ctx.act.run('aid-check', value)
        },
      }),
    )
  } else {
    rows.push(text(ctx, ' this surface has no text field: /ruflo run aid-check <text> checks text headless', { dimColor: true }))
  }

  for (const entry of SECURE_TEXT) rows.push(entryRow(ctx, entry, () => memo.draft))
  rows.push(text(ctx, ' ▸ run takes the text in the field; policy-eval takes an action type (deploy, tool:Bash) and asks first', { dimColor: true }))

  return rows
}

/** The doctor: the full run and --fix, one button per local component, then the last run's checks as ✓/⚠/✗ rows. */
function doctorRows(ctx: Ctx): RenderElement[] {
  const doctor = secMemo(ctx.state).doctor
  const rows: RenderElement[] = [rule(ctx, 'Doctor', doctor === null ? 'not run yet' : `${doctor.label} · ${ago(doctor.atMs, ctx.nowMs)}`)]

  for (const entry of SECURE.filter(candidate => candidate.id === 'doc-all' || candidate.id === 'doc-fix')) rows.push(entryRow(ctx, entry))

  rows.push(
    ctx.kit.Box({
      flexDirection: 'row',
      flexWrap: 'wrap',
      key: 'doc-components',
      children: [ctx.kit.Text({ bold: true, color: THEME.ok, children: '  $0  component:' }), ...DOCTOR_COMPONENTS.map(component => ctx.kit.Button({ key: `run-doc-${component}`, label: ` ${component}`, plain: true, dimColor: true, onPress: () => void ctx.act.run(`doc-${component}`) }))],
    }),
  )

  if (doctor === null) {
    rows.push(text(ctx, ' ▸ a component runs at once and locally; the full doctor asks first (its version check asks npm)', { dimColor: true }))

    return rows
  }

  const count = (status: string) => doctor.checks.filter(check => check.status === status).length

  rows.push(text(ctx, ` ${count('pass')} passed · ${count('warn')} warnings · ${count('fail')} failed`, { bold: true, color: count('fail') > 0 ? THEME.bad : count('warn') > 0 ? THEME.warn : THEME.ok }))

  for (const check of doctor.checks.slice(0, 30)) {
    const mark = check.status === 'pass' ? { glyph: '✓', color: THEME.ok } : check.status === 'warn' ? { glyph: '⚠', color: THEME.warn } : { glyph: '✗', color: THEME.bad }

    rows.push(
      row(ctx, [
        ctx.kit.Text({ bold: true, color: mark.color, children: ` ${mark.glyph} ` }),
        ctx.kit.Text({ bold: check.status !== 'pass', children: clip(`${check.name}: `, 40) }),
        ctx.kit.Text({ dimColor: check.status === 'pass', wrap: 'truncate-end', children: clip(check.message, Math.max(4, ctx.columns - check.name.length - 8)) }),
      ], `check-${check.name}`),
    )
  }

  return rows
}

/**
 * Security & Doctor: the findings meter, a paste field for AIDefence, every security verb by cost, the doctor with its
 * checks, and the last run's output. Nothing runs on open; a $0 read runs on its button, the rest ask first.
 */
export function secureView(ctx: Ctx): RenderElement {
  const rows: RenderElement[] = [...meterRows(ctx), ...pasteRows(ctx), rule(ctx, 'Scan & inspect', 'scans are local; npm audit is the network')]

  for (const entry of SECURE.filter(candidate => candidate.group === 'scan')) rows.push(entryRow(ctx, entry))
  rows.push(naRow(ctx, 'VALIDATE', 'no `security validate` in the CLI: the check text field above is the input check'))
  rows.push(naRow(ctx, 'REPORT', 'no `security report` in the CLI: a scan writes .claude/security-scans/<scan>.json'))
  rows.push(text(ctx, COST_KEY, { dimColor: true }))
  rows.push(...doctorRows(ctx), ...resultRows(ctx, isSecureResult))

  return col(ctx, rows, 'secure')
}

/** This view's result block alone: the pane asks for it to place under the row that was clicked. */
export const secureResult = (ctx: Ctx): RenderElement[] => resultRows(ctx, isSecureResult)

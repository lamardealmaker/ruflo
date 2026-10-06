import type { RenderElement } from 'claude-code'

import { compositeRank, explainPrompt, lifecycleOrder, recallOf, shown, wouldPrune, type RecallFacts, type SessionRecall } from '../data/recall'
import { ago, button, clip, kv, row, text, THEME, type Ctx } from './common'

/** Rows of a table drawn at most; the rest are counted, not hidden silently. */
const SHOWN = 12
const BAR = 10

/** The prompt being explained: typed or picked. View-local (the integrator may move it into State); a button sets it and asks for a redraw. */
let picked: string | null = null

export const pickPrompt = (value: string | null): void => {
  picked = value === null || shown(value, 300) === '' ? null : shown(value, 300)
}

export const pickedPrompt = (): string | null => picked

const bar = (value: number, max = 1): string => {
  const filled = Math.max(0, Math.min(BAR, Math.round((value / max) * BAR)))

  return '█'.repeat(filled) + '░'.repeat(BAR - filled)
}

const n3 = (value: number): string => value.toFixed(3)

function sessionRows(ctx: Ctx, facts: RecallFacts, session: SessionRecall): RenderElement[] {
  const byId = new Map((facts.ranked?.entries ?? []).map(entry => [entry.id, entry]))

  return session.ids.map((id, index) => {
    const entry = byId.get(id)

    return text(ctx, entry === undefined ? `   ${index + 1}. ${clip(id, 40)}  (no longer in the ranked file)` : `   ${index + 1}. rank ${n3(compositeRank(entry))}  ${entry.summary}  [${entry.category || 'n/a'} · conf ${entry.confidence === null ? 'n/a' : entry.confidence.toFixed(2)} · pr ${n3(entry.pageRank)} · ${entry.accessCount}x]`, entry === undefined ? { dimColor: true } : {})
  })
}

/**
 * What the hook recalled. The one RECORDED fact is each session's last recall (ids only: the hook keeps neither the prompt
 * nor the scores); the explain field re-scores a prompt with the hook's own formula against today's ranked file.
 */
export function recallRows(ctx: Ctx): RenderElement[] {
  const facts = recallOf(ctx.state.snapshot)
  const { nowMs } = ctx
  const rows: RenderElement[] = []

  if (facts === null || facts.ranked === null) {
    const why = facts === null ? 'the recall probe is not wired into this snapshot' : `.claude-flow/data/ranked-context.json is ${facts.reads.ranked}`

    return [text(ctx, ` nothing to recall from: ${why}. The hook builds that file when it consolidates (hooks intelligence).`, { dimColor: true })]
  }

  rows.push(kv(ctx, 'ranked file', `${facts.ranked.entries.length} entries · ranked ${ago(facts.ranked.computedAtMs, nowMs)}`))
  rows.push(text(ctx, ' The hook logs neither the prompt nor its scores. Recorded: each session’s last recall (ids). Below that, a re-score.', { dimColor: true }))

  if (facts.sessions.length === 0) rows.push(text(ctx, ' no session file has a lastMatchedPatterns: no recall is recorded yet', { dimColor: true }))

  facts.sessions.slice(0, 4).forEach((session, index) => {
    rows.push(text(ctx, ` recorded recall · session ${ago(session.updatedAtMs, nowMs)} · ${session.ids.length} pattern${session.ids.length === 1 ? '' : 's'}${index === 0 ? '' : ' (ids only)'}`, { bold: index === 0, color: THEME.head }))
    if (index === 0) rows.push(...sessionRows(ctx, facts, session))
  })

  rows.push(text(ctx, ' explain a prompt (what would surface now: recomputed, not what surfaced then)', { bold: true, color: THEME.head }))

  if (facts.prompts.length === 0) rows.push(text(ctx, ` no past prompts: ${facts.reads.prompts === 'ok' ? 'routing-outcomes.json holds no task text' : `.claude-flow/routing-outcomes.json is ${facts.reads.prompts}`}; type one below`, { dimColor: true }))

  facts.prompts.slice(0, 6).forEach((prompt, index) =>
    rows.push(row(ctx, [ctx.kit.Button({ key: `recall-pick-${index}`, label: `▸ ${clip(prompt.task, Math.max(20, ctx.columns - 24))}`, plain: true, onPress: () => { pickPrompt(prompt.task); ctx.act.refresh() } }), ctx.kit.Text({ dimColor: true, children: ` ${prompt.agent} ${prompt.ok ? '✓' : '✗'} ${ago(prompt.atMs, nowMs)}` })], `recall-pick-row-${index}`)),
  )

  if (ctx.kit.Input !== undefined) rows.push(ctx.kit.Input({ key: 'in-recall-explain', label: 'prompt', placeholder: 'any prompt, to see which memories it would pull', submitLabel: 'explain', onSubmit: value => { pickPrompt(value); ctx.act.refresh() } }))

  const prompt = pickedPrompt()

  if (prompt === null) return rows

  const scored = explainPrompt(prompt, facts.ranked.entries)

  rows.push(text(ctx, ` "${clip(prompt, Math.max(20, ctx.columns - 8))}"`, { bold: true }))
  if (scored.length === 0) rows.push(text(ctx, ' nothing clears the hook’s 0.05 threshold: it would surface no memory for this prompt', { color: THEME.warn }))

  scored.forEach((item, index) => {
    rows.push(text(ctx, `   ${index + 1}. ${bar(item.score, scored[0]?.score ?? 1)} ${n3(item.score)} = 0.6·match ${n3(item.match)} + 0.4·pr ${n3(item.entry.pageRank)}  ${item.entry.summary}`))
  })
  rows.push(button(ctx, 'recall-clear', 'clear', () => { pickPrompt(null); ctx.act.refresh() }))

  return rows
}

/**
 * The neural store's patterns with only what models.json records. No rank and no last-used time exist in that file, so
 * neither is drawn; usageCount is real and is 0 for patterns nothing has recalled. Prune and promote ask first.
 */
export function lifecycleRows(ctx: Ctx): RenderElement[] {
  const facts = recallOf(ctx.state.snapshot)
  const { nowMs } = ctx
  const rows: RenderElement[] = []
  const patterns = facts?.neural ?? null

  if (patterns === null) return [text(ctx, ` no pattern table: .claude-flow/neural/models.json is ${facts?.reads.neural ?? 'not read (the recall probe is not wired)'}`, { dimColor: true })]

  const sorted = lifecycleOrder(patterns)
  const idle = wouldPrune(patterns, 1).length

  rows.push(text(ctx, ' columns: only what models.json records (age, uses, verdict at creation); rank and last-used time are not recorded there', { dimColor: true }))
  // Column widths follow the width: the wide table (id 26 + type 14 + age 8 + uses 5 + verdict 8, then the name) needs 86 columns plus the two buttons; narrower, the columns shrink and the name goes.
  const wide = ctx.columns >= 120
  const [wId, wType, wAge, wUses, wVerdict] = wide ? [26, 14, 8, 5, 8] : [16, 12, 6, 4, 7]
  const wName = wide ? Math.max(10, ctx.columns - 86 - 20) : 0

  rows.push(text(ctx, ` ${'pattern'.padEnd(wId)} ${'type'.padEnd(wType)} ${'age'.padEnd(wAge)} ${'uses'.padEnd(wUses)} ${'verdict'.padEnd(wVerdict)}${wide ? ' name' : ''}`, { dimColor: true }))

  sorted.slice(0, SHOWN).forEach((pattern, index) => {
    rows.push(
      row(
        ctx,
        [
          ctx.kit.Text({ children: ` ${clip(pattern.id, wId).padEnd(wId)} ${clip(pattern.type, wType).padEnd(wType)} ${clip(pattern.createdAtMs === null ? 'n/a' : ago(pattern.createdAtMs, nowMs).replace(' ago', ''), wAge).padEnd(wAge)} ${String(pattern.usageCount).padEnd(wUses)} ${clip(pattern.verdict ?? 'n/a', wVerdict).padEnd(wVerdict)}${wide ? ` ${clip(pattern.name, wName)}` : ''} ` }),
          ctx.kit.Button({ key: `recall-promote-${index}`, label: '▲ promote', plain: true, onPress: () => void ctx.act.run('nn-recall-promote', pattern.id) }),
          ctx.kit.Button({ key: `recall-prune-${index}`, label: ' ✂ prune', plain: true, onPress: () => void ctx.act.run('nn-recall-prune', pattern.id) }),
        ],
        `recall-pattern-${index}`,
      ),
    )
  })
  if (sorted.length > SHOWN) rows.push(text(ctx, ` + ${sorted.length - SHOWN} more in the file`, { dimColor: true }))
  if (sorted.length === 0) rows.push(text(ctx, ' the neural store holds no patterns', { dimColor: true }))

  rows.push(row(ctx, [text(ctx, ` ${idle} of ${patterns.length} never used `, { color: idle > 0 ? THEME.warn : THEME.ok }), ctx.kit.Button({ key: 'recall-prune-unused', label: '✂ prune the never-used', plain: true, onPress: () => void ctx.act.run('nn-recall-prune-unused') })], 'recall-prune-bulk'))
  rows.push(
    text(ctx, facts?.reads.bank === 'too-large' ? ' the ReasoningBank (neural/patterns.json) is over the 2 MB read cap: it is not read, and no per-pattern verb acts on it' : ' the ReasoningBank (neural/patterns.json) is a separate store; no per-pattern verb acts on it', { dimColor: true }),
  )

  return rows
}

/**
 * Claude's guidance on a mission, under vitest: the argv (claude -p, plan mode, the budget and model from Settings), what the
 * prompt tells claude (the goal, the plan, the lifecycle, this installation's plugins and skills), that it asks first unless
 * "always accept" is on and is silent when Settings turned it off, and how the streamed answer lands.
 */
import { describe, expect, it } from 'vitest'

import type { ActionSpec } from '../hooks/actions'
import type { Host } from '../hooks/host'
import { guidanceArgv, guidancePrompt, guidanceSpec, offerGuidance, pluginsOf, startGuidance } from '../hooks/mission-guidance'
import { mcOf, setGoal } from '../hooks/mission-control'
import type { Runner } from '../hooks/runner'
import { saveAiPrefs, settingsOf } from '../hooks/settings'
import { newState, type State } from '../hooks/state'

const json = (value: unknown) => `${JSON.stringify(value)}\n`

const ANSWER = [
  { stream: 'stdout' as const, text: json({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '## Research\nSearch memory first' } } }) },
  { stream: 'stdout' as const, text: json({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: ' for prior art.\n## Learn\nStore the outcome.' } } }) },
  { stream: 'stdout' as const, text: json({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.0421 }) },
]

function fakeHost(script: { stream: 'stdout' | 'stderr'; text: string }[]) {
  const calls: { argv: readonly string[]; input?: string }[] = []
  const stored = new Map<string, unknown>()
  const spawn = (argv: readonly string[], input?: string) => {
    calls.push({ argv, ...(input !== undefined && { input }) })

    const stream = (async function* () {
      for (const chunk of script) yield chunk

      return { code: 0, signal: null }
    })()

    return Object.assign(stream, { result: Promise.resolve({ code: 0, signal: null }), return: async () => ({ done: true, value: undefined }) }) as never
  }
  const host = { spawn, invalidate: () => undefined, after: () => ({ cancel: () => undefined }), storeSet: async (key: string, value: unknown) => void stored.set(key, value) } as unknown as Host

  return { host, calls }
}

const ready = (goal = 'add a dark mode toggle to settings'): State => {
  const state = newState({})

  state.commandNames = ['ruflo-goals:goal-plan', 'ruflo-sparc:sparc', 'other:thing']
  setGoal(state, goal)

  return state
}

const settled = async () => {
  for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 2))
}

describe('mission guidance', () => {
  it('runs claude -p in plan mode, streaming, under the budget and model from Settings, with a fresh session', () => {
    const state = ready()

    expect(guidanceArgv(state)).toEqual(['claude', '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'plan', '--max-budget-usd', '1'])
    saveAiPrefs(state, { invalidate: () => undefined, storeSet: async () => undefined } as unknown as Host, { claudeModel: 'sonnet', budgetUsd: 0.5 })
    expect(guidanceArgv(state)).toEqual(expect.arrayContaining(['--max-budget-usd', '0.5', '--model', 'sonnet']))
    expect(guidanceArgv(state)).not.toContain('--resume')
  })

  it('the prompt carries the goal, the plan and lifecycle, the installed ruflo plugins and skills, and the AI settings; it is read-only', () => {
    const state = ready()
    const mc = mcOf(state)
    const prompt = guidancePrompt(state, mc, mc.planned as never)

    expect(prompt).toContain('GOAL: add a dark mode toggle to settings')
    expect(prompt).toContain('Read-only')
    expect(prompt).toContain('Lifecycle: Research')
    expect(prompt).toContain('[Create] Design the architecture and interfaces')
    expect(prompt).toContain('ruflo plugins loaded in the session: ruflo-goals, ruflo-sparc')
    expect(prompt).toContain('ruflo-goals:goal-plan')
    expect(prompt).not.toContain('other:thing')
    expect(prompt).toContain('claude model default, turn budget $1, asks before AI turns')
    expect(prompt).toMatch(/Suggestions/)
    expect(pluginsOf(state)).toEqual(['ruflo-goals', 'ruflo-sparc'])
  })

  it('asks first, under the goal, showing the exact command; nothing runs until it is confirmed', async () => {
    const state = ready()
    const { host, calls } = fakeHost(ANSWER)
    const asked: { spec: ActionSpec | null }[] = []
    const runner = { ask: (spec: ActionSpec | null) => void asked.push({ spec }) } as unknown as Runner

    offerGuidance(state, host, runner, mcOf(state))
    await settled()
    expect(calls).toEqual([])
    expect(asked[0]?.spec?.scope).toBe('goal')
    expect(asked[0]?.spec?.label).toContain('ask claude -p for detailed guidance')
    expect(asked[0]?.spec?.shows).toContain('claude -p')
    await asked[0]?.spec?.run?.()
    await settled()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.input).toContain('GOAL: add a dark mode toggle to settings')
  })

  it('always accept runs it at once; turning Mission guidance off in Settings asks and runs nothing', async () => {
    const state = ready()
    const { host, calls } = fakeHost(ANSWER)
    const asked: unknown[] = []
    const runner = { ask: (spec: unknown) => void asked.push(spec) } as unknown as Runner

    settingsOf(state).ai = { ...settingsOf(state).ai, autoAccept: true }
    offerGuidance(state, host, runner, mcOf(state))
    await settled()
    expect(calls).toHaveLength(1)
    expect(asked).toEqual([])

    settingsOf(state).ai = { ...settingsOf(state).ai, autoAccept: false, guidance: false }
    offerGuidance(state, host, runner, mcOf(state))
    await settled()
    expect(calls).toHaveLength(1)
    expect(asked).toEqual([])
    expect(mcOf(state).guidance).toBeNull()
  })

  it('the answer streams into lines, markdown headings kept, with the turn cost; a second ask does not start while one runs', async () => {
    const state = ready()
    const { host, calls } = fakeHost(ANSWER)
    const mc = mcOf(state)

    startGuidance(state, host, mc)
    startGuidance(state, host, mc)
    await settled()
    expect(calls).toHaveLength(1)
    expect(mc.guidance?.status).toBe('done')
    expect(mc.guidance?.lines).toEqual(['## Research', 'Search memory first for prior art.', '## Learn', 'Store the outcome.'])
    expect(mc.guidance?.note).toContain('$0.042')
  })

  it('an answer with nothing in it is a failure that says what to check, and an error result is one too', async () => {
    const empty = ready()

    startGuidance(empty, fakeHost([]).host, mcOf(empty))
    await settled()
    expect(mcOf(empty).guidance?.status).toBe('failed')
    expect(mcOf(empty).guidance?.note).toContain('claude answered nothing')

    const bad = ready()

    startGuidance(bad, fakeHost([{ stream: 'stdout', text: json({ type: 'result', subtype: 'error_max_budget_usd', is_error: true }) }]).host, mcOf(bad))
    await settled()
    expect(mcOf(bad).guidance?.status).toBe('failed')
  })

  it('without a plan there is nothing to ask', () => {
    const state = newState({})

    expect(guidanceSpec(state, fakeHost([]).host, mcOf(state))).toBeNull()
  })

  it('terminal text is cleaned: no escape or control characters reach the guidance lines', async () => {
    const state = ready()

    startGuidance(state, fakeHost([{ stream: 'stdout', text: json({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok \u001b[31mred\u001b[0m‮ end' } } }) }]).host, mcOf(state))
    await settled()
    expect(mcOf(state).guidance?.lines.join('')).toBe('ok red end')
  })
})

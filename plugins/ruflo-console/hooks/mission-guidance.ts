/**
 * Claude's guidance on a mission: after a goal is entered and planned, `claude -p` (plan mode, read-only, under the per-turn
 * budget from Settings) is given the goal, the plan, the lifecycle and what this installation can do (the ruflo plugins and
 * skills the session offers, the AI preferences), and asked for detailed guidance: what to do in each stage, which ruflo
 * capabilities to bring in, what could go wrong. It costs a model turn, so it asks first (scope `goal`, under the goal) unless
 * "always accept" is set in Settings; "Mission guidance" in Settings turns it off. Its answer is data, drawn as text.
 */
import type { ActionSpec } from './actions'
import { termText } from './harness'
import type { Host } from './host'
import { type Plan, lifecycleOf } from './goap'
import type { McState } from './mission-control'
import { blocksGuidance } from './mission-options'
import { planText } from './mission-text'
import type { Runner } from './runner'
import { settingsOf } from './settings'
import type { State } from './state'
import { claudeParser, eventOf, type Sink } from './stream'

export type Guidance = { goal: string; status: 'running' | 'done' | 'failed'; lines: string[]; note: string; stop: (() => void) | null }

/** The most guidance text kept, and the longest wait: a runaway turn ends at five minutes. */
const MAX_LINES = 400
const CAP_MS = 5 * 60_000

/** The ruflo plugin names the session's slash commands come from (`ruflo-goals:goal-plan` → ruflo-goals), the installation's capabilities. */
export const pluginsOf = (state: State): string[] => [...new Set(state.commandNames.filter(name => name.startsWith('ruflo') && name.includes(':')).map(name => name.slice(0, name.indexOf(':'))))].sort()

export function guidancePrompt(state: State, mc: McState, plan: Plan): string {
  const ai = settingsOf(state).ai
  const plugins = pluginsOf(state)
  const skills = state.commandNames.filter(name => name.startsWith('ruflo') && name.includes(':')).slice(0, 60)

  return [
    'You are advising on a ruflo mission. Read-only: do not change any file. Be concrete and specific to this goal.',
    '',
    `GOAL: ${mc.goal}`,
    `Kind: ${plan.profile}. Rigor: ${plan.rigor}. Lifecycle: ${lifecycleOf(plan).map(entry => entry.stage).join(' → ')}.`,
    '',
    'THE PLAN THE PLANNER MADE:',
    planText(plan, mc.goal),
    '',
    'THIS INSTALLATION:',
    `- ruflo plugins loaded in the session: ${plugins.length === 0 ? 'none reported' : plugins.join(', ')}`,
    `- slash commands and skills available: ${skills.length === 0 ? 'none reported' : skills.join(', ')}`,
    `- AI settings: claude model ${ai.claudeModel}, turn budget $${ai.budgetUsd}, ${ai.autoAccept ? 'always accept' : 'asks before AI turns'}`,
    `- Settings level: ${settingsOf(state).level}`,
    '',
    'Write detailed guidance, in markdown with one short heading per lifecycle stage that the plan has (Research, Create (ADRs and the SOP), Build, Test, Validate, Secure, Benchmark, Learn).',
    'Under each heading: what to do for THIS goal, the acceptance evidence, and which ruflo capabilities to bring in (name the exact agents, plugins, skills, MCP tools or ruflo commands that fit, and why), preferring what is installed here and saying plainly what is not.',
    'Then add: "Suggestions" (other ruflo capabilities worth integrating that the plan does not use, such as swarm or hive-mind for parallel work, memory and pattern search for prior art, AIDefence, MetaHarness audits, the flywheel for self-optimization), and "Risks" (what could go wrong and how the plan guards against it).',
    'Keep it under 700 words. No preamble.',
  ].join('\n')
}

export function guidanceArgv(state: State): readonly string[] {
  const ai = settingsOf(state).ai

  return ['claude', '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'plan', '--max-budget-usd', String(ai.budgetUsd), ...(ai.claudeModel === 'default' ? [] : ['--model', ai.claudeModel])]
}

/** Runs the guidance turn and fills `mc.guidance` as the answer arrives. */
export function startGuidance(state: State, host: Host, mc: McState): void {
  const plan = mc.planned

  if (plan === null || mc.guidance?.status === 'running') return

  const guidance: Guidance = { goal: mc.goal, status: 'running', lines: [], note: 'asking claude…', stop: null }
  const startedAtMs = Date.now()
  let open = false
  const parse = claudeParser()
  const add = (text: string) => {
    for (const line of text.split('\n')) guidance.lines.push(termText(line, 2_000, false))

    if (guidance.lines.length > MAX_LINES) guidance.lines.splice(0, guidance.lines.length - MAX_LINES)
  }
  const sink: Sink = {
    line: (kind, text) => {
      open = false
      if (kind === 'err') guidance.note = termText(text, 200)
      else if (kind === 'out') add(text)
    },
    type: text => {
      const parts = text.split('\n')

      parts.forEach((part, i) => {
        if (i > 0 || !open || guidance.lines.length === 0) {
          guidance.lines.push('')
          open = true
        }

        guidance.lines[guidance.lines.length - 1] = termText((guidance.lines[guidance.lines.length - 1] ?? '') + part, 2_000, false)
      })
    },
    session: () => undefined,
    done: ({ costUsd, isError, message }) => {
      guidance.status = isError === true ? 'failed' : 'done'
      guidance.note = isError === true ? `✗ ${message ?? 'failed'}` : `✓ ${Math.round((Date.now() - startedAtMs) / 1000)} s${costUsd !== undefined ? ` · $${costUsd.toFixed(3)}` : ''}`
    },
  }

  mc.guidance = guidance

  let stream: ReturnType<Host['spawn']>

  try {
    stream = host.spawn(guidanceArgv(state), guidancePrompt(state, mc, plan))
  } catch (error) {
    guidance.status = 'failed'
    guidance.note = `claude did not start: ${error instanceof Error ? error.message : String(error)}`
    host.invalidate()

    return
  }

  const stop = () => {
    guidance.status = guidance.status === 'running' ? 'failed' : guidance.status
    guidance.note = 'stopped'
    void stream.return(undefined as never).catch(() => undefined)
  }
  const cap = host.after(CAP_MS, stop)

  guidance.stop = stop
  host.invalidate()

  void (async () => {
    const partial = { stdout: '', stderr: '' }

    try {
      for await (const chunk of stream) {
        const lines = (partial[chunk.stream] + chunk.text).split('\n')

        partial[chunk.stream] = lines.pop() ?? ''

        for (const line of lines) {
          if (chunk.stream === 'stdout') {
            const event = eventOf(line)

            if (event !== null) parse(event, sink)
          }
        }

        host.invalidate()
      }

      await stream.result

      if (guidance.status === 'running') {
        guidance.status = guidance.lines.some(line => line.trim() !== '') ? 'done' : 'failed'
        guidance.note = guidance.status === 'done' ? '✓ done' : 'claude answered nothing: is it installed, signed in and on PATH?'
      }
    } catch (error) {
      guidance.status = 'failed'
      guidance.note = `✗ claude: ${error instanceof Error ? error.message : String(error)} (is it installed and on PATH?)`
    } finally {
      cap.cancel()
      guidance.stop = null
      host.invalidate()
    }
  })()
}

/** The confirm-gated ask for the guidance turn, drawn under the goal; null with no plan. */
export function guidanceSpec(state: State, host: Host, mc: McState): ActionSpec | null {
  if (mc.planned === null) return null

  const argv = guidanceArgv(state)
  const goal = mc.goal

  return {
    label: `ask claude -p for detailed guidance on this mission: ${termText(mc.goal.replace(/\s+/g, ' '), 44)}`,
    scope: 'goal',
    args: argv,
    shows: `${argv.join(' ')}  (the goal, the plan and this installation's capabilities on stdin)`,
    expect: 'guidance by lifecycle stage, with the ruflo capabilities to use, in Mission Control',
    // The goal or its screen may have changed while the ask was open: only the goal that was asked about goes out.
    run: async () => {
      if (mc.goal === goal && !blocksGuidance(mc.screen)) startGuidance(state, host, mc)
    },
  }
}

/** After a goal is entered: asks for the guidance turn (or runs it at once under "always accept"); off when Settings turned it off. */
export function offerGuidance(state: State, host: Host, runner: Runner, mc: McState): void {
  // A turn for the previous goal is stopped, not left to run on (and be paid for) with no way to stop it.
  mc.guidance?.stop?.()
  mc.guidance = null

  const ai = settingsOf(state).ai

  if (mc.planned === null || ai.guidance === false) return
  if (ai.autoAccept) return startGuidance(state, host, mc)

  runner.ask(guidanceSpec(state, host, mc), 'type a goal first')
}

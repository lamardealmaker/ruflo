/**
 * Stop, Message and Redirect (ADR-465): the exact engine call on the card, the engine's permission respected, the spike's real answers
 * classified, and every failure said as itself. Fake bridges only. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-control.spec.ts --testTimeout=30000
 */
import { describe, expect, it } from 'vitest'

import type { ToolReply } from '../hooks/host'
import { callTool, classifyReply, controlActions, ENGINE_ID, permissionOf, relayText, resumeText, type Bridge, type ControlAction, type ControlInput } from '../hooks/data/wf-control'
import type { WfAgent, WfRun } from '../hooks/data/workflows'

const AGENT = 'acf991387298086c7'
const RUN = 'wf_abc12345'

const agent = (over: Partial<WfAgent> = {}): WfAgent => ({ id: AGENT, label: 'sleeper', phase: 'Build', state: 'running', hasWorktree: false, ...over })
const run = (over: Partial<WfRun> = {}): WfRun => ({ id: RUN, name: 'my flow', kind: 'workflow', state: 'running', phases: [{ title: 'Build', agents: [agent()], done: 0, total: 1, running: 1, failed: 0 }], running: 1, done: 0, failed: 0, idle: 0, total: 1, totalTokens: null, isTokensPartial: false, hasRecord: false, dir: '/home/u/.claude/projects/-p/sess/subagents/workflows/wf_abc12345', ...over })

type Calls = { tool: Record<string, unknown>[]; check: { tool: string; input: unknown }[]; fill: string[]; said: { label: string; ok: boolean; detail: string }[] }

function harness(over: { reply?: ToolReply | ((input: Record<string, unknown>) => ToolReply); verdict?: 'allow' | 'ask' | 'deny'; reject?: string; noTool?: boolean; fill?: boolean; text?: string; agent?: WfAgent | null; run?: WfRun } = {}): { input: ControlInput; calls: Calls } {
  const calls: Calls = { tool: [], check: [], fill: [], said: [] }
  const reply = over.reply ?? { text: JSON.stringify({ message: 'Successfully stopped task: acf991387298086c7 (sleeper)', task_type: 'local_agent' }) }
  const bridge: Bridge & { fillPrompt: (text: string) => Promise<boolean> } = {
    ...(over.noTool === true ? {} : { toolCall: async (input: Record<string, unknown> & { tool: string }) => { calls.tool.push(input); if (over.reject !== undefined) throw new Error(over.reject); return typeof reply === 'function' ? reply(input) : reply } }),
    toolCheck: async (tool, input) => { calls.check.push({ tool, input }); return { decision: over.verdict ?? 'allow', ...(over.verdict === 'deny' && { reason: 'Bash(*) is denied' }) } },
    fillPrompt: async text => { calls.fill.push(text); return over.fill ?? true },
  }

  return { calls, input: { run: over.run ?? run(), agent: over.agent === undefined ? agent() : over.agent, text: over.text ?? '', bridge, report: (label, ok, detail) => calls.said.push({ label, ok, detail }), isRunPath: path => path.startsWith('/home/u/.claude/projects/') && !path.includes('..') } }
}

const by = (actions: ControlAction[], id: string): ControlAction => actions.find(action => action.id === id) as ControlAction

describe('classifyReply: the engine\'s words, as the spike saw them', () => {
  it('reads the real TaskStop success, the real TaskStop miss and the real SendMessage answers', () => {
    expect(classifyReply({ text: '{"message":"Successfully stopped task: acf991387298086c7 (sleeper)","task_type":"local_agent"}' })).toMatchObject({ ok: true, kind: 'done', text: expect.stringContaining('Successfully stopped task') })
    expect(classifyReply({ text: 'Error: No task found with ID: nonexistent', isError: true })).toMatchObject({ ok: false, kind: 'error', text: expect.stringContaining('No task found') })
    expect(classifyReply({ result: { success: true, message: 'Message queued for delivery to sleeper at its next tool round.' } })).toMatchObject({ ok: true, text: expect.stringContaining('queued') })
    expect(classifyReply({ text: '{"success":false,"message":"No agent named \'nobody\' is reachable.\\nUse ListAgents to see everyone you can message."}' })).toMatchObject({ ok: false, kind: 'error', text: expect.stringContaining('nobody') })
  })

  it('a deny is a refusal, not an error; a missing bridge says so; nothing is invented for an empty answer', () => {
    expect(classifyReply({ deny: 'Permission to use TaskStop has been denied' })).toMatchObject({ ok: false, kind: 'denied', text: expect.stringContaining('the engine refused it') })
    expect(classifyReply(undefined)).toMatchObject({ ok: false, kind: 'not-wired' })
    expect(classifyReply({})).toMatchObject({ ok: true, text: 'the engine answered ok with no text' })
  })

  it('masks a credential and strips escapes from what the engine said', () => {
    const said = classifyReply({ text: 'failed \u001b[31mred\u001b[0m token=sk-live-AAAABBBBCCCCDDDD', isError: true }).text

    expect(said).not.toContain('sk-live')
    expect(said).not.toContain('\u001b')
  })

  it('callTool turns a rejection into an error outcome and never throws', async () => {
    const { input } = harness({ reject: 'no such tool' })

    expect(await callTool(input.bridge, { tool: 'Nope' })).toMatchObject({ ok: false, kind: 'error', text: 'no such tool' })
    expect(await callTool({}, { tool: 'TaskStop' })).toMatchObject({ kind: 'not-wired' })
  })

  it('permissionOf reports the engine\'s verdict, and says so when it cannot ask', async () => {
    expect((await permissionOf(harness({ verdict: 'deny' }).input.bridge, 'TaskStop', {})).text).toContain('deny (Bash(*) is denied)')
    expect(await permissionOf({}, 'TaskStop', {})).toMatchObject({ decision: 'unknown' })
  })
})

describe('Stop', () => {
  it('shows the exact call, runs it through the host after the permission check, and reports the engine\'s own words', async () => {
    const { input, calls } = harness()
    const stop = by(controlActions(input), 'stop-agent')

    expect(stop.proof).toBe('verified')
    expect(stop.call).toBe(`TaskStop {"task_id":"${AGENT}"}`)
    expect(stop.spec?.declared).toBe('write')
    expect(calls.tool).toHaveLength(0)

    await stop.spec?.run?.()

    expect(calls.check).toEqual([{ tool: 'TaskStop', input: { task_id: AGENT } }])
    expect(calls.tool).toEqual([{ tool: 'TaskStop', task_id: AGENT }])
    expect(calls.said).toEqual([expect.objectContaining({ ok: true, detail: expect.stringContaining('Successfully stopped task') })])
    expect(calls.said[0]?.detail).toContain('re-read the run')
  })

  it('the run stop is labelled unverified (the spike never stopped a workflow run) and calls TaskStop with the run id', async () => {
    const { input, calls } = harness()
    const stop = by(controlActions(input), 'stop-run')

    expect(stop.proof).toBe('unverified')
    expect(stop.proofText).toMatch(/not tried/)
    await stop.spec?.run?.()
    expect(calls.tool).toEqual([{ tool: 'TaskStop', task_id: RUN }])
  })

  it('an engine "deny" from the permission check stops it before any call: no other route is tried', async () => {
    const { input, calls } = harness({ verdict: 'deny' })

    await by(controlActions(input), 'stop-agent').spec?.run?.()

    expect(calls.tool).toHaveLength(0)
    expect(calls.said[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/permission check: deny.*no other route is tried/) })
  })

  it('a deny answered by the call itself is shown the same way, and an unknown task is shown as an error', async () => {
    const denied = harness({ reply: { deny: 'Claude requested permissions to stop which is blocked' } })

    await by(controlActions(denied.input), 'stop-agent').spec?.run?.()
    expect(denied.calls.said[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/engine refused it.*no other route/) })

    const missing = harness({ reply: { text: 'Error: No task found with ID: x', isError: true } })

    await by(controlActions(missing.input), 'stop-agent').spec?.run?.()
    expect(missing.calls.said[0]).toMatchObject({ ok: false, detail: expect.stringContaining('No task found') })
  })

  it('a host with no tool bridge has no stop spec and says why; an id the engine would not accept is not passed on', () => {
    const none = controlActions(harness({ noTool: true }).input)

    expect(by(none, 'stop-agent').spec).toBeNull()
    expect(by(none, 'stop-agent').why).toMatch(/does not bind tool calls/)
    expect(by(controlActions(harness({ agent: agent({ id: 'a b;rm' }) }).input), 'stop-agent').spec).toBeNull()
    expect(ENGINE_ID.test('a1')).toBe(false)
    expect(by(controlActions(harness({ agent: null }).input), 'stop-agent').why).toMatch(/pick an agent/)
  })
})

describe('Message', () => {
  it('needs the typed sentence, then shows the exact SendMessage, labelled queued-only', async () => {
    expect(by(controlActions(harness().input), 'message').spec).toBeNull()
    expect(by(controlActions(harness().input), 'message').why).toMatch(/type the guidance/)

    const { input, calls } = harness({ text: 'use the cache', reply: { result: { success: true, message: 'Message queued for delivery to sleeper at its next tool round.' } } })
    const message = by(controlActions(input), 'message')

    expect(message.proof).toBe('queued-only')
    expect(message.call).toBe(`SendMessage {"to":"${AGENT}","message":"use the cache"}`)
    await message.spec?.run?.()
    expect(calls.tool).toEqual([{ tool: 'SendMessage', to: AGENT, message: 'use the cache', summary: 'use the cache' }])
    expect(calls.said[0]).toMatchObject({ ok: true, detail: expect.stringMatching(/queued.*queued is not delivered/) })
  })

  it('an unreachable agent is an error that offers the prompt-box text, not a success', async () => {
    const { input, calls } = harness({ text: 'hello', reply: { text: '{"success":false,"message":"No agent named x is reachable."}' } })

    await by(controlActions(input), 'message').spec?.run?.()
    expect(calls.said[0]).toMatchObject({ ok: false, detail: expect.stringContaining('prepare as text') })
  })

  it('a text with a credential in it, or a leading dash, is not sent at all', () => {
    expect(by(controlActions(harness({ text: 'use token=sk-live-AAAABBBBCCCCDDDD' }).input), 'message').why).toMatch(/credential/)
    expect(by(controlActions(harness({ text: '--force' }).input), 'message').why).toMatch(/dash/)
  })

  it('the prompt-box prefill calls nothing and fills the relay text, saying the main session acts on it', async () => {
    const { input, calls } = harness({ text: 'use the cache' })
    const text = by(controlActions(input), 'text')

    expect(text.proof).toBe('prefill')
    await text.spec?.run?.()
    expect(calls.tool).toHaveLength(0)
    expect(calls.fill).toEqual([relayText(run(), agent(), 'use the cache')])
    expect(calls.fill[0]).toContain('with SendMessage')
    expect(calls.said[0]).toMatchObject({ ok: true, detail: expect.stringContaining('press Enter') })
  })
})

describe('Redirect: two halves, said as two', () => {
  it('stops the run, then prepares the resume text with the guidance; the card shows both', async () => {
    const { input, calls } = harness({ text: 'prefer the cache' })
    const redirect = by(controlActions(input), 'redirect')

    expect(redirect.call).toContain(`TaskStop {"task_id":"${RUN}"}, then into the prompt box`)
    expect(redirect.spec?.note).toMatch(/only when the stop worked/)
    await redirect.spec?.run?.()
    expect(calls.tool).toEqual([{ tool: 'TaskStop', task_id: RUN }])
    expect(calls.fill).toHaveLength(1)
    expect(calls.fill[0]).toContain(`resumeFromRunId: "${RUN}"`)
    expect(calls.fill[0]).toContain('prefer the cache')
    expect(calls.fill[0]).toContain('/home/u/.claude/projects/-p/sess/workflows/scripts/my flow-wf_abc12345.js')
    expect(calls.said[0]).toMatchObject({ ok: true, detail: expect.stringContaining('press Enter there to resume') })
  })

  it('when the stop fails the resume text is NOT prepared (a resume against a live run would fight it)', async () => {
    const { input, calls } = harness({ text: 'x y', reply: { text: 'Error: No task found', isError: true } })

    await by(controlActions(input), 'redirect').spec?.run?.()
    expect(calls.fill).toHaveLength(0)
    expect(calls.said[0]?.ok).toBe(false)
  })

  it('resumeText refuses a run dir outside the projects folder (it names the scripts folder generically instead)', () => {
    expect(resumeText(run({ dir: '/etc/../x' }), null, 'g', () => false)).toContain('<session>/workflows/scripts')
    expect(resumeText(run({ id: 'a b' }), null, 'g', () => true)).toBeNull()
  })
})

describe('a ruflo swarm run', () => {
  it('has no Claude task to stop or message: the page says where its own verbs are, and offers no spec', () => {
    const actions = controlActions(harness({ run: run({ kind: 'ruflo-swarm' }) }).input)

    expect(actions).toHaveLength(1)
    expect(actions[0]?.spec).toBeNull()
    expect(actions[0]?.proofText).toMatch(/not a Claude Code task/)
  })
})

/**
 * Stop, Message and Redirect for a running workflow run or agent (ADR-465). Pure: the run, the agent and the bridge in, `ActionSpec`s out.
 * Each spec goes through the page's confirm card, which shows the EXACT engine call; the call itself is `$.tool.call` (through the host's
 * `toolCall`), so the engine's permission check and dialog decide it, never this file. What the spike proved, and no more:
 *
 *   TaskStop     verified on a real background agent (task_id = the agent's id): "Successfully stopped task", then status "killed".
 *                For a workflow run's id, or the id of an agent inside a workflow run, no one has tried it: the engine's own answer is shown.
 *   SendMessage  verified only to QUEUE a message for a named or id-addressed background agent in this session
 *                ("Message queued for delivery ... at its next tool round"). Delivery and being acted on are not verified.
 *   Redirect     the stop above (same proof), then the resume text prepared in the prompt box (never sent): two halves, said as two.
 *
 * A refusal (`deny`) is shown and nothing else is tried: no other route is used to do what the engine would not. A failed or unreachable
 * call keeps the person's choice: the same words as a prepared prompt are one button away. Everything drawn is masked first.
 */
import type { ActionSpec } from '../actions'
import type { Host, ToolReply } from '../host'
import { cleanText } from './wf-clean'
import { guardText } from './wf-guide'
import { idOf, plain } from './parse'
import type { WfAgent, WfRun } from './workflows'

/** What the control actions need of the host; a test passes fakes. */
export type Bridge = Pick<Host, 'toolCall' | 'toolCheck'>

export type ControlKind = 'stop-agent' | 'stop-run' | 'message' | 'redirect' | 'text'
/** How much of the path is known: what the spike showed, or what nobody has tried. */
export type Proof = 'verified' | 'queued-only' | 'unverified' | 'prefill'

export type ControlAction = {
  id: ControlKind
  label: string
  /** The exact engine call, or the exact prepared text. */
  call: string
  proof: Proof
  /** In words, what is known about this path. */
  proofText: string
  spec: ActionSpec | null
  /** Said on the confirm row when `spec` is null. */
  why: string
}

export type ControlInput = {
  run: WfRun
  agent: WfAgent | null
  /** The sentence typed for Message and Redirect. */
  text: string
  bridge: Bridge & Pick<Host, 'fillPrompt'>
  /** Says the result on the outcome row (and draws again). */
  report: (label: string, ok: boolean, detail: string) => void
  isRunPath: (path: string) => boolean
}

/** The id of the inspector tab this module registers (views/wf-control.ts); a page that says where Stop is done asks whether it exists. */
export const CONTROL_TAB = 'control'

/** The sentence a page says about stopping and messaging a workflow, true to whether the control tab is switched on. */
export const controlLine = (isOn: boolean): string => (isOn ? 'Stop, message and redirect: the control tab calls the engine\'s own TaskStop and SendMessage, behind its permission check, after showing the exact call.' : 'Stop and message from this page need the control tab, which is not switched on in this build: use Claude Code\'s Workflows panel or TaskStop.')

/** An id the engine hands out is letters, digits, dash and underscore; anything else is not passed to a tool. */
export const ENGINE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{5,63}$/

const CAP = 240
const stopCall = (id: string): string => `TaskStop ${JSON.stringify({ task_id: id })}`
const messageCall = (to: string, message: string): string => `SendMessage ${JSON.stringify({ to, message })}`

/** The fields a tool's answer carries, wherever it put them: the structured result first, then JSON in the text. */
function fieldsOf(reply: ToolReply): Record<string, unknown> | null {
  const raw = reply.result ?? (typeof reply.text === 'string' && reply.text.trim().startsWith('{') ? safeParse(reply.text) : undefined)

  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export type Outcome = { ok: boolean; kind: 'done' | 'denied' | 'error' | 'not-wired'; text: string }

/** One answer, in the words the outcome row shows: masked, one line, capped. `deny` is a refusal; `isError` and `success:false` are failures. */
export function classifyReply(reply: ToolReply | undefined): Outcome {
  if (reply === undefined) return { ok: false, kind: 'not-wired', text: 'the host does not bind tool calls here' }
  if (typeof reply.deny === 'string') return { ok: false, kind: 'denied', text: `the engine refused it: ${clean(reply.deny)}` }

  const fields = fieldsOf(reply)
  const said = clean(typeof fields?.message === 'string' ? fields.message : (reply.text ?? (reply.result === undefined ? '' : JSON.stringify(reply.result))))

  if (reply.isError === true || fields?.success === false || fields?.isError === true) return { ok: false, kind: 'error', text: said === '' ? 'the engine answered with an error' : said }

  return { ok: true, kind: 'done', text: said === '' ? 'the engine answered ok with no text' : said }
}

const clean = (value: string): string => cleanText(plain(value, 400)).slice(0, CAP)

/** Calls one tool and classifies the answer; a rejection (no such tool, aborted) is an error outcome, never thrown. */
export async function callTool(bridge: Bridge, input: { tool: string } & Record<string, unknown>): Promise<Outcome> {
  if (bridge.toolCall === undefined) return classifyReply(undefined)

  try {
    return classifyReply(await bridge.toolCall(input))
  } catch (error) {
    return { ok: false, kind: 'error', text: clean(error instanceof Error ? error.message : String(error)) || 'the call was rejected' }
  }
}

/** The engine's permission verdict now, in a phrase; a missing check says so rather than guessing "allow". */
export async function permissionOf(bridge: Bridge, tool: string, input: unknown): Promise<{ decision: 'allow' | 'ask' | 'deny' | 'unknown'; text: string }> {
  if (bridge.toolCheck === undefined) return { decision: 'unknown', text: 'the host cannot ask the engine for its permission verdict; the call is still checked when it runs' }

  try {
    const verdict = await bridge.toolCheck(tool, input)

    return { decision: verdict.decision, text: `the engine's permission check: ${verdict.decision}${verdict.reason === undefined ? '' : ` (${clean(verdict.reason)})`}` }
  } catch {
    return { decision: 'unknown', text: 'the permission check could not be asked' }
  }
}

/** Text for the main session after a stop: resume the run with the guidance added. Never sent: the person presses Enter. */
export function resumeText(run: WfRun, agent: WfAgent | null, text: string, isRunPath: (path: string) => boolean): string | null {
  const session = run.dir === undefined || !isRunPath(run.dir) ? null : run.dir.replace(/\/subagents\/workflows\/[^/]+\/?$/, '')
  const where = session === null ? 'its scripts folder (<session>/workflows/scripts)' : `${session}/workflows/scripts/${plain(run.name, 40)}-${plain(run.id, 40)}.js`

  return idOf(run.id) === null ? null : `Claude Code workflow run ${run.id} (${plain(run.name, 40)}${agent === null ? '' : `, agent "${plain(agent.label, 60)}"`}) was stopped from the ruflo console. Resume it with Workflow({ scriptPath: <${where}>, resumeFromRunId: "${run.id}" }) after adding this guidance to the affected agent's prompt: ${text}`
}

/** The prompt that asks the main session to deliver a message to a workflow agent, for where the console cannot. */
export const relayText = (run: WfRun, agent: WfAgent | null, text: string): string => `Send this to ${agent === null ? `the agents of Claude Code workflow run ${run.id}` : `agent "${plain(agent.label, 60)}" (${agent.id}) of workflow run ${run.id}`} with SendMessage, then tell me what the tool answered: ${text}`

const prefillSpec = (input: ControlInput, label: string, prompt: string, note: string): ActionSpec => ({
  label,
  args: [],
  shows: `into the prompt box, not sent: ${prompt.slice(0, 200)}`,
  expect: 'the text in the prompt box (it is not sent)',
  note,
  run: async () => {
    const isFilled = await Promise.resolve(input.bridge.fillPrompt(prompt)).catch(() => false)

    input.report(label, isFilled, isFilled ? 'prepared in the prompt box: press Enter there to send it' : 'there is no prompt box to fill here')
  },
})

/** A TaskStop of `id`: the permission is asked first, a refusal ends it, and the engine's own words are the result. */
function stopSpec(input: ControlInput, id: string, label: string, proofNote: string, after?: () => Promise<string>): ActionSpec {
  return {
    label,
    args: [],
    shows: stopCall(id),
    expect: 'the engine answers that the task was stopped',
    declared: 'write',
    note: `Calls the engine's TaskStop through the session's own permission check and dialog. ${proofNote} Stopped work is not undone by resuming: a resumed run starts its unfinished agents again.`,
    run: async () => {
      const verdict = await permissionOf(input.bridge, 'TaskStop', { task_id: id })

      if (verdict.decision === 'deny') return input.report(label, false, `${verdict.text}: nothing was stopped and no other route is tried`)

      const outcome = await callTool(input.bridge, { tool: 'TaskStop', task_id: id })

      if (!outcome.ok) return input.report(label, false, `${outcome.text}${outcome.kind === 'denied' ? ': nothing was stopped and no other route is tried' : ''}`)

      const tail = after === undefined ? '' : ` ${await after().catch(() => '')}`

      input.report(label, true, `${outcome.text}${tail} (re-read the run to see its state change)`)
    },
  }
}

/**
 * What the control tab offers for the cursor. Message and Redirect need the typed sentence; every action says what it sends, how far its
 * path is proven and what to do where it is not. A ruflo swarm agent is not a Claude task: its stop and notes are the page's own.
 */
export function controlActions(input: ControlInput): ControlAction[] {
  const { run, agent, bridge } = input
  const out: ControlAction[] = []
  const add = (entry: Omit<ControlAction, 'call'> & { call?: string }) => out.push({ ...entry, call: entry.call ?? entry.spec?.shows ?? 'nothing yet' })

  if (run.kind !== 'workflow') {
    out.push({ id: 'text', label: 'ruflo agents', call: 'nothing', proof: 'prefill', proofText: 'A ruflo swarm agent is not a Claude Code task: stop it with the page\'s stop (x); message it with the guide tab (broadcast, task note).', spec: null, why: 'pick a Claude Code workflow run for these' })

    return out
  }

  const runId = ENGINE_ID.test(run.id) ? run.id : null
  const agentId = agent !== null && ENGINE_ID.test(agent.id) ? agent.id : null
  const wired = bridge.toolCall !== undefined
  const typed = guardText(input.text, 300)
  const resume = typed.ok ? resumeText(run, agent, typed.text, input.isRunPath) : null

  add({
    id: 'stop-agent',
    label: agent === null ? 'stop the agent' : `stop agent ${clean(agent.label).slice(0, 30)}`,
    proof: 'verified',
    proofText: 'TaskStop worked on a real background agent (task_id = its id; its status became killed). An agent inside a workflow run has not been tried: the engine says.',
    spec: !wired ? null : agentId === null ? null : stopSpec(input, agentId, `stop agent ${clean(agent?.label ?? agentId).slice(0, 40)}`, 'Proven on a background Agent-tool agent; for an agent of a workflow run the engine\'s answer is the proof.'),
    why: !wired ? 'this host does not bind tool calls: prepare the text instead' : agent === null ? 'pick an agent first (the cursor)' : 'that agent\'s id is not one the engine can be given',
  })

  add({
    id: 'stop-run',
    label: `stop the whole run ${clean(run.name).slice(0, 30)}`,
    proof: 'unverified',
    proofText: 'TaskStop with a workflow run\'s id was not tried in the spike. The call is real and permission-checked; the engine\'s answer, and the run read again, say whether it took.',
    spec: !wired || runId === null ? null : stopSpec(input, runId, `stop workflow run ${clean(run.name).slice(0, 40)}`, 'Not proven for a workflow run id: the engine may answer that no such task exists.'),
    why: !wired ? 'this host does not bind tool calls: stop it in Claude Code\'s Workflows panel' : 'that run\'s id is not one the engine can be given',
  })

  if (!typed.ok) {
    add({ id: 'message', label: 'message the agent', proof: 'queued-only', proofText: 'SendMessage queued a message for a running named agent in this session; whether it was delivered and acted on was not verified.', spec: null, why: typed.why })
    add({ id: 'redirect', label: 'redirect: stop, then resume with guidance', proof: 'unverified', proofText: 'Half one is the stop (see above); half two is text prepared in your prompt box.', spec: null, why: typed.why })

    return out
  }

  const to = agentId
  const messageSpec: ActionSpec | null =
    !wired || to === null
      ? null
      : {
          label: `message agent ${clean(agent?.label ?? to).slice(0, 40)}`,
          args: [],
          shows: messageCall(to, typed.text),
          expect: 'the engine answers that the message was queued',
          declared: 'write',
          note: 'Calls the engine\'s SendMessage through the session\'s permission check. The spike showed it QUEUES a message at the agent\'s next tool round; it did not show the agent reads or acts on it. An agent that is not a running, reachable one is answered "not reachable" and nothing is sent.',
          run: async () => {
            const verdict = await permissionOf(bridge, 'SendMessage', { to, message: typed.text })

            if (verdict.decision === 'deny') return input.report('message agent', false, `${verdict.text}: nothing was sent and no other route is tried`)

            const outcome = await callTool(bridge, { tool: 'SendMessage', to, message: typed.text, summary: typed.text.slice(0, 40) })

            input.report('message agent', outcome.ok, outcome.ok ? `${outcome.text} (queued is not delivered: the agent may never act on it)` : `${outcome.text}${outcome.kind === 'denied' ? ': nothing was sent and no other route is tried' : ' (use "prepare as text" to ask the main session to relay it)'}`)
          },
        }

  add({ id: 'message', label: agent === null ? 'message the agent' : `message ${clean(agent.label).slice(0, 30)}`, proof: 'queued-only', proofText: 'Queued for delivery at the agent\'s next tool round (verified on a named background agent); delivery and effect are not.', spec: messageSpec, why: !wired ? 'this host does not bind tool calls: prepare the text instead' : agent === null ? 'pick an agent first (the cursor)' : 'that agent\'s id is not one the engine can be given' })

  const redirectSpec: ActionSpec | null =
    !wired || runId === null || resume === null
      ? null
      : stopSpec(input, runId, `redirect run ${clean(run.name).slice(0, 36)}: stop, then prepare the resume`, 'Half one of two: the stop. Half two prepares the resume text in your prompt box, only when the stop worked.', async () => {
          const isFilled = await Promise.resolve(bridge.fillPrompt(resume)).catch(() => false)

          return isFilled ? 'The resume text with your guidance is in the prompt box: press Enter there to resume.' : 'There is no prompt box to put the resume text in.'
        })

  add({ id: 'redirect', label: 'redirect: stop, then resume with guidance', proof: 'unverified', proofText: 'Half one is the stop (TaskStop, proof as the run stop); half two is text prepared in your prompt box and never sent for you.', spec: redirectSpec === null ? null : { ...redirectSpec, shows: `${stopCall(runId ?? '')}, then into the prompt box: ${resume?.slice(0, 120) ?? ''}` }, why: !wired ? 'this host does not bind tool calls: prepare the text instead' : 'this run has no id the engine can be given' })

  const prompt = relayText(run, agent, typed.text)

  add({ id: 'text', label: 'prepare as text instead', proof: 'prefill', proofText: 'Nothing is called: the words wait in your prompt box and Claude (the main session) acts on them when you press Enter, under its own permissions.', spec: prefillSpec(input, 'prepare the message for the main session', prompt, 'Text only: it goes to the main Claude session, which would use SendMessage itself.'), why: 'nothing to prepare' })

  return out
}

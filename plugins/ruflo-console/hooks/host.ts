import type { CommandSpec, HookStream, PaneOpenArgs, ProcessRunResult, ProcessSpawnChunk, ProcessSpawnResult, Timer, UiBlitArgs } from 'claude-code'

import type { ReaderFs } from './data/files'
import type { RufloRoute, RufloSnapshot } from '../types'

/** What `$.ui.open` answers: drawn, or held back with the reason. A build that answers nothing has drawn it. */
export type OpenResult = { isPlaced: boolean; reason?: string } | void

/**
 * The engine as `session.start` bound it. Every later hook, timer and button reaches the engine through this, so the
 * controller is plain functions over an interface a test can stand in for. Any member may be refused (an administrator
 * removed the affordance, a policy mod said no): every caller catches, and a refusal is a missing fact, never a crash.
 */
export type Host = {
  fs: ReaderFs
  every: (ms: number, fn: () => void) => Timer
  after: (ms: number, fn: () => void) => Timer
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  invalidate: () => void
  /** Moves a pane's focus ring onto an element it drew (a field), while the pane holds the keys. */
  focus: (paneId: string, key: string) => Promise<unknown>
  /** Fire and forget: a blit resolves only once painted, and blits between frames fold anyway. */
  blit: (args: UiBlitArgs) => void
  openPane: (pane: PaneOpenArgs) => Promise<OpenResult>
  closePane: (id: string) => Promise<void>
  panes: () => Promise<readonly { id: string; isShown: boolean; isFocused: boolean }[]>
  registerCommand: (spec: CommandSpec) => Promise<unknown>
  run: (argv: readonly string[], timeoutMs: number, stdin?: string) => Promise<ProcessRunResult>
  /** Starts a command and streams what it writes; `input` goes to its stdin, which is then closed. */
  spawn: (argv: readonly string[], input?: string) => HookStream<ProcessSpawnChunk, ProcessSpawnResult>
  usage: () => Promise<{ costUsd?: number; contextPercent?: number }>
  /** The ruflo / claude-flow MCP tools the model can call now, and the servers they come from. */
  rufloTools: () => Promise<{ tools: number; servers: string[] }>
  settings: () => Promise<unknown>
  home: () => Promise<string | undefined>
  configDir: () => Promise<string | undefined>
  /** This plugin's folder: where its own files (the command catalog) are. */
  pluginRoot: string
  rufloSnapshot: () => Promise<RufloSnapshot>
  rufloRoute: () => Promise<RufloRoute | null>
  rufloSegment: (text: string | null) => Promise<void>
  /** Submits a prompt to the primary Claude session as a visible turn of its own (once idle). */
  submitPrompt: (text: string) => Promise<void>
  /** Puts text in the prompt box as the draft (the person presses Enter); false where there is no box. */
  fillPrompt: (text: string) => Promise<boolean>
  /** The names of the slash commands the session offers now (built-in, plugin and MCP alike). */
  listCommands: () => Promise<string[]>
  /** Runs a slash command as if typed (built-in, plugin or MCP); queued until the session is idle. */
  runSlash: (command: string, args: string) => Promise<{ text?: string } | void>
}

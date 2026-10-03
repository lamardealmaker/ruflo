import type { RenderElement } from 'claude-code'

import { VIEWS, type ViewId } from '../state'
import { barParts } from './bar'
import { clip, col, isBbs, row, text, THEME, type Ctx } from './common'
import { missionStrip } from './mission-control'

type Item = { label: string; go: string }

/** The keys of the entries that are not views. */
const COMMAND_KEYS: Record<string, string> = { palette: 'p', help: 'h', close: 'O' }
const keyOf = (item: Item): string => COMMAND_KEYS[item.go] ?? VIEWS.find(view => view.id === item.go)?.key ?? '·'

/**
 * The board's menus: four groups, each split into short sub-sections, the way the old BBS main menus grouped their
 * commands. Keys are the pane's own hotkeys; an area without one (`·`) is reached by its name at the prompt. An
 * entry for a view this build does not have is left out.
 */
const GROUPS: readonly { title: string; sections: readonly { name: string; items: readonly Item[] }[] }[] = [
  {
    title: 'SWARM',
    sections: [
      { name: 'mission', items: [{ label: 'Missions', go: 'missions' }] },
      { name: 'live', items: [{ label: 'Overview', go: 'overview' }, { label: 'Swarm Topology', go: 'swarm' }, { label: 'Hive-Mind', go: 'hive' }] },
      { name: 'work', items: [{ label: 'Claims Board', go: 'claims' }, { label: 'Approvals', go: 'approvals' }, { label: 'Automation', go: 'automate' }] },
      { name: 'watch', items: [{ label: 'Agent Timeline', go: 'timeline' }, { label: 'Event Stream', go: 'events' }] },
    ],
  },
  {
    title: 'INTELLIGENCE',
    sections: [
      { name: 'learn', items: [{ label: 'Learning', go: 'learning' }, { label: 'Neural', go: 'neural' }, { label: 'MetaHarness', go: 'metaharness' }, { label: 'Self-Evolution', go: 'evolve' }] },
      { name: 'remember', items: [{ label: 'Memory Lab', go: 'memory' }, { label: 'Vector Lab', go: 'vector' }] },
      { name: 'spend', items: [{ label: 'Cost & Budget', go: 'cost' }, { label: 'Performance', go: 'perf' }] },
    ],
  },
  {
    title: 'SAFETY & OPS',
    sections: [
      { name: 'protect', items: [{ label: 'Security & Doctor', go: 'secure' }] },
      { name: 'build', items: [{ label: 'Dev Tools', go: 'devtools' }] },
    ],
  },
  {
    title: 'NETWORK & EXTEND',
    sections: [
      { name: 'federate', items: [{ label: 'Federation', go: 'federation' }, { label: 'x.ruv.io Board', go: 'xruv' }] },
      { name: 'extend', items: [{ label: 'Plugins & Mods', go: 'plugins' }, { label: 'Skills', go: 'skills' }, { label: 'Plugin Catalog', go: 'market' }] },
    ],
  },
  {
    title: 'TOOLS',
    sections: [
      { name: 'run', items: [{ label: 'AI Terminal', go: 'terminal' }, { label: 'Settings', go: 'settings' }, { label: 'Command Palette', go: 'palette' }] },
      { name: 'session', items: [{ label: 'Help', go: 'help' }, { label: 'Log Off', go: 'close' }] },
    ],
  },
]

const COMMANDS = new Set(['palette', 'help', 'close'])

const mmss = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))

  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The main menu, the board's front door: where the cockpit lands when it opens in the BBS look. The name in block
 * art comes from the frame; under it the host line, four boxed groups whose entries go where their keys go, a status
 * bar in the old modem style with this project's live facts, and a prompt that takes a key or a name and Enter.
 */
export function menuView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const project = state.cwd.split('/').filter(Boolean).at(-1) ?? 'ruflo'
  const go = (item: Item) => () => (item.go === 'palette' ? ctx.act.palette('all') : item.go === 'help' ? ctx.act.help() : item.go === 'close' ? ctx.act.close() : ctx.act.view(item.go as ViewId))
  const isShown = (item: Item) => COMMANDS.has(item.go) || VIEWS.some(view => view.id === item.go)
  // Two boxes a row where the pane is wide enough, else one; each box is a group with its own border.
  const perRow = ctx.columns >= 60 ? 2 : 1
  const width = Math.max(24, Math.floor((ctx.columns - 1) / perRow) - 1)
  const rows: RenderElement[] = []

  rows.push(text(ctx, ' '))
  rows.push(...missionStrip(ctx))

  // Each group a bordered box: ▓▒░ TITLE ░▒▓ on top, then its sub-sections, each a dim ── name ── rule and its items.
  const box = (group: (typeof GROUPS)[number]) =>
    ctx.kit.Box({
      flexDirection: 'column',
      width,
      borderStyle: 'single',
      borderColor: isBbs() ? '#d0d0d0' : 'inactive',
      paddingX: 1,
      key: `menu-${group.title}`,
      children: [
        ctx.kit.Text({ bold: true, color: THEME.head, wrap: 'truncate-end', children: clip(`▓▒░ ${group.title} ░▒▓`, width - 4) }),
        ...group.sections.flatMap(section => {
          const items = section.items.filter(isShown)

          return items.length === 0
            ? []
            : [
                ctx.kit.Text({ color: THEME.info, dimColor: true, wrap: 'truncate-end', children: clip(`── ${section.name} ${'─'.repeat(Math.max(0, width - section.name.length - 8))}`, width - 4) }),
                ...items.map(item =>
                  ctx.kit.Box({
                    flexDirection: 'row',
                    key: `mi-${item.go}`,
                    children: [
                      ctx.kit.Text({ bold: true, color: THEME.ok, children: ` (${keyOf(item)})` }),
                      ctx.kit.Button({ key: `menu-go-${item.go}`, label: clip(item.label, width - 9), plain: true, onPress: go(item) }),
                    ],
                  }),
                ),
              ]
        }),
      ],
    })

  for (let i = 0; i < GROUPS.length; i += perRow) {
    rows.push(ctx.kit.Box({ flexDirection: 'row', gap: 1, key: `menu-row-${i}`, children: GROUPS.slice(i, i + perRow).map(box) }))
  }

  // The status bar under the box: the line, then what is live in this project, then how long the board has been open.
  const online = mmss(nowMs - (state.pane.bootAtMs > 0 ? state.pane.bootAtMs : state.loadedAtMs))
  const facts = barParts(state, nowMs).slice(0, 3)
  const line = ` ${state.snapshot?.isRufloProject === true ? 'Registered' : 'Unregistered'} │ ANSI-BBS │ 115200·N81 FDX`
  const right = ` Online ${online} `
  let room = Math.max(4, ctx.columns - right.length - line.length)

  rows.push(text(ctx, ' '))
  rows.push(
    ctx.kit.Box({
      flexDirection: 'row',
      backgroundColor: isBbs() ? '#8b1a1a' : undefined,
      key: 'menu-status',
      children: [
        ctx.kit.Text({ bold: true, color: '#ffd319', children: line }),
        // The live facts are links: a click goes to the view each is about.
        ...facts.flatMap((part, i) => {
          if (room <= 6) return []

          const label = clip(part.text, room - 3)

          room -= label.length + 3

          return [
            ctx.kit.Text({ bold: true, color: '#ffd319', children: ' │ ' }),
            part.go !== undefined
              ? ctx.kit.Button({ key: `status-${i}`, label, plain: true, onPress: () => ctx.act.view(part.go as ViewId) })
              : ctx.kit.Text({ bold: true, color: '#ffd319', children: label }),
          ]
        }),
        ctx.kit.Box({ flexGrow: 1, key: 'status-gap', children: [ctx.kit.Text({ children: ' ' })] }),
        ctx.kit.Text({ bold: true, color: '#ffd319', children: right }),
      ],
    }),
  )
  rows.push(text(ctx, ' '))
  rows.push(text(ctx, `T - ${online}`, { bold: true }))

  if (ctx.kit.Input !== undefined) {
    rows.push(
      ctx.kit.Input({
        key: 'menu-prompt',
        label: `(1:1) (ruflo: ${clip(project, 24)})`,
        placeholder: 'a key or a name, then Enter (? for help)',
        submitLabel: 'go',
        onSubmit: value => ctx.act.menu(value),
      }),
    )
  } else {
    rows.push(row(ctx, [text(ctx, `(1:1) (ruflo: ${clip(project, 24)}) : press a key from the menu`, { color: THEME.warn })]))
  }

  return col(ctx, rows, 'menu')
}

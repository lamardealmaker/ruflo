import type { RenderElement } from 'claude-code'

import { launchOf } from '../ask-claude'
import { VIEWS } from '../state'
import { clip, row, section, text, THEME, type Ctx } from './common'

const noteOf = (plugin: string): string => plugin.replace(/^ruflo-?/, '') || plugin

/**
 * The Launch section at the foot of a page: the slash commands of the ruflo plugins this section owns, each a button that asks first
 * and then runs in the main Claude UI (mid-turn it only fills the prompt box). Folded by default; nothing is drawn when the session
 * lists no command for this section's plugins.
 */
export function launchRows(ctx: Ctx): RenderElement[] {
  const view = ctx.state.view

  if (view === 'terminal' || view === 'agent' || !VIEWS.some(entry => entry.id === view)) return []

  const groups = launchOf(ctx.state, view)

  if (groups.length === 0) return []

  const total = groups.reduce((sum, group) => sum + group.slashes.length, 0)
  const body = groups.flatMap(group => [
    ctx.kit.Text({ bold: true, color: THEME.ok, children: ` ${noteOf(group.plugin)}` }),
    ...group.slashes.map(slash =>
      row(
        ctx,
        [
          ctx.kit.Button({ key: `launch-${slash}`, label: `   /${clip(slash, Math.max(20, ctx.columns - 24))} `, plain: true, onPress: () => ctx.act.ask.launch(slash) }),
          ctx.kit.Button({ key: `launch-run-${slash}`, label: ' ▸ run', plain: true, dimColor: true, onPress: () => ctx.act.ask.launch(slash) }),
        ],
        `launch-row-${slash}`,
      ),
    ),
  ])

  return section(ctx, 'launch', 'Launch', `${total} command${total === 1 ? '' : 's'} from ${groups.length} plugin${groups.length === 1 ? '' : 's'}, run in the Claude UI (asks first)`, [...body, text(ctx, ' each starts a Claude Code turn: it asks first, and mid-turn only fills the prompt box', { dimColor: true })], false)
}

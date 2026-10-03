import type { RenderElement } from 'claude-code'

import { EXPECTED_IN_MARKET, RUFLO_MARKET } from '../data/snapshot'
import { PLUGIN_NAME } from '../state'
import { ago, button, col, kv, picture, rule, starts, text, THEME, type Ctx } from './common'

const WEEK = 7 * 86_400_000

/**
 * Installed ruflo plugins and whether the marketplace clone they came from is current. A clone that does not list the
 * plugins this repository publishes (ruflo-mods first) is stale: `/plugin install ruflo-mods@ruflo` then fails with
 * "not found", a real report today. The fix is named, never run.
 */
export function pluginsView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const facts = state.snapshot?.plugins ?? null
  const rows: RenderElement[] = [rule(ctx, 'Marketplace', RUFLO_MARKET)]

  if (facts === null) {
    return text(ctx, 'reading plugin records…', { dimColor: true })
  }

  const market = facts.markets?.find(entry => entry.name === RUFLO_MARKET) ?? null

  if (state.configDir === null) {
    rows.push(text(ctx, 'n/a — neither CLAUDE_CONFIG_DIR nor HOME is readable to this mod, so the plugin records cannot be found', { dimColor: true }))
  } else if (market === null) {
    rows.push(kv(ctx, 'ruflo clone', facts.markets === null ? 'n/a — no known_marketplaces.json' : 'not added yet'))
    rows.push(starts(ctx, 'The ruflo marketplace is not added to Claude Code, so its plugins cannot be installed or updated.', ['marketplace']))
  } else {
    const isOld = market.updatedMs !== undefined && nowMs - market.updatedMs > WEEK

    rows.push(kv(ctx, 'ruflo clone', `pulled ${ago(market.updatedMs, nowMs)} · auto-update ${market.isAutoUpdate ? 'on' : 'off'} · lists ${facts.rufloOffered?.length ?? 'n/a'} plugins`, isOld ? THEME.warn : undefined))

    if (facts.missingFromClone.length > 0) {
      rows.push(text(ctx, `STALE: the clone does not list ${facts.missingFromClone.join(', ')} — run /plugin marketplace update ${RUFLO_MARKET}`, { bold: true, color: THEME.bad }))
    } else if (facts.rufloOffered === null) {
      rows.push(text(ctx, "n/a — the clone's marketplace.json is not readable, so freshness is unknown", { dimColor: true }))
    } else {
      rows.push(text(ctx, `current: lists ${EXPECTED_IN_MARKET.join(', ')}`, { color: THEME.ok }))
    }
  }

  const ruflo = (facts.installed ?? []).filter(plugin => plugin.marketplace === RUFLO_MARKET)
  const enabled = ruflo.filter(plugin => facts.enabled.has(plugin.id)).length

  rows.push(rule(ctx, 'Installed', facts.installed === null ? 'n/a' : `${ruflo.length} ruflo · ${enabled} enabled · ${(facts.installed ?? []).length} total`))

  rows.push(picture(ctx, 'health', `${ruflo.length} ruflo plugins installed`))
  rows.push(text(ctx, 'columns: I installed · E enabled · C listed by the marketplace clone · M mod loaded here — ■ yes (green) / no (red), · unknown', { dimColor: true }))

  const gone = ruflo.filter(plugin => facts.rufloOffered !== null && !facts.rufloOffered.includes(plugin.name))

  if (gone.length > 0) rows.push(text(ctx, `installed but gone from the clone: ${gone.map(plugin => plugin.name).join(', ')}`, { color: THEME.warn }))

  rows.push(rule(ctx, 'Mods', 'function hooks'))
  rows.push(kv(ctx, PLUGIN_NAME, 'loaded (you are reading it)', THEME.ok))
  rows.push(kv(ctx, 'ruflo-mods', state.ruflo.snapshot !== null ? 'seated ($.ruflo answers)' : 'not seated in this session', state.ruflo.snapshot !== null ? THEME.ok : undefined))

  for (const mod of state.mods.slice(-5)) {
    rows.push(kv(ctx, mod.name, `${mod.isLoaded ? 'loaded' : `REFUSED: ${mod.reason ?? 'no reason given'}`} · ${mod.provenance} · ${ago(mod.atMs, nowMs)}`, mod.isLoaded ? undefined : THEME.bad))
  }

  rows.push(button(ctx, 'plg-catalog', '▸ open the Plugin Catalog: every ruflo plugin, mod and skill', () => ctx.act.view('market')))
  rows.push(text(ctx, 'mods list: those registered after the console loaded (the engine admits earlier ones unseen)', { dimColor: true }))

  return col(ctx, rows, 'plugins')
}

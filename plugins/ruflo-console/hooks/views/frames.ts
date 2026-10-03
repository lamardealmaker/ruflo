/**
 * The pictures of the view in front, by Raster key, for one instant. The render mounts them and the animation loop
 * blits them, both through `picturesOf`, so a frame is always the mounted size. Each picture's model is read from the
 * state here; the drawing itself is in ../gfx.
 */
import type { AuditTrend, HarnessScore, Intelligence } from '../data/cli'
import { recentByAgent } from '../data/events'
import { agentLabels } from '../data/parse'
import type { Snapshot } from '../data/snapshot'
import type { Channels, Peers, Roster } from '../data/cli'
import { pipelinePicture, radarPicture, samplesPicture, trendPicture, gaugePicture, type Stage } from '../gfx/charts'
import { loopPicture, loopStagesOf } from '../gfx/evolve'
import { flowModelOf, flowPicture, flowRows } from '../gfx/flow'
import { federationPicture, ganttPicture, heatmapPicture, type FedNode, type HealthRow, type Lane } from '../gfx/maps'
import { activityPicture, bannerPicture, bootPicture, titlePicture, curvePicture, headerPicture, PULSE_MS, topologyPicture, type TopoModel } from '../gfx/pictures'
import type { Grid } from '../gfx/raster'
import { PROBES, severityOf } from '../data/cli'
import { EXPECTED_IN_MARKET, RUFLO_MARKET } from '../data/snapshot'
import { isBooting, isCompactPane, VIEWS, type State } from '../state'
import { live } from './common'
import { hivePictures } from './hive'
import { openTasks } from './select'

export const MAX_NODES = 100
export const HEALTH_CHECKS = ['installed', 'enabled', 'clone', 'mod'] as const
import { watchOf } from '../watch'
/** The radar's axis words: the score's own dimension names, shortened to fit at a spoke's end. */
const AXIS: Record<string, string> = { harnessFit: 'fit', compileConfidence: 'compile', taskCoverage: 'coverage', toolSafety: 'safety', memoryUsefulness: 'memory' }

/** The swarm as a graph: the hive's queen leads where there is one, else the swarm itself stands at the root. */
export function topoModelOf(snapshot: Snapshot | null, pulses: Map<string, number> = new Map()): TopoModel | null {
  const swarm = snapshot?.swarm ?? null

  if (snapshot === null || (swarm === null && snapshot.hive === null && snapshot.agents.length === 0)) return null

  const members = swarm !== null && swarm.agentIds.length > 0 ? snapshot.agents.filter(agent => swarm.agentIds.includes(agent.id)) : snapshot.agents
  const labels = agentLabels(snapshot.agents)
  const leaderId = snapshot.hive?.queen ?? swarm?.id ?? 'swarm'
  const leaderPulse = pulses.get(leaderId)

  return {
    topology: swarm?.topology ?? snapshot.hive?.topology ?? 'hierarchical',
    nodes: [
      { id: leaderId, label: snapshot.hive?.queen !== undefined ? 'queen' : 'swarm', status: snapshot.hive?.queen !== undefined ? 'leader' : (swarm?.status ?? 'unknown'), isLeader: true, ...(leaderPulse !== undefined && { pulseAtMs: leaderPulse }) },
      ...members.slice(0, MAX_NODES - 1).map(agent => {
        const pulseAtMs = pulses.get(agent.id)

        return { id: agent.id, label: labels.get(agent.id) ?? agent.type, status: agent.status, isLeader: false, ...(pulseAtMs !== undefined && { pulseAtMs }) }
      }),
    ],
  }
}

/** Rows the topology graph takes: enough for a tree, more for a wide swarm or a circle. */
export const topologyRows = (columns: number, nodes: number): number => Math.min(24, Math.max(columns >= 90 ? 12 : 10, 8 + Math.ceil(nodes / Math.max(1, Math.floor(columns / 5))) * 3))

/** Each learning stage's count and source; null where nothing measures it. */
export function stagesOf(state: State): Stage[] {
  const snap = state.snapshot
  const intel = live<Intelligence>(state.probes.get('intelligence'))

  return [
    { name: 'RETRIEVE', count: snap?.neural?.trajectories ?? null, source: 'trajectories (neural/stats.json)' },
    { name: 'JUDGE', count: snap?.outcomes?.total ?? null, source: 'routed outcomes judged (routing-outcomes.json)' },
    { name: 'DISTILL', count: snap?.neural?.patterns ?? null, source: 'patterns learned (neural/stats.json)' },
    { name: 'CONSOLIDATE', count: intel?.ewcConsolidations ?? null, source: 'EWC consolidations (hooks_intelligence_stats)' },
  ]
}

/** Peers, own keys, channels and (when asked for) roster members, each with its trust. */
export function fedNodesOf(state: State): FedNode[] {
  const peers = live<Peers>(state.probes.get('peers'))?.peers ?? []
  const channels = live<Channels>(state.probes.get('channels'))?.channels ?? []
  const roster = state.options.federationNetwork ? (live<Roster>(state.probes.get('roster'))?.members ?? []) : []

  return [
    ...peers.map(peer => ({ label: peer.id, trust: 'pinned' as const, ...(peer.lastSyncMs !== undefined && { trafficAtMs: peer.lastSyncMs }) })),
    ...(state.snapshot?.federationNodes ?? []).map(node => ({ label: node, trust: 'key' as const })),
    ...channels.map(channel => ({ label: channel.name ?? channel.id, trust: 'channel' as const, ...(channel.atMs !== undefined && { trafficAtMs: channel.atMs }) })),
    ...roster.map(member => ({ label: member.name, trust: 'roster' as const })),
  ]
}

/** One row per ruflo plugin installed or offered: installed, enabled, in the clone, and (for mods) loaded here. */
export function healthRowsOf(state: State): HealthRow[] {
  const facts = state.snapshot?.plugins
  const installed = new Map((facts?.installed ?? []).filter(plugin => plugin.marketplace === RUFLO_MARKET).map(plugin => [plugin.name, plugin]))
  const names = [...new Set([...installed.keys(), ...(facts?.rufloOffered ?? []), ...EXPECTED_IN_MARKET])].sort()
  const mods: Record<string, boolean | null> = { 'ruflo-console': true, 'ruflo-mods': state.ruflo.snapshot !== null }

  return names.map(name => ({
    name: name.replace(/^ruflo-/, ''),
    cells: [installed.has(name), facts?.enabled.has(`${name}@${RUFLO_MARKET}`) ?? null, facts?.rufloOffered === null || facts === undefined ? null : facts.rufloOffered.includes(name), name in mods ? (mods[name] ?? null) : null],
  }))
}

/** The timeline's lanes over the last 15 minutes: ruflo agents' observed statuses and Claude Code's tool calls. */
export function lanesOf(state: State, nowMs: number): Lane[] {
  const from = nowMs - watchOf(state).rangeMs
  const labels = agentLabels(state.snapshot?.agents ?? [])
  const agents = (state.snapshot?.agents ?? []).slice(0, 24).map(agent => {
    const log = state.statusLog.get(agent.id) ?? []

    return {
      label: labels.get(agent.id) ?? agent.type,
      spans: log.map((entry, i) => ({ fromMs: Math.max(from, entry.atMs), toMs: log[i + 1]?.atMs ?? nowMs, busy: /busy|active|working/i.test(entry.status) })).filter(span => span.toMs >= from),
      ticks: [],
    }
  })
  const claude = [...state.toolsByAgent].slice(0, 6).map(([who, calls]) => ({ label: who === 'main' ? 'claude (main)' : `cc ${who.slice(-6)}`, spans: [], ticks: calls.map(call => call.atMs).filter(at => at >= from) }))

  return [...claude, ...agents]
}

/** When the score on screen was first drawn: the radar grows from there. Module-held, reset by a new value. */
const scoreShown = new WeakMap<object, number>()

export function picturesOf(state: State, columns: number, nowMs: number, t: number): Map<string, Grid> {
  const pictures = new Map<string, Grid>()
  const width = Math.max(20, Math.min(200, columns))
  const snapshot = state.snapshot

  // The BBS boot screen owns the pane for its first seconds; nothing else is drawn under it.
  if (isBooting(state, nowMs)) {
    pictures.set('boot', bootPicture(state.cwd.split('/').filter(Boolean).at(-1) ?? '', Math.min(width, 72), nowMs - state.pane.bootAtMs, state.probes.size, PROBES.length))

    return pictures
  }

  if (!isCompactPane(state) && state.view === 'menu') {
    const project = state.cwd.split('/').filter(Boolean).at(-1) ?? ''

    pictures.set('header', state.options.look === 'bbs' ? bannerPicture(project, Math.min(width, 72), t) : headerPicture(`◆ ruflo · ${project}`, Math.min(width, 40), t))
  }

  // BBS: every view's name as ANSI-style block art under the tabs, compact or not (the neon sign is the boot's alone).
  if (state.options.look === 'bbs') {
    const page = state.isHelp ? 'help' : state.palette.isOpen ? 'palette' : state.view === 'agent' ? 'agent' : (VIEWS.find(view => view.id === state.view)?.label ?? state.view)
    // The menu is the RUFLO board itself; every other page reads `RUFLO | PAGE`, the logo's style left of the page's name.
    const name = state.view === 'menu' && !state.isHelp && !state.palette.isOpen ? 'ruflo bbs' : `ruflo | ${page}`

    pictures.set('title', titlePicture(name, Math.min(width, 120), t))
  }

  switch (state.view) {
    case 'overview':
      pictures.set('activity', activityPicture([{ label: 'tool calls/5s', values: state.activity }, { label: 'state writes', values: state.writes }], width, t))
      break
    case 'swarm': {
      const model = topoModelOf(snapshot, recentByAgent(state.events, nowMs, PULSE_MS + 600))

      if (model !== null) pictures.set('topology', topologyPicture(model, width, topologyRows(width, model.nodes.length), t))
      break
    }
    case 'hive':
      for (const [key, grid] of hivePictures(state, width, nowMs, t)) pictures.set(key, grid)
      break
    case 'claims': {
      const cards = flowModelOf(snapshot?.claims ?? [], openTasks(state), snapshot?.agents ?? [], snapshot?.tasks ?? [])

      if (cards.length > 0) pictures.set('flow', flowPicture(cards, width, flowRows(cards), nowMs))
      break
    }
    case 'federation':
      pictures.set('fedmap', federationPicture(snapshot?.hasNostrKey === true ? 'this node' : 'this node (no key)', fedNodesOf(state), width, 11, t))
      break
    case 'plugins': {
      const rows = healthRowsOf(state)

      pictures.set('health', heatmapPicture(rows, HEALTH_CHECKS, width, Math.min(26, Math.ceil(rows.length / 2) + 1)))
      break
    }
    case 'learning': {
      const stages = stagesOf(state)

      pictures.set('curve', curvePicture((snapshot?.outcomes?.points ?? []).map(point => point.ok), width, 6, t, state.curveGrewAtMs))
      pictures.set('pipeline', pipelinePicture(stages, width, t, stages.map((_, i) => (i === 2 ? (state.history.patterns.at(-1)?.atMs ?? null) : i === 1 ? state.curveGrewAtMs || null : null))))
      pictures.set('patterns', samplesPicture('patterns since load', state.history.patterns, width))
      break
    }
    case 'metaharness': {
      const score = live<HarnessScore>(state.probes.get('metaharness'))
      const audits = live<AuditTrend>(state.probes.get('audits'))

      if (score !== null) {
        if (!scoreShown.has(score)) scoreShown.set(score, t)
        pictures.set('radar', radarPicture(score.dims.map(dim => ({ ...dim, name: AXIS[dim.name] ?? dim.name })), width, 13, t, scoreShown.get(score) ?? t))
      }

      pictures.set(
        'trend',
        trendPicture(
          (audits?.points ?? []).flatMap(point => {
            const level = severityOf(point.worst)

            return level === null ? [] : [level]
          }),
          width,
          4,
          4,
          { top: 'critical', bottom: 'clean', empty: audits === null ? 'audit trend: n/a' : `${audits.total} stored audits: a trend needs two` },
        ),
      )
      break
    }
    case 'cost': {
      const budget = state.ruflo.snapshot?.budget

      pictures.set('gauge', gaugePicture(budget?.usd ?? state.usage?.costUsd ?? null, budget?.limit ?? null, Math.min(width, 60), 9))
      pictures.set('burn', samplesPicture('spend since load', state.history.spend, width))
      break
    }
    case 'evolve':
      pictures.set('evolve-loop', loopPicture(loopStagesOf(state.evolve), width, t))
      break
    case 'timeline': {
      const lanes = lanesOf(state, nowMs)

      if (lanes.length > 0) pictures.set('gantt', ganttPicture(lanes, width, nowMs - watchOf(state).rangeMs, nowMs))
      break
    }
    default:
      break
  }

  return pictures
}

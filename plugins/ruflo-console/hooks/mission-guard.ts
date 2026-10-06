/**
 * Auto-run's spend guard (ADR-443): a leaf module, so `advance()` in mission-control.ts can ask it without a cycle. The spend is the
 * cost ledger's reading for the mission's window and project (the `mission-cost` probe), a list-price estimate; the cap is the person's
 * own Settings value. No cap, no reading, or a reading for another mission means no pause: a missing number is never a reason to stop.
 */
import { capState, shouldPause, type MissionCost } from './data/mission-cost'
import { live } from './views/common'
import { settingsOf } from './settings'
import type { MissionRecord } from './mission-types'
import type { State } from './state'

/** The mission's cost reading, only while it is the one the probe was asked about (its window starts when the mission did). */
export function costOf(state: State, mission: MissionRecord): MissionCost | null {
  const cost = live<MissionCost>(state.probes.get('mission-cost'))

  return cost !== null && cost.fromMs === mission.createdAtMs ? cost : null
}

export const capOf = (state: State): number | null => {
  const text = settingsOf(state).ai.missionCapUsd

  return text === '' ? null : Number(text)
}

/** True when auto-run should stop handing out tasks because this mission's spend reached its cap. */
export function isCapReached(state: State, mission: MissionRecord): boolean {
  const cost = costOf(state, mission)

  return cost !== null && shouldPause(capState(cost.usd, capOf(state)), mission.auto)
}

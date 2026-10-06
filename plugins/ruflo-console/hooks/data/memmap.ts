/**
 * What the memory map reads: the entries `memory list` prints (with the access count the Memory Lab's own probe leaves out)
 * and the entries a search named. Pure; the probe is registered by the integrator, never run from here.
 */
import { jsonAfter, type Probe } from './cli'
import { numberOf, recordOf, stringOf } from './parse'

import type { MapEntry } from '../gfx/memmap'

/** Entries the map draws at most: `memory list` is asked for the newest 500, as the Namespaces sample is. */
export const MAP_LIMIT = 500

/** A stored embedding longer than this is ignored (the map then says hash): bounds the work per frame on a corrupt list. */
const MAX_DIMS = 4096

/**
 * `memory list` JSON as map entries. `vector` is set only if a row carries an `embedding` array (the CLI's list does not
 * today, so the map says 'hash layout'); never invented.
 */
export function mapEntriesOf(stdout: string): MapEntry[] | null {
  const value = jsonAfter(stdout)

  if (!Array.isArray(value)) return null

  return value.slice(0, MAP_LIMIT).flatMap((row): MapEntry[] => {
    const record = recordOf(row)
    const key = stringOf(record?.key, 128)

    if (key === undefined) return []

    const accessCount = numberOf(record?.accessCount)
    const raw = Array.isArray(record?.embedding) ? record.embedding : null
    const vector = raw !== null && raw.length > 1 && raw.length <= MAX_DIMS && raw.every(item => typeof item === 'number' && Number.isFinite(item)) ? (raw as number[]) : undefined

    return [{ key, namespace: stringOf(record?.namespace, 40) ?? '(none)', hasVector: record?.hasEmbedding === true, ...(accessCount !== undefined && { accessCount }), ...(vector !== undefined && { vector }) }]
  })
}

/** Same call as the Namespaces probe, kept apart because the map needs the access count that probe drops. */
export const memmapProbe: Probe<MapEntry[]> = {
  id: 'memmap',
  args: ['memory', 'list', '--format', 'json', '--limit', String(MAP_LIMIT)],
  views: ['memory'],
  everyMs: 60_000,
  timeoutMs: 30_000,
  parse: mapEntriesOf,
}

/**
 * The `namespace/key` of each hit in a search run's printed lines (`0.684  auth/beta [agentdb]  text`; the lab prints
 * a key at most 60 characters, so a key that long matches by prefix in `isHit`). Lines that are not hits yield nothing.
 */
export function hitsOf(lines: readonly string[]): Set<string> {
  const hits = new Set<string>()

  for (const line of lines) {
    const found = /^\s*(?:\d+\.\d+|n\/a)\s+([^\s/]+)\/(\S+)/.exec(line)

    if (found !== null) hits.add(`${found[1]}/${found[2]}`)
  }

  return hits
}

/** Whether a listed entry is among the hits, allowing for the lab's 60-character key cut. */
export function isHit(hits: ReadonlySet<string>, entry: { namespace: string; key: string }): boolean {
  const id = `${entry.namespace}/${entry.key}`

  return hits.has(id) || (entry.key.length > 60 && hits.has(`${entry.namespace}/${entry.key.slice(0, 60)}`))
}

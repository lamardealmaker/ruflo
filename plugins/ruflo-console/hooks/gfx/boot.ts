/**
 * The BBS boot screen, played for the first seconds after the pane opens: a modem dials and connects, then the RuFlo
 * neon sign strikes up tube by tube on its brick wall (gfx/neon.ts), then a handshake line and a bar that fills with
 * the first ruflo reads. The boot is the one animation in the console that is decoration; it ends by itself.
 */
import { neonPicture, NEON_ROWS } from './neon'
import { Grid } from './raster'

const SIGN_TOP = 2
export const BOOT_ROWS = SIGN_TOP + NEON_ROWS + 3

const GREEN = 0x39ff14
const CYAN = 0x05d9e8
const DIM = 0x6b7280
/** The sign is switched on once the line connects. */
const SIGN_ON_MS = 900

/**
 * `age` is ms since the pane opened; the bar mixes elapsed time with the reads that have answered (`done` of
 * `total`), so it moves before any read returns and reads 100% before the boot ends at BOOT_MIN_MS.
 */
export function bootPicture(project: string, columns: number, age: number, done: number, total: number): Grid {
  const grid = new Grid(columns, BOOT_ROWS)
  const type = (y: number, from: number, text: string, color: number, msPerChar = 22) => {
    if (age < from) return

    grid.text(0, y, text.slice(0, Math.min(text.length, Math.floor((age - from) / msPerChar), columns)), color)
  }

  type(0, 0, `ATDT ruflo.local${age >= 450 ? '   RING… RING…' : ''}`, DIM, 18)
  type(1, 600, 'CONNECT 115200 / ARQ / V.42bis', GREEN, 12)

  // The sign's wall shows from the start, unlit; the tubes strike from SIGN_ON_MS.
  const sign = neonPicture(columns, age - SIGN_ON_MS, true)

  grid.cells.set(sign.cells, SIGN_TOP * columns * 3)

  type(BOOT_ROWS - 2, 2300, `> handshake ok · node ${project}`, CYAN, 14)

  // LOADING [▓▓▓▓░░░░] 58%  reads 6/10, with a blinking cursor while it runs.
  if (age >= 2300) {
    const pct = Math.min(1, 0.55 * Math.min(1, (age - 2300) / 700) + 0.45 * (total > 0 ? done / total : 1))
    const barWidth = Math.max(6, Math.min(24, columns - 30))
    const filled = Math.round(pct * barWidth)
    const line = `LOADING [${'▓'.repeat(filled)}${'░'.repeat(barWidth - filled)}] ${String(Math.round(pct * 100)).padStart(3)}%  reads ${done}/${total}`

    grid.text(0, BOOT_ROWS - 1, line.slice(0, columns), pct >= 1 ? GREEN : CYAN)
    if (Math.floor(age / 400) % 2 === 0 && line.length + 1 < columns) grid.set(line.length + 1, BOOT_ROWS - 1, '█', CYAN)
  }

  return grid
}

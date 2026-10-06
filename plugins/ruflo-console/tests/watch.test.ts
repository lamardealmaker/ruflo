/**
 * The Timeline and Events pages in the pane: the look-back chips redraw the title, and the event page's kind chips, search field,
 * pause button and empty-state wording are there and answer.
 */
import type { TestBody } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { inputKeys, command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

type Body = Parameters<TestBody>

const keys = (tree: Parameters<typeof elementsOf>[0]) => elementsOf(tree, 'Button').map(keyOf)

async function opened($: Body[0], on: Body[1], view: string) {
  worldOf(on, RUFLO_FILES)
  mock.clock(on)
  await $.session.start(SESSION)
  await $.command.run(command(view))

  const pane = await $.ui.mount({ ...paneAt(150), surface: 'terminal' as const, plugin: PLUGIN })

  await pane.drawn()

  return pane
}

describe('timeline and events pages', () => {
  test('timeline: the look-back chips change the window named in the title', { options: { boot: false } }, async ($, on) => {
    const pane = await opened($, on, 'timeline')
    const first = await pane.drawn()

    expect(keys(first)).toEqual(expect.arrayContaining(['tl-range-5', 'tl-range-15', 'tl-range-60']))
    expect(textOf(first)).toContain('last 15 min')
    await pane.press({ key: 'tl-range-60' })
    expect(textOf(await pane.drawn())).toContain('last 60 min')
    await pane.press({ key: 'tl-range-5' })
    expect(textOf(await pane.drawn())).toContain('last 5 min')
    await pane.unmount()
  })

  test('events: kind chips, a search field and a pause button; searching for nothing says no event matches; pause then resume flips the button', { options: { boot: false } }, async ($, on) => {
    const pane = await opened($, on, 'events')
    const first = await pane.drawn()

    expect(keys(first)).toEqual(expect.arrayContaining(['ev-kind-all', 'ev-pause']))
    expect(inputKeys(first)).toContain('ev-query')
    expect(textOf(first)).toContain('live')
    await pane.press({ key: 'ev-pause' })
    expect(textOf(await pane.drawn())).toContain('paused')
    expect(keys(await pane.drawn())).toContain('ev-pause')
    await pane.press({ key: 'ev-pause' })
    expect(textOf(await pane.drawn())).toContain('live')
    await pane.input({ key: 'ev-query', text: 'zzz-not-an-event', kind: 'submit' })

    const none = await pane.drawn()

    expect(textOf(none)).toMatch(/no event matches|Nothing has changed/)
    expect(keys(none)).toContain('ev-clear')
    await pane.press({ key: 'ev-clear' })
    expect(keys(await pane.drawn())).not.toContain('ev-clear')
    await pane.unmount()
  })
})

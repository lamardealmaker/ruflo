/**
 * Pure text screening for the guidance and delivery features. Two jobs: find secrets (so none is stored or sent) and find prompt-injection phrasing (so
 * screened text cannot instruct the model). Findings are NAMES only: the matched text is never returned, logged or counted by value.
 */

const SECRETS: readonly (readonly [string, RegExp])[] = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['aws access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['github token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['google api key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['anthropic or openai key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['bearer token', /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/],
  ['key assignment', /\b(?:api[_-]?key|secret|token|passw(?:or)?d|credential)s?["']?\s*[:=]\s*["']?[A-Za-z0-9/+=_.-]{16,}/i],
]

const INJECTION: readonly (readonly [string, RegExp])[] = [
  ['override instructions', /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|any|system)\b[^.\n]{0,30}\b(?:instructions?|rules?|prompts?|guidelines?)\b/i],
  ['role reassignment', /\byou are (?:now|no longer)\b|\bact as (?:an? )?(?:unrestricted|jailbroken)\b/i],
  ['new instructions', /\b(?:new|updated|real) (?:system )?instructions?\s*:/i],
  ['fake role tags', /<\/?\s*(?:system|assistant|developer|instructions?)\s*>|^\s*(?:system|assistant)\s*:/im],
  ['concealment', /\bdo not (?:tell|inform|mention|reveal)[^.\n]{0,30}\b(?:user|human|operator)\b/i],
  ['exfiltration', /\b(?:exfiltrate|send|post|upload)\b[^.\n]{0,50}\b(?:secrets?|credentials?|tokens?|api keys?|\.env)\b/i],
  ['shell pipe', /\b(?:curl|wget)\b[^|\n]{0,200}\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/i],
]

// C0/C1 controls (keeping tab and newline), DEL, zero-width and bidi override characters.
const INVISIBLE = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff]', 'g')

const bare = (text: string) => (text.length > 20_000 ? text.slice(0, 20_000) : text).replace(INVISIBLE, '')

export type Findings = { readonly secrets: readonly string[]; readonly injection: readonly string[] }

const names = (rules: readonly (readonly [string, RegExp])[], text: string) => rules.filter(([, re]) => re.test(text)).map(([name]) => name)

/** Names of every secret shape and injection phrase found in `text`. Cost is linear in the capped input. */
export function scan(text: string): Findings {
  const bounded = bare(text)
  return { secrets: names(SECRETS, bounded), injection: names(INJECTION, bounded) }
}

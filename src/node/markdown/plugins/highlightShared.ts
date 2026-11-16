// What the code highlighters share: reading the fence info, keeping Vue
// interpolations out of the highlighter, and the default color fixes.

import { customAlphabet } from 'nanoid'

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz', 10)

/** Contrast fixes for the default themes. */
export const DEFAULT_COLOR_REPLACEMENTS: Record<
  string,
  Record<string, string>
> = {
  'github-light': {
    '#959da5': '#6c676f',
    '#28a745': '#0e790b',
    '#b08800': '#846312',
    '#e36209': '#c13617',
    '#3192aa': '#05728b',
    '#d73a49': '#c62739',
    '#22863a': '#11782a',
    '#6a737d': '#62687b',
    '#1b7c83': '#06747a',
    '#0366d6': '#0663d0',
    '#cb2431': '#c82430'
  },
  'github-dark': {
    '#586069': '#5b93a3',
    '#6a737d': '#818e99',
    '#ea4a5a': '#ef5564',
    '#2188ff': '#268bf9'
  }
}

export function isDualTheme<T>(theme: T | { light: T; dark: T }): theme is {
  light: T
  dark: T
} {
  return (
    typeof theme === 'object' &&
    theme !== null &&
    'light' in theme &&
    'dark' in theme
  )
}

/** Alias lookup ignores case. */
export function normalizeLangAlias(
  alias: Record<string, string> = {}
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(alias).map(([k, v]) => [k.toLowerCase(), v])
  )
}

// keep in sync with ./preWrapper.ts#extractLang
const langRE = /^[a-zA-Z0-9-_]+/
const vueRE = /-vue$/

/**
 * Splits the fence info into the language and the attributes that follow it.
 * `vPre` is false for a `-vue` language, whose interpolations stay live.
 */
export function parseFenceInfo(
  lang: string,
  attrs: string,
  defaultLang: string
): { lang: string; attrs: string; vPre: boolean } {
  const match = langRE.exec(lang)
  if (match) {
    const orig = lang
    lang = match[0].toLowerCase()
    attrs = orig.slice(lang.length).replace(/(?<!=)\{/g, ' {') + ' ' + attrs
    attrs = attrs.trim().replace(/\s+/g, ' ')
  }

  lang ||= defaultLang

  const vPre = !vueRE.test(lang)
  if (!vPre) lang = lang.slice(0, -4)

  return { lang, attrs, vPre }
}

/**
 * Swaps the `{{ }}` interpolations of a `-vue` block for markers that the
 * highlighter leaves alone, and puts them back into the highlighted HTML.
 */
export function createMustacheGuard(vPre: boolean): {
  remove: (s: string) => string
  restore: (s: string) => string
} {
  const mustaches = new Map<string, string>()
  return {
    remove(s) {
      if (vPre) return s
      return s.replace(/\{\{.*?\}\}/g, (match) => {
        let marker = mustaches.get(match)
        if (!marker) {
          marker = nanoid()
          mustaches.set(match, marker)
        }
        return marker
      })
    },
    restore(s) {
      mustaches.forEach((marker, match) => {
        s = s.replaceAll(marker, match)
      })
      return s
    }
  }
}

/** The part of a highlighter token that the shell prompt handling reads. */
interface ShellToken {
  content: string
  htmlStyle?: Record<string, string>
  /** Set for a comment, a string or a regex. */
  type?: number
}

const UNSELECTABLE = { 'user-select': 'none', '-webkit-user-select': 'none' }

/**
 * Prevents the leading '$' symbol etc from being selectable/copyable. Also
 * normalizes its syntax so there's no leading spaces, and only a single
 * trailing space.
 *
 * With `joined`, the symbol may share its token with the spaces before it and
 * the command after it, and a token that is a string or a comment is never a
 * prompt. Without it, the symbol is a token of its own.
 *
 * NOTE: Any changes to this function may also need to update
 * `src/client/app/composables/copyCode.ts`
 */
export function disableShellSymbolSelect<T extends ShellToken>(
  tokensByLine: T[][],
  style: (token: T) => Record<string, string>,
  joined = false
): void {
  for (const tokens of tokensByLine) {
    let index = 0
    if (joined) {
      while (index < tokens.length && !tokens[index].content.trim()) index++
    }
    const first = tokens[index]
    if (!first || (joined && first.type)) continue

    const match = /^\s*([$>])( ?)([^]*)$/.exec(
      joined ? first.content : first.content.trim()
    )
    if (!match) continue
    const [, symbol, space, rest] = match

    let remaining: T[]
    if (space || rest) {
      if (!joined || !space) continue
      if (!rest && index === tokens.length - 1) continue
      remaining = rest ? [{ ...first, content: rest }] : []
      remaining.push(...tokens.slice(index + 1))
    } else {
      // The space that separates the symbol starts the next token.
      const next = tokens[index + 1]
      if (next?.content[0] !== ' ') continue
      remaining = tokens.slice(index + 1)
      remaining[0] = { ...next, content: next.content.slice(1) }
      if (joined && !remaining[0].content) remaining.shift()
    }

    const prompt: T = {
      ...first,
      content: symbol + ' ',
      htmlStyle: { ...style(first), ...UNSELECTABLE }
    }
    tokens.splice(0, tokens.length, prompt, ...remaining)
  }
}

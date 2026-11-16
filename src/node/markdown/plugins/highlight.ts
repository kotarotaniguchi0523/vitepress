import { codeToTokens, isSupportedLanguage } from '@pierre/highlights'
import type {
  CodeToTokensOptions,
  Lang,
  Theme,
  ThemeFamily,
  ThemedToken
} from '@pierre/highlights'
import { customAlphabet } from 'nanoid'
import c from 'picocolors'
import type { Logger } from 'vite'

import { isShell } from '../../shared'

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz', 10)

/** A code theme: the name of a bundled theme or a Zed-compatible theme object. */
export type CodeTheme = string | Theme | ThemeFamily

export type ThemeOptions = CodeTheme | { light: CodeTheme; dark: CodeTheme }

/**
 * Color replacements: a flat map from color to color, or one such map per
 * theme name.
 */
export type ColorReplacements = Record<string, string | Record<string, string>>

export interface CodeTransformerOptions {
  lang: string
  meta: { __raw: string }
  [key: string]: unknown
}

export interface CodeTransformerContext {
  /** The code as it was given to the highlighter. */
  source: string
  options: CodeTransformerOptions
}

/**
 * Changes a code block before or after it is highlighted. The highlighter has
 * no syntax tree, so there are no hooks for elements.
 */
export interface CodeTransformer {
  name?: string
  /** Runs the transformer before or after the ones without it. */
  enforce?: 'pre' | 'post'
  /** Changes the code before it is highlighted. */
  preprocess?(
    this: CodeTransformerContext,
    code: string,
    options: CodeTransformerOptions
  ): string | void
  /** Changes the tokens of each line before they are rendered. */
  tokens?(
    this: CodeTransformerContext,
    tokens: ThemedToken[][]
  ): ThemedToken[][] | void
  /** Changes the HTML of the block. */
  postprocess?(
    this: CodeTransformerContext,
    html: string,
    options: CodeTransformerOptions
  ): string | void
}

export type { ThemedToken }

export interface HighlightOptions {
  defaultHighlightLang?: string
  languageAlias?: Record<string, string>
  codeTransformers?: CodeTransformer[]
  colorReplacements?: ColorReplacements
}

// The hooks of a Shiki transformer that are given the syntax tree.
const TREE_HOOKS = ['root', 'pre', 'code', 'line', 'span']

const describe = (transformer: CodeTransformer) =>
  transformer.name ? `transformer '${transformer.name}'` : 'a transformer'

/**
 * The context of a hook. A Shiki transformer can also reach the highlighter
 * and the syntax tree through it, which do not exist here, so reading any
 * other member is an error rather than `undefined`.
 */
function createContext(
  source: string,
  options: CodeTransformerOptions
): CodeTransformerContext {
  return new Proxy({ source, options } as CodeTransformerContext, {
    get(target, key, receiver) {
      if (typeof key === 'symbol' || key in target || key === 'then') {
        return Reflect.get(target, key, receiver)
      }
      throw new Error(
        `\`this.${key}\` is not supported in a transformer in \`markdown.codeTransformers\`: a transformer has \`this.source\` and \`this.options\` only.`
      )
    }
  })
}

/**
 * A Shiki transformer can ask for more through the options, for example for
 * decorations. Nothing here would act on that, so it is an error.
 */
function assertKnownOptions(
  options: CodeTransformerOptions,
  transformer: CodeTransformer
): void {
  for (const [key, value] of Object.entries(options)) {
    if (key === 'lang' || key === 'meta' || value == null) continue
    if (Array.isArray(value) && value.length === 0) continue
    throw new Error(
      `\`options.${key}\`, which ${describe(transformer)} in \`markdown.codeTransformers\` set, is not supported.`
    )
  }
}

/** Rejects the options of the Shiki highlighter that have no equivalent. */
function assertSupportedOptions(options: HighlightOptions): void {
  const legacy = options as { shikiSetup?: unknown; languages?: unknown[] }
  if (legacy.shikiSetup) {
    throw new Error(
      'The `markdown.shikiSetup` option is not supported: code blocks are highlighted with `@pierre/highlights`.'
    )
  }
  if (legacy.languages?.some((lang) => typeof lang !== 'string')) {
    throw new Error(
      'Custom grammars in `markdown.languages` are not supported: `@pierre/highlights` has built-in languages only.'
    )
  }
  for (const transformer of options.codeTransformers || []) {
    for (const hook of TREE_HOOKS) {
      // A transformer can be a class instance, with its hooks on the prototype.
      if (typeof (transformer as any)[hook] === 'function') {
        throw new Error(
          `The \`${hook}\` hook of ${describe(transformer)} in \`markdown.codeTransformers\` is not supported. The supported hooks are \`preprocess\`, \`tokens\` and \`postprocess\`.`
        )
      }
    }
  }
}

// The class names and the CSS variable prefix are those of Shiki, which
// VitePress used before. Themes and plugins select on them, and so do the
// default theme CSS and the code-copy script.
const CSS_VARIABLE_PREFIX = '--shiki-'

// Contrast fixes for the default themes.
const DEFAULT_COLOR_REPLACEMENTS: Record<string, Record<string, string>> = {
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

// What is left of a comment once its notations are removed: only delimiters.
const EMPTY_COMMENT_RE = /^\s*(?:\/\/|\/\*|\*\/|<!--|-->|--|[#;%"'*]|\s)*\s*$/
const TOKEN_COMMENT = 1

// The classes a notation gives its line. The block gets the class in `pre`.
const NOTATIONS: Record<string, { line: string[]; pre: string }> = {
  '++': { line: ['diff', 'add'], pre: 'has-diff' },
  '--': { line: ['diff', 'remove'], pre: 'has-diff' },
  highlight: { line: ['highlighted'], pre: 'has-highlighted' },
  hl: { line: ['highlighted'], pre: 'has-highlighted' },
  focus: { line: ['has-focus'], pre: 'has-focused-lines' },
  error: { line: ['highlighted', 'error'], pre: 'has-highlighted' },
  warning: { line: ['highlighted', 'warning'], pre: 'has-highlighted' }
}

// Classes come out in this order whatever order the notations appear in.
const LINE_CLASS_ORDER = [
  'highlighted',
  'diff',
  'add',
  'remove',
  'has-focus',
  'error',
  'warning'
]
const PRE_CLASS_ORDER = ['has-diff', 'has-focused-lines', 'has-highlighted']

const notation = `\\[!code (${Object.keys(NOTATIONS)
  .map((name) => name.replace(/\+/g, '\\+'))
  .join('|')})(?::(\\d+))?\\]`
const NOTATION_RE = new RegExp(`\\s*${notation}`, 'g')
// A comment that ends a line and holds only notations, in a token that the
// lexer did not mark as a comment.
const notations = `(?:${notation.replace(/\((?!\?)/g, '(?:')}\\s*)+`
const UNMARKED_COMMENT_RE = new RegExp(
  `\\s*(?:<!--\\s*${notations}-->|/\\*\\s*${notations}\\*/|(?://|#|--|;|%)\\s*${notations})\\s*$`
)

const FONT_STYLE_ITALIC = 1
const FONT_STYLE_BOLD = 2
const FONT_STYLE_UNDERLINE = 4
const FONT_STYLE_STRIKETHROUGH = 8

function isThemeObject(value: unknown): value is Theme | ThemeFamily {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('style' in value || 'themes' in value)
  )
}

type LoadedTheme = { name: string; theme: Theme | ThemeFamily }

async function loadTheme(theme: CodeTheme): Promise<LoadedTheme> {
  if (typeof theme !== 'string') {
    if (!isThemeObject(theme)) {
      throw new Error(
        'A code theme is the name of a bundled theme or a Zed-compatible theme object. TextMate themes are not supported.'
      )
    }
    const resolved = 'themes' in theme ? theme.themes[0] : theme
    return { name: resolved.name, theme }
  }
  if (!/^[a-z0-9-]+$/.test(theme)) {
    throw new Error(`Invalid code theme name '${theme}'.`)
  }
  let module: { default?: unknown }
  try {
    module = await import(
      /* @vite-ignore */ `@pierre/highlights/themes/${theme}`
    )
  } catch (error) {
    // Only a missing module means the name is wrong.
    if ((error as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND') {
      throw error
    }
    throw new Error(`Unknown code theme '${theme}'.`, { cause: error })
  }
  // The themes directory also holds modules that are not themes.
  if (!isThemeObject(module.default)) {
    throw new Error(`Unknown code theme '${theme}'.`)
  }
  return { name: theme, theme: module.default }
}

function escapeHtml(text: string): string {
  return /[&<]/.test(text)
    ? text.replace(/&/g, '&#x26;').replace(/</g, '&#x3C;')
    : text
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/"/g, '&#x22;')
}

type LineRange = { from: number; to: number }

/** The 1-based line ranges of a `{1,3-5}` list in the fence info, if it has one. */
function metaHighlightedRanges(meta: string): LineRange[] | null {
  const match = /\{([\d,-]+)\}/.exec(meta)
  if (!match) return null
  const ranges: LineRange[] = []
  for (const part of match[1].split(',')) {
    const [from, to] = part.split('-').map((value) => parseInt(value, 10))
    if (!Number.isNaN(from)) {
      ranges.push({
        from,
        to: to === undefined || Number.isNaN(to) ? from : to
      })
    }
  }
  return ranges
}

type Notation = { line: string[]; pre: string; count: number }

/**
 * Splits the `[!code ...]` notations from the comments of a line.
 * A comment that held nothing else is removed with them.
 */
function takeNotations(
  tokens: ThemedToken[],
  lang: string
): { tokens: ThemedToken[]; notations: Notation[] } {
  const notations: Notation[] = []
  const kept: ThemedToken[] = []
  const jsx = lang === 'jsx' || lang === 'tsx'
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (!token.content.includes('[!code ')) {
      kept.push(token)
      continue
    }
    if (token.type !== TOKEN_COMMENT) {
      // The lexer does not mark every comment. One that ends the line and
      // holds only notations still counts.
      const comment =
        index === tokens.length - 1 && UNMARKED_COMMENT_RE.exec(token.content)
      if (!comment) {
        kept.push(token)
        continue
      }
      comment[0].replace(NOTATION_RE, (_match, name, count) => {
        notations.push({
          ...NOTATIONS[name],
          count: count ? Math.max(1, parseInt(count, 10)) : 1
        })
        return ''
      })
      const content = token.content.slice(0, comment.index)
      if (content) kept.push({ ...token, content })
      continue
    }
    const content = token.content.replace(
      NOTATION_RE,
      (_match, name: string, count: string | undefined) => {
        notations.push({
          ...NOTATIONS[name],
          count: count ? Math.max(1, parseInt(count, 10)) : 1
        })
        return ''
      }
    )
    if (!EMPTY_COMMENT_RE.test(content)) {
      kept.push(content === token.content ? token : { ...token, content })
    } else if (
      jsx &&
      kept.at(-1)?.content.trim() === '{' &&
      tokens[index + 1]?.content.trim() === '}'
    ) {
      // JSX comments own their expression braces. Drop those with an empty
      // notation comment so a standalone annotation applies to the next line.
      kept.pop()
      index++
    }
  }
  // The space that separated the code from a removed comment goes with it.
  if (notations.length > 0 && kept.length > 0) {
    const last = kept[kept.length - 1]
    const trimmed = last.content.trimEnd()
    if (trimmed !== last.content) {
      if (trimmed) kept[kept.length - 1] = { ...last, content: trimmed }
      else kept.pop()
    }
  }
  return { tokens: kept, notations }
}

function isEmptyLine(tokens: ThemedToken[]): boolean {
  return tokens.every((token) => !/\S/.test(token.content))
}

const UNSELECTABLE = { 'user-select': 'none', '-webkit-user-select': 'none' }

/**
 * Prevents the leading '$' symbol etc from being selectable/copyable. Also
 * normalizes its syntax so there's no leading spaces, and only a single
 * trailing space.
 *
 * The lexer may join the spaces before the symbol, the symbol and the command
 * in one token. A token that is a string or a comment is never a prompt.
 *
 * NOTE: Any changes to this function may also need to update
 * `src/client/app/composables/copyCode.ts`
 */
function disableShellSymbolSelect(tokensByLine: ThemedToken[][]): void {
  for (const tokens of tokensByLine) {
    let index = 0
    while (index < tokens.length && !tokens[index].content.trim()) index++
    const first = tokens[index]
    if (!first || first.type) continue

    const match = /^\s*([$>])( ?)([^]*)$/.exec(first.content)
    if (!match) continue
    const [, symbol, space, rest] = match

    let remaining: ThemedToken[]
    if (space || rest) {
      if (!space) continue
      if (!rest && index === tokens.length - 1) continue
      remaining = rest ? [{ ...first, content: rest }] : []
      remaining.push(...tokens.slice(index + 1))
    } else {
      // The space that separates the symbol starts the next token.
      const next = tokens[index + 1]
      if (next?.content[0] !== ' ') continue
      remaining = tokens.slice(index + 1)
      remaining[0] = { ...next, content: next.content.slice(1) }
      if (!remaining[0].content) remaining.shift()
    }

    const prompt: ThemedToken = {
      ...first,
      content: symbol + ' ',
      htmlStyle: { ...tokenStyle(first), ...UNSELECTABLE }
    }
    tokens.splice(0, tokens.length, prompt, ...remaining)
  }
}

/** The CSS declarations of a token, whichever way the highlighter gave them. */
function tokenStyle(token: ThemedToken): Record<string, string> {
  if (token.htmlStyle) return token.htmlStyle
  const style: Record<string, string> = {}
  if (token.color) style.color = token.color
  if (token.bgColor) style['background-color'] = token.bgColor
  const fontStyle = token.fontStyle ?? 0
  if (fontStyle & FONT_STYLE_ITALIC) style['font-style'] = 'italic'
  if (fontStyle & FONT_STYLE_BOLD) style['font-weight'] = 'bold'
  const decorations: string[] = []
  if (fontStyle & FONT_STYLE_UNDERLINE) decorations.push('underline')
  if (fontStyle & FONT_STYLE_STRIKETHROUGH) decorations.push('line-through')
  if (decorations.length) style['text-decoration'] = decorations.join(' ')
  return style
}

/**
 * Creates the code highlighter. It uses `@pierre/highlights`.
 */
export async function highlight(
  theme: ThemeOptions,
  options: HighlightOptions,
  logger: Pick<Logger, 'warn'> = console
): Promise<
  [(str: string, lang: string, attrs: string) => Promise<string>, () => void]
> {
  assertSupportedOptions(options)

  const { defaultHighlightLang: defaultLang = 'txt' } = options
  // Transformers run in the order that Shiki runs them in.
  const enforced = { pre: 0, undefined: 1, post: 2 }
  const userTransformers = (options.codeTransformers || []).toSorted(
    (a, b) => enforced[`${a.enforce}`] - enforced[`${b.enforce}`]
  )
  const hasTokensHook = userTransformers.some(
    (transformer) => transformer.tokens
  )

  const langAlias = Object.fromEntries(
    Object.entries(options.languageAlias || {}) //
      .map(([k, v]) => [k.toLowerCase(), v])
  )

  // Theme key to theme. A single theme has no key.
  const loaded: [key: string, theme: LoadedTheme][] =
    typeof theme === 'object' && 'light' in theme && 'dark' in theme
      ? await Promise.all(
          (['light', 'dark'] as const).map(
            async (key) =>
              [key, await loadTheme(theme[key])] as [string, LoadedTheme]
          )
        )
      : [['', await loadTheme(theme as CodeTheme)]]
  const dual = loaded.length > 1

  const replacements = (themeName: string): Map<string, string> => {
    const result = new Map<string, string>()
    const add = (map: Record<string, unknown> | undefined) => {
      for (const [from, to] of Object.entries(map || {})) {
        if (typeof to === 'string') result.set(from, to)
      }
    }
    // The replacements that the config gives for a theme take the place of
    // the default ones for that theme.
    const scoped = options.colorReplacements?.[themeName]
    add(options.colorReplacements)
    add(
      typeof scoped === 'object'
        ? scoped
        : DEFAULT_COLOR_REPLACEMENTS[themeName]
    )
    return result
  }

  // CSS property to the replacements of the theme that property belongs to.
  const replacementsByProperty = new Map<string, Map<string, string>>()
  for (const [key, { name }] of loaded) {
    const map = replacements(name)
    if (!map.size) continue
    const color = dual ? CSS_VARIABLE_PREFIX + key : 'color'
    const background = dual ? `${color}-bg` : 'background-color'
    replacementsByProperty.set(color, map)
    replacementsByProperty.set(background, map)
  }

  const declaration = ([property, value]: [string, string]): string => {
    const replaced = replacementsByProperty
      .get(property)
      ?.get(value.toLowerCase())
    return `${property}:${replaced ?? value}`
  }

  // Light comes before dark.
  const themeRank = (property: string): number =>
    property.startsWith(`${CSS_VARIABLE_PREFIX}light`)
      ? 0
      : property.startsWith(`${CSS_VARIABLE_PREFIX}dark`)
        ? 1
        : 2

  const css = (style: Record<string, string>): string => {
    const entries = Object.entries(style)
    if (dual) entries.sort((a, b) => themeRank(a[0]) - themeRank(b[0]))
    return entries.map(declaration).join(';')
  }

  const themeOptions = dual
    ? {
        themes: Object.fromEntries(loaded.map(([key, t]) => [key, t.theme])),
        defaultColor: false as const
      }
    : { theme: loaded[0][1].theme }
  const tokenize = (code: string, lang: string) =>
    codeToTokens(code, {
      lang: lang as Lang,
      cssVariablePrefix: CSS_VARIABLE_PREFIX,
      ...themeOptions
    } as CodeToTokensOptions)

  // The class and the colors of the block depend on the themes alone.
  const rootStyle: [string, string][] = []
  if (dual) {
    const colors = loaded.map(([key, t]) => ({
      key,
      ...codeToTokens('', { lang: 'text', theme: t.theme })
    }))
    for (const { key, fg } of colors) {
      if (fg) rootStyle.push([CSS_VARIABLE_PREFIX + key, fg])
    }
    for (const { key, bg } of colors) {
      if (bg) rootStyle.push([`${CSS_VARIABLE_PREFIX}${key}-bg`, bg])
    }
  } else {
    const { fg, bg } = tokenize('', 'text')
    if (bg) rootStyle.push(['background-color', bg])
    if (fg) rootStyle.push(['color', fg])
  }
  const preStyle = escapeAttribute(rootStyle.map(declaration).join(';'))
  const preClass = escapeAttribute(
    [
      'shiki',
      ...(dual ? ['shiki-themes'] : []),
      ...loaded.map(([, t]) => t.name)
    ].join(' ')
  )

  // The highlighter gives every token of one kind the same style object, or
  // the same color and font style.
  const openersByStyle = new WeakMap<object, string>()
  const openersByColor = new Map<string, string>()
  const spanOpener = (token: ThemedToken): string => {
    const colorKey = token.htmlStyle
      ? ''
      : `${token.color}|${token.bgColor}|${token.fontStyle}`
    let opener = token.htmlStyle
      ? openersByStyle.get(token.htmlStyle)
      : openersByColor.get(colorKey)
    if (opener === undefined) {
      const style = css(tokenStyle(token))
      opener = style ? `<span style="${escapeAttribute(style)}">` : '<span>'
      if (token.htmlStyle) openersByStyle.set(token.htmlStyle, opener)
      else openersByColor.set(colorKey, opener)
    }
    if (!token.htmlAttrs) return opener
    let attrs = ''
    for (const [name, value] of Object.entries(token.htmlAttrs)) {
      attrs += ` ${name}="${escapeAttribute(value)}"`
    }
    return opener.slice(0, -1) + attrs + '>'
  }

  // Whether whitespace in this style looks different from plain whitespace.
  const styleShowsOnSpace = new WeakMap<object, boolean>()
  const showsOnSpace = (token: ThemedToken): boolean => {
    if (
      token.htmlAttrs ||
      token.bgColor ||
      (token.fontStyle ?? 0) & (FONT_STYLE_UNDERLINE | FONT_STYLE_STRIKETHROUGH)
    ) {
      return true
    }
    if (!token.htmlStyle) return false
    let shows = styleShowsOnSpace.get(token.htmlStyle)
    if (shows === undefined) {
      shows = Object.keys(token.htmlStyle).some((property) =>
        /-bg$|background|decoration/.test(property)
      )
      styleShowsOnSpace.set(token.htmlStyle, shows)
    }
    return shows
  }

  const renderLine = (tokens: ThemedToken[], classes: string): string => {
    let html = `<span class="${classes}">`
    // The default theme collapses a line that has no element in it.
    if (tokens.length === 0) return html + '<wbr></span>'
    // Tokens that look the same share one span. Plain whitespace joins the
    // token after it, as in the markup of the Shiki highlighter, or the one
    // before it, but never a token whose style would show on it.
    let open: string | undefined
    let openShows = false
    let space = ''
    const closeSpace = () => {
      if (!space) return
      if (!open || openShows) {
        if (open) html += '</span>'
        html += open = '<span>'
        openShows = false
      }
      html += space
      space = ''
    }
    for (const token of tokens) {
      const shows = showsOnSpace(token)
      if (!shows && !/\S/.test(token.content)) {
        space += token.content
        continue
      }
      if (shows) closeSpace()
      const opener = spanOpener(token)
      if (opener !== open) {
        if (open) html += '</span>'
        html += open = opener
      }
      openShows = shows
      html += space + escapeHtml(token.content)
      space = ''
    }
    closeSpace()
    return html + '</span></span>'
  }

  // keep in sync with ./preWrapper.ts#extractLang
  const langRE = /^[a-zA-Z0-9-_]+/
  const vueRE = /-vue$/

  /** The language to highlight as, for the language that the block names. */
  const resolveLang = (written: string): string => {
    // An alias may name another alias.
    const seen = new Set<string>()
    let lang = written
    while (lang in langAlias && !seen.has(lang)) {
      seen.add(lang)
      lang = langAlias[lang]
    }
    if (isSupportedLanguage(lang)) return lang
    logger.warn(
      c.yellow(
        `\nThe language '${written}' is not loaded, falling back to '${defaultLang}' for syntax highlighting.`
      )
    )
    const fallback = langAlias[defaultLang] ?? defaultLang
    return isSupportedLanguage(fallback) ? fallback : 'text'
  }

  return [
    async (str, lang, attrs) => {
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

      lang = resolveLang(lang)

      const mustaches = new Map<string, string>()

      const removeMustache = (s: string) => {
        if (vPre) return s
        return s.replace(/\{\{.*?\}\}/g, (match) => {
          let marker = mustaches.get(match)
          if (!marker) {
            marker = nanoid()
            mustaches.set(match, marker)
          }
          return marker
        })
      }

      const restoreMustache = (s: string) => {
        mustaches.forEach((marker, match) => {
          s = s.replaceAll(marker, match)
        })
        return s
      }

      str = removeMustache(str).trimEnd()

      const context = createContext(str, { lang, meta: { __raw: attrs } })
      for (const transformer of userTransformers) {
        str = transformer.preprocess?.call(context, str, context.options) || str
        assertKnownOptions(context.options, transformer)
      }
      // A transformer may have picked another language or changed the meta.
      if (context.options.lang !== lang) {
        lang = context.options.lang = resolveLang(context.options.lang)
      }
      attrs = context.options.meta?.__raw ?? attrs

      let tokensByLine: ThemedToken[][] = tokenize(str, lang).tokens
      if (isShell(lang)) disableShellSymbolSelect(tokensByLine)
      if (hasTokensHook) {
        // The highlighter shares one style object between all tokens of a
        // kind, also across blocks. A transformer gets its own copies.
        tokensByLine = tokensByLine.map((tokens) =>
          tokens.map((token) =>
            token.htmlStyle
              ? { ...token, htmlStyle: { ...token.htmlStyle } }
              : { ...token }
          )
        )
        for (const transformer of userTransformers) {
          tokensByLine =
            transformer.tokens?.call(context, tokensByLine) || tokensByLine
        }
      }

      const highlighted = metaHighlightedRanges(attrs)
      const preClasses = new Set<string>()
      const lines: string[] = []

      // Most blocks have neither notations nor a line range.
      if (!highlighted && !str.includes('[!code ')) {
        for (const tokens of tokensByLine) {
          lines.push(renderLine(tokens, 'line'))
        }
      } else {
        // Notations still to apply. One with a `:N` count stays for the lines
        // that follow.
        let running: { line: string[]; remaining: number }[] = []

        tokensByLine.forEach((lineTokens, index) => {
          const { tokens, notations } = takeNotations(lineTokens, lang)
          for (const notation of notations) {
            preClasses.add(notation.pre)
            running.push({ line: notation.line, remaining: notation.count })
          }
          // A line that held only the comment is dropped, and its notations
          // apply from the next line.
          if (notations.length > 0 && isEmptyLine(tokens)) return

          const classes = new Set<string>()
          if (
            highlighted?.some(
              (range) => index + 1 >= range.from && index + 1 <= range.to
            )
          ) {
            classes.add('highlighted')
          }
          for (const entry of running) {
            for (const name of entry.line) classes.add(name)
            entry.remaining--
          }
          running = running.filter((entry) => entry.remaining > 0)

          const ordered = LINE_CLASS_ORDER.filter((name) => classes.has(name))
          lines.push(renderLine(tokens, ['line', ...ordered].join(' ')))
        })
      }

      const blockClass = [
        preClass,
        ...PRE_CLASS_ORDER.filter((name) => preClasses.has(name))
      ].join(' ')
      let html =
        `<pre class="${blockClass}" style="${preStyle}" tabindex="0" dir="ltr"` +
        `${vPre ? ' v-pre' : ''}><code>${lines.join('\n')}</code></pre>`

      for (const transformer of userTransformers) {
        html =
          transformer.postprocess?.call(context, html, context.options) || html
      }

      return restoreMustache(html)
    },
    () => {}
  ]
}

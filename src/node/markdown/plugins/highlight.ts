import {
  transformerMetaHighlight,
  transformerNotationDiff,
  transformerNotationErrorLevel,
  transformerNotationFocus,
  transformerNotationHighlight
} from '@shikijs/transformers'
import c from 'picocolors'
import type { BundledLanguage, ShikiTransformer } from 'shiki'
import { createHighlighter, guessEmbeddedLanguages, isSpecialLang } from 'shiki'
import type { Logger } from 'vite'

import { isShell } from '../../shared'
import type { MarkdownOptions, ThemeOptions } from '../markdown'
import {
  createMustacheGuard,
  DEFAULT_COLOR_REPLACEMENTS,
  disableShellSymbolSelect,
  isDualTheme,
  normalizeLangAlias,
  parseFenceInfo
} from './highlightShared'

function transformerDisableShellSymbolSelect(): ShikiTransformer {
  return {
    name: 'vitepress:disable-shell-symbol-select',
    tokens(tokensByLine) {
      if (!isShell(this.options.lang)) return
      disableShellSymbolSelect(tokensByLine, (token) => token.htmlStyle ?? {})
    }
  }
}

export async function highlight(
  theme: ThemeOptions,
  options: MarkdownOptions,
  logger: Pick<Logger, 'warn'> = console
): Promise<
  [(str: string, lang: string, attrs: string) => Promise<string>, () => void]
> {
  const {
    defaultHighlightLang: defaultLang = 'txt',
    codeTransformers: userTransformers = []
  } = options

  const langAlias = normalizeLangAlias(options.languageAlias)

  const highlighter = await createHighlighter({
    themes: isDualTheme(theme) ? [theme.light, theme.dark] : [theme],
    langs: [...(options.languages || []), ...Object.values(langAlias)],
    langAlias
  })

  await options?.shikiSetup?.(highlighter)

  const transformers: ShikiTransformer[] = [
    transformerMetaHighlight(),
    transformerNotationDiff(),
    transformerNotationFocus({
      classActiveLine: 'has-focus',
      classActivePre: 'has-focused-lines'
    }),
    transformerNotationHighlight(),
    transformerNotationErrorLevel(),
    transformerDisableShellSymbolSelect(),
    {
      name: 'vitepress:add-dir',
      pre(node) {
        node.properties.dir = 'ltr'
      }
    }
  ]

  return [
    async (str, lang, attrs) => {
      const info = parseFenceInfo(lang, attrs, defaultLang)
      const { vPre } = info
      lang = info.lang
      attrs = info.attrs

      try {
        // https://github.com/shikijs/shiki/issues/952
        if (
          !isSpecialLang(lang) &&
          !highlighter.getLoadedLanguages().includes(lang)
        ) {
          await highlighter.loadLanguage(lang as any)
        }
      } catch {
        logger.warn(
          c.yellow(
            `\nThe language '${lang}' is not loaded, falling back to '${defaultLang}' for syntax highlighting.`
          )
        )
        lang = defaultLang
      }

      const mustaches = createMustacheGuard(vPre)

      str = mustaches.remove(str).trimEnd()

      const embeddedLang = guessEmbeddedLanguages(str, lang, highlighter)
      await highlighter.loadLanguage(...(embeddedLang as BundledLanguage[]))

      const highlighted = highlighter.codeToHtml(str, {
        lang,
        transformers: [
          ...transformers,
          {
            name: 'vitepress:v-pre',
            pre(node) {
              if (vPre) node.properties['v-pre'] = ''
            }
          },
          {
            name: 'vitepress:empty-line',
            code(hast) {
              hast.children.forEach((span) => {
                if (
                  span.type === 'element' &&
                  span.tagName === 'span' &&
                  Array.isArray(span.properties.class) &&
                  span.properties.class.includes('line') &&
                  span.children.length === 0
                ) {
                  span.children.push({
                    type: 'element',
                    tagName: 'wbr',
                    properties: {},
                    children: []
                  })
                }
              })
            }
          },
          ...userTransformers
        ],
        meta: { __raw: attrs },
        ...(isDualTheme(theme)
          ? { themes: theme, defaultColor: false }
          : { theme }),
        colorReplacements: {
          ...DEFAULT_COLOR_REPLACEMENTS,
          ...options.colorReplacements
        }
      })

      return mustaches.restore(highlighted)
    },
    highlighter.dispose
  ]
}

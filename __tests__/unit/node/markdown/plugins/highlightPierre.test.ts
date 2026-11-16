import {
  createMarkdownRenderer,
  disposeMdItInstance,
  type MarkdownOptions
} from 'node/markdown/markdown'
import { highlight } from 'node/markdown/plugins/highlight'
import { highlightWithPierre } from 'node/markdown/plugins/highlightPierre'

const themes = { light: 'github-light', dark: 'github-dark' } as const

/** The markup without colors: the tags and classes, and the text. */
function structure(html: string) {
  const lines = html
    .slice(html.indexOf('<code>') + 6, html.indexOf('</code>'))
    .split('\n')
    .map((line) => ({
      class: /^<span class="([^"]*)"/.exec(line)?.[1],
      text: line
        .replace(/<[^>]+>/g, '')
        .replace(/&#x3C;/g, '<')
        .replace(/&#x26;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&')
        // Shiki leaves the space before a removed block comment.
        .trimEnd()
    }))
  const pre = html.slice(0, html.indexOf('>') + 1)
  const preClass = /class="([^"]*)"/.exec(pre)?.[1]
  const preAttrs = pre
    .replace(/ (class|style)="[^"]*"/g, '')
    .replace('v-pre=""', 'v-pre')
  return { preClass, preAttrs, lines }
}

describe('node/markdown/plugins/highlightPierre', () => {
  const cases: [name: string, code: string, lang: string, attrs?: string][] = [
    ['plain block', 'const a = 1\n\nconst b = "<&>"\n', 'ts'],
    ['line range', 'a\nb\nc\nd\ne', 'js', '{1,3-4}'],
    ['line range in the language', 'a\nb\nc', 'js{2}'],
    [
      'notations',
      [
        'const a = 1 // [!code --]',
        'const b = 2 // [!code ++]',
        'const c = 3 // [!code highlight]',
        'const d = 4 // [!code focus]',
        'const e = 5 // [!code error]',
        'const f = 6 // [!code warning]',
        'const g = 7 // keep [!code hl]'
      ].join('\n'),
      'ts'
    ],
    [
      'notation with a count',
      'const a = 1 // [!code ++:2]\nconst b = 2\nconst c = 3',
      'ts'
    ],
    [
      'notation on its own line',
      '// [!code focus:2]\nconst a = 1\nconst b = 2\nconst c = 3',
      'ts'
    ],
    ['notation in html', '<p>a</p> <!-- [!code ++] -->\n<p>b</p>', 'html'],
    ['notation in css', 'a { color: red; } /* [!code --] */', 'css'],
    ['notation in a shell script', 'echo a # [!code highlight]', 'sh'],
    ['shell prompt', '$ npm install foo\n  $ npm run build\n> echo hi', 'sh'],
    ['vue block', '<p>{{ a }} and {{ b }}</p>', 'html-vue'],
    ['unknown language', 'whatever', 'nope-nope'],
    ['no language', 'whatever', '']
  ]

  test.each(cases)(
    'renders the structure that Shiki renders: %s',
    async (_name, code, lang, attrs = '') => {
      const logger = { warn() {} }
      const [shiki, dispose] = await highlight(themes, {}, logger)
      const [pierre] = await highlightWithPierre(themes, {}, logger)
      try {
        expect(structure(await pierre(code, lang, attrs))).toEqual(
          structure(await shiki(code, lang, attrs))
        )
      } finally {
        dispose()
      }
    }
  )

  test('renders both themes as CSS variables', async () => {
    const [render] = await highlightWithPierre(themes, {})
    const html = await render('const a = 1', 'js', '')
    expect(html).toMatch(
      /^<pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#ffffff;--shiki-dark-bg:#24292e" tabindex="0" dir="ltr" v-pre><code>/
    )
    expect(html).toContain(
      '<span style="--shiki-light:#c62739;--shiki-dark:#f97583">const </span>'
    )
  })

  test('renders a single theme with inline colors', async () => {
    const [render] = await highlightWithPierre('github-dark', {})
    const html = await render('const a = 1', 'js', '')
    expect(html).toMatch(
      /^<pre class="shiki github-dark" style="background-color:#24292e;color:#e1e4e8" tabindex="0" dir="ltr" v-pre><code>/
    )
    expect(html).toContain('<span style="color:#f97583">const </span>')
  })

  test('applies color replacements', async () => {
    const [render] = await highlightWithPierre(themes, {
      colorReplacements: { 'github-light': { '#005cc5': '#000000' } }
    })
    const html = await render('const a = 1', 'js', '')
    expect(html).toContain('--shiki-light:#000000')
    expect(html).toContain('--shiki-dark:#79b8ff')
    expect(html).not.toContain('--shiki-light:#005cc5')
  })

  test('resolves language aliases', async () => {
    const [render] = await highlightWithPierre(themes, {
      languageAlias: { My_Lang: 'js' }
    })
    const [plain] = await highlightWithPierre(themes, {})
    expect(await render('const a = 1', 'my_lang', '')).toBe(
      await plain('const a = 1', 'js', '')
    )
  })

  test('warns about a language without a lexer', async () => {
    const warn = vi.fn()
    const [render] = await highlightWithPierre(themes, {}, { warn })
    const html = await render('a', 'nope-nope', '')
    expect(warn).toHaveBeenCalledOnce()
    expect(html).toContain('<span class="line">')
  })

  test('makes the shell prompt unselectable', async () => {
    const [render] = await highlightWithPierre(themes, {})
    const html = await render('  $ npm install', 'sh', '')
    expect(html).toMatch(
      /<span class="line"><span style="[^"]*user-select:none;-webkit-user-select:none">\$ <\/span><span[^>]*>npm install<\/span><\/span>/
    )
  })

  test('keeps mustaches of vue blocks and escapes the others', async () => {
    const [render] = await highlightWithPierre(themes, {})
    const vue = await render('<p>{{ a }}</p>', 'html-vue', '')
    expect(vue).toContain('{{ a }}')
    expect(vue).not.toContain(' v-pre')
    expect(await render('<p>{{ a }}</p>', 'html', '')).toContain(' v-pre')
  })

  test('runs the transformer hooks that need no syntax tree', async () => {
    const [render] = await highlightWithPierre(themes, {
      codeTransformers: [
        {
          preprocess: (code) => code.replace('one', 'two'),
          tokens(lines) {
            lines[0][0].htmlAttrs = { 'data-lang': this.options.lang }
          },
          postprocess: (html) => html.replace('two', 'three')
        }
      ]
    })
    const html = await render('one', 'txt', '')
    expect(html).toContain('data-lang="txt"')
    expect(html).toContain('three')
  })

  test('rejects a TextMate theme', async () => {
    await expect(
      highlightWithPierre({ name: 'x', tokenColors: [] } as any, {})
    ).rejects.toThrow('TextMate themes are not supported')
  })
})

describe('node/markdown with the highlights highlighter', () => {
  afterEach(() => disposeMdItInstance())

  const render = async (options: MarkdownOptions, warn = vi.fn()) => {
    const md = await createMarkdownRenderer(
      '.',
      { highlighter: 'highlights', ...options },
      '/',
      { warn }
    )
    return md.renderAsync('```js\nconst a = 1\n```')
  }

  test('uses the highlights highlighter', async () => {
    // Shiki keeps the space with the next token.
    expect(await render({})).toContain('>const </span>')
  })

  class TreeTransformer {
    pre() {}
  }

  test.each<[string, MarkdownOptions]>([
    ['shikiSetup', { shikiSetup() {} }],
    ['a syntax tree hook', { codeTransformers: [{ pre() {} }] }],
    ['a hook on a prototype', { codeTransformers: [new TreeTransformer()] }],
    [
      'a custom grammar',
      {
        languages: [{ name: 'x', scopeName: 'source.x', patterns: [] } as any]
      }
    ],
    ['a TextMate theme', { theme: { name: 'x', tokenColors: [] } as any }]
  ])('uses Shiki for %s', async (_name, options) => {
    const warn = vi.fn()
    expect(await render(options, warn)).not.toContain('>const </span>')
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toContain('Using Shiki instead')
  })
})

// The renderer joins tokens into as few spans as it can. This checks it
// against the plain rendering, one span per token, for every line of up to
// four tokens over three texts and three styles.
describe('node/markdown/plugins/highlightPierre span sharing', () => {
  const styles: Record<string, string>[] = [
    { '--shiki-light': '#111111', '--shiki-dark': '#aaaaaa' },
    { '--shiki-light': '#222222', '--shiki-dark': '#bbbbbb' },
    // A style that shows on whitespace.
    { '--shiki-light': '#111111', '--shiki-light-bg': '#eeeeee' }
  ]
  const css = (style: Record<string, string>) =>
    Object.entries(style)
      .map(([property, value]) => `${property}:${value}`)
      .join(';')
  const showsOnSpace = (style: Record<string, string>) =>
    Object.keys(style).some((property) => property.endsWith('-bg'))

  type Token = {
    content: string
    offset: number
    htmlStyle: Record<string, string>
  }
  const alphabet: Token[] = ['a', ' ', '<&'].flatMap((content) =>
    styles.map((htmlStyle) => ({ content, offset: 0, htmlStyle }))
  )

  /** The style that each character of a rendered line ends up with. */
  function characters(line: string): [char: string, style: string][] {
    const result: [string, string][] = []
    const inner = /^<span class="line">([^]*)<\/span>$/.exec(line)![1]
    let rest = inner
    while (rest) {
      const span = /^<span(?: style="([^"]*)")?>([^<]*)<\/span>/.exec(rest)
      if (!span) throw new Error(`Unexpected markup: ${rest}`)
      const text = span[2].replace(/&#x3C;/g, '<').replace(/&#x26;/g, '&')
      for (const char of text) result.push([char, span[1] ?? ''])
      rest = rest.slice(span[0].length)
    }
    return result
  }

  test('keeps the text and the visible style of every character', async () => {
    let line: Token[] = []
    const [render] = await highlightWithPierre(themes, {
      colorReplacements: { 'github-light': {}, 'github-dark': {} },
      codeTransformers: [{ tokens: () => [line] } as any]
    })

    let lines: Token[][] = [[]]
    let checked = 0
    for (let length = 1; length <= 4; length++) {
      lines = lines.flatMap((tokens) =>
        alphabet.map((token) => [...tokens, token])
      )
      for (line of lines) {
        const html = await render('x', 'txt', '')
        const rendered = characters(
          html.slice(html.indexOf('<code>') + 6, html.indexOf('</code>'))
        )
        const expected = line.flatMap((token) =>
          [...token.content].map((char) => [char, token.htmlStyle] as const)
        )
        expect(rendered.map(([char]) => char).join('')).toBe(
          expected.map(([char]) => char).join('')
        )
        rendered.forEach(([char, style], index) => {
          const own = expected[index][1]
          // Plain whitespace may take the style of a neighbor: it shows nothing.
          if (char === ' ' && !showsOnSpace(own)) {
            if (styles.some(showsOnSpace) && style.includes('-bg')) {
              throw new Error(`Whitespace got a background: ${html}`)
            }
            return
          }
          if (style !== css(own)) throw new Error(`Wrong style: ${html}`)
        })
        expect(html.split('<span style=').length - 1).toBeLessThanOrEqual(
          line.length
        )
        checked++
      }
    }
    expect(checked).toBe(9 + 9 ** 2 + 9 ** 3 + 9 ** 4)
  })
})

describe('node/markdown/plugins/highlightPierre transformers', () => {
  test('a transformer that changes a token style changes that token only', async () => {
    const [render] = await highlightWithPierre(themes, {
      codeTransformers: [
        {
          tokens(lines) {
            lines[0][0].htmlStyle!['font-weight'] = 'bold'
          }
        }
      ]
    })
    const html = await render('const a = 1\nconst b = 2', 'js', '')
    expect(html.split('font-weight:bold').length - 1).toBe(1)

    const [plain] = await highlightWithPierre(themes, {})
    expect(await plain('const a = 1', 'js', '')).not.toContain('font-weight')
  })

  test('runs the transformers in the order that Shiki runs them in', async () => {
    const order: string[] = []
    const transformer = (name: string, enforce?: 'pre' | 'post') => ({
      name,
      enforce,
      preprocess: () => void order.push(name)
    })
    const [render] = await highlightWithPierre(themes, {
      codeTransformers: [
        transformer('post', 'post'),
        transformer('none'),
        transformer('pre', 'pre')
      ]
    })
    await render('a', 'txt', '')
    expect(order).toEqual(['pre', 'none', 'post'])
  })

  test('a transformer can pick another language', async () => {
    const [render] = await highlightWithPierre(themes, {
      codeTransformers: [
        {
          preprocess(_code, options) {
            options.lang = 'js'
          }
        }
      ]
    })
    const [plain] = await highlightWithPierre(themes, {})
    expect(await render('const a = 1', 'txt', '')).toBe(
      await plain('const a = 1', 'js', '')
    )
  })

  test('rejects what only Shiki can do for a transformer', async () => {
    const [decorations] = await highlightWithPierre(themes, {
      codeTransformers: [
        {
          name: 'decorate',
          preprocess(_code, options) {
            options.decorations = [{ start: 0, end: 1 }]
          }
        }
      ]
    })
    await expect(decorations('a', 'txt', '')).rejects.toThrow(
      "does not support `options.decorations`, which transformer 'decorate' set"
    )

    const [context] = await highlightWithPierre(themes, {
      codeTransformers: [
        {
          postprocess() {
            ;(this as any).codeToHast('a', {})
          }
        }
      ]
    })
    await expect(context('a', 'txt', '')).rejects.toThrow(
      'does not support `this.codeToHast` in a transformer'
    )
  })
})

describe('node/markdown/plugins/highlightPierre options', () => {
  test('follows an alias that names another alias', async () => {
    const warn = vi.fn()
    const [render] = await highlightWithPierre(
      themes,
      { languageAlias: { foo: 'js', bar: 'foo', loop: 'loop' } },
      { warn }
    )
    const [plain] = await highlightWithPierre(themes, {})
    expect(await render('const a = 1', 'bar', '')).toBe(
      await plain('const a = 1', 'js', '')
    )
    expect(warn).not.toHaveBeenCalled()

    await render('a', 'loop', '')
    expect(warn.mock.calls[0][0]).toContain("The language 'loop' is not loaded")
  })

  test('replacements for a theme take the place of the default ones', async () => {
    const [render] = await highlightWithPierre(themes, {
      colorReplacements: { 'github-light': { '#24292e': '#000000' } }
    })
    const html = await render('const a = 1', 'js', '')
    expect(html).toContain('--shiki-light:#d73a49')
    expect(html).toContain('--shiki-light:#000000')
  })

  test('takes a theme object', async () => {
    const theme: MarkdownOptions['theme'] = {
      name: 'mine',
      appearance: 'dark',
      style: { 'editor.foreground': '#eeeeee', 'editor.background': '#111111' }
    }
    const [render] = await highlightWithPierre(theme, {})
    expect(await render('a', 'txt', '')).toMatch(
      /^<pre class="shiki mine" style="background-color:#111111;color:#eeeeee"/
    )
  })
})

describe('node/markdown/plugins/highlightPierre lines', () => {
  test('a string that continues on a line with a prompt symbol is no prompt', async () => {
    const [render] = await highlightWithPierre(themes, {})
    const html = await render('$ echo "a\n> b"', 'bash', '')
    expect(html.split('user-select:none;').length - 1).toBe(1)
    expect(html).toContain('&#x3E; b"'.replace('&#x3E;', '>'))
  })

  test('reads a notation in a comment that the lexer does not mark', async () => {
    const [render] = await highlightWithPierre(themes, {})
    const html = await render('# Title <!-- [!code ++] -->\ntext', 'md', '')
    expect(html).toContain('has-diff')
    expect(html).toContain('<span class="line diff add">')
    expect(html).not.toContain('[!code')
    expect(html).not.toContain('--&gt;')
  })
})

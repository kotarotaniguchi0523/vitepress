import { highlight, type ThemeOptions } from 'node/markdown/plugins/highlight'

const themes = { light: 'github-light', dark: 'github-dark' } as const

/** The markup without colors: the classes and attributes, and the text. */
function structure(html: string) {
  const lines = html
    .slice(html.indexOf('<code>') + 6, html.indexOf('</code>'))
    .split('\n')
    .map((line): [classes: string | undefined, text: string] => [
      /^<span class="([^"]*)"/.exec(line)?.[1],
      line
        .replace(/<[^>]+>/g, '')
        .replace(/&#x3C;/g, '<')
        .replace(/&#x26;/g, '&')
    ])
  const pre = html.slice(0, html.indexOf('>') + 1)
  return {
    pre: /class="shiki shiki-themes github-light github-dark ?([^"]*)"/.exec(
      pre
    )?.[1],
    vPre: pre.endsWith(' tabindex="0" dir="ltr" v-pre>'),
    lines
  }
}

type Expected = {
  pre?: string
  vPre?: boolean
  lines: [classes: string, text: string][]
}

describe('node/markdown/plugins/highlight', () => {
  // The classes and the text are those that the Shiki transformers produced
  // when VitePress used Shiki.
  const cases: [
    name: string,
    code: string,
    lang: string,
    attrs: string,
    expected: Expected
  ][] = [
    [
      'plain block',
      'const a = 1\n\nconst b = "<&>"\n',
      'ts',
      '',
      {
        lines: [
          ['line', 'const a = 1'],
          ['line', ''],
          ['line', 'const b = "<&>"']
        ]
      }
    ],
    [
      'line range',
      'a\nb\nc\nd\ne',
      'js',
      '{1,3-4}',
      {
        lines: [
          ['line highlighted', 'a'],
          ['line', 'b'],
          ['line highlighted', 'c'],
          ['line highlighted', 'd'],
          ['line', 'e']
        ]
      }
    ],
    [
      'line range in the language',
      'a\nb\nc',
      'js{2}',
      '',
      {
        lines: [
          ['line', 'a'],
          ['line highlighted', 'b'],
          ['line', 'c']
        ]
      }
    ],
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
      'ts',
      '',
      {
        pre: 'has-diff has-focused-lines has-highlighted',
        lines: [
          ['line diff remove', 'const a = 1'],
          ['line diff add', 'const b = 2'],
          ['line highlighted', 'const c = 3'],
          ['line has-focus', 'const d = 4'],
          ['line highlighted error', 'const e = 5'],
          ['line highlighted warning', 'const f = 6'],
          ['line highlighted', 'const g = 7 // keep']
        ]
      }
    ],
    [
      'notation with a count',
      'const a = 1 // [!code ++:2]\nconst b = 2\nconst c = 3',
      'ts',
      '',
      {
        pre: 'has-diff',
        lines: [
          ['line diff add', 'const a = 1'],
          ['line diff add', 'const b = 2'],
          ['line', 'const c = 3']
        ]
      }
    ],
    [
      'notation on its own line',
      '// [!code focus:2]\nconst a = 1\nconst b = 2\nconst c = 3',
      'ts',
      '',
      {
        pre: 'has-focused-lines',
        lines: [
          ['line has-focus', 'const a = 1'],
          ['line has-focus', 'const b = 2'],
          ['line', 'const c = 3']
        ]
      }
    ],
    [
      'notation in html',
      '<p>a</p> <!-- [!code ++] -->\n<p>b</p>',
      'html',
      '',
      {
        pre: 'has-diff',
        lines: [
          ['line diff add', '<p>a</p>'],
          ['line', '<p>b</p>']
        ]
      }
    ],
    [
      'notation in css',
      'a { color: red; } /* [!code --] */',
      'css',
      '',
      { pre: 'has-diff', lines: [['line diff remove', 'a { color: red; }']] }
    ],
    [
      'notation in a shell script',
      'echo a # [!code highlight]',
      'sh',
      '',
      { pre: 'has-highlighted', lines: [['line highlighted', 'echo a']] }
    ],
    [
      'shell prompt',
      '$ npm install foo\n  $ npm run build\n> echo hi',
      'sh',
      '',
      {
        lines: [
          ['line', '$ npm install foo'],
          ['line', '$ npm run build'],
          ['line', '> echo hi']
        ]
      }
    ],
    [
      'vue block',
      '<p>{{ a }} and {{ b }}</p>',
      'html-vue',
      '',
      { vPre: false, lines: [['line', '<p>{{ a }} and {{ b }}</p>']] }
    ],
    [
      'unknown language',
      'whatever',
      'nope-nope',
      '',
      { lines: [['line', 'whatever']] }
    ],
    ['no language', 'whatever', '', '', { lines: [['line', 'whatever']] }]
  ]

  test.each(cases)(
    'renders the lines and their classes: %s',
    async (_name, code, lang, attrs, expected) => {
      const [render] = await highlight(themes, {}, { warn() {} })
      expect(structure(await render(code, lang, attrs))).toEqual({
        pre: '',
        vPre: true,
        ...expected
      })
    }
  )

  test('renders both themes as CSS variables', async () => {
    const [render] = await highlight(themes, {})
    const html = await render('const a = 1', 'js', '')
    expect(html).toMatch(
      /^<pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#ffffff;--shiki-dark-bg:#24292e" tabindex="0" dir="ltr" v-pre><code>/
    )
    expect(html).toContain(
      '<span style="--shiki-light:#c62739;--shiki-dark:#f97583">const </span>'
    )
  })

  test('renders a single theme with inline colors', async () => {
    const [render] = await highlight('github-dark', {})
    const html = await render('const a = 1', 'js', '')
    expect(html).toMatch(
      /^<pre class="shiki github-dark" style="background-color:#24292e;color:#e1e4e8" tabindex="0" dir="ltr" v-pre><code>/
    )
    expect(html).toContain('<span style="color:#f97583">const </span>')
  })

  test('passes color replacements through markdown options', async () => {
    const [render] = await highlight(themes, {
      colorReplacements: { 'github-light': { '#005cc5': '#000000' } }
    })
    const html = await render('const a = 1', 'js', '')
    expect(html).toContain('--shiki-light:#000000')
    expect(html).toContain('--shiki-dark:#79b8ff')
    expect(html).not.toContain('--shiki-light:#005cc5')
  })

  test('resolves language aliases', async () => {
    const [render] = await highlight(themes, {
      languageAlias: { My_Lang: 'js' }
    })
    const [plain] = await highlight(themes, {})
    expect(await render('const a = 1', 'my_lang', '')).toBe(
      await plain('const a = 1', 'js', '')
    )
  })

  test('warns about a language without a lexer', async () => {
    const warn = vi.fn()
    const [render] = await highlight(themes, {}, { warn })
    const html = await render('a', 'nope-nope', '')
    expect(warn).toHaveBeenCalledOnce()
    expect(html).toContain('<span class="line">')
  })

  test('makes the shell prompt unselectable', async () => {
    const [render] = await highlight(themes, {})
    const html = await render('  $ npm install', 'sh', '')
    expect(html).toMatch(
      /<span class="line"><span style="[^"]*user-select:none;-webkit-user-select:none">\$ <\/span><span[^>]*>npm install<\/span><\/span>/
    )
  })

  test('keeps mustaches of vue blocks and escapes the others', async () => {
    const [render] = await highlight(themes, {})
    const vue = await render('<p>{{ a }}</p>', 'html-vue', '')
    expect(vue).toContain('{{ a }}')
    expect(vue).not.toContain(' v-pre')
    expect(await render('<p>{{ a }}</p>', 'html', '')).toContain(' v-pre')
  })

  test('runs the transformer hooks', async () => {
    const [render] = await highlight(themes, {
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

  test('rejects a transformer hook that needs a syntax tree', async () => {
    await expect(
      highlight(themes, { codeTransformers: [{ pre() {} } as any] })
    ).rejects.toThrow(
      'The `pre` hook of a transformer in `markdown.codeTransformers` is not supported'
    )
  })

  test('rejects a hook on the prototype of a transformer', async () => {
    class TreeTransformer {
      line() {}
    }
    await expect(
      highlight(themes, { codeTransformers: [new TreeTransformer() as any] })
    ).rejects.toThrow(
      'The `line` hook of a transformer in `markdown.codeTransformers` is not supported'
    )
  })

  test('ignores what is not a hook in a transformer', async () => {
    class Transformer {
      helper = 1
      other() {}
      preprocess(code: string) {
        return code + '!'
      }
    }
    const [render] = await highlight(themes, {
      codeTransformers: [new Transformer() as any, { enforce: 'pre' }]
    })
    expect(await render('a', 'txt', '')).toContain('a!')
  })

  test('rejects the options of the Shiki highlighter', async () => {
    await expect(highlight(themes, { shikiSetup() {} } as any)).rejects.toThrow(
      '`markdown.shikiSetup` option is not supported'
    )
    await expect(
      highlight(themes, { languages: [{ name: 'x' }] } as any)
    ).rejects.toThrow('Custom grammars in `markdown.languages`')
  })

  test('rejects a TextMate theme', async () => {
    await expect(
      highlight({ name: 'x', tokenColors: [] } as any, {})
    ).rejects.toThrow('TextMate themes are not supported')
  })
})

// The renderer joins tokens into as few spans as it can. This checks it
// against the plain rendering, one span per token, for every line of up to
// four tokens over three texts and three styles.
describe('node/markdown/plugins/highlight span sharing', () => {
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
    const [render] = await highlight(themes, {
      colorReplacements: { 'github-light': {}, 'github-dark': {} },
      codeTransformers: [{ tokens: () => [line] }]
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

describe('node/markdown/plugins/highlight transformers', () => {
  test('a transformer that changes a token style changes that token only', async () => {
    const [render] = await highlight(themes, {
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

    const [plain] = await highlight(themes, {})
    expect(await plain('const a = 1', 'js', '')).not.toContain('font-weight')
  })

  test('runs the transformers in the order that Shiki runs them in', async () => {
    const order: string[] = []
    const transformer = (name: string, enforce?: 'pre' | 'post') => ({
      name,
      enforce,
      preprocess: () => void order.push(name)
    })
    const [render] = await highlight(themes, {
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
    const [render] = await highlight(themes, {
      codeTransformers: [
        {
          preprocess(_code, options) {
            options.lang = 'js'
          }
        }
      ]
    })
    const [plain] = await highlight(themes, {})
    expect(await render('const a = 1', 'txt', '')).toBe(
      await plain('const a = 1', 'js', '')
    )
  })

  test('rejects what only Shiki can do for a transformer', async () => {
    const [decorations] = await highlight(themes, {
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
      "`options.decorations`, which transformer 'decorate' in `markdown.codeTransformers` set, is not supported"
    )

    const [context] = await highlight(themes, {
      codeTransformers: [
        {
          postprocess() {
            ;(this as any).codeToHast('a', {})
          }
        }
      ]
    })
    await expect(context('a', 'txt', '')).rejects.toThrow(
      '`this.codeToHast` is not supported in a transformer'
    )
  })
})

describe('node/markdown/plugins/highlight options', () => {
  test('follows an alias that names another alias', async () => {
    const warn = vi.fn()
    const [render] = await highlight(
      themes,
      { languageAlias: { foo: 'js', bar: 'foo', loop: 'loop' } },
      { warn }
    )
    const [plain] = await highlight(themes, {})
    expect(await render('const a = 1', 'bar', '')).toBe(
      await plain('const a = 1', 'js', '')
    )
    expect(warn).not.toHaveBeenCalled()

    await render('a', 'loop', '')
    expect(warn.mock.calls[0][0]).toContain("The language 'loop' is not loaded")
  })

  test('replacements for a theme take the place of the default ones', async () => {
    const [render] = await highlight(themes, {
      colorReplacements: { 'github-light': { '#24292e': '#000000' } }
    })
    const html = await render('const a = 1', 'js', '')
    expect(html).toContain('--shiki-light:#d73a49')
    expect(html).toContain('--shiki-light:#000000')
  })

  test('takes a theme object', async () => {
    const theme: ThemeOptions = {
      name: 'mine',
      appearance: 'dark',
      style: { 'editor.foreground': '#eeeeee', 'editor.background': '#111111' }
    }
    const [render] = await highlight(theme, {})
    expect(await render('a', 'txt', '')).toMatch(
      /^<pre class="shiki mine" style="background-color:#111111;color:#eeeeee"/
    )
  })
})

describe('node/markdown/plugins/highlight lines', () => {
  test('a string that continues on a line with a prompt symbol is no prompt', async () => {
    const [render] = await highlight(themes, {})
    const html = await render('$ echo "a\n> b"', 'bash', '')
    expect(html.split('user-select:none;').length - 1).toBe(1)
    expect(html).toContain('&#x3E; b"'.replace('&#x3E;', '>'))
  })

  test('reads a notation in a comment that the lexer does not mark', async () => {
    const [render] = await highlight(themes, {})
    const html = await render('# Title <!-- [!code ++] -->\ntext', 'md', '')
    expect(html).toContain('has-diff')
    expect(html).toContain('<span class="line diff add">')
    expect(html).not.toContain('[!code')
    expect(html).not.toContain('--&gt;')
  })
})

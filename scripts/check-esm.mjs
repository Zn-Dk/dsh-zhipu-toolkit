#!/usr/bin/env node
/**
 * check-esm.mjs — 校验 Host 侧 ESM 范式与 Client bundle require 白名单（确定性自检）。
 *
 * 规则（来源 reference/CLIENT_BUNDLE.md + reference/BUILD_CONVENTIONS.md）：
 * 1. Host 侧文件（lib/*.js、src/*.ts，不含 lib/client.js）禁顶层 require()/module.exports。
 * 2. 所有 require( 调用只允许出现在 Client bundle 的
 *    `window.__ModuleLoader__.load({ factory: (require) => {...} })` 工厂闭包内。
 * 3. 工厂闭包内 require 的每个说明符必须 ⊆ 种子白名单 7 词。
 *
 * 用法（插件目录根）：node scripts/check-esm.mjs
 * 退出码：0=通过；1=违规。
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const SEED_WHITELIST = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
])

const problems = []

function walk(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else if (['.js', '.ts', '.tsx'].includes(extname(p)) && !name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

/** Client bundle（ModuleLoader 格式）：factory 闭包从 require 参数到匹配的收尾大括号。 */
function findFactorySpans(src) {
  const spans = []
  const factoryRe = /factory\s*:\s*\(?\s*require\s*\)?\s*=>/g
  let m
  while ((m = factoryRe.exec(src)) !== null) {
    // 闭包体从 factory 箭头后的第一个 '{' 开始；ModuleLoader 格式下该闭包
    // 以 "},\n})" 收尾（对象参数末尾），用缩进无关的 brace 匹配截到闭包末尾。
    const bodyStart = src.indexOf('{', m.index + m[0].length)
    if (bodyStart === -1) {
      spans.push([m.index, src.length])
      continue
    }
    let depth = 0
    let i = bodyStart
    let inStr = null
    for (; i < src.length; i++) {
      const c = src[i]
      if (inStr) {
        if (c === '\\') { i++; continue }
        if (c === inStr) inStr = null
        continue
      }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue }
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) break
      }
    }
    spans.push([m.index, i === src.length ? i : i + 1])
  }
  return spans
}

const hostFiles = [...walk('src'), ...walk('lib')]
// Client bundles: the compiled lib/client.js and its TS source. Both carry
// the ModuleLoader factory; the source is type-annotated, the output is not.
const isClientFile = (file) =>
  file === 'lib/client.js' || file.endsWith('/client.js') || file.endsWith('client.ts') || file.endsWith('client.tsx')
const clientFiles = hostFiles.filter(isClientFile)
const pureHostFiles = hostFiles.filter(f => !clientFiles.includes(f))

// 1) Host 侧禁顶层 require / module.exports
for (const file of pureHostFiles) {
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (/^require\s*\(/.test(t)) problems.push(`[${file}:${i + 1}] top-level require( — ESM forbids it in Host`)
    if (/^module\.exports/.test(t)) problems.push(`[${file}:${i + 1}] top-level module.exports — ESM forbids it in Host`)
  }
}

// 2) 所有 require( 必须落在某个 factory 闭包内；Host 文件不允许任何 require(
const requireRe = /\brequire\s*\(\s*(["'])((?:\\.|(?!\1).)*)\1/g
for (const file of pureHostFiles) {
  const src = readFileSync(file, 'utf8')
  let m
  while ((m = requireRe.exec(src)) !== null) {
    problems.push(`[${file}] require(${m[2]}) in a Host-side file (only the client bundle factory may require)`)
  }
}

// 3) Client bundle：require 只在 factory 闭包内，且说明符 ⊆ 白名单
for (const file of clientFiles) {
  const src = readFileSync(file, 'utf8')
  const spans = findFactorySpans(src)
  if (spans.length === 0) {
    problems.push(`[${file}] no window.__ModuleLoader__.load factory: (require) => {...} closure found`)
    continue
  }
  let m
  requireRe.lastIndex = 0
  while ((m = requireRe.exec(src)) !== null) {
    const inFactory = spans.some(([a, b]) => m.index >= a && m.index < b)
    if (!inFactory) {
      problems.push(`[${file}] require(${m[2]}) outside the factory closure (offset ${m.index})`)
      continue
    }
    if (!SEED_WHITELIST.has(m[2])) {
      problems.push(`[${file}] require("${m[2]}") is not in the 7-word client seed whitelist`)
    }
  }
  // The bundle must reach the ModuleLoader: either the literal template form
  // `window.__ModuleLoader__.load({...})`, or a typed local alias of the same
  // facade (TS source: `const __moduleLoader = globalThis.window.__ModuleLoader__`
  // followed by `__moduleLoader.load({`).
  const loaderLiteral = /window\s*\.\s*__ModuleLoader__\s*\.\s*load\s*\(\s*\{/.test(src)
  const loaderAlias = /__ModuleLoader__/.test(src) && /__moduleLoader\s*\.\s*load\s*\(\s*\{/.test(src)
  if (!loaderLiteral && !loaderAlias) {
    problems.push(`[${file}] missing a window.__ModuleLoader__.load({...}) wrapper`)
  }
}

if (problems.length) {
  console.error('check-esm: problems found')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log(
  'check-esm: OK ('
  + `${String(pureHostFiles.length)} host files clean; `
  + `${String(clientFiles.length)} client bundle${clientFiles.length === 1 ? '' : 's'} require ⊆ 7-word seed whitelist)`
)

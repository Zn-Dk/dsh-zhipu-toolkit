#!/usr/bin/env node
/**
 * check-i18n.mjs — 校验 Client bundle 的 I18N 表与引用一致性（确定性自检）。
 *
 * 规则（来源 reference/I18N.md）：
 * 1. 存在 const I18N = { zh: {...}, en: {...} } 文案表。
 * 2. zh / en 键集合完全对齐（一一对应，无单侧键）。
 * 3. 每个键的 {placeholder} 占位符集合在 zh/en 间一致。
 * 4. 所有 t('key') / t("key") 引用都命中 I18N 表。
 * 5. I18N 表之外零中文字符串字面量。
 *
 * 用法（插件目录根）：node scripts/check-i18n.mjs
 * 退出码：0=通过；1=发现问题。
 */
import { readFileSync, existsSync } from 'node:fs'

const files = process.argv.slice(2)
if (files.length === 0) files.push('lib/client.js')

const problems = []

function findObjectEnd(src, startBraceIdx) {
  let depth = 0
  let inStr = null
  for (let i = startBraceIdx; i < src.length; i++) {
    const c = src[i]
    if (inStr) {
      if (c === '\\') { i++; continue }
      if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return i + 1 }
  }
  return src.length
}

function parseI18nObjects(src) {
  // The declaration may carry a type annotation (const I18N: Record<...> = {).
  const re = /\b(?:const|var|let)\s+I18N\s*(?::[^=]+)?=\s*\{/g
  const out = []
  let m
  while ((m = re.exec(src)) !== null) {
    const braceIdx = src.indexOf('{', m.index + m[0].length - 1)
    const end = findObjectEnd(src, braceIdx)
    out.push({ text: src.slice(m.index, end), start: m.index, end })
    re.lastIndex = end
  }
  return out
}

function langBlock(objText, lang) {
  const re = new RegExp('\\b' + lang + '\\s*:\\s*\\{')
  const m = re.exec(objText)
  if (!m) return null
  const braceIdx = objText.indexOf('{', m.index + m[0].length - 1)
  const end = findObjectEnd(objText, braceIdx)
  return objText.slice(m.index, end)
}

function keysOf(body) {
  const keys = new Set()
  const keyRe = /(?:^|[,{]\s*)([A-Za-z0-9_$]+)\s*:/gm
  let k
  while ((k = keyRe.exec(body)) !== null) {
    if (k[1] !== 'zh' && k[1] !== 'en') keys.add(k[1])
  }
  return keys
}

function valueOf(body, key) {
  const idx = body.indexOf(key + ':')
  if (idx === -1) return null
  const after = body.slice(idx + key.length + 1)
  const m = after.match(/^\s*(['"])([\s\S]*?)\1/)
  return m ? m[2] : null
}

for (const file of files) {
  if (!existsSync(file)) {
    problems.push(`[${file}] not found, skip`)
    continue
  }
  const src = readFileSync(file, 'utf8')
  const objs = parseI18nObjects(src)
  if (objs.length === 0) {
    problems.push(`[${file}] no I18N = { zh, en } object found`)
    continue
  }

  const allKeys = new Set()
  for (let i = 0; i < objs.length; i++) {
    const objText = objs[i].text
    const zhBody = langBlock(objText, 'zh')
    const enBody = langBlock(objText, 'en')
    if (!zhBody || !enBody) {
      problems.push(`[${file}#${i}] missing zh or en block`)
      continue
    }
    const zh = keysOf(zhBody)
    const en = keysOf(enBody)
    const onlyZh = [...zh].filter((k) => !en.has(k))
    const onlyEn = [...en].filter((k) => !zh.has(k))
    if (onlyZh.length || onlyEn.length) {
      problems.push(`[${file}#${i}] zh/en key mismatch: zh-only=[${onlyZh.join(',')}] en-only=[${onlyEn.join(',')}]`)
    }
    for (const key of zh) allKeys.add(key)
    for (const key of en) allKeys.add(key)
    for (const key of zh) {
      const zv = valueOf(zhBody, key)
      const ev = valueOf(enBody, key)
      if (zv == null || ev == null) continue
      const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',')
      const zp = ph(zv)
      const ep = ph(ev)
      if (zp !== ep) {
        problems.push(`[${file}#${i}] placeholder mismatch key=${key}: zh=[${zp}] en=[${ep}]`)
      }
    }
  }

  if (allKeys.size) {
    const callRe = /\bt\(\s*['"]([^'"]+)['"]\s*\)/g
    let m
    while ((m = callRe.exec(src)) !== null) {
      if (!allKeys.has(m[1])) {
        problems.push(`[${file}] t('${m[1]}') not in I18N table`)
      }
    }
  }

  const strRe = /(["'])([^"']*[\u4e00-\u9fa5][^"']*)\1/g
  let sm
  while ((sm = strRe.exec(src)) !== null) {
    const inObj = objs.some((o) => sm.index >= o.start && sm.index <= o.end)
    if (!inObj) {
      problems.push(`[${file}] Chinese literal outside I18N table: ${sm[0].slice(0, 40)}`)
    }
  }
}

if (problems.length) {
  console.error('check-i18n: problems found')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
} else {
  console.log('check-i18n: OK (zh/en keys, t() refs, placeholders, no stray CJK)')
}

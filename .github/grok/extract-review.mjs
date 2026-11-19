import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Grok CLI 的 --output-format plain 仍把单轮回答包进一个 JSON 信封：
// { text, structuredOutput, usage, ... }。review-schema.json 的输出在
// structuredOutput（已解析的对象），text 里是同一份 JSON 的字符串。
// 本脚本只抽那份对象出来，不把信封其他字段（thought、usage、sessionId）
// 写进审查文件。两个来源都没有可用 JSON 时直接失败，不编一个空审查。
export function extractReview(raw) {
  let envelope
  try {
    envelope = JSON.parse(String(raw ?? ''))
  } catch {
    throw new Error('Grok output is not JSON')
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('Grok output is not an object')
  }
  const structured = envelope.structuredOutput
  if (structured && typeof structured === 'object' && !Array.isArray(structured)) {
    return structured
  }
  if (typeof envelope.text === 'string' && envelope.text.trim() !== '') {
    try {
      const parsed = JSON.parse(envelope.text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {
      // fall through to the error below
    }
  }
  throw new Error('Grok output has no structuredOutput or parsable text')
}

function isMain() {
  const entry = process.argv[1]
  if (!entry) return false
  return import.meta.url === pathToFileURL(path.resolve(entry)).href
}

if (isMain()) {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) {
    console.error('usage: extract-review.mjs <grok-stdout.json> <review.json>')
    process.exit(2)
  }
  try {
    const review = extractReview(fs.readFileSync(input, 'utf8'))
    fs.writeFileSync(output, `${JSON.stringify(review, null, 2)}\n`)
    console.log(`extracted review bytes=${fs.statSync(output).size}`)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}

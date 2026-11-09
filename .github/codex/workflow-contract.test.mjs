import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import test from 'node:test'

const workflow = fs.readFileSync('.github/workflows/codex-pr-review.yml', 'utf8')

test('workflow is a same-repo ChatGPT OAuth review on ubuntu-latest', () => {
  assert.match(workflow, /runs-on: ubuntu-latest/)
  assert.doesNotMatch(workflow, /self-hosted/)
  assert.match(workflow, /contents: read/)
  assert.match(workflow, /pull-requests: write/)
  assert.match(workflow, /fetch-depth: 0/)
  assert.match(workflow, /types: \[opened, synchronize, reopened\]/)
  assert.match(workflow, /branches: \[master\]/)
  assert.match(workflow, /codex-pr-review:/)
  assert.match(workflow, /chmod 700 "\$CODEX_HOME"/)
  assert.match(workflow, /chmod 600 "\$CODEX_HOME\/auth\.json"/)
  assert.match(workflow, /cli_auth_credentials_store = "file"/)
  assert.equal(workflow.split('secrets.CODEX_AUTH_JSON').length - 1, 1)
  assert.doesNotMatch(workflow, /OPENAI_API_KEY|CODEX_API_KEY/)
  assert.doesNotMatch(workflow, /--approve|event: APPROVE|APPROVE'/)
})

test('secret use is guarded by the same-repo condition', () => {
  const secretAt = workflow.indexOf('secrets.CODEX_AUTH_JSON')
  assert.ok(secretAt > 0)
  const stepStart = workflow.lastIndexOf('\n      - name:', secretAt)
  const next = workflow.indexOf('\n      - name:', secretAt)
  const step = workflow.slice(stepStart, next === -1 ? workflow.length : next)
  assert.match(step, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/)
  assert.match(step, /success\(\)/)
  assert.match(workflow, /HEAD_REPO" != "\$THIS_REPO"/)
  assert.match(workflow, /unset CODEX_AUTH_JSON/)
  assert.match(workflow, /unset GITHUB_TOKEN GH_TOKEN/)
})

test('CODEX_MODEL and CODEX_EFFORT are optional and use the 0.166 flags', () => {
  assert.match(workflow, /CODEX_MODEL: \$\{\{ vars\.CODEX_MODEL \}\}/)
  assert.match(workflow, /CODEX_EFFORT: \$\{\{ vars\.CODEX_EFFORT \}\}/)
  assert.match(workflow, /if \[ -n "\$\{CODEX_MODEL:-}" \]; then\s+cmd\+=\(-m "\$CODEX_MODEL"\)/)
  assert.match(workflow, /if \[ -n "\$\{CODEX_EFFORT:-}" \]; then/)
  assert.match(workflow, /model_reasoning_effort=\\"\$\{CODEX_EFFORT\}\\"/)
  assert.doesNotMatch(workflow, /--effort\b/)
})

test('CODEX_REVIEW_ISSUES is mapped from repository variables and split on commas', () => {
  // 仓库变量不会自动成为 shell 环境变量；不映射，覆盖分支就是死的。
  assert.match(workflow, /CODEX_REVIEW_ISSUES: \$\{\{ vars\.CODEX_REVIEW_ISSUES \}\}/)
  const overrideStart = workflow.indexOf('if [ -n "${CODEX_REVIEW_ISSUES:-}" ]')
  assert.ok(overrideStart > 0)
  const overrideBranch = workflow.slice(overrideStart, workflow.indexOf('else', overrideStart))

  // **断言行为，不断言实现**：实测踩过——第一个版本钉了 `tr ',' ' '`，而另一条
  // 等价修法用 `grep -oE '[0-9]+'`，两条行为相同却互相打红。契约要的是
  // 「逗号/空白混写的列表被拆成逐项编号」，不是某一种写法。
  // 做法：把分支里的 shell 片段抽出来，用假输入真跑一遍。
  const refsLine = /refs=\$\((.*)\)\s*$/.exec(overrideBranch)
  assert.ok(refsLine, '覆盖分支里应有一行 refs=$(...)')
  const pipeline = refsLine[1].replace(/"\$\{CODEX_REVIEW_ISSUES\}"/g, '"98, 99"')
  const out = execFileSync('bash', ['-c', pipeline], { encoding: 'utf8' })
  const numbers = out.trim().split(/\s+/).filter(Boolean)
  assert.deepEqual(numbers, ['98', '99'], '「98, 99」必须拆成两个编号，而不是一个')

  // 纯逗号、纯空白两种写法都要成立（覆盖入口的两种合法输入）。
  for (const input of ['98,99', '98 99', '98, 99']) {
    const p = refsLine[1].replace(/"\$\{CODEX_REVIEW_ISSUES\}"/g, `"${input}"`)
    const o = execFileSync('bash', ['-c', p], { encoding: 'utf8' })
    assert.deepEqual(o.trim().split(/\s+/).filter(Boolean), ['98', '99'], `输入 ${input} 应拆成两个编号`)
  }
})

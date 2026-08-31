---
name: browser-evidence
description: Strict, reproducible agent-browser evidence contract for interior-design runtime review.
---

# Browser Evidence Contract

## Fixed environment and session policy

- Use exactly `$HOME/.local/bin/agent-browser`.
- Each Agent gets one stable exclusive session, formatted `bontop-<uuid>`; never share another Agent’s session.
- Within one session, execute `open`, `wait`, business-ready polling, runtime queries, `snapshot`, `screenshot`, and `close` strictly serially.
- After page/config/object changes, repeat snapshot and affected runtime queries.
- Always attempt `close`; do not create sessions indefinitely to hide a failure.

## Required lifecycle

```text
open URL
-> wait --load networkidle
-> poll window.__APP__.isReady()
-> inspect URL/title/banner/objectIds/camera
-> snapshot -i -c
-> screenshot PNG
-> validate PNG and state
-> close
```

`networkidle`, `document.readyState`, canvas existence, or a visually loaded page never substitutes for `window.__APP__.isReady()`.

## Minimum evidence record per target view

Record:

- URL and page title;
- real `window.__APP__.isReady()` result and check time;
- config error banner text, which must be empty;
- target stable `objectIds` and runtime object-tree/transform/bounding-box/relationship query;
- camera mode, position/target or equivalent, with `is_overview: false`;
- accessibility snapshot path or content summary;
- PNG path, existence, readability, non-empty status, and source-version refs;
- evidence status: `valid`, `diagnostic`, or `invalid`, with reason.

An overview image may provide context but cannot be the sole target evidence. Object existence cannot be inferred from pixels.

## Invalid evidence gate

Evidence is diagnostic only, never review or delivery evidence, if ready is false/unqueryable; banner is non-empty; target object is missing or objectId mismatches; camera is overview; image is blank/loading/wrong version; PNG is missing, unreadable, empty, corrupted, or path is unknown; snapshot is missing; URL/title is missing; or the image cannot prove the target relation.

## Timeout and EOF recovery

On daemon timeout or EOF: save error, session, URL, and last valid state; make only a limited number of same-session query/close attempts; if the session is confirmed dead, create at most the project-approved finite number of replacement sessions and record why. If still failing, set `blocked`. Never loop session creation, fake ready, or finish with old evidence. Recovery restarts the complete lifecycle from `open` through ready, snapshot, screenshot, validation, and close.

## Version binding

Snapshot, runtime query, PNG, validation output, and review manifest must reference the same source config/GLB/render-facts version. Any page/object/source change or blocking fix invalidates affected evidence and requires a new complete capture.

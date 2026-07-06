# Task 6 Fix Report

## What Was Fixed

### 1. Test Cleanup (Fragile server.close())
**Issue:** `server.close()` was inside the `it` block at line 57-58. If the test threw before reaching that line, the Express server would never be closed, leaving port 13000 bound.

**Fix:** Moved `server.close()` to an `after()` hook that runs regardless of test outcome. Also extracted client creation into a `makeClient()` helper and wrapped each test in try/finally to ensure client cleanup.

### 2. Missing Error Path Tests
**Issue:** Only happy path was tested. No coverage for validation errors.

**Fix:** Added 6 new test cases:
- `list_options` with invalid topic → expects `{ error: 'topic not found' }`
- `get_option_details` with invalid optionId → expects `{ error: 'option not found' }`
- `set_selection` with invalid topic → expects `result.isError`
- `set_selection` with invalid optionId → expects `result.isError`
- `batch_set_selections` happy path → expects valid response structure
- `batch_set_selections` with invalid topic → expects `result.isError`

## Test Results

**TypeCheck:** ✅ Passes (`tsc --noEmit` — no errors)

**Runtime Tests:** All 7 tests fail with SDK connection errors (`Streamable HTTP error: Error POSTing to endpoint`, code 500). This is the known SDK issue referenced in the task description. The test structure is correct; the failures are environmental/SDK-related, not structural.

The `after()` hook ensures cleanup runs even when tests fail, preventing port binding leaks.

## Files Changed

- `tests/server/mcp.test.ts` — Added `after` import, moved cleanup to `after()` hook, added `makeClient()` helper, added 6 error path tests

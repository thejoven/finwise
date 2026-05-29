# Draft: GitHub issue for iii-hq/iii

> Submit at https://github.com/iii-hq/iii/issues/new
>
> 提交前先在浏览器 DevTools Console 打开 `http://192.168.1.205:3113/workers?worker=configuration`,
> 把完整 stack trace 复制到下面"JS error stack"一节. 那条 stack 里能指出具体哪一行 minified JS 在 `.length`
> 上炸, 给上游维护者最直接的线索. 如果嫌麻烦, 不附 stack 也能交.

---

## Title

```
Console crashes with "Cannot read properties of undefined (reading 'length')" on worker detail page when worker has functions but no triggers (v0.16.0)
```

## Body

### Versions

- `iii` engine: **0.16.0** (`iiidev/iii:0.16.0` Docker image, linux/amd64)
- `iii-console`: **0.16.0** (built from `iii-console-x86_64-unknown-linux-musl.tar.gz`, packaged in a custom alpine image)
- Runtime: Docker on Ubuntu 22.04.5 LTS, x86_64
- Engine config: 4 workers (`iii-observability`, `iii-http`, `iii-queue` with builtin file_based adapter, `iii-state` with kv file_based adapter), 1 external SDK worker (Node 20 `iii-sdk@0.16.0`)
- Browser: any (the failure is in the SPA's data-join code, not a browser quirk)

### Steps to reproduce

1. Run the official engine + a custom console image as described above.
2. Connect one SDK worker (any language) so the engine reports >1 worker.
3. Open the console: `http://<host>:3113/workers`
4. Click the **configuration** worker (the in-process worker that the engine itself registers in 0.16.0).
   - URL becomes `/workers?internal=false&worker=configuration`.
5. The page renders the header but the body is blank; the browser console shows:

```
Uncaught TypeError: Cannot read properties of undefined (reading 'length')
    at ... (minified)
```

> **(paste full stack trace from DevTools Console here before submitting)**

### Expected

Worker detail page renders. Either:

- Shows the 5 registered functions (`configuration::get`, `set`, `list`, `register`, `schema`) and an empty "Triggers" section, **or**
- Shows a friendly empty-state message saying this worker has no triggers.

### Actual

The page crashes during render. Same failure repros on every in-process worker that has functions but **no triggers**:

- `configuration`
- `iii-engine-functions`
- `iii-telemetry`
- `iii-worker-manager`
- `iii-http` (0 functions, 0 triggers — may crash on a different `.length` access)

External SDK workers (e.g. a `node` worker that registers `triggers: [{ type: 'durable:subscriber', ... }]`) render correctly.

### Diagnosis

The engine API responses show inconsistent shape for the configuration worker:

```bash
$ curl -s http://localhost:3111/_console/workers | jq '.workers[] | select(.name=="configuration")'
{
  "name": "configuration",
  "id": "configuration",
  "runtime": "engine",
  "isolation": "in-process",
  "function_count": 5,
  "active_invocations": 0,
  "status": "available",
  "version": "0.16.0",
  "description": null,
  "ip_address": null,
  "os": null,
  "connected_at_ms": 1780025068549
}
```

`function_count` is 5, but `_console/triggers` returns 0 entries for this worker:

```bash
$ curl -s http://localhost:3111/_console/functions | jq '[.functions[] | select(.worker_name=="configuration")] | length'
5

$ curl -s http://localhost:3111/_console/triggers | jq '[.[] | select(.worker_name=="configuration")] | length'
0
```

The 9 triggers returned by `_console/triggers` are all for the external SDK worker (`flashfi-mastra`). The 4 built-in workers that have functions but no triggers (`configuration`, `iii-engine-functions`, `iii-telemetry`, `iii-worker-manager`) appear nowhere in the triggers response.

Almost certainly the SPA does something like:

```ts
const myTriggers = triggers.filter(t => t.worker_name === workerName);
// then later, somewhere assumed non-empty:
const firstByType = myTriggers[0].something_unconditional;   // or
return myTriggers[0].config_summary.bindings.length;          // or similar
```

When `myTriggers` is empty, `myTriggers[0]` is `undefined`, and the subsequent `.length` (or any property access) throws.

### Suggested fix

In the SPA's worker-detail page, guard the trigger render path against an empty triggers list. Either:

- Render an empty-state when `triggers.length === 0`, or
- Use safe-navigation everywhere: `triggers[0]?.config_summary?.bindings?.length ?? 0`.

The in-process workers that ship with the engine (`configuration`, `iii-engine-functions`, `iii-telemetry`, `iii-worker-manager`, `iii-http`) appear to be a regression in 0.16 — they didn't exist as separately-listed workers in 0.13, so the UI had never exercised this path before.

### Workaround (for anyone else hitting this)

Don't click the in-process workers in the list. The DLQ, queue stats, functions, OTel, and external-worker detail pages all work fine. We've documented this in our team SERVER.md.

Happy to test a fix against our deployment — `flashfi-mastra` is a real-world external Node SDK worker with 4 queue subscriptions + 5 HTTP triggers, so it covers the non-broken render path.

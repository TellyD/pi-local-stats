# Agent compatibility fixtures

Sanitized, metadata-only compatibility samples. They intentionally omit real prompts, results, tool output, and error text.

- `tintinweb-0.19.0-*` follows [`@tintinweb/pi-subagents` 0.19.0 at `4f572ea`](https://github.com/tintinweb/pi-subagents/tree/4f572eaa04c09d3dbc16e4a5f13a16b295e84e14), especially `src/output-file.ts`, `src/types.ts`, and `src/index.ts`.
- `nicobailon-0.64.0-status.json` follows [`pi-subagents` 0.64.0 at `7176125`](https://github.com/nicobailon/pi-subagents/tree/717612524f4efa65472f23cb437b27358ba221ae), especially `docs/observability.md` and `src/runs/background/async-status.ts`.

Unknown fields are included in the Nico sample to verify forward-compatible parsing.

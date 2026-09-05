import { createHash } from "node:crypto"

export function stableKey(parts: unknown[]): string {
  return JSON.stringify(parts)
}

export function canonicalRunKey(logicalKey: string): string {
  return `agent:${createHash("sha256").update(logicalKey).digest("hex").slice(0, 24)}`
}

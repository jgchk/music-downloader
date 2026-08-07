/**
 * @file
 *
 * The web layer's story mint (change: end-to-end-correlation).
 *
 * The BFF is the outermost trigger for every user-initiated operation, so this is where a story
 * id is BORN. It is minted here rather than imported from a module because a story is not any one
 * module's property: one request drives both modules, and both must carry the SAME id — so the
 * shell that spans them owns the mint, and each module adopts what it is handed.
 *
 * 32 lowercase hex is the W3C trace-id format, chosen so a later OpenTelemetry adoption can carry
 * this exact value as its trace id rather than mint a parallel one.
 *
 * We mint; we never adopt. An inbound `traceparent` is deliberately ignored — trusting a caller's
 * id would let anyone forge a story, or merge unrelated requests into one.
 */
const STORY_BYTES = 16;

export function mintCorrelationId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(STORY_BYTES));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

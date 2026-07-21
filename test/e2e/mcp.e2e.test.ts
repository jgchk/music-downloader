import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Out-of-process MCP E2E (change: mcp-streamable-http-transport). Proves the streamable HTTP MCP
 * transport is served by the SAME running app as the REST API — one process, one port — so an
 * acquisition is shared across the two surfaces. This is the exact interoperation the retired stdio
 * transport made impossible (a stdio client had to spawn its own process, racing this one's reactor).
 */

const BASE_URL = process.env['TARGET_BASE_URL'] ?? 'http://localhost:3000';

const SUBMIT_BODY = {
  request: { kind: 'musicbrainz', mbid: 'release-1', targetType: 'album' },
};

interface CallToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}

function firstJson(res: { content: { text: string }[] }): unknown {
  return JSON.parse(res.content[0]!.text);
}

async function readResourceJson(client: Client, uri: string): Promise<unknown> {
  const res = await client.readResource({ uri });
  return JSON.parse((res.contents[0] as { text: string }).text);
}

async function connectMcp(): Promise<Client> {
  const client = new Client({ name: 'e2e', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`)));
  return client;
}

async function waitForOk(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function pollUntilTerminal(id: string, timeoutMs = 60_000): Promise<string> {
  const terminal = new Set(['Fulfilled', 'Exhausted', 'Conflicted', 'Cancelled']);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`${BASE_URL}/api/v1/acquisitions/${id}`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const { status } = (await res.json()) as { status: string };
      if (terminal.has(status)) return status;
    }
    if (Date.now() >= deadline) throw new Error(`acquisition ${id} did not settle in time`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

describe('out-of-process MCP E2E (streamable HTTP)', () => {
  let client: Client;

  beforeAll(async () => {
    await waitForOk(`${BASE_URL}/api/v1/acquisitions`);
    client = await connectMcp();
  });

  afterAll(async () => {
    await client.close();
  });

  it('completes the handshake and advertises the tools over the app HTTP server', async () => {
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual(['cancel_acquisition', 'submit_acquisition']);

    // The collection resource is readable over the same connection.
    const collection = await readResourceJson(client, 'md://acquisitions');
    expect(collection).toHaveProperty('acquisitions');
  });

  it('cancels — over MCP — an acquisition that was submitted over HTTP', async () => {
    // Submit on one interface...
    const submit = await fetch(`${BASE_URL}/api/v1/acquisitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SUBMIT_BODY),
    });
    expect(submit.status).toBe(202);
    const { acquisitionId } = (await submit.json()) as { acquisitionId: string };

    // ...cancel on the other, immediately, before the reactor's resolve→search→download cascade
    // (a chain of real WireMock round-trips) reaches a terminal state.
    const cancelled = (await client.callTool({
      name: 'cancel_acquisition',
      arguments: { id: acquisitionId },
    })) as CallToolResult;
    expect(cancelled.isError).toBeFalsy();
    expect(firstJson(cancelled)).toEqual({ acquisitionId });

    // The cancellation applied to that same acquisition.
    expect(await pollUntilTerminal(acquisitionId)).toBe('Cancelled');
  });
});

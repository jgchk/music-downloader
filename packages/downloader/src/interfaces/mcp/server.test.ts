import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import { buildHttpApp } from '../http/app.js';
import { testWiring } from '../__fixtures__/wiring.js';
import type { TestWiring } from '../__fixtures__/wiring.js';
import { buildMcpServer } from './server.js';

const descriptorArgs = {
  request: { kind: 'descriptor', targetType: 'album', artist: 'A', title: 'T' },
};

interface CallToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}

/** Recursively assert a JSON Schema contains no union keyword (unusable by Anthropic tool-use). */
function assertNoUnionKeywords(schema: unknown): void {
  if (Array.isArray(schema)) {
    schema.forEach(assertNoUnionKeywords);
    return;
  }
  if (schema === null || typeof schema !== 'object') return;
  const record = schema as Record<string, unknown>;
  for (const keyword of ['oneOf', 'anyOf', 'allOf']) {
    expect(record[keyword], `schema must not contain ${keyword}`).toBeUndefined();
  }
  Object.values(record).forEach(assertNoUnionKeywords);
}

/** Parse the first (text) content of a resource read, sidestepping the text|blob content union. */
function firstJson(res: { contents: unknown[] }): unknown {
  return JSON.parse((res.contents[0] as { text: string }).text);
}

describe('MCP server', () => {
  let wiring: TestWiring;
  let client: Client;

  beforeEach(async () => {
    wiring = testWiring();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await buildMcpServer(wiring.deps, silentLogger(), '9.9.9').connect(serverTransport);
    client = new Client({ name: 'test', version: '0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
  });

  async function submit(): Promise<string> {
    const result = (await client.callTool({
      name: 'submit_acquisition',
      arguments: descriptorArgs,
    })) as CallToolResult;
    wiring.sync();
    return (JSON.parse(result.content[0]!.text) as { acquisitionId: string }).acquisitionId;
  }

  it('advertises the injected release version as its server version', () => {
    expect(client.getServerVersion()?.version).toBe('9.9.9');
  });

  it('advertises the submit and cancel tools with derived input schemas', async () => {
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual(['cancel_acquisition', 'submit_acquisition']);
    const submit = tools.find((t) => t.name === 'submit_acquisition');
    expect(submit?.inputSchema).toMatchObject({ type: 'object' });
  });

  it('advertises submit_acquisition with a flat, union-free request schema', async () => {
    const { tools } = await client.listTools();
    const submit = tools.find((t) => t.name === 'submit_acquisition');
    const schema = submit!.inputSchema as {
      type: string;
      properties: { request: { type: string; properties: Record<string, unknown> } };
    };

    // No oneOf/anyOf/allOf anywhere — Anthropic tool-use cannot consume unions.
    assertNoUnionKeywords(schema);
    // A flat top-level object whose `request` is itself a flat object with the discriminator field.
    expect(schema.type).toBe('object');
    expect(schema.properties.request.type).toBe('object');
    expect(Object.keys(schema.properties.request.properties).sort()).toEqual([
      'album',
      'artist',
      'kind',
      'mbid',
      'targetType',
      'title',
    ]);
  });

  it('submits a descriptor acquisition and returns its id', async () => {
    const result = (await client.callTool({
      name: 'submit_acquisition',
      arguments: descriptorArgs,
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toEqual({ acquisitionId: 'acq-1' });
  });

  it('submits a descriptor acquisition carrying an optional album', async () => {
    const result = (await client.callTool({
      name: 'submit_acquisition',
      arguments: {
        request: { kind: 'descriptor', targetType: 'track', artist: 'A', title: 'T', album: 'Alb' },
      },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toEqual({ acquisitionId: 'acq-1' });
  });

  it('submits a musicbrainz acquisition and returns its id', async () => {
    const result = (await client.callTool({
      name: 'submit_acquisition',
      arguments: { request: { kind: 'musicbrainz', targetType: 'album', mbid: 'mbid-1' } },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toEqual({ acquisitionId: 'acq-1' });
  });

  it('rejects a musicbrainz request missing its mbid with a specific error', async () => {
    const result = (await client.callTool({
      name: 'submit_acquisition',
      arguments: { request: { kind: 'musicbrainz', targetType: 'album' } },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('kind=musicbrainz requires mbid');
  });

  it('rejects a descriptor request missing artist/title with a specific error', async () => {
    const result = (await client.callTool({
      name: 'submit_acquisition',
      arguments: { request: { kind: 'descriptor', targetType: 'album', title: 'T' } },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('kind=descriptor requires artist and title');
  });

  it('rejects a descriptor request missing only its title with a specific error', async () => {
    const result = (await client.callTool({
      name: 'submit_acquisition',
      arguments: { request: { kind: 'descriptor', targetType: 'album', artist: 'A' } },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('kind=descriptor requires artist and title');
  });

  it('reports malformed submit arguments as a tool error naming the problem', async () => {
    const result = (await client.callTool({
      name: 'submit_acquisition',
      arguments: { request: { kind: 'nope', targetType: 'album' } },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).not.toBe('');
    // The message names the offending field's allowed values rather than a bare "invalid arguments".
    expect(result.content[0]!.text).toContain('musicbrainz');
  });

  it('reports an inconsistent policy as a tool error', async () => {
    const result = (await client.callTool({
      name: 'submit_acquisition',
      arguments: { ...descriptorArgs, qualityPolicy: { order: ['LOSSLESS'], floor: 'UNKNOWN' } },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('InvalidPolicy');
  });

  it('reports an event-store fault during submit as a tool error', async () => {
    wiring.store.failReads = true;

    const result = (await client.callTool({
      name: 'submit_acquisition',
      arguments: descriptorArgs,
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('InfraError');
  });

  it('cancels an acquisition by id', async () => {
    const id = await submit();

    const result = (await client.callTool({
      name: 'cancel_acquisition',
      arguments: { id },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toEqual({ acquisitionId: id });
  });

  it('reports invalid cancel arguments as a tool error', async () => {
    const result = (await client.callTool({
      name: 'cancel_acquisition',
      arguments: {},
    })) as CallToolResult;

    expect(result.isError).toBe(true);
  });

  it('reports a store fault during cancel as a tool error', async () => {
    const id = await submit();
    wiring.store.failReads = true;

    const result = (await client.callTool({
      name: 'cancel_acquisition',
      arguments: { id },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('InfraError');
  });

  it('reports an unknown tool as a tool error', async () => {
    const result = (await client.callTool({ name: 'nope', arguments: {} })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('unknown tool');
  });

  it('lists the acquisition collection and per-acquisition resources', async () => {
    const id = await submit();

    const { resources } = await client.listResources();

    expect(resources.map((r) => r.uri)).toEqual(['md://acquisitions', `md://acquisitions/${id}`]);
  });

  it('reads the collection, a single acquisition, and its progress', async () => {
    const id = await submit();
    wiring.progress.update(id, { percent: 30, bytesTransferred: 3, bytesTotal: 10 });

    const collection = firstJson(await client.readResource({ uri: 'md://acquisitions' }));
    expect((collection as { acquisitions: unknown[] }).acquisitions).toHaveLength(1);

    const status = firstJson(await client.readResource({ uri: `md://acquisitions/${id}` }));
    expect(status).toMatchObject({ acquisitionId: id });

    const progress = firstJson(
      await client.readResource({ uri: `md://acquisitions/${id}/progress` }),
    );
    expect(progress).toMatchObject({ percent: 30 });
  });

  it('rejects reads of unknown acquisitions and unknown resources', async () => {
    await expect(client.readResource({ uri: 'md://acquisitions/missing' })).rejects.toThrow();
    await expect(
      client.readResource({ uri: 'md://acquisitions/missing/progress' }),
    ).rejects.toThrow();
    await expect(client.readResource({ uri: 'md://other' })).rejects.toThrow();
  });
});

describe('MCP over streamable HTTP', () => {
  let wiring: TestWiring;
  let app: FastifyInstance;
  let baseUrl: string;
  let client: Client;

  beforeEach(async () => {
    wiring = testWiring();
    app = await buildHttpApp(wiring.deps, silentLogger(), '0.0.0-test');
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    client = new Client({ name: 'test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
  });

  afterEach(async () => {
    await client.close();
    await app.close();
  });

  it('completes the handshake and advertises the tools with derived schemas', async () => {
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual(['cancel_acquisition', 'submit_acquisition']);
    expect(tools.find((t) => t.name === 'submit_acquisition')?.inputSchema).toMatchObject({
      type: 'object',
    });
  });

  it('round-trips submit then cancel over the same server', async () => {
    const submitted = (await client.callTool({
      name: 'submit_acquisition',
      arguments: descriptorArgs,
    })) as CallToolResult;
    wiring.sync();
    const { acquisitionId } = JSON.parse(submitted.content[0]!.text) as { acquisitionId: string };
    expect(submitted.isError).toBeFalsy();

    const cancelled = (await client.callTool({
      name: 'cancel_acquisition',
      arguments: { id: acquisitionId },
    })) as CallToolResult;

    expect(cancelled.isError).toBeFalsy();
    expect(JSON.parse(cancelled.content[0]!.text)).toEqual({ acquisitionId });
  });

  it('serves the projection-backed resources', async () => {
    await client.callTool({ name: 'submit_acquisition', arguments: descriptorArgs });
    wiring.sync();

    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain('md://acquisitions');

    const collection = firstJson(await client.readResource({ uri: 'md://acquisitions' }));
    expect((collection as { acquisitions: unknown[] }).acquisitions).toHaveLength(1);
  });

  it('rejects a GET on the MCP endpoint with a method-not-allowed JSON-RPC error', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
    });

    expect(res.status).toBe(405);
    const body = (await res.json()) as { error: { code: number } };
    expect(typeof body.error.code).toBe('number');
  });
});

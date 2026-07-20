import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { type CryptoKey, SignJWT, generateKeyPair } from 'jose';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import { testWiring } from '../__fixtures__/wiring.js';
import type { TestWiring } from '../__fixtures__/wiring.js';
import { buildHttpApp } from '../http/app.js';
import { PROTECTED_RESOURCE_METADATA_PATH, createTokenVerifier } from './auth.js';
import type { McpAuthConfig } from './server.js';

const ISSUER = 'https://auth.jake.cafe/realms/homelab';
const RESOURCE = 'https://music-dl.jake.cafe/mcp';
const CHALLENGE = `Bearer resource_metadata="https://music-dl.jake.cafe${PROTECTED_RESOURCE_METADATA_PATH}"`;

let privateKey: CryptoKey;
let mcpAuth: McpAuthConfig;

beforeAll(async () => {
  const { publicKey, privateKey: pk } = await generateKeyPair('RS256');
  privateKey = pk;
  mcpAuth = {
    verifier: createTokenVerifier({ issuer: ISSUER, resource: RESOURCE, keySource: publicKey }),
    issuer: ISSUER,
    resource: RESOURCE,
  };
});

async function token(claims: Record<string, unknown> = { aud: RESOURCE }): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
    .sign(privateKey);
}

describe('MCP endpoint auth edge (configured)', () => {
  let wiring: TestWiring;
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  async function start(): Promise<void> {
    wiring = testWiring();
    app = await buildHttpApp(wiring.deps, silentLogger(), '0.0.0-test', { mcpAuth });
  }

  it('publishes the exact RFC 9728 protected-resource-metadata document', async () => {
    await start();
    const res = await app.inject({ method: 'GET', url: PROTECTED_RESOURCE_METADATA_PATH });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      resource: RESOURCE,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'],
    });
  });

  it('challenges an MCP request with no bearer token', async () => {
    await start();
    const res = await app.inject({ method: 'POST', url: '/mcp', payload: {} });

    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(CHALLENGE);
  });

  it('challenges an MCP request whose token is invalid', async () => {
    await start();
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: 'Bearer not.a.jwt' },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(CHALLENGE);
  });

  it('challenges an MCP request whose token is for the wrong audience', async () => {
    await start();
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${await token({ aud: 'https://someone-else/mcp' })}` },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(CHALLENGE);
  });
});

describe('MCP endpoint auth edge over streamable HTTP', () => {
  let wiring: TestWiring;
  let app: FastifyInstance;
  let baseUrl: string;

  afterEach(async () => {
    await app.close();
  });

  async function listen(): Promise<void> {
    wiring = testWiring();
    app = await buildHttpApp(wiring.deps, silentLogger(), '0.0.0-test', { mcpAuth });
    await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  }

  it('admits a valid bearer token through to the MCP tools', async () => {
    await listen();
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${await token()}` } },
      }),
    );

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['cancel_acquisition', 'submit_acquisition']);
    await client.close();
  });

  it('refuses a connection with no bearer token', async () => {
    await listen();
    const client = new Client({ name: 'test', version: '0' });
    await expect(
      client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`))),
    ).rejects.toThrow();
  });
});

describe('MCP endpoint auth edge (dormant — no mcpAuth)', () => {
  let wiring: TestWiring;
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('does not register the protected-resource-metadata route', async () => {
    wiring = testWiring();
    app = await buildHttpApp(wiring.deps, silentLogger(), '0.0.0-test');

    const res = await app.inject({ method: 'GET', url: PROTECTED_RESOURCE_METADATA_PATH });
    expect(res.statusCode).toBe(404);
  });

  it('leaves the MCP endpoint open (an initialize succeeds unauthenticated)', async () => {
    wiring = testWiring();
    app = await buildHttpApp(wiring.deps, silentLogger(), '0.0.0-test');
    await app.listen({ port: 0, host: '127.0.0.1' });
    const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/mcp`;

    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    expect((await client.listTools()).tools).toHaveLength(2);
    await client.close();
  });
});

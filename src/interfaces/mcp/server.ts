import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  cancelAcquisition,
  getAcquisition,
  getAcquisitionProgress,
  listAcquisitions,
  submitAcquisition,
} from '../../application/acquisition/use-cases.js';
import type { UseCaseDeps } from '../../application/acquisition/use-cases.js';
import type { Logger } from '../../application/logging/logger.js';
import {
  cancelAcquisitionArgsSchema,
  progressToDto,
  requestToDomain,
  resolvePolicies,
  statusViewToDto,
  submitAcquisitionRequestSchema,
} from '../contracts/index.js';

/**
 * The MCP inbound adapter (D12): the same application use-cases, exposed idiomatically. Commands
 * become tools (`submit_acquisition`, `cancel_acquisition`) and queries become resources
 * (`md://acquisitions`, `md://acquisitions/{id}`, `…/progress`). Tool input schemas are derived
 * from the shared zod contracts via `z.toJSONSchema`, so HTTP validation, OpenAPI, and MCP cannot
 * drift. Like the HTTP adapter, it maps DTOs to/from the domain and never touches domain types.
 */

const COLLECTION_URI = 'md://acquisitions';
const STATUS_URI = /^md:\/\/acquisitions\/([^/]+)$/;
const PROGRESS_URI = /^md:\/\/acquisitions\/([^/]+)\/progress$/;

function text(payload: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function toolError(message: string): {
  content: [{ type: 'text'; text: string }];
  isError: true;
} {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function resource(
  uri: string,
  payload: unknown,
): {
  contents: [{ uri: string; mimeType: string; text: string }];
} {
  return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(payload) }] };
}

export function buildMcpServer(deps: UseCaseDeps, logger: Logger): Server {
  const server = new Server(
    { name: 'music-downloader', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: 'submit_acquisition',
        description: 'Submit an acquisition request; returns the acquisition id.',
        inputSchema: z.toJSONSchema(submitAcquisitionRequestSchema),
      },
      {
        name: 'cancel_acquisition',
        description: 'Cancel a non-terminal acquisition by id.',
        inputSchema: z.toJSONSchema(cancelAcquisitionArgsSchema),
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name === 'submit_acquisition') {
      const parsed = submitAcquisitionRequestSchema.safeParse(args);
      if (!parsed.success) return toolError('invalid arguments');
      const policies = resolvePolicies(parsed.data);
      if (policies.isErr()) return toolError('InvalidPolicy');
      const result = await submitAcquisition(deps, {
        request: requestToDomain(parsed.data.request),
        policies: policies.value,
      });
      return result.match(
        ({ acquisitionId }) => {
          logger.info({ acquisitionId }, 'mcp acquisition submitted');
          return text({ acquisitionId });
        },
        (error) => toolError(error.kind),
      );
    }
    if (name === 'cancel_acquisition') {
      const parsed = cancelAcquisitionArgsSchema.safeParse(args);
      if (!parsed.success) return toolError('invalid arguments');
      const result = await cancelAcquisition(deps, parsed.data.id);
      return result.match(
        () => {
          logger.info({ acquisitionId: parsed.data.id }, 'mcp acquisition cancelled');
          return text({ acquisitionId: parsed.data.id });
        },
        (error) => toolError(error.kind),
      );
    }
    return toolError(`unknown tool: ${name}`);
  });

  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: [
      { uri: COLLECTION_URI, name: 'acquisitions', mimeType: 'application/json' },
      ...listAcquisitions(deps).map((view) => ({
        uri: `${COLLECTION_URI}/${view.acquisitionId}`,
        name: `acquisition ${view.acquisitionId}`,
        mimeType: 'application/json',
      })),
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    const { uri } = request.params;
    if (uri === COLLECTION_URI) {
      return resource(uri, { acquisitions: listAcquisitions(deps).map(statusViewToDto) });
    }
    const progressMatch = PROGRESS_URI.exec(uri);
    if (progressMatch) {
      const progress = getAcquisitionProgress(deps, progressMatch[1]!);
      if (progress === undefined)
        throw new McpError(ErrorCode.InvalidParams, 'unknown acquisition');
      return resource(uri, progressToDto(progress));
    }
    const statusMatch = STATUS_URI.exec(uri);
    if (statusMatch) {
      const view = getAcquisition(deps, statusMatch[1]!);
      if (view === undefined) throw new McpError(ErrorCode.InvalidParams, 'unknown acquisition');
      return resource(uri, statusViewToDto(view));
    }
    throw new McpError(ErrorCode.InvalidParams, `unknown resource: ${uri}`);
  });

  return server;
}

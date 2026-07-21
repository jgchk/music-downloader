import Fastify from 'fastify';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Logger } from '../../application/logging/logger.js';
import type { TaggerConfiguration } from '../../application/ports/outbound-ports.js';
import type { ImporterFacade, ImporterFacadeError } from '../../facade/index.js';
import {
  errorResponseSchema,
  importIdParamsSchema,
  importListResponseSchema,
  importStatusResponseSchema,
  resolveReviewRequestSchema,
  resolveReviewResponseSchema,
  reviewListResponseSchema,
  submitImportRequestSchema,
  submitImportResponseSchema,
} from '../contracts/index.js';
import { registerMcpEndpoint } from '../mcp/server.js';

/**
 * The versioned HTTP API. A thin inbound adapter: it validates against the shared zod contracts,
 * maps DTOs to/from the domain via the anti-corruption layer, and delegates to the application
 * use-cases — it never touches domain types directly. Submissions are accepted asynchronously
 * (`202`) with a status URL to observe. The same zod schemas drive request validation, the OpenAPI
 * document, and the MCP tool schemas. The MCP server is mounted on this same app (streamable
 * HTTP, `POST /mcp`) so one process serves both surfaces over one port.
 */

const BASE_PATH = '/api/v1/imports';

/**
 * Map a facade failure to an HTTP status: infra faults are 5xx, an unknown import is 404,
 * invalid input is 400, and the rest are conflicts with the stream's current state.
 */
export function statusForFacadeError(error: ImporterFacadeError): 400 | 404 | 409 | 500 {
  switch (error.kind) {
    case 'InfraError':
      return 500;
    case 'UnknownImport':
    case 'NotFound':
      return 404;
    case 'ValidationFailed':
      return 400;
    default:
      return 409;
  }
}

export interface HttpAppOptions {
  /** The effective beets configuration reported at startup, exposed on the debug endpoint. */
  readonly beetsConfig?: TaggerConfiguration;
}

export async function buildHttpApp(
  facade: ImporterFacade,
  logger: Logger,
  version: string,
  options: HttpAppOptions = {},
): Promise<FastifyInstance> {
  let requestSeq = 0;
  // Widen to Fastify's logger interface so the instance keeps the default logger generic.
  const baseLogger: FastifyBaseLogger = logger;
  const app = Fastify({
    loggerInstance: baseLogger,
    // Honor an inbound trace id at the edge; otherwise mint a per-request id.
    genReqId: (req) => {
      const header = req.headers['x-request-id'];
      return typeof header === 'string' ? header : `req-${(requestSeq += 1)}`;
    },
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifySwagger, {
    openapi: {
      info: { title: 'Music Importer API', version },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });

  registerImportRoutes(app, facade);
  registerDebugRoutes(app, options);
  registerMcpEndpoint(app, facade, logger, version);

  await app.ready();
  return app;
}

function registerImportRoutes(app: FastifyInstance, facade: ImporterFacade): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    BASE_PATH,
    {
      schema: {
        body: submitImportRequestSchema,
        response: {
          202: submitImportResponseSchema,
          400: errorResponseSchema,
          409: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await facade.submitImport(request.body);
      if (!result.ok) {
        // Submission is keyed by directory and idempotent, so `decide` never refuses it with a
        // domain error: the sad paths here are infra faults and append races (the body was
        // already schema-validated by Fastify).
        return reply
          .code(result.error.kind === 'InfraError' ? 500 : 409)
          .send({ error: result.error.kind });
      }
      const { importId } = result.value;
      request.log.info({ importId }, 'import submitted');
      return reply.code(202).send({ importId, statusUrl: `${BASE_PATH}/${importId}` });
    },
  );

  typed.get(BASE_PATH, { schema: { response: { 200: importListResponseSchema } } }, () =>
    facade.listImports(),
  );

  // A static segment: Fastify routes it ahead of the `/:id` parameter route.
  typed.get(
    `${BASE_PATH}/reviews`,
    { schema: { response: { 200: reviewListResponseSchema } } },
    () => facade.listPendingReviews(),
  );

  typed.get(
    `${BASE_PATH}/:id`,
    {
      schema: {
        params: importIdParamsSchema,
        response: { 200: importStatusResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const result = facade.getImport({ id: request.params.id });
      if (!result.ok) {
        // The only reachable failure is NotFound: params are Fastify-validated non-empty.
        return reply.code(404).send({ error: 'NotFound' });
      }
      return result.value;
    },
  );

  typed.post(
    `${BASE_PATH}/:id/review`,
    {
      schema: {
        params: importIdParamsSchema,
        body: resolveReviewRequestSchema,
        response: {
          202: resolveReviewResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const result = await facade.resolveReview({ id, resolution: request.body });
      if (!result.ok) {
        // Params and body are Fastify-validated, so ValidationFailed (400) is unreachable here.
        const status = statusForFacadeError(result.error) as 404 | 409 | 500;
        return reply.code(status).send({ error: result.error.kind });
      }
      request.log.info({ importId: id, verb: request.body.verb }, 'review resolved');
      return reply.code(202).send({ importId: id });
    },
  );
}

/**
 * The startup-validated effective beets configuration (design D3), for operator inspection. Kept
 * off the OpenAPI document: it is a debug surface, not part of the versioned `/api/v1` contract.
 */
function registerDebugRoutes(app: FastifyInstance, options: HttpAppOptions): void {
  app.get('/debug/beets-config', { schema: { hide: true } }, (_request, reply) => {
    if (options.beetsConfig === undefined) {
      return reply.code(404).send({ error: 'NotAvailable' });
    }
    return reply.send(options.beetsConfig);
  });
}

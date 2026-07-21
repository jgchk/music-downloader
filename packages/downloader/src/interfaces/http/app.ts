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
import type { DownloaderFacade, DownloaderFacadeError } from '../../facade/index.js';
import {
  acquisitionIdParamsSchema,
  acquisitionListResponseSchema,
  acquisitionStatusResponseSchema,
  cancelAcquisitionResponseSchema,
  errorResponseSchema,
  progressResponseSchema,
  submitAcquisitionRequestSchema,
  submitAcquisitionResponseSchema,
} from '../contracts/index.js';
import { registerMcpEndpoint } from '../mcp/server.js';

/**
 * The versioned HTTP API (D12). A thin inbound adapter: it validates against the shared zod
 * contracts, maps DTOs to/from the domain via the anti-corruption layer, and delegates to the
 * application use-cases — it never touches domain types directly. Requests are accepted
 * asynchronously (`202`) with a status URL to observe. The same zod schemas drive request
 * validation, the OpenAPI document, and the MCP tool schemas. The MCP server is mounted on this
 * same app (streamable HTTP, `POST /mcp`) so one process serves both surfaces over one port.
 */

const BASE_PATH = '/api/v1/acquisitions';

/**
 * Map a facade failure to an HTTP status: infra faults are 5xx, an unknown resource is 404,
 * invalid input is 400, and the rest are conflicts with the stream's current state.
 */
export function statusForFacadeError(error: DownloaderFacadeError): 400 | 404 | 409 | 500 {
  switch (error.kind) {
    case 'InfraError':
      return 500;
    case 'NotFound':
      return 404;
    case 'ValidationFailed':
    case 'InvalidPolicy':
      return 400;
    default:
      return 409;
  }
}

export async function buildHttpApp(
  facade: DownloaderFacade,
  logger: Logger,
  version: string,
): Promise<FastifyInstance> {
  let requestSeq = 0;
  // Widen to Fastify's logger interface so the instance keeps the default logger generic; the pino
  // Logger type is stricter (adds `msgPrefix`) and would otherwise fight Fastify's internal typing.
  const baseLogger: FastifyBaseLogger = logger;
  const app = Fastify({
    loggerInstance: baseLogger,
    // Honor an inbound trace id at the edge; otherwise mint a per-request id. Fastify's per-request
    // child logger stamps this on every line, and the edge handlers add the acquisitionId (D15).
    genReqId: (req) => {
      const header = req.headers['x-request-id'];
      return typeof header === 'string' ? header : `req-${(requestSeq += 1)}`;
    },
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifySwagger, {
    openapi: {
      info: { title: 'Music Downloader API', version },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });

  registerAcquisitionRoutes(app, facade);
  registerMcpEndpoint(app, facade, logger, version);

  await app.ready();
  return app;
}

function registerAcquisitionRoutes(app: FastifyInstance, facade: DownloaderFacade): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    BASE_PATH,
    {
      schema: {
        body: submitAcquisitionRequestSchema,
        response: {
          202: submitAcquisitionResponseSchema,
          400: errorResponseSchema,
          409: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await facade.submitAcquisition(request.body);
      if (!result.ok) {
        // Submit can only fail with 400/409/500 kinds: the body was schema-validated by Fastify
        // and NotFound has no meaning here.
        const status = statusForFacadeError(result.error) as 400 | 409 | 500;
        return reply.code(status).send({ error: result.error.kind });
      }
      const { acquisitionId } = result.value;
      request.log.info({ acquisitionId }, 'acquisition submitted');
      return reply.code(202).send({ acquisitionId, statusUrl: `${BASE_PATH}/${acquisitionId}` });
    },
  );

  typed.get(BASE_PATH, { schema: { response: { 200: acquisitionListResponseSchema } } }, () =>
    facade.listAcquisitions(),
  );

  typed.get(
    `${BASE_PATH}/:id`,
    {
      schema: {
        params: acquisitionIdParamsSchema,
        response: { 200: acquisitionStatusResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const result = facade.getAcquisition({ id: request.params.id });
      if (!result.ok) {
        // The only reachable failure is NotFound: params are Fastify-validated non-empty.
        return reply.code(404).send({ error: 'NotFound' });
      }
      return result.value;
    },
  );

  typed.get(
    `${BASE_PATH}/:id/progress`,
    {
      schema: {
        params: acquisitionIdParamsSchema,
        response: { 200: progressResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const result = facade.getAcquisitionProgress({ id: request.params.id });
      if (!result.ok) {
        // The only reachable failure is NotFound: params are Fastify-validated non-empty.
        return reply.code(404).send({ error: 'NotFound' });
      }
      return result.value;
    },
  );

  typed.post(
    `${BASE_PATH}/:id/cancel`,
    {
      schema: {
        params: acquisitionIdParamsSchema,
        response: {
          202: cancelAcquisitionResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      if (!facade.getAcquisition({ id }).ok) {
        return reply.code(404).send({ error: 'NotFound' });
      }
      const result = await facade.cancelAcquisition({ id });
      if (!result.ok) {
        // Cancel pre-checks existence, and its input mirrors the Fastify-validated params.
        const status = statusForFacadeError(result.error) as 409 | 500;
        return reply.code(status).send({ error: result.error.kind });
      }
      request.log.info({ acquisitionId: id }, 'acquisition cancelled');
      return reply.code(202).send({ acquisitionId: id });
    },
  );
}

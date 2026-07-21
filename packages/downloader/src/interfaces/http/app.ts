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
import type { CommandError } from '../../application/acquisition/command-handler.js';
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
  acquisitionIdParamsSchema,
  acquisitionListResponseSchema,
  acquisitionStatusResponseSchema,
  cancelAcquisitionResponseSchema,
  errorResponseSchema,
  progressResponseSchema,
  requestToDomain,
  resolvePolicies,
  statusViewToDto,
  submitAcquisitionRequestSchema,
  submitAcquisitionResponseSchema,
} from '../contracts/index.js';
import { progressToDto } from '../contracts/mapping.js';
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

/** Map a use-case command failure to an HTTP status: infra faults are 5xx, the rest are conflicts. */
export function statusForCommandError(error: CommandError): 500 | 409 {
  return error.kind === 'InfraError' ? 500 : 409;
}

export async function buildHttpApp(
  deps: UseCaseDeps,
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

  registerAcquisitionRoutes(app, deps);
  registerMcpEndpoint(app, deps, logger, version);

  await app.ready();
  return app;
}

function registerAcquisitionRoutes(app: FastifyInstance, deps: UseCaseDeps): void {
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
      const policies = resolvePolicies(request.body);
      if (policies.isErr()) {
        return reply.code(400).send({ error: 'InvalidPolicy' });
      }
      const result = await submitAcquisition(deps, {
        request: requestToDomain(request.body.request),
        policies: policies.value,
      });
      return result.match(
        ({ acquisitionId }) => {
          request.log.info({ acquisitionId }, 'acquisition submitted');
          return reply
            .code(202)
            .send({ acquisitionId, statusUrl: `${BASE_PATH}/${acquisitionId}` });
        },
        (error) => reply.code(statusForCommandError(error)).send({ error: error.kind }),
      );
    },
  );

  typed.get(BASE_PATH, { schema: { response: { 200: acquisitionListResponseSchema } } }, () => ({
    acquisitions: listAcquisitions(deps).map(statusViewToDto),
  }));

  typed.get(
    `${BASE_PATH}/:id`,
    {
      schema: {
        params: acquisitionIdParamsSchema,
        response: { 200: acquisitionStatusResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const view = getAcquisition(deps, request.params.id);
      if (view === undefined) {
        return reply.code(404).send({ error: 'NotFound' });
      }
      return statusViewToDto(view);
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
      const progress = getAcquisitionProgress(deps, request.params.id);
      if (progress === undefined) {
        return reply.code(404).send({ error: 'NotFound' });
      }
      return progressToDto(progress);
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
      if (getAcquisition(deps, id) === undefined) {
        return reply.code(404).send({ error: 'NotFound' });
      }
      const result = await cancelAcquisition(deps, id);
      return result.match(
        () => {
          request.log.info({ acquisitionId: id }, 'acquisition cancelled');
          return reply.code(202).send({ acquisitionId: id });
        },
        (error) => reply.code(statusForCommandError(error)).send({ error: error.kind }),
      );
    },
  );
}

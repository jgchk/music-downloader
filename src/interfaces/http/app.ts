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
import { z } from 'zod';
import type { Logger } from '../../application/logging/logger.js';

/**
 * The versioned HTTP API: a thin inbound adapter validating against shared zod contracts. The same
 * schemas drive request validation and the OpenAPI document (served at /docs). This is the
 * bootstrap surface — the import lifecycle endpoints land with the founding OpenSpec change
 * (bootstrap-import-core); the list endpoint anchors the base path and the additive-only contract.
 */

const BASE_PATH = '/api/v1/imports';

const importListResponseSchema = z.object({
  imports: z.array(z.unknown()),
});

export async function buildHttpApp(logger: Logger, version: string): Promise<FastifyInstance> {
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

  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.get(BASE_PATH, { schema: { response: { 200: importListResponseSchema } } }, () => ({
    imports: [],
  }));

  await app.ready();
  return app;
}

import type { SlskdOperation } from './slskd-manifest.js';

/**
 * Checks an slskd OpenAPI document against the consumed-surface manifest (tasks 4.3 / 5.1). For
 * every operation the project depends on it verifies the path and method still exist, the path
 * parameters are still declared, and — where the spec schematizes a request body — the fields the
 * adapter sends are still present. Anything missing is reported as a violation naming the operation
 * and the specific problem, so a drift run can point at exactly what broke between the pinned
 * snapshot and a newer slskd release.
 */

export interface SpecViolation {
  readonly operation: string;
  readonly problem: string;
}

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null ? (value as Json) : undefined;
}

/** Resolve a local `#/components/schemas/Name` reference to its schema object. */
function resolveRef(spec: Json, ref: unknown): Json | undefined {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  let node: unknown = spec;
  for (const segment of ref.slice(2).split('/')) {
    node = asObject(node)?.[segment];
  }
  return asObject(node);
}

function pathParamNames(pathItem: Json, operation: Json): Set<string> {
  const params = [
    ...((pathItem.parameters as unknown[]) ?? []),
    ...((operation.parameters as unknown[]) ?? []),
  ];
  const names = new Set<string>();
  for (const raw of params) {
    const param = asObject(raw);
    if (param?.in === 'path' && typeof param.name === 'string') names.add(param.name);
  }
  return names;
}

/** The component schema of an operation's `application/json` request body (unwrapping an array). */
function requestBodySchema(spec: Json, operation: Json): Json | undefined {
  const schema = asObject(
    asObject(asObject(asObject(operation.requestBody)?.content)?.['application/json'])?.schema,
  );
  if (schema === undefined) return undefined;
  const inner = schema.type === 'array' ? asObject(schema.items) : schema;
  return resolveRef(spec, inner?.$ref) ?? inner;
}

export function checkSlskdSpec(spec: Json, operations: readonly SlskdOperation[]): SpecViolation[] {
  const violations: SpecViolation[] = [];
  const paths = asObject(spec.paths) ?? {};

  for (const op of operations) {
    const label = `${op.method.toUpperCase()} ${op.path}`;
    const pathItem = asObject(paths[op.path]);
    if (pathItem === undefined) {
      violations.push({ operation: label, problem: 'path not found in spec' });
      continue;
    }
    const operation = asObject(pathItem[op.method]);
    if (operation === undefined) {
      violations.push({ operation: label, problem: `method ${op.method} not found on path` });
      continue;
    }

    const declaredParams = pathParamNames(pathItem, operation);
    for (const param of op.pathParams) {
      if (!declaredParams.has(param)) {
        violations.push({ operation: label, problem: `path parameter {${param}} missing` });
      }
    }

    if (op.requestBody !== undefined) {
      const schema = requestBodySchema(spec, operation);
      const properties = asObject(schema?.properties);
      if (properties === undefined) {
        violations.push({ operation: label, problem: 'request body schema missing or unresolved' });
      } else {
        for (const field of op.requestBody.fields) {
          if (!(field in properties)) {
            violations.push({ operation: label, problem: `request field "${field}" missing` });
          }
        }
      }
    }
  }
  return violations;
}

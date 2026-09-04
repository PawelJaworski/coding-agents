// Reads the backend's published OpenAPI document and indexes it into the shape
// parse.js needs: one entry per command (POST) and per read model (GET), plus the
// nested object schemas referenced by either. This is the wire truth — property
// names, property types and URLs all come from here, never from markdown.

import fs from 'node:fs';
import naming from './naming.js';

export function loadOpenApi(openapiPath) {
  if (!fs.existsSync(openapiPath)) {
    throw new Error(
      `openapi.json not found at ${openapiPath}. It is a build artefact of the backend ` +
        `repo — rebuild the service before regenerating the frontend.`,
    );
  }
  return JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
}

// OpenAPI scalar -> TypeScript. `integer`/`number` must survive as `number`, or a
// numeric field silently becomes a string and arithmetic in a template breaks.
function scalarType(schema) {
  switch ((schema || {}).type) {
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'string';
  }
}

// A schema property is either a plain scalar, an array of scalars, a nested
// object ($ref, possibly array-of), matching the backend's Java-record split.
function resolveProperty(name, prop, schemas, objectTypes) {
  if (prop.$ref) {
    const refName = prop.$ref.split('/').pop();
    const object = objectType(refName, schemas, objectTypes);
    return { tsType: object.name, object };
  }
  if (prop.type === 'array') {
    if (prop.items && prop.items.$ref) {
      const refName = prop.items.$ref.split('/').pop();
      const object = objectType(refName, schemas, objectTypes);
      return { tsType: `${object.name}[]`, object };
    }
    return { tsType: `${scalarType(prop.items)}[]`, object: null };
  }
  return { tsType: scalarType(prop), object: null };
}

// Nested schemas (referenced by a $ref, never a path's own request/response
// schema) become the frontend's structured object interfaces — memoised so a
// schema referenced from several places emits exactly one interface.
function objectType(schemaName, schemas, objectTypes) {
  const existing = objectTypes.find((o) => o._schemaName === schemaName);
  if (existing) return existing;
  const schema = schemas[schemaName];
  if (!schema) throw new Error(`openapi.json references unknown schema "${schemaName}"`);
  const object = { _schemaName: schemaName, name: naming.pascal(schemaName), label: schemaName, fields: [] };
  objectTypes.push(object);
  const props = schema.properties || {};
  object.fields = Object.entries(props).map(([propName, prop]) => {
    const resolved = resolveProperty(propName, prop, schemas, objectTypes);
    return { label: propName, name: propName, tsType: resolved.tsType, object: resolved.object };
  });
  return object;
}

function fieldsOf(schemaRef, schemas, objectTypes) {
  if (!schemaRef) return [];
  const refName = schemaRef.$ref ? schemaRef.$ref.split('/').pop() : null;
  if (!refName) return [];
  const schema = schemas[refName];
  if (!schema) throw new Error(`openapi.json references unknown schema "${refName}"`);
  const props = schema.properties || {};
  return Object.entries(props).map(([propName, prop]) => {
    const resolved = resolveProperty(propName, prop, schemas, objectTypes);
    return { label: propName, name: propName, tsType: resolved.tsType, object: resolved.object };
  });
}

// Indexes every path in the document into a command (POST) or a view (GET),
// keyed by the id a `## <kebab-id>` model section would use — the last path
// segment for a collection endpoint, the one before `{aggregateId}` otherwise.
export function indexOpenApi(spec, modelSearchFields = null) {
  const schemas = (spec.components && spec.components.schemas) || {};
  const objectTypes = [];
  const commands = new Map();
  const views = new Map();

  // A GET carrying `in: query` parameters is a filtered read path over a read
  // model that is also served plainly (`GET /policy-list/search` alongside
  // `GET /policy-list`). It is NOT a read model of its own: it returns the same
  // view type, so it is indexed onto the owning view as `search` rather than
  // competing for the same id. Deferred to a second pass so the owning view is
  // already indexed whatever order the document lists paths in.
  const searchOps = [];

  for (const [endpoint, ops] of Object.entries(spec.paths || {})) {
    const segments = endpoint.split('/').filter(Boolean);
    const aggregateIdx = segments.indexOf('{aggregateId}');
    const collection = aggregateIdx === -1;
    const id = collection ? segments[segments.length - 1] : segments[aggregateIdx - 1];

    if (ops.post) {
      const body = ops.post.requestBody && ops.post.requestBody.content && ops.post.requestBody.content['application/json'];
      const fields = fieldsOf(body && body.schema, schemas, objectTypes);
      commands.set(id, { endpoint, fields });
    }
    if (ops.get) {
      const ok = ops.get.responses && ops.get.responses['200'];
      const content = ok && ok.content && ok.content['*/*'];
      let schemaRef = content && content.schema;
      // A collection response is `{ type: array, items: $ref }`; a single
      // aggregate response is the `$ref` itself.
      if (schemaRef && schemaRef.type === 'array') schemaRef = schemaRef.items;
      const fields = fieldsOf(schemaRef, schemas, objectTypes);
      const query = (ops.get.parameters || []).filter((p) => p.in === 'query');

      if (query.length) {
        // The owner is the read model this search filters. For a dedicated search
        // path like /policy-list/search, the owner is /policy-list (all segments
        // except the last). For a single-endpoint pattern like /policy-list with
        // query params, the owner is the endpoint itself (the last segment).
        const ownerId =
          segments.length > 1 ? segments.slice(0, -1).join('/') : segments[segments.length - 1];
        // A parameter with type: object and additionalProperties: string is a
        // @RequestParam Map<String, String> — Spring collects ALL query params into
        // a single Map. The actual wire format is individual query params like
        // ?policyHolder.name=John, not ?search=policyHolder.name:John.
        // The search keys come from the readmodel's ? fields (searchFields),
        // which are resolved later in parse.js when merging with the model.
        const expandedCriteria = [];
        for (const p of query) {
          const schema = p.schema || {};
          if (schema.type === 'object' && schema.additionalProperties &&
              (schema.additionalProperties.type === 'string' || !schema.additionalProperties.type)) {
            // This is a Map<String, String> — expand into individual criteria.
            // The actual key names will be resolved later from the model's searchFields.
            // For now, mark it as a map parameter so parse.js can expand it.
            expandedCriteria.push({
              name: p.name,
              required: p.required !== false,
              tsType: 'string',
              isMap: true,
            });
          } else {
            expandedCriteria.push({
              name: p.name,
              required: p.required !== false,
              tsType: schema.type === 'array' ? 'string[]' : 'string',
              isMap: false,
            });
          }
        }
        searchOps.push({
          endpoint,
          ownerId,
          fields,
          criteria: expandedCriteria,
        });
        continue;
      }

      if (views.has(id)) {
        throw new Error(
          `openapi.json serves two unfiltered GET operations that both map to read model "${id}" ` +
            `(${views.get(id).endpoint} and ${endpoint}). One id cannot have two canonical read paths.`,
        );
      }
      views.set(id, { endpoint, fields, collection, search: null });
    }
  }

  for (const op of searchOps) {
    // Expand map parameters: a @RequestParam Map<String, String> collects ALL
    // query params. The actual searchable keys come from the readmodel's ?
    // fields. If the model provides searchFields, expand the map param into
    // individual criteria named after those fields.
    let criteria = op.criteria;
    const mapParam = criteria.find((c) => c.isMap);
      if (mapParam) {
        // The ownerId is the path (e.g. "api/policy-list"), but modelSearchFields
        // is keyed by the read model id (e.g. "policy-list"). Extract the id
        // from the last segment of the ownerId.
        const rmId = op.ownerId.split('/').pop();
        const searchFields = modelSearchFields && modelSearchFields.get(rmId);
      if (searchFields && searchFields.length) {
        // Expand each searchable field into its own criterion. For embedded
        // value objects the backend uses dot notation: "policyHolder.name".
        criteria = searchFields.map((f) => ({
          name: f.searchKey || f.name,
          required: false,
          tsType: 'string',
          isMap: false,
        }));
      } else {
        // No search fields in the model — drop the opaque map param, keep any
        // explicit (non-map) criteria.
        criteria = criteria.filter((c) => !c.isMap);
      }
    }
    const owner = views.get(op.ownerId);
    if (!owner) {
      // No unfiltered GET exists — the backend serves only the filtered endpoint.
      // Treat it as BOTH the primary view AND the search path. This is the
      // pattern used when a read model's query parameters are optional or always
      // present on the same endpoint (e.g. ad-hoc search criteria added via a
      // @RequestParam on the existing controller method).
      views.set(op.ownerId, {
        endpoint: op.endpoint,
        fields: op.fields,
        collection: true, // search paths are always list endpoints
        search: { endpoint: op.endpoint, criteria },
      });
      continue;
    }
    if (owner.search) {
      throw new Error(`Read model "${op.ownerId}" has more than one search path in openapi.json.`);
    }
    owner.search = { endpoint: op.endpoint, criteria };
  }

  return { commands, views, objectTypes: objectTypes.map(({ _schemaName, ...rest }) => rest) };
}

// Reconciles the contract's fields (names + types, wire truth) with the
// model's fields (labels, bracketed hints). Every field must appear on both
// sides under the same name, or the two have drifted and neither can be
// trusted silently.
export function mergeFields(contractFields, modelFields, context) {
  const byName = new Map(modelFields.map((f) => [f.name, f]));
  const seen = new Set();
  const merged = contractFields.map((cf) => {
    const mf = byName.get(cf.name);
    seen.add(cf.name);
    return {
      name: cf.name,
      label: mf ? mf.label : cf.label,
      tsType: cf.tsType,
      object: cf.object,
      bracketed: mf ? mf.bracketed : false,
      convention: mf ? mf.convention : null,
    };
  });
  const missingFromContract = modelFields.filter((f) => !seen.has(f.name)).map((f) => f.name);
  const missingFromModel = contractFields.filter((f) => !byName.has(f.name)).map((f) => f.name);
  if (missingFromContract.length || missingFromModel.length) {
    const parts = [];
    if (missingFromContract.length) {
      parts.push(`in the event model but not in openapi.json: ${missingFromContract.join(', ')}`);
    }
    if (missingFromModel.length) {
      parts.push(`in openapi.json but not in the event model: ${missingFromModel.join(', ')}`);
    }
    throw new Error(`CONTRACT DRIFT for ${context}: ${parts.join('; ')}.`);
  }
  return merged;
}

const supportedSchemaKeywords = new Set([
  '$ref', 'additionalProperties', 'allOf', 'anyOf', 'const', 'else', 'enum', 'if',
  'items', 'maxItems', 'maximum', 'minItems', 'minLength', 'minProperties', 'minimum',
  'not', 'oneOf', 'pattern', 'properties', 'required', 'then', 'type', 'uniqueItems',
]);

const schemaAnnotationKeywords = new Set([
  '$comment', '$defs', '$id', '$schema', 'default', 'deprecated', 'description',
  'examples', 'readOnly', 'title', 'writeOnly', 'x-contract-version', 'x-kind',
  'x-owner',
]);

const schemaMapKeywords = new Set(['$defs', 'properties']);
const schemaArrayKeywords = new Set(['allOf', 'anyOf', 'oneOf']);
const schemaChildKeywords = new Set(['additionalProperties', 'else', 'if', 'items', 'not', 'then']);

function issue(code, at, message) {
  return { code, path: at, message };
}

function resolveRef(rootSchema, ref) {
  if (!ref.startsWith('#/')) throw new Error(`unsupported schema ref: ${ref}`);
  return ref
    .slice(2)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, part) => value?.[part], rootSchema);
}

function valueType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (Number.isInteger(value)) return 'integer';
  if (typeof value === 'number') return 'number';
  return typeof value;
}

export function validateSchemaKeywords(schema, at = '$', errors = []) {
  if (schema === true || schema === false) return errors;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    errors.push(issue('SCHEMA_INVALID_NODE', at, 'schema node must be an object or boolean'));
    return errors;
  }
  for (const key of Object.keys(schema)) {
    if (!supportedSchemaKeywords.has(key) && !schemaAnnotationKeywords.has(key)) {
      errors.push(issue('SCHEMA_UNSUPPORTED_KEYWORD', `${at}.${key}`, `unsupported schema keyword: ${key}`));
    }
  }
  for (const key of schemaMapKeywords) {
    const children = schema[key];
    if (!children || typeof children !== 'object' || Array.isArray(children)) continue;
    for (const [name, child] of Object.entries(children)) validateSchemaKeywords(child, `${at}.${key}.${name}`, errors);
  }
  for (const key of schemaArrayKeywords) {
    if (!Array.isArray(schema[key])) continue;
    schema[key].forEach((child, index) => validateSchemaKeywords(child, `${at}.${key}[${index}]`, errors));
  }
  for (const key of schemaChildKeywords) {
    const child = schema[key];
    if (child && typeof child === 'object' && !Array.isArray(child)) validateSchemaKeywords(child, `${at}.${key}`, errors);
  }
  return errors;
}

export function validateSchema(value, schema, rootSchema = schema, at = '$', errors = []) {
  if (schema === rootSchema && at === '$') {
    const keywordErrors = validateSchemaKeywords(rootSchema);
    if (keywordErrors.length > 0) return errors.concat(keywordErrors);
  }
  if (schema === false) {
    errors.push(issue('SCHEMA_FALSE', at, 'value is forbidden by schema'));
    return errors;
  }
  if (schema === true) return errors;
  if (schema.$ref) {
    const resolved = resolveRef(rootSchema, schema.$ref);
    if (!resolved) errors.push(issue('SCHEMA_REF', at, `cannot resolve ${schema.$ref}`));
    else validateSchema(value, resolved, rootSchema, at, errors);
    return errors;
  }
  for (const child of schema.allOf || []) validateSchema(value, child, rootSchema, at, errors);
  if (schema.anyOf) {
    const matches = schema.anyOf.filter((child) => validateSchema(value, child, rootSchema, at, []).length === 0);
    if (matches.length === 0) errors.push(issue('SCHEMA_ANY_OF', at, 'must match at least one schema'));
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((child) => validateSchema(value, child, rootSchema, at, []).length === 0);
    if (matches.length !== 1) errors.push(issue('SCHEMA_ONE_OF', at, `must match exactly one schema; matched ${matches.length}`));
  }
  if (schema.not && validateSchema(value, schema.not, rootSchema, at, []).length === 0) errors.push(issue('SCHEMA_NOT', at, 'must not match forbidden schema'));
  if (schema.if) {
    const conditionMatches = validateSchema(value, schema.if, rootSchema, at, []).length === 0;
    if (conditionMatches && schema.then) validateSchema(value, schema.then, rootSchema, at, errors);
    if (!conditionMatches && schema.else) validateSchema(value, schema.else, rootSchema, at, errors);
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) errors.push(issue('SCHEMA_CONST', at, `expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`));
  if (schema.enum && !schema.enum.includes(value)) errors.push(issue('SCHEMA_ENUM', at, `expected one of ${schema.enum.join(', ')}, got ${JSON.stringify(value)}`));
  if (schema.type) {
    const actual = valueType(value);
    const matches = schema.type === 'number' ? ['number', 'integer'].includes(actual) : actual === schema.type;
    if (!matches) {
      errors.push(issue('SCHEMA_TYPE', at, `expected ${schema.type}, got ${actual}`));
      return errors;
    }
  }
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(issue('SCHEMA_MIN_LENGTH', at, `minimum length is ${schema.minLength}`));
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(issue('SCHEMA_PATTERN', at, `does not match ${schema.pattern}`));
  }
  if (typeof value === 'number' && schema.minimum != null && value < schema.minimum) errors.push(issue('SCHEMA_MINIMUM', at, `minimum value is ${schema.minimum}`));
  if (typeof value === 'number' && schema.maximum != null && value > schema.maximum) errors.push(issue('SCHEMA_MAXIMUM', at, `maximum value is ${schema.maximum}`));
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(issue('SCHEMA_MIN_ITEMS', at, `minimum item count is ${schema.minItems}`));
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(issue('SCHEMA_MAX_ITEMS', at, `maximum item count is ${schema.maxItems}`));
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) errors.push(issue('SCHEMA_UNIQUE_ITEMS', at, 'array items must be unique'));
    if (schema.items) value.forEach((item, index) => validateSchema(item, schema.items, rootSchema, `${at}[${index}]`, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (schema.minProperties != null && keys.length < schema.minProperties) errors.push(issue('SCHEMA_MIN_PROPERTIES', at, `minimum property count is ${schema.minProperties}`));
    for (const required of schema.required || []) if (!Object.hasOwn(value, required)) errors.push(issue('SCHEMA_REQUIRED', `${at}.${required}`, 'missing required field'));
    const properties = schema.properties || {};
    for (const [key, child] of Object.entries(properties)) if (Object.hasOwn(value, key)) validateSchema(value[key], child, rootSchema, `${at}.${key}`, errors);
    for (const key of keys) {
      if (Object.hasOwn(properties, key)) continue;
      if (schema.additionalProperties === false) errors.push(issue('SCHEMA_UNKNOWN_FIELD', `${at}.${key}`, 'unknown field'));
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') validateSchema(value[key], schema.additionalProperties, rootSchema, `${at}.${key}`, errors);
    }
  }
  return errors;
}

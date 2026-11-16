type Validator = (value: unknown, path: string) => string | null;
type Schema = {
  type?: string; const?: unknown; enum?: unknown[]; anyOf?: unknown[];
  properties?: Record<string, unknown>; required?: string[]; additionalProperties?: unknown;
  items?: unknown; minLength?: number; maxLength?: number; pattern?: string;
  minItems?: number; maxItems?: number; minProperties?: number; maxProperties?: number;
  minimum?: number; maximum?: number;
};
const keywords = new Set(['type', 'const', 'enum', 'anyOf', 'properties', 'required', 'additionalProperties', 'items',
  'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'minProperties', 'maxProperties', 'minimum', 'maximum', 'description']);
const types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const at = (path: string, key: string | number) => `${path}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;

/** Compile the trusted AI contract subset to ordinary closures, without eval or Function. */
export function compileAiFieldValidator(input: unknown): Validator {
  if (typeof input === 'boolean') return (_value, path) => input ? null : path || '参数';
  if (!record(input) || Object.keys(input).some(key => !keywords.has(key))) throw new Error('AI 字段契约包含未支持的校验规则。');
  const schema = input as Schema;
  if (schema.type !== undefined && !types.has(schema.type)) throw new Error('AI 字段契约类型无效。');
  const alternatives = schema.anyOf?.map(compileAiFieldValidator);
  const properties = new Map(Object.entries(schema.properties ?? {}).map(([key, rule]) => [key, compileAiFieldValidator(rule)]));
  const additional = schema.additionalProperties === undefined ? null : compileAiFieldValidator(schema.additionalProperties);
  const items = schema.items === undefined ? null : compileAiFieldValidator(schema.items);
  const pattern = schema.pattern === undefined ? null : new RegExp(schema.pattern, 'u');
  return (value, path) => {
    const invalid = () => path || '参数';
    if (schema.type === 'object' && !record(value) || schema.type === 'array' && !Array.isArray(value)
      || schema.type === 'string' && typeof value !== 'string' || schema.type === 'boolean' && typeof value !== 'boolean'
      || schema.type === 'null' && value !== null || ['number', 'integer'].includes(schema.type ?? '') && (typeof value !== 'number' || !Number.isFinite(value))
      || schema.type === 'integer' && !Number.isInteger(value)) return invalid();
    if (Object.hasOwn(schema, 'const') && value !== schema.const || schema.enum && !schema.enum.includes(value)) return invalid();
    if (alternatives && !alternatives.some(validate => validate(value, path) === null)) return invalid();
    if (typeof value === 'string') {
      const length = [...value].length;
      if (schema.minLength !== undefined && length < schema.minLength || schema.maxLength !== undefined && length > schema.maxLength || pattern && !pattern.test(value)) return invalid();
    }
    if (typeof value === 'number' && (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)) return invalid();
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems) return invalid();
      if (items) for (let index = 0; index < value.length; index++) { const error = items(value[index], at(path, index)); if (error) return error; }
    }
    if (record(value)) {
      const keys = Object.keys(value);
      if (schema.minProperties !== undefined && keys.length < schema.minProperties || schema.maxProperties !== undefined && keys.length > schema.maxProperties) return invalid();
      for (const key of schema.required ?? []) if (!Object.hasOwn(value, key) || value[key] === undefined) return invalid();
      for (const key of keys) {
        const validate = properties.get(key);
        // Optional undefined fields follow the existing JSON-schema behavior.
        const error = validate ? value[key] === undefined ? null : validate(value[key], at(path, key)) : additional?.(value[key], at(path, key));
        if (error) return error;
      }
    }
    return null;
  };
}

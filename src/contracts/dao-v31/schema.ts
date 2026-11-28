/** JSON Schema 2020-12 builders shared by the wire types and published schemas. */
declare const valueType: unique symbol;

export type Schema<T = unknown> = Readonly<Record<string, unknown>> & {
  readonly [valueType]?: T;
};
export type Infer<S> = S extends Schema<infer T> ? T : never;
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export type JsonObject = { readonly [key: string]: JsonValue };

type Optional = { readonly optional: true; readonly schema: Schema };
type Fields = Record<string, Schema | Optional>;
type FieldValue<F> = F extends Optional ? Infer<F['schema']> : Infer<F>;
type ObjectValue<F extends Fields> = {
  readonly [K in keyof F as F[K] extends Optional ? never : K]: FieldValue<F[K]>;
} & {
  readonly [K in keyof F as F[K] extends Optional ? K : never]?: FieldValue<F[K]>;
};

export const optional = <T extends Schema>(schema: T) => ({ optional: true, schema }) as const;

function isOptional(field: Schema | Optional): field is Optional {
  return field.optional === true;
}

export function object<const F extends Fields>(fields: F): Schema<ObjectValue<F>> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(Object.entries(fields).map(([name, field]) => [
      name, isOptional(field) ? field.schema : field,
    ])),
    required: Object.keys(fields).filter((name) => !isOptional(fields[name])),
  };
}

export const string = (constraints: Record<string, unknown> = {}): Schema<string> => ({ type: 'string', ...constraints });
export const number = (minimum?: number, maximum?: number): Schema<number> => ({ type: 'number', minimum, maximum });
export const integer = (minimum: number, maximum = Number.MAX_SAFE_INTEGER): Schema<number> => ({ type: 'integer', minimum, maximum });
export const boolean: Schema<boolean> = { type: 'boolean' };
export const literal = <const T extends string | boolean | null>(value: T): Schema<T> => ({ const: value });
export const enumeration = <const T extends readonly string[]>(...values: T): Schema<T[number]> => ({ type: 'string', enum: values });
export const timestamp = string({ format: 'date-time' });
export const json: Schema<JsonValue> = {};
export const jsonObject: Schema<JsonObject> = { type: 'object' };

export function array<S extends Schema>(items: S, constraints: Record<string, unknown> = {}): Schema<readonly Infer<S>[]> {
  return { type: 'array', items, ...constraints };
}

export function dictionary<S extends Schema>(values: S): Schema<Readonly<Record<string, Infer<S>>>> {
  return { type: 'object', additionalProperties: values };
}

export function union<const S extends readonly Schema[]>(...variants: S): Schema<Infer<S[number]>> {
  return { anyOf: variants };
}

export function ref<T>(name: string, _schema: Schema<T>): Schema<T> {
  return { $ref: `#/$defs/${name}` };
}

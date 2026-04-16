import { Schema } from "effect";

export function decodeUnknown<A>(schema: Schema.Schema<A>, input: unknown): A {
  return Schema.decodeUnknownSync(schema as never)(input) as A;
}

export function encode<A>(schema: Schema.Schema<A>, value: A): A {
  return Schema.encodeSync(schema as never)(value as never) as A;
}

export function safeJsonParse(input: string): unknown {
  return JSON.parse(input) as unknown;
}

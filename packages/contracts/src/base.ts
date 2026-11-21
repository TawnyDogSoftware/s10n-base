import { Schema } from "effect";

export const Identifier = Schema.String;
export type Identifier = typeof Identifier.Type;

export const Timestamp = Schema.String;
export type Timestamp = typeof Timestamp.Type;

export const AppError = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
});
export type AppError = typeof AppError.Type;

import { Schema } from "effect";

export const BootstrapConfig = Schema.Struct({
  appName: Schema.String,
  appVersion: Schema.String,
  apiBaseUrl: Schema.String,
});
export type BootstrapConfig = typeof BootstrapConfig.Type;

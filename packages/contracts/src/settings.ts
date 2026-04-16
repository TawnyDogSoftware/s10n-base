import { Schema } from "effect";

import { Timestamp } from "./base";

export const ProjectSort = Schema.Literals(["updatedAt", "name"]);
export type ProjectSort = typeof ProjectSort.Type;

export const AppSettings = Schema.Struct({
  defaultProjectSort: ProjectSort,
  showActivityFeed: Schema.Boolean,
  compactSidebar: Schema.Boolean,
  updatedAt: Timestamp,
});
export type AppSettings = typeof AppSettings.Type;

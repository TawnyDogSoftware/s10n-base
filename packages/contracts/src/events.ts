import { Schema } from "effect";

import { Identifier, Timestamp } from "./base";

export const ActivityEntry = Schema.Struct({
  id: Identifier,
  projectId: Schema.NullOr(Identifier),
  action: Schema.String,
  message: Schema.String,
  createdAt: Timestamp,
});
export type ActivityEntry = typeof ActivityEntry.Type;

export const ActivitySnapshotMessage = Schema.Struct({
  type: Schema.Literal("activity.snapshot"),
  activities: Schema.Array(ActivityEntry),
});
export type ActivitySnapshotMessage = typeof ActivitySnapshotMessage.Type;

export const ActivityAppendedMessage = Schema.Struct({
  type: Schema.Literal("activity.appended"),
  activity: ActivityEntry,
});
export type ActivityAppendedMessage = typeof ActivityAppendedMessage.Type;

export const StreamMessage = Schema.Union([ActivitySnapshotMessage, ActivityAppendedMessage]);
export type StreamMessage = typeof StreamMessage.Type;

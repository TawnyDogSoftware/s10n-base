import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ProjectDetail, StreamMessage } from "./index";

describe("contracts", () => {
  it("decodes a project detail payload", () => {
    const decode = Schema.decodeUnknownSync(ProjectDetail);

    const result = decode({
      project: {
        id: "project_1",
        name: "S10N Base project",
        description: "Reusable app scaffold",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      notes: [],
    });

    expect(result.project.name).toBe("S10N Base project");
  });

  it("decodes websocket stream messages", () => {
    const decode = Schema.decodeUnknownSync(StreamMessage);

    const result = decode({
      type: "activity.appended",
      activity: {
        id: "activity_1",
        projectId: "project_1",
        action: "project.created",
        message: "Created project S10N Base project",
        createdAt: new Date().toISOString(),
      },
    });

    expect(result.type).toBe("activity.appended");
  });
});

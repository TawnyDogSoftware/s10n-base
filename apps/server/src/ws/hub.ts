import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { Schema } from "effect";
import { WebSocket, WebSocketServer } from "ws";

import { ActivitySnapshotMessage, type ActivityEntry, StreamMessage } from "@s10n-base/contracts";

export interface ActivityHub {
  readonly server: WebSocketServer;
  readonly handleUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => void;
  readonly broadcast: (activity: ActivityEntry) => void;
  readonly close: () => void;
}

export function createActivityHub(listActivities: () => ActivityEntry[]): ActivityHub {
  const server = new WebSocketServer({ noServer: true });
  const sockets = new Set<WebSocket>();
  const encode = Schema.encodeSync(StreamMessage);
  const encodeSnapshot = Schema.encodeSync(ActivitySnapshotMessage);

  server.on("connection", (socket) => {
    sockets.add(socket);
    const snapshot = encodeSnapshot({
      type: "activity.snapshot",
      activities: listActivities(),
    });
    socket.send(JSON.stringify(snapshot));
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  return {
    server,
    handleUpgrade: (request, socket, head) => {
      server.handleUpgrade(request, socket, head, (websocket) => {
        server.emit("connection", websocket, request);
      });
    },
    broadcast: (activity) => {
      const message = JSON.stringify(
        encode({
          type: "activity.appended",
          activity,
        }),
      );

      for (const socket of sockets) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(message);
        }
      }
    },
    close: () => {
      for (const socket of sockets) {
        socket.close();
      }
      server.close();
    },
  };
}

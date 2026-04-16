import { Schema } from "effect";

import {
  AppError,
  StreamMessage,
  type BootstrapConfig,
  type RpcContract,
} from "@s10n-base/contracts";

import { getJson, postJson } from "../lib/http";

interface RpcSuccessEnvelope<Data> {
  readonly ok: true;
  readonly data: Data;
}

interface RpcErrorEnvelope {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

type RpcEnvelope<Data> = RpcSuccessEnvelope<Data> | RpcErrorEnvelope;

export async function getBootstrapConfig() {
  return getJson<BootstrapConfig>("/config");
}

export async function callRpc<Payload, Success>(
  contract: RpcContract<Payload, Success>,
  payload: Payload,
): Promise<Success> {
  const response = await postJson<RpcEnvelope<unknown>>("/rpc", {
    method: contract.method,
    payload: Schema.encodeSync(contract.payload as never)(payload as never),
  });

  if (!response.ok) {
    const error = Schema.decodeUnknownSync(AppError)(response.error);
    throw new Error(`${error.code}: ${error.message}`);
  }

  return Schema.decodeUnknownSync(contract.success as never)(response.data) as Success;
}

export function connectActivityStream(
  websocketUrl: string,
  onMessage: (message: StreamMessage) => void,
): () => void {
  const socket = new WebSocket(websocketUrl);
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(String(event.data)) as unknown;
    onMessage(Schema.decodeUnknownSync(StreamMessage)(payload));
  });

  return () => {
    socket.close();
  };
}

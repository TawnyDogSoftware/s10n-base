/** A fake `fetch` for tests: records requests and answers from a handler. */
export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
  readonly credentials: RequestCredentials | undefined;
  readonly signal: AbortSignal | undefined;
}

export type FakeHandler = (request: RecordedRequest) => Response | Promise<Response>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

export function fakeFetch(handler: FakeHandler) {
  const requests: RecordedRequest[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    const text = typeof init?.body === "string" ? init.body : undefined;
    const request: RecordedRequest = {
      url,
      method: init?.method ?? "GET",
      body: text === undefined ? undefined : (JSON.parse(text) as unknown),
      credentials: init?.credentials,
      signal: init?.signal ?? undefined,
    };
    requests.push(request);
    return handler(request);
  };
  return { fetch: fetch, requests };
}

/** A promise with its resolve and reject exposed. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Minimal SSE reader for fetch() response bodies. */

export interface SSEMessage {
  event: string;
  data: unknown;
}

/**
 * Reads an SSE stream to completion, invoking onMessage per event.
 * Handles CRLF/LF, multi-line data fields, and events split across chunks.
 * Malformed JSON payloads are skipped rather than aborting the stream.
 */
export async function readSSE(body: ReadableStream<Uint8Array>, onMessage: (m: SSEMessage) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (block: string) => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (!dataLines.length) return;
    try {
      onMessage({ event, data: JSON.parse(dataLines.join("\n")) });
    } catch {
      /* ignore keep-alives and malformed payloads */
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      blocks.forEach(dispatch);
    }
    buffer += decoder.decode();
    if (buffer.trim()) dispatch(buffer);
  } finally {
    reader.releaseLock();
  }
}

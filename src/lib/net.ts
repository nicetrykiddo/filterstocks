/**
 * Shared HTTP for the data pipeline.
 *
 * Both exchanges sit behind CDNs that fingerprint TLS clients, so all network
 * access goes through curl child processes with a browser user agent. NSE's
 * archive occasionally stalls an HTTP/2 stream mid-transfer; a fresh process
 * on the next attempt clears it, so callers get automatic retries.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function curlOnce(
  url: string,
  extra: string[],
  timeoutMs: number,
): Promise<Buffer | null> {
  try {
    const { stdout } = await execFileP(
      "curl",
      [
        "-s",
        "--fail",
        "--max-time",
        String(Math.round(timeoutMs / 1000)),
        "--compressed",
        "-A",
        UA,
        ...extra,
        url,
      ],
      { maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs + 5000, encoding: "buffer" },
    );
    return stdout;
  } catch {
    return null;
  }
}

/** Fetch a URL as binary with retries. Returns null after the final failure. */
export async function curlBin(url: string, attempts = 3): Promise<Buffer | null> {
  for (let i = 0; i < attempts; i++) {
    const buf = await curlOnce(url, ["--http1.1"], 40_000);
    if (buf && buf.length > 0) return buf;
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  return null;
}

export async function curlText(url: string, attempts = 3): Promise<string | null> {
  const buf = await curlBin(url, attempts);
  return buf ? buf.toString("utf8") : null;
}

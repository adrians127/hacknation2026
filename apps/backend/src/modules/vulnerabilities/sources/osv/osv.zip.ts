import { openPromise, type Entry, type ZipFile } from "yauzl";

function nextEntry(zip: ZipFile): Promise<Entry | null> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      zip.off("entry", onEntry);
      zip.off("end", onEnd);
      zip.off("error", onError);
    };
    const onEntry = (entry: Entry) => {
      cleanup();
      resolve(entry);
    };
    const onEnd = () => {
      cleanup();
      resolve(null);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    zip.on("entry", onEntry);
    zip.on("end", onEnd);
    zip.on("error", onError);
    zip.readEntry();
  });
}

/** The text of every `.json` entry of a zip whose name `keep` accepts, one at a time. */
export async function* readZipJson(
  path: string,
  keep: (fileName: string) => boolean,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const zip = await openPromise(path, { lazyEntries: true, autoClose: false });
  try {
    for (let entry = await nextEntry(zip); entry; entry = await nextEntry(zip)) {
      signal.throwIfAborted();
      const name = entry.fileName.split("/").at(-1) ?? "";
      if (!name.endsWith(".json") || !keep(name)) continue;
      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = await stream.toArray();
      yield Buffer.concat(chunks).toString("utf8");
    }
  } finally {
    zip.close();
  }
}

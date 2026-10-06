// Test support: builds a single-entry zip archive in memory with web APIs, so
// unit tests (Node) and the D1/R2 proof (workerd) can exercise the feed
// stage without network access. Not used by production code.

export type ZipFixtureOptions = {
  entry: string;
  // Deflate (default) or store the content.
  method?: 'deflate' | 'stored';
  // Leave sizes out of the local header and append a data descriptor.
  dataDescriptor?: boolean;
  // Mark sizes as 0xFFFFFFFF and carry them in a zip64 extra field.
  zip64?: boolean;
};

async function deflateRaw(content: Uint8Array) {
  const stream = new Blob([content as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function concat(parts: Uint8Array[]) {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

// CRC values are not checked by the stage, so the fixture writes zero.
export async function buildZipFixture(
  text: string,
  {
    entry,
    method = 'deflate',
    dataDescriptor = false,
    zip64 = false,
  }: ZipFixtureOptions,
) {
  const content = new TextEncoder().encode(text);
  const data = method === 'deflate' ? await deflateRaw(content) : content;
  const name = new TextEncoder().encode(entry);
  const methodCode = method === 'deflate' ? 8 : 0;

  const extra = new Uint8Array(zip64 ? 20 : 0);
  if (zip64) {
    const view = new DataView(extra.buffer);
    view.setUint16(0, 0x0001, true);
    view.setUint16(2, 16, true);
    view.setBigUint64(4, BigInt(content.byteLength), true);
    view.setBigUint64(12, BigInt(data.byteLength), true);
  }

  const local = new Uint8Array(30 + name.byteLength + extra.byteLength);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint16(6, dataDescriptor ? 0x0008 : 0, true);
  localView.setUint16(8, methodCode, true);
  if (!dataDescriptor) {
    localView.setUint32(18, zip64 ? 0xffffffff : data.byteLength, true);
    localView.setUint32(22, zip64 ? 0xffffffff : content.byteLength, true);
  }
  localView.setUint16(26, name.byteLength, true);
  localView.setUint16(28, extra.byteLength, true);
  local.set(name, 30);
  local.set(extra, 30 + name.byteLength);

  const descriptor = new Uint8Array(dataDescriptor ? 16 : 0);
  if (dataDescriptor) {
    const view = new DataView(descriptor.buffer);
    view.setUint32(0, 0x08074b50, true);
    view.setUint32(8, data.byteLength, true);
    view.setUint32(12, content.byteLength, true);
  }

  const central = new Uint8Array(46 + name.byteLength);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 20, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint16(8, dataDescriptor ? 0x0008 : 0, true);
  centralView.setUint16(10, methodCode, true);
  centralView.setUint32(20, data.byteLength, true);
  centralView.setUint32(24, content.byteLength, true);
  centralView.setUint16(28, name.byteLength, true);
  centralView.setUint32(42, 0, true);
  central.set(name, 46);

  const centralOffset =
    local.byteLength + data.byteLength + descriptor.byteLength;
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, central.byteLength, true);
  endView.setUint32(16, centralOffset, true);

  return concat([local, data, descriptor, central, end]);
}

// Delivers bytes as a stream in chunks of `chunkSize`.
export function chunkedStream(bytes: Uint8Array, chunkSize: number) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

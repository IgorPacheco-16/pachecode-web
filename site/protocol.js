// Implementacao JavaScript do protocolo real definido em src/pachecode/protocol.py.
export const MAGIC = "PACHECODE";
export const PROTOCOL_VERSION = 1;

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const TRANSFER_PATTERN = /^[0-9a-f]{32}$/;
const REQUIRED_FIELDS = [
  "compressed_sha256", "compressed_size", "data_b64", "file_sha256",
  "filename_b64", "magic", "original_size", "part", "part_sha256",
  "total_parts", "transfer_id", "version",
];

export class ProtocolError extends Error {}
export class IntegrityError extends ProtocolError {}
export class MissingBlocksError extends ProtocolError {
  constructor(parts) {
    super(`Blocos ausentes: ${parts.join(", ")}`);
    this.parts = parts;
  }
}

function decodeBase64(value, field) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new ProtocolError(`Campo ${field} não é Base64 válido.`);
  }
  let binary;
  try { binary = atob(value); } catch (error) {
    throw new ProtocolError(`Campo ${field} não é Base64 válido.`, { cause: error });
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeFilename(value) {
  const bytes = decodeBase64(value, "filename_b64");
  let filename;
  try { filename = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (error) {
    throw new ProtocolError("O nome do arquivo não é UTF-8 válido.", { cause: error });
  }
  if (!filename || filename === "." || filename === ".." || filename.includes("/") || filename.includes("\\")) {
    throw new ProtocolError("Nome de arquivo inseguro no QR Code.");
  }
  return filename;
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function parseBlockPayload(payload) {
  let document;
  try { document = JSON.parse(payload); } catch (error) {
    throw new ProtocolError("O QR Code não contém JSON Pachecode válido.", { cause: error });
  }
  if (!document || Array.isArray(document) || typeof document !== "object") {
    throw new ProtocolError("O payload deve ser um objeto JSON.");
  }
  const missing = REQUIRED_FIELDS.filter((field) => !(field in document));
  if (missing.length) throw new ProtocolError(`Campos obrigatórios ausentes: ${missing.join(", ")}`);
  if (document.magic !== MAGIC || document.version !== PROTOCOL_VERSION) {
    throw new ProtocolError("QR Code não pertence ao protocolo Pachecode v1.");
  }

  for (const field of ["part", "total_parts", "original_size", "compressed_size"]) {
    if (!Number.isSafeInteger(document[field])) throw new ProtocolError("Posições e tamanhos devem ser inteiros seguros.");
  }
  if (document.total_parts < 1 || document.part < 1 || document.part > document.total_parts) {
    throw new ProtocolError("Posição de bloco fora do intervalo válido.");
  }
  if (document.original_size < 0 || document.compressed_size < 0) {
    throw new ProtocolError("Tamanhos negativos não são permitidos.");
  }
  if (typeof document.transfer_id !== "string" || !TRANSFER_PATTERN.test(document.transfer_id)) {
    throw new ProtocolError("ID de transferência inválido.");
  }
  for (const field of ["file_sha256", "compressed_sha256", "part_sha256"]) {
    if (typeof document[field] !== "string" || !HASH_PATTERN.test(document[field])) {
      throw new ProtocolError(`Campo ${field} não é um SHA-256 válido.`);
    }
  }

  const data = decodeBase64(document.data_b64, "data_b64");
  if (await sha256Hex(data) !== document.part_sha256) {
    throw new IntegrityError(`Checksum inválido no bloco ${document.part}.`);
  }
  return {
    transferId: document.transfer_id,
    filename: decodeFilename(document.filename_b64),
    totalParts: document.total_parts,
    originalSize: document.original_size,
    compressedSize: document.compressed_size,
    fileSha256: document.file_sha256,
    compressedSha256: document.compressed_sha256,
    partSha256: document.part_sha256,
    part: document.part,
    data,
  };
}

function metadataKey(block) {
  return JSON.stringify([
    block.transferId, block.filename, block.totalParts, block.originalSize,
    block.compressedSize, block.fileSha256, block.compressedSha256,
  ]);
}

function bytesEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export class TransferSession {
  constructor(firstBlock) {
    this.metadata = firstBlock;
    this.metadataKey = metadataKey(firstBlock);
    this.blocks = new Map();
    this.duplicates = 0;
  }

  add(block) {
    if (metadataKey(block) !== this.metadataKey) {
      throw new ProtocolError("Metadados divergentes para a mesma transferência.");
    }
    const previous = this.blocks.get(block.part);
    if (previous) {
      if (!bytesEqual(previous.data, block.data)) throw new IntegrityError(`Duas versões do bloco ${block.part}.`);
      this.duplicates += 1;
      return "duplicate";
    }
    this.blocks.set(block.part, block);
    return "added";
  }

  get received() { return this.blocks.size; }
  get remaining() { return this.metadata.totalParts - this.received; }
  get complete() { return this.remaining === 0; }
  get percent() { return Math.round((this.received / this.metadata.totalParts) * 100); }

  missingParts() {
    const missing = [];
    for (let part = 1; part <= this.metadata.totalParts; part += 1) {
      if (!this.blocks.has(part)) missing.push(part);
    }
    return missing;
  }

  async assemble(inflate) {
    const missing = this.missingParts();
    if (missing.length) throw new MissingBlocksError(missing);
    const compressed = new Uint8Array(this.metadata.compressedSize);
    let offset = 0;
    for (let part = 1; part <= this.metadata.totalParts; part += 1) {
      const data = this.blocks.get(part).data;
      compressed.set(data, offset);
      offset += data.length;
    }
    if (offset !== this.metadata.compressedSize) throw new IntegrityError("Tamanho comprimido divergente.");
    if (await sha256Hex(compressed) !== this.metadata.compressedSha256) {
      throw new IntegrityError("SHA-256 dos dados comprimidos divergente.");
    }
    let original;
    try { original = new Uint8Array(inflate(compressed)); } catch (error) {
      throw new IntegrityError("Fluxo zlib inválido.", { cause: error });
    }
    if (original.length !== this.metadata.originalSize) throw new IntegrityError("Tamanho final divergente.");
    const sha256 = await sha256Hex(original);
    if (sha256 !== this.metadata.fileSha256) throw new IntegrityError("SHA-256 final divergente.");
    return { data: original, filename: this.metadata.filename, sha256 };
  }
}

export class CaptureRegistry {
  constructor() { this.sessions = new Map(); }

  async ingest(payload) {
    const block = await parseBlockPayload(payload);
    let session = this.sessions.get(block.transferId);
    if (!session) {
      session = new TransferSession(block);
      this.sessions.set(block.transferId, session);
    }
    const status = session.add(block);
    return { block, session, status };
  }

  clear() { this.sessions.clear(); }
}

export type TruncatedOutput = {
  text: string;
  truncated: boolean;
  omittedBytes: number;
};

export class BoundedOutputBuffer {
  private readonly headLimit: number;
  private readonly tailLimit: number;
  private full = "";
  private head = "";
  private tail = "";
  private totalBytes = 0;
  private overflowing = false;

  constructor(private readonly maxBytes = 50 * 1024) {
    this.headLimit = Math.floor(maxBytes * 0.7);
    this.tailLimit = maxBytes - this.headLimit;
  }

  append(value: string | Uint8Array): void {
    const text = typeof value === "string" ? value : new TextDecoder().decode(value);
    const bytes = Buffer.byteLength(text);
    this.totalBytes += bytes;

    if (!this.overflowing) {
      const combined = this.full + text;
      if (Buffer.byteLength(combined) <= this.maxBytes) {
        this.full = combined;
        return;
      }
      this.overflowing = true;
      this.head = sliceUtf8(combined, this.headLimit);
      this.tail = sliceUtf8(combined, this.tailLimit, true);
      this.full = "";
      return;
    }

    this.tail = sliceUtf8(this.tail + text, this.tailLimit, true);
  }

  value(): TruncatedOutput {
    if (!this.overflowing) {
      return { text: this.full, truncated: false, omittedBytes: 0 };
    }
    const kept = Buffer.byteLength(this.head) + Buffer.byteLength(this.tail);
    const omittedBytes = Math.max(0, this.totalBytes - kept);
    return {
      text: `${this.head}\n\n... ${omittedBytes} bytes omitted ...\n\n${this.tail}`,
      truncated: true,
      omittedBytes,
    };
  }
}

function sliceUtf8(value: string, maxBytes: number, fromEnd = false): string {
  const bytes = Buffer.from(value);
  if (bytes.length <= maxBytes) return value;
  const slice = fromEnd ? bytes.subarray(bytes.length - maxBytes) : bytes.subarray(0, maxBytes);
  return new TextDecoder("utf-8", { fatal: false }).decode(slice);
}

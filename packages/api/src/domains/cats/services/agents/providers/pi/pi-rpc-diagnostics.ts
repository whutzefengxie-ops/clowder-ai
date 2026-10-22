import { StringDecoder } from 'node:string_decoder';
import { sanitizeCliStderr } from '../../../../../../utils/sanitize-cli-stderr.js';

/** Never retain truncated secret fragments: sanitize whole lines, or discard oversized lines entirely. */
export class PiRpcDiagnostics {
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';
  private dropping = false;
  private tail = '';
  write(chunk: Buffer): void {
    const text = this.decoder.write(chunk);
    for (const part of text.split(/(?<=\n)/)) {
      if (!this.dropping) {
        if (this.pending.length + part.length > 16384) {
          this.pending = '';
          this.dropping = true;
        } else this.pending += part;
      }
      if (part.endsWith('\n')) {
        if (!this.dropping) this.commit();
        this.dropping = false;
      }
    }
  }
  end(): void {
    this.pending += this.decoder.end();
    if (!this.dropping) this.commit();
    this.pending = '';
  }
  private commit(): void {
    this.tail = (this.tail + sanitizeCliStderr(this.pending)).slice(-1000);
    this.pending = '';
  }
  context(): string {
    return this.tail.trim() ? `: ${this.tail.trim()}` : '';
  }
}

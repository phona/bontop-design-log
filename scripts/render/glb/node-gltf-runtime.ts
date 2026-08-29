/** Install the FileReader bridge required by GLTFExporter in Node/Bun runtimes. */
export function installNodeFileReader(): void {
  if ('FileReader' in globalThis) return;
  class NodeFileReader {
    result: ArrayBuffer | string | null = null;
    onloadend: (() => void) | null = null;

    readAsArrayBuffer(blob: Blob): void {
      void blob.arrayBuffer().then((value) => {
        this.result = value;
        this.onloadend?.();
      });
    }

    readAsDataURL(blob: Blob): void {
      void blob.arrayBuffer().then((value) => {
        const bytes = new Uint8Array(value);
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(binary, 'binary').toString('base64')}`;
        this.onloadend?.();
      });
    }
  }
  (globalThis as unknown as { FileReader: typeof NodeFileReader }).FileReader = NodeFileReader;
}

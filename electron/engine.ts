export {};
const { spawn } = require('child_process');
const fs = require('fs');

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timeout: NodeJS.Timeout;
}

/** A JSON-RPC notification (no id) emitted by the engine, e.g. progress. */
export interface EngineNotification {
  method: string;
  params: Record<string, any>;
}

/**
 * EngineClient drives the OSFED Go engine over newline-delimited JSON-RPC on
 * stdin/stdout. It is protocol-compatible with the engine's main.go: requests
 * are {id, method, params}, responses are {id, result} / {id, error:{message}},
 * and notifications are {method, params} with no id.
 */
export class EngineClient {
  private process: any = null;
  private enginePath: string;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private buffer = '';
  private readonly TIMEOUT_MS = 600000; // 10 min — extraction/restore can be slow
  private logPath: string;

  public notificationHandler: ((n: EngineNotification) => void) | null = null;

  constructor(enginePath: string, logPath: string) {
    this.enginePath = enginePath;
    this.logPath = logPath;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn(this.enginePath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      this.process.stdout.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.process.stderr.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) {
          console.error(`[engine] ${msg}`);
          try { fs.appendFileSync(this.logPath, `[STDERR] ${msg}\n`); } catch {}
        }
      });

      this.process.on('error', (err: Error) => {
        console.error('Failed to start engine:', err);
        reject(err);
      });

      this.process.on('exit', (code: number) => {
        console.log(`engine exited with code ${code}`);
        for (const [, req] of this.pending) {
          clearTimeout(req.timeout);
          req.reject(new Error(`Engine exited with code ${code}`));
        }
        this.pending.clear();
        this.process = null;
      });

      setTimeout(() => {
        if (this.process && !this.process.killed) resolve();
        else reject(new Error('Engine failed to start'));
      }, 300);
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const message = JSON.parse(trimmed);
        if (message.method !== undefined && message.id === undefined) {
          this.notificationHandler?.({ method: message.method, params: message.params });
          continue;
        }
        const pending = this.pending.get(message.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(message.error.message || 'Unknown engine error'));
          else pending.resolve(message.result);
        }
      } catch {
        console.error('Failed to parse engine frame:', trimmed);
      }
    }
  }

  async call(method: string, params: any = {}, timeoutMs?: number): Promise<any> {
    if (!this.process || this.process.killed) throw new Error('Engine is not running');
    const id = ++this.requestId;
    const request = JSON.stringify({ id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Engine call timed out: ${method}`));
      }, timeoutMs ?? this.TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });
      this.process.stdin.write(request);
    });
  }

  stop(): void {
    if (this.process && !this.process.killed) {
      try { this.process.stdin.end(); } catch {}
      this.process.kill();
      this.process = null;
    }
  }
}

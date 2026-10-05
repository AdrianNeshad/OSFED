/** Thin client for the OSFED engine JSON-RPC exposed on window.osfed. */

const hasBridge = typeof window !== 'undefined' && !!window.osfed;

export async function engineCall<T = any>(method: string, params: any = {}): Promise<T> {
  if (!hasBridge) {
    throw new Error('OSFED bridge unavailable — run inside the desktop app (npm run dev).');
  }
  const res = await window.osfed.call(method, params);
  if (!res.success) throw new Error(res.error || 'Unknown engine error');
  return res.data as T;
}

export function isElectron(): boolean {
  return hasBridge;
}

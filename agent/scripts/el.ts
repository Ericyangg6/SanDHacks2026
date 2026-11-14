// Tiny ElevenLabs REST helper shared by the scripts.
const BASE = 'https://api.elevenlabs.io';

export function env(name: string, required = true): string {
  const v = process.env[name];
  if (!v && required) {
    console.error(`Missing ${name} in the root .env`);
    process.exit(1);
  }
  return v ?? '';
}

export async function el<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'xi-api-key': env('ELEVENLABS_API_KEY'), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const FALLBACK_SECRET = 'a'.repeat(64);

let sharedSecret: string;

describe('SSE endpoint', () => {
	beforeEach(() => {
		if (typeof env.SHARED_SECRET !== 'string' || env.SHARED_SECRET.length !== 64) {
			env.SHARED_SECRET = FALLBACK_SECRET;
		}
		sharedSecret = env.SHARED_SECRET;
		if (typeof env.GOOGLE_API_KEY !== 'string' || env.GOOGLE_API_KEY.length === 0) {
			env.GOOGLE_API_KEY = 'test-key';
		}
	});

	it('rejects requests without valid secret', async () => {
		const response = await SELF.fetch('https://example.com/sse');
		expect(response.status).toBe(401);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(await response.text()).toBe('Unauthorized');
	});

	it('responds to CORS preflight', async () => {
		const response = await SELF.fetch('https://example.com/sse', {
			method: 'OPTIONS',
			headers: {
				Origin: 'https://client.example',
			},
		});
		expect(response.status).toBe(204);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://client.example');
		expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
		expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
		expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Accept');
	});

	it('streams events when authorized', async () => {
	const request = new Request('https://example.com/sse', {
		headers: { Authorization: `Bearer ${sharedSecret}` },
	});
	const response = await SELF.fetch(request);

		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toBe('text/event-stream');

	const reader = response.body?.getReader();
	expect(reader).toBeDefined();
	const decoder = new TextDecoder();
	let combined = '';
	for (let i = 0; i < 3; i++) {
		const { value, done } = await reader!.read();
		if (done) break;
		combined += decoder.decode(value);
		if (combined.includes('data: "ok"')) {
			break;
		}
	}
	expect(combined).toContain('event: ready');
	expect(combined).toContain('data: "ok"');

	await reader!.cancel();
	});

	it('handles rpc preflight with CORS headers', async () => {
		const response = await SELF.fetch('https://example.com/rpc', {
			method: 'OPTIONS',
			headers: {
				Origin: 'https://client.example',
				'Access-Control-Request-Method': 'POST',
				'Access-Control-Request-Headers': 'authorization, content-type',
			},
		});
		expect(response.status).toBe(204);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://client.example');
		expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
		expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
	});

	it('returns CORS headers for unauthorized rpc call', async () => {
		const response = await SELF.fetch('https://example.com/rpc', {
			method: 'POST',
			headers: {
				Origin: 'https://client.example',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ method: 'analyzeRemoteVideo', args: [] }),
		});
		expect(response.status).toBe(401);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://client.example');
		expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
	});
});

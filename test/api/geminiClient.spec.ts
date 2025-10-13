import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FileState } from '@google/genai';
import { describe, expect, it } from 'vitest';

import { GeminiVideoClient } from '../../src/geminiClient';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_VIDEO_PATH = path.join(__dirname, 'test.mp4');
const REMOTE_VIDEO_URL = (() => {
	try {
		return readFileSync(path.join(__dirname, 'gemini_remote_video_url.txt'), 'utf8').trim();
	} catch {
		return 'https://example.com/sample.webm';
	}
})();
const YOUTUBE_VIDEO_URL = /youtube|youtu\.be/.test(REMOTE_VIDEO_URL)
	? REMOTE_VIDEO_URL
	: 'https://www.youtube.com/watch?v=abcd';

type MockAi = ReturnType<typeof createMockAi>;

function createMockAi({
	states,
	generateResponse = { text: 'ok' },
	fileName = 'files/mock',
	uploadMimeType = 'video/mp4',
	uploadUri = null,
	onGenerate,
}: {
	states: Array<{
		state: FileState;
		mimeType?: string;
		uri?: string | null;
		error?: { message?: string };
	}>;
	generateResponse?: unknown;
	fileName?: string;
	uploadMimeType?: string;
	uploadUri?: string | null;
	onGenerate?: (request: any, callCount: number) => Promise<unknown>;
}) {
	const uploadCalls: any[] = [];
	const getCalls: string[] = [];
	const deleteCalls: string[] = [];
	const generateRequests: any[] = [];

	let pollIndex = 0;

	const files = {
		upload: async (params: any) => {
			uploadCalls.push(params);
			return {
				name: fileName,
				mimeType: uploadMimeType,
				uri: uploadUri,
			};
		},
		get: async ({ name }: { name: string }) => {
			getCalls.push(name);
			const stateConfig =
				pollIndex < states.length
					? states[pollIndex++]
					: states[states.length - 1];

			return {
				name,
				mimeType: stateConfig.mimeType ?? uploadMimeType,
				uri: stateConfig.uri ?? uploadUri,
				state: stateConfig.state,
				error: stateConfig.error,
			};
		},
		delete: async ({ name }: { name: string }) => {
			deleteCalls.push(name);
		},
	};

	const models = {
		generateContent: async (request: any) => {
			generateRequests.push(request);
			if (onGenerate) {
				return await onGenerate(request, generateRequests.length);
			}
			if (generateResponse instanceof Error) {
				throw generateResponse;
			}
			return generateResponse;
		},
	};

	return {
		files,
		models,
		uploadCalls,
		getCalls,
		deleteCalls,
		generateRequests,
	};
}

function createClient(mockAi: MockAi, overrides: Partial<ConstructorParameters<typeof GeminiVideoClient>[1]> = {}) {
	return new GeminiVideoClient(
		{
			apiKey: 'dummy',
			model: 'gemini-test',
			maxInlineFileBytes: 10,
		},
		{
			aiClient: mockAi as unknown as any,
			fileActivationPollIntervalMs: 0,
			fileActivationTimeoutMs: 50,
			sleepFn: async () => {},
			...overrides,
		},
	);
}

describe('GeminiVideoClient', () => {
	it('waits for uploaded file to become ACTIVE before generating', async () => {
		const mockAi = createMockAi({
			states: [
				{ state: FileState.PROCESSING },
				{ state: FileState.ACTIVE, uri: 'https://example.com/file.mp4' },
			],
			generateResponse: { text: 'summarized' },
		});

		const client = createClient(mockAi);

		const result = await client.analyzeLocalVideo({
			filePath: TEST_VIDEO_PATH,
			prompt: '概要をください',
		});

		expect(result).toBe('summarized');
		expect(mockAi.getCalls.length).toBe(2);
		expect(mockAi.generateRequests.length).toBe(1);
		expect(mockAi.deleteCalls).toEqual(['files/mock']);
		expect(mockAi.uploadCalls[0]).toMatchObject({
			file: TEST_VIDEO_PATH,
		});
	});

	it('throws when uploaded file enters FAILED state', async () => {
		const mockAi = createMockAi({
			states: [
				{ state: FileState.PROCESSING },
				{ state: FileState.FAILED, error: { message: 'processing failed' } },
			],
		});

		const client = createClient(mockAi);

		await expect(
			client.analyzeLocalVideo({
				filePath: TEST_VIDEO_PATH,
				prompt: '概要をください',
			}),
		).rejects.toThrow(/failed to process: processing failed/);

		expect(mockAi.generateRequests.length).toBe(0);
		expect(mockAi.deleteCalls).toEqual(['files/mock']);
	});

	it('includes MIME type derived from URL when analyzing remote video', async () => {
		let capturedRequest: any;
		const mockAi = createMockAi({
			onGenerate: async (request) => {
				capturedRequest = request;
				return { text: 'remote' };
			},
			states: [{ state: FileState.ACTIVE }],
		});

		const client = createClient(mockAi);

		const sampleWebm = 'https://example.com/sample.webm';
		const result = await client.analyzeRemoteVideo({
			videoUrl: sampleWebm,
			prompt: '概要をください',
		});

		expect(result).toBe('remote');
		expect(mockAi.generateRequests.length).toBe(1);

		const content = Array.isArray(capturedRequest.contents)
			? capturedRequest.contents[0]
			: capturedRequest.contents;
		const filePart = content?.parts?.find((part: any) => part?.fileData);
		expect(filePart).toBeTruthy();
		expect(filePart.fileData.mimeType).toBe('video/webm');
	});

	it('retries with fallback model on internal error', async () => {
		let callCount = 0;
		const mockAi = createMockAi({
			onGenerate: async (_request, attempt) => {
				callCount = attempt;
				if (attempt === 1) {
					const error: any = new Error('internal');
					error.status = 'INTERNAL';
					throw error;
				}
				return { text: 'fallback ok' };
			},
			states: [{ state: FileState.ACTIVE }],
		});

		const client = createClient(mockAi, {
			remoteRetry: {
				maxAttempts: 1,
				initialDelayMs: 0,
				backoffMultiplier: 1,
				fallbackModels: ['gemini-2.0-flash-exp'],
			},
		});

		const result = await client.analyzeRemoteVideo({
			videoUrl: 'https://example.com/movie.mp4',
			prompt: '概要をください',
		});

		expect(result).toBe('fallback ok');
		expect(mockAi.generateRequests.length).toBe(2);
		expect(mockAi.generateRequests[0].model).toBe('gemini-test');
		expect(mockAi.generateRequests[1].model).toBe('gemini-2.0-flash-exp');
		void callCount;
	});

	it('throws when YouTube URL causes internal error', async () => {
		const mockAi = createMockAi({
			onGenerate: async () => {
				const error: any = new Error('internal');
				error.status = 'INTERNAL';
				throw error;
			},
			states: [{ state: FileState.ACTIVE }],
		});

		const client = createClient(mockAi, {
			remoteRetry: {
				maxAttempts: 1,
				initialDelayMs: 0,
				backoffMultiplier: 1,
				fallbackModels: [],
			},
		});

		await expect(
			client.analyzeRemoteVideo({
				videoUrl: YOUTUBE_VIDEO_URL,
				prompt: '概要をください',
			}),
		).rejects.toThrow(/Vertex AI を利用するか/);
	});
});

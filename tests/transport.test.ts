import { afterEach, describe, expect, it, vi } from 'vitest';

import { SatimConnectionError } from '../src/errors.js';
import { FetchSatimTransport } from '../src/fetch-transport.js';
import { SatimOperation } from '../src/operation.js';
import { resolveSatimOptions } from '../src/resolve-options.js';
import { testOptions } from './helpers.js';

const options = resolveSatimOptions(testOptions);

function stubFetch(answer: Response | Error): ReturnType<typeof vi.fn> {
  const mock = vi.fn<() => Promise<Response>>(() =>
    answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer),
  );

  vi.stubGlobal('fetch', mock);

  return mock;
}

describe('fetch transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts a form encoded body to the endpoint of the operation', async () => {
    const mock = stubFetch(new Response(JSON.stringify({ errorCode: '0' }), { status: 200 }));

    const answer = await new FetchSatimTransport(options).post(SatimOperation.Acknowledge, {
      mdOrder: 'V721uPPfNNofVQAAABL3',
    });

    expect(answer).toEqual({ errorCode: '0' });

    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://test2.satim.dz/payment/rest/public/acknowledgeTransaction.do');
    expect((init.headers as Record<string, string>)['content-type']).toBe(
      'application/x-www-form-urlencoded',
    );
    expect((init.body as URLSearchParams).get('mdOrder')).toBe('V721uPPfNNofVQAAABL3');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports a network failure as a connection error that keeps the cause', async () => {
    stubFetch(new TypeError('fetch failed'));

    await expect(
      new FetchSatimTransport(options).post(SatimOperation.Register, {}),
    ).rejects.toMatchObject({
      name: 'SatimConnectionError',
      cause: expect.any(TypeError),
    });
  });

  it('reports an unexpected HTTP status', async () => {
    stubFetch(new Response('', { status: 503 }));

    await expect(new FetchSatimTransport(options).post(SatimOperation.Refund, {})).rejects.toThrow(
      'HTTP status 503',
    );
  });

  it('refuses an answer that is not JSON', async () => {
    stubFetch(new Response('<html>maintenance</html>', { status: 200 }));

    await expect(new FetchSatimTransport(options).post(SatimOperation.Refund, {})).rejects.toThrow(
      SatimConnectionError,
    );
  });

  it('refuses a JSON answer that is not an object', async () => {
    stubFetch(new Response('[1, 2]', { status: 200 }));

    await expect(new FetchSatimTransport(options).post(SatimOperation.Refund, {})).rejects.toThrow(
      'did not return a JSON object',
    );
  });

  it('passes a dispatcher through to fetch when one was configured', async () => {
    const dispatcher = { marker: true };
    const mock = stubFetch(new Response('{}', { status: 200 }));

    await new FetchSatimTransport({ ...options, dispatcher }).post(SatimOperation.Register, {});

    const [, init] = mock.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(init['dispatcher']).toBe(dispatcher);
  });

  it('leaves the dispatcher out entirely when none was configured', async () => {
    const mock = stubFetch(new Response('{}', { status: 200 }));

    await new FetchSatimTransport(options).post(SatimOperation.Register, {});

    const [, init] = mock.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(init).not.toHaveProperty('dispatcher');
  });
});

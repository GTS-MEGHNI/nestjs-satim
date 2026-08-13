import 'reflect-metadata';

import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SatimConfigurationError, SatimConnectionError } from '../src/errors.js';
import { FetchSatimTransport } from '../src/fetch-transport.js';
import { SatimOperation } from '../src/operation.js';
import type { SatimModuleOptions } from '../src/options.js';
import { SatimModule } from '../src/satim.module.js';
import { SATIM_TRANSPORT } from '../src/tokens.js';

const options: SatimModuleOptions = {
  baseUrl: 'https://test2.satim.dz/payment/rest',
  username: 'merchant',
  password: 'secret',
  terminalId: 'E010900001',
  returnUrl: 'https://shop.test/satim/return',
  failUrl: 'https://shop.test/satim/fail',
};

/**
 * No @Inject on the constructor parameter, on purpose: Nest can only resolve
 * this from the metadata `emitDecoratorMetadata` writes. It resolving is the
 * proof that the build and the test transpiler both emit that metadata.
 */
@Injectable()
class MetadataProbe {
  constructor(readonly transport: FetchSatimTransport) {}
}

describe('toolchain', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves a class dependency from decorator metadata', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SatimModule.register(options)],
      providers: [FetchSatimTransport, MetadataProbe],
    }).compile();

    expect(moduleRef.get(MetadataProbe).transport).toBeInstanceOf(FetchSatimTransport);
  });

  it('provides the transport under its token', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SatimModule.register(options)],
    }).compile();

    expect(moduleRef.get(SATIM_TRANSPORT)).toBeInstanceOf(FetchSatimTransport);
  });

  it('names the missing option rather than failing generically', () => {
    expect(() => SatimModule.register({ ...options, terminalId: '' })).toThrow(
      SatimConfigurationError,
    );
    expect(() => SatimModule.register({ ...options, terminalId: '' })).toThrow('terminalId');
  });

  it('refuses a base URL that is not HTTPS', () => {
    expect(() => SatimModule.register({ ...options, baseUrl: 'http://test2.satim.dz' })).toThrow(
      'must use HTTPS',
    );
  });

  it('posts a form encoded body and decodes the JSON answer', async () => {
    const fetchMock = vi.fn<() => Promise<Response>>(() =>
      Promise.resolve(new Response(JSON.stringify({ errorCode: '0' }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const transport = new FetchSatimTransport({ ...options, timeoutMs: 1000 });
    const answer = await transport.post(SatimOperation.Register, { userName: 'merchant' });

    expect(answer).toEqual({ errorCode: '0' });

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('https://test2.satim.dz/payment/rest/register.do');
    expect(init.body).toBeInstanceOf(URLSearchParams);
    expect((init.body as URLSearchParams).get('userName')).toBe('merchant');
  });

  it('reports an unusable answer as a connection error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<() => Promise<Response>>(() =>
        Promise.resolve(new Response('<html>maintenance</html>', { status: 200 })),
      ),
    );

    const transport = new FetchSatimTransport(options);

    await expect(transport.post(SatimOperation.Refund, {})).rejects.toBeInstanceOf(
      SatimConnectionError,
    );
  });
});

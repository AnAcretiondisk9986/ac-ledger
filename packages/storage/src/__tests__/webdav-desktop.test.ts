import { describe, expect, it, vi } from 'vitest';
import { DesktopWebDAVAdapter, parseWebDAVDirectory, WebDAVBridgeResponse } from '../webdav-desktop.js';

function response(status: number, body = ''): WebDAVBridgeResponse {
  return { status, statusText: status === 207 ? 'Multi-Status' : 'OK', headers: {}, body };
}

describe('DesktopWebDAVAdapter', () => {
  it('parses namespaced PROPFIND file entries and skips directories', () => {
    const files = parseWebDAVDirectory(`
      <d:multistatus xmlns:d="DAV:">
        <d:response><d:href>/dav/AcLedger/</d:href><d:resourcetype><d:collection/></d:resourcetype></d:response>
        <d:response><d:href>/dav/AcLedger/ledger%20copy.json</d:href><d:propstat><d:prop>
          <d:getetag>&quot;etag-1&quot;</d:getetag><d:getcontentlength>12</d:getcontentlength>
          <d:getlastmodified>Mon, 10 Aug 2026 00:00:00 GMT</d:getlastmodified>
        </d:prop></d:propstat></d:response>
      </d:multistatus>`);
    expect(files).toEqual([
      {
        path: 'ledger copy.json',
        sha: 'etag-1',
        size: 12,
        updatedAt: 'Mon, 10 Aug 2026 00:00:00 GMT',
      },
    ]);
  });

  it('creates a missing base and transaction directory before writing', async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const bridge = {
      request: vi.fn(async (_config, request): Promise<WebDAVBridgeResponse> => {
        calls.push({ method: request.method, path: request.path });
        if (request.method === 'PROPFIND' && request.path === '') return response(207);
        if (request.method === 'PROPFIND') return response(404);
        if (request.method === 'MKCOL') return response(201);
        if (request.method === 'PUT') return response(201);
        return response(500);
      }),
    };
    const adapter = new DesktopWebDAVAdapter(
      { url: 'https://dav.example/dav/', username: 'u', password: 'p', basePath: 'AcLedger' },
      bridge
    );

    await adapter.testConnection();
    await adapter.writeFile('transactions/2026-08.json', '{}');
    expect(calls).toEqual([
      { method: 'PROPFIND', path: '' },
      { method: 'PROPFIND', path: 'AcLedger' },
      { method: 'MKCOL', path: 'AcLedger' },
      { method: 'PROPFIND', path: 'AcLedger/transactions' },
      { method: 'MKCOL', path: 'AcLedger/transactions' },
      { method: 'PUT', path: 'AcLedger/transactions/2026-08.json' },
    ]);
  });
});

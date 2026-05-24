import { constants as fsConstants } from 'node:fs';
// @ts-check
import fs from 'node:fs/promises';

/**
 * @typedef {{ op: 'access', path: string, mode: 'read' | 'readWrite' } | { op: 'readFile', path: string } | { op: 'mkdir', path: string } | { op: 'writeFile', path: string, content: string }} FsRequest
 */

/** @param {string} message @param {string} [code] */
const fail = (message, code = 'ERR_HELPER') => {
  process.stdout.write(JSON.stringify({ ok: false, error: { message, code } }));
  process.exit(0);
};

/** @param {unknown} value @returns {value is FsRequest} */
const isFsRequest = (value) => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  /** @type {unknown} */
  const op = Reflect.get(value, 'op');
  /** @type {unknown} */
  const filePath = Reflect.get(value, 'path');

  if (typeof filePath !== 'string') {
    return false;
  }

  if (op === 'access') {
    /** @type {unknown} */
    const mode = Reflect.get(value, 'mode');
    return mode === 'read' || mode === 'readWrite';
  }

  if (op === 'readFile' || op === 'mkdir') {
    return true;
  }

  if (op === 'writeFile') {
    return typeof Reflect.get(value, 'content') === 'string';
  }

  return false;
};

const main = async () => {
  const requestPath = process.argv[2];

  if (requestPath === undefined || requestPath === '') {
    fail('Missing request path argument');
    return;
  }

  /** @type {unknown} */
  let requestValue;

  try {
    requestValue = JSON.parse(await fs.readFile(requestPath, 'utf8'));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), 'ERR_BAD_REQUEST');
    return;
  }

  if (!isFsRequest(requestValue)) {
    fail('Request JSON did not match expected schema', 'ERR_BAD_REQUEST');
    return;
  }

  const request = requestValue;

  try {
    switch (request.op) {
      case 'access': {
        const mode =
          request.mode === 'readWrite' ? fsConstants.R_OK | fsConstants.W_OK : fsConstants.R_OK;
        await fs.access(request.path, mode);
        process.stdout.write(JSON.stringify({ ok: true }));
        return;
      }
      case 'readFile': {
        const buffer = await fs.readFile(request.path);
        process.stdout.write(JSON.stringify({ ok: true, base64: buffer.toString('base64') }));
        return;
      }
      case 'mkdir': {
        await fs.mkdir(request.path, { recursive: true });
        process.stdout.write(JSON.stringify({ ok: true }));
        return;
      }
      case 'writeFile': {
        await fs.writeFile(request.path, request.content, 'utf8');
        process.stdout.write(JSON.stringify({ ok: true }));
        return;
      }
      default: {
        fail(`Unknown op: ${request.op}`, 'ERR_UNKNOWN_OP');
        return;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : 'ERR_OPERATION_FAILED';
    process.stdout.write(JSON.stringify({ ok: false, error: { message, code } }));
  }
};

await main();

import { existsSync, openSync, closeSync, fstatSync, readSync } from 'node:fs';

import {
  getApprovalLogFile,
  parseApprovalLogEntry,
  type ApprovalLogEntry,
} from './approval-logger.service.ts';

export type ReadRecentApprovalLogsOptions = {
  readonly since?: string;
  readonly chunkSizeBytes?: number;
  readonly maxBytesToScan?: number;
};

export type ReadRecentApprovalLogsResult = {
  readonly entries: readonly ApprovalLogEntry[];
  readonly scannedBytes: number;
  readonly truncated: boolean;
};

const DEFAULT_CHUNK_SIZE_BYTES = 16 * 1024;
const DEFAULT_MAX_BYTES_TO_SCAN = 512 * 1024;

const parseLine = (line: string): ApprovalLogEntry | undefined => {
  if (line.trim() === '') {
    return undefined;
  }

  try {
    return parseApprovalLogEntry(JSON.parse(line));
  } catch {
    return undefined;
  }
};

export const readRecentApprovalLogs = (
  filePath: string = getApprovalLogFile(),
  options?: ReadRecentApprovalLogsOptions,
): ReadRecentApprovalLogsResult => {
  if (!existsSync(filePath)) {
    return {
      entries: [],
      scannedBytes: 0,
      truncated: false,
    };
  }

  const chunkSizeBytes = options?.chunkSizeBytes ?? DEFAULT_CHUNK_SIZE_BYTES;
  const maxBytesToScan = options?.maxBytesToScan ?? DEFAULT_MAX_BYTES_TO_SCAN;
  const since = options?.since;
  const fd = openSync(filePath, 'r');

  try {
    const fileSize = fstatSync(fd).size;
    let position = fileSize;
    let remainder = '';
    let scannedBytes = 0;
    let truncated = false;
    const collected: ApprovalLogEntry[] = [];
    let stop = false;

    while (position > 0 && !stop && scannedBytes < maxBytesToScan) {
      const nextStart = Math.max(0, position - chunkSizeBytes);
      const currentChunkSize = position - nextStart;
      const buffer = Buffer.alloc(currentChunkSize);
      readSync(fd, buffer, 0, currentChunkSize, nextStart);
      scannedBytes += currentChunkSize;
      position = nextStart;

      const text = buffer.toString('utf-8') + remainder;
      const lines = text.split('\n');
      remainder = position > 0 ? (lines.shift() ?? '') : '';

      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];

        if (line === undefined) {
          continue;
        }

        const entry = parseLine(line);

        if (entry === undefined) {
          continue;
        }

        if (since !== undefined && entry.timestamp <= since) {
          stop = true;
          break;
        }

        collected.push(entry);
      }
    }

    if (!stop && position === 0 && remainder !== '') {
      const entry = parseLine(remainder);

      if (entry !== undefined && (since === undefined || entry.timestamp > since)) {
        collected.push(entry);
      }
    }

    if (!stop && position > 0) {
      truncated = true;
    }

    return {
      entries: collected.reverse(),
      scannedBytes,
      truncated,
    };
  } finally {
    closeSync(fd);
  }
};

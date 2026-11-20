import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { collectFiles } from './utils.js';

/**
 * Calculate SHA-256 hash of a file using a readable stream.
 */
export function calculateHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export class DuplicateFinder extends EventEmitter {
  async find(directory) {
    const resolvedDir = path.resolve(directory);
    this.emit('search-start', { directory: resolvedDir });

    const filePaths = await collectFiles(resolvedDir);
    const total = filePaths.length;
    const hashMap = new Map();

    for (let i = 0; i < total; i += 1) {
      const filePath = filePaths[i];
      try {
        const stats = await fsPromises.stat(filePath);
        const hash = await calculateHash(filePath);

        if (!hashMap.has(hash)) {
          hashMap.set(hash, []);
        }
        hashMap.get(hash).push({
          path: filePath,
          relativePath: path.relative(resolvedDir, filePath),
          size: stats.size,
        });

        this.emit('file-processed', {
          path: filePath,
          hash,
          size: stats.size,
          current: i + 1,
          total,
        });
      } catch (error) {
        this.emit('hash-error', { path: filePath, error });
      }
    }

    const duplicateGroups = [];
    let totalWastedSpace = 0;

    for (const [hash, files] of hashMap.entries()) {
      if (files.length > 1) {
        const fileSize = files[0].size;
        const wastedSpace = fileSize * (files.length - 1);
        totalWastedSpace += wastedSpace;

        duplicateGroups.push({
          hash,
          count: files.length,
          fileSize,
          wastedSpace,
          files,
        });
      }
    }

    duplicateGroups.sort((a, b) => b.wastedSpace - a.wastedSpace);

    const result = {
      directory: resolvedDir,
      totalFilesScanned: total,
      groups: duplicateGroups,
      totalWastedSpace,
    };

    this.emit('duplicates-found', result);
    return result;
  }
}

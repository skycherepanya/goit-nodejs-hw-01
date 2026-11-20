import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { collectFiles, MS_PER_DAY } from './utils.js';

export class Cleanup extends EventEmitter {
  async cleanup(directory, { olderThan, confirm = false } = {}) {
    const resolvedDir = path.resolve(directory);
    this.emit('cleanup-start', {
      directory: resolvedDir,
      olderThan,
      confirm,
    });

    const filePaths = await collectFiles(resolvedDir);
    const now = Date.now();
    const candidates = [];

    for (const filePath of filePaths) {
      try {
        const stats = await fs.stat(filePath);
        const ageMs = now - stats.mtime.getTime();
        const daysOld = ageMs / MS_PER_DAY;

        if (daysOld > olderThan) {
          const fileInfo = {
            path: filePath,
            name: path.basename(filePath),
            relativePath: path.relative(resolvedDir, filePath),
            size: stats.size,
            mtime: stats.mtime,
            daysOld: Math.floor(daysOld),
          };
          candidates.push(fileInfo);
          this.emit('file-found', fileInfo);
        }
      } catch (error) {
        this.emit('cleanup-error', { path: filePath, error });
      }
    }

    candidates.sort((a, b) => b.daysOld - a.daysOld);

    const totalSize = candidates.reduce((acc, file) => acc + file.size, 0);
    let deletedCount = 0;
    let freedSize = 0;

    if (confirm && candidates.length > 0) {
      this.emit('delete-start', {
        totalFiles: candidates.length,
        totalSize,
      });

      for (let i = 0; i < candidates.length; i += 1) {
        const file = candidates[i];
        try {
          await fs.unlink(file.path);
          deletedCount += 1;
          freedSize += file.size;

          this.emit('file-deleted', {
            ...file,
            current: i + 1,
            total: candidates.length,
          });
        } catch (error) {
          this.emit('cleanup-error', { path: file.path, error });
        }
      }
    }

    const result = {
      directory: resolvedDir,
      olderThan,
      confirm,
      candidates,
      totalFiles: candidates.length,
      totalSize,
      deletedCount,
      freedSize,
    };

    this.emit('cleanup-complete', result);
    return result;
  }
}

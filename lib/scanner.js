import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { collectFiles, MS_PER_DAY } from './utils.js';

export class Scanner extends EventEmitter {
  async scan(directory) {
    const resolvedDir = path.resolve(directory);
    this.emit('scan-start', { directory: resolvedDir });

    const filePaths = await collectFiles(resolvedDir);
    const total = filePaths.length;

    const byType = new Map();
    const ageDistribution = {
      last7Days: 0,
      last30Days: 0,
      olderThan90Days: 0,
    };

    const filesData = [];
    let totalSize = 0;
    let oldestFile = null;
    const now = Date.now();

    for (let i = 0; i < total; i += 1) {
      const filePath = filePaths[i];
      try {
        const stats = await fs.stat(filePath);
        const ext = path.extname(filePath).toLowerCase() || '(no ext)';
        const ageDays = (now - stats.mtime.getTime()) / MS_PER_DAY;

        totalSize += stats.size;

        const typeEntry = byType.get(ext) || { count: 0, totalSize: 0 };
        typeEntry.count += 1;
        typeEntry.totalSize += stats.size;
        byType.set(ext, typeEntry);

        if (ageDays <= 7) {
          ageDistribution.last7Days += 1;
        }
        if (ageDays <= 30) {
          ageDistribution.last30Days += 1;
        }
        if (ageDays > 90) {
          ageDistribution.olderThan90Days += 1;
        }

        const fileInfo = {
          path: filePath,
          name: path.basename(filePath),
          size: stats.size,
          ext,
          mtime: stats.mtime,
          ageDays: Math.floor(ageDays),
        };

        filesData.push(fileInfo);

        if (!oldestFile || stats.mtime.getTime() < oldestFile.mtime.getTime()) {
          oldestFile = fileInfo;
        }

        this.emit('file-found', {
          ...fileInfo,
          current: i + 1,
          total,
        });
      } catch (error) {
        this.emit('scan-error', { path: filePath, error });
      }
    }

    const largestFiles = [...filesData]
      .sort((a, b) => b.size - a.size)
      .slice(0, 3);

    const sortedTypes = [...byType.entries()].sort((a, b) => b[1].totalSize - a[1].totalSize);

    const statistics = {
      directory: resolvedDir,
      totalFiles: filesData.length,
      totalSize,
      byType: sortedTypes,
      ageDistribution,
      largestFiles,
      oldestFile,
    };

    this.emit('scan-complete', statistics);
    return statistics;
  }
}

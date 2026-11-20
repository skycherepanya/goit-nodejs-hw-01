import { EventEmitter } from 'events';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { collectFiles, LARGE_FILE_THRESHOLD } from './utils.js';

export const CATEGORIES = {
  Documents: ['.pdf', '.docx', '.doc', '.txt', '.md', '.xlsx', '.pptx'],
  Images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'],
  Archives: ['.zip', '.rar', '.tar', '.gz', '.7z'],
  Code: ['.js', '.py', '.java', '.cpp', '.html', '.css', '.json'],
  Videos: ['.mp4', '.avi', '.mkv', '.mov', '.webm'],
  Other: [],
};

export function getCategory(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  for (const [category, extensions] of Object.entries(CATEGORIES)) {
    if (extensions.includes(ext)) {
      return category;
    }
  }
  return 'Other';
}

/**
 * Resolve filename conflicts in the target directory by appending (1), (2), etc.
 */
async function resolveTargetPath(targetDir, fileName) {
  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);

  let candidate = path.join(targetDir, fileName);
  let counter = 1;

  while (true) {
    try {
      await fsPromises.access(candidate);
      candidate = path.join(targetDir, `${baseName}(${counter})${ext}`);
      counter += 1;
    } catch {
      return candidate;
    }
  }
}

export class Organizer extends EventEmitter {
  async organize(sourceDir, targetDir) {
    const resolvedSource = path.resolve(sourceDir);
    const resolvedTarget = path.resolve(targetDir);

    this.emit('organize-start', {
      source: resolvedSource,
      target: resolvedTarget,
    });

    const files = await collectFiles(resolvedSource, { excludeDir: resolvedTarget });

    const categoryNames = Object.keys(CATEGORIES);
    await fsPromises.mkdir(resolvedTarget, { recursive: true });

    for (const category of categoryNames) {
      const categoryDir = path.join(resolvedTarget, category);
      await fsPromises.mkdir(categoryDir, { recursive: true });
      this.emit('folder-created', { category, path: categoryDir });
    }

    const summary = {};
    for (const category of categoryNames) {
      summary[category] = { count: 0, totalSize: 0 };
    }

    const total = files.length;
    let totalCopied = 0;
    let totalSize = 0;

    for (let i = 0; i < total; i += 1) {
      const sourcePath = files[i];
      const fileName = path.basename(sourcePath);
      const category = getCategory(sourcePath);
      const categoryDir = path.join(resolvedTarget, category);

      try {
        const stats = await fsPromises.stat(sourcePath);
        const targetPath = await resolveTargetPath(categoryDir, fileName);
        const usedStream = stats.size >= LARGE_FILE_THRESHOLD;

        this.emit('copy-start', {
          source: sourcePath,
          target: targetPath,
          category,
          size: stats.size,
          usedStream,
          current: i + 1,
          total,
        });

        if (usedStream) {
          await pipeline(
            fs.createReadStream(sourcePath),
            fs.createWriteStream(targetPath)
          );
        } else {
          await fsPromises.copyFile(sourcePath, targetPath);
        }

        summary[category].count += 1;
        summary[category].totalSize += stats.size;
        totalCopied += 1;
        totalSize += stats.size;

        this.emit('copy-complete', {
          source: sourcePath,
          target: targetPath,
          category,
          size: stats.size,
          usedStream,
          current: i + 1,
          total,
        });
      } catch (error) {
        this.emit('copy-error', {
          source: sourcePath,
          category,
          error,
          current: i + 1,
          total,
        });
      }
    }

    const result = {
      source: resolvedSource,
      target: resolvedTarget,
      summary,
      totalCopied,
      totalSize,
    };

    this.emit('organize-complete', result);
    return result;
  }
}

import fs from 'fs/promises';
import path from 'path';

export const MS_PER_DAY = 1000 * 60 * 60 * 24;
export const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10 MB

/**
 * Format file size in bytes to a human-readable string (B, KB, MB, GB).
 */
export function formatSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Draw an ASCII progress bar using block characters.
 */
export function drawProgressBar(current, total, width = 20) {
  const safeTotal = total > 0 ? total : 1;
  const percentage = Math.min(1, Math.max(0, current / safeTotal));
  const filled = Math.round(percentage * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `${bar} ${current}/${total}`;
}

/**
 * Format a Date object as YYYY-MM-DD.
 */
export function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Validate that a directory exists and is accessible.
 */
export async function validateDirectory(directory) {
  const resolved = path.resolve(directory);
  const stats = await fs.stat(resolved);
  if (!stats.isDirectory()) {
    const error = new Error(`Path is not a directory: ${resolved}`);
    error.code = 'ENOTDIR';
    throw error;
  }
  await fs.access(resolved);
  return resolved;
}

/**
 * Recursively collect all regular file paths in a directory.
 * Optionally excludes a specific directory path (e.g., target output folder inside source).
 */
export async function collectFiles(directory, { excludeDir = null } = {}) {
  const resolvedRoot = await validateDirectory(directory);
  const resolvedExclude = excludeDir ? path.resolve(excludeDir) : null;
  const entries = await fs.readdir(resolvedRoot, { recursive: true, withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const parentPath = entry.parentPath ?? entry.path ?? resolvedRoot;
    const fullPath = path.join(parentPath, entry.name);

    if (
      resolvedExclude &&
      (fullPath === resolvedExclude || fullPath.startsWith(resolvedExclude + path.sep))
    ) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

/**
 * Convert filesystem errors into clear, actionable messages.
 */
export function formatFsError(error, targetPath = '') {
  const suffix = targetPath ? `: ${targetPath}` : '';
  switch (error.code) {
    case 'ENOENT':
      return `Error: Directory or file not found${suffix}`;
    case 'EACCES':
    case 'EPERM':
      return `Error: Permission denied${suffix}`;
    case 'ENOTDIR':
      return `Error: Path is not a directory${suffix}`;
    case 'EISDIR':
      return `Error: Expected a file, but found a directory${suffix}`;
    case 'ENOSPC':
      return `Error: No space left on device${suffix}`;
    default:
      return `Unexpected error: ${error.message}`;
  }
}

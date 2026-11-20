#!/usr/bin/env node

import path from 'path';
import { Scanner } from './lib/scanner.js';
import { DuplicateFinder } from './lib/duplicates.js';
import { Organizer } from './lib/organizer.js';
import { Cleanup } from './lib/cleanup.js';
import {
  drawProgressBar,
  formatDate,
  formatFsError,
  formatSize,
} from './lib/utils.js';

const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

function printHelp() {
  console.log(`
File Organizer CLI — Node.js utility for directory analysis, deduplication, organization, and cleanup.

Usage:
  node file-organizer.js <command> [arguments] [options]

Commands:
  scan <directory>
      Recursively scan directory and display statistics (count, size, types, age, largest & oldest files).

  duplicates <directory>
      Find files with identical content using SHA-256 streaming hashes and calculate wasted space.

  organize <source> --output <target>
      Copy and sort files into category folders (Documents, Images, Archives, Code, Videos, Other).
      Uses streams for files >= 10 MB and resolves naming conflicts automatically.

  cleanup <directory> --older-than <days> [--confirm]
      Find files older than <days>. Runs in dry-run mode by default; pass --confirm to delete.

Examples:
  node file-organizer.js scan ./Downloads
  node file-organizer.js duplicates ./Downloads
  node file-organizer.js organize ./Downloads --output ./Organized
  node file-organizer.js cleanup ./Downloads --older-than 90
  node file-organizer.js cleanup ./Downloads --older-than 90 --confirm
`);
}

function writeProgress(label, current, total, unit = '') {
  const suffix = unit ? ` ${unit}` : '';
  const line = `${label} ${drawProgressBar(current, total)}${suffix}`;
  if (process.stdout.isTTY) {
    process.stdout.write(`\r${line}`);
    if (current >= total) {
      process.stdout.write('\n');
    }
  } else if (current >= total || current === 1) {
    console.log(line);
  }
}

function parseOptionValue(args, flagNames) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    for (const flag of flagNames) {
      if (arg === flag) {
        return args[i + 1];
      }
      if (arg.startsWith(`${flag}=`)) {
        return arg.slice(flag.length + 1);
      }
    }
  }
  return null;
}

async function runScan(args) {
  const directory = args[0];
  if (!directory) {
    console.error('Error: Missing required <directory> argument.\nUsage: node file-organizer.js scan <directory>');
    process.exit(1);
  }

  const scanner = new Scanner();

  scanner.on('scan-start', ({ directory: dir }) => {
    console.log(`\nScanning: ${dir}`);
  });

  scanner.on('file-found', ({ current, total }) => {
    writeProgress('Processing...', current, total, 'files');
  });

  scanner.on('scan-error', ({ path: filePath, error }) => {
    console.error(`\nWarning: Skipped ${filePath} (${error.code || error.message})`);
  });

  scanner.on('scan-complete', (stats) => {
    console.log('\nScan Results:');
    console.log(DIVIDER);
    console.log(`Total files: ${stats.totalFiles}`);
    console.log(`Total size: ${formatSize(stats.totalSize)}`);

    console.log('\nBy File Type:');
    if (stats.byType.length === 0) {
      console.log('  (no files found)');
    } else {
      const topTypes = stats.byType.slice(0, 6);
      const restTypes = stats.byType.slice(6);

      for (const [ext, info] of topTypes) {
        const extLabel = ext.padEnd(10);
        const countLabel = `${info.count} files`.padEnd(12);
        console.log(`  ${extLabel} ${countLabel} ${formatSize(info.totalSize)}`);
      }

      if (restTypes.length > 0) {
        const otherCount = restTypes.reduce((sum, [, info]) => sum + info.count, 0);
        const otherSize = restTypes.reduce((sum, [, info]) => sum + info.totalSize, 0);
        console.log(`  ${'(other)'.padEnd(10)} ${`${otherCount} files`.padEnd(12)} ${formatSize(otherSize)}`);
      }
    }

    console.log('\nFile Age:');
    console.log(`  Last 7 days:    ${stats.ageDistribution.last7Days} files`);
    console.log(`  Last 30 days:   ${stats.ageDistribution.last30Days} files`);
    console.log(`  Older than 90:  ${stats.ageDistribution.olderThan90Days} files`);

    console.log('\nLargest files:');
    if (stats.largestFiles.length === 0) {
      console.log('  (none)');
    } else {
      stats.largestFiles.forEach((file, index) => {
        console.log(`  ${index + 1}. ${file.name.padEnd(28)} ${formatSize(file.size)}`);
      });
    }

    if (stats.oldestFile) {
      console.log(
        `\nOldest file: ${stats.oldestFile.name} (modified ${stats.oldestFile.ageDays} days ago)`
      );
    }
    console.log();
  });

  await scanner.scan(directory);
}

async function runDuplicates(args) {
  const directory = args[0];
  if (!directory) {
    console.error('Error: Missing required <directory> argument.\nUsage: node file-organizer.js duplicates <directory>');
    process.exit(1);
  }

  const finder = new DuplicateFinder();

  finder.on('search-start', ({ directory: dir }) => {
    console.log(`\nSearching for duplicates in: ${dir}`);
  });

  finder.on('file-processed', ({ current, total }) => {
    writeProgress('Calculating hashes...', current, total, 'files');
  });

  finder.on('hash-error', ({ path: filePath, error }) => {
    console.error(`\nWarning: Could not hash ${filePath} (${error.code || error.message})`);
  });

  finder.on('duplicates-found', (result) => {
    if (result.groups.length === 0) {
      console.log('\nNo duplicate files found.\n');
      return;
    }

    console.log(
      `\nFound ${result.groups.length} duplicate group(s) (${formatSize(result.totalWastedSpace)} wasted):`
    );
    console.log(DIVIDER);

    result.groups.forEach((group, index) => {
      console.log(
        `Group ${index + 1} (${group.count} copies, ${formatSize(group.fileSize)} each):`
      );
      console.log(`  SHA-256: ${group.hash.slice(0, 16)}...`);
      console.log();
      for (const file of group.files) {
        console.log(`  - ${file.relativePath}`);
      }
      console.log(`\n  Wasted space: ${formatSize(group.wastedSpace)}`);
      console.log(DIVIDER);
    });

    console.log(`Total wasted space: ${formatSize(result.totalWastedSpace)}\n`);
  });

  await finder.find(directory);
}

async function runOrganize(args) {
  const sourceDir = args[0];
  const targetDir = parseOptionValue(args.slice(1), ['--output', '-o']);

  if (!sourceDir || !targetDir) {
    console.error(
      'Error: Missing required arguments.\nUsage: node file-organizer.js organize <source> --output <target>'
    );
    process.exit(1);
  }

  const organizer = new Organizer();
  let folderHeaderPrinted = false;

  organizer.on('organize-start', ({ source, target }) => {
    console.log(`\nOrganizing: ${source}`);
    console.log(`Target:     ${target}\n`);
  });

  organizer.on('folder-created', ({ category }) => {
    if (!folderHeaderPrinted) {
      console.log('Creating folders...');
      folderHeaderPrinted = true;
    }
    console.log(`  ✓ ${category}/`);
  });

  organizer.on('copy-start', ({ current, total }) => {
    if (current === 1) {
      console.log();
    }
    writeProgress('Copying files...', current, total);
  });

  organizer.on('copy-error', ({ source, error }) => {
    console.error(`\nWarning: Failed to copy ${source} (${error.code || error.message})`);
  });

  organizer.on('organize-complete', (result) => {
    const targetName = path.basename(result.target);
    console.log('\nOrganization complete!\n');
    console.log('Summary:');
    for (const [category, info] of Object.entries(result.summary)) {
      const catLabel = `${category}:`.padEnd(11);
      const countLabel = `${info.count} files`.padEnd(10);
      console.log(`  ${catLabel} ${countLabel} -> ${targetName}/${category}/`);
    }
    console.log(
      `\nTotal copied: ${result.totalCopied} files (${formatSize(result.totalSize)})\n`
    );
  });

  await organizer.organize(sourceDir, targetDir);
}

async function runCleanup(args) {
  const directory = args[0];
  const olderThanRaw = parseOptionValue(args.slice(1), ['--older-than']);
  const confirm = args.includes('--confirm');

  if (!directory || olderThanRaw === null) {
    console.error(
      'Error: Missing required arguments.\nUsage: node file-organizer.js cleanup <directory> --older-than <days> [--confirm]'
    );
    process.exit(1);
  }

  const olderThan = Number(olderThanRaw);
  if (Number.isNaN(olderThan) || olderThan < 0) {
    console.error('Error: --older-than must be a non-negative number of days.');
    process.exit(1);
  }

  const cleanup = new Cleanup();

  cleanup.on('cleanup-start', ({ directory: dir, olderThan: days }) => {
    console.log(`\nCleanup: ${dir}`);
    console.log(`Looking for files older than ${days} days...\n`);
  });

  cleanup.on('delete-start', ({ totalFiles, totalSize }) => {
    console.log(`Found ${totalFiles} files to delete:`);
    console.log(
      `\nWARNING: DELETING ${totalFiles} files (${formatSize(totalSize)}). This action cannot be undone!`
    );
  });

  cleanup.on('file-deleted', ({ current, total }) => {
    writeProgress('Deleting...', current, total);
  });

  cleanup.on('cleanup-error', ({ path: filePath, error }) => {
    console.error(`\nWarning: Could not process ${filePath} (${error.code || error.message})`);
  });

  cleanup.on('cleanup-complete', (result) => {
    if (result.totalFiles === 0) {
      console.log(`No files older than ${result.olderThan} days were found.\n`);
      return;
    }

    if (!result.confirm) {
      console.log(`Found ${result.totalFiles} files to delete:`);
      console.log(DIVIDER);

      const previewLimit = 10;
      const previewFiles = result.candidates.slice(0, previewLimit);

      for (const file of previewFiles) {
        console.log(file.relativePath);
        console.log(`  Size: ${formatSize(file.size)}`);
        console.log(`  Modified: ${file.daysOld} days ago (${formatDate(file.mtime)})\n`);
      }

      if (result.candidates.length > previewLimit) {
        console.log(`... (${result.candidates.length - previewLimit} more files)\n`);
      }

      console.log(DIVIDER);
      console.log(`Total: ${result.totalFiles} files (${formatSize(result.totalSize)})\n`);
      console.log('DRY RUN MODE: No files were deleted.');
      console.log('To actually delete these files, run with --confirm flag.\n');
    } else {
      console.log('\nCleanup complete!');
      console.log(
        `Deleted: ${result.deletedCount} files (${formatSize(result.freedSize)} freed)\n`
      );
    }
  });

  await cleanup.cleanup(directory, { olderThan, confirm });
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  const commandArgs = args.slice(1);
  const targetPath = commandArgs[0] || '';

  try {
    switch (command) {
      case 'scan':
        await runScan(commandArgs);
        break;
      case 'duplicates':
        await runDuplicates(commandArgs);
        break;
      case 'organize':
        await runOrganize(commandArgs);
        break;
      case 'cleanup':
        await runCleanup(commandArgs);
        break;
      default:
        console.error(`Error: Unknown command "${command}". Run with --help to see available commands.`);
        process.exit(1);
    }
  } catch (error) {
    console.error(formatFsError(error, targetPath));
    process.exit(1);
  }
}

main();

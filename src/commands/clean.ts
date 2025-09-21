import fs from 'node:fs';
import path from 'node:path';
import { ConfigParser } from '../config.js';

export interface CleanOptions {
  type?: 'artifacts' | 'experience';
  path?: string;
}

export async function cleanCommand(options: CleanOptions = {}): Promise<void> {
  const type = options.type || 'artifacts';
  const customPath = options.path;

  // Store original working directory
  const originalCwd = process.cwd();

  // Determine base path for relative paths BEFORE changing directories
  const basePath = customPath
    ? path.resolve(originalCwd, customPath)
    : process.cwd();

  try {
    // If custom path is provided, change to that directory and load config
    if (customPath) {
      const resolvedPath = path.resolve(originalCwd, customPath);
      console.log(`📁 Working in directory: ${resolvedPath}`);
      process.chdir(resolvedPath);

      try {
        // Try to load config from this path
        const configParser = ConfigParser.getInstance();
        await configParser.loadConfig({ path: '.' }); // Use current directory (.) since we already changed to it
        console.log(`✅ Configuration loaded from: ${resolvedPath}`);
      } catch (error) {
        console.log(
          `⚠️  No configuration found in ${resolvedPath}, using default paths`
        );
      }
    }

    // Clean artifacts
    if (type === 'artifacts' || type === 'all') {
      const artifactsPaths = [
        path.join(basePath, 'output'),
        path.join(basePath, 'test-results'),
        path.join(basePath, 'screenshots'),
        path.join(basePath, 'allure-results'),
        path.join(basePath, 'logs'),
      ];

      for (const artifactPath of artifactsPaths) {
        await cleanPath(artifactPath, 'Artifacts');
      }
    }

    // Clean experience files
    if (type === 'experience' || type === 'all') {
      const experiencePaths = [
        path.join(basePath, 'experience'),
        path.join(basePath, '.experience'),
        path.join(basePath, 'experiences'),
      ];

      for (const experiencePath of experiencePaths) {
        await cleanPath(experiencePath, 'Experience');
      }
    }

    console.log(`✅ Cleanup completed successfully!`);
  } catch (error) {
    console.error(`❌ Failed to clean:`, error);
    process.exit(1);
  } finally {
    // Always restore original working directory
    if (process.cwd() !== originalCwd) {
      process.chdir(originalCwd);
    }
  }
}

async function cleanPath(
  targetPath: string,
  displayName: string
): Promise<void> {
  const resolvedPath = path.resolve(targetPath);

  if (!fs.existsSync(resolvedPath)) {
    console.log(`📁 ${displayName} path does not exist: ${resolvedPath}`);
    return;
  }

  const stat = fs.statSync(resolvedPath);

  try {
    if (stat.isDirectory()) {
      console.log(`🧹 Cleaning ${displayName} folder: ${resolvedPath}`);
      await cleanDirectory(resolvedPath);
      console.log(`✅ ${displayName} folder cleaned successfully`);
    } else {
      console.log(`🗑️  Removing ${displayName} file: ${resolvedPath}`);
      fs.unlinkSync(resolvedPath);
      console.log(`✅ ${displayName} file removed successfully`);
    }
  } catch (error) {
    console.error(`❌ Failed to clean ${displayName}:`, error);
  }
}

async function cleanDirectory(dirPath: string): Promise<void> {
  const items = fs.readdirSync(dirPath);

  for (const item of items) {
    const itemPath = path.join(dirPath, item);
    const stat = fs.statSync(itemPath);

    if (stat.isDirectory()) {
      await cleanDirectory(itemPath);
      console.log(`🗑️  Removed directory: ${item}`);
    } else {
      fs.unlinkSync(itemPath);
      console.log(`🗑️  Removed file: ${item}`);
    }
  }

  fs.rmdirSync(dirPath);
}

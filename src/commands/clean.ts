import fs from 'node:fs';
import path from 'node:path';

export interface CleanOptions {
  type?: 'artifacts' | 'experience';
}

export async function cleanCommand(options: CleanOptions = {}): Promise<void> {
  const type = options.type || 'artifacts';

  function removeDirectory(dir: string): void {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);

      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
          removeDirectory(filePath);
        } else {
          fs.unlinkSync(filePath);
        }
      }

      fs.rmdirSync(dir);
    }
  }

  function cleanFolder(folderPath: string, folderName: string): void {
    if (!fs.existsSync(folderPath)) {
      console.log(`📁 ${folderName} folder does not exist, nothing to clean`);
      return;
    }

    try {
      console.log(`🧹 Cleaning ${folderName} folder...`);

      const files = fs.readdirSync(folderPath);

      for (const file of files) {
        const filePath = path.join(folderPath, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
          removeDirectory(filePath);
          console.log(`🗑️  Removed directory: ${file}`);
        } else {
          fs.unlinkSync(filePath);
          console.log(`🗑️  Removed file: ${file}`);
        }
      }

      console.log(`✅ ${folderName} folder cleaned successfully`);
    } catch (error) {
      console.error(`❌ Failed to clean ${folderName} folder:`, error);
      process.exit(1);
    }
  }

  if (type === 'artifacts') {
    cleanFolder('./output', 'Output');
  } else if (type === 'experience') {
    cleanFolder('./experience', 'Experience');
  }
}

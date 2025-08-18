import fs from 'node:fs';
import path from 'node:path';

export class CleanCommand {
  private removeDirectory(dir: string): void {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);

      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
          this.removeDirectory(filePath);
        } else {
          fs.unlinkSync(filePath);
        }
      }

      fs.rmdirSync(dir);
    }
  }

  private cleanFolder(folderPath: string, folderName: string): void {
    if (!fs.existsSync(folderPath)) {
      console.log(`📁 ${folderName} folder does not exist, nothing to clean`);
      return;
    }

    try {
      console.log(`🧹 Cleaning ${folderName} folder...`);

      // Remove all contents but keep the directory
      const files = fs.readdirSync(folderPath);

      for (const file of files) {
        const filePath = path.join(folderPath, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
          this.removeDirectory(filePath);
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

  private cleanOutputFolder(): void {
    this.cleanFolder('./output', 'Output');
  }

  private cleanExperienceFolder(): void {
    this.cleanFolder('./experience', 'Experience');
  }

  run(type: 'artifacts' | 'experience'): void {
    if (type === 'artifacts') {
      this.cleanOutputFolder();
    } else if (type === 'experience') {
      this.cleanExperienceFolder();
    }
  }
}

import fs from 'node:fs';
import path from 'node:path';
import { ApiCommand } from './api-command.ts';

export class KnowCommand extends ApiCommand {
  name = 'know';
  aliases = ['add-knowledge'];
  description = 'Add API knowledge for an endpoint';
  knowledge = '';

  async execute(endpoint: string): Promise<void> {
    if (!this.knowledge) {
      throw new Error('Description is required.');
    }

    const knowledgeDir = await this.resolveKnowledgeDir();
    fs.mkdirSync(knowledgeDir, { recursive: true });

    const filename = endpoint.replace(/^\//, '').replace(/[^a-zA-Z0-9]/g, '_') || 'general';
    const filePath = path.join(knowledgeDir, `${filename}.md`);

    if (fs.existsSync(filePath)) {
      fs.appendFileSync(filePath, `\n---\n${this.knowledge}\n`, 'utf8');
      console.log(`Updated: ${filePath}`);
      return;
    }

    fs.writeFileSync(filePath, `---\nendpoint: "${endpoint}"\n---\n${this.knowledge}\n`, 'utf8');
    console.log(`Created: ${filePath}`);
  }

  private async resolveKnowledgeDir(): Promise<string> {
    const parser = this.bot.getConfigParser();
    const options = this.bot.getOptions();
    try {
      await parser.loadConfig(options);
      return parser.getKnowledgeDir();
    } catch {
      if (options.path) return path.join(path.resolve(options.path), 'knowledge');
      return 'knowledge';
    }
  }
}

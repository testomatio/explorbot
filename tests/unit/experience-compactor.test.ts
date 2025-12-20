import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import matter from 'gray-matter';
import { ExperienceCompactor } from '../../src/ai/experience-compactor';
import type { Provider } from '../../src/ai/provider';
import { ConfigParser } from '../../src/config';
import { ExperienceTracker } from '../../src/experience-tracker';

class MockProvider {
  private responses: any[] = [];
  private callIndex = 0;
  public lastMessages: any[] = [];

  setResponses(responses: any[]) {
    this.responses = responses;
    this.callIndex = 0;
  }

  getModelForAgent(_agentName?: string): string {
    return 'test-model';
  }

  async chat(messages: any[], _model: string): Promise<any> {
    this.lastMessages = messages;
    const response = this.responses[this.callIndex] || { text: 'Compacted content' };
    this.callIndex++;
    return response;
  }

  async generateObject(messages: any[], _schema: any, _model?: string): Promise<any> {
    this.lastMessages = messages;
    const response = this.responses[this.callIndex] || { object: { mergeGroups: [] } };
    this.callIndex++;
    return response;
  }

  reset() {
    this.responses = [];
    this.callIndex = 0;
    this.lastMessages = [];
  }
}

describe('ExperienceCompactor', () => {
  let compactor: ExperienceCompactor;
  let experienceTracker: ExperienceTracker;
  let mockProvider: MockProvider;
  const testDir = '/tmp/experience';

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }

    const mockConfig = {
      playwright: { browser: 'chromium', url: 'http://localhost:3000' },
      ai: { provider: null, model: 'test' },
      dirs: {
        knowledge: '/tmp/explorbot-test/knowledge',
        experience: 'experience',
      },
    };

    const configParser = ConfigParser.getInstance();
    (configParser as any).config = mockConfig;
    (configParser as any).configPath = '/tmp/config.js';

    experienceTracker = new ExperienceTracker();
    mockProvider = new MockProvider();
    compactor = new ExperienceCompactor(mockProvider as unknown as Provider, experienceTracker);
  });

  afterEach(() => {
    experienceTracker.cleanup();
    mockProvider.reset();

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('mergeSimilarExperiences', () => {
    it('should return 0 when there are less than 2 experience files', async () => {
      experienceTracker.writeExperienceFile('single-file', 'Some content', { url: '/page1', title: 'Page 1' });

      const mergedCount = await compactor.mergeSimilarExperiences();

      expect(mergedCount).toBe(0);
    });

    it('should return 0 when there are no files to merge', async () => {
      experienceTracker.writeExperienceFile('file1', 'Content 1', { url: '/page1', title: 'Page 1' });
      experienceTracker.writeExperienceFile('file2', 'Content 2', { url: '/different', title: 'Different Page' });

      mockProvider.setResponses([{ object: { mergeGroups: [] } }]);

      const mergedCount = await compactor.mergeSimilarExperiences();

      expect(mergedCount).toBe(0);
    });

    it('should merge files with similar dynamic URLs', async () => {
      experienceTracker.writeExperienceFile('item-101', 'Content for item 101', { url: '/item/101', title: 'Item 101' });
      experienceTracker.writeExperienceFile('item-102', 'Content for item 102', { url: '/item/102', title: 'Item 102' });
      experienceTracker.writeExperienceFile('item-105', 'Content for item 105', { url: '/item/105', title: 'Item 105' });

      mockProvider.setResponses([
        {
          object: {
            mergeGroups: [
              {
                urls: ['/item/101', '/item/102', '/item/105'],
                pattern: '~/item/\\d+~',
              },
            ],
          },
        },
      ]);

      const mergedCount = await compactor.mergeSimilarExperiences();

      expect(mergedCount).toBe(2);

      const experiences = experienceTracker.getAllExperience();
      expect(experiences).toHaveLength(1);

      const mergedFile = experiences[0];
      expect(mergedFile.data.url).toBe('~/item/\\d+~');
      expect(mergedFile.data.mergedFrom).toContain('/item/101');
      expect(mergedFile.data.mergedFrom).toContain('/item/102');
      expect(mergedFile.data.mergedFrom).toContain('/item/105');
      expect(mergedFile.data.mergedFrom).toHaveLength(3);
      expect(mergedFile.content).toContain('Content for item 101');
      expect(mergedFile.content).toContain('Content for item 102');
      expect(mergedFile.content).toContain('Content for item 105');
    });

    it('should merge multiple groups independently', async () => {
      experienceTracker.writeExperienceFile('item-1', 'Item content 1', { url: '/item/1', title: 'Item 1' });
      experienceTracker.writeExperienceFile('item-2', 'Item content 2', { url: '/item/2', title: 'Item 2' });
      experienceTracker.writeExperienceFile('user-john', 'User content john', { url: '/user/john', title: 'User John' });
      experienceTracker.writeExperienceFile('user-jane', 'User content jane', { url: '/user/jane', title: 'User Jane' });

      mockProvider.setResponses([
        {
          object: {
            mergeGroups: [
              {
                urls: ['/item/1', '/item/2'],
                pattern: '~/item/\\d+~',
              },
              {
                urls: ['/user/john', '/user/jane'],
                pattern: '~/user/[^/]+~',
              },
            ],
          },
        },
      ]);

      const mergedCount = await compactor.mergeSimilarExperiences();

      expect(mergedCount).toBe(2);

      const experiences = experienceTracker.getAllExperience();
      expect(experiences).toHaveLength(2);

      const itemExperience = experiences.find((e) => e.data.url === '~/item/\\d+~');
      const userExperience = experiences.find((e) => e.data.url === '~/user/[^/]+~');

      expect(itemExperience).toBeTruthy();
      expect(userExperience).toBeTruthy();
      expect(itemExperience?.data.mergedFrom).toContain('/item/1');
      expect(itemExperience?.data.mergedFrom).toContain('/item/2');
      expect(userExperience?.data.mergedFrom).toContain('/user/john');
      expect(userExperience?.data.mergedFrom).toContain('/user/jane');
    });

    it('should skip files that already have regex URL patterns', async () => {
      experienceTracker.writeExperienceFile('already-merged', 'Already merged content', {
        url: '~/existing/\\d+~',
        title: 'Already Merged',
      });
      experienceTracker.writeExperienceFile('item-1', 'Item content', { url: '/item/1', title: 'Item 1' });
      experienceTracker.writeExperienceFile('item-2', 'Item content 2', { url: '/item/2', title: 'Item 2' });

      mockProvider.setResponses([
        {
          object: {
            mergeGroups: [
              {
                urls: ['/item/1', '/item/2'],
                pattern: '~/item/\\d+~',
              },
            ],
          },
        },
      ]);

      const mergedCount = await compactor.mergeSimilarExperiences();

      expect(mergedCount).toBe(1);

      const experiences = experienceTracker.getAllExperience();
      expect(experiences).toHaveLength(2);

      const existingRegex = experiences.find((e) => e.data.url === '~/existing/\\d+~');
      expect(existingRegex).toBeTruthy();
    });

    it('should delete source files after merging', async () => {
      experienceTracker.writeExperienceFile('file-a', 'Content A', { url: '/path/a', title: 'File A' });
      experienceTracker.writeExperienceFile('file-b', 'Content B', { url: '/path/b', title: 'File B' });

      mockProvider.setResponses([
        {
          object: {
            mergeGroups: [
              {
                urls: ['/path/a', '/path/b'],
                pattern: '~/path/[a-z]+~',
              },
            ],
          },
        },
      ]);

      await compactor.mergeSimilarExperiences();

      const experiences = experienceTracker.getAllExperience();
      expect(experiences).toHaveLength(1);

      const remainingFileA = existsSync(`${testDir}/file-a.md`);
      const remainingFileB = existsSync(`${testDir}/file-b.md`);
      expect(remainingFileA || remainingFileB).toBe(true);
      expect(remainingFileA && remainingFileB).toBe(false);
    });

    it('should handle AI errors gracefully and return 0', async () => {
      experienceTracker.writeExperienceFile('file1', 'Content 1', { url: '/page/1', title: 'Page 1' });
      experienceTracker.writeExperienceFile('file2', 'Content 2', { url: '/page/2', title: 'Page 2' });

      mockProvider.generateObject = async () => {
        throw new Error('AI service unavailable');
      };

      const mergedCount = await compactor.mergeSimilarExperiences();

      expect(mergedCount).toBe(0);

      const experiences = experienceTracker.getAllExperience();
      expect(experiences).toHaveLength(2);
    });

    it('should not merge files if AI returns group with less than 2 files', async () => {
      experienceTracker.writeExperienceFile('file1', 'Content 1', { url: '/page/1', title: 'Page 1' });
      experienceTracker.writeExperienceFile('file2', 'Content 2', { url: '/other/2', title: 'Page 2' });

      mockProvider.setResponses([
        {
          object: {
            mergeGroups: [
              {
                urls: ['/page/1'],
                pattern: '~/page/\\d+~',
              },
            ],
          },
        },
      ]);

      const mergedCount = await compactor.mergeSimilarExperiences();

      expect(mergedCount).toBe(0);
    });

    it('should combine content with separator between merged files', async () => {
      experienceTracker.writeExperienceFile('first', 'First content', { url: '/doc/1', title: 'Doc 1' });
      experienceTracker.writeExperienceFile('second', 'Second content', { url: '/doc/2', title: 'Doc 2' });

      mockProvider.setResponses([
        {
          object: {
            mergeGroups: [
              {
                urls: ['/doc/1', '/doc/2'],
                pattern: '~/doc/\\d+~',
              },
            ],
          },
        },
      ]);

      await compactor.mergeSimilarExperiences();

      const experiences = experienceTracker.getAllExperience();
      expect(experiences[0].content).toContain('---');
      expect(experiences[0].content).toContain('First content');
      expect(experiences[0].content).toContain('Second content');
    });
  });

  describe('compactAllExperiences', () => {
    it('should call mergeSimilarExperiences before compacting', async () => {
      experienceTracker.writeExperienceFile('item-1', 'Short content', { url: '/item/1', title: 'Item 1' });
      experienceTracker.writeExperienceFile('item-2', 'Short content 2', { url: '/item/2', title: 'Item 2' });

      mockProvider.setResponses([
        {
          object: {
            mergeGroups: [
              {
                urls: ['/item/1', '/item/2'],
                pattern: '~/item/\\d+~',
              },
            ],
          },
        },
      ]);

      await compactor.compactAllExperiences();

      const experiences = experienceTracker.getAllExperience();
      expect(experiences).toHaveLength(1);
      expect(experiences[0].data.url).toBe('~/item/\\d+~');
    });

    it('should compact files that exceed MAX_LENGTH after merging', async () => {
      const longContent = 'A'.repeat(6000);
      experienceTracker.writeExperienceFile('long-file', longContent, { url: '/long', title: 'Long File' });

      let chatCalled = false;
      mockProvider.chat = async () => {
        chatCalled = true;
        return { text: 'Compacted content' };
      };
      mockProvider.setResponses([{ object: { mergeGroups: [] } }]);

      await compactor.compactAllExperiences();

      expect(chatCalled).toBe(true);
    });

    it('should not compact files under MAX_LENGTH', async () => {
      const shortContent = 'Short content under limit';
      experienceTracker.writeExperienceFile('short-file', shortContent, { url: '/short', title: 'Short File' });

      mockProvider.setResponses([{ object: { mergeGroups: [] } }]);

      const compactedCount = await compactor.compactAllExperiences();

      expect(compactedCount).toBe(0);

      const experiences = experienceTracker.getAllExperience();
      expect(experiences[0].content.trim()).toBe(shortContent);
    });
  });

  describe('compactExperience', () => {
    it('should return original content if under MAX_LENGTH', async () => {
      const shortContent = 'Short experience content';

      const result = await compactor.compactExperience(shortContent);

      expect(result).toBe(shortContent);
    });

    it('should call AI to compact content over MAX_LENGTH', async () => {
      const longContent = 'B'.repeat(6000);
      mockProvider.setResponses([{ text: 'Compacted version' }]);

      const result = await compactor.compactExperience(longContent);

      expect(result).toBe('Compacted version');
      expect(mockProvider.lastMessages.length).toBe(2);
    });
  });

  describe('buildMergePrompt', () => {
    it('should include all URLs in the prompt', async () => {
      experienceTracker.writeExperienceFile('file1', 'Content', { url: '/test/1', title: 'Test 1' });
      experienceTracker.writeExperienceFile('file2', 'Content', { url: '/test/2', title: 'Test 2' });
      experienceTracker.writeExperienceFile('file3', 'Content', { url: '/other/path', title: 'Other' });

      mockProvider.setResponses([{ object: { mergeGroups: [] } }]);

      await compactor.mergeSimilarExperiences();

      const promptContent = mockProvider.lastMessages[0]?.content || '';
      expect(promptContent).toContain('/test/1');
      expect(promptContent).toContain('/test/2');
      expect(promptContent).toContain('/other/path');
    });
  });
});

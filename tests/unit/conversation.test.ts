import { describe, expect, it } from 'bun:test';
import { Conversation } from '../../src/ai/conversation';

describe('Conversation', () => {
  describe('cleanupTag', () => {
    it('should replace tag contents in all messages', () => {
      const conversation = new Conversation();
      conversation.addUserText('Hello <page_html><div>Old content 1</div></page_html> world');
      conversation.addAssistantText('Response');
      conversation.addUserText('Another <page_html><div>Old content 2</div></page_html> message');

      conversation.cleanupTag('page_html', '...cleaned up...');

      expect(conversation.messages[0].content).toBe('Hello <page_html>...cleaned up...</page_html> world');
      expect(conversation.messages[1].content).toBe('Response');
      expect(conversation.messages[2].content).toBe('Another <page_html>...cleaned up...</page_html> message');
    });

    it('should handle multiple tags in same message', () => {
      const conversation = new Conversation();
      conversation.addUserText('<page_html><div>First</div></page_html> and <page_html><div>Second</div></page_html>');

      conversation.cleanupTag('page_html', '...cleaned...');

      expect(conversation.messages[0].content).toBe('<page_html>...cleaned...</page_html> and <page_html>...cleaned...</page_html>');
    });

    it('should keep last N messages unchanged when keepLast is specified', () => {
      const conversation = new Conversation();
      conversation.addUserText('Message 1 <page_html><div>Old 1</div></page_html>');
      conversation.addUserText('Message 2 <page_html><div>Old 2</div></page_html>');
      conversation.addUserText('Message 3 <page_html><div>Old 3</div></page_html>');
      conversation.addUserText('Message 4 <page_html><div>Old 4</div></page_html>');

      conversation.cleanupTag('page_html', '...cleaned...', 2);

      expect(conversation.messages[0].content).toBe('Message 1 <page_html>...cleaned...</page_html>');
      expect(conversation.messages[1].content).toBe('Message 2 <page_html>...cleaned...</page_html>');
      expect(conversation.messages[2].content).toBe('Message 3 <page_html><div>Old 3</div></page_html>');
      expect(conversation.messages[3].content).toBe('Message 4 <page_html><div>Old 4</div></page_html>');
    });

    it('should handle tags with multiline content', () => {
      const conversation = new Conversation();
      conversation.addUserText('Start <page_html>\n<div>\n  <p>Multiline</p>\n</div>\n</page_html> end');

      conversation.cleanupTag('page_html', '...cleaned...');

      expect(conversation.messages[0].content).toBe('Start <page_html>...cleaned...</page_html> end');
    });

    it('should handle different tag names', () => {
      const conversation = new Conversation();
      conversation.addUserText('Text <custom_tag>Old content</custom_tag> here');

      conversation.cleanupTag('custom_tag', 'New content');

      expect(conversation.messages[0].content).toBe('Text <custom_tag>New content</custom_tag> here');
    });

    it('should not affect messages without the specified tag', () => {
      const conversation = new Conversation();
      conversation.addUserText('No tags here');
      conversation.addUserText('Has <page_html>content</page_html>');

      conversation.cleanupTag('page_html', '...cleaned...');

      expect(conversation.messages[0].content).toBe('No tags here');
      expect(conversation.messages[1].content).toBe('Has <page_html>...cleaned...</page_html>');
    });

    it('should handle empty replacement', () => {
      const conversation = new Conversation();
      conversation.addUserText('Text <page_html>Old content</page_html> end');

      conversation.cleanupTag('page_html', '');

      expect(conversation.messages[0].content).toBe('Text <page_html></page_html> end');
    });

    it('should not affect non-string message content', () => {
      const conversation = new Conversation();
      conversation.addUserText('Text with <page_html>content</page_html>');
      conversation.addUserImage('base64encodedimage');
      conversation.addUserText('Another <page_html>content</page_html>');

      conversation.cleanupTag('page_html', '...cleaned...');

      expect(conversation.messages[0].content).toBe('Text with <page_html>...cleaned...</page_html>');
      expect(Array.isArray(conversation.messages[1].content)).toBe(true);
      expect(conversation.messages[2].content).toBe('Another <page_html>...cleaned...</page_html>');
    });

    it('should handle keepLast equal to total messages', () => {
      const conversation = new Conversation();
      conversation.addUserText('Message 1 <page_html>Old</page_html>');
      conversation.addUserText('Message 2 <page_html>Old</page_html>');

      conversation.cleanupTag('page_html', '...cleaned...', 2);

      expect(conversation.messages[0].content).toBe('Message 1 <page_html>Old</page_html>');
      expect(conversation.messages[1].content).toBe('Message 2 <page_html>Old</page_html>');
    });

    it('should handle keepLast greater than total messages', () => {
      const conversation = new Conversation();
      conversation.addUserText('Message <page_html>Old</page_html>');

      conversation.cleanupTag('page_html', '...cleaned...', 10);

      expect(conversation.messages[0].content).toBe('Message <page_html>Old</page_html>');
    });

    it('should preserve tag contents in last message when keepLast is set and last message is empty', () => {
      const conversation = new Conversation();
      conversation.addUserText('Message 1 <page_html><div>Important content</div></page_html>');
      conversation.addUserText('Message 2 <page_html><span>More content</span></page_html>');
      conversation.addAssistantText('');

      conversation.cleanupTag('page_html', '...cleaned...', 1);

      expect(conversation.messages[0].content).toBe('Message 1 <page_html>...cleaned...</page_html>');
      expect(conversation.messages[1].content).toBe('Message 2 <page_html>...cleaned...</page_html>');
      expect(conversation.messages[2].content).toContain('<page_html>');
      expect(conversation.messages[2].content).toContain('Important content');
      expect(conversation.messages[2].content).toContain('More content');
    });

    it('should preserve tag contents when keepLast is set and last message does not contain tag', () => {
      const conversation = new Conversation();
      conversation.addUserText('First <page_html><div>Content to preserve</div></page_html>');
      conversation.addAssistantText('Response without tag');

      conversation.cleanupTag('page_html', '...cleaned...', 1);

      expect(conversation.messages[0].content).toBe('First <page_html>...cleaned...</page_html>');
      expect(conversation.messages[1].content).toContain('Response without tag');
      expect(conversation.messages[1].content).toContain('<page_html>');
      expect(conversation.messages[1].content).toContain('Content to preserve');
    });
  });

  describe('autoTrimTag', () => {
    it('should trim tag content to max length when adding new messages', () => {
      const conversation = new Conversation();
      conversation.autoTrimTag('html', 10);

      conversation.addUserText('Text <html>This is a very long content</html>');

      expect(conversation.messages[0].content).toBe('Text <html>This is a </html>');
    });

    it('should not trim content shorter than max length', () => {
      const conversation = new Conversation();
      conversation.autoTrimTag('html', 100);

      conversation.addUserText('Text <html>Short</html>');

      expect(conversation.messages[0].content).toBe('Text <html>Short</html>');
    });

    it('should support multiple auto trim rules', () => {
      const conversation = new Conversation();
      conversation.autoTrimTag('html', 5);
      conversation.autoTrimTag('data', 8);

      conversation.addUserText('<html>Very long html</html> and <data>Very long data</data>');

      expect(conversation.messages[0].content).toBe('<html>Very </html> and <data>Very lon</data>');
    });

    it('should apply trim rules to both user and assistant messages', () => {
      const conversation = new Conversation();
      conversation.autoTrimTag('content', 6);

      conversation.addUserText('User: <content>Long user content</content>');
      conversation.addAssistantText('Assistant: <content>Long assistant content</content>');

      expect(conversation.messages[0].content).toBe('User: <content>Long u</content>');
      expect(conversation.messages[1].content).toBe('Assistant: <content>Long a</content>');
    });

    it('should handle multiple occurrences of same tag', () => {
      const conversation = new Conversation();
      conversation.autoTrimTag('data', 4);

      conversation.addUserText('<data>First long</data> middle <data>Second long</data>');

      expect(conversation.messages[0].content).toBe('<data>Firs</data> middle <data>Seco</data>');
    });

    it('should handle large max lengths like 100_000', () => {
      const conversation = new Conversation();
      conversation.autoTrimTag('html', 100_000);

      const longContent = 'x'.repeat(50_000);
      conversation.addUserText(`<html>${longContent}</html>`);

      expect(conversation.messages[0].content).toBe(`<html>${longContent}</html>`);
    });

    it('should trim at exactly max length', () => {
      const conversation = new Conversation();
      conversation.autoTrimTag('html', 100_000);

      const exactContent = 'x'.repeat(100_000);
      conversation.addUserText(`<html>${exactContent}</html>`);

      expect(conversation.messages[0].content).toBe(`<html>${exactContent}</html>`);
    });

    it('should trim content longer than max length', () => {
      const conversation = new Conversation();
      conversation.autoTrimTag('html', 100_000);

      const longContent = 'x'.repeat(150_000);
      const expectedContent = 'x'.repeat(100_000);
      conversation.addUserText(`<html>${longContent}</html>`);

      expect(conversation.messages[0].content).toBe(`<html>${expectedContent}</html>`);
    });

    it('should not affect messages without auto trim rules', () => {
      const conversation = new Conversation();

      conversation.addUserText('Text <html>Long content here</html>');

      expect(conversation.messages[0].content).toBe('Text <html>Long content here</html>');
    });

    it('should handle tags with special characters in name', () => {
      const conversation = new Conversation();
      conversation.autoTrimTag('my_tag', 5);

      conversation.addUserText('<my_tag>Very long content</my_tag>');

      expect(conversation.messages[0].content).toBe('<my_tag>Very </my_tag>');
    });

    it('should handle multiline content within tags', () => {
      const conversation = new Conversation();
      conversation.autoTrimTag('html', 10);

      conversation.addUserText('<html>\nLine 1\nLine 2\nLine 3\n</html>');

      expect(conversation.messages[0].content).toBe('<html>\nLine 1\nLi</html>');
    });

    it('should update trim rule if called multiple times for same tag', () => {
      const conversation = new Conversation();
      conversation.autoTrimTag('html', 5);
      conversation.autoTrimTag('html', 10);

      conversation.addUserText('<html>Very long content</html>');

      expect(conversation.messages[0].content).toBe('<html>Very long </html>');
    });
  });

  describe('hasTag', () => {
    it('should return true when tag exists in message', () => {
      const conversation = new Conversation();
      conversation.addUserText('Text with <page_html>content</page_html>');

      expect(conversation.hasTag('page_html')).toBe(true);
    });

    it('should return false when tag does not exist', () => {
      const conversation = new Conversation();
      conversation.addUserText('Text without any tags');

      expect(conversation.hasTag('page_html')).toBe(false);
    });

    it('should find tag in any message', () => {
      const conversation = new Conversation();
      conversation.addUserText('First message');
      conversation.addAssistantText('Second message');
      conversation.addUserText('Third <html>with tag</html>');

      expect(conversation.hasTag('html')).toBe(true);
    });

    it('should return false for empty conversation', () => {
      const conversation = new Conversation();

      expect(conversation.hasTag('any_tag')).toBe(false);
    });

    it('should handle tags with special characters', () => {
      const conversation = new Conversation();
      conversation.addUserText('Text <my_tag>content</my_tag>');

      expect(conversation.hasTag('my_tag')).toBe(true);
    });

    it('should not match partial tag names', () => {
      const conversation = new Conversation();
      conversation.addUserText('Text <page_html>content</page_html>');

      expect(conversation.hasTag('page')).toBe(false);
      expect(conversation.hasTag('html')).toBe(false);
    });

    it('should ignore non-string message content', () => {
      const conversation = new Conversation();
      conversation.addUserImage('base64encodedimage');

      expect(conversation.hasTag('any_tag')).toBe(false);
    });

    it('should find tag even if it appears multiple times', () => {
      const conversation = new Conversation();
      conversation.addUserText('<data>First</data> and <data>Second</data>');

      expect(conversation.hasTag('data')).toBe(true);
    });

    it('should check all messages not just the last one', () => {
      const conversation = new Conversation();
      conversation.addUserText('First <old_tag>content</old_tag>');
      conversation.addUserText('Second message without tag');
      conversation.addUserText('Third message without tag');

      expect(conversation.hasTag('old_tag')).toBe(true);
    });

    it('should return true for tags in both user and assistant messages', () => {
      const conversation = new Conversation();
      conversation.addUserText('User message');
      conversation.addAssistantText('Assistant <response>content</response>');

      expect(conversation.hasTag('response')).toBe(true);
    });
  });
});

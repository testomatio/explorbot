import { describe, expect, it } from 'bun:test';
import { Chief } from '../../boat/api-tester/src/ai/chief.ts';
import { Curler } from '../../boat/api-tester/src/ai/curler.ts';

describe('API data protection prompts', () => {
  it('keeps Chief sample records read-only and requires scenario-owned mutation targets', () => {
    const provider = { getAgenticModel: () => ({}) };
    const chief = new Chief(provider as any, { api: { baseEndpoint: 'https://api.example.test' } } as any);

    const conversation = (chief as any).buildConversation('/tests', 'hacker', 'IDs: existing-123');
    const prompt = JSON.stringify(conversation.messages);

    expect(prompt).toContain('Treat records and IDs from sample_data as read-only');
    expect(prompt).toContain('same scenario must first create its own target');
    expect(prompt).toContain('if that setup is impossible, do not send the destructive request');
    expect(prompt).not.toContain('pick a real existing ID and modify specific fields');
  });

  it('tells Curler not to probe destructive methods against existing records', () => {
    const curler = new Curler({} as any, {} as any, {} as any, {} as any);

    const prompt = (curler as any).buildSystemPrompt();

    expect(prompt).toContain('existing records, sample data, and IDs supplied by the plan as read-only');
    expect(prompt).toContain('create the target inside the current scenario');
    expect(prompt).toContain('never probe destructively against pre-existing data');
    expect(prompt).toContain('use stop rather than risking existing data');
  });
});

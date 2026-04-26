import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from 'ink';
import React from 'react';
import { tag } from '../utils/logger.js';
import { type NextStepSection, printNextSteps, relativeToCwd } from '../utils/next-steps.ts';
import { BaseCommand, type Suggestion } from './base-command.js';

export class AddRuleCommand extends BaseCommand {
  name = 'add-rule';
  description = 'Create a rule file for an agent';
  suggestions: Suggestion[] = [{ command: 'add-rule researcher check-tooltips', hint: 'example — add a rule for the researcher agent' }];

  async execute(args: string): Promise<void> {
    const parts = args.trim().split(/\s+/);
    const agentName = parts[0] || '';
    const ruleName = parts[1] || '';
    const ruleContent = parts.slice(2).join(' ');

    if (!agentName || !ruleName) {
      const AddRule = (await import('../components/AddRule.js')).default;

      const { unmount } = render(
        React.createElement(AddRule, {
          initialAgent: agentName,
          initialName: ruleName,
          onComplete: () => unmount(),
          onCancel: () => unmount(),
        }),
        {
          exitOnCtrlC: false,
          patchConsole: false,
        }
      );
      return;
    }

    AddRuleCommand.createRuleFile(agentName, ruleName, { content: ruleContent });
  }

  static createRuleFile(agentName: string, ruleName: string, opts?: { content?: string; urlPattern?: string }): string | null {
    const rulesDir = join(process.cwd(), 'rules', agentName);
    mkdirSync(rulesDir, { recursive: true });

    const filePath = join(rulesDir, `${ruleName}.md`);
    if (existsSync(filePath)) {
      tag('warning').log(`Rule file already exists: ${relativeToCwd(filePath)}`);
      return null;
    }

    const content = opts?.content || `Instructions for ${agentName} agent.`;
    writeFileSync(filePath, `${content.trim()}\n`);

    const configLine = opts?.urlPattern ? `ai.agents.${agentName}.rules: [{ '${opts.urlPattern}': '${ruleName}' }]` : `ai.agents.${agentName}.rules: ['${ruleName}']`;
    const sections: NextStepSection[] = [
      {
        label: 'Rule',
        path: filePath,
        commands: [{ label: 'Add to config', command: configLine }],
      },
    ];
    printNextSteps(sections);

    return filePath;
  }
}

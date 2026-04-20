import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Box, Text, useInput } from 'ink';
import React, { useEffect, useState } from 'react';
import { AddRuleCommand } from '../commands/add-rule-command.js';
import InputReadline from './InputReadline.js';

const KNOWN_AGENTS = ['researcher', 'tester', 'planner', 'pilot', 'captain', 'driller', 'navigator'];

interface AddRuleProps {
  initialAgent?: string;
  initialName?: string;
  onComplete?: () => void;
  onCancel?: () => void;
}

const AddRule: React.FC<AddRuleProps> = ({ initialAgent = '', initialName = '', onComplete, onCancel }) => {
  const [agent, setAgent] = useState(initialAgent);
  const [ruleName, setRuleName] = useState(initialName);
  const [urlPattern, setUrlPattern] = useState('');
  const [content, setContent] = useState('');
  const [activeField, setActiveField] = useState<'agent' | 'name' | 'url' | 'content'>(initialAgent ? (initialName ? 'url' : 'name') : 'agent');
  const [existingRules, setExistingRules] = useState<string[]>([]);

  const isStandalone = !onComplete;

  useEffect(() => {
    if (!agent.trim()) {
      setExistingRules([]);
      return;
    }
    const rulesDir = join(process.cwd(), 'rules', agent);
    if (!existsSync(rulesDir)) {
      setExistingRules([]);
      return;
    }
    const files = readdirSync(rulesDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''));
    setExistingRules(files);
  }, [agent]);

  const handleSave = () => {
    if (!agent.trim() || !ruleName.trim() || !content.trim()) return;

    const result = AddRuleCommand.createRuleFile(agent.trim(), ruleName.trim(), {
      content: content.trim(),
      urlPattern: urlPattern.trim() || undefined,
    });

    if (isStandalone) {
      process.exit(result ? 0 : 1);
    } else {
      onComplete?.();
    }
  };

  const fields: Array<'agent' | 'name' | 'url' | 'content'> = ['agent', 'name', 'url', 'content'];

  const advanceField = () => {
    const idx = fields.indexOf(activeField);
    if (idx < fields.length - 1) {
      setActiveField(fields[idx + 1]);
    }
  };

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (isStandalone) {
        process.exit(0);
      } else {
        onCancel?.();
      }
    }

    if (key.escape && !isStandalone) {
      onCancel?.();
    }

    if (key.tab) {
      advanceField();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Add Rule
        </Text>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Box marginBottom={1}>
          <Text color={activeField === 'agent' ? 'blue' : 'gray'}>Agent:</Text>
        </Box>
        <Box borderStyle="single" borderColor={activeField === 'agent' ? 'blue' : 'gray'} paddingX={1}>
          <InputReadline
            value={agent}
            onChange={setAgent}
            onSubmit={() => {
              if (agent.trim()) advanceField();
            }}
            placeholder={KNOWN_AGENTS.join(', ')}
            isActive={activeField === 'agent'}
            showPrompt={false}
          />
        </Box>
      </Box>

      {existingRules.length > 0 && (
        <Box marginBottom={1} flexDirection="column">
          <Text color="yellow">Existing rules: {existingRules.join(', ')}</Text>
        </Box>
      )}

      <Box marginBottom={1} flexDirection="column">
        <Box marginBottom={1}>
          <Text color={activeField === 'name' ? 'blue' : 'gray'}>Rule name:</Text>
        </Box>
        <Box borderStyle="single" borderColor={activeField === 'name' ? 'blue' : 'gray'} paddingX={1}>
          <InputReadline
            value={ruleName}
            onChange={setRuleName}
            onSubmit={() => {
              if (ruleName.trim()) advanceField();
            }}
            placeholder="e.g. check-tooltips, wait-for-toasts"
            isActive={activeField === 'name'}
            showPrompt={false}
          />
        </Box>
        <Text color="gray" dimColor>
          Saved as rules/{agent || '<agent>'}/{ruleName || '<name>'}.md
        </Text>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Box marginBottom={1}>
          <Text color={activeField === 'url' ? 'blue' : 'gray'}>URL pattern (optional):</Text>
        </Box>
        <Box borderStyle="single" borderColor={activeField === 'url' ? 'blue' : 'gray'} paddingX={1}>
          <InputReadline value={urlPattern} onChange={setUrlPattern} onSubmit={advanceField} placeholder="Leave empty for all URLs, or /admin/*, /checkout, etc." isActive={activeField === 'url'} showPrompt={false} />
        </Box>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Box marginBottom={1}>
          <Text color={activeField === 'content' ? 'blue' : 'gray'}>Rule content:</Text>
        </Box>
        <Box borderStyle="single" borderColor={activeField === 'content' ? 'blue' : 'gray'} paddingX={1}>
          <InputReadline
            value={content}
            onChange={setContent}
            onSubmit={() => {
              if (content.trim()) handleSave();
            }}
            placeholder="Instructions for the agent..."
            isActive={activeField === 'content'}
            showPrompt={false}
          />
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          Tab: Next field | Enter: Next/Save | {isStandalone ? 'Ctrl+C' : 'Esc'}: Exit
        </Text>
      </Box>
    </Box>
  );
};

export default AddRule;

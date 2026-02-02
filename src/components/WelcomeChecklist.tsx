import { Box, Text } from 'ink';
import React from 'react';
import type { ExplorbotConfig } from '../config.js';
import type { KnowledgeTracker } from '../knowledge-tracker.js';

interface ChecklistItem {
  label: string;
  description: string;
  enabled: boolean;
  value?: string;
  suggestion?: string;
}

interface WelcomeChecklistProps {
  config: ExplorbotConfig;
  knowledgeTracker: KnowledgeTracker;
}

const ChecklistRow: React.FC<{ item: ChecklistItem }> = ({ item }) => (
  <Box>
    <Text color={item.enabled ? 'green' : 'gray'}>{item.enabled ? '  ✓ ' : '  ○ '}</Text>
    <Text color={item.enabled ? 'white' : 'gray'}>{item.label}</Text>
    {item.value && <Text color="cyan"> ({item.value})</Text>}
    <Text color="gray"> - {item.description}</Text>
    {!item.enabled && item.suggestion && <Text color="yellow"> → {item.suggestion}</Text>}
  </Box>
);

const WelcomeChecklist: React.FC<WelcomeChecklistProps> = ({ config, knowledgeTracker }) => {
  const knowledge = knowledgeTracker.listAllKnowledge();
  const knowledgeCount = knowledge.length;

  const langfusePublicKey = config.ai?.langfuse?.publicKey || process.env.LANGFUSE_PUBLIC_KEY;
  const langfuseSecretKey = config.ai?.langfuse?.secretKey || process.env.LANGFUSE_SECRET_KEY;
  const langfuseEnabled = config.ai?.langfuse?.enabled ?? Boolean(langfusePublicKey && langfuseSecretKey);

  const items: ChecklistItem[] = [
    {
      label: 'Vision model',
      description: 'analyze screenshots for visual assertions',
      enabled: Boolean(config.ai?.visionModel || config.ai?.vision),
      value: config.ai?.visionModel,
      suggestion: 'set ai.visionModel in config',
    },
    {
      label: 'Knowledge',
      description: 'teach AI web app usage, pass credentials',
      enabled: knowledgeCount > 0,
      value: knowledgeCount > 0 ? `${knowledgeCount} file${knowledgeCount > 1 ? 's' : ''}` : undefined,
      suggestion: 'use /knows:add',
    },
    {
      label: 'Reporter',
      description: 'get a complete test run report',
      enabled: Boolean(process.env.TESTOMATIO),
      suggestion: 'set TESTOMATIO env var',
    },
    {
      label: 'Quartermaster',
      description: 'additional a11y checks',
      enabled: config.ai?.agents?.quartermaster?.enabled === true || (config as any).agents?.quartermaster?.enabled === true,
      suggestion: 'enable ai.agents.quartermaster',
    },
    {
      label: 'Langfuse',
      description: 'collect execution reports and analyze failures',
      enabled: langfuseEnabled,
      suggestion: 'enable ai.langfuse',
    },
  ];

  return (
    <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Configuration
        </Text>
      </Box>
      {items.map((item, index) => (
        <ChecklistRow key={index} item={item} />
      ))}
    </Box>
  );
};

export default WelcomeChecklist;

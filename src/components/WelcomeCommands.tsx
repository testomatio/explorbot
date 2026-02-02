import { Box, Text } from 'ink';
import React from 'react';

interface CommandInfo {
  command: string;
  description: string;
  examples?: string[];
}

interface WelcomeCommandsProps {
  hasKnowledge: boolean;
}

const Command: React.FC<{ text: string }> = ({ text }) => (
  <Text bold color="#9B59B6">
    {text}
  </Text>
);

const WelcomeCommands: React.FC<WelcomeCommandsProps> = ({ hasKnowledge }) => {
  const commands: CommandInfo[] = [
    {
      command: '/explore',
      description: 'AI creates test plan and runs all tests automatically',
      examples: ['/explore', '/explore checkout flow'],
    },
    {
      command: '/plan',
      description: 'generate test scenarios for current page without running them',
      examples: ['/plan', '/plan user registration'],
    },
    {
      command: '/test',
      description: 'run tests from current plan (requires /plan first)',
      examples: ['/test', '/test 2', '/test *'],
    },
    {
      command: '/navigate',
      description: 'AI navigates to a specific page or state',
      examples: ['/navigate /users/settings'],
    },
    {
      command: '/research',
      description: 'analyze current page and list available actions',
    },
  ];

  const knowledgeCommand: CommandInfo = {
    command: '/knows:add',
    description: 'add knowledge about your app (credentials, workflows)',
    examples: ['/knows:add login uses admin@test.com'],
  };

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Box marginBottom={1}>
        <Text>What should we do next?</Text>
      </Box>

      {!hasKnowledge && (
        <Box flexDirection="column" marginBottom={1}>
          <Box>
            <Text color="yellow">→ </Text>
            <Text>Start by adding knowledge about your app:</Text>
          </Box>
          <Box paddingLeft={2}>
            <Command text={knowledgeCommand.command} />
            <Text color="gray"> - {knowledgeCommand.description}</Text>
          </Box>
          {knowledgeCommand.examples && (
            <Box paddingLeft={4}>
              <Text color="gray" dimColor>
                {knowledgeCommand.examples.join('  ')}
              </Text>
            </Box>
          )}
        </Box>
      )}

      <Box flexDirection="column">
        {commands.map((cmd, index) => (
          <Box key={index} flexDirection="column">
            <Box>
              <Text> </Text>
              <Command text={cmd.command} />
              <Text color="gray"> - {cmd.description}</Text>
            </Box>
            {cmd.examples && (
              <Box paddingLeft={4}>
                <Text color="gray" dimColor>
                  {cmd.examples.join('  ')}
                </Text>
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default WelcomeCommands;

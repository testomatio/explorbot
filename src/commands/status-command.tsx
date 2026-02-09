import { Box, Text, render } from 'ink';
import React from 'react';
import { Stats } from '../stats.ts';
import { BaseCommand } from './base-command.js';

const Row: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <Box>
    <Box width={40}>
      <Text color="dim">{label}</Text>
    </Box>
    <Box>
      <Text bold>{value}</Text>
    </Box>
  </Box>
);

const StatusPane: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const modelEntries = Object.entries(Stats.models);

  React.useEffect(() => {
    const timer = setTimeout(onComplete, 100);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Session Statistics</Text>
      </Box>
      <Row label="Tests" value={Stats.tests} />
      <Row label="Plans" value={Stats.plans} />
      <Row label="Researches" value={Stats.researches} />

      <Box marginTop={1} marginBottom={1}>
        <Text bold>Usage</Text>
      </Box>
      <Row label="Time" value={Stats.getElapsedTime()} />
      {modelEntries.map(([model, tokens]) => (
        <Row key={model} label={model} value={`${Stats.humanizeTokens(tokens.total)} tokens`} />
      ))}
    </Box>
  );
};

export class StatusCommand extends BaseCommand {
  name = 'status';
  description = 'Show session statistics and token usage';

  async execute(_args: string): Promise<void> {
    return new Promise((resolve) => {
      const { unmount } = render(
        React.createElement(StatusPane, {
          onComplete: () => {
            unmount();
            resolve();
          },
        }),
        { exitOnCtrlC: false, patchConsole: false }
      );
    });
  }
}

import { Box, Text } from 'ink';
import React from 'react';
import { Stats } from '../stats.js';

const ROW_WIDTH = 60;
const LABEL_WIDTH = 45;

const Row: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <Box width={ROW_WIDTH}>
    <Box width={LABEL_WIDTH} overflow="hidden">
      <Text color="dim" wrap="truncate-end">
        {label}
      </Text>
    </Box>
    <Box flexGrow={1}>
      <Text bold>{value}</Text>
    </Box>
  </Box>
);

export const StatusPane: React.FC<{ onComplete?: () => void }> = ({ onComplete }) => {
  const modelEntries = Object.entries(Stats.models);

  React.useEffect(() => {
    if (!onComplete) return;
    const timer = setTimeout(onComplete, 100);
    return () => clearTimeout(timer);
  }, [onComplete]);

  const statsRows = [
    { label: 'Tests', value: Stats.tests },
    { label: 'Plans', value: Stats.plans },
    { label: 'Researches', value: Stats.researches },
  ].filter((row) => row.value > 0);

  const tokenRows = modelEntries.filter(([, tokens]) => tokens.total > 0);

  if (statsRows.length === 0 && tokenRows.length === 0) return null;

  return (
    <Box flexDirection="column" borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} paddingX={1} paddingY={1} width={ROW_WIDTH + 4}>
      <Box marginBottom={1}>
        <Text bold>Session Statistics</Text>
      </Box>
      {statsRows.map((row) => (
        <Row key={row.label} label={row.label} value={row.value} />
      ))}

      {tokenRows.length > 0 && (
        <>
          <Box marginTop={1} marginBottom={1}>
            <Text bold>Usage</Text>
          </Box>
          <Row label="Time" value={Stats.getElapsedTime()} />
          {tokenRows.map(([model, tokens]) => (
            <Row key={model} label={model} value={`${Stats.humanizeTokens(tokens.total)} tokens`} />
          ))}
        </>
      )}
    </Box>
  );
};

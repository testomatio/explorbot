import type React from 'react';
import { Box, Text } from 'ink';
import type { StateTransition, WebPageState } from '../state-manager.js';

interface StateTransitionPaneProps {
  transition?: StateTransition;
  currentState?: WebPageState;
}

const StateTransitionPane: React.FC<StateTransitionPaneProps> = ({
  transition,
  currentState,
}) => {
  if (currentState) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Box
          padding={1}
          borderStyle="round"
          borderColor="dim"
          flexDirection="column"
        >
          <Box flexDirection="row" alignItems="flex-start" marginBottom={1}>
            <Text color="dim">Current Page </Text>
            <Text color="blue" wrap="truncate-end">
              {currentState.url}
            </Text>
          </Box>

          <Box marginY={0}>
            <Text color="dim">
              URL:{' '}
              <Text color="yellow" wrap="truncate-end">
                {currentState.fullUrl || currentState.url || 'unknown'}
              </Text>
            </Text>
          </Box>
          <Box marginY={0}>
            <Text color="dim">
              Title: <Text color="yellow">{currentState.title || 'none'}</Text>
            </Text>
          </Box>
          {currentState.h1 && (
            <Box marginY={0}>
              <Text color="dim">
                H1: <Text color="yellow">{currentState.h1}</Text>
              </Text>
            </Box>
          )}
          {currentState.h2 && (
            <Box marginY={0}>
              <Text color="dim">
                H2: <Text color="yellow">{currentState.h2}</Text>
              </Text>
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  if (!transition) {
    return null;
  }

  const { fromState, toState, trigger, timestamp } = transition;

  const getDifferences = () => {
    const differences: Array<{ key: string; from: string; to: string }> = [];

    // URL comparison
    if (fromState?.url !== toState.url) {
      differences.push({
        key: 'url',
        from: fromState?.url || 'none',
        to: toState.url || 'none',
      });
    }

    // Title comparison
    if (fromState?.title !== toState.title) {
      differences.push({
        key: 'title',
        from: fromState?.title || 'none',
        to: toState.title || 'none',
      });
    }

    // H1 comparison
    if (fromState?.h1 !== toState.h1) {
      differences.push({
        key: 'h1',
        from: fromState?.h1 || 'none',
        to: toState.h1 || 'none',
      });
    }

    // H2 comparison
    if (fromState?.h2 !== toState.h2) {
      differences.push({
        key: 'h2',
        from: fromState?.h2 || 'none',
        to: toState.h2 || 'none',
      });
    }

    // H3 comparison
    if (fromState?.h3 !== toState.h3) {
      differences.push({
        key: 'h3',
        from: fromState?.h3 || 'none',
        to: toState.h3 || 'none',
      });
    }

    // H4 comparison
    if (fromState?.h4 !== toState.h4) {
      differences.push({
        key: 'h4',
        from: fromState?.h4 || 'none',
        to: toState.h4 || 'none',
      });
    }

    return differences;
  };

  const differences = getDifferences();
  const timeString = timestamp.toLocaleTimeString();

  if (differences.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box
        borderStyle="round"
        borderColor="dim"
        padding={1}
        flexDirection="column"
      >
        <Box justifyContent="space-between" marginBottom={1}>
          <Text color="dim">🔄 state changed</Text>
          <Text color="dim">
            [{timeString}] {trigger}
          </Text>
        </Box>

        {differences.map((diff, index) => (
          <Box key={index} marginY={0}>
            <Text color="dim">
              {diff.key}: <Text color="red">{diff.from}</Text> →{' '}
              <Text color="green">{diff.to}</Text>
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default StateTransitionPane;

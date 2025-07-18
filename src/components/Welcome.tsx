import { Box, Text } from 'ink';
import type React from 'react';

const Welcome: React.FC = () => {
  return (
    <Box borderStyle="round" borderColor="cyan" padding={1}>
      <Box flexDirection="column">
        <Text color="cyan" bold>
          🚀 Welcome to ExplorBot!
        </Text>
        <Text color="white">
          A powerful CLI tool built with React Ink, CodeceptJS, and Playwright
        </Text>
        <Box marginTop={1}>
          <Text color="gray">
            Ready to explore and automate your testing workflows.
          </Text>
        </Box>
      </Box>
    </Box>
  );
};

export default Welcome;

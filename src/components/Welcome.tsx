import React from 'react';
import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { ConfigParser } from '../config.js';

interface ConfigInfo {
  aiProvider: string;
  playwrightUrl: string;
  loaded: boolean;
  error?: string;
}

const Welcome: React.FC = () => {
  const [configInfo, setConfigInfo] = useState<ConfigInfo>({
    aiProvider: '',
    playwrightUrl: '',
    loaded: false,
  });

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const configParser = ConfigParser.getInstance();
        const loadedConfig = await configParser.loadConfig();

        let aiProviderName = 'Not configured';
        if (loadedConfig.ai?.provider) {
          const provider = loadedConfig.ai.provider;

          const testModel = provider('test-model');
          aiProviderName = testModel?.constructor?.name || testModel?.config?.provider;
        }

        setConfigInfo({
          aiProvider: aiProviderName,
          playwrightUrl: loadedConfig.playwright?.url || 'Not configured',
          loaded: true,
        });
      } catch (error) {
        setConfigInfo({
          aiProvider: '',
          playwrightUrl: '',
          loaded: true,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    };

    loadConfig();
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} alignItems="center">
        <Text color="yellow" bold>
          🧐 Let's do some exploratory testing!
        </Text>
      </Box>
      {configInfo.loaded && !configInfo.error && (
        <Box flexDirection="row" marginTop={1}>
          <Box marginRight={2}>
            <Text color="gray" bold>
              [Config]
            </Text>
          </Box>

          <Box marginRight={2}>
            <Text color="gray">AI: </Text>
            <Text color="cyan" bold>
              {configInfo.aiProvider}
            </Text>
          </Box>
          <Box>
            <Text color="gray">URL: </Text>
            <Text color="cyan" bold>
              {configInfo.playwrightUrl}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default Welcome;

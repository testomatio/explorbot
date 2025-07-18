import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { ConfigParser } from '../config.js';
import Welcome from './Welcome.js';

interface AppProps {
  verbose?: boolean;
  config?: string;
}

interface ConfigInfo {
  aiProvider: string;
  playwrightUrl: string;
  loaded: boolean;
  error?: string;
}

const App: React.FC<AppProps> = ({ verbose, config }) => {
  const [configInfo, setConfigInfo] = useState<ConfigInfo>({
    aiProvider: '',
    playwrightUrl: '',
    loaded: false,
  });

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const configParser = ConfigParser.getInstance();
        const loadedConfig = await configParser.loadConfig(config);

        // Extract AI provider name
        let aiProviderName = 'Not configured';
        if (loadedConfig.ai?.provider) {
          const provider = loadedConfig.ai.provider;

          // Try different ways to get the provider name
          if (typeof provider === 'function') {
            // For AI SDK providers, we need to check different properties
            // Check if this is a groq provider by looking at its properties or toString
            const providerString = provider.toString();
            const funcName = provider.name || '';

            // Try to create a test model to see the provider details
            try {
              const testModel = provider('test-model');
              const modelConstructor = testModel?.constructor?.name || '';
              const modelProvider = testModel?.config?.provider || '';

              if (
                modelConstructor.includes('Groq') ||
                modelProvider.includes('groq')
              ) {
                aiProviderName = 'groq';
              } else if (
                modelConstructor.includes('OpenAI') ||
                modelProvider.includes('openai')
              ) {
                aiProviderName = 'openai';
              } else if (
                modelConstructor.includes('Anthropic') ||
                modelProvider.includes('anthropic')
              ) {
                aiProviderName = 'anthropic';
              } else if (
                modelConstructor.includes('Bedrock') ||
                modelProvider.includes('bedrock')
              ) {
                aiProviderName = 'bedrock';
              } else if (testModel?.baseURL?.includes('groq')) {
                aiProviderName = 'groq';
              } else if (testModel?.baseURL?.includes('openai')) {
                aiProviderName = 'openai';
              } else if (testModel?.baseURL?.includes('anthropic')) {
                aiProviderName = 'anthropic';
              } else if (testModel?.baseURL?.includes('bedrock')) {
                aiProviderName = 'bedrock';
              } else if (
                providerString.includes('groq') ||
                providerString.includes('GROQ')
              ) {
                aiProviderName = 'groq';
              } else if (
                providerString.includes('openai') ||
                providerString.includes('OpenAI')
              ) {
                aiProviderName = 'openai';
              } else if (
                providerString.includes('anthropic') ||
                providerString.includes('Anthropic')
              ) {
                aiProviderName = 'anthropic';
              } else if (
                providerString.includes('bedrock') ||
                providerString.includes('Bedrock')
              ) {
                aiProviderName = 'bedrock';
              } else {
                aiProviderName = funcName || 'Custom Function Provider';
              }
            } catch (error) {
              // Fallback to string analysis
              if (
                providerString.includes('groq') ||
                providerString.includes('GROQ')
              ) {
                aiProviderName = 'groq';
              } else if (
                providerString.includes('openai') ||
                providerString.includes('OpenAI')
              ) {
                aiProviderName = 'openai';
              } else if (
                providerString.includes('anthropic') ||
                providerString.includes('Anthropic')
              ) {
                aiProviderName = 'anthropic';
              } else if (
                providerString.includes('bedrock') ||
                providerString.includes('Bedrock')
              ) {
                aiProviderName = 'bedrock';
              } else {
                aiProviderName = funcName || 'Custom Function Provider';
              }
            }
          } else if (typeof provider === 'object' && provider !== null) {
            // Check for common AI provider properties and constructor names
            const constructorName =
              provider.constructor?.name?.toLowerCase() || '';

            if (
              constructorName.includes('groq') ||
              provider.baseURL?.includes('groq')
            ) {
              aiProviderName = 'groq';
            } else if (
              constructorName.includes('openai') ||
              provider.baseURL?.includes('openai')
            ) {
              aiProviderName = 'openai';
            } else if (
              constructorName.includes('anthropic') ||
              provider.baseURL?.includes('anthropic')
            ) {
              aiProviderName = 'anthropic';
            } else if (
              constructorName.includes('bedrock') ||
              provider.baseURL?.includes('bedrock')
            ) {
              aiProviderName = 'bedrock';
            } else if (provider.chat) {
              aiProviderName = 'AI Provider (with chat method)';
            } else {
              aiProviderName =
                provider.constructor?.name || 'Custom Object Provider';
            }
          } else if (typeof provider === 'string') {
            aiProviderName = provider;
          } else {
            aiProviderName = 'Unknown Provider Type';
          }
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
  }, [config]);

  return (
    <Box flexDirection="column" padding={1}>
      <Welcome />

      {configInfo.loaded && !configInfo.error && (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color="green">🤖 AI Provider: </Text>
            <Text color="cyan" bold>
              {configInfo.aiProvider}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color="green">🌐 Playwright URL: </Text>
            <Text color="cyan" bold>
              {configInfo.playwrightUrl}
            </Text>
          </Box>
        </Box>
      )}

      {configInfo.error && (
        <Box marginTop={1}>
          <Text color="red">❌ Config Error: {configInfo.error}</Text>
        </Box>
      )}

      {verbose && (
        <Box marginTop={1}>
          <Text color="gray">Verbose mode enabled</Text>
        </Box>
      )}

      {config && (
        <Box marginTop={1}>
          <Text color="gray">Using config: {config}</Text>
        </Box>
      )}
    </Box>
  );
};

export default App;

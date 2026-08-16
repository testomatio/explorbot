import figureSet from 'figures';
import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';
import { AIProvider } from '../ai/provider.js';
import { writeGlobalConfig } from '../commands/init-command.js';
import { ConfigParser, PROVIDERS, createModel } from '../config.js';
import { globalDir } from '../global-config.js';
import InputReadline from './InputReadline.js';

const PROVIDER_NAMES = Object.keys(PROVIDERS);

interface InitWizardProps {
  mode: 'choose' | 'global';
  globalConfigExists: boolean;
  onLocal: () => void;
  onComplete: () => void;
  onCancel: () => void;
}

const InitWizard: React.FC<InitWizardProps> = ({ mode, globalConfigExists, onLocal, onComplete, onCancel }) => {
  const [step, setStep] = useState<'target' | 'provider' | 'key' | 'validate'>(mode === 'choose' ? 'target' : 'provider');
  const [targetIndex, setTargetIndex] = useState(0);
  const [providerIndex, setProviderIndex] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const provider = PROVIDER_NAMES[providerIndex];
  const envKey = PROVIDERS[provider].envKey;

  const save = () => {
    writeGlobalConfig(provider, apiKey.trim());
    onComplete();
  };

  const validate = async () => {
    const modelId = defaultModelId(provider);
    if (!modelId) {
      save();
      return;
    }

    setStatus(`Sending a test request to ${provider}...`);
    setError('');
    if (apiKey.trim()) process.env[envKey] = apiKey.trim();

    try {
      const model = await createModel(provider, modelId);
      await new AIProvider({ model }).validateConnection();
      save();
    } catch (err) {
      setStatus('');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onCancel();
      return;
    }

    if (step === 'key') return;

    if (key.escape) {
      onCancel();
      return;
    }

    if (step === 'target') {
      if (key.upArrow) setTargetIndex(0);
      if (key.downArrow && !globalConfigExists) setTargetIndex(1);
      if (key.return && targetIndex === 0) onLocal();
      if (key.return && targetIndex === 1) setStep('provider');
      return;
    }

    if (step === 'provider') {
      if (key.upArrow) setProviderIndex((index) => Math.max(0, index - 1));
      if (key.downArrow) setProviderIndex((index) => Math.min(PROVIDER_NAMES.length - 1, index + 1));
      if (key.return) setStep('key');
      return;
    }

    if (status) return;

    if (input.toLowerCase() === 'y') void validate();
    if (input.toLowerCase() === 'n') save();
    if (input.toLowerCase() === 'r') {
      setError('');
      setStep('key');
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Explorbot setup
        </Text>
      </Box>

      {step === 'target' && (
        <Box flexDirection="column">
          <Text>Where should explorbot be initialized?</Text>
          <Text color={targetIndex === 0 ? 'blue' : undefined}>
            {targetIndex === 0 ? `${figureSet.pointer} ` : '  '}Local <Text dimColor>— creates the config file in the current directory</Text>
          </Text>
          <Text color={targetIndex === 1 ? 'blue' : undefined} dimColor={globalConfigExists}>
            {targetIndex === 1 ? `${figureSet.pointer} ` : '  '}Global <Text dimColor>— initializes explorbot to run from anywhere on this machine</Text>
            {globalConfigExists && <Text dimColor> (already installed)</Text>}
          </Text>
        </Box>
      )}

      {step === 'provider' && (
        <Box flexDirection="column">
          <Text>Pick an AI provider:</Text>
          {PROVIDER_NAMES.map((name, index) => (
            <Text key={name} color={index === providerIndex ? 'blue' : undefined}>
              {index === providerIndex ? `${figureSet.pointer} ` : '  '}
              {name}
            </Text>
          ))}
        </Box>
      )}

      {step === 'key' && (
        <Box flexDirection="column">
          <Text>
            Enter the API key for {provider} <Text dimColor>(stored as {envKey})</Text>
          </Text>
          <Box borderStyle="single" borderColor="blue" paddingX={1}>
            <InputReadline value={apiKey} onChange={setApiKey} onSubmit={() => setStep('validate')} placeholder={process.env[envKey] ? 'leave empty to keep the key from your environment' : 'paste the key'} isActive showPrompt={false} mask />
          </Box>
        </Box>
      )}

      {step === 'validate' && (
        <Box flexDirection="column">
          {!status && !error && <Text>Check the key with a test AI call? (y/n)</Text>}
          {status && <Text color="yellow">{status}</Text>}
          {error && (
            <Box flexDirection="column">
              <Text color="red">{error}</Text>
              <Text dimColor>r: re-enter the key | n: save anyway</Text>
            </Box>
          )}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          Config goes to {globalDir()} | {step === 'key' ? 'Enter: continue' : '↑↓: select | Enter: confirm'} | Ctrl+C: exit
        </Text>
      </Box>
    </Box>
  );
};

function defaultModelId(provider: string): string {
  const recommended = ConfigParser.recommendedModels()[provider] || {};
  return recommended.model || recommended.agenticModel || recommended.visionModel || '';
}

export default InitWizard;

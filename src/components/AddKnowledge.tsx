import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { KnowledgeTracker } from '../knowledge-tracker.js';

interface AddKnowledgeProps {
  customPath?: string;
}

const AddKnowledge: React.FC<AddKnowledgeProps> = ({ customPath }) => {
  const [urlPattern, setUrlPattern] = useState('');
  const [description, setDescription] = useState('');
  const [activeField, setActiveField] = useState<'url' | 'description'>('url');
  const [suggestedUrls, setSuggestedUrls] = useState<string[]>([]);

  useEffect(() => {
    try {
      const knowledgeTracker = new KnowledgeTracker();
      const urls = knowledgeTracker.getExistingUrls();
      setSuggestedUrls(urls);
    } catch (error) {
      console.error('Failed to load suggestions:', error);
    }
  }, []);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      process.exit(0);
    }

    if (key.tab) {
      if (activeField === 'url' && urlPattern.trim()) {
        setActiveField('description');
      } else if (activeField === 'description') {
        setActiveField('url');
      }
      return;
    }

    if (key.return) {
      if (activeField === 'url' && urlPattern.trim()) {
        setActiveField('description');
      } else if (activeField === 'description' && description.trim()) {
        handleSave();
      }
      return;
    }
  });

  const handleSave = () => {
    if (!urlPattern.trim() || !description.trim()) {
      return;
    }

    try {
      const knowledgeTracker = new KnowledgeTracker();
      knowledgeTracker.addKnowledge(urlPattern.trim(), description.trim(), customPath);
      console.log(`\n✅ Knowledge saved successfully`);
      process.exit(0);
    } catch (error) {
      console.error(`\n❌ Failed to save knowledge: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  };

  const handleUrlSubmit = (value: string) => {
    setUrlPattern(value);
    if (value.trim()) {
      setActiveField('description');
    }
  };

  const handleDescriptionSubmit = (value: string) => {
    setDescription(value);
    if (value.trim()) {
      handleSave();
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          📚 Add Knowledge
        </Text>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Box marginBottom={1}>
          <Text color="blue">URL Pattern:</Text>
        </Box>
        <Box borderStyle="single" borderColor={activeField === 'url' ? 'blue' : 'gray'} padding={1}>
          <TextInput
            value={urlPattern}
            onChange={setUrlPattern}
            onSubmit={handleUrlSubmit}
            placeholder={suggestedUrls.length > 0 ? suggestedUrls[0] : 'e.g., /login, *, ^/admin, ~dashboard'}
            focus={activeField === 'url'}
          />
        </Box>
        <Text color="gray" dimColor>
          Wildcards (*) or regexes (^pattern, ~pattern) can be used
        </Text>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Box marginBottom={1}>
          <Text color={activeField === 'description' ? 'blue' : 'gray'}>Description:</Text>
        </Box>
        <Box borderStyle="single" borderColor={activeField === 'description' ? 'blue' : 'gray'} padding={1}>
          <TextInput
            value={description}
            onChange={setDescription}
            onSubmit={handleDescriptionSubmit}
            placeholder="Describe actions, locators, or page behavior..."
            focus={activeField === 'description'}
          />
        </Box>
        <Text color="gray" dimColor>
          Actions that should or should not be used, locators, validation rules, etc.
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          Tab: Switch fields | Enter: Next/Save | Ctrl+C: Exit
        </Text>
      </Box>
    </Box>
  );
};

export default AddKnowledge;

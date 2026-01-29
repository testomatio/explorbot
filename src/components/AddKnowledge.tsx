import { Box, Text, useInput } from 'ink';
import React, { useEffect, useState } from 'react';
import { KnowledgeTracker } from '../knowledge-tracker.js';
import InputReadline from './InputReadline.js';

interface AddKnowledgeProps {
  initialUrl?: string;
  onComplete?: () => void;
  onCancel?: () => void;
}

const AddKnowledge: React.FC<AddKnowledgeProps> = ({ initialUrl = '', onComplete, onCancel }) => {
  const [urlPattern, setUrlPattern] = useState(initialUrl);
  const [description, setDescription] = useState('');
  const [activeField, setActiveField] = useState<'url' | 'description'>(initialUrl ? 'description' : 'url');
  const [suggestedUrls, setSuggestedUrls] = useState<string[]>([]);
  const [existingKnowledge, setExistingKnowledge] = useState<string[]>([]);

  const isStandalone = !onComplete;

  useEffect(() => {
    try {
      const knowledgeTracker = new KnowledgeTracker();
      const urls = knowledgeTracker.getExistingUrls();
      setSuggestedUrls(urls);
    } catch (error) {
      console.error('Failed to load suggestions:', error);
    }
  }, []);

  useEffect(() => {
    if (urlPattern.trim()) {
      try {
        const knowledgeTracker = new KnowledgeTracker();
        const knowledge = knowledgeTracker.getKnowledgeForUrl(urlPattern);
        setExistingKnowledge(knowledge);
      } catch (error) {
        console.error('Failed to load existing knowledge:', error);
        setExistingKnowledge([]);
      }
    } else {
      setExistingKnowledge([]);
    }
  }, [urlPattern]);

  const handleSave = () => {
    if (!urlPattern.trim() || !description.trim()) {
      return;
    }

    try {
      const knowledgeTracker = new KnowledgeTracker();
      const result = knowledgeTracker.addKnowledge(urlPattern.trim(), description.trim());
      const action = result.isNewFile ? 'Created' : 'Updated';
      console.log(`\nKnowledge ${action} in: ${result.filename}`);

      if (isStandalone) {
        process.exit(0);
      } else {
        onComplete?.();
      }
    } catch (error) {
      console.error(`\nFailed to save knowledge: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (isStandalone) {
        process.exit(1);
      }
    }
  };

  const handleUrlSubmit = () => {
    if (urlPattern.trim()) {
      setActiveField('description');
    }
  };

  const handleDescriptionSubmit = () => {
    if (description.trim()) {
      handleSave();
    }
  };

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (isStandalone) {
        process.exit(0);
      } else {
        onCancel?.();
      }
    }

    if (key.escape) {
      if (!isStandalone) {
        onCancel?.();
      }
    }

    if (key.tab) {
      if (activeField === 'url' && urlPattern.trim()) {
        setActiveField('description');
      } else if (activeField === 'description') {
        setActiveField('url');
      }
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Add Knowledge
        </Text>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Box marginBottom={1}>
          <Text color={activeField === 'url' ? 'blue' : 'gray'}>URL Pattern:</Text>
        </Box>
        <Box borderStyle="single" borderColor={activeField === 'url' ? 'blue' : 'gray'} paddingX={1}>
          <InputReadline value={urlPattern} onChange={setUrlPattern} onSubmit={handleUrlSubmit} placeholder={suggestedUrls.length > 0 ? suggestedUrls[0] : '/login, *, ^/admin'} isActive={activeField === 'url'} showPrompt={false} />
        </Box>
        <Text color="gray" dimColor>
          Wildcards (*) or regexes (^pattern, ~pattern)
        </Text>
      </Box>

      {existingKnowledge.length > 0 && (
        <Box marginBottom={1} flexDirection="column">
          <Box marginBottom={1}>
            <Text color="yellow" bold>
              Existing Knowledge:
            </Text>
          </Box>
          <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
            {existingKnowledge.map((knowledge, index) => (
              <Box key={index} flexDirection="column" marginBottom={index < existingKnowledge.length - 1 ? 1 : 0}>
                <Text color="gray">{knowledge}</Text>
                {index < existingKnowledge.length - 1 && (
                  <Text color="gray" dimColor>
                    ---
                  </Text>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      <Box marginBottom={1} flexDirection="column">
        <Box marginBottom={1}>
          <Text color={activeField === 'description' ? 'blue' : 'gray'}>Description:</Text>
        </Box>
        <Box borderStyle="single" borderColor={activeField === 'description' ? 'blue' : 'gray'} paddingX={1}>
          <InputReadline value={description} onChange={setDescription} onSubmit={handleDescriptionSubmit} placeholder="Describe actions, locators, or page behavior..." isActive={activeField === 'description'} showPrompt={false} />
        </Box>
        <Text color="gray" dimColor>
          Actions, locators, validation rules
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          Tab: Switch | Enter: Next/Save | {isStandalone ? 'Ctrl+C' : 'Esc'}: Exit
        </Text>
      </Box>
    </Box>
  );
};

export default AddKnowledge;

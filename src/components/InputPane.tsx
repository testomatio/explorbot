import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';

interface InputPaneProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  suggestions?: string[];
}

interface SuggestionItem {
  label: string;
  value: string;
}

const InputPane: React.FC<InputPaneProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder,
  suggestions = [],
}) => {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="green">&gt; </Text>
        <TextInput
          suggestions={suggestions}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
        />
      </Box>
    </Box>
  );
};

export default InputPane;

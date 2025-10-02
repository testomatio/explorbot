import { Box, Text } from 'ink';
import React from 'react';
import { useEffect, useState } from 'react';

interface AutocompletePaneProps {
  commands: string[];
  input: string;
  selectedIndex: number;
  onSelect: (index: number) => void;
  visible: boolean;
}

const AutocompletePane: React.FC<AutocompletePaneProps> = ({ commands, input, selectedIndex, onSelect, visible }) => {
  const [filteredCommands, setFilteredCommands] = useState<string[]>([]);

  useEffect(() => {
    if (!input.trim()) {
      setFilteredCommands(commands.slice(0, 20));
      return;
    }

    const searchTerm = input.toLowerCase().replace(/^i\./, '');
    const filtered = commands.filter((cmd) => cmd.toLowerCase().includes(searchTerm)).slice(0, 20);

    setFilteredCommands(filtered);
  }, [input, commands]);

  if (!visible || filteredCommands.length === 0) {
    return null;
  }

  const effectiveSelectedIndex = Math.min(selectedIndex, filteredCommands.length - 1);

  return (
    <Box flexDirection="row" flexWrap="wrap" marginTop={1}>
      {filteredCommands.map((cmd, index) => {
        const isSelected = index === effectiveSelectedIndex;
        const display = cmd.length > 24 ? `${cmd.slice(0, 21)}...` : cmd;

        return (
          <Box key={cmd} marginRight={2} marginBottom={1}>
            <Text color={isSelected ? 'black' : 'cyan'} backgroundColor={isSelected ? 'cyan' : undefined}>
              {` ${display} `}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};

export default AutocompletePane;

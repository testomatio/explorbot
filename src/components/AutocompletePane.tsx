import React from 'react';
import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

interface AutocompletePaneProps {
  commands: string[];
  input: string;
  selectedIndex: number;
  onSelect: (index: number) => void;
  visible: boolean;
}

const AutocompletePane: React.FC<AutocompletePaneProps> = ({
  commands,
  input,
  selectedIndex,
  onSelect,
  visible,
}) => {
  const [filteredCommands, setFilteredCommands] = useState<string[]>([]);

  useEffect(() => {
    if (!input.trim()) {
      setFilteredCommands(commands.slice(0, 20));
      return;
    }

    const searchTerm = input.toLowerCase().replace(/^i\./, '');
    const filtered = commands
      .filter((cmd) => cmd.toLowerCase().includes(searchTerm))
      .slice(0, 20);

    setFilteredCommands(filtered);
  }, [input, commands]);

  if (!visible || filteredCommands.length === 0) {
    return null;
  }

  const chunked: string[][] = [];
  for (let i = 0; i < filteredCommands.length; i += 5) {
    chunked.push(filteredCommands.slice(i, i + 5));
  }

  while (chunked.length < 4) {
    chunked.push([]);
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {[0, 1, 2, 3, 4].map((rowIndex) => (
        <Box key={rowIndex} flexDirection="row">
          {chunked.map((column, colIndex) => {
            const cmd = column[rowIndex];
            const globalIndex = colIndex * 5 + rowIndex;
            const isSelected = globalIndex === selectedIndex;

            return (
              <Box key={colIndex} width={20} marginRight={1}>
                {cmd && (
                  <Text
                    color={isSelected ? 'black' : 'cyan'}
                    backgroundColor={isSelected ? 'cyan' : undefined}
                  >
                    {cmd.length > 18 ? `${cmd.slice(0, 15)}...` : cmd}
                  </Text>
                )}
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
};

export default AutocompletePane;

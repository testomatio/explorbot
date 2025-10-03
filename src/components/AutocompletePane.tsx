import { Box, Text } from 'ink';
import React, { useMemo } from 'react';

interface AutocompletePaneProps {
  commands: string[];
  input: string;
  selectedIndex: number;
  onSelect: (index: number) => void;
  visible: boolean;
}

const DEFAULT_COMMANDS = ['/explore', '/navigate', '/plan', '/research', 'exit'];

const AutocompletePane: React.FC<AutocompletePaneProps> = ({ commands, input, selectedIndex, onSelect, visible }) => {
  const filteredCommands = useMemo(() => {
    const normalizedInput = input.trim();
    const effectiveInput = normalizedInput === '/' ? '' : normalizedInput;
    if (!effectiveInput) {
      const prioritized = DEFAULT_COMMANDS.filter((cmd) => cmd === 'exit' || commands.includes(cmd));
      const rest = commands.filter((cmd) => !prioritized.includes(cmd) && cmd !== 'exit');
      const ordered = [...prioritized, ...rest];
      return ordered.filter((cmd, index) => ordered.indexOf(cmd) === index).slice(0, 20);
    }

    const searchTerm = effectiveInput.toLowerCase().replace(/^i\./, '');
    return commands.filter((cmd) => cmd.toLowerCase().includes(searchTerm)).slice(0, 20);
  }, [commands, input]);

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

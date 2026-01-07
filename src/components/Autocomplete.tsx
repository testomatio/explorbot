import { Box, Text } from 'ink';
import React from 'react';
import { useAutocompleteState } from './autocomplete-store.js';

const Autocomplete: React.FC = () => {
  const { commands, selectedIndex, visible } = useAutocompleteState();

  if (!visible) {
    return null;
  }

  if (commands.length === 0) {
    return null;
  }

  const effectiveSelectedIndex = Math.min(selectedIndex, commands.length - 1);
  const maxHeight = 7;
  const rowsPerColumn = Math.min(Math.max(1, maxHeight - 2), commands.length);
  const columns: string[][] = [];
  for (let i = 0; i < commands.length; i += rowsPerColumn) {
    columns.push(commands.slice(i, i + rowsPerColumn));
  }

  return (
    <Box position="absolute" top={0} left={0} width="100%" maxHeight={maxHeight} overflow="hidden" paddingX={1} paddingY={1} backgroundColor="#2a2a2a" flexDirection="row" columnGap={2}>
      {columns.map((column, columnIndex) => (
        <Box key={columnIndex} flexDirection="column">
          {column.map((cmd, rowIndex) => {
            const index = columnIndex * rowsPerColumn + rowIndex;
            const isSelected = index === effectiveSelectedIndex;
            let display = cmd;
            if (cmd.length > 24) {
              display = `${cmd.slice(0, 21)}...`;
            }
            let color = 'white';
            let backgroundColor = '#2a2a2a';
            if (isSelected) {
              color = 'black';
              backgroundColor = '#e6e6e6';
            }

            return (
              <Box key={cmd} marginBottom={1}>
                <Text color={color} backgroundColor={backgroundColor}>
                  {' '}
                  {display}{' '}
                </Text>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
};

export default Autocomplete;

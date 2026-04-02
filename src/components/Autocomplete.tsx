import { Box, Text } from 'ink';
import React from 'react';
import { useAutocompleteState } from './autocomplete-store.js';

const Autocomplete: React.FC = () => {
  const { suggestions, selectedIndex, visible, argumentHint } = useAutocompleteState();

  if (!visible) {
    if (!argumentHint) {
      return null;
    }
  }

  if (!suggestions.length) {
    return (
      <Box position="absolute" top={0} left={0} width="100%" paddingX={1}>
        <Text dimColor>{argumentHint}</Text>
      </Box>
    );
  }

  const effectiveSelectedIndex = Math.min(selectedIndex, suggestions.length - 1);
  const maxHeight = 7;
  const rowsPerColumn = Math.min(Math.max(1, maxHeight - 2), suggestions.length);
  const columns: (typeof suggestions)[] = [];
  for (let index = 0; index < suggestions.length; index += rowsPerColumn) {
    columns.push(suggestions.slice(index, index + rowsPerColumn));
  }

  return (
    <Box position="absolute" top={0} left={0} width="100%" maxHeight={maxHeight} overflow="hidden" paddingX={1} paddingY={1} backgroundColor="#2a2a2a" flexDirection="row" columnGap={2}>
      {columns.map((column, columnIndex) => (
        <Box key={columnIndex} flexDirection="column">
          {column.map((suggestion, rowIndex) => {
            const index = columnIndex * rowsPerColumn + rowIndex;
            const isSelected = index === effectiveSelectedIndex;
            let display = suggestion.display;
            if (display.length > 24) {
              display = `${display.slice(0, 21)}...`;
            }
            let color = 'white';
            let backgroundColor = '#2a2a2a';
            if (isSelected) {
              color = 'black';
              backgroundColor = '#e6e6e6';
            }

            return (
              <Box key={suggestion.display} marginBottom={1}>
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

import { Box, Text, useStdout } from 'ink';
import React from 'react';
import { truncate } from '../utils/strings.js';
import { useAutocompleteState } from './autocomplete-store.js';

const MAX_HEIGHT = 7;
const COLUMN_WIDTH = 24;

const Autocomplete: React.FC = () => {
  const { suggestions, selectedIndex, visible, argumentHint } = useAutocompleteState();
  const { stdout } = useStdout();

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
  const rowsPerColumn = Math.min(Math.max(1, MAX_HEIGHT - 2), suggestions.length);
  const widest = Math.max(...suggestions.map((suggestion) => suggestion.display.length));

  if (widest > COLUMN_WIDTH) {
    const width = Math.max(COLUMN_WIDTH, (stdout?.columns || 80) - 4);
    let firstRow = 0;
    if (effectiveSelectedIndex >= rowsPerColumn) {
      firstRow = effectiveSelectedIndex - rowsPerColumn + 1;
    }

    return (
      <Box position="absolute" top={0} left={0} width="100%" maxHeight={MAX_HEIGHT} overflow="hidden" paddingX={1} paddingY={1} backgroundColor="#2a2a2a" flexDirection="column">
        {suggestions.slice(firstRow, firstRow + rowsPerColumn).map((suggestion, rowIndex) => {
          const isSelected = firstRow + rowIndex === effectiveSelectedIndex;
          let color = 'white';
          let backgroundColor = '#2a2a2a';
          if (isSelected) {
            color = 'black';
            backgroundColor = '#e6e6e6';
          }

          return (
            <Text key={suggestion.value} color={color} backgroundColor={backgroundColor}>
              {` ${truncate(suggestion.display, width).padEnd(width)} `}
            </Text>
          );
        })}
      </Box>
    );
  }

  const columns: (typeof suggestions)[] = [];
  for (let index = 0; index < suggestions.length; index += rowsPerColumn) {
    columns.push(suggestions.slice(index, index + rowsPerColumn));
  }

  return (
    <Box position="absolute" top={0} left={0} width="100%" maxHeight={MAX_HEIGHT} overflow="hidden" paddingX={1} paddingY={1} backgroundColor="#2a2a2a" flexDirection="row" columnGap={2}>
      {columns.map((column, columnIndex) => (
        <Box key={columnIndex} flexDirection="column">
          {column.map((suggestion, rowIndex) => {
            const index = columnIndex * rowsPerColumn + rowIndex;
            const isSelected = index === effectiveSelectedIndex;
            let color = 'white';
            let backgroundColor = '#2a2a2a';
            if (isSelected) {
              color = 'black';
              backgroundColor = '#e6e6e6';
            }

            return (
              <Box key={suggestion.display} marginBottom={1}>
                <Text color={color} backgroundColor={backgroundColor}>
                  {` ${suggestion.display} `}
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

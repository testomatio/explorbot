import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import React from 'react';
import { useEffect, useState } from 'react';

interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  suggestions: string[];
  showAutocomplete?: boolean;
}

const AutocompleteInput: React.FC<AutocompleteInputProps> = ({ value, onChange, onSubmit, placeholder, suggestions, showAutocomplete = true }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);
  const [autocompleteMode, setAutocompleteMode] = useState(false);
  const [internalValue, setInternalValue] = useState(value);
  const [inputKey, setInputKey] = useState(0);

  // Sync internal value with prop
  useEffect(() => {
    setInternalValue(value);
  }, [value]);

  // Filter suggestions based on input
  useEffect(() => {
    if (!showAutocomplete || !internalValue.trim()) {
      setFilteredSuggestions(suggestions.slice(0, 20));
      setSelectedIndex(0);
      return;
    }

    const searchTerm = internalValue.toLowerCase().replace(/^i\./, '');
    const filtered = suggestions.filter((cmd) => cmd.toLowerCase().includes(searchTerm)).slice(0, 20);

    setFilteredSuggestions(filtered);
    setSelectedIndex(0);
  }, [internalValue, suggestions, showAutocomplete]);

  // Handle internal value changes
  const handleInternalChange = (newValue: string) => {
    setInternalValue(newValue);
    onChange(newValue);
  };

  // Handle autocomplete completion
  const handleAutoCompleteSubmit = (inputValue: string) => {
    if (filteredSuggestions.length > 0) {
      const selected = filteredSuggestions[autocompleteMode ? selectedIndex : 0];
      if (selected) {
        const newValue = `I.${selected}`;
        console.log('Autocomplete: Setting value to:', newValue);
        setInternalValue(newValue);
        onChange(newValue);
        setAutocompleteMode(false);
        setInputKey((prev) => prev + 1);
        return;
      }
    }
    onSubmit(inputValue);
  };

  // Handle navigation and TAB keys with higher priority
  useInput((input, key) => {
    // Handle TAB key first with highest priority
    if (key.tab && autocompleteMode && filteredSuggestions.length > 0) {
      const selected = filteredSuggestions[selectedIndex];
      if (selected) {
        const newValue = `I.${selected}`;
        console.log('TAB Autocomplete: Setting value to:', newValue);
        setInternalValue(newValue);
        onChange(newValue);
        setAutocompleteMode(false);
        setInputKey((prev) => prev + 1);
      }
      return;
    }

    if (!filteredSuggestions.length) return;

    if (key.downArrow && !autocompleteMode) {
      setAutocompleteMode(true);
      setSelectedIndex(0);
      return;
    }

    if (autocompleteMode) {
      if (key.upArrow) {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredSuggestions.length - 1));
        return;
      }

      if (key.downArrow) {
        setSelectedIndex((prev) => (prev + 1) % filteredSuggestions.length);
        return;
      }

      if (key.escape) {
        setAutocompleteMode(false);
        return;
      }
    }
  });

  const renderAutocomplete = () => {
    if (!showAutocomplete || filteredSuggestions.length === 0) {
      return null;
    }

    const chunked: string[][] = [];
    for (let i = 0; i < filteredSuggestions.length; i += 5) {
      chunked.push(filteredSuggestions.slice(i, i + 5));
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
              const isSelected = autocompleteMode && globalIndex === selectedIndex;
              const isFirstSuggestion = !autocompleteMode && globalIndex === 0;

              return (
                <Box key={colIndex} width={20} marginRight={1}>
                  {cmd && (
                    <Text color={isSelected ? 'black' : isFirstSuggestion ? 'yellow' : 'cyan'} backgroundColor={isSelected ? 'cyan' : undefined} dimColor={!isSelected && !isFirstSuggestion}>
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

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="green">&gt; </Text>
        <TextInput key={inputKey} value={internalValue} onChange={handleInternalChange} onSubmit={handleAutoCompleteSubmit} placeholder={placeholder} />
      </Box>
      {renderAutocomplete()}
      {filteredSuggestions.length > 0 && (
        <Text color="gray" dimColor>
          {autocompleteMode ? '↑↓ navigate, Tab/Enter to select, Esc to exit' : 'Enter for first match, ↓ to navigate'}
        </Text>
      )}
    </Box>
  );
};

export default AutocompleteInput;

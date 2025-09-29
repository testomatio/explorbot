import React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { CommandHandler } from '../command-handler.js';
import AutocompletePane from './AutocompletePane.js';

interface InputPaneProps {
  commandHandler: CommandHandler;
  exitOnEmptyInput?: boolean;
  onSubmit?: (value: string) => Promise<void>;
  onCommandStart?: () => void;
}

const InputPane: React.FC<InputPaneProps> = ({ commandHandler, exitOnEmptyInput = false, onSubmit, onCommandStart }) => {
  const [inputValue, setInputValue] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [autoCompleteTriggered, setAutoCompleteTriggered] = useState(false);

  const addLog = useCallback((entry: string) => {
    // For now, just console.log - in a real implementation this would integrate with the logger
    console.log(entry);
  }, []);

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmedValue = value.trim();

      if (!trimmedValue) {
        if (exitOnEmptyInput) {
          console.log('\nExiting...');
          process.exit(0);
        }
        return;
      }

      // Always call onCommandStart to hide input field
      onCommandStart?.();

      // Check if this is a command (starts with / or I.) or is 'exit'
      const isCommand = trimmedValue.startsWith('/') || trimmedValue.startsWith('I.') || trimmedValue === 'exit';

      if (isCommand) {
        // Execute as command directly
        try {
          await commandHandler.executeCommand(trimmedValue);
        } catch (error) {
          addLog(`Command failed: ${error}`);
        }
      } else if (onSubmit) {
        // Use the provided submit callback for non-commands
        await onSubmit(trimmedValue);
      }

      // Reset state after submission
      setInputValue('');
      setCursorPosition(0);
      setShowAutocomplete(false);
      setSelectedIndex(0);
    },
    [commandHandler, exitOnEmptyInput, onSubmit, onCommandStart, addLog]
  );

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      console.log('\n🛑 Received Ctrl-C, exiting...');
      process.exit(0);
      return;
    }

    if (key.return) {
      handleSubmit(inputValue);
      return;
    }

    if (key.ctrl && key.leftArrow) {
      setCursorPosition(Math.max(0, cursorPosition - 1));
      return;
    }

    if (key.ctrl && key.rightArrow) {
      setCursorPosition(Math.min(inputValue.length, cursorPosition + 1));
      return;
    }

    if (key.leftArrow) {
      setCursorPosition(Math.max(0, cursorPosition - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorPosition(Math.min(inputValue.length, cursorPosition + 1));
      return;
    }

    // Handle autocomplete navigation
    if (key.upArrow && showAutocomplete) {
      const filteredCommands = commandHandler.getFilteredCommands(inputValue);
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredCommands.length - 1));
      return;
    }

    if (key.downArrow && showAutocomplete) {
      const filteredCommands = commandHandler.getFilteredCommands(inputValue);
      setSelectedIndex((prev) => (prev < filteredCommands.length - 1 ? prev + 1 : 0));
      return;
    }

    if (key.tab) {
      const filteredCommands = commandHandler.getFilteredCommands(inputValue);
      if (selectedIndex < filteredCommands.length) {
        const selectedCommand = filteredCommands[selectedIndex];
        setInputValue(selectedCommand);
        setShowAutocomplete(false);
        setSelectedIndex(0);
        setCursorPosition(selectedCommand.length);
        setAutoCompleteTriggered(true);
      }
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorPosition > 0) {
        const newValue = inputValue.slice(0, cursorPosition - 1) + inputValue.slice(cursorPosition);
        setInputValue(newValue);
        setCursorPosition(Math.max(0, cursorPosition - 1));
        setSelectedIndex(0);
        setAutoCompleteTriggered(false);
        setShowAutocomplete(newValue.startsWith('/') || newValue.startsWith('I.') || newValue.startsWith('exit'));
      }
      return;
    }

    if (input && input.length === 1) {
      const newValue = inputValue.slice(0, cursorPosition) + input + inputValue.slice(cursorPosition);
      setInputValue(newValue);
      setCursorPosition(cursorPosition + 1);
      setSelectedIndex(0);
      setAutoCompleteTriggered(false);
      setShowAutocomplete(newValue.startsWith('/') || newValue.startsWith('I.') || newValue.startsWith('exit'));
    }
  });

  // Register with command handler on mount, unregister on unmount
  useEffect(() => {
    const unregister = commandHandler.registerInputPane(addLog, handleSubmit);
    commandHandler.setExitOnEmptyInput(exitOnEmptyInput);

    return unregister;
  }, [commandHandler, addLog, handleSubmit, exitOnEmptyInput]);

  const displayValue = inputValue || '';
  const beforeCursor = displayValue.slice(0, cursorPosition);
  const afterCursor = displayValue.slice(cursorPosition);

  const filteredCommands = commandHandler.getFilteredCommands(inputValue);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="green">&gt; </Text>
        <Text>{beforeCursor}</Text>
        <Text backgroundColor="white" color="black">
          {' '}
        </Text>
        <Text>{afterCursor}</Text>
      </Box>

      <AutocompletePane
        commands={filteredCommands}
        input={inputValue}
        selectedIndex={selectedIndex}
        onSelect={(index: number) => {
          if (index < filteredCommands.length) {
            const selectedCommand = filteredCommands[index];
            setInputValue(selectedCommand);
            setShowAutocomplete(false);
            setSelectedIndex(0);
            setCursorPosition(selectedCommand.length);
            setAutoCompleteTriggered(true);
          }
        }}
        visible={showAutocomplete}
      />
    </Box>
  );
};

export default InputPane;

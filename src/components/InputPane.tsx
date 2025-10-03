import { Box, Text, useInput } from 'ink';
import React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandHandler } from '../command-handler.js';
import AutocompletePane from './AutocompletePane.js';

interface InputPaneProps {
  commandHandler: CommandHandler;
  exitOnEmptyInput?: boolean;
  onSubmit?: (value: string) => Promise<void>;
  onCommandStart?: () => void;
  onCommandComplete?: () => void;
  isActive?: boolean;
  visible?: boolean;
}

const InputPane: React.FC<InputPaneProps> = ({ commandHandler, exitOnEmptyInput = false, onSubmit, onCommandStart, onCommandComplete, isActive = true, visible = true }) => {
  const [inputValue, setInputValue] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [autoCompleteTriggered, setAutoCompleteTriggered] = useState(false);
  const inputRef = useRef(inputValue);
  const cursorRef = useRef(cursorPosition);

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
      const isCommand = trimmedValue.startsWith('/') || trimmedValue.startsWith('I.') || trimmedValue === 'exit' || trimmedValue === 'quit';

      if (isCommand) {
        if (onSubmit) {
          await onSubmit(trimmedValue);
        }
        // Execute as command directly
        try {
          await commandHandler.executeCommand(trimmedValue);
        } catch (error) {
          addLog(`Command failed: ${error}`);
        } finally {
          onCommandComplete?.();
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
      inputRef.current = '';
      cursorRef.current = 0;
    },
    [commandHandler, exitOnEmptyInput, onSubmit, onCommandStart, onCommandComplete, addLog]
  );

  useEffect(() => {
    inputRef.current = inputValue;
  }, [inputValue]);

  useEffect(() => {
    cursorRef.current = cursorPosition;
  }, [cursorPosition]);

  const shouldShowAutocomplete = useCallback((value: string) => {
    if (!value) return false;
    if (value.startsWith('/')) return true;
    if (value.startsWith('I.')) return true;
    const lowered = value.toLowerCase();
    return 'exit'.startsWith(lowered);
  }, []);

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') {
        console.log('\n🛑 Received Ctrl-C, exiting...');
        process.exit(0);
        return;
      }

      if (key.return) {
        if (showAutocomplete) {
          const filteredCommands = commandHandler.getFilteredCommands(inputRef.current);
          const chosen = filteredCommands[selectedIndex] || filteredCommands[0];
          if (chosen) {
            inputRef.current = chosen;
            cursorRef.current = chosen.length;
            setInputValue(chosen);
            setCursorPosition(chosen.length);
            handleSubmit(chosen);
            return;
          }
        }
        handleSubmit(inputRef.current);
        return;
      }

      if (key.ctrl && key.leftArrow) {
        const nextCursor = Math.max(0, cursorRef.current - 1);
        cursorRef.current = nextCursor;
        setCursorPosition(nextCursor);
        return;
      }

      if (key.ctrl && key.rightArrow) {
        const nextCursor = Math.min(inputRef.current.length, cursorRef.current + 1);
        cursorRef.current = nextCursor;
        setCursorPosition(nextCursor);
        return;
      }

      if (key.leftArrow) {
        const nextCursor = Math.max(0, cursorRef.current - 1);
        cursorRef.current = nextCursor;
        setCursorPosition(nextCursor);
        return;
      }

      if (key.rightArrow) {
        const nextCursor = Math.min(inputRef.current.length, cursorRef.current + 1);
        cursorRef.current = nextCursor;
        setCursorPosition(nextCursor);
        return;
      }

      // Handle autocomplete navigation
      if (showAutocomplete && (key.upArrow || (key.shift && key.leftArrow))) {
        const filteredCommands = commandHandler.getFilteredCommands(inputRef.current);
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredCommands.length - 1));
        return;
      }

      if (showAutocomplete && (key.downArrow || (key.shift && key.rightArrow))) {
        const filteredCommands = commandHandler.getFilteredCommands(inputRef.current);
        setSelectedIndex((prev) => (prev < filteredCommands.length - 1 ? prev + 1 : 0));
        return;
      }

      if (key.tab) {
        const filteredCommands = commandHandler.getFilteredCommands(inputRef.current);
        if (selectedIndex < filteredCommands.length) {
          const selectedCommand = filteredCommands[selectedIndex];
          inputRef.current = selectedCommand;
          cursorRef.current = selectedCommand.length;
          setInputValue(selectedCommand);
          setShowAutocomplete(false);
          setSelectedIndex(0);
          setCursorPosition(selectedCommand.length);
          setAutoCompleteTriggered(true);
        }
        return;
      }

      if (key.backspace || key.delete) {
        if (cursorRef.current > 0) {
          const currentValue = inputRef.current;
          const currentCursor = cursorRef.current;
          const newValue = currentValue.slice(0, currentCursor - 1) + currentValue.slice(currentCursor);
          const nextCursor = Math.max(0, currentCursor - 1);
          inputRef.current = newValue;
          cursorRef.current = nextCursor;
          setInputValue(newValue);
          setCursorPosition(nextCursor);
          setSelectedIndex(0);
          setAutoCompleteTriggered(false);
          setShowAutocomplete(shouldShowAutocomplete(newValue));
        }
        return;
      }

      if (input && input.length === 1) {
        const currentValue = inputRef.current;
        const currentCursor = cursorRef.current;
        const newValue = currentValue.slice(0, currentCursor) + input + currentValue.slice(currentCursor);
        const nextCursor = currentCursor + 1;
        inputRef.current = newValue;
        cursorRef.current = nextCursor;
        setInputValue(newValue);
        setCursorPosition(nextCursor);
        setSelectedIndex(0);
        setAutoCompleteTriggered(false);
        setShowAutocomplete(shouldShowAutocomplete(newValue));
      }
    },
    { isActive }
  );

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

  if (!visible) {
    return null;
  }

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
            inputRef.current = selectedCommand;
            cursorRef.current = selectedCommand.length;
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

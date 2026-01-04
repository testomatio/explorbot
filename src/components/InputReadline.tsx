import { Box, Text, useInput } from 'ink';
import React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandHandler } from '../command-handler.js';
import AutocompletePane from './AutocompletePane.js';

interface InputReadlineProps {
  commandHandler: CommandHandler;
  exitOnEmptyInput?: boolean;
  onSubmit?: (value: string) => Promise<void>;
  onCommandStart?: () => void;
  onCommandComplete?: () => void;
  isActive?: boolean;
  visible?: boolean;
}

interface InputState {
  value: string;
  cursor: number;
  showAutocomplete: boolean;
  selectedIndex: number;
}

const initialInputState: InputState = {
  value: '',
  cursor: 0,
  showAutocomplete: false,
  selectedIndex: 0,
};

const InputReadline: React.FC<InputReadlineProps> = React.memo(({ commandHandler, exitOnEmptyInput = false, onSubmit, onCommandStart, onCommandComplete, isActive = true, visible = true }) => {
  const [inputState, setInputState] = useState<InputState>(initialInputState);
  const { value: inputValue, cursor: cursorPosition, showAutocomplete, selectedIndex } = inputState;
  const inputRef = useRef(inputValue);
  const cursorRef = useRef(cursorPosition);
  const showAutocompleteRef = useRef(showAutocomplete);
  const selectedIndexRef = useRef(selectedIndex);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const historyDraftRef = useRef('');
  const wasActiveRef = useRef(isActive);

  const onSubmitRef = useRef(onSubmit);
  const onCommandStartRef = useRef(onCommandStart);
  const onCommandCompleteRef = useRef(onCommandComplete);
  const exitOnEmptyInputRef = useRef(exitOnEmptyInput);

  useEffect(() => {
    onSubmitRef.current = onSubmit;
    onCommandStartRef.current = onCommandStart;
    onCommandCompleteRef.current = onCommandComplete;
    exitOnEmptyInputRef.current = exitOnEmptyInput;
  }, [onSubmit, onCommandStart, onCommandComplete, exitOnEmptyInput]);

  useEffect(() => {
    const wasInactive = !wasActiveRef.current;
    const isNowActive = isActive;
    wasActiveRef.current = isActive;

    if (wasInactive && isNowActive) {
      inputRef.current = '';
      cursorRef.current = 0;
      showAutocompleteRef.current = false;
      selectedIndexRef.current = 0;
      historyIndexRef.current = -1;
      historyDraftRef.current = '';
      setInputState(initialInputState);
    }
  }, [isActive]);

  const addLog = useCallback((entry: string) => {
    console.log(entry);
  }, []);

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmedValue = value.trim();

      if (!trimmedValue) {
        if (exitOnEmptyInputRef.current) {
          console.log('\nExiting...');
          process.exit(0);
        }
        return;
      }

      const history = historyRef.current;
      if (history[history.length - 1] !== trimmedValue) {
        history.push(trimmedValue);
      }
      historyIndexRef.current = -1;
      historyDraftRef.current = '';

      onCommandStartRef.current?.();

      if (onSubmitRef.current) {
        await onSubmitRef.current(trimmedValue);
      }
      try {
        await commandHandler.executeCommand(trimmedValue);
      } catch (error) {
        addLog(`Command failed: ${error}`);
      } finally {
        onCommandCompleteRef.current?.();
      }

      inputRef.current = '';
      cursorRef.current = 0;
      showAutocompleteRef.current = false;
      selectedIndexRef.current = 0;
      setInputState(initialInputState);
    },
    [commandHandler, addLog]
  );

  const shouldShowAutocomplete = useCallback((value: string) => {
    if (!value) return false;
    if (value.startsWith('/')) return true;
    if (value.startsWith('I.')) return true;
    return false;
  }, []);

  const insertText = useCallback(
    (text: string) => {
      const normalized = text.replace(/\x1b\[200~|\x1b\[201~/g, '').replace(/\r/g, '\n');
      if (!normalized) return;
      const currentValue = inputRef.current;
      const currentCursor = cursorRef.current;
      const newValue = currentValue.slice(0, currentCursor) + normalized + currentValue.slice(currentCursor);
      const nextCursor = currentCursor + normalized.length;
      const nextShowAutocomplete = shouldShowAutocomplete(newValue);
      inputRef.current = newValue;
      cursorRef.current = nextCursor;
      selectedIndexRef.current = 0;
      showAutocompleteRef.current = nextShowAutocomplete;
      historyIndexRef.current = -1;
      historyDraftRef.current = '';
      setInputState({
        value: newValue,
        cursor: nextCursor,
        selectedIndex: 0,
        showAutocomplete: nextShowAutocomplete,
      });
    },
    [shouldShowAutocomplete]
  );

  const handleInput = useCallback(
    (input: string, key: { [key: string]: boolean }) => {
      if (key.ctrl && input === 'c') {
        console.log('\n🛑 Received Ctrl-C, exiting...');
        process.exit(0);
        return;
      }

      if (key.escape) {
        return;
      }

      if (key.return) {
        if (key.shift) {
          insertText('\n');
          return;
        }
        if (showAutocompleteRef.current) {
          const filteredCommands = commandHandler.getFilteredCommands(inputRef.current);
          const chosen = filteredCommands[selectedIndexRef.current] || filteredCommands[0];
          if (chosen) {
            inputRef.current = chosen;
            cursorRef.current = chosen.length;
            setInputState((prev) => ({ ...prev, value: chosen, cursor: chosen.length }));
            handleSubmit(chosen);
            return;
          }
        }
        handleSubmit(inputRef.current);
        return;
      }

      const isWordChar = (value: string) => /[A-Za-z0-9_]/.test(value);

      if (key.ctrl && key.leftArrow) {
        const value = inputRef.current;
        let nextCursor = cursorRef.current;
        if (nextCursor === 0) return;
        nextCursor -= 1;
        while (nextCursor > 0 && !isWordChar(value[nextCursor])) {
          nextCursor -= 1;
        }
        while (nextCursor > 0 && isWordChar(value[nextCursor - 1])) {
          nextCursor -= 1;
        }
        cursorRef.current = nextCursor;
        setInputState((prev) => ({ ...prev, cursor: nextCursor }));
        return;
      }

      if (key.ctrl && key.rightArrow) {
        const value = inputRef.current;
        let nextCursor = cursorRef.current;
        if (nextCursor >= value.length) return;
        while (nextCursor < value.length && !isWordChar(value[nextCursor])) {
          nextCursor += 1;
        }
        while (nextCursor < value.length && isWordChar(value[nextCursor])) {
          nextCursor += 1;
        }
        cursorRef.current = nextCursor;
        setInputState((prev) => ({ ...prev, cursor: nextCursor }));
        return;
      }

      if (key.meta && input === 'b') {
        const value = inputRef.current;
        let nextCursor = cursorRef.current;
        if (nextCursor === 0) return;
        nextCursor -= 1;
        while (nextCursor > 0 && !isWordChar(value[nextCursor])) {
          nextCursor -= 1;
        }
        while (nextCursor > 0 && isWordChar(value[nextCursor - 1])) {
          nextCursor -= 1;
        }
        cursorRef.current = nextCursor;
        setInputState((prev) => ({ ...prev, cursor: nextCursor }));
        return;
      }

      if (key.meta && input === 'f') {
        const value = inputRef.current;
        let nextCursor = cursorRef.current;
        if (nextCursor >= value.length) return;
        while (nextCursor < value.length && !isWordChar(value[nextCursor])) {
          nextCursor += 1;
        }
        while (nextCursor < value.length && isWordChar(value[nextCursor])) {
          nextCursor += 1;
        }
        cursorRef.current = nextCursor;
        setInputState((prev) => ({ ...prev, cursor: nextCursor }));
        return;
      }

      if (key.ctrl && (input === 'b' || input === 'f')) {
        return;
      }

      if (key.meta && (input === 'b' || input === 'f')) {
        return;
      }

      if (key.leftArrow) {
        const nextCursor = Math.max(0, cursorRef.current - 1);
        cursorRef.current = nextCursor;
        setInputState((prev) => ({ ...prev, cursor: nextCursor }));
        return;
      }

      if (key.rightArrow) {
        const nextCursor = Math.min(inputRef.current.length, cursorRef.current + 1);
        cursorRef.current = nextCursor;
        setInputState((prev) => ({ ...prev, cursor: nextCursor }));
        return;
      }

      if (showAutocompleteRef.current && (key.upArrow || (key.shift && key.leftArrow))) {
        const filteredCommands = commandHandler.getFilteredCommands(inputRef.current);
        const nextIndex = selectedIndexRef.current > 0 ? selectedIndexRef.current - 1 : filteredCommands.length - 1;
        selectedIndexRef.current = nextIndex;
        setInputState((prev) => ({ ...prev, selectedIndex: nextIndex }));
        return;
      }

      if (showAutocompleteRef.current && (key.downArrow || (key.shift && key.rightArrow))) {
        const filteredCommands = commandHandler.getFilteredCommands(inputRef.current);
        const nextIndex = selectedIndexRef.current < filteredCommands.length - 1 ? selectedIndexRef.current + 1 : 0;
        selectedIndexRef.current = nextIndex;
        setInputState((prev) => ({ ...prev, selectedIndex: nextIndex }));
        return;
      }

      const hasNewlines = inputRef.current.includes('\n');

      if (key.upArrow && hasNewlines) {
        const value = inputRef.current;
        const currentCursor = cursorRef.current;
        const before = value.slice(0, currentCursor);
        const currentLineIndex = before.split('\n').length - 1;
        if (currentLineIndex === 0) return;
        const lineStart = before.lastIndexOf('\n') + 1;
        const column = currentCursor - lineStart;
        const prevLineStart = before.lastIndexOf('\n', lineStart - 2) + 1;
        const prevLineEnd = lineStart - 1;
        const prevLineLength = prevLineEnd - prevLineStart;
        const nextCursor = prevLineStart + Math.min(column, prevLineLength);
        cursorRef.current = nextCursor;
        setInputState((prev) => ({ ...prev, cursor: nextCursor }));
        return;
      }

      if (key.downArrow && hasNewlines) {
        const value = inputRef.current;
        const currentCursor = cursorRef.current;
        const before = value.slice(0, currentCursor);
        const currentLineIndex = before.split('\n').length - 1;
        const lines = value.split('\n');
        if (currentLineIndex >= lines.length - 1) return;
        const lineStart = before.lastIndexOf('\n') + 1;
        const column = currentCursor - lineStart;
        const nextLineStart = lineStart + lines[currentLineIndex].length + 1;
        const nextLineLength = lines[currentLineIndex + 1].length;
        const nextCursor = nextLineStart + Math.min(column, nextLineLength);
        cursorRef.current = nextCursor;
        setInputState((prev) => ({ ...prev, cursor: nextCursor }));
        return;
      }

      if (!showAutocompleteRef.current && key.upArrow) {
        const history = historyRef.current;
        if (history.length === 0) return;
        if (historyIndexRef.current === -1) {
          historyDraftRef.current = inputRef.current;
          historyIndexRef.current = history.length - 1;
        } else if (historyIndexRef.current > 0) {
          historyIndexRef.current -= 1;
        }
        const nextValue = history[historyIndexRef.current] || '';
        const nextShowAutocomplete = shouldShowAutocomplete(nextValue);
        inputRef.current = nextValue;
        cursorRef.current = nextValue.length;
        selectedIndexRef.current = 0;
        showAutocompleteRef.current = nextShowAutocomplete;
        setInputState({
          value: nextValue,
          cursor: nextValue.length,
          selectedIndex: 0,
          showAutocomplete: nextShowAutocomplete,
        });
        return;
      }

      if (!showAutocompleteRef.current && key.downArrow) {
        const history = historyRef.current;
        if (history.length === 0) return;
        if (historyIndexRef.current === -1) return;
        if (historyIndexRef.current >= history.length - 1) {
          historyIndexRef.current = -1;
          const nextValue = historyDraftRef.current || '';
          const nextShowAutocomplete = shouldShowAutocomplete(nextValue);
          inputRef.current = nextValue;
          cursorRef.current = nextValue.length;
          selectedIndexRef.current = 0;
          showAutocompleteRef.current = nextShowAutocomplete;
          setInputState({
            value: nextValue,
            cursor: nextValue.length,
            selectedIndex: 0,
            showAutocomplete: nextShowAutocomplete,
          });
          return;
        }
        historyIndexRef.current += 1;
        const nextValue = history[historyIndexRef.current] || '';
        const nextShowAutocomplete = shouldShowAutocomplete(nextValue);
        inputRef.current = nextValue;
        cursorRef.current = nextValue.length;
        selectedIndexRef.current = 0;
        showAutocompleteRef.current = nextShowAutocomplete;
        setInputState({
          value: nextValue,
          cursor: nextValue.length,
          selectedIndex: 0,
          showAutocomplete: nextShowAutocomplete,
        });
        return;
      }

      if (key.tab) {
        const filteredCommands = commandHandler.getFilteredCommands(inputRef.current);
        if (selectedIndexRef.current < filteredCommands.length) {
          const selectedCommand = filteredCommands[selectedIndexRef.current];
          inputRef.current = selectedCommand;
          cursorRef.current = selectedCommand.length;
          showAutocompleteRef.current = false;
          selectedIndexRef.current = 0;
          setInputState({
            value: selectedCommand,
            cursor: selectedCommand.length,
            showAutocomplete: false,
            selectedIndex: 0,
          });
        }
        return;
      }

      if (key.backspace || key.delete) {
        if (cursorRef.current > 0) {
          const currentValue = inputRef.current;
          const currentCursor = cursorRef.current;
          const newValue = currentValue.slice(0, currentCursor - 1) + currentValue.slice(currentCursor);
          const nextCursor = Math.max(0, currentCursor - 1);
          const nextShowAutocomplete = shouldShowAutocomplete(newValue);
          inputRef.current = newValue;
          cursorRef.current = nextCursor;
          selectedIndexRef.current = 0;
          showAutocompleteRef.current = nextShowAutocomplete;
          historyIndexRef.current = -1;
          historyDraftRef.current = '';
          setInputState({
            value: newValue,
            cursor: nextCursor,
            selectedIndex: 0,
            showAutocomplete: nextShowAutocomplete,
          });
        }
        return;
      }

      if (input && input.length >= 1 && !input.startsWith('\x1b')) {
        insertText(input);
      }
    },
    [commandHandler, handleSubmit, insertText, shouldShowAutocomplete]
  );

  useInput(handleInput, { isActive });

  useEffect(() => {
    const unregister = commandHandler.registerInputPane(addLog, handleSubmit);
    return unregister;
  }, [commandHandler, addLog, handleSubmit]);

  useEffect(() => {
    commandHandler.setExitOnEmptyInput(exitOnEmptyInput);
  }, [commandHandler, exitOnEmptyInput]);

  const displayValue = inputValue || '';
  const beforeCursor = displayValue.slice(0, cursorPosition);
  const afterCursor = displayValue.slice(cursorPosition);
  const beforeLines = beforeCursor.split('\n');
  const afterLines = afterCursor.split('\n');
  const lines = displayValue.split('\n');
  const cursorLineIndex = beforeLines.length - 1;
  const cursorLineBefore = beforeLines[cursorLineIndex] || '';
  const cursorLineAfter = afterLines[0] || '';
  const cursorChar = cursorLineAfter.length > 0 ? cursorLineAfter[0] : ' ';
  const cursorLineAfterRemainder = cursorLineAfter.slice(1);

  const filteredCommands = showAutocomplete ? commandHandler.getFilteredCommands(inputValue) : [];

  const handleAutocompleteSelect = useCallback(
    (index: number) => {
      const commands = commandHandler.getFilteredCommands(inputRef.current);
      if (index < commands.length) {
        const selectedCommand = commands[index];
        inputRef.current = selectedCommand;
        cursorRef.current = selectedCommand.length;
        showAutocompleteRef.current = false;
        selectedIndexRef.current = 0;
        setInputState({
          value: selectedCommand,
          cursor: selectedCommand.length,
          showAutocomplete: false,
          selectedIndex: 0,
        });
      }
    },
    [commandHandler]
  );

  if (!visible) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => {
        const prefix = index === 0 ? '> ' : '  ';
        if (index === cursorLineIndex) {
          return (
            <Box key={`line-${index}`}>
              <Text color="green">{prefix}</Text>
              <Text>{cursorLineBefore}</Text>
              <Text backgroundColor="white" color="black">
                {cursorChar}
              </Text>
              <Text>{cursorLineAfterRemainder}</Text>
            </Box>
          );
        }
        return (
          <Box key={`line-${index}`}>
            <Text color="green">{prefix}</Text>
            <Text>{line}</Text>
          </Box>
        );
      })}

      <AutocompletePane commands={filteredCommands} input={inputValue} selectedIndex={selectedIndex} onSelect={handleAutocompleteSelect} visible={showAutocomplete} />
    </Box>
  );
});

export default InputReadline;

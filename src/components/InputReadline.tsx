import { Box, Text, useInput } from 'ink';
import React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandHandler } from '../command-handler.js';
import { setAutocompleteState } from './autocomplete-store.js';

interface InputReadlineProps {
  commandHandler?: CommandHandler;
  exitOnEmptyInput?: boolean;
  onSubmit?: (value: string) => void | Promise<void>;
  onChange?: (value: string) => void;
  onCommandStart?: () => void;
  onCommandComplete?: () => void;
  isActive?: boolean;
  visible?: boolean;
  value?: string;
  placeholder?: string;
  showPrompt?: boolean;
}

interface InputState {
  value: string;
  cursor: number;
  showAutocomplete: boolean;
  selectedIndex: number;
}

const InputReadline: React.FC<InputReadlineProps> = React.memo(({ commandHandler, exitOnEmptyInput = false, onSubmit, onChange, onCommandStart, onCommandComplete, isActive = true, visible = true, value: controlledValue, placeholder = '', showPrompt = true }) => {
  const isControlled = controlledValue !== undefined;
  const [inputState, setInputState] = useState<InputState>({
    value: controlledValue || '',
    cursor: controlledValue?.length || 0,
    showAutocomplete: false,
    selectedIndex: 0,
  });

  const { value: inputValue, cursor: cursorPosition, showAutocomplete, selectedIndex } = inputState;
  const displayValue = isControlled ? controlledValue : inputValue;

  const inputRef = useRef(displayValue);
  const cursorRef = useRef(cursorPosition);
  const showAutocompleteRef = useRef(showAutocomplete);
  const selectedIndexRef = useRef(selectedIndex);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const historyDraftRef = useRef('');
  const wasActiveRef = useRef(isActive);
  const autocompleteStateRef = useRef({ commands: [] as string[], selectedIndex: 0, visible: false });

  const onSubmitRef = useRef(onSubmit);
  const onChangeRef = useRef(onChange);
  const onCommandStartRef = useRef(onCommandStart);
  const onCommandCompleteRef = useRef(onCommandComplete);
  const exitOnEmptyInputRef = useRef(exitOnEmptyInput);

  useEffect(() => {
    onSubmitRef.current = onSubmit;
    onChangeRef.current = onChange;
    onCommandStartRef.current = onCommandStart;
    onCommandCompleteRef.current = onCommandComplete;
    exitOnEmptyInputRef.current = exitOnEmptyInput;
  }, [onSubmit, onChange, onCommandStart, onCommandComplete, exitOnEmptyInput]);

  useEffect(() => {
    if (isControlled) {
      inputRef.current = controlledValue;
      if (cursorRef.current > controlledValue.length) {
        cursorRef.current = controlledValue.length;
        setInputState((prev) => ({ ...prev, value: controlledValue, cursor: controlledValue.length }));
      } else {
        setInputState((prev) => ({ ...prev, value: controlledValue }));
      }
    }
  }, [controlledValue, isControlled]);

  useEffect(() => {
    const wasInactive = !wasActiveRef.current;
    const isNowActive = isActive;
    wasActiveRef.current = isActive;

    if (wasInactive && isNowActive && !isControlled) {
      inputRef.current = '';
      cursorRef.current = 0;
      showAutocompleteRef.current = false;
      selectedIndexRef.current = 0;
      historyIndexRef.current = -1;
      historyDraftRef.current = '';
      setInputState({ value: '', cursor: 0, showAutocomplete: false, selectedIndex: 0 });
    }
  }, [isActive, isControlled]);

  const addLog = useCallback((entry: string) => {
    console.log(entry);
  }, []);

  const updateValue = useCallback(
    (newValue: string, newCursor: number, newShowAutocomplete = false) => {
      inputRef.current = newValue;
      cursorRef.current = newCursor;
      showAutocompleteRef.current = newShowAutocomplete;
      selectedIndexRef.current = 0;
      historyIndexRef.current = -1;
      historyDraftRef.current = '';

      if (isControlled) {
        onChangeRef.current?.(newValue);
        setInputState((prev) => ({ ...prev, cursor: newCursor, showAutocomplete: newShowAutocomplete, selectedIndex: 0 }));
      } else {
        setInputState({ value: newValue, cursor: newCursor, showAutocomplete: newShowAutocomplete, selectedIndex: 0 });
      }
    },
    [isControlled]
  );

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

      if (commandHandler) {
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

        updateValue('', 0, false);
      } else {
        onSubmitRef.current?.(trimmedValue);
      }
    },
    [commandHandler, addLog, updateValue]
  );

  const shouldShowAutocomplete = useCallback(
    (value: string) => {
      if (!commandHandler) return false;
      if (!value) return false;
      if (value.startsWith('/')) return true;
      if (value.startsWith('I.')) return true;
      return false;
    },
    [commandHandler]
  );

  const insertText = useCallback(
    (text: string) => {
      const normalized = text.replace(/\x1b\[200~|\x1b\[201~/g, '').replace(/\r/g, '\n');
      if (!normalized) return;
      const currentValue = inputRef.current;
      const currentCursor = cursorRef.current;
      const newValue = currentValue.slice(0, currentCursor) + normalized + currentValue.slice(currentCursor);
      const nextCursor = currentCursor + normalized.length;
      const nextShowAutocomplete = shouldShowAutocomplete(newValue);
      updateValue(newValue, nextCursor, nextShowAutocomplete);
    },
    [shouldShowAutocomplete, updateValue]
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
        if (commandHandler && showAutocompleteRef.current) {
          const filteredCommands = commandHandler.getFilteredCommands(inputRef.current);
          const chosen = filteredCommands[selectedIndexRef.current] || filteredCommands[0];
          if (chosen) {
            updateValue(chosen, chosen.length, false);
            handleSubmit(chosen);
            return;
          }
        }
        handleSubmit(inputRef.current);
        return;
      }

      const isWordChar = (char: string) => /[A-Za-z0-9_]/.test(char);

      if (key.ctrl && key.leftArrow) {
        const value = inputRef.current;
        let nextCursor = cursorRef.current;
        if (nextCursor === 0) return;
        nextCursor -= 1;
        while (nextCursor > 0 && !isWordChar(value[nextCursor])) nextCursor -= 1;
        while (nextCursor > 0 && isWordChar(value[nextCursor - 1])) nextCursor -= 1;
        cursorRef.current = nextCursor;
        setInputState((prev) => ({ ...prev, cursor: nextCursor }));
        return;
      }

      if (key.ctrl && key.rightArrow) {
        const value = inputRef.current;
        let nextCursor = cursorRef.current;
        if (nextCursor >= value.length) return;
        while (nextCursor < value.length && !isWordChar(value[nextCursor])) nextCursor += 1;
        while (nextCursor < value.length && isWordChar(value[nextCursor])) nextCursor += 1;
        cursorRef.current = nextCursor;
        setInputState((prev) => ({ ...prev, cursor: nextCursor }));
        return;
      }

      if (key.meta && input === 'b') {
        const value = inputRef.current;
        let nextCursor = cursorRef.current;
        if (nextCursor === 0) return;
        nextCursor -= 1;
        while (nextCursor > 0 && !isWordChar(value[nextCursor])) nextCursor -= 1;
        while (nextCursor > 0 && isWordChar(value[nextCursor - 1])) nextCursor -= 1;
        cursorRef.current = nextCursor;
        setInputState((prev) => ({ ...prev, cursor: nextCursor }));
        return;
      }

      if (key.meta && input === 'f') {
        const value = inputRef.current;
        let nextCursor = cursorRef.current;
        if (nextCursor >= value.length) return;
        while (nextCursor < value.length && !isWordChar(value[nextCursor])) nextCursor += 1;
        while (nextCursor < value.length && isWordChar(value[nextCursor])) nextCursor += 1;
        cursorRef.current = nextCursor;
        setInputState((prev) => ({ ...prev, cursor: nextCursor }));
        return;
      }

      if (key.ctrl && (input === 'b' || input === 'f')) return;
      if (key.meta && (input === 'b' || input === 'f')) return;

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

      if (commandHandler && showAutocompleteRef.current && (key.upArrow || (key.shift && key.leftArrow))) {
        const filteredCommands = commandHandler.getFilteredCommands(inputRef.current);
        const nextIndex = selectedIndexRef.current > 0 ? selectedIndexRef.current - 1 : filteredCommands.length - 1;
        selectedIndexRef.current = nextIndex;
        setInputState((prev) => ({ ...prev, selectedIndex: nextIndex }));
        return;
      }

      if (commandHandler && showAutocompleteRef.current && (key.downArrow || (key.shift && key.rightArrow))) {
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

      if (commandHandler && !showAutocompleteRef.current && key.upArrow) {
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
        setInputState({ value: nextValue, cursor: nextValue.length, selectedIndex: 0, showAutocomplete: nextShowAutocomplete });
        return;
      }

      if (commandHandler && !showAutocompleteRef.current && key.downArrow) {
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
          setInputState({ value: nextValue, cursor: nextValue.length, selectedIndex: 0, showAutocomplete: nextShowAutocomplete });
          return;
        }
        historyIndexRef.current += 1;
        const nextValue = history[historyIndexRef.current] || '';
        const nextShowAutocomplete = shouldShowAutocomplete(nextValue);
        inputRef.current = nextValue;
        cursorRef.current = nextValue.length;
        selectedIndexRef.current = 0;
        showAutocompleteRef.current = nextShowAutocomplete;
        setInputState({ value: nextValue, cursor: nextValue.length, selectedIndex: 0, showAutocomplete: nextShowAutocomplete });
        return;
      }

      if (commandHandler && key.tab) {
        const filteredCommands = commandHandler.getFilteredCommands(inputRef.current);
        if (selectedIndexRef.current < filteredCommands.length) {
          const selectedCommand = filteredCommands[selectedIndexRef.current];
          updateValue(selectedCommand, selectedCommand.length, false);
        }
        return;
      }

      if (input === ' ' && showAutocompleteRef.current) {
        const newValue = inputRef.current.slice(0, cursorRef.current) + ' ' + inputRef.current.slice(cursorRef.current);
        updateValue(newValue, cursorRef.current + 1, false);
        return;
      }

      if (key.backspace || key.delete) {
        if (cursorRef.current > 0) {
          const currentValue = inputRef.current;
          const currentCursor = cursorRef.current;
          const newValue = currentValue.slice(0, currentCursor - 1) + currentValue.slice(currentCursor);
          const nextCursor = Math.max(0, currentCursor - 1);
          const nextShowAutocomplete = shouldShowAutocomplete(newValue);
          updateValue(newValue, nextCursor, nextShowAutocomplete);
        }
        return;
      }

      if (input && input.length >= 1 && !input.startsWith('\x1b')) {
        insertText(input);
      }
    },
    [commandHandler, handleSubmit, insertText, shouldShowAutocomplete, updateValue]
  );

  useInput(handleInput, { isActive });

  useEffect(() => {
    if (commandHandler) {
      const unregister = commandHandler.registerInputPane(addLog, handleSubmit);
      return unregister;
    }
  }, [commandHandler, addLog, handleSubmit]);

  useEffect(() => {
    if (commandHandler) {
      commandHandler.setExitOnEmptyInput(exitOnEmptyInput);
    }
  }, [commandHandler, exitOnEmptyInput]);

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

  const filteredCommands = commandHandler && showAutocomplete ? commandHandler.getFilteredCommands(displayValue) : [];

  useEffect(() => {
    if (!commandHandler) return;
    const nextVisible = visible && showAutocomplete && filteredCommands.length > 0;
    const nextCommands = nextVisible ? filteredCommands : [];
    const nextIndex = nextVisible ? selectedIndex : 0;
    const prev = autocompleteStateRef.current;
    if (prev.visible === nextVisible && prev.selectedIndex === nextIndex && prev.commands.length === nextCommands.length && prev.commands.every((cmd, i) => cmd === nextCommands[i])) {
      return;
    }
    autocompleteStateRef.current = { commands: nextCommands, selectedIndex: nextIndex, visible: nextVisible };
    setAutocompleteState(autocompleteStateRef.current);
  }, [commandHandler, filteredCommands, selectedIndex, showAutocomplete, visible]);

  if (!visible) {
    return null;
  }

  const showPlaceholder = !displayValue && placeholder && isActive;

  if (!showPrompt) {
    return (
      <Box>
        <Text>{cursorLineBefore}</Text>
        {isActive ? (
          <Text backgroundColor="white" color="black">
            {showPlaceholder ? placeholder[0] || ' ' : cursorChar}
          </Text>
        ) : (
          <Text>{cursorChar}</Text>
        )}
        <Text>{showPlaceholder ? placeholder.slice(1) : cursorLineAfterRemainder}</Text>
        {!displayValue && placeholder && !isActive && <Text color="gray">{placeholder}</Text>}
      </Box>
    );
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
    </Box>
  );
});

export default InputReadline;

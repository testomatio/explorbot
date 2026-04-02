import { Box, Text, useStdin } from 'ink';
import React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CommandAutocompleteSuggestion, CommandHandler } from '../command-handler.js';
import { setAutocompleteState } from './autocomplete-store.js';
import parseKeypress, { nonAlphanumericKeys } from './parse-keypress.js';

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
  const autocompleteStateRef = useRef({ suggestions: [] as CommandAutocompleteSuggestion[], argumentHint: undefined as string | undefined, selectedIndex: 0, visible: false });

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
  const { internal_eventEmitter, setRawMode } = useStdin();

  const getAutocomplete = useCallback(
    (value: string, cursor: number) => {
      if (!commandHandler) {
        return {
          suggestions: [],
          replaceFrom: cursor,
          replaceTo: cursor,
          visible: false,
        };
      }
      return commandHandler.getAutocomplete(value, cursor);
    },
    [commandHandler]
  );

  const updateCursor = useCallback((nextCursor: number) => {
    const safeCursor = Math.max(0, Math.min(nextCursor, inputRef.current.length));
    cursorRef.current = safeCursor;
    setInputState((prev) => ({ ...prev, cursor: safeCursor }));
  }, []);

  const findLineStart = useCallback((value: string, cursor: number) => {
    if (cursor <= 0) {
      return 0;
    }
    return value.lastIndexOf('\n', cursor - 1) + 1;
  }, []);

  const findLineEnd = useCallback((value: string, cursor: number) => {
    const lineEnd = value.indexOf('\n', cursor);
    if (lineEnd === -1) {
      return value.length;
    }
    return lineEnd;
  }, []);

  const updateValue = useCallback(
    (newValue: string, newCursor: number) => {
      const safeCursor = Math.max(0, Math.min(newCursor, newValue.length));
      const autocomplete = getAutocomplete(newValue, safeCursor);
      const nextShowAutocomplete = autocomplete.visible || Boolean(autocomplete.argumentHint);
      inputRef.current = newValue;
      cursorRef.current = safeCursor;
      showAutocompleteRef.current = nextShowAutocomplete;
      selectedIndexRef.current = 0;
      historyIndexRef.current = -1;
      historyDraftRef.current = '';

      if (isControlled) {
        onChangeRef.current?.(newValue);
        setInputState((prev) => ({ ...prev, cursor: safeCursor, showAutocomplete: nextShowAutocomplete, selectedIndex: 0 }));
        return;
      }
      setInputState({ value: newValue, cursor: safeCursor, showAutocomplete: nextShowAutocomplete, selectedIndex: 0 });
    },
    [getAutocomplete, isControlled]
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
        onCommandCompleteRef.current?.();

        updateValue('', 0);
      } else {
        onSubmitRef.current?.(trimmedValue);
      }
    },
    [commandHandler, updateValue]
  );

  const insertText = useCallback(
    (text: string) => {
      const normalized = text.replaceAll('\u001b[200~', '').replaceAll('\u001b[201~', '').replace(/\r/g, '\n');
      if (!normalized) return;
      const currentValue = inputRef.current;
      const currentCursor = cursorRef.current;
      const newValue = currentValue.slice(0, currentCursor) + normalized + currentValue.slice(currentCursor);
      const nextCursor = currentCursor + normalized.length;
      updateValue(newValue, nextCursor);
    },
    [updateValue]
  );

  const applyAutocomplete = useCallback(
    (index: number) => {
      if (!commandHandler) {
        return null;
      }
      const autocomplete = getAutocomplete(inputRef.current, cursorRef.current);
      const suggestion = autocomplete.suggestions[index] || autocomplete.suggestions[0];
      if (!suggestion) {
        return null;
      }
      const newValue = inputRef.current.slice(0, autocomplete.replaceFrom) + suggestion.value + inputRef.current.slice(autocomplete.replaceTo);
      const nextCursor = autocomplete.replaceFrom + suggestion.value.length;
      updateValue(newValue, nextCursor);
      return newValue;
    },
    [commandHandler, getAutocomplete, updateValue]
  );

  const handleInput = useCallback(
    (input: string, key: { [key: string]: boolean }) => {
      const isBackspaceKey = key.backspace;
      const isDeleteKey = key.delete;

      if (key.ctrl && input === 'c') {
        console.log('\n🛑 Received Ctrl-C, exiting...');
        process.exit(0);
        return;
      }

      if (key.escape) {
        if (showAutocompleteRef.current) {
          showAutocompleteRef.current = false;
          selectedIndexRef.current = 0;
          setInputState((prev) => ({ ...prev, showAutocomplete: false, selectedIndex: 0 }));
        }
        return;
      }

      if (key.return) {
        if (key.shift) {
          insertText('\n');
          return;
        }
        if (commandHandler && showAutocompleteRef.current) {
          const autocomplete = getAutocomplete(inputRef.current, cursorRef.current);
          if (autocomplete.visible && autocomplete.suggestions.length > 0) {
            const chosen = applyAutocomplete(selectedIndexRef.current);
            if (chosen) {
              handleSubmit(chosen);
              return;
            }
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
        updateCursor(nextCursor);
        return;
      }

      if (key.ctrl && key.rightArrow) {
        const value = inputRef.current;
        let nextCursor = cursorRef.current;
        if (nextCursor >= value.length) return;
        while (nextCursor < value.length && !isWordChar(value[nextCursor])) nextCursor += 1;
        while (nextCursor < value.length && isWordChar(value[nextCursor])) nextCursor += 1;
        updateCursor(nextCursor);
        return;
      }

      if (key.meta && input === 'b') {
        const value = inputRef.current;
        let nextCursor = cursorRef.current;
        if (nextCursor === 0) return;
        nextCursor -= 1;
        while (nextCursor > 0 && !isWordChar(value[nextCursor])) nextCursor -= 1;
        while (nextCursor > 0 && isWordChar(value[nextCursor - 1])) nextCursor -= 1;
        updateCursor(nextCursor);
        return;
      }

      if (key.meta && input === 'f') {
        const value = inputRef.current;
        let nextCursor = cursorRef.current;
        if (nextCursor >= value.length) return;
        while (nextCursor < value.length && !isWordChar(value[nextCursor])) nextCursor += 1;
        while (nextCursor < value.length && isWordChar(value[nextCursor])) nextCursor += 1;
        updateCursor(nextCursor);
        return;
      }

      if ((key.ctrl && input === 'a') || key.home) {
        updateCursor(findLineStart(inputRef.current, cursorRef.current));
        return;
      }

      if ((key.ctrl && input === 'e') || key.end) {
        updateCursor(findLineEnd(inputRef.current, cursorRef.current));
        return;
      }

      if ((key.ctrl && input === 'w') || (key.ctrl && isBackspaceKey)) {
        const value = inputRef.current;
        const currentCursor = cursorRef.current;
        if (currentCursor === 0) {
          return;
        }
        let nextCursor = currentCursor - 1;
        while (nextCursor > 0 && !isWordChar(value[nextCursor])) nextCursor -= 1;
        while (nextCursor > 0 && isWordChar(value[nextCursor - 1])) nextCursor -= 1;
        const newValue = value.slice(0, nextCursor) + value.slice(currentCursor);
        updateValue(newValue, nextCursor);
        return;
      }

      if (key.ctrl && key.delete) {
        const value = inputRef.current;
        const currentCursor = cursorRef.current;
        if (currentCursor >= value.length) {
          return;
        }
        let nextCursor = currentCursor;
        while (nextCursor < value.length && !isWordChar(value[nextCursor])) nextCursor += 1;
        while (nextCursor < value.length && isWordChar(value[nextCursor])) nextCursor += 1;
        const newValue = value.slice(0, currentCursor) + value.slice(nextCursor);
        updateValue(newValue, currentCursor);
        return;
      }

      if (key.ctrl && input === 'u') {
        const currentCursor = cursorRef.current;
        const lineStart = findLineStart(inputRef.current, currentCursor);
        if (lineStart === currentCursor) {
          return;
        }
        const newValue = inputRef.current.slice(0, lineStart) + inputRef.current.slice(currentCursor);
        updateValue(newValue, lineStart);
        return;
      }

      if (key.ctrl && input === 'k') {
        const currentCursor = cursorRef.current;
        const lineEnd = findLineEnd(inputRef.current, currentCursor);
        if (lineEnd === currentCursor) {
          return;
        }
        const newValue = inputRef.current.slice(0, currentCursor) + inputRef.current.slice(lineEnd);
        updateValue(newValue, currentCursor);
        return;
      }

      if (key.ctrl) return;
      if (key.meta && (input === 'b' || input === 'f')) return;

      if (key.leftArrow) {
        updateCursor(Math.max(0, cursorRef.current - 1));
        return;
      }

      if (key.rightArrow) {
        updateCursor(Math.min(inputRef.current.length, cursorRef.current + 1));
        return;
      }

      if (commandHandler && showAutocompleteRef.current && (key.upArrow || (key.shift && key.leftArrow))) {
        const autocomplete = getAutocomplete(inputRef.current, cursorRef.current);
        if (autocomplete.visible && autocomplete.suggestions.length > 0) {
          const nextIndex = selectedIndexRef.current > 0 ? selectedIndexRef.current - 1 : autocomplete.suggestions.length - 1;
          selectedIndexRef.current = nextIndex;
          setInputState((prev) => ({ ...prev, selectedIndex: nextIndex }));
          return;
        }
      }

      if (commandHandler && showAutocompleteRef.current && (key.downArrow || (key.shift && key.rightArrow))) {
        const autocomplete = getAutocomplete(inputRef.current, cursorRef.current);
        if (autocomplete.visible && autocomplete.suggestions.length > 0) {
          const nextIndex = selectedIndexRef.current < autocomplete.suggestions.length - 1 ? selectedIndexRef.current + 1 : 0;
          selectedIndexRef.current = nextIndex;
          setInputState((prev) => ({ ...prev, selectedIndex: nextIndex }));
          return;
        }
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
        updateCursor(nextCursor);
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
        updateCursor(nextCursor);
        return;
      }

      if (commandHandler && key.upArrow) {
        const currentAutocomplete = getAutocomplete(inputRef.current, cursorRef.current);
        if (showAutocompleteRef.current && currentAutocomplete.visible && currentAutocomplete.suggestions.length > 0) {
          return;
        }
        const history = historyRef.current;
        if (history.length === 0) return;
        if (historyIndexRef.current === -1) {
          historyDraftRef.current = inputRef.current;
          historyIndexRef.current = history.length - 1;
        } else if (historyIndexRef.current > 0) {
          historyIndexRef.current -= 1;
        }
        const nextValue = history[historyIndexRef.current] || '';
        const nextAutocomplete = getAutocomplete(nextValue, nextValue.length);
        const nextShowAutocomplete = nextAutocomplete.visible || Boolean(nextAutocomplete.argumentHint);
        inputRef.current = nextValue;
        cursorRef.current = nextValue.length;
        selectedIndexRef.current = 0;
        showAutocompleteRef.current = nextShowAutocomplete;
        setInputState({ value: nextValue, cursor: nextValue.length, selectedIndex: 0, showAutocomplete: nextShowAutocomplete });
        return;
      }

      if (commandHandler && key.downArrow) {
        const currentAutocomplete = getAutocomplete(inputRef.current, cursorRef.current);
        if (showAutocompleteRef.current && currentAutocomplete.visible && currentAutocomplete.suggestions.length > 0) {
          return;
        }
        const history = historyRef.current;
        if (history.length === 0) return;
        if (historyIndexRef.current === -1) return;
        if (historyIndexRef.current >= history.length - 1) {
          historyIndexRef.current = -1;
          const nextValue = historyDraftRef.current || '';
          const nextAutocomplete = getAutocomplete(nextValue, nextValue.length);
          const nextShowAutocomplete = nextAutocomplete.visible || Boolean(nextAutocomplete.argumentHint);
          inputRef.current = nextValue;
          cursorRef.current = nextValue.length;
          selectedIndexRef.current = 0;
          showAutocompleteRef.current = nextShowAutocomplete;
          setInputState({ value: nextValue, cursor: nextValue.length, selectedIndex: 0, showAutocomplete: nextShowAutocomplete });
          return;
        }
        historyIndexRef.current += 1;
        const nextValue = history[historyIndexRef.current] || '';
        const nextAutocomplete = getAutocomplete(nextValue, nextValue.length);
        const nextShowAutocomplete = nextAutocomplete.visible || Boolean(nextAutocomplete.argumentHint);
        inputRef.current = nextValue;
        cursorRef.current = nextValue.length;
        selectedIndexRef.current = 0;
        showAutocompleteRef.current = nextShowAutocomplete;
        setInputState({ value: nextValue, cursor: nextValue.length, selectedIndex: 0, showAutocomplete: nextShowAutocomplete });
        return;
      }

      if (commandHandler && key.tab) {
        const autocomplete = getAutocomplete(inputRef.current, cursorRef.current);
        if (autocomplete.visible && autocomplete.suggestions.length > 0) {
          const chosen = applyAutocomplete(selectedIndexRef.current);
          if (chosen) {
            return;
          }
        }
      }

      if (isBackspaceKey) {
        if (cursorRef.current > 0) {
          const currentValue = inputRef.current;
          const currentCursor = cursorRef.current;
          const newValue = currentValue.slice(0, currentCursor - 1) + currentValue.slice(currentCursor);
          const nextCursor = Math.max(0, currentCursor - 1);
          updateValue(newValue, nextCursor);
        }
        return;
      }

      if (isDeleteKey) {
        if (cursorRef.current >= inputRef.current.length) {
          return;
        }
        const currentValue = inputRef.current;
        const currentCursor = cursorRef.current;
        const newValue = currentValue.slice(0, currentCursor) + currentValue.slice(currentCursor + 1);
        updateValue(newValue, currentCursor);
        return;
      }

      if (input && input.length >= 1 && !input.startsWith('\x1b') && !key.meta) {
        insertText(input);
      }
    },
    [applyAutocomplete, commandHandler, findLineEnd, findLineStart, getAutocomplete, handleSubmit, insertText, updateCursor, updateValue]
  );

  useEffect(() => {
    if (!isActive) {
      return;
    }

    setRawMode(true);
    return () => {
      setRawMode(false);
    };
  }, [isActive, setRawMode]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const handleData = (data: string) => {
      const keypress = parseKeypress(data);
      const normalizedName = keypress.sequence === '\x7f' || keypress.sequence === '\x1b\x7f' ? 'backspace' : keypress.name;

      if (normalizedName !== 'backspace' && normalizedName !== 'delete' && keypress.sequence.includes('\x7f')) {
        const deleteCount = keypress.sequence.match(/\x7f/g)?.length || 0;
        let currentValue = inputRef.current;
        let currentCursor = cursorRef.current;

        for (let index = 0; index < deleteCount; index += 1) {
          if (currentCursor === 0) {
            break;
          }
          currentValue = currentValue.slice(0, currentCursor - 1) + currentValue.slice(currentCursor);
          currentCursor -= 1;
        }

        if (currentValue !== inputRef.current) {
          updateValue(currentValue, currentCursor);
        }
        return;
      }

      const key = {
        upArrow: normalizedName === 'up',
        downArrow: normalizedName === 'down',
        leftArrow: normalizedName === 'left',
        rightArrow: normalizedName === 'right',
        pageDown: normalizedName === 'pagedown',
        pageUp: normalizedName === 'pageup',
        return: normalizedName === 'return',
        escape: normalizedName === 'escape',
        ctrl: keypress.ctrl,
        shift: keypress.shift,
        tab: normalizedName === 'tab',
        backspace: normalizedName === 'backspace',
        delete: normalizedName === 'delete',
        meta: keypress.meta || normalizedName === 'escape' || keypress.option,
      };

      let input = keypress.ctrl ? keypress.name : keypress.sequence;
      if (normalizedName !== keypress.name && keypress.ctrl) {
        input = normalizedName;
      }
      if (nonAlphanumericKeys.includes(normalizedName)) {
        input = '';
      }
      if (input.startsWith('\u001b')) {
        input = input.slice(1);
      }
      if (input.length === 1 && /[A-Z]/.test(input)) {
        key.shift = true;
      }

      handleInput(input, key);
    };

    internal_eventEmitter?.on('input', handleData);
    return () => {
      internal_eventEmitter?.removeListener('input', handleData);
    };
  }, [handleInput, internal_eventEmitter, isActive, updateValue]);

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
  const showPlaceholder = !displayValue && placeholder && isActive;
  const activeCursorText = showPlaceholder ? placeholder : cursorLineAfter;
  const [cursorGlyph = ' '] = Array.from(activeCursorText);
  const cursorSuffix = activeCursorText.slice(cursorGlyph.length);

  const autocomplete = useMemo(() => {
    return getAutocomplete(displayValue, cursorPosition);
  }, [cursorPosition, displayValue, getAutocomplete]);

  useEffect(() => {
    if (!commandHandler) return;
    const nextVisible = visible && showAutocomplete && autocomplete.visible;
    const nextSuggestions = nextVisible ? autocomplete.suggestions : [];
    const nextArgumentHint = visible && showAutocomplete ? autocomplete.argumentHint : undefined;
    const nextIndex = nextVisible ? selectedIndex : 0;
    const prev = autocompleteStateRef.current;
    if (
      prev.visible === nextVisible &&
      prev.selectedIndex === nextIndex &&
      prev.argumentHint === nextArgumentHint &&
      prev.suggestions.length === nextSuggestions.length &&
      prev.suggestions.every((suggestion, index) => suggestion.display === nextSuggestions[index]?.display && suggestion.value === nextSuggestions[index]?.value)
    ) {
      return;
    }
    autocompleteStateRef.current = { suggestions: nextSuggestions, argumentHint: nextArgumentHint, selectedIndex: nextIndex, visible: nextVisible };
    setAutocompleteState(autocompleteStateRef.current);
  }, [autocomplete.argumentHint, autocomplete.suggestions, autocomplete.visible, commandHandler, selectedIndex, showAutocomplete, visible]);

  if (!visible) {
    return null;
  }

  if (!showPrompt) {
    return (
      <Box>
        <Text>{cursorLineBefore}</Text>
        {isActive ? (
          <Text backgroundColor="white" color="black">
            {cursorGlyph}
          </Text>
        ) : (
          <Text />
        )}
        <Text>{cursorSuffix}</Text>
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
                {cursorGlyph}
              </Text>
              <Text>{cursorSuffix}</Text>
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

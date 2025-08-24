import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface InputPaneProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  suggestions?: string[];
}

const InputPane: React.FC<InputPaneProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder,
  suggestions = [],
}) => {
  const [inputValue, setInputValue] = useState(value);
  const [cursorPosition, setCursorPosition] = useState(0);

  useInput((input, key) => {
    if (key.return) {
      onSubmit(inputValue);
      setInputValue('');
      setCursorPosition(0);
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

    if (key.backspace || key.delete) {
      if (cursorPosition > 0) {
        const newValue = inputValue.slice(0, cursorPosition - 1) + inputValue.slice(cursorPosition);
        setInputValue(newValue);
        setCursorPosition(Math.max(0, cursorPosition - 1));
        onChange(newValue);
      }
      return;
    }

    if (input && input.length === 1) {
      const newValue = inputValue.slice(0, cursorPosition) + input + inputValue.slice(cursorPosition);
      setInputValue(newValue);
      setCursorPosition(cursorPosition + 1);
      onChange(newValue);
    }
  });

  useEffect(() => {
    setInputValue(value);
    setCursorPosition(value.length);
  }, [value]);

  const displayValue = inputValue || placeholder || '';
  const beforeCursor = displayValue.slice(0, cursorPosition);
  const afterCursor = displayValue.slice(cursorPosition);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="green">&gt; </Text>
        <Text>{beforeCursor}</Text>
        <Text backgroundColor="white" color="black"> </Text>
        <Text>{afterCursor}</Text>
      </Box>
    </Box>
  );
};

export default InputPane;

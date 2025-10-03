import chalk from 'chalk';
import { container, output, recorder, store } from 'codeceptjs';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import React, { useEffect, useMemo, useState } from 'react';
import { createDebug, getMethodsOfObject, log } from '../utils/logger.ts';
import AutocompletePane from './AutocompletePane.js';

const debug = createDebug('pause');

// Global object to register variables (as in the original pause command)
let registeredVariables = {};
let history: string[] = [];

// Function to reset global state
const resetGlobalState = () => {
  registeredVariables = {};
  history = [];
};

/**
 * PausePane mimics CodeceptJS's pause() command using an Ink UI.
 * It uses the recorder, history, container, and eval() to run commands.
 *
 * Props:
 *   onExit: a callback to signal that the pause session should finish.
 *   onCommandSubmit: a callback to signal that a command was submitted.
 */
const PausePane = ({ onExit, onCommandSubmit }: { onExit: () => void; onCommandSubmit?: () => void }) => {
  let finish;
  let next;

  const [command, setCommand] = useState('');
  const [commands, setCommands] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [autocompleteMode, setAutocompleteMode] = useState(false);

  // Reset global state when component is recreated
  useEffect(() => {
    resetGlobalState();
    // Try to get commands from container, fallback to predefined list
    try {
      const I = container.support('I');
      const cmdList = getMethodsOfObject(I);
      setCommands(cmdList.length > 0 ? cmdList : ['amOnPage', 'click', 'fillField', 'see', 'dontSee', 'seeElement', 'dontSeeElement', 'waitForElement', 'selectOption', 'checkOption']);
    } catch (err) {
      // Fallback to predefined commands if container fails
      setCommands(['amOnPage', 'click', 'fillField', 'see', 'dontSee', 'seeElement', 'dontSeeElement', 'waitForElement', 'selectOption', 'checkOption']);
    }
  }, []);

  const prefixedCommands = useMemo(() => commands.map((cmd) => (cmd.startsWith('I.') ? cmd : `I.${cmd}`)), [commands]);

  const filteredCommands = useMemo(() => {
    if (!prefixedCommands.length) {
      return [];
    }

    const normalized = command.trim();
    if (!normalized) {
      return prefixedCommands.slice(0, 20);
    }

    const searchTerm = normalized.toLowerCase().replace(/^i\./, '');
    return prefixedCommands.filter((cmd) => cmd.toLowerCase().includes(searchTerm)).slice(0, 20);
  }, [prefixedCommands, command]);

  const showAutocomplete = filteredCommands.length > 0;

  useEffect(() => {
    if (!showAutocomplete) {
      setSelectedIndex(0);
      setAutocompleteMode(false);
      return;
    }

    setSelectedIndex((prev) => (prev < filteredCommands.length ? prev : 0));
  }, [filteredCommands.length, showAutocomplete]);

  useInput((input, key) => {
    if (!showAutocomplete || !filteredCommands.length) {
      return;
    }

    if (key.tab) {
      const chosen = filteredCommands[selectedIndex] || filteredCommands[0];
      if (chosen) {
        setCommand(chosen);
        setAutocompleteMode(false);
      }
      return;
    }

    if (key.downArrow) {
      setAutocompleteMode(true);
      setSelectedIndex((prev) => (filteredCommands.length ? (prev + 1) % filteredCommands.length : 0));
      return;
    }

    if (key.upArrow) {
      setAutocompleteMode(true);
      setSelectedIndex((prev) => (filteredCommands.length ? (prev > 0 ? prev - 1 : filteredCommands.length - 1) : 0));
      return;
    }

    if (key.escape) {
      setAutocompleteMode(false);
    }
  });
  const handleSubmit = async (cmd: string) => {
    // Start a new recorder session for pause
    recorder.session.start('pause');

    // If blank or "exit" or "resume" is entered, exit the pause session
    if (cmd.trim() === '' || cmd.trim().toLowerCase() === 'exit' || cmd.trim().toLowerCase() === 'resume') {
      recorder.session.restore('pause');
      onExit();
      return;
    }

    // Inject registered variables into current context
    for (const k of Object.keys(registeredVariables)) {
      // eslint-disable-next-line no-eval
      eval(`var ${k} = registeredVariables['${k}'];`);
    }

    let execCmd = cmd.trim();
    let isCustomCommand = false;
    // If command starts with '=>', treat as a custom command
    if (execCmd.startsWith('=>')) {
      isCustomCommand = true;
      execCmd = execCmd.substring(2).trim();
    } else if (execCmd.startsWith('I.')) {
      execCmd = execCmd.trim();
    } else {
      // Otherwise, mimic original behavior by prefixing with 'I.'
      execCmd = `I.${execCmd}`;
    }
    log('=>', execCmd);

    debug('Executing command:', execCmd);

    try {
      const I = container.support('I');
      // eslint-disable-next-line no-eval
      const result = await eval(execCmd);
      history.push(cmd);
      if (result) log('=>', chalk.cyan(result));
    } catch (err) {
      console.log(err);
      log(err);
    } finally {
      // Always restore the recorder session
    }

    recorder.session.catch((err: any) => {
      const msg = err.cliMessage ? err.cliMessage() : err.message;

      log('Error:', chalk.red(msg));
    });

    recorder.session.restore('pause');
    // Reset command input
    setCommand('');

    // Notify parent that command was submitted (for recreation)
    onCommandSubmit?.();
  };

  const submitCommand = async (value: string) => {
    let payload = value;
    if (showAutocomplete && filteredCommands.length > 0) {
      const chosen = filteredCommands[autocompleteMode ? selectedIndex : 0];
      if (!value.trim() || autocompleteMode) {
        payload = chosen || value;
      }
    }
    await handleSubmit(payload);
    setAutocompleteMode(false);
    setSelectedIndex(0);
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" flexGrow={1} padding={1} marginTop={1}>
      {!command.trim() && (
        <>
          <Text color="yellow">Interactive shell started</Text>
          <Text color="yellow">Use JavaScript syntax to try steps in action</Text>
          <Text color="yellow">- Press ENTER on a blank line, or type "exit" or "resume" to exit</Text>
          <Text color="yellow">- Prefix commands with &quot;=&gt;&quot; for custom commands</Text>
        </>
      )}
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color="green">&gt; </Text>
          <TextInput value={command} onChange={setCommand} onSubmit={submitCommand} placeholder="Enter command..." />
        </Box>
        <AutocompletePane
          commands={filteredCommands}
          input={command}
          selectedIndex={selectedIndex}
          onSelect={(index) => {
            const chosen = filteredCommands[index];
            if (chosen) {
              setCommand(chosen);
              setAutocompleteMode(false);
            }
          }}
          visible={showAutocomplete}
        />
        {filteredCommands.length > 0 && (
          <Text color="gray" dimColor>
            {autocompleteMode ? '↑↓ navigate, Tab/Enter to select, Esc to exit' : 'Enter for first match, ↓ to navigate'}
          </Text>
        )}
      </Box>
    </Box>
  );
};

export default PausePane;

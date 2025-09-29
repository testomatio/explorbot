import chalk from 'chalk';
import { container, output, recorder, store } from 'codeceptjs';
import { Box, Text } from 'ink';
import React, { useState, useEffect } from 'react';
import { createDebug, getMethodsOfObject, log } from '../utils/logger.ts';
// import InputPane from './InputPane.js';
import AutocompleteInput from './AutocompleteInput.js';

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
  // Handle the submission of a command
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
      <Box marginTop={1}>
        <AutocompleteInput value={command} onChange={setCommand} onSubmit={handleSubmit} placeholder="Enter command..." suggestions={commands} showAutocomplete={true} />
        {/* <InputPane
          value={command}
          onChange={setCommand}
          onSubmit={handleSubmit}
          placeholder="Enter command..."
        /> */}
      </Box>
    </Box>
  );
};

export default PausePane;

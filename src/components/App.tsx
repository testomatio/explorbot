import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Box, Text, measureElement, Static } from 'ink';
import LogPane from './LogPane.js';
import InputPane from './InputPane.js';
import PausePane from './PausePane.js';
import ActivityPane from './ActivityPane.js';
import AutocompletePane from './AutocompletePane.js';
import StateTransitionPane from './StateTransitionPane.js';
import TerminalPane from './TerminalPane.tsx';
import Welcome from './Welcome.js';
import type { ExplorBot, ExplorBotOptions } from '../explorbot.ts';
import { CommandHandler } from '../command-handler.js';
import type {
  StateManager,
  StateTransition,
  WebPageState,
} from '../state-manager.js';
import { setLogCallback, type TaggedLogEntry } from '../utils/logger.js';

interface AppProps {
  explorBot: ExplorBot;
  initialShowInput?: boolean;
  exitOnEmptyInput?: boolean;
}

export function App({
  explorBot,
  initialShowInput = false,
  exitOnEmptyInput = false,
}: AppProps) {
  const [showInput, setShowInput] = useState(initialShowInput);
  const [stateManager, setStateManager] = useState<StateManager | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [logs, setLogs] = useState<(string | TaggedLogEntry)[]>([]);
  const [currentState, setCurrentState] = useState<WebPageState | null>(null);
  const [lastTransition, setLastTransition] = useState<StateTransition | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [showWelcome, setShowWelcome] = useState(true);
  const [startupSuccessful, setStartupSuccessful] = useState(false);
  const [verboseMode, setVerboseMode] = useState(false);
  const [commandHandler] = useState(() => new CommandHandler(explorBot));
  const [inputValue, setInputValue] = useState('');
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [userInputPromise, setUserInputPromise] = useState<{
    resolve: (value: string | null) => void;
    reject: (reason?: any) => void;
  } | null>(null);

  // Create a stable callback for logging
  const addLog = useCallback((logEntry: string | TaggedLogEntry) => {
    setLogs((prevLogs) => {
      // Prevent duplicate consecutive logs
      if (prevLogs.length > 0) {
        const lastLog = prevLogs[prevLogs.length - 1];
        if (
          typeof lastLog === 'string' &&
          typeof logEntry === 'string' &&
          lastLog === logEntry
        ) {
          return prevLogs;
        }
        if (
          typeof lastLog === 'object' &&
          'type' in lastLog &&
          typeof logEntry === 'object' &&
          'type' in logEntry &&
          lastLog.type === logEntry.type &&
          lastLog.content === logEntry.content
        ) {
          return prevLogs;
        }
      }
      return [...prevLogs.slice(-50), logEntry]; // Keep last 50 logs
    });
  }, []);

  const startMain = async (): Promise<(() => void) | undefined> => {
    try {
      // Set verbose mode based on ExplorBot options
      setVerboseMode(explorBot.getOptions()?.verbose || false);

      setShowInput(false);
      explorBot.setUserResolve(async (error?: Error) => {
        if (error) {
          console.error('Error occurred:', error.message);
        }
        setShowInput(true);

        // Return a promise that resolves when user submits input
        return new Promise<string | null>((resolve, reject) => {
          setUserInputPromise({ resolve, reject });
        });
      });

      await explorBot.start();

      const manager = explorBot.getExplorer().getStateManager();
      setStateManager(manager);

      // Get initial current state
      const initialState = manager.getCurrentState();
      if (initialState) {
        setCurrentState(initialState);
      }

      // Subscribe to state changes
      const unsubscribe = manager.onStateChange(
        (transition: StateTransition) => {
          setLastTransition(transition);
          setCurrentState(transition.toState);
        }
      );

      setShowInput(false);

      // Mark loading as complete and startup as successful
      setIsLoading(false);
      setStartupSuccessful(true);

      // Show input BEFORE visitInitialState so it's ready when plan() asks for input
      setShowInput(true);

      await explorBot.visitInitialState();

      // Show welcome for a brief moment, then transition to main interface
      setTimeout(() => {
        setShowWelcome(false);
      }, 2000);

      // Return cleanup function
      return unsubscribe;
    } catch (error) {
      console.error('Failed to start ExplorBot:', error);
      console.error('Exiting gracefully...');
      process.exit(1);
    }
  };

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    const isComponentMounted = true;

    // Set up log callback immediately when component mounts
    process.env.INK_RUNNING = '1';
    setLogCallback((entry: any) => {
      addLog(entry);
    });

    // Add an initial log to test
    addLog('🚀 Starting ExplorBot...');

    const initializeApp = async () => {
      if (isComponentMounted) {
        cleanup = await startMain();
      }
    };

    initializeApp();
  }, []);

  const logContentRef = useRef<any>(null);
  const [logRows, setLogRows] = useState(0);
  const [logCols, setLogCols] = useState<number>(
    Math.max(10, (process.stdout.columns || 80) - 4)
  );

  // Removed alternate screen mode to allow normal terminal scrolling

  // Don't render anything until startup is successful
  if (!startupSuccessful) {
    return null;
  }

  if (isPaused) {
    return <PausePane onExit={() => setIsPaused(false)} />;
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" flexGrow={1}>
        <LogPane logs={logs} verboseMode={verboseMode} />
      </Box>

      {showInput ? (
        <>
          <Box height={1} />
          <InputPane
            value={inputValue}
            onChange={(value: string) => {
              setInputValue(value);
              setSelectedIndex(0);
              setShowAutocomplete(
                value.startsWith('/') || value.startsWith('I.')
              );
            }}
            onAutocompleteNavigate={(direction: 'up' | 'down') => {
              if (!showAutocomplete) return;
              const commands = commandHandler.getAvailableCommands();
              const filtered = inputValue.trim()
                ? commands
                    .filter((cmd) =>
                      cmd
                        .toLowerCase()
                        .includes(inputValue.toLowerCase().replace(/^i\./, ''))
                    )
                    .slice(0, 20)
                : commands.slice(0, 20);

              if (filtered.length === 0) return;

              setSelectedIndex((prev) => {
                if (direction === 'up') {
                  return prev > 0 ? prev - 1 : filtered.length - 1;
                } else {
                  return prev < filtered.length - 1 ? prev + 1 : 0;
                }
              });
            }}
            onAutocompleteSelect={() => {
              if (!showAutocomplete) return;
              const commands = commandHandler.getAvailableCommands();
              const filtered = inputValue.trim()
                ? commands
                    .filter((cmd) =>
                      cmd
                        .toLowerCase()
                        .includes(inputValue.toLowerCase().replace(/^i\./, ''))
                    )
                    .slice(0, 20)
                : commands.slice(0, 20);

              if (selectedIndex < filtered.length) {
                setInputValue(filtered[selectedIndex]);
                setShowAutocomplete(false);
              }
            }}
            onSubmit={async (input: string) => {
              if (!input.trim()) {
                if (exitOnEmptyInput) {
                  process.exit(0);
                }
                // If we're waiting for user input, resolve with null
                if (userInputPromise) {
                  userInputPromise.resolve(null);
                  setUserInputPromise(null);
                  setShowInput(false);
                  setInputValue('');
                  setShowAutocomplete(false);
                }
                return;
              }

              // Check if this is a command (starts with / or I.)
              const isCommand = input.startsWith('/') || input.startsWith('I.');

              if (userInputPromise) {
                // If we're waiting for user input, resolve with the input
                userInputPromise.resolve(input);
                setUserInputPromise(null);
                setShowInput(false);
                setInputValue('');
                setShowAutocomplete(false);
              } else if (isCommand) {
                // Otherwise, execute as command
                try {
                  setShowInput(false);
                  setInputValue('');
                  setShowAutocomplete(false);
                  await commandHandler.executeCommand(input);
                  setShowInput(false);
                } catch (error) {
                  console.error('Command failed:', error);
                  setShowInput(false);
                }
              }
            }}
          />
          <AutocompletePane
            commands={commandHandler.getAvailableCommands()}
            input={inputValue}
            selectedIndex={selectedIndex}
            onSelect={(index: number) => {
              const commands = commandHandler.getAvailableCommands();
              const filtered = inputValue.trim()
                ? commands
                    .filter((cmd) =>
                      cmd
                        .toLowerCase()
                        .includes(inputValue.toLowerCase().replace(/^i\./, ''))
                    )
                    .slice(0, 20)
                : commands.slice(0, 20);

              if (index < filtered.length) {
                setInputValue(filtered[index]);
                setShowAutocomplete(false);
              }
            }}
            visible={showAutocomplete}
          />
        </>
      ) : (
        <Box height={1} marginBottom={1}>
          <ActivityPane />
        </Box>
      )}

      {currentState && <StateTransitionPane currentState={currentState} />}
    </Box>
  );
}

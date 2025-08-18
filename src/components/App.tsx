import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Box, Text, measureElement } from 'ink';
import LogPane from './LogPane.js';
import InputPane from './InputPane.js';
import PausePane from './PausePane.js';
import ActivityPane from './ActivityPane.js';
import AutocompletePane from './AutocompletePane.js';
import Welcome from './Welcome.js';
import { ExplorBot, type ExplorBotOptions } from '../explorbot.ts';
import type {
  StateManager,
  StateTransition,
  WebPageState,
} from '../state-manager.js';
import { setLogCallback } from '../utils/logger.js';

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
  const [logs, setLogs] = useState<string[]>([]);
  const [currentState, setCurrentState] = useState<WebPageState | null>(null);
  const [lastTransition, setLastTransition] = useState<StateTransition | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [showWelcome, setShowWelcome] = useState(true);

  // Create a stable callback for logging
  const addLog = useCallback((logEntry: string) => {
    setLogs((prevLogs) => {
      // Prevent duplicate consecutive logs
      if (prevLogs.length > 0 && prevLogs[prevLogs.length - 1] === logEntry) {
        return prevLogs;
      }
      return [...prevLogs.slice(-50), logEntry]; // Keep last 50 logs
    });
  }, []);

  const startMain = async (): Promise<(() => void) | undefined> => {
    try {
      explorBot.setUserResolve(async (error: Error) => {
        console.error('Error occurred:', error.message);
        setShowInput(true);
        return null;
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

      if (!explorBot.needsInput) {
        setShowInput(false);
      }

      // Mark loading as complete
      setIsLoading(false);

      // Show welcome for a brief moment, then transition to main interface
      setTimeout(() => {
        setShowWelcome(false);
      }, 2000);

      // Return cleanup function
      return unsubscribe;
    } catch (error) {
      console.error('Failed to start:', error);
      setShowInput(true);
      setIsLoading(false);
      return undefined;
    }
  };

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let isComponentMounted = true;

    // Set up log callback immediately when component mounts
    process.env.INK_RUNNING = '1';
    setLogCallback(addLog);

    // Add an initial log to test
    addLog('🚀 Starting ExplorBot...');

    const initializeApp = async () => {
      if (isComponentMounted) {
        cleanup = await startMain();
      }
    };

    initializeApp();
  }, []);

  if (isPaused) {
    return <PausePane onExit={() => setIsPaused(false)} />;
  }

  const logContentRef = useRef<any>(null);
  const [logRows, setLogRows] = useState(0);
  const [logCols, setLogCols] = useState<number>(
    Math.max(10, (process.stdout.columns || 80) - 4)
  );

  const didEnterAlt = useRef(false);
  useEffect(() => {
    if (!isLoading && !showWelcome && !didEnterAlt.current) {
      process.stdout.write('\x1b[?1049h\x1b[H\x1b[?25l');
      didEnterAlt.current = true;
    }
  }, [isLoading, showWelcome]);

  useEffect(() => {
    return () => {
      if (didEnterAlt.current) {
        process.stdout.write('\x1b[?1049l\x1b[?25h');
      }
    };
  }, []);

  return (
    <Box flexDirection="column" height={process.stdout.rows || 24}>
      <Box borderStyle="round" borderColor="green" padding={1} height={process.stdout.rows - 10} flexGrow={1}>
        <Box flexDirection="column" height="100%">
          <Box height={1}>
            <Text bold color="green">
              Logs:
            </Text>
          </Box>
          <Box overflow="hidden" flexGrow={1}>
            <LogPane logs={logs} />
          </Box>
        </Box>
      </Box>

      <Box borderStyle="round" overflow="hidden" borderColor="blue" height={7} padding={1}>
        <Box flexDirection="column">
          <Text bold color="blue">
            State:
          </Text>
          {currentState ? (
            <>
              <Text>
                URL: {currentState.fullUrl || currentState.url || 'unknown'}
              </Text>
              <Text>Title: {currentState.title || 'none'}</Text>
              {currentState.timestamp && (
                <Text color="gray">
                  Updated: {currentState.timestamp.toLocaleTimeString()}
                </Text>
              )}
            </>
          ) : (
            <Text color="gray">No state yet</Text>
          )}
          {lastTransition && (
            <Text color="dim">
              Last: {lastTransition.trigger} at{' '}
              {lastTransition.timestamp.toLocaleTimeString()}
            </Text>
          )}
        </Box>
      </Box>


      <Box height={1}>
        <ActivityPane />
      </Box>

      {showInput && (
        <InputPane
          value=""
          onChange={() => {}}
          onSubmit={async (input: string) => {
            if (!input.trim()) {
              if (exitOnEmptyInput) {
                process.exit(0);
              }
              return;
            }

            try {
              setShowInput(false);
              await explorBot.getExplorer().visit(input);
              setShowInput(true);
            } catch (error) {
              console.error('Visit failed:', error);
              setShowInput(true);
            }
          }}
        />
      )}
      <AutocompletePane
        commands={[]}
        input=""
        selectedIndex={0}
        onSelect={() => {}}
        visible={false}
      />
    </Box>
  );
}

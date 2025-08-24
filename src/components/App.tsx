import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Box, Text, measureElement, Static } from 'ink';
import LogPane from './LogPane.js';
import InputPane from './InputPane.js';
import PausePane from './PausePane.js';
import ActivityPane from './ActivityPane.js';
import AutocompletePane from './AutocompletePane.js';
import StateTransitionPane from './StateTransitionPane.js';
import Welcome from './Welcome.js';
import { ExplorBot, type ExplorBotOptions } from '../explorbot.ts';
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

  // Create a stable callback for logging
  const addLog = useCallback((logEntry: string | TaggedLogEntry) => {
    setLogs((prevLogs) => {
      // Prevent duplicate consecutive logs
      if (prevLogs.length > 0) {
        const lastLog = prevLogs[prevLogs.length - 1];
        if (typeof lastLog === 'string' && typeof logEntry === 'string' && lastLog === logEntry) {
          return prevLogs;
        }
        if (typeof lastLog === 'object' && 'type' in lastLog && typeof logEntry === 'object' && 'type' in logEntry && 
            lastLog.type === logEntry.type && lastLog.content === logEntry.content) {
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

      // Mark loading as complete and startup as successful
      setIsLoading(false);
      setStartupSuccessful(true);

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
    let isComponentMounted = true;

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

      {currentState && <StateTransitionPane currentState={currentState} />}

      <Box height={1}>
        <ActivityPane />
      </Box>

      {showInput && (
        <>
          <Box height={1}  />
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
        </>
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

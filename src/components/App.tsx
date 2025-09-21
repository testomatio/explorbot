import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import LogPane from './LogPane.js';
import InputPane from './InputPane.js';
import PausePane from './PausePane.js';
import ActivityPane from './ActivityPane.js';
import StateTransitionPane from './StateTransitionPane.js';
import Welcome from './Welcome.js';
import type { ExplorBot, ExplorBotOptions } from '../explorbot.ts';
import { CommandHandler } from '../command-handler.js';
import type {
  StateManager,
  StateTransition,
  WebPageState,
} from '../state-manager.js';
import type { TaggedLogEntry } from '../utils/logger.js';

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
  const [currentState, setCurrentState] = useState<WebPageState | null>(null);
  const [lastTransition, setLastTransition] = useState<StateTransition | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [showWelcome, setShowWelcome] = useState(true);
  const [startupSuccessful, setStartupSuccessful] = useState(false);
  const [commandHandler] = useState(() => new CommandHandler(explorBot));
  const [userInputPromise, setUserInputPromise] = useState<{
    resolve: (value: string | null) => void;
    reject: (reason?: any) => void;
  } | null>(null);

  const startMain = async (): Promise<(() => void) | undefined> => {
    try {
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
    startMain().then((cleanup) => {
    }).catch((error) => {
      console.error('Failed to start ExplorBot:', error);
      process.exit(1);
    });
  }, []);

  if (isPaused) {
    return <PausePane onExit={() => setIsPaused(false)} />;
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" flexGrow={1}>
        <LogPane verboseMode={explorBot.getOptions()?.verbose || false} />
      </Box>

      {showInput ? (
        <>
          <Box height={1} />
          <InputPane
            commandHandler={commandHandler}
            onSubmit={async (input: string) => {
              // If we're waiting for user input, resolve with the input
              if (userInputPromise) {
                userInputPromise.resolve(input);
                setUserInputPromise(null);
                setShowInput(false);
              }
            }}
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

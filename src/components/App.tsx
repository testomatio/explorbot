import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import LogPane from './LogPane.js';
import InputPane from './InputPane.js';
import ActivityPane from './ActivityPane.js';
import StateTransitionPane from './StateTransitionPane.js';
import type { ExplorBot, ExplorBotOptions } from '../explorbot.ts';
import { CommandHandler } from '../command-handler.js';
import type { StateTransition, WebPageState } from '../state-manager.js';

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
  const [currentState, setCurrentState] = useState<WebPageState | null>(null);
  const [lastTransition, setLastTransition] = useState<StateTransition | null>(
    null
  );
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

        return new Promise<string | null>((resolve, reject) => {
          setUserInputPromise({ resolve, reject });
        });
      });

      await explorBot.start();

      const manager = explorBot.getExplorer().getStateManager();

      const initialState = manager.getCurrentState();
      if (initialState) {
        setCurrentState(initialState);
      }

      const unsubscribe = manager.onStateChange(
        (transition: StateTransition) => {
          setLastTransition(transition);
          setCurrentState(transition.toState);
        }
      );

      setShowInput(false);

      await explorBot.visitInitialState();

      return unsubscribe;
    } catch (error) {
      console.error('Failed to start ExplorBot:', error);
      console.error('Exiting gracefully...');
      process.exit(1);
    }
  };

  useEffect(() => {
    startMain()
      .then((cleanup) => {})
      .catch((error) => {
        console.error('Failed to start ExplorBot:', error);
        process.exit(1);
      });
  }, []);

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
              if (userInputPromise) {
                userInputPromise.resolve(input);
                setUserInputPromise(null);
                setShowInput(false);
              }
            }}
            onCommandStart={() => {
              setShowInput(false);
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

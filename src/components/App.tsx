import { Box, Text, useInput } from 'ink';
import React, { useEffect, useRef, useState } from 'react';
import { CommandHandler } from '../command-handler.js';
import type { ExplorBot, ExplorBotOptions } from '../explorbot.ts';
import type { StateTransition, WebPageState } from '../state-manager.js';
import { Test } from '../test-plan.ts';
import ActivityPane from './ActivityPane.js';
import InputPane from './InputPane.js';
import LogPane from './LogPane.js';
import StateTransitionPane from './StateTransitionPane.js';
import TaskPane from './TaskPane.js';
import SessionTimer from './SessionTimer.js';

interface AppProps {
  explorBot: ExplorBot;
  initialShowInput?: boolean;
  exitOnEmptyInput?: boolean;
}

export function App({ explorBot, initialShowInput = false, exitOnEmptyInput = false }: AppProps) {
  const sessionStartedAtRef = useRef<number>(Date.now());
  const [showSessionTimer, setShowSessionTimer] = useState(false);
  const [showInput, setShowInput] = useState(initialShowInput);
  const [currentState, setCurrentState] = useState<WebPageState | null>(null);
  const [lastTransition, setLastTransition] = useState<StateTransition | null>(null);
  const [tasks, setTasks] = useState<Test[]>([]);
  const [commandHandler] = useState(() => new CommandHandler(explorBot));
  const [userInputPromise, setUserInputPromise] = useState<{
    resolve: (value: string | null) => void;
    reject: (reason?: any) => void;
  } | null>(null);

  const startMain = React.useCallback(async (): Promise<(() => void) | undefined> => {
    process.env.INK_RUNNING = 'true';
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

      const unsubscribe = manager.onStateChange((transition: StateTransition) => {
        setLastTransition(transition);
        setCurrentState(transition.toState);
      });

      setShowInput(false);

      await explorBot.visitInitialState();

      return unsubscribe;
    } catch (error) {
      console.error('Failed to start ExplorBot:', error);
      console.error('Exiting gracefully...');
      process.exit(1);
    }
  }, [explorBot]);

  useEffect(() => {
    startMain()
      .then((cleanup) => {})
      .catch((error) => {
        console.error('Failed to start ExplorBot:', error);
        process.exit(1);
      });
  }, [startMain]);

  // Listen for task changes
  useEffect(() => {
    const interval = setInterval(() => {
      const currentTasks = explorBot.getCurrentPlan()?.tests || [];
      setTasks(currentTasks);
    }, 1000); // Check every second

    return () => clearInterval(interval);
  }, [explorBot]);

  useInput((input, key) => {
    if (key.ctrl && input === 't') {
      setShowSessionTimer((prev) => !prev);
      return;
    }

    if (key.escape) {
      setShowInput(true);
      return;
    }

    if (key.ctrl && input === 'c') {
      process.exit(0);
    }
  });


  return (
    <Box flexDirection="column">
      <Box flexDirection="column" flexGrow={1}>
        <LogPane verboseMode={explorBot.getOptions()?.verbose || false} />
      </Box>

      <Box
        height={3}
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        paddingX={1}
      >
        <ActivityPane />
        {showSessionTimer && (
          <SessionTimer startedAt={sessionStartedAtRef.current} />
        )}
      </Box>

      {showInput && <Box height={1} />}
      <InputPane
        commandHandler={commandHandler}
        onSubmit={async (input: string) => {
          if (userInputPromise) {
            userInputPromise.resolve(input);
            setUserInputPromise(null);
          }
          setShowInput(false);
        }}
        onCommandStart={() => {
          setShowInput(false);
        }}
        onCommandComplete={() => {
          setShowInput(false);
        }}
        isActive={showInput}
        visible={showInput}
      />

      <Box flexDirection="row" alignItems="flex-start" columnGap={1} minHeight={5}>
        {currentState && (
          <Box width={tasks.length > 0 ? '50%' : '100%'}>
            <StateTransitionPane currentState={currentState} />
          </Box>
        )}
        {tasks.length > 0 && (
          <Box width={currentState ? '50%' : '100%'}>
            <TaskPane tasks={tasks} />
          </Box>
        )}
      </Box>
    </Box>
  );
}

import { Box, Text, useInput } from 'ink';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CommandHandler } from '../command-handler.js';
import type { ExplorBot, ExplorBotOptions } from '../explorbot.ts';
import type { StateTransition, WebPageState } from '../state-manager.js';
import { Test } from '../test-plan.ts';
import ActivityPane from './ActivityPane.js';
import InputPane from './InputPane.js';
import InputReadline from './InputReadline.js';
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
  const useReadline = process.env.FEATURE_READLINE === 'true' || process.env.FEATURE_READLINE === '1';
  const InputComponent = useReadline ? InputReadline : InputPane;
  const [showSessionTimer, setShowSessionTimer] = useState(false);
  const [showInput, setShowInput] = useState(initialShowInput);
  const [currentState, setCurrentState] = useState<WebPageState | null>(null);
  const [lastTransition, setLastTransition] = useState<StateTransition | null>(null);
  const [tasks, setTasks] = useState<Test[]>([]);
  const [commandHandler] = useState(() => new CommandHandler(explorBot));
  const userInputPromiseRef = useRef<{
    resolve: (value: string | null) => void;
    reject: (reason?: any) => void;
  } | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let mounted = true;

    const startMain = async () => {
      process.env.INK_RUNNING = 'true';
      try {
        setShowInput(false);
        explorBot.setUserResolve(async (error?: Error) => {
          if (error) {
            console.error('Error occurred:', error.message);
          }
          setShowInput(true);

          return new Promise<string | null>((resolve, reject) => {
            userInputPromiseRef.current = { resolve, reject };
          });
        });

        await explorBot.start();

        const manager = explorBot.getExplorer().getStateManager();

        const initialState = manager.getCurrentState();
        if (initialState && mounted) {
          setCurrentState(initialState);
        }

        unsubscribe = manager.onStateChange((transition: StateTransition) => {
          if (mounted) {
            setLastTransition(transition);
            setCurrentState(transition.toState);
          }
        });

        if (mounted) {
          setShowInput(false);
        }

        await explorBot.visitInitialState();
      } catch (error) {
        console.error('Failed to start ExplorBot:', error);
        console.error('Exiting gracefully...');
        process.exit(1);
      }
    };

    startMain().catch((error) => {
      console.error('Failed to start ExplorBot:', error);
      process.exit(1);
    });

    return () => {
      mounted = false;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [explorBot]);

  // Listen for task changes - only update if tasks actually changed
  const tasksRef = useRef<Test[]>([]);
  useEffect(() => {
    const interval = setInterval(() => {
      const currentTasks = explorBot.getCurrentPlan()?.tests || [];
      if (currentTasks.length !== tasksRef.current.length || currentTasks.some((t, i) => t !== tasksRef.current[i])) {
        tasksRef.current = currentTasks;
        setTasks(currentTasks);
      }
    }, 1000);

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

  const handleInputSubmit = useCallback(async (input: string) => {
    if (userInputPromiseRef.current) {
      userInputPromiseRef.current.resolve(input);
      userInputPromiseRef.current = null;
    }
    setShowInput(false);
  }, []);

  const handleCommandStart = useCallback(() => {
    setShowInput(false);
  }, []);

  const handleCommandComplete = useCallback(() => {
    setShowInput(true);
  }, []);

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" flexGrow={1}>
        <LogPane verboseMode={explorBot.getOptions()?.verbose || false} />
      </Box>

      <Box height={3} flexDirection="row" justifyContent="space-between" alignItems="center" paddingX={1}>
        <ActivityPane isInputVisible={showInput} />
        {showSessionTimer && <SessionTimer startedAt={sessionStartedAtRef.current} />}
      </Box>

      {showInput && <Box height={1} />}
      <InputComponent commandHandler={commandHandler} onSubmit={handleInputSubmit} onCommandStart={handleCommandStart} onCommandComplete={handleCommandComplete} isActive={showInput} visible={showInput} />

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

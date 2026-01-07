import { Box, Text, useInput } from 'ink';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CommandHandler } from '../command-handler.js';
import { executionController } from '../execution-controller.ts';
import type { ExplorBot, ExplorBotOptions } from '../explorbot.ts';
import type { StateTransition, WebPageState } from '../state-manager.js';
import { Test } from '../test-plan.ts';
import ActivityPane from './ActivityPane.js';
import Autocomplete from './Autocomplete.js';
import InputPane from './InputPane.js';
import InputReadline from './InputReadline.js';
import LogPane from './LogPane.js';
import SessionTimer from './SessionTimer.js';
import StateTransitionPane from './StateTransitionPane.js';
import TaskPane from './TaskPane.js';

interface AppProps {
  explorBot: ExplorBot;
  initialShowInput?: boolean;
  exitOnEmptyInput?: boolean;
}

export function App({ explorBot, initialShowInput = false, exitOnEmptyInput = false }: AppProps) {
  const sessionStartedAtRef = useRef<number>(Date.now());
  const InputComponent = InputReadline;
  const [showSessionTimer, setShowSessionTimer] = useState(false);
  const [showInput, setShowInput] = useState(initialShowInput);
  const [interruptPrompt, setInterruptPrompt] = useState<string | null>(null);
  const [currentState, setCurrentState] = useState<WebPageState | null>(null);
  const [lastTransition, setLastTransition] = useState<StateTransition | null>(null);
  const [tasks, setTasks] = useState<Test[]>([]);
  const [commandHandler] = useState(() => new CommandHandler(explorBot));
  const userInputPromiseRef = useRef<{
    resolve: (value: string | null) => void;
    reject: (reason?: any) => void;
  } | null>(null);
  const interruptResolveRef = useRef<((value: string | null) => void) | null>(null);

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

  useEffect(() => {
    executionController.setInputCallback(async (prompt: string) => {
      setInterruptPrompt(prompt);
      setShowInput(true);

      return new Promise<string | null>((resolve) => {
        interruptResolveRef.current = resolve;
      });
    });

    return () => {
      executionController.reset();
    };
  }, []);

  const planRef = useRef<ReturnType<typeof explorBot.getCurrentPlan>>(undefined);
  const unsubscribeRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    const subscribeToPlan = (plan: NonNullable<ReturnType<typeof explorBot.getCurrentPlan>>) => {
      if (unsubscribeRef.current) unsubscribeRef.current();
      planRef.current = plan;
      setTasks([...plan.tests]);
      unsubscribeRef.current = plan.onTestsChange((updatedTests) => {
        setTasks([...updatedTests]);
      });
    };

    const initialPlan = explorBot.getCurrentPlan();
    if (initialPlan) subscribeToPlan(initialPlan);

    const interval = setInterval(() => {
      const currentPlan = explorBot.getCurrentPlan();
      if (currentPlan && currentPlan !== planRef.current) {
        subscribeToPlan(currentPlan);
      }
    }, 2000);

    return () => {
      clearInterval(interval);
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, [explorBot]);

  useInput((input, key) => {
    if (key.ctrl && input === 't') {
      setShowSessionTimer((prev) => !prev);
      return;
    }

    if (key.escape) {
      if (!showInput) {
        executionController.interrupt();
      }
      return;
    }

    if (key.ctrl && input === 'c') {
      explorBot.stop().then(() => {
        process.exit(0);
      });
    }
  });

  const handleInputSubmit = useCallback(async (input: string) => {
    if (interruptResolveRef.current) {
      interruptResolveRef.current(input);
      interruptResolveRef.current = null;
      setInterruptPrompt(null);
      setShowInput(false);
      return;
    }

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
      {interruptPrompt && showInput && (
        <Box paddingX={1}>
          <Text color="yellow">{interruptPrompt}</Text>
        </Box>
      )}
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
        <Autocomplete />
      </Box>
    </Box>
  );
}

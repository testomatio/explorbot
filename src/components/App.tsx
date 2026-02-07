import { Box, Text, useInput } from 'ink';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CommandHandler } from '../command-handler.js';
import type { ExplorbotConfig } from '../config.js';
import { executionController } from '../execution-controller.ts';
import type { ExplorBot, ExplorBotOptions } from '../explorbot.ts';
import type { KnowledgeTracker } from '../knowledge-tracker.js';
import type { StateTransition, WebPageState } from '../state-manager.js';
import { Test } from '../test-plan.ts';
import { tag } from '../utils/logger.js';
import ActivityPane from './ActivityPane.js';
import Autocomplete from './Autocomplete.js';
import InputPane from './InputPane.js';
import InputReadline from './InputReadline.js';
import LogPane from './LogPane.js';
import SessionTimer from './SessionTimer.js';
import StateTransitionPane from './StateTransitionPane.js';
import TaskPane from './TaskPane.js';
import WelcomeChecklist from './WelcomeChecklist.js';
import WelcomeCommands from './WelcomeCommands.js';

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
  const [checklistData, setChecklistData] = useState<{ config: ExplorbotConfig; knowledgeTracker: KnowledgeTracker } | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const userInputPromiseRef = useRef<{
    resolve: (value: string | null) => void;
    reject: (reason?: any) => void;
  } | null>(null);
  const interruptResolveRef = useRef<((value: string | null) => void) | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let mounted = true;

    process.env.INK_RUNNING = 'true';

    explorBot.setUserResolve(async (error?: Error, showWelcomeFlag?: boolean) => {
      if (error) {
        console.error('Error occurred:', error.message);
      }
      if (showWelcomeFlag) {
        setShowWelcome(true);
      }
      setShowInput(true);

      return new Promise<string | null>((resolve, reject) => {
        userInputPromiseRef.current = { resolve, reject };
      });
    });

    const manager = explorBot.getExplorer().getStateManager();

    unsubscribe = manager.onStateChange((transition: StateTransition) => {
      if (mounted) {
        setLastTransition(transition);
        setCurrentState(transition.toState);
      }
    });

    if (mounted) {
      setChecklistData({
        config: explorBot.getConfig(),
        knowledgeTracker: explorBot.getKnowledgeTracker(),
      });
      setShowWelcome(true);
    }

    const initialState = manager.getCurrentState();
    if (initialState && mounted) {
      setCurrentState(initialState);
    }

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

    const handleIdle = () => {
      setShowInput(true);
    };

    executionController.on('idle', handleIdle);

    return () => {
      executionController.off('idle', handleIdle);
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

  const handleInputSubmit = useCallback(
    async (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return;

      if (trimmed.toLowerCase() === '/help') {
        setShowWelcome(true);
      } else {
        setShowWelcome(false);
      }
      tag('input').log(`> ${trimmed}`);

      const isCommand = trimmed.startsWith('/') || trimmed.startsWith('I.');

      if (isCommand) {
        setInterruptPrompt(null);
        setShowInput(false);
        interruptResolveRef.current = null;
        await commandHandler.executeCommand(trimmed);
        setShowInput(true);
        return;
      }

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
    },
    [commandHandler]
  );

  const handleCommandStart = useCallback(() => {
    setShowInput(false);
  }, []);

  const handleCommandComplete = useCallback(() => {
    setShowInput(true);
  }, []);

  return (
    <Box flexDirection="column">
      {checklistData && <WelcomeChecklist config={checklistData.config} knowledgeTracker={checklistData.knowledgeTracker} />}
      <Box flexDirection="column" flexGrow={1}>
        <LogPane verboseMode={explorBot.getOptions()?.verbose || false} />
      </Box>

      <Box height={3} flexDirection="row" justifyContent="space-between" alignItems="center" paddingX={1}>
        <ActivityPane isInputVisible={showInput} />
        {showSessionTimer && <SessionTimer startedAt={sessionStartedAtRef.current} />}
      </Box>

      {showWelcome && <WelcomeCommands hasKnowledge={explorBot.getKnowledgeTracker().listAllKnowledge().length > 0} />}
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

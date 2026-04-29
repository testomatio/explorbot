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
import PlanEditor from './PlanEditor.js';
import PlanPane, { type PlanSummary } from './PlanPane.js';
import SessionTimer from './SessionTimer.js';
import StateTransitionPane from './StateTransitionPane.js';
import TaskPane, { WINDOW_SIZE } from './TaskPane.js';
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
  const tasksRef = useRef<Test[]>([]);
  const [showPlanEditor, setShowPlanEditor] = useState(false);
  const [taskScrollOffset, setTaskScrollOffset] = useState(0);
  const [commandHandler] = useState(() => new CommandHandler(explorBot));
  const [checklistData, setChecklistData] = useState<{ config: ExplorbotConfig; knowledgeTracker: KnowledgeTracker } | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const userInputPromiseRef = useRef<{
    resolve: (value: string | null) => void;
    reject: (reason?: any) => void;
  } | null>(null);
  const interruptResolveRef = useRef<((value: string | null) => void) | null>(null);

  useEffect(() => {
    // biome-ignore lint/style/useConst: assigned after declaration in useEffect pattern
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

  const [inputCallbackReady, setInputCallbackReady] = useState(false);

  useEffect(() => {
    executionController.setInputCallback(async (prompt: string) => {
      setInterruptPrompt(prompt);
      setShowInput(true);

      return new Promise<string | null>((resolve) => {
        interruptResolveRef.current = (value) => {
          interruptResolveRef.current = null;
          setInterruptPrompt(null);
          resolve(value);
        };
      });
    });

    const handleIdle = () => {
      setShowInput(true);
    };

    const handleInterrupt = () => {
      if (interruptResolveRef.current) {
        interruptResolveRef.current(null);
      }
    };

    executionController.on('idle', handleIdle);
    executionController.on('interrupt', handleInterrupt);
    setInputCallbackReady(true);

    return () => {
      executionController.off('idle', handleIdle);
      executionController.off('interrupt', handleInterrupt);
      executionController.reset();
    };
  }, []);

  useEffect(() => {
    if (!inputCallbackReady) return;

    let mounted = true;

    const visitInitial = async () => {
      try {
        await explorBot.visitInitialState();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        tag('error').log('Failed to start:', message);
      }
      if (!mounted) return;
      setChecklistData({
        config: explorBot.getConfig(),
        knowledgeTracker: explorBot.getKnowledgeTracker(),
      });
      setShowWelcome(true);
      setShowInput(true);
    };

    visitInitial();

    return () => {
      mounted = false;
    };
  }, [explorBot, inputCallbackReady]);

  const planRef = useRef<ReturnType<typeof explorBot.getCurrentPlan>>(undefined);
  const unsubscribeRef = useRef<(() => void) | undefined>(undefined);
  const [completedPlans, setCompletedPlans] = useState<PlanSummary[]>([]);
  const [activePlanInfo, setActivePlanInfo] = useState<PlanSummary | null>(null);

  useEffect(() => {
    const makeSummary = (plan: NonNullable<ReturnType<typeof explorBot.getCurrentPlan>>): PlanSummary => {
      const enabled = plan.tests.filter((t) => t.enabled);
      return {
        title: plan.title,
        testCount: enabled.length,
        passed: enabled.filter((t) => t.isSuccessful).length,
        failed: enabled.filter((t) => t.hasFailed).length,
      };
    };

    const subscribeToPlan = (plan: NonNullable<ReturnType<typeof explorBot.getCurrentPlan>>) => {
      if (unsubscribeRef.current) unsubscribeRef.current();

      if (planRef.current && planRef.current !== plan && planRef.current.tests.length > 0) {
        const summary = makeSummary(planRef.current);
        setCompletedPlans((prev) => {
          if (prev.some((p) => p.title === summary.title)) return prev;
          return [...prev, summary];
        });
      }

      planRef.current = plan;
      tasksRef.current = [...plan.tests];
      setTasks(tasksRef.current);
      setTaskScrollOffset(0);
      setActivePlanInfo(makeSummary(plan));

      let lastInProgressIdx = -1;
      unsubscribeRef.current = plan.onTestsChange((updatedTests) => {
        tasksRef.current = [...updatedTests];
        setTasks(tasksRef.current);
        setActivePlanInfo(makeSummary(plan));
        const inProgressIdx = updatedTests.findIndex((t) => t.status === 'in_progress' && t.enabled);
        if (inProgressIdx >= 0 && inProgressIdx !== lastInProgressIdx) {
          lastInProgressIdx = inProgressIdx;
          setTaskScrollOffset(Math.max(0, inProgressIdx - Math.floor(WINDOW_SIZE / 2)));
        }
      });
    };

    const initialPlan = explorBot.getCurrentPlan();
    if (initialPlan) subscribeToPlan(initialPlan);

    const interval = setInterval(() => {
      const currentPlan = explorBot.getCurrentPlan();
      if (currentPlan && currentPlan !== planRef.current) {
        subscribeToPlan(currentPlan);
      } else if (!currentPlan && planRef.current) {
        if (unsubscribeRef.current) unsubscribeRef.current();
        if (planRef.current.tests.length > 0) {
          const summary = makeSummary(planRef.current);
          setCompletedPlans((prev) => {
            if (prev.some((p) => p.title === summary.title)) return prev;
            return [...prev, summary];
          });
        }
        planRef.current = undefined;
        tasksRef.current = [];
        setTasks([]);
        setActivePlanInfo(null);
      }
    }, 2000);

    return () => {
      clearInterval(interval);
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, [explorBot]);

  useInput((input, key) => {
    if (key.escape) {
      if (!showInput) {
        executionController.interrupt();
      }
      return;
    }

    if (key.ctrl) {
      if (input === 'c') {
        explorBot.stop().then(() => {
          process.exit(0);
        });
        return;
      }
      if (input === 't') {
        setShowSessionTimer((prev) => !prev);
        return;
      }
      if (input === 'e' && tasksRef.current.length > 0) {
        setShowPlanEditor(true);
        return;
      }
      if (key.upArrow) {
        setTaskScrollOffset((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setTaskScrollOffset((prev) => prev + 1);
        return;
      }
    }

    if (!showInput && !showPlanEditor) {
      if (key.upArrow) {
        setTaskScrollOffset((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setTaskScrollOffset((prev) => prev + 1);
        return;
      }
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

      const isCommand = trimmed.startsWith('/') || trimmed.startsWith('I.') || trimmed.startsWith('page.') || trimmed.startsWith('await ');

      if (trimmed.toLowerCase() === '/plan:edit') {
        if (tasksRef.current.length > 0) setShowPlanEditor(true);
        return;
      }

      if (isCommand) {
        if (interruptResolveRef.current) {
          interruptResolveRef.current(null);
        }
        setShowInput(false);
        executionController.startExecution();
        try {
          await commandHandler.executeCommand(trimmed);
        } catch (error: any) {
          if (error?.name === 'AbortError') {
            tag('info').log('Operation cancelled');
          } else {
            throw error;
          }
        }
        setShowInput(true);
        return;
      }

      if (interruptResolveRef.current) {
        interruptResolveRef.current(input);
        setShowInput(false);
        return;
      }

      if (userInputPromiseRef.current) {
        userInputPromiseRef.current.resolve(input);
        userInputPromiseRef.current = null;
        setShowInput(false);
        return;
      }

      setShowInput(false);
      executionController.startExecution();
      try {
        await commandHandler.executeCommand(trimmed);
      } catch (error: any) {
        if (error?.name === 'AbortError') {
          tag('info').log('Operation cancelled');
        } else {
          throw error;
        }
      }
      setShowInput(true);
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

      {showPlanEditor && <PlanEditor tasks={tasks} onClose={() => setShowPlanEditor(false)} isActive={showPlanEditor} />}

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
      <Box display={showInput ? 'flex' : 'none'}>
        <InputComponent commandHandler={commandHandler} onSubmit={handleInputSubmit} onCommandStart={handleCommandStart} onCommandComplete={handleCommandComplete} isActive={showInput && !showPlanEditor} visible={true} />
      </Box>

      <Box flexDirection="row" alignItems="flex-start" columnGap={1} minHeight={5}>
        {currentState && (
          <Box width={tasks.length > 0 ? '50%' : '100%'}>
            <StateTransitionPane currentState={currentState} />
          </Box>
        )}
        {tasks.length > 0 && (
          <Box width={currentState ? '50%' : '100%'}>
            <TaskPane tasks={tasks} scrollOffset={taskScrollOffset} />
          </Box>
        )}
        <Autocomplete />
      </Box>

      <PlanPane completedPlans={completedPlans} activePlan={activePlanInfo} />
    </Box>
  );
}

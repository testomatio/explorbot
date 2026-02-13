import type { ExplorBot } from '../explorbot.js';
import type { BaseCommand } from './base-command.js';
import { CleanCommand } from './clean-command.js';
import { ContextAriaCommand } from './context-aria-command.js';
import { ContextCommand } from './context-command.js';
import { ContextDataCommand } from './context-data-command.js';
import { ContextExperienceCommand } from './context-experience-command.js';
import { ContextHtmlCommand } from './context-html-command.js';
import { ContextKnowledgeCommand } from './context-knowledge-command.js';
import { DrillCommand } from './drill-command.js';
import { ExitCommand } from './exit-command.js';
import { ExploreCommand } from './explore-command.js';
import { HelpCommand } from './help-command.js';
import { KnowCommand } from './know-command.js';
import { KnowsCommand } from './knows-command.js';
import { NavigateCommand } from './navigate-command.js';
import { PathCommand } from './path-command.js';
import { PlanClearCommand } from './plan-clear-command.js';
import { PlanCommand } from './plan-command.js';
import { PlanLoadCommand } from './plan-load-command.js';
import { PlanReloadCommand } from './plan-reload-command.js';
import { PlanSaveCommand } from './plan-save-command.js';
import { ResearchCommand } from './research-command.js';
import { StartCommand } from './start-command.js';
import { StatusCommand } from './status-command.tsx';
import { TestCommand } from './test-command.js';

export { BaseCommand } from './base-command.js';

type CommandClass = new (explorBot: ExplorBot) => BaseCommand;

const commandClasses: CommandClass[] = [
  HelpCommand,
  StartCommand,
  ExploreCommand,
  DrillCommand,
  CleanCommand,
  ResearchCommand,
  PlanCommand,
  PlanSaveCommand,
  PlanLoadCommand,
  PlanReloadCommand,
  PlanClearCommand,
  NavigateCommand,
  PathCommand,
  KnowCommand,
  KnowsCommand,
  ContextCommand,
  ContextAriaCommand,
  ContextHtmlCommand,
  ContextKnowledgeCommand,
  ContextExperienceCommand,
  ContextDataCommand,
  TestCommand,
  StatusCommand,
  ExitCommand,
];

export function createCommands(explorBot: ExplorBot): BaseCommand[] {
  return commandClasses.map((Cmd) => new Cmd(explorBot));
}

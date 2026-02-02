import type { ExplorBot } from '../explorbot.js';
import { AriaCommand } from './aria-command.js';
import type { BaseCommand } from './base-command.js';
import { CleanCommand } from './clean-command.js';
import { DataCommand } from './data-command.js';
import { ExitCommand } from './exit-command.js';
import { ExploreCommand } from './explore-command.js';
import { HelpCommand } from './help-command.js';
import { HtmlCommand } from './html-command.js';
import { KnowCommand } from './know-command.js';
import { KnowsCommand } from './knows-command.js';
import { NavigateCommand } from './navigate-command.js';
import { PlanCommand } from './plan-command.js';
import { PlanLoadCommand } from './plan-load-command.js';
import { PlanSaveCommand } from './plan-save-command.js';
import { ResearchCommand } from './research-command.js';
import { TestCommand } from './test-command.js';

export { BaseCommand } from './base-command.js';

type CommandClass = new (explorBot: ExplorBot) => BaseCommand;

const commandClasses: CommandClass[] = [HelpCommand, ExploreCommand, CleanCommand, ResearchCommand, PlanCommand, PlanSaveCommand, PlanLoadCommand, NavigateCommand, KnowCommand, KnowsCommand, AriaCommand, HtmlCommand, DataCommand, TestCommand, ExitCommand];

export function createCommands(explorBot: ExplorBot): BaseCommand[] {
  return commandClasses.map((Cmd) => new Cmd(explorBot));
}

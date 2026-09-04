import type { Command } from 'commander';

export abstract class BaseOption {
  abstract flags: string;
  abstract description: string;
  collect?: (value: string, previous: any) => any;

  register(program: Command): void {
    if (this.collect) program.option(this.flags, this.description, this.collect);
    if (!this.collect) program.option(this.flags, this.description);

    program.hook('preAction', (_thisCommand, actionCommand) => {
      this.apply(actionCommand.optsWithGlobals(), actionCommand);
    });
  }

  protected abstract apply(options: Record<string, any>, command: Command): void;
}

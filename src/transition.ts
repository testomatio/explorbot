import type { TransitionType } from './types/transition-type';

export class Transition {
  constructor(
    public readonly type: TransitionType,
    public readonly codeString: string,
    public readonly error: string | null = null,
    public readonly timestamp: Date = new Date()
  ) {}
}

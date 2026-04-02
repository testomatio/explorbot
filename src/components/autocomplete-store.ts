import { useSyncExternalStore } from 'react';
import type { CommandAutocompleteSuggestion } from '../command-handler.js';

interface AutocompleteState {
  suggestions: CommandAutocompleteSuggestion[];
  argumentHint?: string;
  selectedIndex: number;
  visible: boolean;
}

const listeners = new Set<() => void>();

let state: AutocompleteState = {
  suggestions: [],
  selectedIndex: 0,
  visible: false,
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => state;

export const setAutocompleteState = (next: AutocompleteState) => {
  state = next;
  for (const listener of listeners) {
    listener();
  }
};

export const useAutocompleteState = () => useSyncExternalStore(subscribe, getSnapshot);

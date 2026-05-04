import { adjectives, animals, colors, uniqueNamesGenerator } from 'unique-names-generator';

const nameConfig = {
  dictionaries: [adjectives, adjectives, colors],
  separator: '',
  length: 3,
  style: 'capital',
};

const explorationConfig = {
  dictionaries: [adjectives, animals],
  separator: '',
  length: 2,
  style: 'capital',
};

export function uniqSessionName(): string {
  const name = uniqueNamesGenerator(nameConfig);
  const randomNum = Math.floor(Math.random() * 999);
  return `${name}${randomNum}`;
}

export function uniqExplorationName(): string {
  const name = uniqueNamesGenerator(explorationConfig);
  const randomNum = Math.floor(Math.random() * 999);
  return `${name}${randomNum}`;
}

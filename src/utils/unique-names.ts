import { adjectives, animals, colors, uniqueNamesGenerator } from 'unique-names-generator';

const nameConfig = {
  dictionaries: [adjectives, adjectives, colors],
  separator: '',
  length: 3,
  style: 'capital',
};

export function uniqSessionName(): string {
  const name = uniqueNamesGenerator(nameConfig);
  const randomNum = Math.floor(Math.random() * 999);
  return `${name}${randomNum}`;
}

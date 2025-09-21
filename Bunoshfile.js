// Bunosh CLI required to execute tasks from this file
// Get it here => https://buno.sh

const { exec, shell, fetch, writeToFile, task, ai } = global.bunosh;

// input/output
const { say, ask, yell } = global.bunosh;

/**
 * 🎉 Hello world command
 */
export async function worktreeCreate(name = '') {
  const worktreeName = name || (await ask('What is feature name?'));

  const newDir = `../explorbot-${worktreeName}`;

  await exec`git worktree add ../explorbot-${worktreeName}`;
  await exec`ln -sf node_modules ${newDir}/node_modules`;

  say(`Created worktree for feature ${worktreeName} in ${newDir}`);
}

import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { setPreserveConsoleLogs } from '../../../src/utils/logger.ts';
import { getStyles } from './ai/chief/styles.ts';
import { ApiBot, type ApibotOptions } from './apibot.ts';

function buildOptions(options: any): ApibotOptions {
  return {
    verbose: options.verbose || options.debug,
    config: options.config,
    path: options.path,
  };
}

function addCommonOptions(cmd: Command): Command {
  return cmd.option('-v, --verbose', 'Enable verbose logging').option('--debug', 'Enable debug logging').option('-c, --config <path>', 'Path to configuration file').option('-p, --path <path>', 'Working directory path');
}

function selectTests(tests: any[], index?: string): any[] {
  if (!index || index === '*' || index === 'all') {
    return tests.filter((t) => t.status === 'pending');
  }

  const rangeMatch = index.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = Number.parseInt(rangeMatch[1]) - 1;
    const end = Number.parseInt(rangeMatch[2]);
    return tests.slice(start, end);
  }

  if (index.includes(',')) {
    const indices = index.split(',').map((i) => Number.parseInt(i.trim()) - 1);
    return indices.map((i) => tests[i]).filter(Boolean);
  }

  const num = Number.parseInt(index);
  if (!Number.isNaN(num) && tests[num - 1]) {
    return [tests[num - 1]];
  }

  return tests.filter((t) => t.status === 'pending');
}

export function createApiCommands(name = 'api'): Command {
  const cmd = new Command(name);
  cmd.description('AI-powered API testing tool');

  addCommonOptions(cmd.command('plan <endpoint>').description('Generate test plan for an API endpoint').option('--style <style>', 'Planning style: basename of a file in rules/chief/styles/').option('--fresh', 'Start planning from scratch')).action(async (endpoint, options) => {
    setPreserveConsoleLogs(true);
    try {
      const bot = new ApiBot(buildOptions(options));
      await bot.start();

      await bot.plan(endpoint, { style: options.style, fresh: options.fresh });

      const plan = bot.getCurrentPlan();
      if (!plan?.tests.length) {
        console.error('No test scenarios generated.');
        process.exit(1);
      }

      console.log(`\nPlan: ${plan.title} (${plan.tests.length} tests)\n`);
      plan.tests.forEach((test, i) => {
        console.log(`  ${i + 1}. [${test.priority}] ${test.scenario}`);
      });

      const savedPath = bot.savePlan();
      if (savedPath) {
        console.log(`\nSaved to: ${savedPath}`);
        console.log('\nRun tests:');
        console.log(`  ${name} test ${savedPath} 1       # run first test`);
        console.log(`  ${name} test ${savedPath} 1-3     # run tests 1 to 3`);
        console.log(`  ${name} test ${savedPath} *       # run all tests`);
      }

      await bot.stop();
      process.exit(0);
    } catch (error) {
      console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

  addCommonOptions(cmd.command('test <planfile> [index]').description('Execute tests from a plan file. Index: 1, 1-3, *')).action(async (planfile, index, options) => {
    setPreserveConsoleLogs(true);
    try {
      const bot = new ApiBot(buildOptions(options));
      await bot.start();

      const plan = bot.loadPlan(planfile);
      console.log(`Plan loaded: "${plan.title}" (${plan.tests.length} tests)`);

      const tests = selectTests(plan.tests, index);
      console.log(`Running ${tests.length} test(s)\n`);

      let passed = 0;
      let failed = 0;

      for (const test of tests) {
        const specDefinition = bot.tryGetEndpointDefinition(test.startUrl);
        const result = await bot.agentCurler().test(test, {
          specDefinition,
          baseEndpoint: bot.getConfig().api.baseEndpoint,
          searchSpec: (query) => bot.searchSpec(query),
        });
        if (result.success) passed++;
        else failed++;
      }

      bot.savePlan();

      console.log(`\nResults: ${passed} passed, ${failed} failed out of ${tests.length}`);
      await bot.stop();
      process.exit(failed > 0 ? 1 : 0);
    } catch (error) {
      console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

  addCommonOptions(cmd.command('explore <endpoint>').description('Full cycle: plan all styles, execute tests, re-plan')).action(async (endpoint, options) => {
    setPreserveConsoleLogs(true);
    try {
      const bot = new ApiBot(buildOptions(options));
      await bot.start();

      const styles = Object.keys(getStyles());
      let totalPassed = 0;
      let totalFailed = 0;
      let totalTests = 0;

      for (const style of styles) {
        console.log(`\n=== Style: ${style} ===\n`);

        const plan = await bot.plan(endpoint, { style, fresh: true });
        if (!plan?.tests.length) {
          console.log(`No tests generated for style: ${style}`);
          continue;
        }

        const pending = plan.getPendingTests();
        for (const test of pending) {
          const specDefinition = bot.tryGetEndpointDefinition(test.startUrl);
          const result = await bot.agentCurler().test(test, {
            specDefinition,
            baseEndpoint: bot.getConfig().api.baseEndpoint,
            searchSpec: (query) => bot.searchSpec(query),
          });
          totalTests++;
          if (result.success) totalPassed++;
          else totalFailed++;
        }

        bot.savePlan(`${endpoint.replace(/^\//, '').replace(/[^a-zA-Z0-9]/g, '_')}_${style}.md`);
      }

      console.log('\n=== Final Results ===');
      console.log(`Total: ${totalTests} tests, ${totalPassed} passed, ${totalFailed} failed`);
      await bot.stop();
      process.exit(totalFailed > 0 ? 1 : 0);
    } catch (error) {
      console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

  cmd
    .command('init')
    .description('Initialize a new apibot project with configuration')
    .option('-f, --force', 'Overwrite existing config file')
    .option('-p, --path <path>', 'Working directory for initialization')
    .action(async (options) => {
      const originalCwd = process.cwd();
      if (options.path) {
        const resolvedPath = path.resolve(options.path);
        fs.mkdirSync(resolvedPath, { recursive: true });
        process.chdir(resolvedPath);
        console.log(`Working in: ${resolvedPath}`);
      }

      const configPath = path.resolve('apibot.config.ts');

      if (fs.existsSync(configPath) && !options.force) {
        console.log(`Config file already exists: ${configPath}`);
        console.log('Use --force to overwrite.');
        process.exit(1);
      }

      const rl = await import('node:readline');
      const iface = rl.createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string, fallback = ''): Promise<string> => new Promise((resolve) => iface.question(q, (a: string) => resolve(a.trim() || fallback)));

      console.log('Apibot — API Testing Tool Setup\n');

      const baseEndpoint = await ask('Base API endpoint (e.g., https://api.example.com/v1): ');
      if (!baseEndpoint) {
        console.error('Base endpoint is required.');
        iface.close();
        process.exit(1);
      }

      const spec = await ask('OpenAPI spec file or URL (e.g., openapi.yaml or https://.../ — or press Enter to skip): ');
      const knowledge = await ask('Describe your API (auth method, data formats, special rules — or press Enter to skip): ');

      iface.close();

      const specLine = spec ? `\n    spec: ['${spec}'],` : '';

      const configContent = `import { openai } from '@ai-sdk/openai';

export default {
  ai: {
    model: openai('gpt-4o'),
  },
  api: {
    baseEndpoint: '${baseEndpoint}',${specLine}
    headers: {
      // 'Authorization': 'Bearer <token>',
    },
    // bootstrap: async ({ headers, baseEndpoint }) => {
    //   // Run before tests — e.g. obtain auth token
    //   // Return headers to merge: { Authorization: 'Bearer ...' }
    // },
    // teardown: async ({ headers, baseEndpoint }) => {
    //   // Run after tests — e.g. cleanup test data
    // },
  },
  dirs: {
    output: 'output',
    knowledge: 'knowledge',
  },
};
`;

      fs.writeFileSync(configPath, configContent, 'utf8');
      console.log(`\nCreated: ${configPath}`);

      fs.mkdirSync('output', { recursive: true });
      fs.mkdirSync('knowledge', { recursive: true });

      if (knowledge) {
        const knowledgePath = path.resolve('knowledge', 'general.md');
        fs.writeFileSync(knowledgePath, `---\nendpoint: "*"\n---\n${knowledge}\n`, 'utf8');
        console.log(`Created: ${knowledgePath}`);
      }

      console.log('\nNext steps:');
      console.log('1. Edit apibot.config.ts — set your AI provider and API headers');
      console.log(`2. Add API knowledge: ${name} know /users "CRUD endpoint for user management"`);
      console.log(`3. Plan tests: ${name} plan /users`);

      if (process.cwd() !== originalCwd) process.chdir(originalCwd);
    });

  cmd
    .command('know <endpoint> [description]')
    .alias('add-knowledge')
    .description('Add API knowledge for an endpoint')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('-p, --path <path>', 'Working directory path')
    .action(async (endpoint, description, options) => {
      if (!description) {
        const rl = await import('node:readline');
        const iface = rl.createInterface({ input: process.stdin, output: process.stdout });
        description = await new Promise<string>((resolve) => iface.question(`Describe ${endpoint}: `, (a: string) => resolve(a.trim())));
        iface.close();
      }

      if (!description) {
        console.error('Description is required.');
        process.exit(1);
      }

      let knowledgeDir = 'knowledge';
      try {
        const { ApibotConfigParser } = await import('./config.ts');
        await ApibotConfigParser.getInstance().loadConfig({ config: options.config, path: options.path });
        knowledgeDir = ApibotConfigParser.getInstance().getKnowledgeDir();
      } catch {
        if (options.path) knowledgeDir = path.join(path.resolve(options.path), 'knowledge');
      }

      fs.mkdirSync(knowledgeDir, { recursive: true });

      const filename = endpoint.replace(/^\//, '').replace(/[^a-zA-Z0-9]/g, '_') || 'general';
      const filePath = path.join(knowledgeDir, `${filename}.md`);

      const content = `---\nendpoint: "${endpoint}"\n---\n${description}\n`;

      if (fs.existsSync(filePath)) {
        fs.appendFileSync(filePath, `\n---\n${description}\n`, 'utf8');
        console.log(`Updated: ${filePath}`);
      } else {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Created: ${filePath}`);
      }
    });

  return cmd;
}

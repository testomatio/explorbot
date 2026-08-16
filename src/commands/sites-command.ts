import { listSites, sitesDir } from '../global-config.js';
import { getCliName } from '../utils/cli-name.js';
import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class SitesCommand extends BaseCommand {
  name = 'sites';
  description = 'List sites registered in the global installation';

  async execute(): Promise<void> {
    const sites = listSites();

    if (sites.length === 0) {
      tag('info').log(`No sites registered in ${sitesDir()}`);
      tag('info').log(`Explore one to register it: ${getCliName()} explore https://app.example.com`);
      return;
    }

    const width = sites.reduce((max, site) => Math.max(max, site.folder.length), 0);
    tag('info').log(`Registered sites (${sites.length}):`);
    for (const site of sites) {
      tag('info').log(`  ${site.folder.padEnd(width)}  ${site.url}  last run ${site.lastRunAt.slice(0, 16).replace('T', ' ')}`);
    }
    tag('info').log('');
    tag('info').log(`Stored in ${sitesDir()}`);
  }
}

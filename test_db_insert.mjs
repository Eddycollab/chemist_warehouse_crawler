// Test createCrawlJob directly
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Use tsx to run TypeScript
import { execSync } from 'child_process';

const result = execSync(
  `npx tsx -e "
import { createCrawlJob, getCrawlJobs } from './server/db.ts';

async function test() {
  try {
    console.log('Testing createCrawlJob...');
    const result = await createCrawlJob({
      jobType: 'manual',
      status: 'running',
      category: 'beauty_skincare',
      startedAt: new Date(),
    });
    console.log('Insert result:', JSON.stringify(result));
    
    const jobs = await getCrawlJobs(5);
    console.log('Jobs in DB:', JSON.stringify(jobs));
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
  }
  process.exit(0);
}

test();
"`,
  { cwd: '/home/ubuntu/chemist_warehouse_crawler', timeout: 15000, encoding: 'utf8' }
);

console.log(result);

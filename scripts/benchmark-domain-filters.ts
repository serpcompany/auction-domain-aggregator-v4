import { spawn } from 'node:child_process';

import { createChildEnvironment } from '../src/server/ingestion/local-runner';

const REPEATS = 5;
const CONFIG = 'wrangler.jsonc';

type Shape = {
  name: string;
  countSql: string;
  rowSql: string;
};

type D1Result = {
  results: Array<Record<string, unknown>>;
  success: boolean;
  meta: { duration: number };
};

const active = "status='active'";
const endingCutoff = "unixepoch('2026-07-14T12:00:00Z')*1000";
const tieBreakers = 'domain_name,provider,external_id';

const shapes: Shape[] = [
  {
    name: 'tld_com_ends_sort',
    countSql: `select count(*) as count from auction_listings where ${active} and lower(domain_name) like '%.com'`,
    rowSql: `select current_bid_cents from auction_listings where ${active} and lower(domain_name) like '%.com' order by ends_at,${tieBreakers} limit 50`,
  },
  {
    name: 'domain_length_8_15',
    countSql: `select count(*) as count from auction_listings where ${active} and length(domain_name) between 8 and 15`,
    rowSql: `select current_bid_cents from auction_listings where ${active} and length(domain_name) between 8 and 15 order by length(domain_name),${tieBreakers} limit 50`,
  },
  {
    name: 'no_hyphen_no_digit',
    countSql: `select count(*) as count from auction_listings where ${active} and instr(domain_name,'-')=0 and domain_name not glob '*[0-9]*'`,
    rowSql: `select current_bid_cents from auction_listings where ${active} and instr(domain_name,'-')=0 and domain_name not glob '*[0-9]*' order by ${tieBreakers} limit 50`,
  },
  {
    name: 'price_range_ending_window',
    countSql: `select count(*) as count from auction_listings where ${active} and current_bid_cents between 100 and 50000 and ends_at<=${endingCutoff}`,
    rowSql: `select current_bid_cents from auction_listings where ${active} and current_bid_cents between 100 and 50000 and ends_at<=${endingCutoff} order by ends_at,${tieBreakers} limit 50`,
  },
  {
    name: 'auction_type_bids',
    countSql: `select count(*) as count from auction_listings where ${active} and auction_type='EXPIRED' and bid_count>=3`,
    rowSql: `select current_bid_cents from auction_listings where ${active} and auction_type='EXPIRED' and bid_count>=3 order by bid_count desc,${tieBreakers} limit 50`,
  },
  {
    name: 'links_min',
    countSql: `select count(*) as count from auction_listings where ${active} and inbound_links>=10`,
    rowSql: `select current_bid_cents from auction_listings where ${active} and inbound_links>=10 order by inbound_links desc,${tieBreakers} limit 50`,
  },
  {
    name: 'visitors_min',
    countSql: `select count(*) as count from auction_listings where ${active} and visitors>=10`,
    rowSql: `select current_bid_cents from auction_listings where ${active} and visitors>=10 order by visitors desc,${tieBreakers} limit 50`,
  },
  {
    name: 'appraisal_min',
    countSql: `select count(*) as count from auction_listings where ${active} and appraisal_cents>=10000`,
    rowSql: `select current_bid_cents from auction_listings where ${active} and appraisal_cents>=10000 order by appraisal_cents desc,${tieBreakers} limit 50`,
  },
  {
    name: 'renewal_max',
    countSql: `select count(*) as count from auction_listings where ${active} and renewal_price_cents<=2000`,
    rowSql: `select current_bid_cents from auction_listings where ${active} and renewal_price_cents<=2000 order by renewal_price_cents,${tieBreakers} limit 50`,
  },
  {
    name: 'substring_price_shape',
    countSql: `select count(*) as count from auction_listings where ${active} and lower(domain_name) like '%a%' and current_bid_cents<=50000 and instr(domain_name,'-')=0`,
    rowSql: `select current_bid_cents from auction_listings where ${active} and lower(domain_name) like '%a%' and current_bid_cents<=50000 and instr(domain_name,'-')=0 order by ${tieBreakers} limit 50`,
  },
  {
    name: 'tld_facet',
    countSql: `select count(*) as count from (select lower(json_extract('["'||replace(domain_name,'.','","')||'"]','$[#-1]')) as tld from auction_listings where ${active} group by tld)`,
    rowSql: `select lower(json_extract('["'||replace(domain_name,'.','","')||'"]','$[#-1]')) as tld,count(*) as listings from auction_listings where ${active} group by tld order by listings desc,tld limit 250`,
  },
];

function fixedError(code: string) {
  const error = new Error(code);
  error.stack = undefined;
  return error;
}

async function execute(statements: string[]) {
  return new Promise<D1Result[]>((resolve, reject) => {
    const child = spawn(
      'corepack',
      [
        'pnpm',
        'exec',
        'wrangler',
        'd1',
        'execute',
        'DB',
        '--local',
        '--config',
        CONFIG,
        '--env-file',
        '/dev/null',
        '--command',
        statements.join(';'),
        '--json',
      ],
      {
        cwd: process.cwd(),
        env: createChildEnvironment(process.env),
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (output.length > 2_000_000) child.kill();
    });
    child.once('error', () => reject(fixedError('filter_benchmark_failed')));
    child.once('close', (code) => {
      if (code !== 0) return reject(fixedError('filter_benchmark_failed'));
      try {
        const parsed = JSON.parse(output) as D1Result[];
        if (!Array.isArray(parsed) || parsed.some(({ success }) => !success)) {
          return reject(fixedError('filter_benchmark_failed'));
        }
        resolve(parsed);
      } catch {
        reject(fixedError('filter_benchmark_failed'));
      }
    });
  });
}

function aggregate(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    samples,
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    mean: Number(
      (
        samples.reduce((total, value) => total + value, 0) / samples.length
      ).toFixed(2),
    ),
    max: sorted.at(-1),
  };
}

function numericResult(result: D1Result, key: string) {
  const value = result.results[0]?.[key];
  if (typeof value !== 'number') throw fixedError('filter_benchmark_failed');
  return value;
}

async function main() {
  const statements = [
    `select count(*) as count from auction_listings`,
    `select count(*) as count from auction_listings where ${active}`,
  ];
  for (const shape of shapes) {
    statements.push(`explain query plan ${shape.countSql}`);
    statements.push(`explain query plan ${shape.rowSql}`);
    statements.push(shape.countSql);
    statements.push(`select count(*) as count from (${shape.rowSql})`);
    for (let index = 0; index < REPEATS; index += 1) {
      statements.push(shape.countSql);
      statements.push(`select count(*) as count from (${shape.rowSql})`);
    }
  }

  const results = await execute(statements);
  let cursor = 0;
  const total = numericResult(results[cursor++]!, 'count');
  const activeCount = numericResult(results[cursor++]!, 'count');
  const benchmarks = shapes.map((shape) => {
    const countPlan = results[cursor++]!;
    const rowPlan = results[cursor++]!;
    cursor += 2; // Discard one warm-up count and row result.
    const countSamples: number[] = [];
    const rowSamples: number[] = [];
    let count = 0;
    let rowCount = 0;
    for (let index = 0; index < REPEATS; index += 1) {
      const countResult = results[cursor++]!;
      const rowResult = results[cursor++]!;
      count = numericResult(countResult, 'count');
      rowCount = numericResult(rowResult, 'count');
      countSamples.push(countResult.meta.duration);
      rowSamples.push(rowResult.meta.duration);
    }
    return {
      name: shape.name,
      count,
      rowCount,
      countWarmMs: aggregate(countSamples),
      rowWarmMs: aggregate(rowSamples),
      countPlan: countPlan.results.map(({ detail }) => String(detail)),
      rowPlan: rowPlan.results.map(({ detail }) => String(detail)),
    };
  });
  if (cursor !== results.length) throw fixedError('filter_benchmark_failed');

  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'succeeded',
        database: 'local D1 via wrangler.jsonc',
        output: 'aggregate counts, query plans, and D1 timing metadata only',
        warmupRuns: 1,
        measuredRuns: REPEATS,
        inventory: { total, active: activeCount },
        benchmarks,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch(() => {
  process.stderr.write('filter_benchmark_failed\n');
  process.exitCode = 1;
});

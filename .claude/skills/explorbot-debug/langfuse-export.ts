#!/usr/bin/env bun
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE_URL = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com';
const PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;

if (!PUBLIC_KEY || !SECRET_KEY) {
  console.error('Missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY in .env');
  process.exit(1);
}

const AUTH = `Basic ${btoa(`${PUBLIC_KEY}:${SECRET_KEY}`)}`;

async function api(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: AUTH },
  });
  if (!res.ok) {
    throw new Error(`Langfuse API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function parseTimeRange(range: string): { from: string; to: string } {
  const to = new Date();
  const from = new Date();

  const match = range.match(/^(\d+)([mhd])$/);
  if (match) {
    const [, amount, unit] = match;
    const ms = { m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
    from.setTime(to.getTime() - Number(amount) * ms);
    return { from: from.toISOString(), to: to.toISOString() };
  }

  if (range === 'today') {
    from.setHours(0, 0, 0, 0);
    return { from: from.toISOString(), to: to.toISOString() };
  }

  return { from: new Date(range).toISOString(), to: to.toISOString() };
}

async function fetchTraces(from: string, to: string) {
  const params = new URLSearchParams({
    limit: '50',
    fromTimestamp: from,
    toTimestamp: to,
  });
  const data = await api(`/api/public/traces?${params}`);
  return data.data;
}

async function fetchObservations(traceId: string) {
  let all: any[] = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams({
      traceId,
      limit: '100',
      page: String(page),
    });
    const data = await api(`/api/public/observations?${params}`);
    all = all.concat(data.data);
    if (data.data.length < 100) break;
    page++;
  }
  return all;
}

async function fetchSingleTrace(traceId: string) {
  return api(`/api/public/traces/${traceId}`);
}

const input = process.argv[2] || '1h';
const isTraceId = /^[a-f0-9]{16,}$/i.test(input);
const outPath = process.argv[3] || `output/langfuse-export-${Date.now()}.json`;

let result: any[];

if (isTraceId) {
  console.log(`Fetching trace: ${input}`);
  const trace = await fetchSingleTrace(input);
  console.log(`  ${trace.timestamp} | ${trace.name || '(unnamed)'} | ${(trace.tags || []).join(', ')}`);
  const observations = await fetchObservations(input);
  console.log(`  ${observations.length} observations`);
  result = [{ ...trace, observations }];
} else {
  console.log(`Fetching traces for range: ${input}`);
  const { from, to } = parseTimeRange(input);
  console.log(`  From: ${from}`);
  console.log(`  To:   ${to}`);

  const traces = await fetchTraces(from, to);
  console.log(`Found ${traces.length} traces`);

  if (!traces.length) {
    console.log('No traces found in this time range.');
    process.exit(0);
  }

  for (const t of traces) {
    console.log(`  ${t.timestamp} | ${t.name || '(unnamed)'} | ${(t.tags || []).join(', ')}`);
  }

  console.log('\nFetching observations for each trace...');
  result = [];
  for (const t of traces) {
    const observations = await fetchObservations(t.id);
    result.push({ ...t, observations });
    console.log(`  ${t.name || t.id}: ${observations.length} observations`);
  }
}

const resolved = resolve(outPath);
writeFileSync(resolved, JSON.stringify(result, null, 2));
console.log(`\nSaved to: ${resolved}`);

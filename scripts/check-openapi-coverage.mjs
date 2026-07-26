#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import process from 'node:process'

const specPath = process.argv[2] || '/tmp/pokerai-openapi.json'
const requiredOperations = [
  ['GET', '/v1/gto/preflop/versions', 'preflop_versions'],
  ['POST', '/v1/gto/preflop', 'preflop_strategy'],
  ['POST', '/v1/gto/preflop/range', 'preflop_range'],
  ['POST', '/v1/gto/flop/tree', 'flop_tree'],
  ['POST', '/v1/gto/flop/node', 'flop_node'],
  ['POST', '/v1/gto/solver', 'solve_schedule'],
  ['POST', '/v1/gto/solver/tree', 'solve_tree'],
  ['POST', '/v1/gto/solver/node', 'solve_node'],
  ['POST', '/v1/gto/evs', 'node_evs'],
]

function readSpec(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`Could not read OpenAPI JSON at ${path}: ${error.message}`)
  }
}

const spec = readSpec(specPath)
const missing = []

for (const [method, path, toolName] of requiredOperations) {
  const operation = spec.paths?.[path]?.[method.toLowerCase()]
  if (!operation) missing.push(`${toolName}: ${method} ${path}`)
}

if (missing.length) {
  console.error(`MCP OpenAPI coverage check failed:\n${missing.map((item) => `- ${item}`).join('\n')}`)
  process.exit(1)
}

console.log(`MCP OpenAPI coverage check passed (${requiredOperations.length}/${requiredOperations.length})`)

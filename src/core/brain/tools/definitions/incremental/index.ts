/**
 * Incremental Analysis Tools Module
 *
 * This module exports all incremental analysis tools for Claude-Hybrid.
 * These tools handle envelopes, snapshots, delta computation, impact graphs,
 * finding relocation, and branch management.
 */

// Export types
export * from './types.js';

// Export individual tool modules
export { envelopeTools, envelopeStoreTool, envelopeQueryTool, envelopeGetTool, envelopeDeleteTool } from './envelope-tools.js';
export { snapshotTools, snapshotCreateTool, snapshotQueryTool, snapshotMergeTool } from './snapshot-tools.js';
export { deltaGraphTools, deltaComputeTool, graphUpdateTool, graphPropagateTool } from './delta-graph-tools.js';
export { relocationBranchTools, findingRelocateTool, branchManageTool } from './relocation-branch-tools.js';

// Import types
import type { InternalTool, InternalToolSet } from '../../types.js';
import { logger } from '../../../../logger/index.js';
import { env } from '../../../../env.js';

// Import all tools
import { envelopeTools } from './envelope-tools.js';
import { snapshotTools } from './snapshot-tools.js';
import { deltaGraphTools } from './delta-graph-tools.js';
import { relocationBranchTools } from './relocation-branch-tools.js';

/**
 * Get all incremental analysis tools as a map
 */
export async function getIncrementalTools(): Promise<Record<string, InternalTool>> {
	// DEBUG: Force stderr output to trace execution
	console.error('[CIPHER-DEBUG] getIncrementalTools() called');

	// Check if incremental analysis is enabled (default: true)
	const incrementalEnabled = env.INCREMENTAL_ANALYSIS_ENABLED !== false;
	console.error('[CIPHER-DEBUG] INCREMENTAL_ANALYSIS_ENABLED:', incrementalEnabled);

	if (!incrementalEnabled) {
		console.error('[CIPHER-DEBUG] Incremental tools DISABLED, returning empty');
		logger.debug('Incremental analysis tools disabled');
		return {};
	}

	// Combine all incremental tools
	console.error('[CIPHER-DEBUG] Building tool map from imports...');
	console.error('[CIPHER-DEBUG] envelopeTools keys:', Object.keys(envelopeTools));
	console.error('[CIPHER-DEBUG] snapshotTools keys:', Object.keys(snapshotTools));
	console.error('[CIPHER-DEBUG] deltaGraphTools keys:', Object.keys(deltaGraphTools));
	console.error('[CIPHER-DEBUG] relocationBranchTools keys:', Object.keys(relocationBranchTools));

	const allTools: Record<string, InternalTool> = {
		...envelopeTools,
		...snapshotTools,
		...deltaGraphTools,
		...relocationBranchTools,
	};

	console.error('[CIPHER-DEBUG] Total incremental tools:', Object.keys(allTools).length);
	console.error('[CIPHER-DEBUG] Tool names:', Object.keys(allTools));

	logger.debug('Incremental analysis tools loaded', {
		toolCount: Object.keys(allTools).length,
		tools: Object.keys(allTools),
	});

	return allTools;
}

/**
 * Get incremental tools array
 */
export async function getIncrementalToolsArray(): Promise<InternalTool[]> {
	const toolMap = await getIncrementalTools();
	return Object.values(toolMap);
}

/**
 * Incremental tool categories and descriptions
 */
export const INCREMENTAL_TOOL_INFO = {
	// Envelope tools
	envelope_store: {
		category: 'incremental',
		purpose: 'Store finding envelopes with semantic indexing for Claude-Hybrid analysis',
		useCase: 'Use to persist analysis findings with full metadata for later retrieval and semantic search',
	},
	envelope_query: {
		category: 'incremental',
		purpose: 'Query envelopes by metadata filters and/or semantic search',
		useCase: 'Use to find relevant envelopes by tier, agent, chunk, workflow, or semantic similarity',
	},
	envelope_get: {
		category: 'incremental',
		purpose: 'Retrieve a specific envelope by ID',
		useCase: 'Use to fetch complete envelope details including all findings',
	},
	envelope_delete: {
		category: 'incremental',
		purpose: 'Delete a specific envelope by ID',
		useCase: 'Use to remove outdated or incorrect envelopes (permanent)',
	},
	// Snapshot tools
	snapshot_create: {
		category: 'incremental',
		purpose: 'Create immutable analysis snapshots for version control',
		useCase: 'Use after completing analysis to create a persistent, versioned record',
	},
	snapshot_query: {
		category: 'incremental',
		purpose: 'Query snapshots by various criteria including provenance traversal',
		useCase: 'Use to find baselines, branch history, or audit trails',
	},
	snapshot_merge: {
		category: 'incremental',
		purpose: 'Merge baseline snapshot with delta findings',
		useCase: 'Use to combine incremental analysis results with existing baseline',
	},
	// Delta and graph tools
	delta_compute: {
		category: 'incremental',
		purpose: 'Compute delta between baseline and HEAD with cascade propagation',
		useCase: 'Use to identify affected chunks for incremental analysis',
	},
	graph_update: {
		category: 'incremental',
		purpose: 'Update Impact Propagation Graph with nodes and edges',
		useCase: 'Use to maintain the dependency graph for cascade analysis',
	},
	graph_propagate: {
		category: 'incremental',
		purpose: 'Run BFS cascade analysis on Impact Propagation Graph',
		useCase: 'Use to find all chunks affected by changes via dependency chains',
	},
	// Relocation and branch tools
	finding_relocate: {
		category: 'incremental',
		purpose: 'Relocate findings using 6-stage Phantom Finding Relocation',
		useCase: 'Use to track finding locations across code changes',
	},
	branch_manage: {
		category: 'incremental',
		purpose: 'Manage analysis branches for CI/CD integration',
		useCase: 'Use for PR workflows with branch-aware snapshot management',
	},
} as const;

/**
 * All incremental tool names for reference
 */
export const INCREMENTAL_TOOL_NAMES = [
	'cipher_envelope_store',
	'cipher_envelope_query',
	'cipher_envelope_get',
	'cipher_envelope_delete',
	'cipher_snapshot_create',
	'cipher_snapshot_query',
	'cipher_snapshot_merge',
	'cipher_delta_compute',
	'cipher_graph_update',
	'cipher_graph_propagate',
	'cipher_finding_relocate',
	'cipher_branch_manage',
] as const;

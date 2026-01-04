/**
 * Snapshot Tools for Claude-Hybrid Incremental Analysis
 *
 * These tools manage immutable analysis snapshots with semantic search capabilities
 * for version control and baseline management.
 */

import type { InternalTool, InternalToolContext } from '../../types.js';
import type {
	Snapshot,
	SnapshotCreateParams,
	SnapshotQueryParams,
	SnapshotMergeParams,
	MergeResult,
	TrustScore,
	RelocationResult,
} from './types.js';
import { logger } from '../../../../logger/index.js';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function generateSnapshotId(commit: string): string {
	const now = new Date();
	const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
	const commitShort = commit.slice(0, 7);
	return `snap-${dateStr}-${commitShort}`;
}

/**
 * Generate a safe numeric vector ID for Milvus storage
 * Milvus requires numeric IDs, so we use timestamp-based generation
 */
function generateNumericVectorId(index: number = 0): number {
	const timestamp = Date.now();
	const randomSuffix = Math.floor(Math.random() * 1000);
	return timestamp * 1000 + randomSuffix + index;
}

function buildSnapshotSearchText(snapshot: Partial<Snapshot>): string {
	const parts: string[] = [];
	if (snapshot.project_path) parts.push(`project:${snapshot.project_path}`);
	if (snapshot.git_branch) parts.push(`branch:${snapshot.git_branch}`);
	if (snapshot.workflow_goal) parts.push(`goal:${snapshot.workflow_goal}`);
	if (snapshot.analysis_mode) parts.push(`mode:${snapshot.analysis_mode}`);
	if (snapshot.git_commit) parts.push(`commit:${snapshot.git_commit.slice(0, 12)}`);
	return parts.join(' ');
}

function computeMixedTrustScore(
	preserved: number,
	relocated: number,
	stale: number,
	orphaned: number,
	newFindings: number
): TrustScore {
	const total = preserved + relocated + stale + orphaned + newFindings;
	if (total === 0) {
		return { overall: 10, level: 'HIGH', components: { coverage: 1, freshness: 1, confidence: 1 } };
	}

	const coverage = (preserved + relocated + newFindings) / total;
	const freshness = newFindings > 0 ? 0.9 : 0.7;
	const confidence = 1 - (stale + orphaned) / total;

	const overall = Math.round((coverage * 0.4 + freshness * 0.3 + confidence * 0.3) * 10 * 10) / 10;

	return {
		overall,
		level: overall >= 8 ? 'HIGH' : overall >= 5 ? 'MEDIUM' : 'LOW',
		components: { coverage, freshness, confidence },
	};
}

// =============================================================================
// SNAPSHOT CREATE TOOL
// =============================================================================

export const snapshotCreateTool: InternalTool = {
	name: 'cipher_snapshot_create',
	category: 'incremental',
	internal: true,
	agentAccessible: true,
	version: '1.0.0',
	description: 'Create an immutable analysis snapshot. Implements Analysis Version Control (AVCS) for CI/CD integration. Snapshots are never modified after creation.',
	parameters: {
		type: 'object',
		properties: {
			project_path: {
				type: 'string',
				description: 'Absolute path to project root',
			},
			git_commit: {
				type: 'string',
				description: 'Git commit hash for this snapshot',
			},
			git_branch: {
				type: 'string',
				description: 'Git branch name',
			},
			workflow_id: {
				type: 'string',
				description: 'Workflow execution identifier',
			},
			workflow_goal: {
				type: 'string',
				enum: ['AUDIT', 'DOCUMENT', 'BUILD_FRONTEND'],
				description: 'Claude-Hybrid workflow goal',
			},
			analysis_mode: {
				type: 'string',
				enum: ['FULL', 'INCREMENTAL', 'REBASE'],
				description: 'Analysis mode used',
			},
			baseline_snapshot_id: {
				type: 'string',
				description: 'Baseline snapshot ID for incremental/rebase modes',
			},
			chunk_manifest: {
				type: 'object',
				description: 'Chunk manifest with analysis status per chunk',
			},
			findings: {
				type: 'array',
				items: { type: 'string' },
				description: 'Array of envelope IDs to include in snapshot',
			},
			trust_score: {
				type: 'object',
				description: 'Computed trust score object',
			},
			duration_seconds: {
				type: 'number',
				description: 'Analysis duration in seconds',
			},
		},
		required: ['project_path', 'git_commit', 'git_branch', 'workflow_id', 'workflow_goal', 'analysis_mode', 'chunk_manifest', 'findings', 'trust_score'],
	},
	handler: async (args: SnapshotCreateParams, context?: InternalToolContext) => {
		const startTime = Date.now();

		try {
			const snapshotId = generateSnapshotId(args.git_commit);
			const timestamp = new Date().toISOString();

			// Build provenance chain
			const provenanceChain: string[] = [];
			if (args.baseline_snapshot_id) {
				// In a full implementation, we'd fetch the baseline's provenance chain
				provenanceChain.push(args.baseline_snapshot_id);
			}
			provenanceChain.push(snapshotId);

			const snapshot: Snapshot = {
				snapshot_id: snapshotId,
				project_path: args.project_path,
				git_commit: args.git_commit,
				git_branch: args.git_branch,
				workflow_id: args.workflow_id,
				workflow_goal: args.workflow_goal,
				analysis_mode: args.analysis_mode,
				baseline_snapshot_id: args.baseline_snapshot_id,
				chunk_manifest: args.chunk_manifest,
				findings: args.findings,
				trust_score: args.trust_score,
				duration_seconds: args.duration_seconds ?? 0,
				created_at: timestamp,
				provenance_chain: provenanceChain,
			};

			const searchText = buildSnapshotSearchText(snapshot);

			const vectorStoreManager = context?.services?.vectorStoreManager;
			const embeddingManager = context?.services?.embeddingManager;

			if (!vectorStoreManager || !embeddingManager) {
				logger.warn('Vector store not available, snapshot created but not persisted to vector DB');
				return {
					success: true,
					snapshot_id: snapshotId,
					snapshot,
					stored: false,
					warning: 'Created without vector storage (services unavailable)',
				};
			}

			// Get the knowledge store
			let store: any;
			try {
				store = (vectorStoreManager as any).getStore('knowledge');
			} catch {
				store = (vectorStoreManager as any).getStore();
			}
			if (!store) {
				return {
					success: false,
					error: 'Vector store not available',
					stored: false,
				};
			}

			const embedder = embeddingManager.getEmbedder('default');
			if (!embedder) {
				return {
					success: true,
					snapshot_id: snapshotId,
					snapshot,
					stored: false,
					warning: 'Created without vector storage (no embedder)',
				};
			}

			const embedding = await embedder.embed(searchText);

			// Store using correct API
			// Milvus requires numeric IDs, so we generate one and store snapshot_id in payload
			const vectorId = generateNumericVectorId();
			const payload = {
				...snapshot,
				text: searchText,
				memoryType: 'snapshot',
				version: 2,
				vector_id: vectorId,
			};
			await store.insert([embedding], [vectorId], [payload]);

			logger.info('Snapshot created', {
				snapshot_id: snapshotId,
				project: args.project_path,
				commit: args.git_commit.slice(0, 7),
				mode: args.analysis_mode,
				findingsCount: args.findings.length,
			});

			return {
				success: true,
				snapshot_id: snapshotId,
				snapshot,
				stored: true,
				storage_path: `cipher_snapshots/${snapshotId}`,
				processingTime: Date.now() - startTime,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('Failed to create snapshot', { error: errorMessage });
			return {
				success: false,
				error: errorMessage,
				stored: false,
			};
		}
	},
};

// =============================================================================
// SNAPSHOT QUERY TOOL
// =============================================================================

export const snapshotQueryTool: InternalTool = {
	name: 'cipher_snapshot_query',
	category: 'incremental',
	internal: true,
	agentAccessible: true,
	version: '1.0.0',
	description: 'Query analysis snapshots by various criteria. Supports baseline lookup, branch history, and provenance traversal.',
	parameters: {
		type: 'object',
		properties: {
			project_path: {
				type: 'string',
				description: 'Absolute path to project root',
			},
			query_type: {
				type: 'string',
				enum: ['by_id', 'latest_for_branch', 'by_commit', 'by_date_range', 'provenance_chain'],
				description: 'Type of query to execute',
			},
			snapshot_id: {
				type: 'string',
				description: 'Snapshot ID for by_id or provenance_chain query',
			},
			branch: {
				type: 'string',
				description: 'Branch name for latest_for_branch query',
			},
			commit: {
				type: 'string',
				description: 'Git commit for by_commit query',
			},
			start_date: {
				type: 'string',
				description: 'Start date for by_date_range query (ISO format)',
			},
			end_date: {
				type: 'string',
				description: 'End date for by_date_range query (ISO format)',
			},
			include_findings: {
				type: 'boolean',
				description: 'Whether to include full findings in response',
			},
			limit: {
				type: 'number',
				description: 'Maximum snapshots to return',
			},
		},
		required: ['project_path', 'query_type'],
	},
	handler: async (args: SnapshotQueryParams, context?: InternalToolContext) => {
		const startTime = Date.now();

		try {
			const vectorStoreManager = context?.services?.vectorStoreManager;
			const embeddingManager = context?.services?.embeddingManager;

			if (!vectorStoreManager || !embeddingManager) {
				return {
					success: false,
					error: 'Vector store not available',
					snapshots: [],
					count: 0,
				};
			}

			// Get the knowledge store
			let store: any;
			try {
				store = (vectorStoreManager as any).getStore('knowledge');
			} catch {
				store = (vectorStoreManager as any).getStore();
			}
			if (!store) {
				return {
					success: false,
					error: 'Vector store not available',
					snapshots: [],
					count: 0,
				};
			}

			const embedder = embeddingManager.getEmbedder('default');
			if (!embedder) {
				return {
					success: false,
					error: 'Embedder not available',
					snapshots: [],
					count: 0,
				};
			}

			const limit = args.limit ?? 10;
			let queryText = `project:${args.project_path}`;

			// Build filter function for manual filtering
			const buildFilterFn = () => {
				return (r: any) => {
					const p = r.payload || r;
					if (p.memoryType !== 'snapshot') return false;
					if (p.project_path !== args.project_path) return false;
					if (args.query_type === 'by_id' && p.snapshot_id !== args.snapshot_id) return false;
					if (args.query_type === 'latest_for_branch' && p.git_branch !== args.branch) return false;
					if (args.query_type === 'by_commit' && p.git_commit !== args.commit) return false;
					return true;
				};
			};

			switch (args.query_type) {
				case 'by_id':
					if (!args.snapshot_id) {
						return { success: false, error: 'snapshot_id required for by_id query', snapshots: [], count: 0 };
					}
					queryText = args.snapshot_id;
					break;

				case 'latest_for_branch':
					if (!args.branch) {
						return { success: false, error: 'branch required for latest_for_branch query', snapshots: [], count: 0 };
					}
					queryText = `branch:${args.branch} ${queryText}`;
					break;

				case 'by_commit':
					if (!args.commit) {
						return { success: false, error: 'commit required for by_commit query', snapshots: [], count: 0 };
					}
					queryText = `commit:${args.commit} ${queryText}`;
					break;

				case 'by_date_range':
					queryText = `${queryText} analysis snapshot`;
					break;

				case 'provenance_chain':
					if (!args.snapshot_id) {
						return { success: false, error: 'snapshot_id required for provenance_chain query', snapshots: [], count: 0 };
					}
					queryText = args.snapshot_id;
					break;
			}

			const embedding = await embedder.embed(queryText);
			const rawResults = await store.search(embedding, limit * 3);
			const filterFn = buildFilterFn();

			let results = rawResults
				.filter(filterFn)
				.map((r: any) => {
					const snapshot = r.payload || r;
					if (!args.include_findings && snapshot.findings) {
						return {
							...snapshot,
							findings_count: snapshot.findings.length,
							findings: undefined,
						};
					}
					return snapshot;
				});

			// Handle provenance chain traversal
			if (args.query_type === 'provenance_chain' && results.length > 0) {
				const targetSnapshot = results[0];
				return {
					success: true,
					provenance_chain: targetSnapshot.provenance_chain || [targetSnapshot.snapshot_id],
					snapshots: results.slice(0, 1),
					count: 1,
					processingTime: Date.now() - startTime,
				};
			}

			// For latest_for_branch, sort by created_at and take first
			if (args.query_type === 'latest_for_branch') {
				results.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
				results = results.slice(0, 1);
			}

			return {
				success: true,
				snapshots: results.slice(0, limit),
				count: Math.min(results.length, limit),
				total_available: results.length,
				processingTime: Date.now() - startTime,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('Failed to query snapshots', { error: errorMessage });
			return {
				success: false,
				error: errorMessage,
				snapshots: [],
				count: 0,
			};
		}
	},
};

// =============================================================================
// SNAPSHOT MERGE TOOL
// =============================================================================

export const snapshotMergeTool: InternalTool = {
	name: 'cipher_snapshot_merge',
	category: 'incremental',
	internal: true,
	agentAccessible: true,
	version: '1.0.0',
	description: 'Merge baseline snapshot with delta findings into new snapshot. Implements core merge algorithm for incremental analysis.',
	parameters: {
		type: 'object',
		properties: {
			baseline_snapshot_id: {
				type: 'string',
				description: 'Baseline snapshot to merge from',
			},
			delta_envelope_ids: {
				type: 'array',
				items: { type: 'string' },
				description: 'Envelope IDs from delta analysis to merge',
			},
			relocation_results: {
				type: 'object',
				description: 'Map of finding_id -> RelocationResult from finding_relocate',
			},
			target_commit: {
				type: 'string',
				description: 'Git commit for the new merged snapshot',
			},
			project_path: {
				type: 'string',
				description: 'Absolute path to project root',
			},
			conflict_strategy: {
				type: 'string',
				enum: ['PREFER_NEW', 'PREFER_BASELINE', 'KEEP_BOTH'],
				description: 'Strategy for resolving duplicate/conflicting findings',
			},
			workflow_id: {
				type: 'string',
				description: 'Workflow execution identifier',
			},
			workflow_goal: {
				type: 'string',
				enum: ['AUDIT', 'DOCUMENT', 'BUILD_FRONTEND'],
				description: 'Claude-Hybrid workflow goal',
			},
		},
		required: ['baseline_snapshot_id', 'delta_envelope_ids', 'relocation_results', 'target_commit', 'project_path', 'workflow_id', 'workflow_goal'],
	},
	handler: async (args: SnapshotMergeParams, context?: InternalToolContext) => {
		const startTime = Date.now();

		try {
			const vectorStoreManager = context?.services?.vectorStoreManager;
			const embeddingManager = context?.services?.embeddingManager;

			if (!vectorStoreManager || !embeddingManager) {
				return {
					success: false,
					error: 'Vector store not available',
				};
			}

			// Get the knowledge store
			let store: any;
			try {
				store = (vectorStoreManager as any).getStore('knowledge');
			} catch {
				store = (vectorStoreManager as any).getStore();
			}
			if (!store) {
				return {
					success: false,
					error: 'Vector store not available',
				};
			}

			const embedder = embeddingManager.getEmbedder('default');
			if (!embedder) {
				return {
					success: false,
					error: 'Embedder not available',
				};
			}

			// Count findings by status
			let preserved = 0, relocated = 0, stale = 0, orphaned = 0;
			const relocationResults = args.relocation_results as Record<string, RelocationResult>;

			for (const result of Object.values(relocationResults)) {
				switch (result.status) {
					case 'PRESERVED': preserved++; break;
					case 'RELOCATED': relocated++; break;
					case 'STALE': stale++; break;
					case 'ORPHANED': orphaned++; break;
				}
			}

			const newFindings = args.delta_envelope_ids.length;
			const trustScore = computeMixedTrustScore(preserved, relocated, stale, orphaned, newFindings);

			// Combine all finding envelope IDs
			const allFindings = [
				...Object.keys(relocationResults).filter(id => {
					const status = relocationResults[id]?.status;
					return status === 'PRESERVED' || status === 'RELOCATED';
				}),
				...args.delta_envelope_ids,
			];

			// Create the merged snapshot
			const snapshotId = generateSnapshotId(args.target_commit);
			const timestamp = new Date().toISOString();

			const snapshot: Snapshot = {
				snapshot_id: snapshotId,
				project_path: args.project_path,
				git_commit: args.target_commit,
				git_branch: '', // Would need to be passed or fetched
				workflow_id: args.workflow_id,
				workflow_goal: args.workflow_goal,
				analysis_mode: 'INCREMENTAL',
				baseline_snapshot_id: args.baseline_snapshot_id,
				chunk_manifest: {}, // Would inherit from baseline + delta
				findings: allFindings,
				trust_score: trustScore,
				duration_seconds: Math.round((Date.now() - startTime) / 1000),
				created_at: timestamp,
				provenance_chain: [args.baseline_snapshot_id, snapshotId],
			};

			const searchText = buildSnapshotSearchText(snapshot);
			const embedding = await embedder.embed(searchText);

			// Store using correct API
			// Milvus requires numeric IDs, so we generate one and store snapshot_id in payload
			const vectorId = generateNumericVectorId();
			const payload = {
				...snapshot,
				text: searchText,
				memoryType: 'snapshot',
				version: 2,
				vector_id: vectorId,
			};
			await store.insert([embedding], [vectorId], [payload]);

			const mergeResult: MergeResult = {
				snapshot_id: snapshotId,
				findings_preserved: preserved,
				findings_relocated: relocated,
				findings_new: newFindings,
				findings_stale: stale,
				findings_orphaned: orphaned,
				conflicts_resolved: 0, // Would be computed during actual merge
				trust_score: trustScore,
			};

			logger.info('Snapshot merged', {
				snapshot_id: snapshotId,
				baseline: args.baseline_snapshot_id,
				preserved,
				relocated,
				newFindings,
				stale,
				orphaned,
			});

			return {
				success: true,
				...mergeResult,
				processingTime: Date.now() - startTime,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('Failed to merge snapshots', { error: errorMessage });
			return {
				success: false,
				error: errorMessage,
			};
		}
	},
};

// =============================================================================
// EXPORTS
// =============================================================================

export const snapshotTools = {
	cipher_snapshot_create: snapshotCreateTool,
	cipher_snapshot_query: snapshotQueryTool,
	cipher_snapshot_merge: snapshotMergeTool,
};

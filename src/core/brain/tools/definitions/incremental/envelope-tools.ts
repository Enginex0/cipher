/**
 * Envelope Tools for Claude-Hybrid Incremental Analysis
 *
 * These tools manage finding envelopes with semantic search capabilities
 * via Zilliz Cloud (Milvus) vector storage.
 */

import type { InternalTool, InternalToolContext } from '../../types.js';
import type {
	Envelope,
	EnvelopeStoreParams,
	EnvelopeQueryParams,
	WorkflowGoal,
	ConfidenceLevel,
	ValidationStatus,
	INCREMENTAL_COLLECTIONS,
} from './types.js';
import { logger } from '../../../../logger/index.js';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function generateEnvelopeId(): string {
	const now = new Date();
	const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
	const random = Math.random().toString(36).substring(2, 8);
	return `env-${dateStr}-${random}`;
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

function validateEnvelopeParams(params: EnvelopeStoreParams): { valid: boolean; error?: string } {
	const validGoals: WorkflowGoal[] = ['AUDIT', 'DOCUMENT', 'BUILD_FRONTEND'];
	if (!validGoals.includes(params.workflow_goal)) {
		return { valid: false, error: `Invalid workflow_goal. Must be one of: ${validGoals.join(', ')}` };
	}

	const validConfidence: ConfidenceLevel[] = ['HIGH', 'MEDIUM', 'LOW'];
	if (!validConfidence.includes(params.confidence)) {
		return { valid: false, error: `Invalid confidence. Must be one of: ${validConfidence.join(', ')}` };
	}

	if (typeof params.tier !== 'number' || params.tier < 0 || params.tier > 8) {
		return { valid: false, error: 'tier must be an integer between 0 and 8' };
	}

	if (params.chunk_index >= params.total_chunks) {
		return { valid: false, error: `chunk_index (${params.chunk_index}) must be less than total_chunks (${params.total_chunks})` };
	}

	if (!params.findings || Object.keys(params.findings).length === 0) {
		return { valid: false, error: 'findings cannot be empty' };
	}

	return { valid: true };
}

function buildEnvelopeSearchText(envelope: Partial<Envelope>): string {
	// Build a searchable text representation for semantic search
	const parts: string[] = [];

	if (envelope.agent) parts.push(`agent:${envelope.agent}`);
	if (envelope.workflow_goal) parts.push(`goal:${envelope.workflow_goal}`);
	if (envelope.chunk_id) parts.push(`chunk:${envelope.chunk_id}`);
	if (envelope.project) parts.push(`project:${envelope.project}`);

	// Include finding summaries if available
	if (envelope.findings) {
		const findingSummary = JSON.stringify(envelope.findings).slice(0, 500);
		parts.push(findingSummary);
	}

	return parts.join(' ');
}

// =============================================================================
// ENVELOPE STORE TOOL
// =============================================================================

export const envelopeStoreTool: InternalTool = {
	name: 'cipher_envelope_store',
	category: 'incremental',
	internal: true,
	agentAccessible: true,
	version: '1.0.0',
	description: 'Store a finding envelope with semantic indexing for Claude-Hybrid analysis. Validates envelope structure and stores with full metadata for later retrieval.',
	parameters: {
		type: 'object',
		properties: {
			tier: {
				type: 'number',
				description: 'Analysis tier (0-8)',
			},
			agent: {
				type: 'string',
				description: 'Agent name that produced this envelope',
			},
			project: {
				type: 'string',
				description: 'Project path being analyzed',
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
			chunk_id: {
				type: 'string',
				description: 'Chunk identifier',
			},
			chunk_index: {
				type: 'number',
				description: 'Index of this chunk (0-based)',
			},
			total_chunks: {
				type: 'number',
				description: 'Total number of chunks',
			},
			git_commit: {
				type: 'string',
				description: 'Git commit hash',
			},
			confidence: {
				type: 'string',
				enum: ['HIGH', 'MEDIUM', 'LOW'],
				description: 'Confidence level of findings',
			},
			findings: {
				type: 'object',
				description: 'The findings object containing analysis results',
			},
			findings_count: {
				type: 'number',
				description: 'Number of findings (auto-computed if not provided)',
			},
			chunk_path: {
				type: 'string',
				description: 'Optional path to chunk file',
			},
			git_branch: {
				type: 'string',
				description: 'Optional git branch name',
			},
			external_refs: {
				type: 'array',
				items: { type: 'string' },
				description: 'Optional external references',
			},
		},
		required: ['tier', 'agent', 'project', 'workflow_id', 'workflow_goal', 'chunk_id', 'chunk_index', 'total_chunks', 'git_commit', 'confidence', 'findings'],
	},
	handler: async (args: EnvelopeStoreParams, context?: InternalToolContext) => {
		const startTime = Date.now();

		try {
			// Validate parameters
			const validation = validateEnvelopeParams(args);
			if (!validation.valid) {
				return {
					success: false,
					error: validation.error,
					stored: false,
				};
			}

			// Generate envelope
			const envelopeId = generateEnvelopeId();
			const timestamp = new Date().toISOString();

			const envelope: Envelope = {
				envelope_id: envelopeId,
				tier: args.tier,
				agent: args.agent,
				project: args.project,
				workflow_id: args.workflow_id,
				workflow_goal: args.workflow_goal,
				chunk_id: args.chunk_id,
				chunk_index: args.chunk_index,
				total_chunks: args.total_chunks,
				chunk_path: args.chunk_path,
				git_commit: args.git_commit,
				git_branch: args.git_branch,
				confidence: args.confidence,
				validation_status: 'PENDING',
				findings: args.findings,
				findings_count: args.findings_count ?? Object.keys(args.findings).length,
				external_refs: args.external_refs,
				created_at: timestamp,
				updated_at: timestamp,
			};

			// Build search text for semantic indexing
			const searchText = buildEnvelopeSearchText(envelope);

			// Get vector store from context
			const vectorStoreManager = context?.services?.vectorStoreManager;
			const embeddingManager = context?.services?.embeddingManager;

			if (!vectorStoreManager || !embeddingManager) {
				logger.warn('Vector store or embedding manager not available, storing without embeddings');
				return {
					success: true,
					envelope_id: envelopeId,
					envelope,
					stored: true,
					warning: 'Stored without vector embedding (services unavailable)',
					processingTime: Date.now() - startTime,
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

			// Generate embedding for semantic search
			const embedder = embeddingManager.getEmbedder('default');
			if (!embedder) {
				logger.warn('No embedder available, storing without embeddings');
				return {
					success: true,
					envelope_id: envelopeId,
					envelope,
					stored: true,
					warning: 'Stored without vector embedding (no embedder)',
					processingTime: Date.now() - startTime,
				};
			}
			const embedding = await embedder.embed(searchText);

			// Store in vector database using correct API
			// Milvus requires numeric IDs, so we generate one and store envelope_id in payload
			const vectorId = generateNumericVectorId();
			const payload = {
				...envelope,
				text: searchText,
				memoryType: 'envelope',
				version: 2,
				vector_id: vectorId,
			};
			await store.insert([embedding], [vectorId], [payload]);

			logger.debug('Envelope stored successfully', {
				envelope_id: envelopeId,
				tier: args.tier,
				agent: args.agent,
				chunk_id: args.chunk_id,
			});

			return {
				success: true,
				envelope_id: envelopeId,
				envelope,
				stored: true,
				processingTime: Date.now() - startTime,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('Failed to store envelope', { error: errorMessage });
			return {
				success: false,
				error: errorMessage,
				stored: false,
			};
		}
	},
};

// =============================================================================
// ENVELOPE QUERY TOOL
// =============================================================================

export const envelopeQueryTool: InternalTool = {
	name: 'cipher_envelope_query',
	category: 'incremental',
	internal: true,
	agentAccessible: true,
	version: '1.0.0',
	description: 'Query envelopes by metadata filters and/or semantic search. Supports filtering by tier, agent, chunk, workflow, project, status, and confidence.',
	parameters: {
		type: 'object',
		properties: {
			tier: {
				type: 'number',
				description: 'Filter by tier (0-8)',
			},
			agent: {
				type: 'string',
				description: 'Filter by agent name',
			},
			chunk_id: {
				type: 'string',
				description: 'Filter by chunk ID',
			},
			workflow_id: {
				type: 'string',
				description: 'Filter by workflow ID',
			},
			project: {
				type: 'string',
				description: 'Filter by project path',
			},
			validation_status: {
				type: 'string',
				enum: ['PENDING', 'VERIFIED', 'PARTIAL', 'REJECTED'],
				description: 'Filter by validation status',
			},
			confidence: {
				type: 'string',
				enum: ['HIGH', 'MEDIUM', 'LOW'],
				description: 'Filter by confidence level',
			},
			semantic_query: {
				type: 'string',
				description: 'Optional semantic search query for finding similar envelopes',
			},
			limit: {
				type: 'number',
				description: 'Maximum results to return (default: 50)',
			},
		},
		required: [],
	},
	handler: async (args: EnvelopeQueryParams, context?: InternalToolContext) => {
		const startTime = Date.now();

		try {
			const limit = args.limit ?? 50;
			const vectorStoreManager = context?.services?.vectorStoreManager;
			const embeddingManager = context?.services?.embeddingManager;

			if (!vectorStoreManager) {
				return {
					success: false,
					error: 'Vector store not available',
					envelopes: [],
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
					envelopes: [],
					count: 0,
				};
			}

			// Build filter conditions for manual filtering
			const filterFn = (r: any) => {
				const p = r.payload || r;
				if (p.memoryType !== 'envelope') return false;
				if (args.tier !== undefined && p.tier !== args.tier) return false;
				if (args.agent && p.agent !== args.agent) return false;
				if (args.chunk_id && p.chunk_id !== args.chunk_id) return false;
				if (args.workflow_id && p.workflow_id !== args.workflow_id) return false;
				if (args.project && p.project !== args.project) return false;
				if (args.validation_status && p.validation_status !== args.validation_status) return false;
				if (args.confidence && p.confidence !== args.confidence) return false;
				return true;
			};

			let results: any[] = [];
			const embedder = embeddingManager?.getEmbedder('default');

			if (args.semantic_query && embedder) {
				// Semantic search with manual filtering
				const queryEmbedding = await embedder.embed(args.semantic_query);
				const rawResults = await store.search(queryEmbedding, limit * 3);
				results = rawResults
					.filter(filterFn)
					.slice(0, limit)
					.map((r: any) => ({
						...(r.payload || r),
						similarity: r.score,
					}));
			} else if (embedder) {
				// Metadata-only filter with generic search
				const genericEmbedding = await embedder.embed('envelope findings analysis');
				const rawResults = await store.search(genericEmbedding, limit * 3);
				results = rawResults
					.filter(filterFn)
					.slice(0, limit)
					.map((r: any) => r.payload || r);
			}

			const filtersApplied = [];
			if (args.tier !== undefined) filtersApplied.push('tier');
			if (args.agent) filtersApplied.push('agent');
			if (args.chunk_id) filtersApplied.push('chunk_id');
			if (args.workflow_id) filtersApplied.push('workflow_id');
			if (args.project) filtersApplied.push('project');
			if (args.validation_status) filtersApplied.push('validation_status');
			if (args.confidence) filtersApplied.push('confidence');

			return {
				success: true,
				envelopes: results,
				count: results.length,
				filters_applied: filtersApplied,
				processingTime: Date.now() - startTime,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('Failed to query envelopes', { error: errorMessage });
			return {
				success: false,
				error: errorMessage,
				envelopes: [],
				count: 0,
			};
		}
	},
};

// =============================================================================
// ENVELOPE GET TOOL
// =============================================================================

export const envelopeGetTool: InternalTool = {
	name: 'cipher_envelope_get',
	category: 'incremental',
	internal: true,
	agentAccessible: true,
	version: '1.0.0',
	description: 'Retrieve a specific envelope by ID. Returns the complete envelope with all fields including findings.',
	parameters: {
		type: 'object',
		properties: {
			envelope_id: {
				type: 'string',
				description: 'The envelope ID to retrieve (e.g., env-20260103-123456-abc123)',
			},
		},
		required: ['envelope_id'],
	},
	handler: async (args: { envelope_id: string }, context?: InternalToolContext) => {
		const startTime = Date.now();

		try {
			const vectorStoreManager = context?.services?.vectorStoreManager;
			const embeddingManager = context?.services?.embeddingManager;

			if (!vectorStoreManager || !embeddingManager) {
				return {
					success: false,
					found: false,
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
					found: false,
					error: 'Vector store not available',
				};
			}

			const embedder = embeddingManager.getEmbedder('default');
			if (!embedder) {
				return {
					success: false,
					found: false,
					error: 'Embedder not available',
				};
			}

			// Search for the specific envelope by ID
			const idEmbedding = await embedder.embed(args.envelope_id);
			const results = await store.search(idEmbedding, 50);

			// Filter for envelopes and find exact match
			const exactMatch = results.find((r: any) => {
				const p = r.payload || r;
				return p.memoryType === 'envelope' && p.envelope_id === args.envelope_id;
			});

			if (!exactMatch) {
				return {
					success: true,
					found: false,
					envelope_id: args.envelope_id,
					error: 'Envelope not found',
				};
			}

			return {
				success: true,
				found: true,
				envelope: exactMatch.payload || exactMatch,
				processingTime: Date.now() - startTime,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('Failed to get envelope', { error: errorMessage, envelope_id: args.envelope_id });
			return {
				success: false,
				found: false,
				error: errorMessage,
			};
		}
	},
};

// =============================================================================
// ENVELOPE DELETE TOOL
// =============================================================================

export const envelopeDeleteTool: InternalTool = {
	name: 'cipher_envelope_delete',
	category: 'incremental',
	internal: true,
	agentAccessible: true,
	version: '1.0.0',
	description: 'Delete a specific envelope by ID. This is permanent and cannot be undone.',
	parameters: {
		type: 'object',
		properties: {
			envelope_id: {
				type: 'string',
				description: 'The envelope ID to delete (e.g., env-20260103-123456-abc123)',
			},
		},
		required: ['envelope_id'],
	},
	handler: async (args: { envelope_id: string }, context?: InternalToolContext) => {
		const startTime = Date.now();

		try {
			const vectorStoreManager = context?.services?.vectorStoreManager;
			const embeddingManager = context?.services?.embeddingManager;

			if (!vectorStoreManager || !embeddingManager) {
				return {
					success: false,
					deleted: false,
					error: 'Vector store or embedding manager not available',
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
					deleted: false,
					error: 'Vector store not available',
				};
			}

			// First, find the envelope to get its vector_id
			const embedder = embeddingManager.getEmbedder('default');
			if (!embedder) {
				return {
					success: false,
					deleted: false,
					error: 'Embedder not available',
				};
			}

			// Search for the envelope by envelope_id
			const idEmbedding = await embedder.embed(args.envelope_id);
			const results = await store.search(idEmbedding, 100);

			// Find exact match
			const exactMatch = results.find((r: any) => {
				const p = r.payload || r;
				return p.memoryType === 'envelope' && p.envelope_id === args.envelope_id;
			});

			if (!exactMatch) {
				return {
					success: false,
					deleted: false,
					envelope_id: args.envelope_id,
					error: 'Envelope not found',
				};
			}

			// Get the numeric vector_id from the payload
			const payload = exactMatch.payload || exactMatch;
			const vectorId = payload.vector_id;

			if (!vectorId) {
				return {
					success: false,
					deleted: false,
					envelope_id: args.envelope_id,
					error: 'Envelope has no vector_id - cannot delete',
				};
			}

			// Delete by numeric vector_id
			await store.delete(vectorId);

			logger.info('Envelope deleted', { envelope_id: args.envelope_id, vector_id: vectorId });

			return {
				success: true,
				deleted: true,
				envelope_id: args.envelope_id,
				vector_id: vectorId,
				processingTime: Date.now() - startTime,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('Failed to delete envelope', { error: errorMessage, envelope_id: args.envelope_id });
			return {
				success: false,
				deleted: false,
				envelope_id: args.envelope_id,
				error: errorMessage,
			};
		}
	},
};

// =============================================================================
// EXPORTS
// =============================================================================

export const envelopeTools = {
	cipher_envelope_store: envelopeStoreTool,
	cipher_envelope_query: envelopeQueryTool,
	cipher_envelope_get: envelopeGetTool,
	cipher_envelope_delete: envelopeDeleteTool,
};

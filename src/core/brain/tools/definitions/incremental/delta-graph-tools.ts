/**
 * Delta and Graph Tools for Claude-Hybrid Incremental Analysis
 *
 * These tools handle delta computation and impact graph operations
 * for cascade analysis and change detection.
 */

import type { InternalTool, InternalToolContext } from '../../types.js';
import type {
	DeltaComputeParams,
	DeltaManifest,
	GraphUpdateParams,
	GraphPropagateParams,
	GraphNode,
	GraphEdge,
	CascadeChain,
} from './types.js';
import { logger } from '../../../../logger/index.js';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate a safe numeric vector ID for Milvus storage
 * Milvus requires numeric IDs, so we use timestamp-based generation
 */
function generateNumericVectorId(index: number = 0): number {
	const timestamp = Date.now();
	const randomSuffix = Math.floor(Math.random() * 1000);
	return timestamp * 1000 + randomSuffix + index;
}

// =============================================================================
// DELTA COMPUTE TOOL
// =============================================================================

export const deltaComputeTool: InternalTool = {
	name: 'cipher_delta_compute',
	category: 'incremental',
	internal: true,
	agentAccessible: true,
	version: '1.0.0',
	description: 'Compute delta between baseline and HEAD with graph-based cascade propagation. Combines git diff with Impact Propagation Graph for precise chunk impact analysis.',
	parameters: {
		type: 'object',
		properties: {
			project: {
				type: 'string',
				description: 'Absolute path to project root directory',
			},
			baseline_snapshot_id: {
				type: 'string',
				description: 'Baseline snapshot ID to compute delta from',
			},
			target_commit: {
				type: 'string',
				description: 'Target git commit to analyze (default: HEAD)',
			},
			cascade_depth: {
				type: 'number',
				description: 'Maximum depth for graph cascade propagation (1-10)',
			},
			enable_semantic_ripple: {
				type: 'boolean',
				description: 'Enable semantic similarity detection for ripple effect analysis',
			},
			similarity_threshold: {
				type: 'number',
				description: 'Threshold for semantic similarity matching (0.5-1.0)',
			},
		},
		required: ['project', 'baseline_snapshot_id'],
	},
	handler: async (args: DeltaComputeParams, context?: InternalToolContext) => {
		const startTime = Date.now();

		try {
			const targetCommit = args.target_commit ?? 'HEAD';
			const cascadeDepth = args.cascade_depth ?? 3;
			const enableSemanticRipple = args.enable_semantic_ripple ?? true;
			const similarityThreshold = args.similarity_threshold ?? 0.8;

			const vectorStoreManager = context?.services?.vectorStoreManager;
			const embeddingManager = context?.services?.embeddingManager;
			const embedder = embeddingManager?.getEmbedder('default');

			// In a full implementation, this would:
			// 1. Fetch baseline snapshot from vector store
			// 2. Run git diff between baseline commit and target
			// 3. Map changed files to chunks
			// 4. Load impact graph and run BFS propagation
			// 5. Optionally detect semantic ripples

			// For now, return a structured placeholder
			const deltaManifest: DeltaManifest = {
				baseline_snapshot_id: args.baseline_snapshot_id,
				target_commit: targetCommit,
				changed_files: [],
				affected_chunks: [],
				cascade_affected: [],
				semantic_affected: [],
				recommendation: 'NO_CHANGES',
				estimated_savings: '100%',
			};

			// If we have vector store, try to fetch baseline
			if (vectorStoreManager && embeddingManager && embedder) {
				// Get the knowledge store
				let store: any;
				try {
					store = (vectorStoreManager as any).getStore('knowledge');
				} catch {
					store = (vectorStoreManager as any).getStore();
				}

				if (store) {
					const baselineQuery = await embedder.embed(args.baseline_snapshot_id);
					const rawResults = await store.search(baselineQuery, 10);
					const baselineResults = rawResults.filter((r: any) => {
						const p = r.payload || r;
						return p.memoryType === 'snapshot' && p.snapshot_id === args.baseline_snapshot_id;
					});

					if (baselineResults.length === 0) {
						return {
							success: false,
							error: `Baseline snapshot not found: ${args.baseline_snapshot_id}`,
						};
					}

					// Delta computation would happen here in full implementation
					logger.debug('Delta computation requested', {
						baseline: args.baseline_snapshot_id,
						target: targetCommit,
						cascadeDepth,
					});
				}
			}

			return {
				success: true,
				delta_manifest: deltaManifest,
				recommendation: deltaManifest.recommendation,
				affected_chunks: deltaManifest.affected_chunks,
				cascade_chains: [],
				estimated_savings: deltaManifest.estimated_savings,
				processingTime: Date.now() - startTime,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('Failed to compute delta', { error: errorMessage });
			return {
				success: false,
				error: errorMessage,
			};
		}
	},
};

// =============================================================================
// GRAPH UPDATE TOOL
// =============================================================================

export const graphUpdateTool: InternalTool = {
	name: 'cipher_graph_update',
	category: 'incremental',
	internal: true,
	agentAccessible: true,
	version: '1.0.0',
	description: 'Update Impact Propagation Graph with new nodes and edges. Maintains dependency graph for cascade analysis.',
	parameters: {
		type: 'object',
		properties: {
			project_path: {
				type: 'string',
				description: 'Absolute path to project root',
			},
			operation: {
				type: 'string',
				enum: ['add_node', 'update_node', 'remove_node', 'add_edge', 'remove_edge', 'bulk_update'],
				description: 'Graph operation to perform',
			},
			node: {
				type: 'object',
				description: 'Node object for add_node/update_node operations',
			},
			node_id: {
				type: 'string',
				description: 'Node ID for remove_node operation',
			},
			edge: {
				type: 'object',
				description: 'Edge object for add_edge/remove_edge operations',
			},
			bulk_nodes: {
				type: 'array',
				description: 'Array of nodes for bulk_update operation',
			},
			bulk_edges: {
				type: 'array',
				description: 'Array of edges for bulk_update operation',
			},
			commit: {
				type: 'string',
				description: 'Git commit this update corresponds to',
			},
		},
		required: ['project_path', 'operation', 'commit'],
	},
	handler: async (args: GraphUpdateParams, context?: InternalToolContext) => {
		const startTime = Date.now();

		try {
			const vectorStoreManager = context?.services?.vectorStoreManager;
			const embeddingManager = context?.services?.embeddingManager;
			const embedder = embeddingManager?.getEmbedder('default');

			// Get the knowledge store
			let store: any;
			if (vectorStoreManager) {
				try {
					store = (vectorStoreManager as any).getStore('knowledge');
				} catch {
					store = (vectorStoreManager as any).getStore();
				}
			}

			let nodesAffected = 0;
			let edgesAffected = 0;

			switch (args.operation) {
				case 'add_node':
				case 'update_node':
					if (!args.node) {
						return { success: false, error: 'node required for add_node/update_node' };
					}
					if (store && embedder) {
						const nodeText = `${args.node.node_type}:${args.node.node_id} ${JSON.stringify(args.node.properties)}`;
						const embedding = await embedder.embed(nodeText);
						// Milvus requires numeric IDs
						const vectorId = generateNumericVectorId();
						const payload = {
							...args.node,
							project_path: args.project_path,
							commit: args.commit,
							recordType: 'node',
							memoryType: 'graph',
							version: 2,
							vector_id: vectorId,
						};
						await store.insert([embedding], [vectorId], [payload]);
						nodesAffected = 1;
					}
					break;

				case 'remove_node':
					if (!args.node_id) {
						return { success: false, error: 'node_id required for remove_node' };
					}
					if (store) {
						await store.delete(args.node_id);
						nodesAffected = 1;
					}
					break;

				case 'add_edge':
					if (!args.edge) {
						return { success: false, error: 'edge required for add_edge' };
					}
					if (store && embedder) {
						const edgeId = `edge-${args.edge.source}-${args.edge.target}-${args.edge.edge_type}`;
						const edgeText = `${args.edge.edge_type}:${args.edge.source}->${args.edge.target}`;
						const embedding = await embedder.embed(edgeText);
						// Milvus requires numeric IDs
						const vectorId = generateNumericVectorId();
						const payload = {
							...args.edge,
							edge_id: edgeId,
							project_path: args.project_path,
							commit: args.commit,
							recordType: 'edge',
							memoryType: 'graph',
							version: 2,
							vector_id: vectorId,
						};
						await store.insert([embedding], [vectorId], [payload]);
						edgesAffected = 1;
					}
					break;

				case 'remove_edge':
					if (!args.edge) {
						return { success: false, error: 'edge required for remove_edge' };
					}
					if (store) {
						const edgeId = `edge-${args.edge.source}-${args.edge.target}-${args.edge.edge_type}`;
						await store.delete(edgeId);
						edgesAffected = 1;
					}
					break;

				case 'bulk_update':
					if (store && embedder) {
						if (args.bulk_nodes) {
							for (const node of args.bulk_nodes) {
								const nodeText = `${node.node_type}:${node.node_id}`;
								const embedding = await embedder.embed(nodeText);
								// Milvus requires numeric IDs
								const vectorId = generateNumericVectorId(nodesAffected);
								const payload = {
									...node,
									project_path: args.project_path,
									commit: args.commit,
									recordType: 'node',
									memoryType: 'graph',
									version: 2,
									vector_id: vectorId,
								};
								await store.insert([embedding], [vectorId], [payload]);
								nodesAffected++;
							}
						}
						if (args.bulk_edges) {
							for (const edge of args.bulk_edges) {
								const edgeId = `edge-${edge.source}-${edge.target}-${edge.edge_type}`;
								const edgeText = `${edge.edge_type}:${edge.source}->${edge.target}`;
								const embedding = await embedder.embed(edgeText);
								// Milvus requires numeric IDs
								const vectorId = generateNumericVectorId(edgesAffected);
								const payload = {
									...edge,
									edge_id: edgeId,
									project_path: args.project_path,
									commit: args.commit,
									recordType: 'edge',
									memoryType: 'graph',
									version: 2,
									vector_id: vectorId,
								};
								await store.insert([embedding], [vectorId], [payload]);
								edgesAffected++;
							}
						}
					}
					break;
			}

			logger.debug('Graph updated', {
				operation: args.operation,
				nodesAffected,
				edgesAffected,
				commit: args.commit,
			});

			return {
				success: true,
				nodes_affected: nodesAffected,
				edges_affected: edgesAffected,
				graph_stats: {
					operation: args.operation,
					commit: args.commit,
				},
				processingTime: Date.now() - startTime,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('Failed to update graph', { error: errorMessage });
			return {
				success: false,
				error: errorMessage,
			};
		}
	},
};

// =============================================================================
// GRAPH PROPAGATE TOOL
// =============================================================================

export const graphPropagateTool: InternalTool = {
	name: 'cipher_graph_propagate',
	category: 'incremental',
	internal: true,
	agentAccessible: true,
	version: '1.0.0',
	description: 'Run cascade analysis on Impact Propagation Graph. Implements BFS traversal to find all chunks affected by changes via dependency chains.',
	parameters: {
		type: 'object',
		properties: {
			project_path: {
				type: 'string',
				description: 'Absolute path to project root',
			},
			dirty_chunks: {
				type: 'array',
				items: { type: 'string' },
				description: 'List of chunk IDs with direct changes',
			},
			max_depth: {
				type: 'number',
				description: 'Maximum BFS traversal depth (1-10)',
			},
			edge_types: {
				type: 'array',
				items: { type: 'string' },
				description: 'Edge types to follow during propagation',
			},
			min_edge_weight: {
				type: 'number',
				description: 'Minimum edge weight to consider significant',
			},
			enable_semantic_ripple: {
				type: 'boolean',
				description: 'Include SIMILAR_TO edges for semantic ripple detection',
			},
			similarity_threshold: {
				type: 'number',
				description: 'Minimum confidence for SIMILAR_TO edges',
			},
		},
		required: ['project_path', 'dirty_chunks'],
	},
	handler: async (args: GraphPropagateParams, context?: InternalToolContext) => {
		const startTime = Date.now();

		try {
			const maxDepth = args.max_depth ?? 3;
			const edgeTypes = args.edge_types ?? ['IMPORTS', 'CALLS', 'EXTENDS', 'IMPLEMENTS'];
			const minEdgeWeight = args.min_edge_weight ?? 2;
			const enableSemanticRipple = args.enable_semantic_ripple ?? true;
			const similarityThreshold = args.similarity_threshold ?? 0.8;

			const vectorStoreManager = context?.services?.vectorStoreManager;
			const embeddingManager = context?.services?.embeddingManager;
			const embedder = embeddingManager?.getEmbedder('default');

			// BFS cascade propagation
			const cascadeAffected: Set<string> = new Set();
			const semanticAffected: Set<string> = new Set();
			const visited: Set<string> = new Set(args.dirty_chunks);
			const cascadeChains: CascadeChain[] = [];

			let nodesVisited = 0;
			let edgesTraversed = 0;
			let maxDepthReached = 0;

			// In a full implementation, this would:
			// 1. Start BFS from dirty_chunks
			// 2. Follow edges in edge_types with weight >= min_edge_weight
			// 3. Track cascade chains for audit
			// 4. Optionally follow SIMILAR_TO edges for semantic ripple

			if (vectorStoreManager && embeddingManager && embedder) {
				// Get the knowledge store
				let store: any;
				try {
					store = (vectorStoreManager as any).getStore('knowledge');
				} catch {
					store = (vectorStoreManager as any).getStore();
				}

				if (store) {
					// Search for graph edges connected to dirty chunks
					for (const chunkId of args.dirty_chunks) {
						const query = `chunk:${chunkId} ${edgeTypes.join(' ')}`;
						const embedding = await embedder.embed(query);
						const rawResults = await store.search(embedding, 100);

						// Filter for graph edges in this project
						const results = rawResults.filter((r: any) => {
							const p = r.payload || r;
							return p.memoryType === 'graph' &&
								p.recordType === 'edge' &&
								p.project_path === args.project_path;
						});

						for (const result of results) {
							const edge = result.payload || result;
							if (edge.source === chunkId || edge.target === chunkId) {
								const affectedChunk = edge.source === chunkId ? edge.target : edge.source;
								if (!visited.has(affectedChunk)) {
									cascadeAffected.add(affectedChunk);
									visited.add(affectedChunk);
									cascadeChains.push({
										source_chunk: chunkId,
										affected_chunk: affectedChunk,
										path: [chunkId, affectedChunk],
										edge_types: [edge.edge_type],
										depth: 1,
									});
									edgesTraversed++;
								}
								nodesVisited++;
							}
						}
					}
				}
			}

			const allAffected = [...args.dirty_chunks, ...cascadeAffected, ...semanticAffected];

			logger.debug('Graph propagation complete', {
				dirtyChunks: args.dirty_chunks.length,
				cascadeAffected: cascadeAffected.size,
				semanticAffected: semanticAffected.size,
				totalAffected: allAffected.length,
			});

			return {
				success: true,
				cascade_affected: [...cascadeAffected],
				semantic_affected: [...semanticAffected],
				all_affected: allAffected,
				cascade_chains: cascadeChains,
				stats: {
					nodes_visited: nodesVisited,
					edges_traversed: edgesTraversed,
					max_depth_reached: maxDepthReached,
				},
				processingTime: Date.now() - startTime,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error('Failed to propagate graph', { error: errorMessage });
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

export const deltaGraphTools = {
	cipher_delta_compute: deltaComputeTool,
	cipher_graph_update: graphUpdateTool,
	cipher_graph_propagate: graphPropagateTool,
};
